import os
import datetime
import threading
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pymongo import MongoClient

from config import CORS_ALLOW_ORIGINS, MONGO_COLLECTION, MONGO_DB, MONGO_URI
from sensors.camera import gen_frames, get_coverage
from sensors.ph import read_ph
from sensors.temp import read_temp
from sensors.ultrasonic import read_water_level

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

# ----------------- Background Logger -----------------
def background_sensor_logger():
    """ฟังก์ชันนี้จะทำงานวนลูปอยู่เบื้องหลังเพื่อเก็บข้อมูลลง Database"""
    while True:
        try:
            # 1. อ่านค่าจากเซนเซอร์จริง
            current_temp = read_temp()
            current_water_level = read_water_level() 
            current_coverage = get_coverage()

            # 2. อ่านค่าอื่นๆ (ถ้ามีเซนเซอร์จริงแล้ว ให้นำมาแทนที่ค่าจำลองตรงนี้)
            current_ph = read_ph()  
            
            # 3. จัดเตรียมข้อมูลเป็น Dictionary
            data = {
                "temp": current_temp,
                "ph": current_ph,
                "coverage": current_coverage,
                "water_level": current_water_level,
                "timestamp": datetime.datetime.now()
            }
            
            # 4. บันทึกลง MongoDB
            collection.insert_one(data)
            print(f"[{datetime.datetime.now()}] บันทึกข้อมูลสำเร็จ {data}")
            
        except Exception as e:
            print(f"เกิดข้อผิดพลาดในการบันทึกข้อมูล: {e}")
            
        # 5. หน่วงเวลา (ใส่ 300 คือ 5 นาที) 
        # *ข้อแนะนำ: ตอนทดสอบระบบครั้งแรก ลองแก้เป็น 10 (วินาที) เพื่อให้เห็นข้อมูลขึ้นหน้าเว็บไวๆ ก่อนครับ
        time.sleep(30)

@app.on_event("startup")
def startup_event():
    """สั่งให้ Background Logger เริ่มทำงานพร้อมๆ กับตอนที่เปิดรัน FastAPI"""
    thread = threading.Thread(target=background_sensor_logger, daemon=True)
    thread.start()
    print("เริ่มระบบบันทึกข้อมูลเซนเซอร์อัตโนมัติ...")

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
    data = collection.find().sort("timestamp", -1).limit(1)
    result = []
    for item in data:
        item["_id"] = str(item["_id"])
        result.append(item)
    return result

@app.get("/history")
def get_history():
    data = collection.find().sort("timestamp", 1).limit(50)
    result = []
    for item in data:
        item["_id"] = str(item["_id"])
        result.append(item)
    return result

@app.get("/video")
def video_feed():
    return StreamingResponse(
        gen_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/temperature")
def get_temperature():
    temp = read_temp()
    return {"temperature": temp}
