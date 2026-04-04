import asyncio
import csv
import io
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import cv2
from ai.daily_summary import ensure_daily_summary_indexes, summarize_day
from ai.coverage import analyze_green_coverage_bytes
from ai.export_training_dataset import export_training_dataset
from ai.feature_builder import build_harvest_feature_bundle
from ai.import_seed_readings_to_mongo import import_seed_readings
from ai.seed_image_series_to_mongo import generate_readings_template
from ai.predictions import (
    HARVEST_PREDICTION_TYPE,
    assess_harvest_prediction_readiness,
    build_model_prediction_run,
    build_stub_prediction_run,
    ensure_prediction_indexes,
    get_latest_prediction_run,
    list_prediction_runs,
    store_prediction_run,
)
from automation.anomaly_watch import AnomalyWatcher
from automation.daily_capture import DailyImageScheduler
from automation.scheduler import AutomationScheduler
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from pymongo import MongoClient
from grow_cycle import (
    ensure_grow_cycle_indexes,
    get_active_cycle,
    harvest_active_cycle,
    list_cycles,
    start_cycle,
)

from actuators.ligth import get_light_status, light_off, light_on
from actuators.pump_fertilizer_control import (
    get_pump_fertilizer_status,
    run_fertilizer_pump,
    stop_fertilizer_pump as stop_fertilizer_pump_by_id,
)
from actuators.pump_water_control import (
    get_pump_water_status,
    run_pump_water,
    stop_pump_water,
)
from config import (
    ANOMALY_ALERT_COLLECTION,
    ANOMALY_COOLDOWN_SECONDS,
    ANOMALY_DIFF_THRESHOLD,
    ANOMALY_MIN_AREA_PERCENT,
    ANOMALY_OUTPUT_DIR,
    ANOMALY_PERSIST_FRAMES,
    ANOMALY_POLL_SECONDS,
    ANOMALY_WATCH_ENABLED,
    ANOMALY_WEBHOOK_URL,
    APP_TIMEZONE,
    AUTOMATION_COLLECTION,
    AUTOMATION_POLL_SECONDS,
    CORS_ALLOW_ORIGINS,
    DAILY_SUMMARY_COLLECTION,
    DEFAULT_GROW_CYCLE_DAYS,
    DEBUG_OUTPUT_DIR,
    FERTILIZER_DOSE_ML_PER_10L,
    FERTILIZER_PUMP_FLOW_ML_PER_MIN,
    GROW_CYCLE_COLLECTION,
    HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L,
    HARVEST_MODEL_DEFAULT_LIGHT_LUX,
    HARVEST_MODEL_ENABLED,
    HARVEST_MODEL_METRICS_PATH,
    HARVEST_MODEL_PATH,
    HARVEST_MODEL_PH_OPTIMAL,
    IMAGE_ANALYSIS_COLLECTION,
    IMAGE_ANALYSIS_ARCHIVE_ENABLED,
    IMAGE_ANALYSIS_FORCE_LIGHT_OFF,
    IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS,
    IMAGE_ANALYSIS_SIMULATION_DIR,
    IMAGE_ANALYSIS_SOURCE_MODE,
    IMAGE_OUTPUT_DIR,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
    PREDICTION_COLLECTION,
    PREDICTION_LOOKBACK_DAYS,
    PREDICTION_SENSOR_LIMIT,
    PUBLIC_BASE_URL,
    SENSOR_INTERVAL_SECONDS,
    SNAPSHOT_POLL_SECONDS,
    SNAPSHOT_TIME,
    SNAPSHOT_TIMEOUT_SECONDS,
    WATER_PUMP_FLOW_L_PER_MIN,
)
from camera.camera import gen_frames, get_camera_status, get_latest_frame_bytes

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "frontend", "dist")
FRONTEND_ASSETS_DIR = os.path.join(FRONTEND_DIST_DIR, "assets")
FRONTEND_INDEX_PATH = os.path.join(FRONTEND_DIST_DIR, "index.html")
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_EXPORT_DIR = os.path.join(DATA_DIR, "exports", "model_training")
MODEL_UPLOAD_DIR = os.path.join(MODEL_EXPORT_DIR, "uploads")
TRAINING_DATASET_PATH = os.path.join(MODEL_EXPORT_DIR, "harvest_training_dataset.csv")
TEMPLATE_DATASET_PATH = os.path.join(
    MODEL_EXPORT_DIR,
    "image_seed_readings_template.csv",
)

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODEL_EXPORT_DIR, exist_ok=True)
os.makedirs(MODEL_UPLOAD_DIR, exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/assets",
    StaticFiles(directory=FRONTEND_ASSETS_DIR),
    name="frontend-assets",
)
app.mount("/data", StaticFiles(directory=DATA_DIR), name="analysis-data")

