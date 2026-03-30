import paho.mqtt.client as mqtt
import json
from datetime import datetime

from pymongo import MongoClient

from config import (
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
    MQTT_BROKER,
    MQTT_PASSWORD,
    MQTT_PORT,
    MQTT_TOPIC,
    MQTT_USERNAME,
)

mongo = MongoClient(MONGO_URI)
db = mongo[MONGO_DB]
collection = db[MONGO_COLLECTION]

# 2. เพิ่มฟังก์ชัน on_connect เพื่อจัดการเรื่อง MQTT v2 (สำคัญมาก!)
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("เชื่อมต่อ MQTT Broker สำเร็จ")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"เชื่อมต่อ MQTT ล้มเหลว Code: {rc}")

def on_message(client, userdata, msg):
    try:
        # แปลงข้อมูล JSON ที่ได้รับ
        data = json.loads(msg.payload.decode())
        
        # แก้ไขจุดพิมพ์ผิดจาก datetiome เป็น datetime
        data["timestamp"] = datetime.now()
        
        # บันทึกลง MongoDB
        collection.insert_one(data)
        print("Saved to MongoDB:", data)
    except Exception as e:
        print("Error processing message:", e)

# client = mqtt.Client()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect # ต้องใส่ตัวนี้ด้วยเพื่อแก้ปัญหา TypeError ที่เจอ
client.on_message = on_message

if MQTT_USERNAME:
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or "")

print(f"Subscriber กำลังรอข้อมูลจาก Topic: {MQTT_TOPIC} ...")

try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_forever()  # เริ่มต้นรอฟังข้อมูล
except Exception as e:
    print("Connection Error:", e)
