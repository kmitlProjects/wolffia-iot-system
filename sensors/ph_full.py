import time
import statistics
import board
import busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

# ==============================
# CONFIGURATION
# ==============================

PH7_VOLTAGE = 3.825     # ค่า voltage ตอนอยู่ใน pH 7 (คุณวัดได้)
SLOPE = 0.18            # ค่าเริ่มต้น (ปรับได้ภายหลัง)
SAMPLES = 10            # จำนวนครั้งที่อ่านแล้วเอาเฉลี่ย

# ==============================
# INITIALIZE I2C + ADS1115
# ==============================

i2c = busio.I2C(board.SCL, board.SDA)
ads = ADS.ADS1115(i2c)
chan = AnalogIn(ads, 0)  # A0

print("pH Sensor System Started...")
print("Press Ctrl+C to stop\n")

# ==============================
# MAIN LOOP
# ==============================

while True:
    readings = []

    # อ่านหลายครั้งเพื่อลด noise
    for _ in range(SAMPLES):
        readings.append(chan.voltage)
        time.sleep(0.05)

    avg_voltage = statistics.mean(readings)

    # สูตรแปลง Voltage -> pH
    ph = 7 - ((avg_voltage - PH7_VOLTAGE) / SLOPE)

    print(f"Voltage: {avg_voltage:.3f} V  |  pH: {ph:.2f}")

    time.sleep(1)