mongo = MongoClient(MONGO_URI, tz_aware=True)
db = mongo[MONGO_DB]
collection = db[MONGO_COLLECTION]
image_analysis_collection = db[IMAGE_ANALYSIS_COLLECTION]
daily_summary_collection = db[DAILY_SUMMARY_COLLECTION]
grow_cycle_collection = db[GROW_CYCLE_COLLECTION]
prediction_collection = db[PREDICTION_COLLECTION]
automation_collection = db[AUTOMATION_COLLECTION]
anomaly_alert_collection = db[ANOMALY_ALERT_COLLECTION]
ensure_daily_summary_indexes(daily_summary_collection)
ensure_grow_cycle_indexes(grow_cycle_collection)
ensure_prediction_indexes(prediction_collection)
automation_scheduler = AutomationScheduler(
    automation_collection,
    APP_TIMEZONE,
    AUTOMATION_POLL_SECONDS,
)
daily_image_scheduler = DailyImageScheduler(
    image_analysis_collection,
    collection,
    daily_summary_collection,
    grow_cycle_collection,
    APP_TIMEZONE,
    SNAPSHOT_TIME,
    SNAPSHOT_POLL_SECONDS,
    IMAGE_OUTPUT_DIR,
    DEBUG_OUTPUT_DIR,
    SNAPSHOT_TIMEOUT_SECONDS,
    IMAGE_ANALYSIS_SOURCE_MODE,
    IMAGE_ANALYSIS_SIMULATION_DIR,
    IMAGE_ANALYSIS_ARCHIVE_ENABLED,
    IMAGE_ANALYSIS_FORCE_LIGHT_OFF,
    IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS,
)
anomaly_watcher = AnomalyWatcher(
    anomaly_alert_collection,
    APP_TIMEZONE,
    ANOMALY_POLL_SECONDS,
    ANOMALY_OUTPUT_DIR,
    DATA_DIR,
    PUBLIC_BASE_URL,
    ANOMALY_WATCH_ENABLED,
    ANOMALY_WEBHOOK_URL,
    ANOMALY_MIN_AREA_PERCENT,
    ANOMALY_PERSIST_FRAMES,
    ANOMALY_COOLDOWN_SECONDS,
    ANOMALY_DIFF_THRESHOLD,
)
_live_camera_analysis_lock = threading.RLock()
_live_camera_analysis_preview = None
_live_camera_analysis_assets = {}
_live_camera_analysis_cached_at = 0.0
_LIVE_CAMERA_ANALYSIS_CACHE_SECONDS = 3.0


class PumpWaterRequest(BaseModel):
    duration_seconds: float | None = None
    water_liters: float | None = None


class PumpFertilizerRequest(BaseModel):
    duration_seconds: float | None = None
    water_liters: float | None = None


class AutomationBaseRequest(BaseModel):
    days: list[str] | None = None
    enabled: bool = True
    start_date: str | None = None
    end_date: str | None = None


class LightAutomationRequest(AutomationBaseRequest):
    on_time: str
    off_time: str


class PumpWaterAutomationRequest(AutomationBaseRequest):
    start_time: str
    duration_seconds: float | None = None
    water_liters: float | None = None


class AutomationRuleEnabledRequest(BaseModel):
    enabled: bool


class GrowCycleStartRequest(BaseModel):
    name: str | None = None
    planted_at: str | None = None
    target_harvest_days: int = DEFAULT_GROW_CYCLE_DAYS
    notes: str | None = None


class GrowCycleHarvestRequest(BaseModel):
    harvested_at: str | None = None
    notes: str | None = None


class HarvestPredictionRequest(BaseModel):
    lookback_days: int = PREDICTION_LOOKBACK_DAYS
    sensor_limit: int = PREDICTION_SENSOR_LIMIT


class TimeseriesCapturePolicyRequest(BaseModel):
    mode: str
    light_settle_seconds: float | None = None


class AnomalyWatchConfigRequest(BaseModel):
    enabled: bool | None = None
    webhook_url: str | None = None
    min_area_percent: float | None = None
    persist_frames: int | None = None
    cooldown_seconds: int | None = None
    poll_seconds: int | None = None
    diff_threshold: int | None = None


class ModelDataImportRequest(BaseModel):
    cycle_id: str
    csv_text: str
    filename: str | None = None
    skip_blank_rows: bool = True


class TimeseriesGapImportRequest(BaseModel):
    cycle_id: str
    csv_text: str
    filename: str | None = None
    skip_blank_rows: bool = True


def serialize_document(document):
    if document is None:
        return None

    serialized = dict(document)
    serialized["_id"] = str(serialized["_id"])
    return serialized


def serialize_anomaly_alert(document):
    serialized = serialize_document(document)
    if serialized is None:
        return None

    for key in (
        "raw_path",
        "overlay_path",
        "diff_path",
        "raw_url",
        "overlay_url",
        "diff_url",
    ):
        serialized.pop(key, None)
    return serialized


def get_fertilizer_dosing_config():
    dose_ml_per_liter = FERTILIZER_DOSE_ML_PER_10L / 10.0
    flow_ml_per_second = FERTILIZER_PUMP_FLOW_ML_PER_MIN / 60.0
    seconds_per_liter = None

    if flow_ml_per_second > 0:
        seconds_per_liter = round(dose_ml_per_liter / flow_ml_per_second, 2)

    return {
        "pump_flow_ml_per_min": round(FERTILIZER_PUMP_FLOW_ML_PER_MIN, 4),
        "dose_ml_per_10l": round(FERTILIZER_DOSE_ML_PER_10L, 4),
        "dose_ml_per_liter": round(dose_ml_per_liter, 4),
        "seconds_per_liter": seconds_per_liter,
    }


