import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sensors.ph import read_ph
import time

print("Testing pH sensor...")

while True:
    try:
        ph = read_ph()
        print("pH value:", ph)
    except Exception as e:
        print("Error:", e)

    time.sleep(2)
