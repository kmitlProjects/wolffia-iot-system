import argparse
import csv
import os
import re
import shutil
import sys
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
TIMESTAMP_PATTERN = re.compile(
    r"(?P<date>\d{4}-\d{2}-\d{2})-(?P<hour>\d{2})\.(?P<minute>\d{2})"
)
ROI_OVERRIDES = {
    # This frame is rotated significantly compared with the rest of the series.
    "2026-03-22-19.30_6.png": {
        "x": 1700,
        "y": 1000,
        "width": 1700,
        "height": 1450,
        "label": "manual_override",
    }
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a growth coverage dataset from ordered test images.",
    )
    parser.add_argument(
        "--input-dir",
        default="test/test_image",
        help="Directory containing chronological image files.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/exports/test_growth_dataset",
        help="Directory for renamed images and coverage debug assets.",
    )
    parser.add_argument(
        "--output-csv",
        default="data/exports/test_growth_dataset/growth_dataset.csv",
        help="Path to the generated training CSV.",
    )
    parser.add_argument("--cycle-id", default=None, help="Optional cycle id label.")
    parser.add_argument("--roi-x", type=int, default=900)
    parser.add_argument("--roi-y", type=int, default=1200)
    parser.add_argument("--roi-width", type=int, default=2400)
    parser.add_argument("--roi-height", type=int, default=1050)
    parser.add_argument("--h-min", type=int, default=35)
    parser.add_argument("--h-max", type=int, default=95)
    parser.add_argument("--s-min", type=int, default=40)
    parser.add_argument("--v-min", type=int, default=40)
    parser.add_argument("--mock-temp-start", type=float, default=28.0)
    parser.add_argument("--mock-temp-step", type=float, default=0.15)
    parser.add_argument("--mock-ph-start", type=float, default=6.8)
    parser.add_argument("--mock-ph-step", type=float, default=0.0)
    return parser.parse_args()


def set_coverage_env(args):
    os.environ["COVERAGE_ROI_X"] = str(args.roi_x)
    os.environ["COVERAGE_ROI_Y"] = str(args.roi_y)
    os.environ["COVERAGE_ROI_WIDTH"] = str(args.roi_width)
    os.environ["COVERAGE_ROI_HEIGHT"] = str(args.roi_height)
    os.environ["COVERAGE_H_MIN"] = str(args.h_min)
    os.environ["COVERAGE_H_MAX"] = str(args.h_max)
    os.environ["COVERAGE_S_MIN"] = str(args.s_min)
    os.environ["COVERAGE_V_MIN"] = str(args.v_min)


def set_roi_env(x: int, y: int, width: int, height: int):
    os.environ["COVERAGE_ROI_X"] = str(x)
    os.environ["COVERAGE_ROI_Y"] = str(y)
    os.environ["COVERAGE_ROI_WIDTH"] = str(width)
    os.environ["COVERAGE_ROI_HEIGHT"] = str(height)


def apply_runtime_coverage_settings(coverage_module, args, roi_override=None):
    roi_x = roi_override["x"] if roi_override else args.roi_x
    roi_y = roi_override["y"] if roi_override else args.roi_y
    roi_width = roi_override["width"] if roi_override else args.roi_width
    roi_height = roi_override["height"] if roi_override else args.roi_height

    set_roi_env(roi_x, roi_y, roi_width, roi_height)
    coverage_module.COVERAGE_ROI_X = roi_x
    coverage_module.COVERAGE_ROI_Y = roi_y
    coverage_module.COVERAGE_ROI_WIDTH = roi_width
    coverage_module.COVERAGE_ROI_HEIGHT = roi_height
    coverage_module.COVERAGE_H_MIN = args.h_min
    coverage_module.COVERAGE_H_MAX = args.h_max
    coverage_module.COVERAGE_S_MIN = args.s_min
    coverage_module.COVERAGE_V_MIN = args.v_min

    return roi_x, roi_y, roi_width, roi_height