def get_water_pump_dosing_config():
    seconds_per_liter = None
    if WATER_PUMP_FLOW_L_PER_MIN > 0:
        seconds_per_liter = round(60.0 / WATER_PUMP_FLOW_L_PER_MIN, 2)

    return {
        "pump_flow_l_per_min": round(WATER_PUMP_FLOW_L_PER_MIN, 4),
        "seconds_per_liter": seconds_per_liter,
    }


def resolve_water_pump_duration_seconds(payload: PumpWaterRequest | PumpWaterAutomationRequest):
    if payload.water_liters is not None:
        water_liters = float(payload.water_liters)
        if water_liters <= 0:
            raise ValueError("water_liters must be greater than 0")
        if WATER_PUMP_FLOW_L_PER_MIN <= 0:
            raise ValueError("WATER_PUMP_FLOW_L_PER_MIN must be greater than 0")
        duration_seconds = water_liters / (WATER_PUMP_FLOW_L_PER_MIN / 60.0)
        return round(duration_seconds, 2), round(water_liters, 3)

    if payload.duration_seconds is not None:
        duration_seconds = float(payload.duration_seconds)
        if duration_seconds <= 0:
            raise ValueError("duration_seconds must be greater than 0")
        water_liters = (
            round(duration_seconds * (WATER_PUMP_FLOW_L_PER_MIN / 60.0), 3)
            if WATER_PUMP_FLOW_L_PER_MIN > 0
            else None
        )
        return duration_seconds, water_liters

    raise ValueError("water_liters or duration_seconds is required")


def resolve_fertilizer_duration_seconds(payload: PumpFertilizerRequest):
    if payload.water_liters is not None:
        water_liters = float(payload.water_liters)
        if water_liters <= 0:
            raise ValueError("water_liters must be greater than 0")
        if FERTILIZER_DOSE_ML_PER_10L <= 0:
            raise ValueError("FERTILIZER_DOSE_ML_PER_10L must be greater than 0")
        if FERTILIZER_PUMP_FLOW_ML_PER_MIN <= 0:
            raise ValueError("FERTILIZER_PUMP_FLOW_ML_PER_MIN must be greater than 0")

        dose_ml = water_liters * (FERTILIZER_DOSE_ML_PER_10L / 10.0)
        duration_seconds = dose_ml / (FERTILIZER_PUMP_FLOW_ML_PER_MIN / 60.0)
        return round(duration_seconds, 2)

    if payload.duration_seconds is not None:
        duration_seconds = float(payload.duration_seconds)
        if duration_seconds <= 0:
            raise ValueError("duration_seconds must be greater than 0")
        return duration_seconds

    raise ValueError("water_liters or duration_seconds is required")


def _validation_error_to_message(exc: ValidationError) -> str:
    return "; ".join(
        error.get("msg", "invalid request")
        for error in exc.errors()
    ) or "invalid request"


async def _parse_request_model(
    request: Request,
    model_class: type[BaseModel],
    query_fields: tuple[str, ...] = (),
):
    payload = {}
    content_type = (request.headers.get("content-type") or "").lower()

    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        for key, value in form.multi_items():
            if value in ("", None):
                continue
            if key == "days":
                payload.setdefault("days", []).append(value)
                continue
            payload[key] = value
    else:
        body = await request.body()
        if body:
            try:
                decoded = json.loads(body)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=400, detail="invalid JSON body") from exc
            if not isinstance(decoded, dict):
                raise HTTPException(status_code=400, detail="request body must be a JSON object")
            payload.update(decoded)

    for field_name in query_fields:
        if field_name in payload:
            continue
        value = request.query_params.get(field_name)
        if value not in (None, ""):
            payload[field_name] = value

    if "days" not in payload:
        days = request.query_params.getlist("days")
        if days:
            payload["days"] = days

    try:
        if hasattr(model_class, "model_validate"):
            return model_class.model_validate(payload)
        return model_class.parse_obj(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail=_validation_error_to_message(exc),
        ) from exc


def get_latest_document():
    return collection.find_one(sort=[("_id", -1)])


def get_latest_image_analysis():
    return daily_image_scheduler.get_latest_analysis()


def get_latest_image_analysis_debug():
    return daily_image_scheduler.get_latest_debug_info()


def get_latest_daily_summary():
    return daily_summary_collection.find_one(sort=[("date", -1)])


def get_active_grow_cycle():
    return get_active_cycle(grow_cycle_collection, timezone_name=APP_TIMEZONE)


def get_latest_prediction_document():
    return get_latest_prediction_run(prediction_collection)


def get_latest_seed_cycle_document():
    return grow_cycle_collection.find_one(
        {
            "cycle_id": {
                "$regex": r"^seed_cycle_",
            }
        },
        sort=[("planted_at", -1)],
    )


def get_grow_cycle_history(limit: int = 20):
    safe_limit = max(min(int(limit), 120), 1)
    return [serialize_document(item) for item in list_cycles(grow_cycle_collection, safe_limit)]


