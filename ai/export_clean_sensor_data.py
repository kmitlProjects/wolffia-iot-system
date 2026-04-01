import argparse
import csv
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai.coverage import COVERAGE_METHOD_NAME
from config import (
    APP_TIMEZONE,
    COVERAGE_VERSION,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Export clean hourly sensor rows for model training from MongoDB."
        ),
    )
    parser.add_argument(
        "--output-csv",
        default="data/exports/model_training/clean_sensor_data.csv",
        help="Path to the exported CSV file.",
    )
    parser.add_argument(
        "--cycle-id",
        default=None,
        help="Optional cycle_id filter.",
    )
    parser.add_argument(
        "--timestamp-from",
        default=None,
        help="Only include rows at or after this ISO timestamp.",
    )
    parser.add_argument(
        "--timestamp-to",
        default=None,
        help="Only include rows at or before this ISO timestamp.",
    )
    parser.add_argument(
        "--coverage-method",
        default=COVERAGE_METHOD_NAME,
        help="Only include rows with this coverage_method. Use '' to disable.",
    )
    parser.add_argument(
        "--coverage-version",
        default=COVERAGE_VERSION,
        help="Only include rows with this coverage_version. Use '' to disable.",
    )
    parser.add_argument(
        "--keep-per-hour",
        choices=["first", "last", "all"],
        default="last",
        help=(
            "When multiple rows fall in the same local hour bucket of a cycle, "
            "keep the first row, the last row, or all rows."
        ),
    )
    parser.add_argument(
        "--allow-missing-cycle",
        action="store_true",
        help="Include rows even when cycle_id is missing.",
    )
    return parser.parse_args()


def parse_optional_timestamp(raw_value: str | None):
    if not raw_value:
        return None
    return datetime.fromisoformat(raw_value)


def build_query(args):
    query = {
        "timestamp": {"$ne": None},
        "temp": {"$ne": None},
        "ph": {"$ne": None},
        "green_coverage_percent": {"$ne": None},
    }

    if not args.allow_missing_cycle:
        query["cycle_id"] = {"$exists": True, "$nin": [None, ""]}

    if args.cycle_id:
        query["cycle_id"] = args.cycle_id

    if args.coverage_method:
        query["coverage_method"] = args.coverage_method

    if args.coverage_version:
        query["coverage_version"] = args.coverage_version

    timestamp_filters = {}
    timestamp_from = parse_optional_timestamp(args.timestamp_from)
    timestamp_to = parse_optional_timestamp(args.timestamp_to)
    if timestamp_from is not None:
        timestamp_filters["$gte"] = timestamp_from
    if timestamp_to is not None:
        timestamp_filters["$lte"] = timestamp_to
    if timestamp_filters:
        timestamp_filters["$ne"] = None
        query["timestamp"] = timestamp_filters

    return query


def serialize_local_timestamp(timestamp: datetime, timezone_name: str):
    return timestamp.astimezone(ZoneInfo(timezone_name)).isoformat()


def build_hour_bucket(timestamp: datetime, timezone_name: str):
    local_timestamp = timestamp.astimezone(ZoneInfo(timezone_name))
    return local_timestamp.strftime("%Y-%m-%dT%H")


def choose_document(existing, candidate, keep_per_hour: str):
    if existing is None:
        return candidate
    if keep_per_hour == "first":
        return existing
    if keep_per_hour == "last":
        return candidate
    return None


def main():
    args = parse_args()
    output_csv = Path(args.output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    client = MongoClient(MONGO_URI, tz_aware=True)
    collection = client[MONGO_DB][MONGO_COLLECTION]

    query = build_query(args)
    projection = {
        "_id": 0,
        "timestamp": 1,
        "temp": 1,
        "ph": 1,
        "green_coverage_percent": 1,
        "coverage_method": 1,
        "coverage_version": 1,
        "cycle_id": 1,
        "cycle_day_index": 1,
        "cycle_status": 1,
        "target_harvest_days": 1,
        "expected_days_to_harvest": 1,
        "expected_harvest_at": 1,
    }
    matched_rows = list(collection.find(query, projection).sort("timestamp", 1))

    exported_rows = []
    dedupe_buffer = {}
    deduped_counter = 0
    cycle_counter = Counter()

    for document in matched_rows:
        timestamp = document.get("timestamp")
        if not isinstance(timestamp, datetime):
            continue

        cycle_id = document.get("cycle_id") or "uncategorized"
        cycle_counter[cycle_id] += 1

        if args.keep_per_hour == "all":
            exported_rows.append(document)
            continue

        bucket_key = (cycle_id, build_hour_bucket(timestamp, APP_TIMEZONE))
        replacement = choose_document(
            dedupe_buffer.get(bucket_key),
            document,
            args.keep_per_hour,
        )
        if replacement is None:
            exported_rows.append(document)
            continue
        if bucket_key in dedupe_buffer:
            deduped_counter += 1
        dedupe_buffer[bucket_key] = replacement

    if args.keep_per_hour != "all":
        exported_rows = [
            dedupe_buffer[key]
            for key in sorted(dedupe_buffer.keys(), key=lambda item: item[1])
        ]

    fieldnames = [
        "timestamp_utc",
        "timestamp_local",
        "hour_bucket_local",
        "cycle_id",
        "cycle_day_index",
        "cycle_status",
        "target_harvest_days",
        "expected_days_to_harvest",
        "expected_harvest_at",
        "temp_c",
        "ph",
        "green_coverage_percent",
        "coverage_method",
        "coverage_version",
    ]

    with output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        for document in exported_rows:
            timestamp = document["timestamp"]
            writer.writerow(
                {
                    "timestamp_utc": timestamp.astimezone(
                        ZoneInfo("UTC")
                    ).isoformat(),
                    "timestamp_local": serialize_local_timestamp(
                        timestamp,
                        APP_TIMEZONE,
                    ),
                    "hour_bucket_local": build_hour_bucket(
                        timestamp,
                        APP_TIMEZONE,
                    ),
                    "cycle_id": document.get("cycle_id"),
                    "cycle_day_index": document.get("cycle_day_index"),
                    "cycle_status": document.get("cycle_status"),
                    "target_harvest_days": document.get("target_harvest_days"),
                    "expected_days_to_harvest": document.get(
                        "expected_days_to_harvest"
                    ),
                    "expected_harvest_at": (
                        serialize_local_timestamp(
                            document["expected_harvest_at"],
                            APP_TIMEZONE,
                        )
                        if isinstance(
                            document.get("expected_harvest_at"),
                            datetime,
                        )
                        else None
                    ),
                    "temp_c": document.get("temp"),
                    "ph": document.get("ph"),
                    "green_coverage_percent": document.get(
                        "green_coverage_percent"
                    ),
                    "coverage_method": document.get("coverage_method"),
                    "coverage_version": document.get("coverage_version"),
                }
            )

    first_timestamp = exported_rows[0]["timestamp"] if exported_rows else None
    last_timestamp = exported_rows[-1]["timestamp"] if exported_rows else None

    print(f"query={query}")
    print(f"matched_rows={len(matched_rows)}")
    print(f"exported_rows={len(exported_rows)}")
    print(f"deduped_rows={deduped_counter}")
    print(f"cycles={dict(cycle_counter)}")
    print(
        "first_timestamp_local="
        f"{serialize_local_timestamp(first_timestamp, APP_TIMEZONE) if first_timestamp else None}"
    )
    print(
        "last_timestamp_local="
        f"{serialize_local_timestamp(last_timestamp, APP_TIMEZONE) if last_timestamp else None}"
    )
    print(f"output_csv={output_csv}")


if __name__ == "__main__":
    main()
