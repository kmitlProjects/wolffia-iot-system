import os
from datetime import datetime, timezone

from automation.scheduler import AutomationScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pymongo import MongoClient

from actuators.ligth import get_light_status, light_off, light_on
from actuators.pump_fertilizer_control import (
    get_pump_fertilizer_status,
    run_all_fertilizer_pumps,
    run_fertilizer_pump,
    stop_all_fertilizer_pumps,
    stop_fertilizer_pump as stop_fertilizer_pump_by_id,
)
from actuators.pump_water_control import (
    get_pump_water_status,
    run_pump_water,
    stop_pump_water,
)
from config import (
    APP_TIMEZONE,
    AUTOMATION_COLLECTION,
    AUTOMATION_POLL_SECONDS,
    CORS_ALLOW_ORIGINS,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)
from camera.camera import gen_frames, get_camera_status

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "frontend", "dist")
FRONTEND_ASSETS_DIR = os.path.join(FRONTEND_DIST_DIR, "assets")
FRONTEND_INDEX_PATH = os.path.join(FRONTEND_DIST_DIR, "index.html")

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

mongo = MongoClient(MONGO_URI)
db = mongo[MONGO_DB]
collection = db[MONGO_COLLECTION]
automation_collection = db[AUTOMATION_COLLECTION]
automation_scheduler = AutomationScheduler(
    automation_collection,
    APP_TIMEZONE,
    AUTOMATION_POLL_SECONDS,
)


class PumpWaterRequest(BaseModel):
    duration_seconds: float


class PumpFertilizerRequest(BaseModel):
    duration_seconds: float


class AutomationBaseRequest(BaseModel):
    days: list[str]
    enabled: bool = True


class LightAutomationRequest(AutomationBaseRequest):
    on_time: str
    off_time: str


class PumpWaterAutomationRequest(AutomationBaseRequest):
    start_time: str
    duration_seconds: float


class AutomationRuleEnabledRequest(BaseModel):
    enabled: bool


def serialize_document(document):
    if document is None:
        return None

    serialized = dict(document)
    serialized["_id"] = str(serialized["_id"])
    return serialized


def get_latest_document():
    return collection.find_one(sort=[("timestamp", -1)])


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


def get_dashboard_state():
    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "timezone": APP_TIMEZONE,
        },
        "camera": {
            "stream_url": "/video",
            "status": get_camera_status(),
        },
        "sensor": serialize_document(get_latest_document()),
        "actuators": get_actuator_status(),
        "automation": get_grouped_automation_rules(),
    }

@app.on_event("startup")
def startup_event():
    """ตั้งค่าบริการที่ต้องทำตอน API เริ่มทำงาน"""
    print("API จะอ่านค่าล่าสุดจาก MongoDB โดยไม่จับ hardware โดยตรง")
    print("dashboard ใหม่จะถูกเสิร์ฟผ่านหน้าเว็บที่ /")
    print("กล้องจะถูกสตรีมผ่านหน้าเว็บที่ /video")
    print("actuator controls พร้อมใช้งานที่ /actuators/*")
    print("automation schedule พร้อมใช้งานที่ /automation/*")
    automation_scheduler.start()


@app.on_event("shutdown")
def shutdown_event():
    automation_scheduler.stop()

# ----------------- API Endpoints -----------------

@app.get("/")
def serve_dashboard():
    """หน้าหลักของ frontend ใหม่"""
    if os.path.exists(FRONTEND_INDEX_PATH):
        return FileResponse(FRONTEND_INDEX_PATH)

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
def get_history():
    data = collection.find().sort("timestamp", 1).limit(50)
    result = []
    for item in data:
        item["_id"] = str(item["_id"])
        result.append(item)
    return result

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
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"rule": rule}

@app.post("/automation/pump-water")
def create_pump_water_automation_rule(payload: PumpWaterAutomationRequest):
    try:
        rule = automation_scheduler.create_pump_water_rule(
            payload.start_time,
            payload.duration_seconds,
            payload.days,
            enabled=payload.enabled,
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
def start_pump_water(payload: PumpWaterRequest):
    try:
        status = run_pump_water(payload.duration_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_water": status}

@app.post("/actuators/pump-water/stop")
def stop_water_pump():
    return {"pump_water": stop_pump_water()}

@app.post("/actuators/pump-fertilizer/start")
def start_all_fertilizer_pumps_route(payload: PumpFertilizerRequest):
    try:
        status = run_all_fertilizer_pumps(payload.duration_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_fertilizer": status}

@app.post("/actuators/pump-fertilizer/stop")
def stop_all_fertilizer_pumps_route():
    return {"pump_fertilizer": stop_all_fertilizer_pumps()}

@app.post("/actuators/pump-fertilizer/{pump_id}/start")
def start_single_fertilizer_pump(pump_id: int, payload: PumpFertilizerRequest):
    try:
        status = run_fertilizer_pump(pump_id, payload.duration_seconds)
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
def video_feed():
    return StreamingResponse(
        gen_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
