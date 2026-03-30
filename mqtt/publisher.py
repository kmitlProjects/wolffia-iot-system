import paho.mqtt.client as mqtt
import json
import time
import threading
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import MQTT_BROKER, MQTT_PASSWORD, MQTT_PORT, MQTT_TOPIC, MQTT_USERNAME

from sensors.temp import read_temp
from sensors.ph import read_ph

BROKER = MQTT_BROKER
PORT = MQTT_PORT
TOPIC = MQTT_TOPIC

# client = mqtt.Client()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
connected_event = threading.Event()
startup_error = None
runtime_error = None

# ---- Connect ----
def on_connect(client, userdata, flags, rc, properties=None):
    global startup_error

    if rc == 0:
        print("Connected to MQTT Broker")
    else:
        startup_error = f"Failed to connect: {rc}"

    connected_event.set()


def on_disconnect(client, userdata, disconnect_flags, rc, properties=None):
    global runtime_error

    if rc != 0:
        runtime_error = f"MQTT disconnected while running (code: {rc})"

if MQTT_USERNAME:
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or "")
client.on_connect = on_connect
client.on_disconnect = on_disconnect
try:
    client.connect(BROKER, PORT, 60)
except Exception as e:
    print(f"Cannot connect to Broker: {e}")
    sys.exit(1)

client.loop_start()  # ให้ mqtt ทำงาน background

if not connected_event.wait(timeout=10):
    print("Cannot connect to Broker: timed out waiting for MQTT connection")
    sys.exit(1)

if startup_error is not None:
    print(startup_error)
    sys.exit(1)

print(f"เริ่มส่งข้อมูลเซนเซอร์ไปที่ Topic: {TOPIC} ทุกๆ 10 วินาที")

# ---- Main Loop ----
while True:
    try:
        if runtime_error is not None:
            print(runtime_error)
            sys.exit(1)

        print("กำลังอ่านค่า pH ...")
        ph_value = read_ph()
        print(f"อ่านค่า pH ได้: {ph_value}")

        print("กำลังอ่านค่าอุณหภูมิ ...")
        temp_value = read_temp()
        print(f"อ่านค่าอุณหภูมิได้: {temp_value}")


        data = {
            "ph": ph_value,
            "temp": temp_value
            # "timestamp": datetime.utcnow().isoformat()
        }

        # 3. ส่งข้อมูล (Publish)
        print("กำลัง publish ข้อมูลไปยัง MQTT ...")
        result = client.publish(TOPIC, json.dumps(data))
        result.wait_for_publish()
        
        # เช็คว่าส่งสำเร็จไหม
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print("Sent:", data)
        else:
            print("Failed to send message")

    except Exception as e:
        print("Sensor error:", e)

    time.sleep(1800) 