def get_prediction_history(limit: int = 20):
    safe_limit = max(min(int(limit), 120), 1)
    return [
        serialize_document(item)
        for item in list_prediction_runs(prediction_collection, limit=safe_limit)
    ]


def get_sensor_history(limit: int = 48):
    safe_limit = max(min(int(limit), 400), 1)
    data = list(collection.find().sort([("_id", -1)]).limit(safe_limit))
    return [serialize_document(item) for item in reversed(data)]


def get_daily_summary_history(limit: int = 14):
    safe_limit = max(min(int(limit), 90), 1)
    data = list(daily_summary_collection.find().sort([("date", -1)]).limit(safe_limit))
    return [serialize_document(item) for item in data]


def get_actuator_status():
    return {
        "light": get_light_status(),
        "pump_water": get_pump_water_status(),
        "pump_fertilizer": get_pump_fertilizer_status(),
    }


def get_grouped_automation_rules():
    grouped = {
        "timezone": APP_TIMEZONE,
        "light": [],
        "pump_water": [],
    }

    for rule in automation_scheduler.get_rules():
        device = rule.get("device")
        if device in grouped:
            grouped[device].append(rule)

    return grouped


def get_latest_anomaly_alert():
    return serialize_anomaly_alert(anomaly_watcher.get_latest_alert())


def get_anomaly_alert_history(limit: int = 1):
    return [serialize_anomaly_alert(item) for item in anomaly_watcher.list_alerts(limit)]


def build_anomaly_watch_state():
    latest_alert = get_latest_anomaly_alert()
    preview_token = anomaly_watcher.get_latest_preview_token()
    preview_url = "/anomaly-watch/latest-preview" if preview_token else None
    return {
        "status": anomaly_watcher.get_status(),
        "latest_alert": latest_alert,
        "latest_preview_url": preview_url,
        "latest_preview_token": preview_token,
    }


def _coerce_optional_float(value):
    raw = str(value or "").strip()
    if raw == "":
        return None
    return float(raw)


def _parse_gap_timestamp(value, timezone_name: str):
    raw = str(value or "").strip()
    if raw == "":
        return None

    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(ZoneInfo(timezone_name))


def import_timeseries_gap_csv(
    csv_text: str,
    cycle_id: str,
    timezone_name: str = APP_TIMEZONE,
    skip_blank_rows: bool = True,
):
    cycle_document = grow_cycle_collection.find_one({"cycle_id": cycle_id})
    if cycle_document is None:
        raise ValueError(f"cycle not found: {cycle_id}")

    rows_created = 0
    rows_updated = 0
    affected_dates = set()
    reader = csv.DictReader(io.StringIO(csv_text))

    for row in reader:
        observed_at = _parse_gap_timestamp(
            row.get("timestamp_local") or row.get("timestamp"),
            timezone_name,
        )
        if observed_at is None:
            continue

        temp_value = _coerce_optional_float(row.get("temp"))
        ph_value = _coerce_optional_float(row.get("ph"))
        if skip_blank_rows and temp_value is None and ph_value is None:
            continue

        cycle_context = build_cycle_context(
            cycle_document,
            observed_at,
            timezone_name,
        )
        payload = {
            "timestamp": observed_at,
            "temp": temp_value,
            "ph": ph_value,
            "data_source": "manual_timeseries_gap_import",
            **cycle_context,
        }
        existing_document = collection.find_one(
            {
                "cycle_id": cycle_id,
                "timestamp": observed_at,
            }
        )

        if existing_document is None:
            collection.insert_one(payload)
            rows_created += 1
        else:
            collection.update_one(
                {"_id": existing_document["_id"]},
                {"$set": payload},
            )
            rows_updated += 1

        affected_dates.add(
            observed_at.astimezone(ZoneInfo(timezone_name)).strftime("%Y-%m-%d")
        )

    for date_key in sorted(affected_dates):
        summarize_day(
            collection,
            image_analysis_collection,
            daily_summary_collection,
            timezone_name,
            date_key,
        )

    return {
        "cycle_id": cycle_id,
        "rows_created": rows_created,
        "rows_updated": rows_updated,
        "affected_dates": sorted(affected_dates),
    }


def get_timeseries_stats():
    now_utc = datetime.now(timezone.utc)
    last_24h = now_utc - timedelta(days=1)
    last_7d = now_utc - timedelta(days=7)
    last_14d = now_utc - timedelta(days=14)

    return {
        "total_rows": collection.count_documents({}),
        "last_24h_rows": collection.count_documents({"timestamp": {"$gte": last_24h}}),
        "last_7d_rows": collection.count_documents({"timestamp": {"$gte": last_7d}}),
        "last_14d_rows": collection.count_documents({"timestamp": {"$gte": last_14d}}),
    }


