#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

log() {
    printf '[start] %s\n' "$1"
}

warn() {
    printf '[warn] %s\n' "$1" >&2
}

error() {
    printf '[error] %s\n' "$1" >&2
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

get_primary_ip() {
    local route_ip fallback_ip

    route_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
    if [ -n "$route_ip" ]; then
        printf '%s\n' "$route_ip"
        return
    fi

    fallback_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -n "$fallback_ip" ]; then
        printf '%s\n' "$fallback_ip"
    fi
}

sync_public_base_url() {
    local env_file="$SCRIPT_DIR/.env"
    local primary_ip desired_url current_url

    [ -f "$env_file" ] || return

    primary_ip="$(get_primary_ip || true)"
    [ -n "$primary_ip" ] || return

    desired_url="http://${primary_ip}:${API_PORT}"
    current_url="$(load_public_base_url || true)"

    if [ "$current_url" = "$desired_url" ]; then
        return
    fi

    if grep -q '^PUBLIC_BASE_URL=' "$env_file"; then
        sed -i "s|^PUBLIC_BASE_URL=.*$|PUBLIC_BASE_URL=${desired_url}|" "$env_file"
    else
        printf '\nPUBLIC_BASE_URL=%s\n' "$desired_url" >> "$env_file"
    fi

    log "อัปเดต PUBLIC_BASE_URL เป็น ${desired_url}"
}

build_access_urls() {
    ACCESS_URLS=()
    local hostname_value ip raw_public_base_url primary_ip

    append_unique_url "http://127.0.0.1:${API_PORT}"

    hostname_value="$(hostname 2>/dev/null || true)"
    if [ -n "$hostname_value" ]; then
        append_unique_url "http://${hostname_value}.local:${API_PORT}"
    fi

    primary_ip="$(get_primary_ip || true)"
    append_unique_url "${primary_ip:+http://${primary_ip}:${API_PORT}}"

    for ip in $(hostname -I 2>/dev/null); do
        append_unique_url "http://${ip}:${API_PORT}"
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
    printf '  - %s\n' "http://127.0.0.1:${API_PORT}/dashboard-state"
}

wait_for_dashboard() {
    local attempt

    for attempt in $(seq 1 20); do
        if curl -s -o /dev/null "http://127.0.0.1:${API_PORT}/dashboard-state"; then
            return 0
        fi
        sleep 0.5
    done

    return 1
}

PIDS=()
NAMES=()
CLEANUP_DONE=0
API_HOST="0.0.0.0"
API_PORT="8000"
SUBSCRIBER_PATTERN="python -u mqtt/subscriber.py"
PUBLISHER_PATTERN="python -u mqtt/publisher.py"
API_PATTERN="uvicorn api.api:app --host ${API_HOST} --port ${API_PORT}"

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

is_component_running() {
    local pattern="$1"
    pgrep -f "$pattern" >/dev/null 2>&1
}

is_tcp_port_in_use() {
    local port="$1"
    ss -H -ltn "( sport = :$port )" 2>/dev/null | grep -q .
}

log_tcp_port_usage() {
    local port="$1"
    local output

    output="$(ss -ltnp "( sport = :$port )" 2>/dev/null | tail -n +2)"
    if [ -z "$output" ]; then
        return
    fi

    warn "รายละเอียด process ที่กำลังใช้พอร์ต $port:"
    while IFS= read -r line; do
        warn "$line"
    done <<< "$output"
}

preflight_existing_stack() {
    local existing_components=()

    if is_component_running "$SUBSCRIBER_PATTERN"; then
        existing_components+=("subscriber")
    fi

    if is_component_running "$PUBLISHER_PATTERN"; then
        existing_components+=("publisher")
    fi

    if is_component_running "$API_PATTERN"; then
        existing_components+=("api")
    fi

    if [ "${#existing_components[@]}" -eq 3 ]; then
        log "พบ stack เดิมทำงานอยู่แล้ว (subscriber, publisher, api) จึงไม่เริ่มซ้ำ"
        log "หากต้องการ restart ให้หยุด process เดิมก่อนแล้วค่อยรัน ./start.sh ใหม่"
        return 10
    fi

    if [ "${#existing_components[@]}" -gt 0 ]; then
        error "พบ component ที่กำลังรันอยู่แล้ว: ${existing_components[*]}"
        error "กรุณาหยุด process เดิมก่อน เพื่อป้องกันการรันซ้ำ"
        return 1
    fi

    if is_tcp_port_in_use "$API_PORT"; then
        error "พอร์ต ${API_PORT} ถูกใช้งานอยู่แล้ว จึงไม่สามารถเริ่ม api ใหม่ได้"
        log_tcp_port_usage "$API_PORT"
        return 1
    fi

    return 0
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
sync_public_base_url

log "ตรวจสอบ service ที่ต้องใช้ก่อนเริ่มระบบ"
check_local_process "mosquitto" "$MQTT_HOST" "mosquitto"
check_tcp_port "mosquitto" "$MQTT_HOST" "$MQTT_PORT"
check_local_process "mongod" "$MONGO_HOST" "mongod"
check_tcp_port "mongod" "$MONGO_HOST" "$MONGO_PORT"

preflight_existing_stack
PREFLIGHT_STATUS=$?
if [ "$PREFLIGHT_STATUS" -eq 10 ]; then
    exit 0
fi
if [ "$PREFLIGHT_STATUS" -ne 0 ]; then
    exit 1
fi

start_component "subscriber" python -u mqtt/subscriber.py || {
    cleanup
    exit 1
}

start_component "api" python -u -m uvicorn api.api:app --host "$API_HOST" --port "$API_PORT" || {
    cleanup
    exit 1
}

start_component "publisher" python -u mqtt/publisher.py || {
    cleanup
    exit 1
}

log "ทุก component เริ่มทำงานแล้ว กำลังเฝ้าดูสถานะ..."
if wait_for_dashboard; then
    print_access_urls
else
    warn "ทุก component ขึ้นแล้ว แต่หน้าเว็บยังไม่ตอบทันที ลองเปิดใหม่อีกครั้งในอีก 2-3 วินาที"
    print_access_urls
fi
monitor_components
STATUS=$?
cleanup
exit $STATUS
