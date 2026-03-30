import atexit
import threading

import lgpio

from config import LIGHT_ACTIVE_LOW, LIGHT_PIN

_lock = threading.RLock()
_chip_handle = None
_state = False


def _logical_to_raw(is_on: bool) -> int:
    if LIGHT_ACTIVE_LOW:
        return 0 if is_on else 1
    return 1 if is_on else 0


def _read_raw_level() -> int:
    if _chip_handle is None:
        return _logical_to_raw(_state)
    return lgpio.gpio_read(_chip_handle, LIGHT_PIN)


def _ensure_initialized():
    global _chip_handle

    if _chip_handle is not None:
        return

    _chip_handle = lgpio.gpiochip_open(0)
    lgpio.gpio_claim_output(_chip_handle, LIGHT_PIN)
    lgpio.gpio_write(_chip_handle, LIGHT_PIN, _logical_to_raw(False))


def _build_status():
    return {
        "pin": LIGHT_PIN,
        "is_on": _state,
        "active_low": LIGHT_ACTIVE_LOW,
        "raw_level": _read_raw_level(),
    }


def light_on():
    global _state

    with _lock:
        _ensure_initialized()
        lgpio.gpio_write(_chip_handle, LIGHT_PIN, _logical_to_raw(True))
        _state = True
        return _build_status()


def light_off():
    global _state

    with _lock:
        _ensure_initialized()
        lgpio.gpio_write(_chip_handle, LIGHT_PIN, _logical_to_raw(False))
        _state = False
        return _build_status()


def get_light_status():
    with _lock:
        return _build_status()


def cleanup():
    global _chip_handle
    global _state

    with _lock:
        if _chip_handle is None:
            return

        lgpio.gpio_write(_chip_handle, LIGHT_PIN, _logical_to_raw(False))
        lgpio.gpiochip_close(_chip_handle)
        _chip_handle = None
        _state = False


atexit.register(cleanup)
