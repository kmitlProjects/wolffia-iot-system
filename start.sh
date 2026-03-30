#!/bin/bash

set -u

log() {
    printf '[start] %s\n' "$1"
}

warn() {
    printf '[warn] %s\n' "$1" >&2
}

error() {
    printf '[error] %s\n' "$1" >&2
}

PIDS=()
NAMES=()
CLEANUP_DONE=0

cleanup() {
    if [ "$CLEANUP_DONE" -eq 1 ]; then
        return
    fi

    CLEANUP_DONE=1

    local pid
    local idx
    local name

    for idx in "${!PIDS[@]}"; do
        pid="${PIDS[$idx]}"
        name="${NAMES[$idx]}"

        if kill -0 -- "-$pid" 2>/dev/null || kill -0 "$pid" 2>/dev/null; then
            log "กำลังหยุด $name (PID: $pid)"
            kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    sleep 1

    for idx in "${!PIDS[@]}"; do
        pid="${PIDS[$idx]}"
        name="${NAMES[$idx]}"

        if kill -0 -- "-$pid" 2>/dev/null || kill -0 "$pid" 2>/dev/null; then
            warn "$name ยังไม่หยุดหลัง SIGTERM จึงกำลังส่ง SIGKILL"
            kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
        fi
    done

    for pid in "${PIDS[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}

is_local_host() {
    case "$1" in
        localhost|127.0.0.1|::1)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

check_local_process() {
    local service_name="$1"
    local host="$2"
    local pattern="$3"

    if ! is_local_host "$host"; then
        log "$service_name ถูกตั้งค่าไปที่ $host จึงข้ามการเช็ก process บนเครื่องนี้"
        return
    fi

    if pgrep -f "$pattern" >/dev/null 2>&1; then
        log "พบ process ของ $service_name บนเครื่องนี้"
    else
        warn "ไม่พบ process ของ $service_name บนเครื่องนี้"
    fi
}

check_tcp_port() {
    local service_name="$1"
    local host="$2"
    local port="$3"

    if python -c 'import socket, sys; sock = socket.socket(); sock.settimeout(1); sock.connect((sys.argv[1], int(sys.argv[2]))); sock.close()' "$host" "$port" >/dev/null 2>&1; then
        log "$service_name เชื่อมถึงได้ที่ $host:$port"
    else
        warn "$service_name เชื่อมไม่ถึงที่ $host:$port"
    fi
}

load_runtime_targets() {
    mapfile -t runtime_targets < <(
        python -c 'from urllib.parse import urlparse; from config import MONGO_URI, MQTT_BROKER, MQTT_PORT; mongo = urlparse(MONGO_URI); print(MQTT_BROKER); print(MQTT_PORT); print(mongo.hostname or "localhost"); print(mongo.port or 27017)'
    )

    MQTT_HOST="${runtime_targets[0]}"
    MQTT_PORT="${runtime_targets[1]}"
    MONGO_HOST="${runtime_targets[2]}"
    MONGO_PORT="${runtime_targets[3]}"
}

start_component() {
    local name="$1"
    shift

    log "กำลังเริ่ม $name ..."
    setsid "$@" \
        > >(while IFS= read -r line; do printf '[%s] %s\n' "$name" "$line"; done) \
        2> >(while IFS= read -r line; do printf '[%s] %s\n' "$name" "$line" >&2; done) &

    local pid=$!
    PIDS+=("$pid")
    NAMES+=("$name")

    sleep 2

    if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid"
        local status=$?
        error "$name ล้มเหลวระหว่างเริ่มระบบ (exit code: $status)"
        return "$status"
    fi

    log "$name เริ่มทำงานแล้ว (PID: $pid)"
}

monitor_components() {
    while true; do
        local idx
        for idx in "${!PIDS[@]}"; do
            local pid="${PIDS[$idx]}"
            local name="${NAMES[$idx]}"

            if ! kill -0 "$pid" 2>/dev/null; then
                wait "$pid"
                local status=$?
                error "$name หยุดทำงานระหว่างรัน (exit code: $status)"
                return "$status"
            fi
        done

        sleep 2
    done
}

handle_interrupt() {
    warn "ได้รับสัญญาณหยุด กำลังปิดทุก component ..."
    cleanup
    exit 130
}

trap 'handle_interrupt' INT TERM

if [ ! -f venv/bin/activate ]; then
    error "ไม่พบ virtualenv ที่ venv/bin/activate"
    exit 1
fi

source venv/bin/activate
load_runtime_targets

log "ตรวจสอบ service ที่ต้องใช้ก่อนเริ่มระบบ"
check_local_process "mosquitto" "$MQTT_HOST" "mosquitto"
check_tcp_port "mosquitto" "$MQTT_HOST" "$MQTT_PORT"
check_local_process "mongod" "$MONGO_HOST" "mongod"
check_tcp_port "mongod" "$MONGO_HOST" "$MONGO_PORT"

start_component "subscriber" python -u mqtt/subscriber.py || {
    cleanup
    exit 1
}

start_component "publisher" python -u mqtt/publisher.py || {
    cleanup
    exit 1
}

start_component "api" python -u -m uvicorn api.api:app --host 0.0.0.0 --port 8000 || {
    cleanup
    exit 1
}

log "ทุก component เริ่มทำงานแล้ว กำลังเฝ้าดูสถานะ..."
monitor_components
STATUS=$?
cleanup
exit $STATUS
