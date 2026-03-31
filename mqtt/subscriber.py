import paho.mqtt.client as mqtt
import json
from datetime import datetime
import time
import threading
import sys
import os
from zoneinfo import ZoneInfo
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pymongo import MongoClient

from ai.daily_summary import ensure_daily_summary_indexes, summarize_day
from config import (
    APP_TIMEZONE,
    DAILY_SUMMARY_COLLECTION,
    GROW_CYCLE_COLLECTION,
    IMAGE_ANALYSIS_COLLECTION,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
    MQTT_BROKER,
    MQTT_PASSWORD,
    MQTT_PORT,
    MQTT_TOPIC,
    MQTT_USERNAME,
)
from grow_cycle import build_cycle_context, ensure_grow_cycle_indexes, get_active_cycle

mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000, tz_aware=True)
db = mongo[MONGO_DB]
collection = db[MONGO_COLLECTION]
image_analysis_collection = db[IMAGE_ANALYSIS_COLLECTION]
daily_summary_collection = db[DAILY_SUMMARY_COLLECTION]
grow_cycle_collection = db[GROW_CYCLE_COLLECTION]

connected_event = threading.Event()
startup_error = None
runtime_error = None


def verify_mongo():
    try:
        mongo.admin.command("ping")
        print("เชื่อมต่อ MongoDB สำเร็จ")
    except Exception as e:
        print(f"เชื่อมต่อ MongoDB ไม่สำเร็จ: {e}")
        sys.exit(1)


def ensure_indexes():
    collection.create_index("timestamp", name="sensor_timestamp_idx")
    print("สร้าง MongoDB index สำหรับ sensor_data.timestamp แล้ว")
    ensure_daily_summary_indexes(daily_summary_collection)
    ensure_grow_cycle_indexes(grow_cycle_collection)


def parse_sensor_timestamp(raw_value):
    if isinstance(raw_value, str):
        try:
            return datetime.fromisoformat(raw_value)
        except ValueError:
            print(
                "timestamp จาก publisher ไม่ถูกต้อง "
                f"จึงจะใช้เวลาปัจจุบันแทน: {raw_value}"
            )

    return datetime.now(ZoneInfo(APP_TIMEZONE))

# 2. เพิ่มฟังก์ชัน on_connect เพื่อจัดการเรื่อง MQTT v2 (สำคัญมาก!)
def on_connect(client, userdata, flags, rc, properties=None):
    global startup_error

    if rc == 0:
        print("เชื่อมต่อ MQTT Broker สำเร็จ")
        result, _ = client.subscribe(MQTT_TOPIC)
        if result != mqtt.MQTT_ERR_SUCCESS:
            startup_error = f"subscribe topic {MQTT_TOPIC} ไม่สำเร็จ (code: {result})"
    else:
        startup_error = f"เชื่อมต่อ MQTT ล้มเหลว Code: {rc}"

    connected_event.set()

def on_message(client, userdata, msg):
    try:
        print(f"ได้รับ message จาก topic {msg.topic}")

        # แปลงข้อมูล JSON ที่ได้รับ
        data = json.loads(msg.payload.decode())
        
        # ใช้เวลาที่ publisher เก็บค่า sensor จริงเป็นหลัก
        data["timestamp"] = parse_sensor_timestamp(data.get("timestamp"))
        active_cycle = get_active_cycle(
            grow_cycle_collection,
            at_time=data["timestamp"],
            timezone_name=APP_TIMEZONE,
        )
        data.update(build_cycle_context(active_cycle, data["timestamp"], APP_TIMEZONE))
        
        # บันทึกลง MongoDB
        collection.insert_one(data)
        date_key = data["timestamp"].astimezone(ZoneInfo(APP_TIMEZONE)).strftime("%Y-%m-%d")
        summarize_day(
            collection,
            image_analysis_collection,
            daily_summary_collection,
            APP_TIMEZONE,
            date_key,
        )
        print("Saved to MongoDB:", data)
    except Exception as e:
        print("Error processing message:", e)

def on_disconnect(client, userdata, disconnect_flags, rc, properties=None):
    global runtime_error

    if rc != 0:
        runtime_error = f"MQTT หลุดการเชื่อมต่อระหว่างรัน (code: {rc})"

# client = mqtt.Client()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect # ต้องใส่ตัวนี้ด้วยเพื่อแก้ปัญหา TypeError ที่เจอ
client.on_message = on_message
client.on_disconnect = on_disconnect

if MQTT_USERNAME:
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or "")

print(f"Subscriber กำลังรอข้อมูลจาก Topic: {MQTT_TOPIC} ...")

try:
    verify_mongo()
    ensure_indexes()
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

    if not connected_event.wait(timeout=10):
        print("Connection Error: รอผลการเชื่อมต่อ MQTT นานเกินไป")
        sys.exit(1)

    if startup_error is not None:
        print(f"Connection Error: {startup_error}")
        sys.exit(1)

    while True:
        if runtime_error is not None:
            print(f"Connection Error: {runtime_error}")
            sys.exit(1)
        time.sleep(1)
except Exception as e:
    print("Connection Error:", e)
    sys.exit(1)
