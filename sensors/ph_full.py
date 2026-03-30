import statistics
import time
import warnings

from gpiozero import MCP3008
from gpiozero.exc import SPISoftwareFallback
from gpiozero.pins.lgpio import LGPIOFactory

MCP3008_CHANNEL = 0  # pH sensor Po -> MCP3008 pin 1 (CH0)
PH7_VOLTAGE = 3.825
SLOPE = 0.18
SAMPLES = 10

warnings.filterwarnings("ignore", category=SPISoftwareFallback)


def voltage_to_ph(voltage: float) -> float:
    if SLOPE == 0:
        raise ZeroDivisionError("SLOPE ต้องไม่เป็น 0")
    return 7 + ((PH7_VOLTAGE - voltage) / SLOPE)


try:
    factory = LGPIOFactory()
    sensor = MCP3008(channel=MCP3008_CHANNEL, pin_factory=factory)
except Exception as e:
    print(f"ไม่สามารถเชื่อมต่อกับ MCP3008 CH{MCP3008_CHANNEL} ได้: {e}")
    sensor = None


print("pH Sensor System Started...")
print("Press Ctrl+C to stop\n")

def main():
    if sensor is None:
        print("ระบบหยุดทำงานเนื่องจากหา Hardware ไม่พบ")
        raise SystemExit(1)

    while True:
        voltage_samples = []
        raw_samples = []

        for _ in range(SAMPLES):
            voltage_samples.append(sensor.voltage)
            raw_samples.append(sensor.raw_value)
            time.sleep(0.05)

        avg_voltage = statistics.mean(voltage_samples)
        avg_raw = round(statistics.mean(raw_samples))
        ph = voltage_to_ph(avg_voltage)

        print(f"Raw: {avg_raw:4d} | Voltage: {avg_voltage:.3f} V | pH: {ph:.2f}")
        time.sleep(1)


if __name__ == "__main__":
    main()
