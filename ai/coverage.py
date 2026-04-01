import cv2
import numpy as np

from config import (
    COVERAGE_H_MAX,
    COVERAGE_H_MIN,
    COVERAGE_ROI_CORNER_RADIUS,
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
    corner_radius = max(
        min(COVERAGE_ROI_CORNER_RADIUS, roi_width // 2, roi_height // 2),
        0,
    )

    return {
        "x": x,
        "y": y,
        "width": roi_width,
        "height": roi_height,
        "corner_radius": corner_radius,
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
    preview = cv2.addWeighted(
        image,
        0.42,
        np.zeros_like(image),
        0.58,
        0.0,
    )
    x = roi["x"]
    y = roi["y"]
    width = roi["width"]
    height = roi["height"]
    preview[y : y + height, x : x + width] = image[y : y + height, x : x + width]
    _draw_rounded_rectangle(preview, roi, (255, 210, 80), 2)
    cv2.putText(
        preview,
        "Water surface ROI",
        (16, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.95,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return preview


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

    _draw_rounded_rectangle(overlay, roi, (255, 210, 80), 2)
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

    _draw_rounded_rectangle(preview, roi, (0, 255, 255), 2)
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
    corner_radius = roi.get("corner_radius") or 0

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
    surface_mask = _build_surface_mask(width, height, corner_radius)
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
        "coverage_method": "hsv_threshold_v1",
        "roi": roi,
        "thresholds": {
            "h_min": COVERAGE_H_MIN,
            "h_max": COVERAGE_H_MAX,
            "s_min": COVERAGE_S_MIN,
            "v_min": COVERAGE_V_MIN,
        },
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
