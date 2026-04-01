import argparse
import csv
import re
import sys
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai.coverage import analyze_green_coverage_bytes
from ai.daily_summary import summarize_day
from ai.simulated_images import list_simulation_images
from config import (
    APP_TIMEZONE,
    DAILY_SUMMARY_COLLECTION,
    GROW_CYCLE_COLLECTION,
    IMAGE_ANALYSIS_COLLECTION,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)
from grow_cycle import build_cycle_context, ensure_grow_cycle_indexes


FILENAME_TIMESTAMP_PATTERN = re.compile(
    r"day_(?P<day_index>\d{2})__(?P<date>\d{4}-\d{2}-\d{2})-(?P<hour>\d{2})\.(?P<minute>\d{2})"
)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Seed historical image observations into MongoDB collections as a "
            "time-series grow cycle."
        )
    )
    parser.add_argument(
        "--input-dir",
        default="test/test_image",
        help="Directory containing ordered day_XX simulation images.",
    )
    parser.add_argument(
        "--cycle-id",
        default=None,
        help="Optional fixed cycle_id for the seeded cycle.",
    )
    parser.add_argument(
        "--cycle-name",
        default="Historical image seed",
        help="Display name for the seeded cycle.",
    )
    parser.add_argument(
        "--timezone",
        default=APP_TIMEZONE,
        help="Timezone used for synthetic observation timestamps.",
    )
    parser.add_argument(
        "--target-harvest-days",
        type=int,
        default=None,
        help="Target harvest days. Defaults to the number of images.",
    )
    parser.add_argument(
        "--status",
        choices=["harvested", "active"],
        default="harvested",
        help="Cycle status to write into grow_cycles.",
    )
    parser.add_argument(
        "--readings-csv",
        default=None,
        help=(
            "Optional CSV with columns day_index,temp,ph,timestamp_local to "
            "attach sensor values to each image day."
        ),
    )
    parser.add_argument(
        "--template-csv",
        default="data/exports/model_training/image_seed_readings_template.csv",
        help="Path to export a template CSV for later temp/pH backfill.",
    )
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Delete existing rows for the same cycle_id before importing.",
    )
    return parser.parse_args()


def parse_filename_captured_at(path: Path, timezone_name: str):
    match = FILENAME_TIMESTAMP_PATTERN.search(path.name)
    if not match:
        return None

    local_tz = ZoneInfo(timezone_name)
    return datetime.strptime(
        f"{match.group('date')} {match.group('hour')}:{match.group('minute')}",
        "%Y-%m-%d %H:%M",
    ).replace(tzinfo=local_tz)


def build_seed_cycle_id(first_observed_at: datetime, input_dir: Path, override: str | None):
    if override:
        return override
    return (
        f"seed_cycle_{first_observed_at.strftime('%Y%m%d')}_"
        f"{input_dir.name.replace('-', '_')}"
    )


def build_planted_at(first_source_at: datetime | None, timezone_name: str):
    local_tz = ZoneInfo(timezone_name)
    if first_source_at is None:
        return datetime.now(local_tz).replace(hour=9, minute=0, second=0, microsecond=0)
    return first_source_at.replace(second=0, microsecond=0)


def load_readings_map(path: str | None, timezone_name: str):
    if not path:
        return {}

    rows = {}
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            day_raw = (row.get("day_index") or "").strip()
            if not day_raw:
                continue
            day_index = int(day_raw)
            timestamp_local = row.get("timestamp_local")
            parsed_timestamp = None
            if timestamp_local:
                parsed_timestamp = datetime.fromisoformat(timestamp_local)
                if parsed_timestamp.tzinfo is None:
                    parsed_timestamp = parsed_timestamp.replace(
                        tzinfo=ZoneInfo(timezone_name)
                    )
                else:
                    parsed_timestamp = parsed_timestamp.astimezone(
                        ZoneInfo(timezone_name)
                    )
            rows[day_index] = {
                "temp": _coerce_float(row.get("temp")),
                "ph": _coerce_float(row.get("ph")),
                "timestamp_local": parsed_timestamp,
            }
    return rows


