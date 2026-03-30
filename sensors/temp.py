import time
import os

# เปลี่ยน '28-xxxx' เป็น ID ที่คุณเจอจากขั้นตอนที่ 3
device_id = '28-000000b1e064' 
device_file = f'/sys/bus/w1/devices/{device_id}/w1_slave'

def read_temp_raw():
    # เพิ่มการเช็คว่าไฟล์มีอยู่จริงไหม เพื่อป้องกัน IndexError
    if not os.path.exists(device_file):
        return None
    with open(device_file, 'r') as f:
        return f.readlines()

def read_temp():
    try:
        lines = read_temp_raw()
        if not lines:
            return 0.0 # ถ้าหาไฟล์ไม่เจอ ให้คืนค่า 0 หรือค่าว่าง
        
        # รอจนกว่าจะอ่านค่าสำเร็จ (YES)
        while lines[0].strip()[-3:] != 'YES':
            time.sleep(0.2)
            lines = read_temp_raw()
            if not lines: break
        
        equals_pos = lines[1].find('t=')
        if equals_pos != -1:
            temp_string = lines[1][equals_pos+2:]
            temp_c = float(temp_string) / 1000.0
            return temp_c
    except Exception as e:
        print(f"Error reading sensor: {e}")
        return 0.0

if __name__ == "__main__":
    # โค้ดในส่วนนี้จะทำงาน "เฉพาะ" ตอนที่คุณรันไฟล์ python3 temp.py ตรงๆ เท่านั้น
    # จะไม่ทำงานตอนที่ FastAPI สั่ง import ไปใช้ ทำให้ระบบไม่ค้าง
    try:
        print("กำลังอ่านอุณหภูมิน้ำ... (กด Ctrl+C เพื่อหยุด)")
        while True:
            temperature = read_temp()
            print(f"อุณหภูมิปัจจุบัน: {temperature:.2f} °C")
            time.sleep(1)
    except KeyboardInterrupt:
        print("หยุดการทำงาน")
