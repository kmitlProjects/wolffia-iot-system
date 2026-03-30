import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from pymongo import MongoClient

from actuators.ligth import get_light_status, light_off, light_on
from actuators.pump_fertilizer_control import (
    dispense_fertilizer,
    get_pump_fertilizer_status,
    stop_pump_fertilizer,
)
from actuators.pump_water_control import (
    get_pump_water_status,
    run_pump_water,
    stop_pump_water,
)
from config import (
    CORS_ALLOW_ORIGINS,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)
from camera.camera import gen_frames

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo = MongoClient(MONGO_URI)
db = mongo[MONGO_DB]
collection = db[MONGO_COLLECTION]


class PumpWaterRequest(BaseModel):
    duration_seconds: float


class PumpFertilizerRequest(BaseModel):
    duration_seconds: float
    pump_speed: float | None = None

def serialize_document(document):
    if document is None:
        return None

    document["_id"] = str(document["_id"])
    return document


def get_latest_document():
    return collection.find_one(sort=[("timestamp", -1)])


def get_actuator_status():
    return {
        "light": get_light_status(),
        "pump_water": get_pump_water_status(),
        "pump_fertilizer": get_pump_fertilizer_status(),
    }

@app.on_event("startup")
def startup_event():
    """ตั้งค่าบริการที่ต้องทำตอน API เริ่มทำงาน"""
    print("API จะอ่านค่าล่าสุดจาก MongoDB โดยไม่จับ hardware โดยตรง")
    print("กล้องจะถูกสตรีมผ่านหน้าเว็บที่ /video")
    print("actuator controls พร้อมใช้งานที่ /actuators/*")

# ----------------- API Endpoints -----------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(BASE_DIR, "dashboard", "index.html")

@app.get("/")
def serve_dashboard():
    """หน้าหลัก: โหลดไฟล์ HTML มาแสดงผลเป็น Dashboard"""
    # สำคัญ: คุณต้องเซฟโค้ด HTML ที่ส่งมาตอนแรกตั้งชื่อว่า "index.html" ไว้ในโฟลเดอร์เดียวกับไฟล์นี้
    # return FileResponse("index.html")
    # ตรวจสอบก่อนว่าไฟล์มีอยู่จริงไหม
    if os.path.exists(INDEX_PATH):
        return FileResponse(INDEX_PATH)
    else:
        return {
            "error": "ไม่พบไฟล์ index.html",
            "looked_at": INDEX_PATH  # บอกด้วยว่าไปหาที่ไหน จะได้เช็คได้
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
def start_pump_fertilizer(payload: PumpFertilizerRequest):
    try:
        status = dispense_fertilizer(payload.duration_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"pump_fertilizer": status}

@app.post("/actuators/pump-fertilizer/stop")
def stop_fertilizer_pump():
    return {"pump_fertilizer": stop_pump_fertilizer()}

@app.get("/video")
def video_feed():
    return StreamingResponse(
        gen_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