def get_dashboard_state():
    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "timezone": APP_TIMEZONE,
        },
        "camera": {
            "stream_url": "/camera/frame",
            "status": get_camera_status(),
        },
        "sensor": serialize_document(get_latest_document()),
        "image_analysis": serialize_document(get_latest_image_analysis()),
        "image_analysis_debug": get_latest_image_analysis_debug(),
        "daily_summary": serialize_document(get_latest_daily_summary()),
        "grow_cycle": serialize_document(get_active_grow_cycle()),
        "timeseries": get_timeseries_stats(),
        "prediction_latest": serialize_document(get_latest_prediction_document()),
        "anomaly_watch": build_anomaly_watch_state(),
        "model_data": {
            "latest_seed_cycle_id": (
                get_latest_seed_cycle_document() or {}
            ).get("cycle_id"),
            "sensor_interval_seconds": SENSOR_INTERVAL_SECONDS,
            "training_dataset_download_url": "/model-data/training-dataset/download?allow_missing_sensor=true",
            "template_download_url": "/model-data/template/download",
            "harvest_model_enabled": HARVEST_MODEL_ENABLED,
            "harvest_model_path": HARVEST_MODEL_PATH,
            "timeseries_capture": daily_image_scheduler.get_capture_policy(),
            "water_pump_dosing": get_water_pump_dosing_config(),
            "fertilizer_dosing": get_fertilizer_dosing_config(),
        },
        "actuators": get_actuator_status(),
        "automation": get_grouped_automation_rules(),
    }


def _file_download_response(path: str | Path, download_name: str, media_type: str = "text/csv"):
    return FileResponse(
        str(path),
        media_type=media_type,
        filename=download_name,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


def _encode_preview_asset(extension: str, image):
    encoded_ok, buffer = cv2.imencode(extension, image)
    if not encoded_ok:
        raise RuntimeError(f"cannot encode live analysis asset {extension}")
    return buffer.tobytes()


def build_live_camera_analysis_preview(force_refresh: bool = False):
    global _live_camera_analysis_preview
    global _live_camera_analysis_assets
    global _live_camera_analysis_cached_at

    with _live_camera_analysis_lock:
        now_monotonic = time.monotonic()
        if (
            not force_refresh
            and _live_camera_analysis_preview is not None
            and (now_monotonic - _live_camera_analysis_cached_at)
            <= _LIVE_CAMERA_ANALYSIS_CACHE_SECONDS
        ):
            return _live_camera_analysis_preview

        frame_bytes = get_latest_frame_bytes(
            timeout_seconds=max(float(SNAPSHOT_TIMEOUT_SECONDS), 1.0),
            max_age_seconds=5.0,
        )
        if frame_bytes is None:
            raise RuntimeError("camera snapshot unavailable for live analysis")

        analysis = analyze_green_coverage_bytes(frame_bytes)
        raw_bytes = _encode_preview_asset(".jpg", analysis["roi_preview_image"])
        mask_bytes = _encode_preview_asset(".png", analysis["mask_preview_image"])
        overlay_bytes = _encode_preview_asset(".jpg", analysis["overlay_image"])
        captured_at = datetime.now(ZoneInfo(APP_TIMEZONE))

        _live_camera_analysis_assets = {
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
        _live_camera_analysis_preview = {
            "captured_at": captured_at.isoformat(),
            "green_coverage_percent": analysis["green_coverage_percent"],
            "green_pixels": analysis["green_pixels"],
            "total_pixels": analysis["total_pixels"],
            "coverage_method": analysis["coverage_method"],
            "coverage_version": analysis["coverage_version"],
            "coverage_roi": analysis["roi"],
            "coverage_thresholds": analysis["thresholds"],
            "image_width": analysis["image_width"],
            "image_height": analysis["image_height"],
            "raw_url": "/camera/analysis-preview/raw",
            "mask_url": "/camera/analysis-preview/mask",
            "overlay_url": "/camera/analysis-preview/overlay",
        }
        _live_camera_analysis_cached_at = now_monotonic
        return _live_camera_analysis_preview

@app.on_event("startup")
def startup_event():
    """ตั้งค่าบริการที่ต้องทำตอน API เริ่มทำงาน"""
    print("API จะอ่านค่าล่าสุดจาก MongoDB โดยไม่จับ hardware โดยตรง")
    print("dashboard ใหม่จะถูกเสิร์ฟผ่านหน้าเว็บที่ /")
    print("หน้า dashboard จะดึงภาพกล้องแบบ snapshot refresh ผ่าน /camera/frame")
    print("MJPEG stream เดิมยังเปิดใช้ได้ที่ /video")
    print("image analysis และ green coverage พร้อมใช้งานแล้ว")
    if IMAGE_ANALYSIS_FORCE_LIGHT_OFF:
        print(
            "image analysis จะปิดไฟชั่วคราวก่อนถ่ายภาพ "
            f"และรอ {IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS} วินาที"
        )
    print("raw/mask/overlay preview ล่าสุดเปิดดูได้ผ่าน /image-analysis/debug/latest/*")
    print("actuator controls พร้อมใช้งานที่ /actuators/*")
    print("automation schedule พร้อมใช้งานที่ /automation/*")
    print(
        "anomaly watcher พร้อมใช้งานที่ /anomaly-watch/* "
        f"(enabled={ANOMALY_WATCH_ENABLED})"
    )
    automation_scheduler.start()
    daily_image_scheduler.start()
    anomaly_watcher.start()
    summarize_day(
        collection,
        image_analysis_collection,
        daily_summary_collection,
        APP_TIMEZONE,
        datetime.now(ZoneInfo(APP_TIMEZONE)).strftime("%Y-%m-%d"),
    )


@app.on_event("shutdown")
def shutdown_event():
    automation_scheduler.stop()
    daily_image_scheduler.stop()
    anomaly_watcher.stop()

# ----------------- API Endpoints -----------------

@app.get("/")
def serve_dashboard():
    """หน้าหลักของ frontend ใหม่"""
    if os.path.exists(FRONTEND_INDEX_PATH):
        return FileResponse(
            FRONTEND_INDEX_PATH,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )

    return {
        "error": "ไม่พบไฟล์ dashboard",
        "looked_at": [FRONTEND_INDEX_PATH],
    }

@app.get("/latest")
def get_latest():
    latest = serialize_document(get_latest_document())
    if latest is None:
        return []
    return [latest]

@app.get("/history")
def get_history(limit: int = 50):
    return get_sensor_history(limit)

@app.get("/temperature")
def get_temperature():
    latest = get_latest_document()
    return {"temperature": 0.0 if latest is None else latest.get("temp", 0.0)}

@app.get("/actuators/status")
def actuator_status():
    return get_actuator_status()

@app.get("/dashboard-state")
def dashboard_state():
    return get_dashboard_state()

@app.get("/image-analysis/latest")
def latest_image_analysis():
    return {"image_analysis": serialize_document(get_latest_image_analysis())}


@app.get("/daily-summary/latest")
def latest_daily_summary():
    return {"daily_summary": serialize_document(get_latest_daily_summary())}


@app.get("/daily-summary/history")
def daily_summary_history(limit: int = 14):
    return {"items": get_daily_summary_history(limit)}


@app.post("/daily-summary/rebuild")
def rebuild_daily_summary(date: str | None = None):
    target_date = date or datetime.now(ZoneInfo(APP_TIMEZONE)).strftime("%Y-%m-%d")
    document = summarize_day(
        collection,
        image_analysis_collection,
        daily_summary_collection,
        APP_TIMEZONE,
        target_date,
    )
    return {"daily_summary": serialize_document(document)}


@app.get("/sensor-history")
def sensor_history(limit: int = 48):
    return {"items": get_sensor_history(limit)}

@app.get("/image-analysis/debug/latest")
def latest_image_analysis_debug():
    return {"debug": get_latest_image_analysis_debug()}


@app.get("/image-analysis/debug/latest/{asset_name}")
def latest_image_analysis_debug_asset(asset_name: str):
    asset = daily_image_scheduler.get_latest_debug_asset(asset_name)
    if asset is None:
        raise HTTPException(status_code=404, detail="debug asset not found")

    return Response(
        content=asset["bytes"],
        media_type=asset["content_type"],
    )

@app.post("/image-analysis/analyze-now")
def analyze_image_now():
    try:
        result = daily_image_scheduler.analyze_now()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "analysis": {
            **result,
            "image_analysis": serialize_document(result.get("image_analysis")),
        }
    }

@app.post("/image-analysis/capture-now")
def capture_image_now():
    try:
        document = daily_image_scheduler.capture_now()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"image_analysis": serialize_document(document)}


