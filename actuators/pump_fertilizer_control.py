import atexit
import threading
import time

from gpiozero import OutputDevice
from config import PUMP_FERTILIZER_ACTIVE_LOW, PUMP_FERTILIZER_PINS


_lock = threading.RLock()
_devices = []
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
        "pins": list(PUMP_FERTILIZER_PINS),
        "pin_count": len(PUMP_FERTILIZER_PINS),
        "active_low": PUMP_FERTILIZER_ACTIVE_LOW,
        "is_running": _is_running,
        "duration_seconds": _duration_seconds,
        "remaining_seconds": round(remaining_seconds, 1),
    }


def _ensure_initialized():
    global _devices

    if _devices:
        return

    if not PUMP_FERTILIZER_PINS:
        raise ValueError("PUMP_FERTILIZER_PINS must contain at least one GPIO pin")

    _devices = [
        OutputDevice(
            pin,
            active_high=not PUMP_FERTILIZER_ACTIVE_LOW,
            initial_value=False,
        )
        for pin in PUMP_FERTILIZER_PINS
    ]

    for device in _devices:
        device.off()


def _set_all_devices(is_on: bool):
    for device in _devices:
        if is_on:
            device.on()
        else:
            device.off()


def _stop_locked():
    global _is_running
    global _started_at
    global _duration_seconds

    if _devices:
        _set_all_devices(False)
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


def dispense_fertilizer(duration_seconds: float):
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
            raise ValueError("fertilizer pumps are already running")

        _ensure_initialized()
        _set_all_devices(True)
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


def stop_pump_fertilizer():
    global _is_running
    global _started_at
    global _duration_seconds
    global _run_token

    with _lock:
        _run_token += 1
        _stop_locked()
        return _build_status()


def get_pump_fertilizer_status():
    with _lock:
        return _build_status()


atexit.register(stop_pump_fertilizer)
