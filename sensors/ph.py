import time
import warnings

from gpiozero import MCP3008
from gpiozero.exc import SPISoftwareFallback
from gpiozero.pins.lgpio import LGPIOFactory

MCP3008_CHANNEL = 0  # pH sensor Po -> MCP3008 pin 1 (CH0)
PH7_VOLTAGE = 1.00 # ใช้ค่าเดิมไว้ก่อน ควร calibrate ใหม่เมื่อเปลี่ยน ADC
SLOPE = 0.18         # ใช้ logic เดิมไว้ก่อน

warnings.filterwarnings("ignore", category=SPISoftwareFallback)

sensor = None


def _get_sensor():
    global sensor

    if sensor is not None:
        return sensor

    try:
        factory = LGPIOFactory()
        sensor = MCP3008(channel=MCP3008_CHANNEL, pin_factory=factory)
        print(f"เชื่อมต่อ pH sensor ผ่าน MCP3008 CH{MCP3008_CHANNEL} สำเร็จ")
    except Exception as e:
        print(f"ไม่สามารถเชื่อมต่อกับ MCP3008 CH{MCP3008_CHANNEL} ได้: {e}")
        sensor = None

    return sensor


def _voltage_to_ph(voltage: float) -> float:
    if SLOPE == 0:
        raise ZeroDivisionError("SLOPE ต้องไม่เป็น 0")
    return 7 + ((PH7_VOLTAGE - voltage) / SLOPE)

def read_ph_snapshot():
    active_sensor = _get_sensor()

    if active_sensor is None:
        return {
            "raw": 0,
            "value": 0.0,
            "voltage": 0.0,
            "ph": 0.0,
        }

    try:
        voltage = active_sensor.voltage
        return {
            "raw": active_sensor.raw_value,
            "value": round(active_sensor.value, 4),
            "voltage": round(voltage, 3),
            "ph": round(_voltage_to_ph(voltage), 2),
        }
    except Exception as e:
        print(f"Error reading pH: {e}")
        return {
            "raw": 0,
            "value": 0.0,
            "voltage": 0.0,
            "ph": 0.0,
        }


def read_ph():
    return read_ph_snapshot()["ph"]


if __name__ == "__main__":
    if _get_sensor() is not None:
        print("เริ่มอ่านค่า pH จาก MCP3008 CH0... (กด Ctrl+C เพื่อหยุด)")
        while True:
            snapshot = read_ph_snapshot()
            print(
                f"Raw: {snapshot['raw']:4d} | "
                f"Value: {snapshot['value']:.4f} | "
                f"Voltage: {snapshot['voltage']:.3f} V | "
                f"pH: {snapshot['ph']:.2f}"
            )
            time.sleep(2)
    else:
        print("ระบบหยุดทำงานเนื่องจากหา Hardware ไม่พบ")
