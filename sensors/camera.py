import cv2
from sensors.coverage import calculate_coverage

camera = cv2.VideoCapture("/dev/video0")

coverage_value = 0

def gen_frames():
    global coverage_value

    while True:
        success, frame = camera.read()
        if not success:
            break

        coverage_value = calculate_coverage(frame)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

def get_coverage():
    return coverage_value
