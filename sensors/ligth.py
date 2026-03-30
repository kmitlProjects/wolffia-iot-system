import lgpio

LIGHT = 19
h = lgpio.gpiochip_open(0)
lgpio.gpio_claim_output(h, LIGHT)

# ปิดก่อน (ตอนเริ่ม)
lgpio.gpio_write(h, LIGHT, 0)

print("พิมพ์ on / off / exit")

while True:
    cmd = input("คำสั่ง: ").strip().lower()

    if cmd == "on":
        lgpio.gpio_write(h, LIGHT, 1)  # เปิด
        print("ไฟเปิดแล้ว")

    elif cmd == "off":
        lgpio.gpio_write(h, LIGHT, 0)  # ปิด
        print("ไฟปิดแล้ว")

    elif cmd == "exit":
        break

lgpio.gpiochip_close(h)
