import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import cv2

from actuators.ligth import get_light_status, light_off, light_on
from ai.coverage import analyze_green_coverage_bytes
from ai.daily_summary import summarize_day
from ai.simulated_images import pick_simulation_image
from camera.camera import get_latest_frame_bytes
from config import (
    CAMERA_DEVICE,
    IMAGE_ANALYSIS_FORCE_LIGHT_OFF,
    IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS,
)
from grow_cycle import build_cycle_context, get_active_cycle


class DailyImageScheduler:
    def __init__(
        self,
        collection,
        sensor_collection,
        daily_summary_collection,
        grow_cycle_collection,
        timezone_name: str,
        snapshot_time: str,
        poll_seconds: int,
        output_dir: str,
        debug_dir: str,
        timeout_seconds: int,
        source_mode: str,
        simulation_dir: str,
        archive_enabled: bool,
        force_light_off: bool = IMAGE_ANALYSIS_FORCE_LIGHT_OFF,
        light_settle_seconds: int = IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS,
    ):
        self.collection = collection
        self.sensor_collection = sensor_collection
        self.daily_summary_collection = daily_summary_collection
        self.grow_cycle_collection = grow_cycle_collection
        self.timezone_name = timezone_name
        self.timezone = ZoneInfo(timezone_name)
        self.snapshot_time = self._normalize_snapshot_time(snapshot_time)
        self.poll_seconds = max(int(poll_seconds), 5)
        self.output_dir = Path(output_dir)
        self.debug_dir = Path(debug_dir)
        self.timeout_seconds = max(int(timeout_seconds), 1)
        self.source_mode = (source_mode or "camera").strip().lower()
        self.simulation_dir = Path(simulation_dir)
        self.archive_enabled = bool(archive_enabled)
        self.force_light_off = bool(force_light_off)
        self.light_settle_seconds = max(float(light_settle_seconds), 0.0)
        self._stop_event = threading.Event()
        self._thread = None
        self._lock = threading.RLock()
        self._latest_debug_info = None
        self._latest_debug_assets = {}

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._ensure_indexes()
            if self.archive_enabled:
                self.output_dir.mkdir(parents=True, exist_ok=True)
            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="daily-image-scheduler",
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

        thread.join(timeout=self.poll_seconds + self.timeout_seconds + 1)

    def get_latest_analysis(self):
        return self.collection.find_one(sort=[("timestamp", -1)])

    def get_latest_debug_info(self):
        with self._lock:
            if self._latest_debug_info is not None:
                return self._latest_debug_info

            return self._hydrate_debug_from_latest_document()

    def get_latest_debug_asset(self, asset_name: str):
        with self._lock:
            if asset_name in self._latest_debug_assets:
                return self._latest_debug_assets.get(asset_name)

            self._hydrate_debug_from_latest_document()
            return self._latest_debug_assets.get(asset_name)

    def analyze_now(self, captured_at: datetime | None = None, archive_daily: bool = False):
        with self._lock:
            local_now = captured_at or datetime.now(self.timezone)
            if local_now.tzinfo is None:
                local_now = local_now.replace(tzinfo=self.timezone)
            else:
                local_now = local_now.astimezone(self.timezone)

            frame_bytes, cycle_context, source_context, restore_light = self._read_analysis_frame(local_now)
            analysis = None

            try:
                analysis = analyze_green_coverage_bytes(frame_bytes)
            finally:
                if restore_light:
                    try:
                        light_on()
                        source_context["light_restored_after_capture"] = True
                        print("[daily-image] เปิดไฟกลับหลังถ่ายภาพเสร็จแล้ว")
                    except Exception as exc:
                        source_context["light_restored_after_capture"] = False
                        source_context["light_restore_error"] = str(exc)
                        print(f"[daily-image] เปิดไฟกลับไม่สำเร็จ: {exc}")

            latest_debug = self._store_latest_debug_assets(local_now, analysis, source_context)
            self._latest_debug_info = latest_debug

            latest_document = self._upsert_analysis_record(
                local_now,
                analysis,
                cycle_context,
                source_context,
            )

            return {
                "captured_at": local_now,
                "green_coverage_percent": analysis["green_coverage_percent"],
                "green_pixels": analysis["green_pixels"],
                "total_pixels": analysis["total_pixels"],
                "coverage_method": analysis["coverage_method"],
                "coverage_roi": analysis["roi"],
                "coverage_thresholds": analysis["thresholds"],
                "source": source_context,
                "debug": latest_debug,
                "image_analysis": latest_document,
            }

    def capture_now(self, captured_at: datetime | None = None):
        result = self.analyze_now(captured_at=captured_at, archive_daily=self.archive_enabled)
        return result["image_analysis"]

    def _normalize_snapshot_time(self, raw_value: str):
        return datetime.strptime(raw_value.strip(), "%H:%M").strftime("%H:%M")

    def _ensure_indexes(self):
        self.collection.create_index("timestamp", name="image_analysis_timestamp_idx")
        self.collection.create_index("date", name="image_analysis_date_uidx", unique=True)

    def _has_capture_for_date(self, date_key: str):
        return self.collection.count_documents({"date": date_key}, limit=1) > 0

    def _read_analysis_frame(self, local_now: datetime):
        active_cycle = get_active_cycle(
            self.grow_cycle_collection,
            at_time=local_now,
            timezone_name=self.timezone_name,
        )
        cycle_context = build_cycle_context(
            active_cycle,
            local_now,
            self.timezone_name,
        )

        if self.source_mode == "dataset":
            if not cycle_context:
                raise RuntimeError(
                    "cannot select simulation image without an active grow cycle"
                )

            selected_image = pick_simulation_image(
                self.simulation_dir,
                cycle_context.get("cycle_day_index") or 1,
            )
            return (
                selected_image["path"].read_bytes(),
                cycle_context,
                {
                    "source_mode": "dataset",
                    "source_label": selected_image["filename"],
                    "source_path": str(selected_image["path"]),
                    "cycle_day_index": cycle_context.get("cycle_day_index"),
                    "selected_from": selected_image["selected_from"],
                    "requested_day_index": selected_image["requested_day_index"],
                    "light_was_on_before_capture": None,
                    "light_forced_off_for_capture": False,
                    "light_restored_after_capture": False,
                    "light_settle_seconds": 0.0,
                },
                False,
            )

        light_status = get_light_status()
        light_was_on = bool(light_status.get("is_on"))
        restore_light = False

        source_context = {
            "source_mode": "camera",
            "source_label": CAMERA_DEVICE,
            "source_path": CAMERA_DEVICE,
            "cycle_day_index": cycle_context.get("cycle_day_index"),
            "selected_from": "live_camera",
            "requested_day_index": cycle_context.get("cycle_day_index"),
            "light_was_on_before_capture": light_was_on,
            "light_forced_off_for_capture": False,
            "light_restored_after_capture": False,
            "light_settle_seconds": 0.0,
        }

        if self.force_light_off and light_was_on:
            print("[daily-image] ตรวจพบว่าไฟเปิดอยู่ จึงปิดไฟชั่วคราวก่อนถ่ายภาพ")
            light_off()
            restore_light = True
            source_context["light_forced_off_for_capture"] = True
            source_context["light_settle_seconds"] = self.light_settle_seconds
            if self.light_settle_seconds > 0:
                time.sleep(self.light_settle_seconds)

        frame_bytes = get_latest_frame_bytes(timeout_seconds=self.timeout_seconds)
        if frame_bytes is None:
            raise RuntimeError("cannot capture snapshot from camera")

        return (
            frame_bytes,
            cycle_context,
            source_context,
            restore_light,
        )

    def _encode_image(self, extension: str, image):
        encoded_ok, buffer = cv2.imencode(extension, image)
        if not encoded_ok:
            raise RuntimeError(f"cannot encode debug asset {extension}")
        return buffer.tobytes()

    def _store_latest_debug_assets(self, local_now: datetime, analysis: dict, source_context: dict):
        raw_bytes = self._encode_image(".jpg", analysis["image"])
        mask_bytes = self._encode_image(".png", analysis["mask_preview_image"])
        overlay_bytes = self._encode_image(".jpg", analysis["overlay_image"])

        self._latest_debug_assets = {
            "raw": {
                "content_type": "image/jpeg",
                "bytes": raw_bytes,
            },
            "mask": {
                "content_type": "image/png",
                "bytes": mask_bytes,
            },
            "overlay": {
                "content_type": "image/jpeg",
                "bytes": overlay_bytes,
            },
        }

        return {
            "captured_at": local_now,
            **source_context,
            "raw_url": "/image-analysis/debug/latest/raw",
            "mask_url": "/image-analysis/debug/latest/mask",
            "overlay_url": "/image-analysis/debug/latest/overlay",
        }

    def _hydrate_debug_from_latest_document(self):
        document = self.get_latest_analysis()
        if not document:
            return None

        source_mode = (document.get("analysis_source_mode") or "").strip().lower()
        source_path = document.get("analysis_source_path")
        if source_mode != "dataset" or not source_path:
            return None

        image_path = Path(source_path)
        if not image_path.exists():
            return None

        try:
            analysis = analyze_green_coverage_bytes(image_path.read_bytes())
        except Exception as exc:
            print(f"[daily-image] สร้าง debug preview จาก dataset เดิมไม่สำเร็จ: {exc}")
            return None

        captured_at = document.get("timestamp")
        if isinstance(captured_at, datetime):
            if captured_at.tzinfo is None:
                captured_at = captured_at.replace(tzinfo=self.timezone)
            else:
                captured_at = captured_at.astimezone(self.timezone)
        else:
            captured_at = datetime.now(self.timezone)

        source_context = {
            "source_mode": source_mode,
            "source_label": document.get("analysis_source_label") or image_path.name,
            "source_path": str(image_path),
            "cycle_day_index": document.get("cycle_day_index"),
            "selected_from": document.get("analysis_source_selected_from"),
            "requested_day_index": document.get("cycle_day_index"),
            "light_was_on_before_capture": document.get("light_was_on_before_capture"),
            "light_forced_off_for_capture": bool(
                document.get("light_forced_off_for_capture")
            ),
            "light_restored_after_capture": bool(
                document.get("light_restored_after_capture")
            ),
            "light_settle_seconds": document.get("light_settle_seconds") or 0.0,
            "light_restore_error": document.get("light_restore_error"),
        }

        self._latest_debug_info = self._store_latest_debug_assets(
            captured_at,
            analysis,
            source_context,
        )
        return self._latest_debug_info

    def _upsert_analysis_record(self, local_now: datetime, analysis: dict, cycle_context: dict, source_context: dict):
        date_key = local_now.strftime("%Y-%m-%d")
        now_utc = datetime.now(timezone.utc)

        self.collection.update_one(
            {"date": date_key},
            {
                "$set": {
                    "date": date_key,
                    "timestamp": local_now,
                    "image_path": None,
                    "mask_path": None,
                    "overlay_path": None,
                    "image_url": None,
                    "mask_url": None,
                    "overlay_url": None,
                    "size_bytes": None,
                    "green_coverage_percent": analysis["green_coverage_percent"],
                    "green_pixels": analysis["green_pixels"],
                    "total_pixels": analysis["total_pixels"],
                    "coverage_method": analysis["coverage_method"],
                    "coverage_roi": analysis["roi"],
                    "coverage_thresholds": analysis["thresholds"],
                    "analysis_source_mode": source_context.get("source_mode"),
                    "analysis_source_label": source_context.get("source_label"),
                    "analysis_source_path": source_context.get("source_path"),
                    "analysis_source_selected_from": source_context.get("selected_from"),
                    "light_was_on_before_capture": source_context.get("light_was_on_before_capture"),
                    "light_forced_off_for_capture": source_context.get("light_forced_off_for_capture"),
                    "light_restored_after_capture": source_context.get("light_restored_after_capture"),
                    "light_settle_seconds": source_context.get("light_settle_seconds"),
                    "light_restore_error": source_context.get("light_restore_error"),
                    **cycle_context,
                    "freshness_class": None,
                    "confidence": None,
                    "model_version": None,
                    "updated_at": now_utc,
                },
                "$setOnInsert": {
                    "created_at": now_utc,
                },
            },
            upsert=True,
        )

        document = self.collection.find_one({"date": date_key})
        summarize_day(
            self.sensor_collection,
            self.collection,
            self.daily_summary_collection,
            self.timezone_name,
            date_key,
        )
        print(
            f"[daily-image] วิเคราะห์ภาพล่าสุดสำหรับวันที่ {date_key} "
            f"coverage={analysis['green_coverage_percent']}% "
            f"source={source_context.get('source_label')}"
        )
        return document

    def _run_loop(self):
        if self.archive_enabled:
            print(
                f"[daily-image] จะวิเคราะห์และ archive รูปทุกวันเวลา {self.snapshot_time} "
                f"ที่ timezone {self.timezone_name}"
            )
        else:
            print(
                f"[daily-image] โหมด {self.source_mode} จะวิเคราะห์ภาพเมื่อถูกเรียกใช้ "
                f"โดยไม่บันทึกรูปลงดิสก์"
            )

        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                print(f"[daily-image] เกิดข้อผิดพลาด: {exc}")

            self._stop_event.wait(self.poll_seconds)

    def _tick(self):
        if not self.archive_enabled:
            return

        local_now = datetime.now(self.timezone)
        date_key = local_now.strftime("%Y-%m-%d")
        current_time = local_now.strftime("%H:%M")

        if current_time < self.snapshot_time:
            return

        if self._has_capture_for_date(date_key):
            return

        self.analyze_now(captured_at=local_now, archive_daily=True)
