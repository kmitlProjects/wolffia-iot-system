#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
    printf '[restart] %s\n' "$1"
}

log "กำลังหยุด stack เดิมก่อน"
./stop.sh

log "กำลังเริ่ม stack ใหม่"
exec ./start.sh
