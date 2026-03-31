#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
    printf '[stop] %s\n' "$1"
}

warn() {
    printf '[warn] %s\n' "$1" >&2
}

SUBSCRIBER_PATTERN="python -u mqtt/subscriber.py"
PUBLISHER_PATTERN="python -u mqtt/publisher.py"
API_PATTERN="uvicorn api.api:app --host 0.0.0.0 --port 8000"

STOPPED_ANY=0

stop_pattern() {
    local name="$1"
    local pattern="$2"
    local pid
    local pids=()
    local still_running=()

    mapfile -t pids < <(pgrep -f "$pattern" || true)

    if [ "${#pids[@]}" -eq 0 ]; then
        log "$name ไม่ได้ทำงานอยู่"
        return
    fi

    STOPPED_ANY=1
    log "กำลังหยุด $name (${#pids[@]} process)"
    for pid in "${pids[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done

    sleep 1

    still_running=()
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            still_running+=("$pid")
        fi
    done

    if [ "${#still_running[@]}" -eq 0 ]; then
        log "$name หยุดแล้ว"
        return
    fi

    warn "$name ยังไม่หยุดหลัง SIGTERM จึงกำลังส่ง SIGKILL"
    for pid in "${still_running[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done

    sleep 1

    for pid in "${still_running[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            warn "$name PID $pid ยังไม่หยุด"
        fi
    done

    log "$name ถูกสั่งหยุดแล้ว"
}

stop_pattern "publisher" "$PUBLISHER_PATTERN"
stop_pattern "api" "$API_PATTERN"
stop_pattern "subscriber" "$SUBSCRIBER_PATTERN"

if [ "$STOPPED_ANY" -eq 0 ]; then
    log "ไม่พบ process ของ stack นี้ที่กำลังทำงานอยู่"
else
    log "หยุด stack เรียบร้อยแล้ว"
fi
