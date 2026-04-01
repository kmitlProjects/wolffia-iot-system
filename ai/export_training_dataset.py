import argparse
import csv
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import (
    APP_TIMEZONE,
    GROW_CYCLE_COLLECTION,
    IMAGE_ANALYSIS_COLLECTION,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Export per-day training rows from MongoDB grow-cycle history."
    )
    parser.add_argument(
        "--output-csv",
        default="data/exports/model_training/harvest_training_dataset.csv",
        help="Path to the exported CSV file.",
    )
    parser.add_argument(
        "--cycle-id",
        default=None,
        help="Optional cycle_id filter.",
    )
    parser.add_argument(
        "--include-active",
        action="store_true",
        help="Include active cycles without a final harvest label.",
    )
    parser.add_argument(
        "--allow-missing-sensor",
        action="store_true",
        help="Keep rows even when temp/ph aggregates are missing.",
    )
    return parser.parse_args()


def _to_local_datetime(value, timezone_name: str):
    local_tz = ZoneInfo(timezone_name)
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=local_tz)
        return value.astimezone(local_tz)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=local_tz)
        return parsed.astimezone(local_tz)
    return None


def _to_iso(value, timezone_name: str):
    local_value = _to_local_datetime(value, timezone_name)
    return local_value.isoformat() if local_value else None


def _local_date_range(start_at, end_at, timezone_name: str):
    local_start = _to_local_datetime(start_at, timezone_name)
    local_end = _to_local_datetime(end_at, timezone_name) or local_start
    if local_start is None:
        return []
    days = []
    current = local_start.date()
    final = local_end.date()
    while current <= final:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def _coalesce(*values):
    for value in values:
        if value is not None:
            return value
    return None


def _coerce_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _numeric_stats(documents, field_name: str):
    values = []
    for document in documents:
        numeric = _coerce_float(document.get(field_name))
        if numeric is not None:
            values.append(numeric)

    if not values:
        return {
            "avg": None,
            "min": None,
            "max": None,
            "count": 0,
        }

    return {
        "avg": round(sum(values) / len(values), 2),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "count": len(values),
    }