@app.get("/timeseries/capture-policy")
def timeseries_capture_policy():
    return {"capture_policy": daily_image_scheduler.get_capture_policy()}


@app.patch("/timeseries/capture-policy")
def update_timeseries_capture_policy(payload: TimeseriesCapturePolicyRequest):
    try:
        policy = daily_image_scheduler.set_capture_policy(
            mode=payload.mode,
            light_settle_seconds=payload.light_settle_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"capture_policy": policy}


@app.get("/anomaly-watch/status")
def anomaly_watch_status():
    snapshot = build_anomaly_watch_state()
    return {
        "watcher": snapshot["status"],
        "latest_alert": snapshot["latest_alert"],
        "latest_preview_url": snapshot["latest_preview_url"],
        "latest_preview_token": snapshot["latest_preview_token"],
    }


@app.patch("/anomaly-watch/config")
def update_anomaly_watch_config(payload: AnomalyWatchConfigRequest):
    try:
        status = anomaly_watcher.set_config(
            enabled=payload.enabled,
            webhook_url=payload.webhook_url,
            min_area_percent=payload.min_area_percent,
            persist_frames=payload.persist_frames,
            cooldown_seconds=payload.cooldown_seconds,
            poll_seconds=payload.poll_seconds,
            diff_threshold=payload.diff_threshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"watcher": status}


@app.post("/anomaly-watch/reset-baseline")
def reset_anomaly_watch_baseline():
    return {"watcher": anomaly_watcher.reset_baselines()}


@app.get("/anomaly-alerts")
def anomaly_alerts(limit: int = 1):
    return {"items": get_anomaly_alert_history(limit)}


