import cv2
import numpy as np

def calculate_coverage(frame):

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    lower_green = np.array([35,40,40])
    upper_green = np.array([85,255,255])

    mask = cv2.inRange(hsv, lower_green, upper_green)

    green_pixels = np.count_nonzero(mask)
    total_pixels = mask.size

    coverage = (green_pixels / total_pixels) * 100

    return round(coverage,2)
