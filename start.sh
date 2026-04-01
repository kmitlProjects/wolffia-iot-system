#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="wolffia-stack.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
RUNNER_PATH="$SCRIPT_DIR/systemd/run_stack.sh"

log() {
    printf '[start] %s\n' "$1"
}

warn() {
    printf '[warn] %s\n' "$1" >&2
}

run_systemctl() {
    if [ "$(id -u)" -eq 0 ]; then
        systemctl "$@"
    else
        sudo systemctl "$@"
    fi
}

append_unique_url() {
    local candidate="$1"
    local existing

    [ -n "$candidate" ] || return

    for existing in "${ACCESS_URLS[@]:-}"; do
        if [ "$existing" = "$candidate" ]; then
            return
        fi
    done

    ACCESS_URLS+=("$candidate")
}

load_public_base_url() {
    local env_file="$SCRIPT_DIR/.env"
    if [ ! -f "$env_file" ]; then
        return
    fi

    grep -E '^PUBLIC_BASE_URL=' "$env_file" | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

build_access_urls() {
    ACCESS_URLS=()
    local hostname_value ip raw_public_base_url

    append_unique_url "http://127.0.0.1:8000"

    hostname_value="$(hostname 2>/dev/null || true)"
    if [ -n "$hostname_value" ]; then
        append_unique_url "http://${hostname_value}.local:8000"
    fi

    for ip in $(hostname -I 2>/dev/null); do
        append_unique_url "http://${ip}:8000"
    done

    raw_public_base_url="$(load_public_base_url || true)"
    append_unique_url "$raw_public_base_url"
}

print_access_urls() {
    local url

    build_access_urls
    log "เปิดหน้าเว็บได้ที่ลิงก์เหล่านี้:"
    for url in "${ACCESS_URLS[@]:-}"; do
        printf '  - %s\n' "$url"
    done
    printf '  - %s\n' "http://127.0.0.1:8000/dashboard-state"
}

wait_for_dashboard() {
    local attempt

    for attempt in $(seq 1 20); do
        if curl -s -o /dev/null http://127.0.0.1:8000/dashboard-state; then
            return 0
        fi
        sleep 0.5
    done

    return 1
}

if [ ! -x "$RUNNER_PATH" ]; then
    log "ไม่พบ runner ที่ $RUNNER_PATH"
    exit 1
fi

if [ -f "$SERVICE_PATH" ]; then
    log "ตรวจพบบริการ systemd ($SERVICE_NAME) จึงสั่ง start ผ่าน systemctl"
    run_systemctl start "$SERVICE_NAME"
    log "เริ่ม $SERVICE_NAME แล้ว"
    if wait_for_dashboard; then
        print_access_urls
    else
        warn "service ถูกสั่งเริ่มแล้ว แต่หน้าเว็บยังไม่ตอบทันที ลองเปิดใหม่อีกครั้งในอีก 2-3 วินาที"
        print_access_urls
    fi
    exit 0
fi

log "ยังไม่ได้ติดตั้ง systemd service จึงรัน stack ตรงตามเดิม"
exec "$RUNNER_PATH"