@app.get("/anomaly-watch/latest-preview")
def anomaly_watch_latest_preview():
    asset = anomaly_watcher.get_latest_preview_asset()
    if asset is None:
        raise HTTPException(status_code=404, detail="anomaly preview not found")

    return Response(
        content=asset["bytes"],
        media_type=asset["content_type"],
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


@app.get("/model-data/template/download")
def download_model_data_template():
    try:
        output_path = generate_readings_template(
            IMAGE_ANALYSIS_SIMULATION_DIR,
            TEMPLATE_DATASET_PATH,
            APP_TIMEZONE,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _file_download_response(
        output_path,
        os.path.basename(str(output_path)),
    )


@app.get("/model-data/training-dataset/download")
def download_training_dataset(
    cycle_id: str | None = None,
    include_active: bool = False,
    allow_missing_sensor: bool = True,
):
    try:
        export_meta = export_training_dataset(
            TRAINING_DATASET_PATH,
            cycle_id=cycle_id,
            include_active=include_active,
            allow_missing_sensor=allow_missing_sensor,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    response = _file_download_response(
        TRAINING_DATASET_PATH,
        os.path.basename(TRAINING_DATASET_PATH),
    )
    response.headers["X-Exported-Rows"] = str(export_meta["rows_exported"])
    response.headers["X-Ready-Rows"] = str(export_meta["rows_ready_for_training"])
    response.headers["X-Cycle-Count"] = str(export_meta["cycle_count"])
    return response


@app.post("/model-data/template/import")
def import_model_data_template(payload: ModelDataImportRequest):
    cycle_id = (payload.cycle_id or "").strip()
    csv_text = payload.csv_text or ""
    if not cycle_id:
        raise HTTPException(status_code=400, detail="cycle_id is required")
    if not csv_text.strip():
        raise HTTPException(status_code=400, detail="csv_text is required")

    safe_name = Path(payload.filename or "uploaded_seed_readings.csv").name
    timestamp_label = datetime.now(ZoneInfo(APP_TIMEZONE)).strftime("%Y%m%d_%H%M%S")
    target_path = Path(MODEL_UPLOAD_DIR) / f"{timestamp_label}_{safe_name}"
    target_path.write_text(csv_text, encoding="utf-8")

    try:
        result = import_seed_readings(
            input_csv=target_path,
            cycle_id=cycle_id,
            timezone_name=APP_TIMEZONE,
            skip_blank_rows=payload.skip_blank_rows,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "import_result": result,
    }


@app.post("/timeseries/gap-import")
def import_timeseries_gap(payload: TimeseriesGapImportRequest):
    cycle_id = (payload.cycle_id or "").strip()
    csv_text = payload.csv_text or ""
    if not cycle_id:
        raise HTTPException(status_code=400, detail="cycle_id is required")
    if not csv_text.strip():
        raise HTTPException(status_code=400, detail="csv_text is required")

    try:
        result = import_timeseries_gap_csv(
            csv_text=csv_text,
            cycle_id=cycle_id,
            timezone_name=APP_TIMEZONE,
            skip_blank_rows=payload.skip_blank_rows,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "import_result": result,
    }


@app.get("/grow-cycles/active")
def active_grow_cycle():
    return {"grow_cycle": serialize_document(get_active_grow_cycle())}


@app.get("/grow-cycles/history")
def grow_cycle_history(limit: int = 20):
    return {"items": get_grow_cycle_history(limit)}


@app.get("/predictions/latest")
def latest_prediction():
    return {"prediction": serialize_document(get_latest_prediction_document())}


@app.get("/predictions/history")
def prediction_history(limit: int = 20):
    return {"items": get_prediction_history(limit)}


@app.post("/predictions/harvest/preview")
def preview_harvest_prediction(payload: HarvestPredictionRequest):
    try:
        feature_bundle = build_harvest_feature_bundle(
            collection,
            daily_summary_collection,
            image_analysis_collection,
            grow_cycle_collection,
            APP_TIMEZONE,
            lookback_days=payload.lookback_days,
            sensor_limit=payload.sensor_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    readiness = assess_harvest_prediction_readiness(feature_bundle)
    prediction_run = build_model_prediction_run(
        feature_bundle,
        model_path=HARVEST_MODEL_PATH,
        metrics_path=HARVEST_MODEL_METRICS_PATH,
        timezone_name=APP_TIMEZONE,
        default_light_lux=HARVEST_MODEL_DEFAULT_LIGHT_LUX,
        default_fertilizer_mg_l=HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L,
        optimal_ph=HARVEST_MODEL_PH_OPTIMAL,
    ) if HARVEST_MODEL_ENABLED else build_stub_prediction_run(feature_bundle)
    return {
        "prediction_type": HARVEST_PREDICTION_TYPE,
        "readiness": readiness,
        "prediction": prediction_run.get("prediction"),
        "model": prediction_run.get("model"),
        "feature_vector": prediction_run.get("feature_vector"),
        "feature_bundle": feature_bundle,
    }


@app.post("/predictions/harvest/stub")
def create_harvest_prediction_stub(payload: HarvestPredictionRequest):
    try:
        feature_bundle = build_harvest_feature_bundle(
            collection,
            daily_summary_collection,
            image_analysis_collection,
            grow_cycle_collection,
            APP_TIMEZONE,
            lookback_days=payload.lookback_days,
            sensor_limit=payload.sensor_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if HARVEST_MODEL_ENABLED:
        document = build_model_prediction_run(
            feature_bundle,
            model_path=HARVEST_MODEL_PATH,
            metrics_path=HARVEST_MODEL_METRICS_PATH,
            timezone_name=APP_TIMEZONE,
            default_light_lux=HARVEST_MODEL_DEFAULT_LIGHT_LUX,
            default_fertilizer_mg_l=HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L,
            optimal_ph=HARVEST_MODEL_PH_OPTIMAL,
        )
    else:
        document = build_stub_prediction_run(feature_bundle)
    stored_document = store_prediction_run(prediction_collection, document)
    return {"prediction": serialize_document(stored_document)}


@app.post("/grow-cycles/start")
def start_grow_cycle(payload: GrowCycleStartRequest):
    try:
        document = start_cycle(
            grow_cycle_collection,
            APP_TIMEZONE,
            name=payload.name,
            planted_at=payload.planted_at,
            target_harvest_days=payload.target_harvest_days,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"grow_cycle": serialize_document(document)}


@app.post("/grow-cycles/harvest")
def harvest_grow_cycle(payload: GrowCycleHarvestRequest):
    try:
        document = harvest_active_cycle(
            grow_cycle_collection,
            APP_TIMEZONE,
            harvested_at=payload.harvested_at,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"grow_cycle": serialize_document(document)}

@app.get("/automation/rules")
def automation_rules():
    return get_grouped_automation_rules()

@app.post("/automation/light")
def create_light_automation_rule(payload: LightAutomationRequest):
    try:
        rule = automation_scheduler.create_light_rule(
            payload.on_time,
            payload.off_time,
            payload.days,
            enabled=payload.enabled,
            start_date=payload.start_date,
            end_date=payload.end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"rule": rule}

@app.post("/automation/pump-water")
async def create_pump_water_automation_rule(request: Request):
    try:
        payload = await _parse_request_model(
            request,
            PumpWaterAutomationRequest,
            query_fields=("start_time", "duration_seconds", "water_liters", "enabled", "start_date", "end_date"),
        )
        duration_seconds, water_liters = resolve_water_pump_duration_seconds(payload)
        rule = automation_scheduler.create_pump_water_rule(
            payload.start_time,
            duration_seconds,
            water_liters,
            payload.days,
            enabled=payload.enabled,
            start_date=payload.start_date,
            end_date=payload.end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"rule": rule}

@app.patch("/automation/rules/{rule_id}/enabled")
def set_automation_rule_enabled(rule_id: str, payload: AutomationRuleEnabledRequest):
    try:
        rule = automation_scheduler.set_rule_enabled(rule_id, payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"rule": rule}

@app.delete("/automation/rules/{rule_id}")
def delete_automation_rule(rule_id: str):
    try:
        result = automation_scheduler.delete_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result

@app.post("/actuators/light/on")
def turn_light_on():
    return {"light": light_on()}

@app.post("/actuators/light/off")
def turn_light_off():
    return {"light": light_off()}

@app.post("/actuators/pump-water/start")
async def start_pump_water(request: Request):
    try:
        payload = await _parse_request_model(
            request,
            PumpWaterRequest,
            query_fields=("duration_seconds", "water_liters"),
        )
        duration_seconds, _ = resolve_water_pump_duration_seconds(payload)
        status = run_pump_water(duration_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_water": status}

@app.post("/actuators/pump-water/stop")
def stop_water_pump():
    return {"pump_water": stop_pump_water()}

@app.post("/actuators/pump-fertilizer/{pump_id}/start")
async def start_single_fertilizer_pump(pump_id: int, request: Request):
    try:
        payload = await _parse_request_model(
            request,
            PumpFertilizerRequest,
            query_fields=("duration_seconds", "water_liters"),
        )
        status = run_fertilizer_pump(
            pump_id,
            resolve_fertilizer_duration_seconds(payload),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_fertilizer": status}

@app.post("/actuators/pump-fertilizer/{pump_id}/stop")
def stop_single_fertilizer_pump(pump_id: int):
    try:
        status = stop_fertilizer_pump_by_id(pump_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_fertilizer": status}

@app.get("/video")
async def video_feed(request: Request):
    async def stream_frames():
        frame_iterator = gen_frames()
        try:
            while True:
                if await request.is_disconnected():
                    break

                try:
                    frame = next(frame_iterator)
                except StopIteration:
                    break

                yield frame
                await asyncio.sleep(0)
        finally:
            close = getattr(frame_iterator, "close", None)
            if callable(close):
                close()

    return StreamingResponse(
        stream_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/camera/frame")
def camera_frame():
    frame_bytes = get_latest_frame_bytes(
        timeout_seconds=max(float(SNAPSHOT_TIMEOUT_SECONDS), 1.0),
        max_age_seconds=5.0,
    )
    if frame_bytes is None:
        raise HTTPException(status_code=503, detail="camera snapshot unavailable")

    return Response(
        content=frame_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


@app.get("/camera/analysis-preview")
def camera_analysis_preview(force: bool = False):
    try:
        preview = build_live_camera_analysis_preview(force_refresh=force)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"analysis": preview}


@app.get("/camera/analysis-preview/{asset_name}")
def camera_analysis_preview_asset(asset_name: str):
    try:
        build_live_camera_analysis_preview(force_refresh=False)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    asset = _live_camera_analysis_assets.get(asset_name)
    if asset is None:
        raise HTTPException(status_code=404, detail="live analysis asset not found")

    return Response(
        content=asset["bytes"],
        media_type=asset["content_type"],
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )
