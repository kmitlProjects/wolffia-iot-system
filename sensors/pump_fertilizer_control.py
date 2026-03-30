from gpiozero import PWMOutputDevice
import time

# ---------------------------------------------------------
# 1. ตั้งค่าขา GPIO (แนะนำให้ใช้ขาที่รองรับ PWM)
# ---------------------------------------------------------
# สมมติว่าต่อสายสัญญาณ PWM ของปั๊มเข้ากับ GPIO 18
fertilizer_pump = PWMOutputDevice(13)

def dispense_fertilizer(pump_speed, duration_seconds):
    """
    ฟังก์ชันสำหรับปล่อยปุ๋ยตามความเร็วและเวลาที่กำหนด
    pump_speed: ค่าความเร็วปั๊ม 0.0 ถึง 1.0 (เช่น 0.5 คือ 50%)
    duration_seconds: เวลาที่ต้องการปล่อยปุ๋ย (วินาที)
    """
    if not (0.0 <= pump_speed <= 1.0):
        print("Error: ความเร็วปั๊มต้องอยู่ระหว่าง 0.0 ถึง 1.0")
        return

    print(f"กำลังปล่อยปุ๋ย: ความเร็ว {pump_speed*100}% เป็นเวลา {duration_seconds} วินาที...")
    
    # 2. สั่งปั๊มทำงาน
    fertilizer_pump.value = pump_speed
    
    # รอจนกว่าจะครบเวลา
    time.sleep(duration_seconds)
    
    # 3. สั่งปิดปั๊ม
    fertilizer_pump.off()
    print("ปิดปั๊มปุ๋ยเรียบร้อยแล้ว!")

# --- เริ่มการทำงาน ---
if __name__ == "__main__":
    try:
        # ตัวอย่าง: ปล่อยปุ๋ยที่ความเร็ว 70% เป็นเวลา 5 วินาที
        dispense_fertilizer(pump_speed=0.7, duration_seconds=5)
        
    except KeyboardInterrupt:
        # ถ้ากด Ctrl+C ให้ปิดปั๊มทันทีเพื่อความปลอดภัย
        fertilizer_pump.off()
        print("\nหยุดการทำงานฉุกเฉิน")
