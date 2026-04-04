import cv2
import numpy as np

from config import (
    COVERAGE_H_MAX,
    COVERAGE_H_MIN,
    COVERAGE_VERSION,
    COVERAGE_ROI_CORNER_RADIUS,
    COVERAGE_ROI_HEIGHT,
    COVERAGE_ROI_REFERENCE_HEIGHT,
    COVERAGE_ROI_REFERENCE_WIDTH,
    COVERAGE_ROI_WIDTH,
    COVERAGE_ROI_X,
    COVERAGE_ROI_Y,
    COVERAGE_S_MIN,
    COVERAGE_V_MIN,
)

COVERAGE_METHOD_NAME = "lab_clahe_exg_otsu_v3"


def decode_jpeg_bytes(frame_bytes: bytes):
    buffer = np.frombuffer(frame_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("cannot decode JPEG bytes for coverage analysis")
    return image


def _scale_roi_value(value: int, actual_size: int, reference_size: int):
    if value <= 0:
        return 0
    return max(int(round(value * actual_size / max(reference_size, 1))), 1)


def _get_roi_bounds(image):
    height, width = image.shape[:2]
    x = min(
        _scale_roi_value(COVERAGE_ROI_X, width, COVERAGE_ROI_REFERENCE_WIDTH),
        max(width - 1, 0),
    )
    y = min(
        _scale_roi_value(COVERAGE_ROI_Y, height, COVERAGE_ROI_REFERENCE_HEIGHT),
        max(height - 1, 0),
    )

    roi_width = _scale_roi_value(
        COVERAGE_ROI_WIDTH,
        width,
        COVERAGE_ROI_REFERENCE_WIDTH,
    ) or max(width - x, 1)
    roi_height = _scale_roi_value(
        COVERAGE_ROI_HEIGHT,
        height,
        COVERAGE_ROI_REFERENCE_HEIGHT,
    ) or max(height - y, 1)
    roi_width = max(min(roi_width, width - x), 1)
    roi_height = max(min(roi_height, height - y), 1)
    corner_radius = _scale_roi_value(
        COVERAGE_ROI_CORNER_RADIUS,
        min(width, height),
        min(COVERAGE_ROI_REFERENCE_WIDTH, COVERAGE_ROI_REFERENCE_HEIGHT),
    )
    corner_radius = max(
        min(corner_radius, roi_width // 2, roi_height // 2),
        0,
    )

    return {
        "x": x,
        "y": y,
        "width": roi_width,
        "height": roi_height,
        "corner_radius": corner_radius,
        "reference_width": COVERAGE_ROI_REFERENCE_WIDTH,
        "reference_height": COVERAGE_ROI_REFERENCE_HEIGHT,
    }


def _draw_rounded_rectangle(image, roi, color, thickness=2):
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]
    radius = max(int(roi.get("corner_radius") or 0), 0)

    if radius <= 0:
        cv2.rectangle(
            image,
            (x, y),
            (x + width - 1, y + height - 1),
            color,
            thickness,
        )
        return

    left = x
    top = y
    right = x + width - 1
    bottom = y + height - 1

    cv2.line(
        image,
        (left + radius, top),
        (right - radius, top),
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.line(
        image,
        (right, top + radius),
        (right, bottom - radius),
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.line(
        image,
        (left + radius, bottom),
        (right - radius, bottom),
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.line(
        image,
        (left, top + radius),
        (left, bottom - radius),
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.ellipse(
        image,
        (left + radius, top + radius),
        (radius, radius),
        180,
        0,
        90,
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.ellipse(
        image,
        (right - radius, top + radius),
        (radius, radius),
        270,
        0,
        90,
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.ellipse(
        image,
        (right - radius, bottom - radius),
        (radius, radius),
        0,
        0,
        90,
        color,
        thickness,
        cv2.LINE_AA,
    )
    cv2.ellipse(
        image,
        (left + radius, bottom - radius),
        (radius, radius),
        90,
        0,
        90,
        color,
        thickness,
        cv2.LINE_AA,
    )


def _build_surface_mask(width: int, height: int, corner_radius: int):
    mask = np.zeros((height, width), dtype=np.uint8)
    radius = max(min(int(corner_radius), width // 2, height // 2), 0)
    if radius <= 0:
        mask[:, :] = 255
        return mask

    cv2.rectangle(mask, (radius, 0), (width - radius - 1, height - 1), 255, -1)
    cv2.rectangle(mask, (0, radius), (width - 1, height - radius - 1), 255, -1)
    cv2.circle(mask, (radius, radius), radius, 255, -1)
    cv2.circle(mask, (width - radius - 1, radius), radius, 255, -1)
    cv2.circle(mask, (radius, height - radius - 1), radius, 255, -1)
    cv2.circle(
        mask,
        (width - radius - 1, height - radius - 1),
        radius,
        255,
        -1,
    )
    return mask


def _build_roi_preview_image(image, roi):
    return image.copy()


def _enhance_roi_for_green_detection(roi_image):
    lab = cv2.cvtColor(roi_image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l_channel)
    enhanced = cv2.cvtColor(
        cv2.merge([enhanced_l, a_channel, b_channel]),
        cv2.COLOR_LAB2BGR,
    )
    return cv2.GaussianBlur(enhanced, (3, 3), 0)


def _build_green_mask(roi_image, surface_mask):
    enhanced_roi = _enhance_roi_for_green_detection(roi_image)
    hsv = cv2.cvtColor(enhanced_roi, cv2.COLOR_BGR2HSV)

    h_min = max(COVERAGE_H_MIN - 15, 20)
    h_max = min(COVERAGE_H_MAX + 15, 110)
    s_min = max(COVERAGE_S_MIN - 30, 10)
    v_min = max(COVERAGE_V_MIN - 20, 20)

    lower_green = np.array([h_min, s_min, v_min], dtype=np.uint8)
    upper_green = np.array([h_max, 255, 255], dtype=np.uint8)
    hue_mask = cv2.inRange(hsv, lower_green, upper_green)

    blue_channel, green_channel, red_channel = cv2.split(enhanced_roi)
    exg = (
        2 * green_channel.astype(np.int16)
        - red_channel.astype(np.int16)
        - blue_channel.astype(np.int16)
    )
    exg_normalized = np.clip(exg + 128, 0, 255).astype(np.uint8)
    _, exg_mask = cv2.threshold(
        exg_normalized,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )

    mask = cv2.bitwise_and(hue_mask, exg_mask)
    mask = cv2.bitwise_and(mask, surface_mask)

    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel)

    return mask, {
        "h_min": h_min,
        "h_max": h_max,
        "s_min": s_min,
        "v_min": v_min,
        "exg_threshold": "otsu",
        "preprocess": "lab_clahe_gaussian_blur",
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
    return overlay


def _build_mask_preview(mask, image_shape, roi):
    preview = np.zeros(image_shape, dtype=np.uint8)
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]

    roi_mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    preview[y : y + height, x : x + width] = roi_mask_bgr
    return preview


def analyze_green_coverage_image(image):
    roi = _get_roi_bounds(image)
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]
    corner_radius = roi.get("corner_radius") or 0

    surface_mask = _build_surface_mask(width, height, corner_radius)
    roi_image = image[y : y + height, x : x + width]
    mask, thresholds = _build_green_mask(roi_image, surface_mask)
    mask = cv2.bitwise_and(mask, surface_mask)

    green_pixels = int(cv2.countNonZero(mask))
    total_pixels = int(cv2.countNonZero(surface_mask))
    coverage_percent = 0.0
    if total_pixels > 0:
        coverage_percent = round((green_pixels * 100.0) / total_pixels, 2)

    roi_preview_image = _build_roi_preview_image(image, roi)
    overlay_image = _build_overlay_image(image, mask, roi, coverage_percent)
    mask_preview_image = _build_mask_preview(mask, image.shape, roi)

    return {
        "green_coverage_percent": coverage_percent,
        "green_pixels": green_pixels,
        "total_pixels": total_pixels,
        "coverage_method": COVERAGE_METHOD_NAME,
        "coverage_version": COVERAGE_VERSION,
        "roi": roi,
        "thresholds": thresholds,
        "image_width": int(image.shape[1]),
        "image_height": int(image.shape[0]),
        "roi_preview_image": roi_preview_image,
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
