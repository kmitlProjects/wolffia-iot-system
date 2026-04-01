#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="wolffia-stack.service"
TEMPLATE_PATH="$SCRIPT_DIR/systemd/wolffia-stack.service.template"
TARGET_PATH="/etc/systemd/system/$SERVICE_NAME"
SERVICE_USER="${SUDO_USER:-$USER}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

if [ ! -f "$TEMPLATE_PATH" ]; then
    echo "[install-systemd] ไม่พบ template ที่ $TEMPLATE_PATH" >&2
    exit 1
fi

if [ ! -x "$SCRIPT_DIR/start.sh" ] || [ ! -x "$SCRIPT_DIR/stop.sh" ] || [ ! -x "$SCRIPT_DIR/systemd/run_stack.sh" ]; then
    echo "[install-systemd] start.sh, stop.sh หรือ systemd/run_stack.sh ยังไม่มีสิทธิ์รัน" >&2
    exit 1
fi

tmp_service="$(mktemp)"
cleanup() {
    rm -f "$tmp_service"
}
trap cleanup EXIT

sed \
    -e "s|__PROJECT_DIR__|$SCRIPT_DIR|g" \
    -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
    -e "s|__SERVICE_GROUP__|$SERVICE_GROUP|g" \
    "$TEMPLATE_PATH" > "$tmp_service"

sudo install -m 0644 "$tmp_service" "$TARGET_PATH"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "[install-systemd] ติดตั้ง $SERVICE_NAME เรียบร้อยแล้ว"
echo "[install-systemd] หลังจากนี้ใช้ ./start.sh ./stop.sh ./restart.sh ได้เลย"
echo "[install-systemd] ตรวจสอบสถานะด้วย: systemctl status $SERVICE_NAME"
echo "[install-systemd] ดู log สดด้วย: journalctl -u $SERVICE_NAME -f"