def iter_image_files(input_dir: Path):
    return sorted(
        path
        for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def parse_captured_at(path: Path):
    match = TIMESTAMP_PATTERN.search(path.stem)
    if not match:
        return None

    return f"{match.group('date')}T{match.group('hour')}:{match.group('minute')}:00"


def mock_value(start: float, step: float, day_index: int):
    return round(start + step * (day_index - 1), 2)


def mock_source(step: float):
    return "mock_linear" if abs(step) > 1e-9 else "mock_constant"


def build_cycle_id(files, override: str | None):
    if override:
        return override

    first_name = files[0].stem
    date_match = TIMESTAMP_PATTERN.search(first_name)
    if date_match:
        return f"test_cycle_{date_match.group('date').replace('-', '')}"

    return "test_cycle_ordered_images"


def main():
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_csv = Path(args.output_csv)

    if not input_dir.exists():
        raise SystemExit(f"input directory not found: {input_dir}")

    files = iter_image_files(input_dir)
    if not files:
        raise SystemExit(f"no image files found in: {input_dir}")

    set_coverage_env(args)
    import ai.coverage as coverage_module

    renamed_dir = output_dir / "renamed_images"
    debug_dir = output_dir / "coverage_debug"
    renamed_dir.mkdir(parents=True, exist_ok=True)
    debug_dir.mkdir(parents=True, exist_ok=True)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    cycle_id = build_cycle_id(files, args.cycle_id)
    total_days = len(files)
    temp_source = mock_source(args.mock_temp_step)
    ph_source = mock_source(args.mock_ph_step)

    fieldnames = [
        "cycle_id",
        "day_index",
        "days_to_harvest",
        "captured_at",
        "source_filename",
        "renamed_filename",
        "green_coverage_percent",
        "roi_profile",
        "temp_c",
        "temp_source",
        "ph",
        "ph_source",
        "roi_x",
        "roi_y",
        "roi_width",
        "roi_height",
        "h_min",
        "h_max",
        "s_min",
        "v_min",
    ]

    with output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        for day_index, path in enumerate(files, start=1):
            roi_override = ROI_OVERRIDES.get(path.name)
            roi_x, roi_y, roi_width, roi_height = apply_runtime_coverage_settings(
                coverage_module,
                args,
                roi_override,
            )

            image = cv2.imread(str(path))
            if image is None:
                raise RuntimeError(f"cannot read image: {path}")

            analysis = coverage_module.analyze_green_coverage_image(image)
            renamed_filename = f"day_{day_index:02d}{path.suffix.lower()}"
            shutil.copy2(path, renamed_dir / renamed_filename)
            cv2.imwrite(
                str(debug_dir / f"day_{day_index:02d}.mask.png"),
                analysis["mask_preview_image"],
            )
            cv2.imwrite(
                str(debug_dir / f"day_{day_index:02d}.overlay.jpg"),
                analysis["overlay_image"],
            )

            writer.writerow(
                {
                    "cycle_id": cycle_id,
                    "day_index": day_index,
                    "days_to_harvest": total_days - day_index,
                    "captured_at": parse_captured_at(path),
                    "source_filename": path.name,
                    "renamed_filename": renamed_filename,
                    "green_coverage_percent": analysis["green_coverage_percent"],
                    "roi_profile": (
                        roi_override["label"] if roi_override else "default"
                    ),
                    "temp_c": mock_value(args.mock_temp_start, args.mock_temp_step, day_index),
                    "temp_source": temp_source,
                    "ph": mock_value(args.mock_ph_start, args.mock_ph_step, day_index),
                    "ph_source": ph_source,
                    "roi_x": roi_x,
                    "roi_y": roi_y,
                    "roi_width": roi_width,
                    "roi_height": roi_height,
                    "h_min": args.h_min,
                    "h_max": args.h_max,
                    "s_min": args.s_min,
                    "v_min": args.v_min,
                }
            )

    print(f"generated csv: {output_csv}")
    print(f"renamed images: {renamed_dir}")
    print(f"coverage debug: {debug_dir}")


if __name__ == "__main__":
    main()
