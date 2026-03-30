import paho.mqtt.client as mqtt
import json
import time
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import MQTT_BROKER, MQTT_PASSWORD, MQTT_PORT, MQTT_TOPIC, MQTT_USERNAME

from sensors.camera import get_coverage
from sensors.temp import read_temp
from sensors.ph import read_ph
from sensors.ultrasonic import read_water_level

BROKER = MQTT_BROKER
PORT = MQTT_PORT
TOPIC = MQTT_TOPIC

# client = mqtt.Client()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

# ---- Connect ----
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("Connected to MQTT Broker")
    else:
        print(f"Failed to connect: {rc}")

if MQTT_USERNAME:
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or "")
client.on_connect = on_connect
try:
    client.connect(BROKER, PORT, 60)
except Exception as e:
    print(f"Cannot connect to Broker: {e}")
    sys.exit(1)

client.loop_start()  # ให้ mqtt ทำงาน background
print(f"เริ่มส่งข้อมูลเซนเซอร์ไปที่ Topic: {TOPIC} ทุกๆ 10 วินาที")

# ---- Main Loop ----
while True:
    try:
        data = {
            "coverage": get_coverage(),
            "ph": read_ph(),
            "temp": read_temp(),
            "water_level": read_water_level()
            # "timestamp": datetime.utcnow().isoformat()
        }

        # 3. ส่งข้อมูล (Publish)
        result = client.publish(TOPIC, json.dumps(data))
        
        # เช็คว่าส่งสำเร็จไหม
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print("Sent:", data)
        else:
            print("Failed to send message")

    except Exception as e:
        print("Sensor error:", e)

    time.sleep(10) 
