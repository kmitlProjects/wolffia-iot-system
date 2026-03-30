from gpiozero import DistanceSensor
from gpiozero.pins.lgpio import LGPIOFactory # เจาะจงใช้ lgpio สำหรับ Pi 5
import time

# กำหนดขา GPIO (Trigger=23, Echo=24)
# สำหรับ Pi 5 บางครั้งต้องระบุ Factory เพื่อความชัวร์
try:
    factory = LGPIOFactory()
    sensor = DistanceSensor(echo=24, trigger=23, pin_factory=factory)
except Exception as e:
    print(f"ไม่สามารถเริ่มต้นเซนเซอร์ Ultrasonic ได้: {e}")
    sensor = None

def read_water_level():
    if sensor is None:
        return 0.0
    
    try:
        # DistanceSensor ของ gpiozero จะคืนค่าเป็นเมตร (0.0 - 1.0)
        # คูณ 100 เพื่อแปลงเป็นเซนติเมตร
        distance_cm = sensor.distance * 100
        
        # ป้องกันค่ากระโดด (เช่น ถ้าเซนเซอร์วัดไม่ได้ค่าจะใกล้ 100 หรือ 0)
        if distance_cm > 400: # ระยะสูงสุดของ HC-SR04 คือประมาณ 4 เมตร
            return 0.0
            
        return round(distance_cm, 2)
    except Exception as e:
        print(f"Error reading Ultrasonic: {e}")
        return 0.0

# ส่วนทดสอบรันแยก
if __name__ == "__main__":
    print("เริ่มทดสอบวัดระดับน้ำ")
    try:
        while True:
            dist = read_water_level()
            print(f"ระดับน้ำ: {dist} cm")
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("หยุดการทำงาน")