import threading
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import cv2

from ai.coverage import analyze_green_coverage_bytes
from ai.daily_summary import summarize_day
from camera.camera import get_latest_frame_bytes
from config import BASE_DIR
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
        self._stop_event = threading.Event()
        self._thread = None
        self._lock = threading.RLock()
        self._latest_debug_info = None

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._ensure_indexes()
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self.debug_dir.mkdir(parents=True, exist_ok=True)
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
        return self._latest_debug_info

    def analyze_now(self, captured_at: datetime | None = None, archive_daily: bool = False):
        with self._lock:
            local_now = captured_at or datetime.now(self.timezone)
            if local_now.tzinfo is None:
                local_now = local_now.replace(tzinfo=self.timezone)
            else:
                local_now = local_now.astimezone(self.timezone)

            frame_bytes = get_latest_frame_bytes(timeout_seconds=self.timeout_seconds)
            if frame_bytes is None:
                raise RuntimeError("cannot capture snapshot from camera")

            analysis = analyze_green_coverage_bytes(frame_bytes)
            latest_debug = self._write_latest_debug_assets(frame_bytes, analysis)
            self._latest_debug_info = {
                "captured_at": local_now,
                **latest_debug,
            }

            daily_archive = None
            if archive_daily:
                daily_archive = self._upsert_daily_archive(local_now, frame_bytes, analysis)

            return {
                "captured_at": local_now,
                "green_coverage_percent": analysis["green_coverage_percent"],
                "green_pixels": analysis["green_pixels"],
                "total_pixels": analysis["total_pixels"],
                "coverage_method": analysis["coverage_method"],
                "coverage_roi": analysis["roi"],
                "coverage_thresholds": analysis["thresholds"],
                "debug": latest_debug,
                "daily_archive": daily_archive,
            }

    def capture_now(self, captured_at: datetime | None = None):
        result = self.analyze_now(captured_at=captured_at, archive_daily=True)
        return result["daily_archive"]

    def _normalize_snapshot_time(self, raw_value: str):
        return datetime.strptime(raw_value.strip(), "%H:%M").strftime("%H:%M")

    def _ensure_indexes(self):
        self.collection.create_index("timestamp", name="image_analysis_timestamp_idx")
        self.collection.create_index("date", name="image_analysis_date_uidx", unique=True)

    def _has_capture_for_date(self, date_key: str):
        return self.collection.count_documents({"date": date_key}, limit=1) > 0

    def _write_latest_debug_assets(self, frame_bytes: bytes, analysis: dict):
        latest_dir = self.debug_dir / "latest"
        latest_dir.mkdir(parents=True, exist_ok=True)

        raw_path = latest_dir / "raw.jpg"
        mask_path = latest_dir / "mask.png"
        overlay_path = latest_dir / "overlay.jpg"

        raw_path.write_bytes(frame_bytes)
        cv2.imwrite(str(mask_path), analysis["mask_preview_image"])
        cv2.imwrite(str(overlay_path), analysis["overlay_image"])

        return {
            "raw_path": str(raw_path),
            "mask_path": str(mask_path),
            "overlay_path": str(overlay_path),
            "raw_url": self._path_to_data_url(raw_path),
            "mask_url": self._path_to_data_url(mask_path),
            "overlay_url": self._path_to_data_url(overlay_path),
        }

    def _upsert_daily_archive(self, local_now: datetime, frame_bytes: bytes, analysis: dict):
        date_key = local_now.strftime("%Y-%m-%d")
        base_name = local_now.strftime("%Y-%m-%d_%H-%M-%S")
        image_path = self.output_dir / f"{base_name}.jpg"
        mask_path = self.output_dir / f"{base_name}.mask.png"
        overlay_path = self.output_dir / f"{base_name}.overlay.jpg"
        now_utc = datetime.now(timezone.utc)
        existing_document = self.collection.find_one({"date": date_key})
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

        image_path.write_bytes(frame_bytes)
        cv2.imwrite(str(mask_path), analysis["mask_preview_image"])
        cv2.imwrite(str(overlay_path), analysis["overlay_image"])

        self.collection.update_one(
            {"date": date_key},
            {
                "$set": {
                    "date": date_key,
                    "timestamp": local_now,
                    "image_path": str(image_path),
                    "mask_path": str(mask_path),
                    "overlay_path": str(overlay_path),
                    "image_url": self._path_to_data_url(image_path),
                    "mask_url": self._path_to_data_url(mask_path),
                    "overlay_url": self._path_to_data_url(overlay_path),
                    "size_bytes": len(frame_bytes),
                    "green_coverage_percent": analysis["green_coverage_percent"],
                    "green_pixels": analysis["green_pixels"],
                    "total_pixels": analysis["total_pixels"],
                    "coverage_method": analysis["coverage_method"],
                    "coverage_roi": analysis["roi"],
                    "coverage_thresholds": analysis["thresholds"],
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
        self._cleanup_replaced_archive_files(
            existing_document,
            image_path,
            mask_path,
            overlay_path,
        )
        print(
            f"[daily-image] บันทึก raw archive สำหรับวันที่ {date_key} "
            f"coverage={analysis['green_coverage_percent']}%"
        )
        return document

    def _path_to_data_url(self, path: Path):
        try:
            relative_path = path.resolve().relative_to((BASE_DIR / "data").resolve())
        except ValueError:
            return None

        return f"/data/{relative_path.as_posix()}"

    def _cleanup_replaced_archive_files(
        self,
        existing_document,
        image_path: Path,
        mask_path: Path,
        overlay_path: Path,
    ):
        if existing_document is None:
            return

        replacements = {
            "image_path": image_path,
            "mask_path": mask_path,
            "overlay_path": overlay_path,
        }

        for field_name, new_path in replacements.items():
            old_value = existing_document.get(field_name)
            if not old_value:
                continue

            old_path = Path(old_value)
            if old_path == new_path or not old_path.exists():
                continue

            old_path.unlink(missing_ok=True)

    def _run_loop(self):
        print(
            f"[daily-image] จะ archive รูปทุกวันเวลา {self.snapshot_time} "
            f"ที่ timezone {self.timezone_name}"
        )

        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                print(f"[daily-image] เกิดข้อผิดพลาด: {exc}")

            self._stop_event.wait(self.poll_seconds)

    def _tick(self):
        local_now = datetime.now(self.timezone)
        date_key = local_now.strftime("%Y-%m-%d")
        current_time = local_now.strftime("%H:%M")

        if current_time < self.snapshot_time:
            return

        if self._has_capture_for_date(date_key):
            return

        self.analyze_now(captured_at=local_now, archive_daily=True)
