import cv2
import numpy as np

from config import (
    COVERAGE_H_MAX,
    COVERAGE_H_MIN,
    COVERAGE_ROI_HEIGHT,
    COVERAGE_ROI_WIDTH,
    COVERAGE_ROI_X,
    COVERAGE_ROI_Y,
    COVERAGE_S_MIN,
    COVERAGE_V_MIN,
)


def decode_jpeg_bytes(frame_bytes: bytes):
    buffer = np.frombuffer(frame_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("cannot decode JPEG bytes for coverage analysis")
    return image


def _get_roi_bounds(image):
    height, width = image.shape[:2]
    x = min(COVERAGE_ROI_X, max(width - 1, 0))
    y = min(COVERAGE_ROI_Y, max(height - 1, 0))

    roi_width = COVERAGE_ROI_WIDTH or max(width - x, 1)
    roi_height = COVERAGE_ROI_HEIGHT or max(height - y, 1)
    roi_width = max(min(roi_width, width - x), 1)
    roi_height = max(min(roi_height, height - y), 1)

    return {
        "x": x,
        "y": y,
        "width": roi_width,
        "height": roi_height,
    }


def _build_overlay_image(image, mask, roi, coverage_percent: float):
    overlay = image.copy()
    mask_bgr = np.zeros_like(overlay)
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]

    roi_mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    mask_bgr[y : y + height, x : x + width] = roi_mask_bgr

    green_highlight = np.zeros_like(overlay)
    green_highlight[:, :, 1] = mask_bgr[:, :, 0]
    overlay = cv2.addWeighted(overlay, 1.0, green_highlight, 0.45, 0.0)

    cv2.rectangle(
        overlay,
        (x, y),
        (x + width - 1, y + height - 1),
        (255, 210, 80),
        2,
    )
    cv2.putText(
        overlay,
        f"Coverage {coverage_percent:.2f}%",
        (16, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.95,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return overlay


def _build_mask_preview(mask, image_shape, roi):
    preview = np.zeros(image_shape, dtype=np.uint8)
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]

    roi_mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    preview[y : y + height, x : x + width] = roi_mask_bgr

    cv2.rectangle(
        preview,
        (x, y),
        (x + width - 1, y + height - 1),
        (0, 255, 255),
        2,
    )
    cv2.putText(
        preview,
        "Green mask",
        (16, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.95,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return preview


def analyze_green_coverage_image(image):
    roi = _get_roi_bounds(image)
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]

    roi_image = image[y : y + height, x : x + width]
    hsv = cv2.cvtColor(roi_image, cv2.COLOR_BGR2HSV)

    lower_green = np.array(
        [COVERAGE_H_MIN, COVERAGE_S_MIN, COVERAGE_V_MIN],
        dtype=np.uint8,
    )
    upper_green = np.array([COVERAGE_H_MAX, 255, 255], dtype=np.uint8)

    mask = cv2.inRange(hsv, lower_green, upper_green)
    kernel = np.ones((5, 5), dtype=np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    green_pixels = int(cv2.countNonZero(mask))
    total_pixels = int(mask.size)
    coverage_percent = 0.0
    if total_pixels > 0:
        coverage_percent = round((green_pixels * 100.0) / total_pixels, 2)

    overlay_image = _build_overlay_image(image, mask, roi, coverage_percent)
    mask_preview_image = _build_mask_preview(mask, image.shape, roi)

    return {
        "green_coverage_percent": coverage_percent,
        "green_pixels": green_pixels,
        "total_pixels": total_pixels,
        "coverage_method": "hsv_threshold_v1",
        "roi": roi,
        "thresholds": {
            "h_min": COVERAGE_H_MIN,
            "h_max": COVERAGE_H_MAX,
            "s_min": COVERAGE_S_MIN,
            "v_min": COVERAGE_V_MIN,
        },
        "mask_image": mask,
        "mask_preview_image": mask_preview_image,
        "overlay_image": overlay_image,
    }


def analyze_green_coverage_bytes(frame_bytes: bytes):
    image = decode_jpeg_bytes(frame_bytes)
    return {
        "image": image,
        **analyze_green_coverage_image(image),
    }