def main():
    args = parse_args()
    output_csv = Path(args.output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    client = MongoClient(MONGO_URI, tz_aware=True)
    db = client[MONGO_DB]
    cycle_collection = db[GROW_CYCLE_COLLECTION]
    image_collection = db[IMAGE_ANALYSIS_COLLECTION]
    sensor_collection = db[MONGO_COLLECTION]

    cycle_query = {}
    if not args.include_active:
        cycle_query["status"] = "harvested"
    if args.cycle_id:
        cycle_query["cycle_id"] = args.cycle_id

    cycles = list(cycle_collection.find(cycle_query).sort("planted_at", 1))
    fieldnames = [
        "cycle_id",
        "cycle_name",
        "cycle_status",
        "planted_at_local",
        "harvested_at_local",
        "target_harvest_days",
        "actual_duration_days",
        "date",
        "day_index",
        "days_to_harvest_label",
        "expected_days_to_harvest",
        "sensor_count",
        "coverage_count",
        "temp_avg",
        "temp_min",
        "temp_max",
        "ph_avg",
        "ph_min",
        "ph_max",
        "green_coverage_avg",
        "green_coverage_min",
        "green_coverage_max",
        "daily_image_coverage_percent",
        "coverage_method",
        "coverage_version",
        "analysis_source_mode",
        "analysis_source_label",
        "latest_sensor_timestamp_local",
        "latest_sensor_coverage_percent",
        "data_source",
        "has_temp_ph",
        "has_label",
        "row_ready_for_training",
    ]

    exported_rows = []
    cycle_count = 0
    ready_count = 0

    for cycle in cycles:
        cycle_count += 1
        planted_at = _to_local_datetime(cycle.get("planted_at"), APP_TIMEZONE)
        harvested_at = _to_local_datetime(cycle.get("harvested_at"), APP_TIMEZONE)
        target_harvest_days = int(cycle.get("target_harvest_days") or 0)
        actual_duration_days = cycle.get("actual_duration_days")
        if actual_duration_days is None and harvested_at and planted_at:
            actual_duration_days = (harvested_at.date() - planted_at.date()).days + 1

        if harvested_at is None and planted_at is not None:
            harvested_at = planted_at + timedelta(days=max(target_harvest_days - 1, 0))

        date_keys = _local_date_range(planted_at, harvested_at, APP_TIMEZONE)
        for date_key in date_keys:
            image_analysis = image_collection.find_one(
                {"cycle_id": cycle["cycle_id"], "date": date_key}
            )

            day_start = datetime.strptime(date_key, "%Y-%m-%d").replace(
                tzinfo=ZoneInfo(APP_TIMEZONE)
            )
            day_end = day_start + timedelta(days=1)
            day_sensor_docs = list(
                sensor_collection.find(
                    {
                        "cycle_id": cycle["cycle_id"],
                        "timestamp": {
                            "$gte": day_start,
                            "$lt": day_end,
                        },
                    }
                ).sort("timestamp", 1)
            )
            latest_sensor = (
                day_sensor_docs[-1]
                if day_sensor_docs
                else None
            )

            if latest_sensor is None and image_analysis is None:
                continue

            temp_stats = _numeric_stats(day_sensor_docs, "temp")
            ph_stats = _numeric_stats(day_sensor_docs, "ph")
            coverage_stats = _numeric_stats(day_sensor_docs, "green_coverage_percent")

            summary_day_index = _coalesce(
                latest_sensor.get("cycle_day_index") if latest_sensor else None,
                image_analysis.get("cycle_day_index") if image_analysis else None,
            )
            if summary_day_index is None and planted_at is not None:
                summary_day_index = (
                    datetime.strptime(date_key, "%Y-%m-%d").date() - planted_at.date()
                ).days + 1

            expected_days_to_harvest = _coalesce(
                latest_sensor.get("expected_days_to_harvest") if latest_sensor else None,
                image_analysis.get("expected_days_to_harvest") if image_analysis else None,
                max(target_harvest_days - int(summary_day_index), 0)
                if summary_day_index is not None
                else None,
            )

            days_to_harvest_label = None
            if actual_duration_days is not None and summary_day_index is not None:
                days_to_harvest_label = max(
                    int(actual_duration_days) - int(summary_day_index),
                    0,
                )

            has_temp_ph = temp_stats["avg"] is not None and ph_stats["avg"] is not None
            has_label = days_to_harvest_label is not None
            row_ready_for_training = bool(has_temp_ph and has_label)

            if not args.allow_missing_sensor and not has_temp_ph:
                continue

            if row_ready_for_training:
                ready_count += 1

            exported_rows.append(
                {
                    "cycle_id": cycle.get("cycle_id"),
                    "cycle_name": cycle.get("name"),
                    "cycle_status": cycle.get("status"),
                    "planted_at_local": _to_iso(planted_at, APP_TIMEZONE),
                    "harvested_at_local": _to_iso(harvested_at, APP_TIMEZONE),
                    "target_harvest_days": target_harvest_days,
                    "actual_duration_days": actual_duration_days,
                    "date": date_key,
                    "day_index": summary_day_index,
                    "days_to_harvest_label": days_to_harvest_label,
                    "expected_days_to_harvest": expected_days_to_harvest,
                    "sensor_count": len(day_sensor_docs),
                    "coverage_count": coverage_stats["count"],
                    "temp_avg": temp_stats["avg"],
                    "temp_min": temp_stats["min"],
                    "temp_max": temp_stats["max"],
                    "ph_avg": ph_stats["avg"],
                    "ph_min": ph_stats["min"],
                    "ph_max": ph_stats["max"],
                    "green_coverage_avg": coverage_stats["avg"],
                    "green_coverage_min": coverage_stats["min"],
                    "green_coverage_max": coverage_stats["max"],
                    "daily_image_coverage_percent": (
                        image_analysis.get("green_coverage_percent") if image_analysis else None
                    ),
                    "coverage_method": _coalesce(
                        image_analysis.get("coverage_method") if image_analysis else None,
                        latest_sensor.get("coverage_method") if latest_sensor else None,
                    ),
                    "coverage_version": _coalesce(
                        image_analysis.get("coverage_version") if image_analysis else None,
                        latest_sensor.get("coverage_version") if latest_sensor else None,
                    ),
                    "analysis_source_mode": image_analysis.get("analysis_source_mode") if image_analysis else None,
                    "analysis_source_label": image_analysis.get("analysis_source_label") if image_analysis else None,
                    "latest_sensor_timestamp_local": _to_iso(
                        latest_sensor.get("timestamp") if latest_sensor else None,
                        APP_TIMEZONE,
                    ),
                    "latest_sensor_coverage_percent": (
                        latest_sensor.get("green_coverage_percent") if latest_sensor else None
                    ),
                    "data_source": _coalesce(
                        image_analysis.get("data_source") if image_analysis else None,
                        latest_sensor.get("data_source") if latest_sensor else None,
                    ),
                    "has_temp_ph": has_temp_ph,
                    "has_label": has_label,
                    "row_ready_for_training": row_ready_for_training,
                }
            )

    with output_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(exported_rows)

    print(f"cycles scanned: {cycle_count}")
    print(f"rows exported: {len(exported_rows)}")
    print(f"rows ready for training: {ready_count}")
    print(f"csv: {output_csv}")


if __name__ == "__main__":
    main()
