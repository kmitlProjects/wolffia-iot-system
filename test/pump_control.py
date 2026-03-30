import lgpio
import time

RELAY_PIN = 16   # เปลี่ยนเป็น 16

h = lgpio.gpiochip_open(0)

lgpio.gpio_claim_output(h, RELAY_PIN)

print("OFF")
lgpio.gpio_write(h, RELAY_PIN, 1)
time.sleep(2)

print("ON")
lgpio.gpio_write(h, RELAY_PIN, 0)
time.sleep(5)

print("OFF")
lgpio.gpio_write(h, RELAY_PIN, 1)

lgpio.gpiochip_close(h)
