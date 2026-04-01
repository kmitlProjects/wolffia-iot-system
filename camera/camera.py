import threading
import time

import cv2

from config import CAMERA_DEVICE


_camera = None
_camera_lock = threading.Lock()
_frame_condition = threading.Condition()
_capture_thread = None
_capture_started = False
_latest_frame = None
_frame_sequence = 0
_last_frame_at = None
_last_error = None
_stream_client_count = 0
_last_demand_at = 0.0
_IDLE_RELEASE_SECONDS = 3.0


def _set_camera_error(message):
    global _last_error
    _last_error = message


def _set_latest_frame(frame_bytes):
    global _latest_frame
    global _frame_sequence
    global _last_frame_at
    global _last_error

    with _frame_condition:
        _latest_frame = frame_bytes
        _frame_sequence += 1
        _last_frame_at = time.time()
        _last_error = None
        _frame_condition.notify_all()


def _mark_camera_demand():
    global _last_demand_at
    _last_demand_at = time.monotonic()


def _release_camera_locked():
    global _camera

    if _camera is not None:
        _camera.release()
        _camera = None


def _camera_should_be_active(now_monotonic: float):
    if _stream_client_count > 0:
        return True

    return (now_monotonic - _last_demand_at) <= _IDLE_RELEASE_SECONDS


def _open_camera_locked():
    global _camera

    if _camera is not None and _camera.isOpened():
        return _camera

    backends = []
    if hasattr(cv2, "CAP_V4L2"):
        backends.append(cv2.CAP_V4L2)
    backends.append(cv2.CAP_ANY)

    for backend in backends:
        camera = cv2.VideoCapture(CAMERA_DEVICE, backend)
        if camera is None or not camera.isOpened():
            if camera is not None:
                camera.release()
            continue

        camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        _camera = camera
        _set_camera_error(None)
        return _camera

    _set_camera_error(f"cannot open camera device {CAMERA_DEVICE}")
    return None


def _capture_loop():
    while True:
        now_monotonic = time.monotonic()
        with _camera_lock:
            if not _camera_should_be_active(now_monotonic):
                _release_camera_locked()
                active_camera = None
            else:
                active_camera = _open_camera_locked()

        if active_camera is None:
            time.sleep(0.25)
            continue

        success, frame = active_camera.read()
        if not success or frame is None:
            _set_camera_error("camera read failed")
            with _camera_lock:
                _release_camera_locked()
            time.sleep(0.5)
            continue

        encoded_ok, buffer = cv2.imencode(".jpg", frame)
        if not encoded_ok:
            _set_camera_error("camera encode failed")
            time.sleep(0.1)
            continue

        _set_latest_frame(buffer.tobytes())


def _ensure_capture_thread():
    global _capture_thread
    global _capture_started

    with _camera_lock:
        if _capture_started and _capture_thread is not None and _capture_thread.is_alive():
            return

        _capture_started = True
        _capture_thread = threading.Thread(
            target=_capture_loop,
            name="camera-capture",
            daemon=True,
        )
        _capture_thread.start()


def get_camera_status():
    with _camera_lock:
        is_open = bool(_camera is not None and _camera.isOpened())
        stream_client_count = _stream_client_count

    return {
        "device": CAMERA_DEVICE,
        "is_open": is_open,
        "last_error": _last_error,
        "last_frame_at": _last_frame_at,
        "capture_started": _capture_started,
        "stream_client_count": stream_client_count,
    }


def get_latest_frame_bytes(timeout_seconds: float = 5.0, max_age_seconds: float = 2.0):
    _mark_camera_demand()
    _ensure_capture_thread()
    deadline = time.monotonic() + max(float(timeout_seconds), 0.1)

    while True:
        with _frame_condition:
            frame = _latest_frame
            last_frame_at = _last_frame_at

            if (
                frame is not None
                and last_frame_at is not None
                and (time.time() - last_frame_at) <= max_age_seconds
            ):
                return frame

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break

            _frame_condition.wait(timeout=min(remaining, 0.5))

    _set_camera_error("camera snapshot timed out")
    return None


def gen_frames():
    global _stream_client_count

    _mark_camera_demand()
    _ensure_capture_thread()
    last_seen_sequence = -1
    with _camera_lock:
        _stream_client_count += 1

    try:
        while True:
            with _frame_condition:
                if _frame_sequence == last_seen_sequence:
                    _frame_condition.wait(timeout=0.5)

                current_sequence = _frame_sequence
                frame = _latest_frame

            if frame is None:
                time.sleep(0.2)
                continue

            last_seen_sequence = current_sequence
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            )
    finally:
        with _camera_lock:
            _stream_client_count = max(_stream_client_count - 1, 0)
            _mark_camera_demand()
