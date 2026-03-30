import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sensors.ph import read_ph_snapshot
import time

print("Testing pH sensor...")

while True:
    try:
        snapshot = read_ph_snapshot()
        print(
            f"raw={snapshot['raw']} | "
            f"value={snapshot['value']:.4f} | "
            f"voltage={snapshot['voltage']:.3f} V | "
            f"pH={snapshot['ph']:.2f}"
        )
    except Exception as e:
        print("Error:", e)

    time.sleep(2)
