import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request
from zoneinfo import ZoneInfo

import cv2
import numpy as np

from actuators.ligth import get_light_status
from ai.coverage import analyze_green_coverage_bytes, extract_surface_roi
from camera.camera import get_latest_frame_bytes


class AnomalyWatcher:
    def __init__(
        self,
        collection,
        timezone_name: str,
        poll_seconds: int,
        output_dir: str,
        data_root_dir: str,
        public_base_url: str = "",
        enabled: bool = True,
        webhook_url: str | None = None,
        min_area_percent: float = 2.5,
        frame_min_area_percent: float = 4.5,
        persist_frames: int = 3,
        cooldown_seconds: int = 300,
        diff_threshold: int = 28,
    ):
        self.collection = collection
        self.timezone_name = timezone_name
        self.timezone = ZoneInfo(timezone_name)
        self.poll_seconds = max(int(poll_seconds), 2)
        self.output_dir = Path(output_dir)
        self.data_root_dir = Path(data_root_dir)
        self.public_base_url = (public_base_url or "").strip().rstrip("/")
        self.enabled = bool(enabled)
        self.webhook_url = (webhook_url or "").strip()
        self.min_area_percent = max(float(min_area_percent), 0.1)
        self.frame_min_area_percent = max(float(frame_min_area_percent), 0.1)
        self.persist_frames = max(int(persist_frames), 1)
        self.cooldown_seconds = max(int(cooldown_seconds), 0)
        self.diff_threshold = max(int(diff_threshold), 1)
        self._baseline_alpha = 0.05
        self._stop_event = threading.Event()
        self._thread = None
        self._lock = threading.RLock()
        self._light_states = {
            True: self._build_light_state(),
            False: self._build_light_state(),
        }
        self._runtime = {
            "last_checked_at": None,
            "last_frame_captured_at": None,
            "last_error": None,
            "last_alert_at": None,
            "last_alert_area_percent": None,
            "last_alert_source": None,
            "last_changed_area_percent": None,
            "last_largest_blob_percent": None,
            "last_coverage_percent": None,
            "last_coverage_delta_percent": None,
            "last_frame_changed_area_percent": None,
            "last_frame_largest_blob_percent": None,
            "last_candidate_source": None,
            "last_light_state": None,
            "last_webhook_ok": None,
            "last_webhook_message": None,
        }
        self._latest_preview_asset = None
        self._latest_preview_token = None

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._ensure_indexes()
            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="anomaly-watcher",
                daemon=True,
            )
            self._thread.start()

    def stop(self):
        with self._lock:
            thread = self._thread
            if thread is None:
                return

            self._thread = None
            self._stop_event.set()

        thread.join(timeout=self.poll_seconds + 2)

    def get_status(self):
        with self._lock:
            running = bool(self._thread is not None and self._thread.is_alive())
            recent_alerts = self.collection.count_documents(
                {
                    "detected_at": {
                        "$gte": datetime.now(timezone.utc) - timedelta(hours=24),
                    }
                }
            )
            return {
                "enabled": bool(self.enabled),
                "running": running,
                "webhook_configured": bool(self.webhook_url),
                "webhook_kind": self._get_webhook_kind(),
                "poll_seconds": int(self.poll_seconds),
                "min_area_percent": float(round(self.min_area_percent, 3)),
                "frame_min_area_percent": float(round(self.frame_min_area_percent, 3)),
                "persist_frames": int(self.persist_frames),
                "cooldown_seconds": int(self.cooldown_seconds),
                "diff_threshold": int(self.diff_threshold),
                "baseline_ready_light_on": self._light_states[True]["baseline_gray"] is not None,
                "baseline_ready_light_off": self._light_states[False]["baseline_gray"] is not None,
                "active_candidate_light_on": bool(self._light_states[True]["alert_active"]),
                "active_candidate_light_off": bool(self._light_states[False]["alert_active"]),
                "consecutive_hits_light_on": int(self._light_states[True]["consecutive_hits"]),
                "consecutive_hits_light_off": int(self._light_states[False]["consecutive_hits"]),
                "recent_alerts_24h": int(recent_alerts),
                **self._serialize_runtime(),
            }

    def list_alerts(self, limit: int = 1):
        safe_limit = max(min(int(limit), 100), 1)
        return list(
            self.collection.find().sort([("detected_at", -1), ("_id", -1)]).limit(safe_limit)
        )

    def get_latest_alert(self):
        return self.collection.find_one(sort=[("detected_at", -1), ("_id", -1)])

    def get_latest_preview_asset(self):
        with self._lock:
            return self._latest_preview_asset

    def get_latest_preview_token(self):
        with self._lock:
            return self._latest_preview_token

    def inspect_now(self):
        if not self.enabled:
            return {
                "status": "disabled",
                "message": "anomaly watcher ถูกปิดอยู่",
                "enabled": False,
            }

        checked_at = datetime.now(self.timezone)
        frame_bytes = get_latest_frame_bytes(
            timeout_seconds=5.0,
            max_age_seconds=1.0,
        )
        if frame_bytes is None:
            with self._lock:
                self._runtime["last_checked_at"] = checked_at
                self._runtime["last_error"] = "camera snapshot unavailable"
            return {
                "status": "camera_unavailable",
                "message": "ยังดึงภาพจากกล้องไม่ได้ ลองใหม่อีกครั้ง",
                "enabled": True,
            }

        return self._process_frame_bytes(frame_bytes, checked_at, manual=True)

    def reset_baselines(self):
        with self._lock:
            self._light_states = {
                True: self._build_light_state(),
                False: self._build_light_state(),
            }
            return self.get_status()

    def set_config(
        self,
        *,
        enabled: bool | None = None,
        webhook_url: str | None = None,
        min_area_percent: float | None = None,
        frame_min_area_percent: float | None = None,
        persist_frames: int | None = None,
        cooldown_seconds: int | None = None,
        poll_seconds: int | None = None,
        diff_threshold: int | None = None,
    ):
        with self._lock:
            if enabled is not None:
                self.enabled = bool(enabled)
            if webhook_url is not None:
                self.webhook_url = str(webhook_url).strip()
            if min_area_percent is not None:
                self.min_area_percent = max(float(min_area_percent), 0.1)
            if frame_min_area_percent is not None:
                self.frame_min_area_percent = max(float(frame_min_area_percent), 0.1)
            if persist_frames is not None:
                self.persist_frames = max(int(persist_frames), 1)
            if cooldown_seconds is not None:
                self.cooldown_seconds = max(int(cooldown_seconds), 0)
            if poll_seconds is not None:
                self.poll_seconds = max(int(poll_seconds), 2)
            if diff_threshold is not None:
                self.diff_threshold = max(int(diff_threshold), 1)
            return self.get_status()

    def _build_light_state(self):
        return {
            "baseline_gray": None,
            "baseline_frame_gray": None,
            "baseline_coverage_percent": None,
            "consecutive_hits": 0,
            "alert_active": False,
            "last_alert_at": None,
        }

    def _serialize_runtime(self):
        return {
            "last_checked_at": self._serialize_datetime(self._runtime["last_checked_at"]),
            "last_frame_captured_at": self._serialize_datetime(self._runtime["last_frame_captured_at"]),
            "last_error": self._runtime["last_error"],
            "last_alert_at": self._serialize_datetime(self._runtime["last_alert_at"]),
            "last_alert_area_percent": self._runtime["last_alert_area_percent"],
            "last_alert_source": self._runtime["last_alert_source"],
            "last_changed_area_percent": self._runtime["last_changed_area_percent"],
            "last_largest_blob_percent": self._runtime["last_largest_blob_percent"],
            "last_coverage_percent": self._runtime["last_coverage_percent"],
            "last_coverage_delta_percent": self._runtime["last_coverage_delta_percent"],
            "last_frame_changed_area_percent": self._runtime["last_frame_changed_area_percent"],
            "last_frame_largest_blob_percent": self._runtime["last_frame_largest_blob_percent"],
            "last_candidate_source": self._runtime["last_candidate_source"],
            "last_light_state": self._runtime["last_light_state"],
            "last_webhook_ok": self._runtime["last_webhook_ok"],
            "last_webhook_message": self._runtime["last_webhook_message"],
        }

    def _serialize_datetime(self, value):
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    def _summarize_diff_mask(self, mask, total_pixels: int):
        changed_pixels = int(cv2.countNonZero(mask))
        safe_total_pixels = max(int(total_pixels), 1)
        changed_area_percent = round((changed_pixels * 100.0) / safe_total_pixels, 2)

        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        largest_contour = None
        largest_area = 0.0
        for contour in contours:
            contour_area = float(cv2.contourArea(contour))
            if contour_area > largest_area:
                largest_area = contour_area
                largest_contour = contour

        largest_blob_percent = round((largest_area * 100.0) / safe_total_pixels, 2)
        return {
            "changed_pixels": changed_pixels,
            "changed_area_percent": changed_area_percent,
            "largest_contour": largest_contour,
            "largest_blob_percent": largest_blob_percent,
        }

    def _update_float32_baseline(self, baseline, current_gray, mask):
        current_float = current_gray.astype(np.float32)
        cv2.accumulateWeighted(
            current_float,
            baseline,
            self._baseline_alpha,
            mask=mask,
        )

    def _build_preview_image_and_bbox(
        self,
        analysis: dict,
        roi: dict,
        largest_contour,
        contour_source: str,
        blob_percent: float,
    ):
        preview_image = analysis["overlay_image"].copy()
        full_bbox = None

        if largest_contour is not None:
            bbox_x, bbox_y, bbox_width, bbox_height = cv2.boundingRect(largest_contour)
            if contour_source == "frame":
                full_bbox = {
                    "x": int(bbox_x),
                    "y": int(bbox_y),
                    "width": int(bbox_width),
                    "height": int(bbox_height),
                }
            else:
                full_bbox = {
                    "x": int(roi["x"] + bbox_x),
                    "y": int(roi["y"] + bbox_y),
                    "width": int(bbox_width),
                    "height": int(bbox_height),
                }

            top_left = (full_bbox["x"], full_bbox["y"])
            bottom_right = (
                full_bbox["x"] + full_bbox["width"],
                full_bbox["y"] + full_bbox["height"],
            )
            cv2.rectangle(preview_image, top_left, bottom_right, (16, 64, 255), 3)
            cv2.putText(
                preview_image,
                f"Alert {blob_percent:.2f}%",
                (top_left[0], max(top_left[1] - 12, 24)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (16, 64, 255),
                2,
                cv2.LINE_AA,
            )

        return preview_image, full_bbox

    def _refresh_preview_asset(
        self,
        *,
        detected_at: datetime,
        analysis: dict,
        roi: dict,
        largest_contour,
        contour_source: str,
        blob_percent: float,
    ):
        preview_image, full_bbox = self._build_preview_image_and_bbox(
            analysis,
            roi,
            largest_contour,
            contour_source,
            blob_percent,
        )
        self._set_latest_preview_asset(detected_at, preview_image)
        return full_bbox

    def _ensure_indexes(self):
        self.collection.create_index(
            [("detected_at", -1)],
            name="anomaly_detected_at_idx",
        )
        self.collection.create_index(
            [("created_at", -1)],
            name="anomaly_created_at_idx",
        )

    def _run_loop(self):
        print(
            "[anomaly-watch] เริ่มเฝ้าดูภาพสด "
            f"ทุก {self.poll_seconds} วินาที "
            f"(min_area={self.min_area_percent}% persist={self.persist_frames} เฟรม)"
        )

        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                with self._lock:
                    self._runtime["last_error"] = str(exc)
                    self._runtime["last_checked_at"] = datetime.now(self.timezone)
                print(f"[anomaly-watch] เกิดข้อผิดพลาด: {exc}")

            self._stop_event.wait(self.poll_seconds)

    def _tick(self):
        if not self.enabled:
            with self._lock:
                self._runtime["last_checked_at"] = datetime.now(self.timezone)
                self._runtime["last_error"] = None
            return

        frame_bytes = get_latest_frame_bytes(
            timeout_seconds=5.0,
            max_age_seconds=max(float(self.poll_seconds), 3.0),
        )
        checked_at = datetime.now(self.timezone)
        if frame_bytes is None:
            with self._lock:
                self._runtime["last_checked_at"] = checked_at
                self._runtime["last_error"] = "camera snapshot unavailable"
            return

        self._process_frame_bytes(frame_bytes, checked_at)

    def _process_frame_bytes(self, frame_bytes: bytes, detected_at: datetime, manual: bool = False):
        analysis = analyze_green_coverage_bytes(frame_bytes)
        image = analysis["image"]
        surface_context = extract_surface_roi(image)
        roi = surface_context["roi"]
        roi_image = surface_context["roi_image"]
        surface_mask = surface_context["surface_mask"]
        gray = cv2.cvtColor(roi_image, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (9, 9), 0)
        gray = cv2.bitwise_and(gray, gray, mask=surface_mask)
        frame_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        frame_gray = cv2.GaussianBlur(frame_gray, (11, 11), 0)
        frame_mask = np.full(frame_gray.shape, 255, dtype=np.uint8)

        light_is_on = bool(get_light_status().get("is_on"))
        light_state = self._light_states[light_is_on]

        with self._lock:
            self._runtime["last_checked_at"] = detected_at
            self._runtime["last_frame_captured_at"] = detected_at
            self._runtime["last_error"] = None
            self._runtime["last_coverage_percent"] = analysis["green_coverage_percent"]
            self._runtime["last_light_state"] = "on" if light_is_on else "off"

        if light_state["baseline_gray"] is None or light_state["baseline_frame_gray"] is None:
            light_state["baseline_gray"] = gray.astype(np.float32)
            light_state["baseline_frame_gray"] = frame_gray.astype(np.float32)
            light_state["baseline_coverage_percent"] = float(
                analysis["green_coverage_percent"]
            )
            return {
                "status": "baseline_initialized",
                "message": "เพิ่งตั้ง baseline ของภาพรอบนี้ ลองยื่นวัตถุแล้วกดตรวจอีกครั้งในรอบถัดไป",
                "enabled": True,
                "manual": bool(manual),
                "baseline_ready": False,
                "light_state": "on" if light_is_on else "off",
            }

        baseline_gray = cv2.convertScaleAbs(light_state["baseline_gray"])
        diff = cv2.absdiff(gray, baseline_gray)
        _, diff_mask = cv2.threshold(
            diff,
            self.diff_threshold,
            255,
            cv2.THRESH_BINARY,
        )
        diff_mask = cv2.bitwise_and(diff_mask, surface_mask)

        open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        diff_mask = cv2.morphologyEx(diff_mask, cv2.MORPH_OPEN, open_kernel)
        diff_mask = cv2.morphologyEx(diff_mask, cv2.MORPH_CLOSE, close_kernel)
        surface_pixels = int(cv2.countNonZero(surface_mask)) or 1
        surface_metrics = self._summarize_diff_mask(diff_mask, surface_pixels)
        changed_area_percent = surface_metrics["changed_area_percent"]
        largest_contour = surface_metrics["largest_contour"]
        largest_blob_percent = surface_metrics["largest_blob_percent"]

        baseline_frame_gray = cv2.convertScaleAbs(light_state["baseline_frame_gray"])
        frame_diff = cv2.absdiff(frame_gray, baseline_frame_gray)
        frame_diff_threshold = max(self.diff_threshold - 4, 8)
        _, frame_diff_mask = cv2.threshold(
            frame_diff,
            frame_diff_threshold,
            255,
            cv2.THRESH_BINARY,
        )
        frame_open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        frame_close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
        frame_diff_mask = cv2.morphologyEx(frame_diff_mask, cv2.MORPH_OPEN, frame_open_kernel)
        frame_diff_mask = cv2.morphologyEx(frame_diff_mask, cv2.MORPH_CLOSE, frame_close_kernel)
        frame_metrics = self._summarize_diff_mask(frame_diff_mask, frame_gray.size)
        frame_changed_area_percent = frame_metrics["changed_area_percent"]
        frame_largest_contour = frame_metrics["largest_contour"]
        frame_largest_blob_percent = frame_metrics["largest_blob_percent"]

        coverage_delta_percent = round(
            abs(
                float(analysis["green_coverage_percent"])
                - float(light_state["baseline_coverage_percent"] or 0.0)
            ),
            2,
        )

        with self._lock:
            self._runtime["last_changed_area_percent"] = changed_area_percent
            self._runtime["last_largest_blob_percent"] = largest_blob_percent
            self._runtime["last_coverage_delta_percent"] = coverage_delta_percent
            self._runtime["last_frame_changed_area_percent"] = frame_changed_area_percent
            self._runtime["last_frame_largest_blob_percent"] = frame_largest_blob_percent

        changed_area_threshold = max(self.min_area_percent + 1.0, self.min_area_percent * 1.8)
        frame_changed_area_threshold = max(
            self.frame_min_area_percent + 1.5,
            self.frame_min_area_percent * 1.6,
        )
        baseline_hold_threshold = max(0.8, self.min_area_percent * 0.45)
        frame_hold_threshold = max(1.6, self.frame_min_area_percent * 0.45)
        result = {
            "enabled": True,
            "manual": bool(manual),
            "baseline_ready": True,
            "light_state": "on" if light_is_on else "off",
            "largest_blob_percent": largest_blob_percent,
            "changed_area_percent": changed_area_percent,
            "coverage_delta_percent": coverage_delta_percent,
            "min_area_percent": float(round(self.min_area_percent, 3)),
            "changed_area_threshold": round(changed_area_threshold, 2),
            "frame_largest_blob_percent": frame_largest_blob_percent,
            "frame_changed_area_percent": frame_changed_area_percent,
            "frame_min_area_percent": float(round(self.frame_min_area_percent, 3)),
            "frame_changed_area_threshold": round(frame_changed_area_threshold, 2),
            "alert_active": bool(light_state["alert_active"]),
        }
        candidate_source = None
        if largest_blob_percent >= self.min_area_percent:
            candidate_source = "surface_blob"
        elif changed_area_percent >= changed_area_threshold:
            candidate_source = "surface_changed"
        elif frame_largest_blob_percent >= self.frame_min_area_percent:
            candidate_source = "frame_blob"
        elif frame_changed_area_percent >= frame_changed_area_threshold:
            candidate_source = "frame_changed"

        candidate_detected = candidate_source is not None
        with self._lock:
            self._runtime["last_candidate_source"] = candidate_source

        if not candidate_detected:
            light_state["consecutive_hits"] = 0
            light_state["alert_active"] = False
            if (
                changed_area_percent < baseline_hold_threshold
                and coverage_delta_percent < 1.0
                and frame_changed_area_percent < frame_hold_threshold
            ):
                self._update_baseline(
                    light_state,
                    gray,
                    frame_gray,
                    analysis["green_coverage_percent"],
                    surface_mask,
                    frame_mask,
                )
            return {
                **result,
                "status": "no_candidate",
                "candidate_detected": False,
                "candidate_source": None,
                "alert_blob_percent": max(largest_blob_percent, frame_largest_blob_percent),
                "alert_changed_area_percent": max(
                    changed_area_percent,
                    frame_changed_area_percent,
                ),
                "alert_created": False,
                "message": (
                    "ยังไม่ถึงเกณฑ์แจ้งเตือน "
                    f"(surface {largest_blob_percent:.2f}% / {changed_area_percent:.2f}% "
                    f"| frame {frame_largest_blob_percent:.2f}% / {frame_changed_area_percent:.2f}%)"
                ),
            }

        light_state["consecutive_hits"] += 1
        use_frame_candidate = str(candidate_source).startswith("frame_")
        preview_contour = frame_largest_contour if use_frame_candidate else largest_contour
        preview_source = "frame" if use_frame_candidate else "surface_roi"
        preview_blob_percent = (
            frame_largest_blob_percent if use_frame_candidate else largest_blob_percent
        )
        preview_changed_area_percent = (
            frame_changed_area_percent if use_frame_candidate else changed_area_percent
        )

        if light_state["alert_active"]:
            self._refresh_preview_asset(
                detected_at=detected_at,
                analysis=analysis,
                roi=roi,
                largest_contour=preview_contour,
                contour_source=preview_source,
                blob_percent=preview_blob_percent,
            )
            return {
                **result,
                "status": "already_active",
                "candidate_detected": True,
                "candidate_source": candidate_source,
                "alert_blob_percent": preview_blob_percent,
                "alert_changed_area_percent": preview_changed_area_percent,
                "alert_created": False,
                "message": "เจอความเปลี่ยนแปลงอยู่ แต่ระบบยังมองว่าเป็น event เดิมต่อเนื่อง",
            }

        if light_state["consecutive_hits"] < self.persist_frames:
            self._refresh_preview_asset(
                detected_at=detected_at,
                analysis=analysis,
                roi=roi,
                largest_contour=preview_contour,
                contour_source=preview_source,
                blob_percent=preview_blob_percent,
            )
            return {
                **result,
                "status": "waiting_persist",
                "candidate_detected": True,
                "candidate_source": candidate_source,
                "alert_blob_percent": preview_blob_percent,
                "alert_changed_area_percent": preview_changed_area_percent,
                "alert_created": False,
                "message": (
                    "เห็นความเปลี่ยนแปลงแล้ว แต่ยังรอให้ติดกัน "
                    f"{self.persist_frames} เฟรม"
                ),
            }

        last_alert_at = light_state.get("last_alert_at")
        if (
            isinstance(last_alert_at, datetime)
            and self.cooldown_seconds > 0
            and (detected_at - last_alert_at).total_seconds() < self.cooldown_seconds
        ):
            light_state["alert_active"] = True
            cooldown_left = max(
                0,
                int(self.cooldown_seconds - (detected_at - last_alert_at).total_seconds()),
            )
            self._refresh_preview_asset(
                detected_at=detected_at,
                analysis=analysis,
                roi=roi,
                largest_contour=preview_contour,
                contour_source=preview_source,
                blob_percent=preview_blob_percent,
            )
            return {
                **result,
                "status": "cooldown",
                "candidate_detected": True,
                "candidate_source": candidate_source,
                "alert_blob_percent": preview_blob_percent,
                "alert_changed_area_percent": preview_changed_area_percent,
                "alert_created": False,
                "message": f"พบความเปลี่ยนแปลงแล้ว แต่ยังอยู่ใน cooldown อีกประมาณ {cooldown_left} วินาที",
            }

        alert_blob_percent = (
            frame_largest_blob_percent if use_frame_candidate else largest_blob_percent
        )
        alert_changed_area_percent = (
            frame_changed_area_percent if use_frame_candidate else changed_area_percent
        )
        alert_document = self._store_alert(
            detected_at=detected_at,
            analysis=analysis,
            roi=roi,
            largest_contour=frame_largest_contour if use_frame_candidate else largest_contour,
            contour_source="frame" if use_frame_candidate else "surface_roi",
            alert_blob_percent=alert_blob_percent,
            alert_changed_area_percent=alert_changed_area_percent,
            surface_largest_blob_percent=largest_blob_percent,
            surface_changed_area_percent=changed_area_percent,
            frame_largest_blob_percent=frame_largest_blob_percent,
            frame_changed_area_percent=frame_changed_area_percent,
            coverage_delta_percent=coverage_delta_percent,
            light_is_on=light_is_on,
            detection_source=str(candidate_source),
        )
        light_state["alert_active"] = True
        light_state["last_alert_at"] = detected_at
        with self._lock:
            self._runtime["last_alert_at"] = detected_at
            self._runtime["last_alert_area_percent"] = alert_blob_percent
            self._runtime["last_alert_source"] = candidate_source
            self._runtime["last_webhook_ok"] = alert_document.get("webhook_delivered")
            self._runtime["last_webhook_message"] = (
                alert_document.get("webhook_error")
                or alert_document.get("webhook_response_status")
                or ("webhook skipped" if not self.webhook_url else "ok")
            )
        return {
            **result,
            "status": "alert_created",
            "candidate_detected": True,
            "candidate_source": candidate_source,
            "alert_blob_percent": alert_blob_percent,
            "alert_changed_area_percent": alert_changed_area_percent,
            "alert_created": True,
            "message": (
                "ตรวจพบสิ่งแปลกปลอมแล้ว "
                f"(source {candidate_source} • blob {alert_blob_percent:.2f}% / "
                f"changed {alert_changed_area_percent:.2f}%)"
            ),
        }

    def _update_baseline(
        self,
        light_state,
        gray,
        frame_gray,
        coverage_percent: float,
        surface_mask,
        frame_mask,
    ):
        self._update_float32_baseline(
            light_state["baseline_gray"],
            gray,
            surface_mask,
        )
        self._update_float32_baseline(
            light_state["baseline_frame_gray"],
            frame_gray,
            frame_mask,
        )
        previous_coverage = light_state.get("baseline_coverage_percent")
        if previous_coverage is None:
            light_state["baseline_coverage_percent"] = float(coverage_percent)
        else:
            light_state["baseline_coverage_percent"] = round(
                (previous_coverage * (1.0 - self._baseline_alpha))
                + (float(coverage_percent) * self._baseline_alpha),
                2,
            )

    def _store_alert(
        self,
        *,
        detected_at: datetime,
        analysis: dict,
        roi: dict,
        largest_contour,
        contour_source: str,
        alert_blob_percent: float,
        alert_changed_area_percent: float,
        surface_largest_blob_percent: float,
        surface_changed_area_percent: float,
        frame_largest_blob_percent: float,
        frame_changed_area_percent: float,
        coverage_delta_percent: float,
        light_is_on: bool,
        detection_source: str,
    ):
        preview_image, full_bbox = self._build_preview_image_and_bbox(
            analysis,
            roi,
            largest_contour,
            contour_source,
            alert_blob_percent,
        )
        document = {
            "event": "foreign_object_detected",
            "detected_at": detected_at,
            "created_at": datetime.now(timezone.utc),
            "light_is_on": bool(light_is_on),
            "detection_source": detection_source,
            "green_coverage_percent": analysis["green_coverage_percent"],
            "coverage_delta_percent": coverage_delta_percent,
            "changed_area_percent": alert_changed_area_percent,
            "largest_blob_percent": alert_blob_percent,
            "surface_changed_area_percent": surface_changed_area_percent,
            "surface_largest_blob_percent": surface_largest_blob_percent,
            "frame_changed_area_percent": frame_changed_area_percent,
            "frame_largest_blob_percent": frame_largest_blob_percent,
            "green_pixels": analysis["green_pixels"],
            "total_pixels": analysis["total_pixels"],
            "coverage_method": analysis["coverage_method"],
            "coverage_version": analysis["coverage_version"],
            "coverage_roi": analysis["roi"],
            "bounding_box": full_bbox,
            "summary_text": (
                "ตรวจพบสิ่งแปลกปลอม "
                f"source {detection_source} "
                f"blob {alert_blob_percent:.2f}% "
                f"changed {alert_changed_area_percent:.2f}% "
                f"coverage {analysis['green_coverage_percent']:.2f}% "
                f"light {'on' if light_is_on else 'off'}"
            ),
            "preview_available": True,
        }
        self._set_latest_preview_asset(detected_at, preview_image)
        webhook_result = self._send_webhook(document)
        document.update(webhook_result)
        inserted = self.collection.insert_one(document)
        stored = self.collection.find_one({"_id": inserted.inserted_id})
        print(
            "[anomaly-watch] ตรวจพบสิ่งแปลกปลอม "
            f"source={detection_source} "
            f"area={alert_blob_percent}% changed={alert_changed_area_percent}% "
            f"light={'on' if light_is_on else 'off'}"
        )
        return stored or document

    def _set_latest_preview_asset(self, detected_at: datetime, image):
        encoded_ok, buffer = cv2.imencode(".jpg", image)
        if not encoded_ok:
            raise RuntimeError("cannot encode anomaly preview image")

        with self._lock:
            self._latest_preview_asset = {
                "content_type": "image/jpeg",
                "bytes": buffer.tobytes(),
            }
            self._latest_preview_token = detected_at.isoformat()

    def _build_alert_payload(self, document: dict):
        detected_at = document.get("detected_at")
        detected_label = (
            detected_at.astimezone(self.timezone).strftime("%Y-%m-%d %H:%M:%S %Z")
            if isinstance(detected_at, datetime)
            else "-"
        )
        return {
            "event": document.get("event"),
            "message": (
                "ตรวจพบสิ่งแปลกปลอมในบ่อ "
                f"{document.get('largest_blob_percent', 0):.2f}% "
                f"เวลา {detected_label}"
            ),
            "detected_at": self._serialize_datetime(detected_at),
            "light_is_on": document.get("light_is_on"),
            "detection_source": document.get("detection_source"),
            "largest_blob_percent": document.get("largest_blob_percent"),
            "changed_area_percent": document.get("changed_area_percent"),
            "surface_largest_blob_percent": document.get("surface_largest_blob_percent"),
            "surface_changed_area_percent": document.get("surface_changed_area_percent"),
            "frame_largest_blob_percent": document.get("frame_largest_blob_percent"),
            "frame_changed_area_percent": document.get("frame_changed_area_percent"),
            "coverage_percent": document.get("green_coverage_percent"),
            "coverage_delta_percent": document.get("coverage_delta_percent"),
            "bounding_box": document.get("bounding_box"),
            "summary_text": document.get("summary_text"),
        }

    def _get_webhook_kind(self):
        url = (self.webhook_url or "").lower()
        if not url:
            return "none"
        if "discord.com/api/webhooks" in url or "discordapp.com/api/webhooks" in url:
            return "discord"
        if "hooks.slack.com/services" in url:
            return "slack"
        return "generic"

    def _send_webhook(self, document: dict):
        if not self.webhook_url:
            return {
                "webhook_delivered": False,
                "webhook_response_status": None,
                "webhook_error": "webhook not configured",
            }

        base_payload = self._build_alert_payload(document)
        webhook_kind = self._get_webhook_kind()
        if webhook_kind == "discord":
            request_payload = {
                "content": base_payload["message"]
            }
        elif webhook_kind == "slack":
            request_payload = {
                "text": base_payload["message"]
            }
        else:
            request_payload = base_payload

        request_data = json.dumps(request_payload).encode("utf-8")
        request = urllib_request.Request(
            self.webhook_url,
            data=request_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(request, timeout=10) as response:
                status_code = getattr(response, "status", None) or response.getcode()
        except urllib_error.URLError as exc:
            return {
                "webhook_delivered": False,
                "webhook_response_status": None,
                "webhook_error": str(exc),
            }
        except Exception as exc:
            return {
                "webhook_delivered": False,
                "webhook_response_status": None,
                "webhook_error": str(exc),
            }

        return {
            "webhook_delivered": True,
            "webhook_response_status": int(status_code),
            "webhook_error": None,
        }
