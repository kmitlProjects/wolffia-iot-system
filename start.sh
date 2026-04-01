#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="wolffia-stack.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
RUNNER_PATH="$SCRIPT_DIR/systemd/run_stack.sh"

log() {
    printf '[start] %s\n' "$1"
}

run_systemctl() {
    if [ "$(id -u)" -eq 0 ]; then
        systemctl "$@"
    else
        sudo systemctl "$@"
    fi
}

if [ ! -x "$RUNNER_PATH" ]; then
    log "ไม่พบ runner ที่ $RUNNER_PATH"
    exit 1
fi

if [ -f "$SERVICE_PATH" ]; then
    log "ตรวจพบบริการ systemd ($SERVICE_NAME) จึงสั่ง start ผ่าน systemctl"
    run_systemctl start "$SERVICE_NAME"
    log "เริ่ม $SERVICE_NAME แล้ว"
    exit 0
fi

log "ยังไม่ได้ติดตั้ง systemd service จึงรัน stack ตรงตามเดิม"
exec "$RUNNER_PATH"
