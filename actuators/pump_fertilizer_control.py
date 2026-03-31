import atexit
import threading
import time

from gpiozero import OutputDevice

from config import PUMP_FERTILIZER_ACTIVE_LOW, PUMP_FERTILIZER_PINS


_lock = threading.RLock()
_pumps = []


def _build_pump_status(pump: dict):
    remaining_seconds = 0.0
    if pump["is_running"] and pump["started_at"] is not None:
        elapsed = time.time() - pump["started_at"]
        remaining_seconds = max(pump["duration_seconds"] - elapsed, 0.0)

    return {
        "id": pump["id"],
        "pin": pump["pin"],
        "active_low": PUMP_FERTILIZER_ACTIVE_LOW,
        "is_running": pump["is_running"],
        "duration_seconds": pump["duration_seconds"],
        "remaining_seconds": round(remaining_seconds, 1),
    }


def _build_status():
    pumps = [_build_pump_status(pump) for pump in _pumps]
    running_count = sum(1 for pump in pumps if pump["is_running"])

    return {
        "pump_count": len(pumps),
        "running_count": running_count,
        "active_low": PUMP_FERTILIZER_ACTIVE_LOW,
        "pumps": pumps,
    }


def _ensure_initialized():
    global _pumps

    if _pumps:
        return

    if not PUMP_FERTILIZER_PINS:
        raise ValueError("PUMP_FERTILIZER_PINS must contain at least one GPIO pin")

    _pumps = []
    for idx, pin in enumerate(PUMP_FERTILIZER_PINS, start=1):
        device = OutputDevice(
            pin,
            active_high=not PUMP_FERTILIZER_ACTIVE_LOW,
            initial_value=False,
        )
        device.off()
        _pumps.append(
            {
                "id": idx,
                "pin": pin,
                "device": device,
                "is_running": False,
                "started_at": None,
                "duration_seconds": 0.0,
                "worker": None,
                "run_token": 0,
            }
        )


def _get_pump_locked(pump_id: int):
    _ensure_initialized()

    if not (1 <= pump_id <= len(_pumps)):
        raise ValueError(f"fertilizer pump {pump_id} does not exist")

    return _pumps[pump_id - 1]


def _stop_pump_locked(pump: dict):
    pump["device"].off()
    pump["is_running"] = False
    pump["started_at"] = None
    pump["duration_seconds"] = 0.0


def _run_for_duration(pump_id: int, duration_seconds: float, token: int):
    try:
        time.sleep(duration_seconds)
    finally:
        with _lock:
            pump = _get_pump_locked(pump_id)
            if token == pump["run_token"]:
                _stop_pump_locked(pump)


def _start_pump_locked(pump: dict, duration_seconds: float):
    if pump["is_running"]:
        raise ValueError(f"fertilizer pump {pump['id']} is already running")

    pump["device"].on()
    pump["is_running"] = True
    pump["started_at"] = time.time()
    pump["duration_seconds"] = duration_seconds
    pump["run_token"] += 1
    token = pump["run_token"]
    pump["worker"] = threading.Thread(
        target=_run_for_duration,
        args=(pump["id"], duration_seconds, token),
        daemon=True,
    )
    pump["worker"].start()
    return _build_pump_status(pump)


def run_fertilizer_pump(pump_id: int, duration_seconds: float):
    duration_seconds = float(duration_seconds)
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be greater than 0")

    with _lock:
        pump = _get_pump_locked(int(pump_id))
        return _start_pump_locked(pump, duration_seconds)


def stop_fertilizer_pump(pump_id: int):
    with _lock:
        pump = _get_pump_locked(int(pump_id))
        pump["run_token"] += 1
        _stop_pump_locked(pump)
        return _build_pump_status(pump)


def run_all_fertilizer_pumps(duration_seconds: float):
    duration_seconds = float(duration_seconds)
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be greater than 0")

    with _lock:
        _ensure_initialized()
        for pump in _pumps:
            if pump["is_running"]:
                raise ValueError(
                    f"fertilizer pump {pump['id']} is already running"
                )

        for pump in _pumps:
            _start_pump_locked(pump, duration_seconds)

        return _build_status()


def stop_all_fertilizer_pumps():
    with _lock:
        if not _pumps:
            return _build_status()

        for pump in _pumps:
            pump["run_token"] += 1
            _stop_pump_locked(pump)

        return _build_status()


def get_pump_fertilizer_status():
    with _lock:
        _ensure_initialized()
        return _build_status()


atexit.register(stop_all_fertilizer_pumps)
