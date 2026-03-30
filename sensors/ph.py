import time
import board
import busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

# i2c = busio.I2C(board.SCL, board.SDA)
# ads = ADS.ADS1115(i2c)
# chan = AnalogIn(ads, 0)   # A0
# พยายามสร้าง I2C และ ADS Object
try:
    i2c = busio.I2C(board.SCL, board.SDA)
    ads = ADS.ADS1115(i2c)
    chan = AnalogIn(ads, ADS.P0)  # ใช้ ADS.P0 เพื่อความชัดเจน
except Exception as e:
    print(f"ไม่สามารถเชื่อมต่อกับ ADS1115 ได้: {e}")
    ads = None

PH7_VOLTAGE = 3.825   # ค่าที่วัดได้ในน้ำดื่ม
SLOPE = 0.18          # ค่าเริ่มต้นประมาณ

#while True:
#    voltage = chan.voltage
#    ph = 7 - ((voltage - PH7_VOLTAGE) / SLOPE)
#    print(f"Voltage: {voltage:.3f} V  |  pH: {ph:.2f}")
#    time.sleep(1)

# ฟังก์ชันอ่าน pH
def read_ph():
    if ads is None:
        return 0.0  # คืนค่า 0 ถ้าไม่มี hardware เชื่อมต่ออยู่
    try:
        voltage = chan.voltage

        # สูตรประมาณค่า pH (ต้อง calibrate จริงภายหลัง)
        ph_value = 7 + ((PH7_VOLTAGE - voltage) / SLOPE)

        return round(ph_value, 2)
    except Exception as e:
        print(f"Error reading pH: {e}")
        return 0.0

# test run
if __name__ == "__main__":
    if ads is not None:
        while True:
            ph = read_ph()
            # ดึง Voltage มาโชว์ด้วยเพื่อความง่ายในการ Calibrate
            print(f"Voltage: {chan.voltage:.3f} V | pH: {ph}")
            time.sleep(2)
    else:
        print("ระบบหยุดทำงานเนื่องจากหา Hardware ไม่พบ")