def export_readings_template(path: str, items, timezone_name: str):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "day_index",
        "source_filename",
        "source_captured_at",
        "timestamp_local",
        "temp",
        "ph",
        "notes",
    ]
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            source_at = parse_filename_captured_at(item["path"], timezone_name)
            writer.writerow(
                {
                    "day_index": item["day_index"],
                    "source_filename": item["filename"],
                    "source_captured_at": source_at.isoformat() if source_at else "",
                    "timestamp_local": "",
                    "temp": "",
                    "ph": "",
                    "notes": "",
                }
            )
    return output_path


def derive_observed_at(
    planted_at: datetime,
    day_index: int,
    source_captured_at: datetime | None,
    reading_override: dict | None,
):
    if reading_override and isinstance(reading_override.get("timestamp_local"), datetime):
        return reading_override["timestamp_local"]

    if source_captured_at is not None:
        capture_clock = source_captured_at.timetz()
        capture_time = dtime(
            hour=capture_clock.hour,
            minute=capture_clock.minute,
            second=capture_clock.second,
        )
    else:
        capture_time = dtime(
            hour=planted_at.hour,
            minute=planted_at.minute,
            second=0,
        )

    observed_date = planted_at.date() + timedelta(days=day_index - 1)
    return datetime.combine(
        observed_date,
        capture_time,
        tzinfo=planted_at.tzinfo,
    )


def _coerce_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def upsert_cycle(
    collection,
    cycle_id: str,
    cycle_name: str | None,
    planted_at: datetime,
    target_harvest_days: int,
    status: str,
    notes: str,
):
    ensure_grow_cycle_indexes(collection)
    harvested_at = None
    actual_duration_days = None
    expected_harvest_at = planted_at + timedelta(days=max(target_harvest_days - 1, 0))
    if status == "harvested":
        harvested_at = planted_at + timedelta(days=max(target_harvest_days - 1, 0))
        actual_duration_days = target_harvest_days

    now_utc = datetime.now(timezone.utc)
    collection.update_one(
        {"cycle_id": cycle_id},
        {
            "$set": {
                "cycle_id": cycle_id,
                "name": (cycle_name or "").strip() or None,
                "status": status,
                "planted_at": planted_at,
                "target_harvest_days": target_harvest_days,
                "expected_harvest_at": expected_harvest_at,
                "harvested_at": harvested_at,
                "actual_duration_days": actual_duration_days,
                "notes": notes,
                "updated_at": now_utc,
            },
            "$setOnInsert": {
                "created_at": now_utc,
            },
        },
        upsert=True,
    )
    return collection.find_one({"cycle_id": cycle_id})


def delete_existing_cycle_data(
    sensor_collection,
    image_collection,
    summary_collection,
    cycle_collection,
    cycle_id: str,
):
    sensor_collection.delete_many({"cycle_id": cycle_id})
    image_collection.delete_many({"cycle_id": cycle_id})
    summary_collection.delete_many({"cycle_id": cycle_id})
    cycle_collection.delete_many({"cycle_id": cycle_id})


