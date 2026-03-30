import cv2
import threading

from config import CAMERA_DEVICE

camera = None
camera_lock = threading.Lock()


def get_camera():
    global camera

    with camera_lock:
        if camera is None or not camera.isOpened():
            camera = cv2.VideoCapture(CAMERA_DEVICE)
        return camera

def gen_frames():
    active_camera = get_camera()

    while True:
        success, frame = active_camera.read()
        if not success:
            break

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
