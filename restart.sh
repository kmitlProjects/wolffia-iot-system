#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
SERVICE_NAME="wolffia-stack.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"

log() {
    printf '[restart] %s\n' "$1"
}

run_systemctl() {
    if [ "$(id -u)" -eq 0 ]; then
        systemctl "$@"
    else
        sudo systemctl "$@"
    fi
}

if [ -f "$SERVICE_PATH" ]; then
    log "ตรวจพบบริการ systemd ($SERVICE_NAME) จึงสั่ง restart ผ่าน systemctl"
    run_systemctl restart "$SERVICE_NAME"
    log "restart $SERVICE_NAME เรียบร้อยแล้ว"
    exit 0
fi

log "กำลังหยุด stack เดิมก่อน"
./stop.sh

log "กำลังเริ่ม stack ใหม่"
exec ./start.sh