def main():
    args = parse_args()
    input_dir = Path(args.input_dir)
    items = list_simulation_images(input_dir)
    readings_map = load_readings_map(args.readings_csv, args.timezone)
    template_path = export_readings_template(args.template_csv, items, args.timezone)

    first_source_at = parse_filename_captured_at(items[0]["path"], args.timezone)
    planted_at = build_planted_at(first_source_at, args.timezone)
    cycle_id = build_seed_cycle_id(planted_at, input_dir, args.cycle_id)
    target_harvest_days = max(args.target_harvest_days or len(items), 1)

    client = MongoClient(MONGO_URI, tz_aware=True)
    db = client[MONGO_DB]
    sensor_collection = db[MONGO_COLLECTION]
    image_collection = db[IMAGE_ANALYSIS_COLLECTION]
    summary_collection = db[DAILY_SUMMARY_COLLECTION]
    cycle_collection = db[GROW_CYCLE_COLLECTION]

    if args.replace_existing:
        delete_existing_cycle_data(
            sensor_collection,
            image_collection,
            summary_collection,
            cycle_collection,
            cycle_id,
        )

    cycle_document = upsert_cycle(
        cycle_collection,
        cycle_id=cycle_id,
        cycle_name=args.cycle_name,
        planted_at=planted_at,
        target_harvest_days=target_harvest_days,
        status=args.status,
        notes=(
            f"seeded from {input_dir} using image-derived coverage only; "
            f"temp/ph can be backfilled later via readings CSV"
        ),
    )

    imported_sensor_rows = 0
    imported_image_days = 0
    summary_dates = set()

    for item in items:
        day_index = item["day_index"]
        source_captured_at = parse_filename_captured_at(item["path"], args.timezone)
        reading_override = readings_map.get(day_index)
        observed_at = derive_observed_at(
            planted_at,
            day_index,
            source_captured_at,
            reading_override,
        )
        date_key = observed_at.strftime("%Y-%m-%d")
        analysis = analyze_green_coverage_bytes(item["path"].read_bytes())
        cycle_context = build_cycle_context(cycle_document, observed_at, args.timezone)

        sensor_payload = {
            "timestamp": observed_at,
            "temp": reading_override.get("temp") if reading_override else None,
            "ph": reading_override.get("ph") if reading_override else None,
            "green_coverage_percent": analysis["green_coverage_percent"],
            "coverage_method": analysis["coverage_method"],
            "coverage_version": analysis["coverage_version"],
            "green_pixels": analysis["green_pixels"],
            "total_pixels": analysis["total_pixels"],
            "data_source": "historical_image_seed",
            "source_mode": "dataset",
            "source_label": item["filename"],
            "source_path": str(item["path"]),
            "source_captured_at": source_captured_at,
            "seed_template_csv": str(template_path),
            **cycle_context,
        }

        sensor_collection.update_one(
            {"cycle_id": cycle_id, "timestamp": observed_at},
            {"$set": sensor_payload},
            upsert=True,
        )
        imported_sensor_rows += 1

        image_collection.update_one(
            {"date": date_key},
            {
                "$set": {
                    "date": date_key,
                    "timestamp": observed_at,
                    "image_path": None,
                    "mask_path": None,
                    "overlay_path": None,
                    "image_url": None,
                    "mask_url": None,
                    "overlay_url": None,
                    "size_bytes": None,
                    "green_coverage_percent": analysis["green_coverage_percent"],
                    "green_pixels": analysis["green_pixels"],
                    "total_pixels": analysis["total_pixels"],
                    "coverage_method": analysis["coverage_method"],
                    "coverage_version": analysis["coverage_version"],
                    "coverage_roi": analysis["roi"],
                    "coverage_thresholds": analysis["thresholds"],
                    "analysis_source_mode": "dataset",
                    "analysis_source_label": item["filename"],
                    "analysis_source_path": str(item["path"]),
                    "analysis_source_selected_from": "historical_seed",
                    "source_captured_at": source_captured_at,
                    "data_source": "historical_image_seed",
                    "light_was_on_before_capture": None,
                    "light_forced_off_for_capture": False,
                    "light_restored_after_capture": False,
                    "light_settle_seconds": 0.0,
                    "light_restore_error": None,
                    "freshness_class": None,
                    "confidence": None,
                    "model_version": None,
                    **cycle_context,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
        imported_image_days += 1
        summary_dates.add(date_key)

    for date_key in sorted(summary_dates):
        summarize_day(
            sensor_collection,
            image_collection,
            summary_collection,
            args.timezone,
            date_key,
        )

    print(f"seed cycle id: {cycle_id}")
    print(f"planted_at: {planted_at.isoformat()}")
    print(f"target_harvest_days: {target_harvest_days}")
    print(f"sensor rows upserted: {imported_sensor_rows}")
    print(f"image analysis days upserted: {imported_image_days}")
    print(f"readings template: {template_path}")
    if args.readings_csv:
        print(f"readings csv used: {args.readings_csv}")
    else:
        print("readings csv used: none (temp/ph left empty for seeded rows)")


if __name__ == "__main__":
    main()
