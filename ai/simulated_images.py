import re
from pathlib import Path


DAY_FILE_PATTERN = re.compile(r"^day_(?P<day_index>\d{2})__.+$")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _parse_day_index(path: Path):
    match = DAY_FILE_PATTERN.match(path.stem)
    if not match:
        return None

    return int(match.group("day_index"))


def list_simulation_images(dataset_dir: str | Path):
    target_dir = Path(dataset_dir)
    if not target_dir.exists():
        raise FileNotFoundError(f"simulation image directory not found: {target_dir}")

    items = []
    for path in sorted(target_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        day_index = _parse_day_index(path)
        if day_index is None:
            continue

        items.append(
            {
                "day_index": day_index,
                "path": path,
                "filename": path.name,
            }
        )

    if not items:
        raise FileNotFoundError(
            f"no simulation images found in: {target_dir}"
        )

    return items


def pick_simulation_image(dataset_dir: str | Path, cycle_day_index: int):
    items = list_simulation_images(dataset_dir)
    requested_day = max(int(cycle_day_index), 1)

    for item in items:
        if item["day_index"] == requested_day:
            return {
                **item,
                "requested_day_index": requested_day,
                "selected_from": "exact_match",
            }

    if requested_day < items[0]["day_index"]:
        selected = items[0]
        selected_from = "clamped_to_first"
    else:
        selected = items[-1]
        selected_from = "clamped_to_last"

    return {
        **selected,
        "requested_day_index": requested_day,
        "selected_from": selected_from,
    }
