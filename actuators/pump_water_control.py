import atexit
import threading
import time

from gpiozero import OutputDevice
from config import PUMP_WATER_ACTIVE_LOW, PUMP_WATER_PIN


_lock = threading.RLock()
_device = None
_is_running = False
_started_at = None
_duration_seconds = 0.0
_worker = None
_run_token = 0


def _build_status():
    remaining_seconds = 0.0
    if _is_running and _started_at is not None:
        elapsed = time.time() - _started_at
        remaining_seconds = max(_duration_seconds - elapsed, 0.0)

    return {
        "pin": PUMP_WATER_PIN,
        "active_low": PUMP_WATER_ACTIVE_LOW,
        "is_running": _is_running,
        "duration_seconds": _duration_seconds,
        "remaining_seconds": round(remaining_seconds, 1),
    }


def _ensure_initialized():
    global _device

    if _device is not None:
        return

    _device = OutputDevice(
        PUMP_WATER_PIN,
        active_high=not PUMP_WATER_ACTIVE_LOW,
        initial_value=False,
    )
    _device.off()


def _stop_locked():
    global _is_running
    global _started_at
    global _duration_seconds

    if _device is not None:
        _device.off()
    _is_running = False
    _started_at = None
    _duration_seconds = 0.0


def _run_for_duration(duration_seconds: float, token: int):
    try:
        time.sleep(duration_seconds)
    finally:
        with _lock:
            if token == _run_token:
                _stop_locked()


def run_pump_water(duration_seconds: float):
    global _is_running
    global _started_at
    global _duration_seconds
    global _worker
    global _run_token

    duration_seconds = float(duration_seconds)
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be greater than 0")

    with _lock:
        if _is_running:
            raise ValueError("water pump is already running")

        _ensure_initialized()
        _device.on()
        _is_running = True
        _started_at = time.time()
        _duration_seconds = duration_seconds
        _run_token += 1
        token = _run_token
        _worker = threading.Thread(
            target=_run_for_duration,
            args=(duration_seconds, token),
            daemon=True,
        )
        _worker.start()
        return _build_status()


def stop_pump_water():
    global _is_running
    global _started_at
    global _duration_seconds
    global _run_token

    with _lock:
        _run_token += 1
        _stop_locked()
        return _build_status()


def get_pump_water_status():
    with _lock:
        return _build_status()


atexit.register(stop_pump_water)
