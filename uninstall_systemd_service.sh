#!/bin/bash

set -euo pipefail

SERVICE_NAME="wolffia-stack.service"
TARGET_PATH="/etc/systemd/system/$SERVICE_NAME"

if sudo systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
    sudo systemctl disable --now "$SERVICE_NAME" || true
fi

if [ -f "$TARGET_PATH" ]; then
    sudo rm -f "$TARGET_PATH"
fi

sudo systemctl daemon-reload

echo "[uninstall-systemd] ถอน $SERVICE_NAME เรียบร้อยแล้ว"
