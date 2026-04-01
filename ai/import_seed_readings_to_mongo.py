import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai.daily_summary import summarize_day
from config import (
    APP_TIMEZONE,
    DAILY_SUMMARY_COLLECTION,
    GROW_CYCLE_COLLECTION,
    IMAGE_ANALYSIS_COLLECTION,
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
)
from grow_cycle import build_cycle_context


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import temp/pH readings from a CSV template back into MongoDB."
    )
    parser.add_argument(
        "--input-csv",
        default="data/exports/model_training/image_seed_readings_template.csv",
        help="CSV file created from the seed template and filled with temp/pH values.",
    )
    parser.add_argument(
        "--cycle-id",
        required=True,
        help="Target seeded cycle_id to update.",
    )
    parser.add_argument(
        "--timezone",
        default=APP_TIMEZONE,
        help="Timezone for timestamp_local parsing.",
    )
    parser.add_argument(
        "--skip-blank-rows",
        action="store_true",
        help="Skip rows that have no temp, no pH, and no timestamp override.",
    )
    return parser.parse_args()


def _coerce_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_local_timestamp(raw_value: str | None, timezone_name: str):
    if not raw_value:
        return None
    parsed = datetime.fromisoformat(raw_value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(ZoneInfo(timezone_name))


def import_seed_readings(
    input_csv: str | Path,
    cycle_id: str,
    timezone_name: str = APP_TIMEZONE,
    skip_blank_rows: bool = False,
):
    input_csv = Path(input_csv)
    if not input_csv.exists():
        raise FileNotFoundError(f"csv not found: {input_csv}")

    client = MongoClient(MONGO_URI, tz_aware=True)
    db = client[MONGO_DB]
    sensor_collection = db[MONGO_COLLECTION]
    image_collection = db[IMAGE_ANALYSIS_COLLECTION]
    summary_collection = db[DAILY_SUMMARY_COLLECTION]
    cycle_collection = db[GROW_CYCLE_COLLECTION]

    cycle_document = cycle_collection.find_one({"cycle_id": cycle_id})
    if cycle_document is None:
        raise ValueError(f"cycle not found: {cycle_id}")

    updated_rows = 0
    affected_dates = set()

    with input_csv.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            day_raw = (row.get("day_index") or "").strip()
            if not day_raw:
                continue

            day_index = int(day_raw)
            temp_value = _coerce_float(row.get("temp"))
            ph_value = _coerce_float(row.get("ph"))
            timestamp_local = _parse_local_timestamp(
                row.get("timestamp_local"),
                timezone_name,
            )

            if skip_blank_rows and temp_value is None and ph_value is None and timestamp_local is None:
                continue

            sensor_document = sensor_collection.find_one(
                {
                    "cycle_id": cycle_id,
                    "cycle_day_index": day_index,
                    "data_source": "historical_image_seed",
                },
                sort=[("timestamp", 1)],
            )
            if sensor_document is None:
                continue

            observed_at = timestamp_local or sensor_document.get("timestamp")
            cycle_context = build_cycle_context(
                cycle_document,
                observed_at,
                timezone_name,
            )

            sensor_collection.update_one(
                {"_id": sensor_document["_id"]},
                {
                    "$set": {
                        "timestamp": observed_at,
                        "temp": temp_value,
                        "ph": ph_value,
                        "data_source": (
                            "historical_image_seed_with_readings"
                            if temp_value is not None or ph_value is not None
                            else sensor_document.get("data_source")
                        ),
                        **cycle_context,
                    }
                },
            )

            image_document = image_collection.find_one(
                {
                    "cycle_id": cycle_id,
                    "cycle_day_index": day_index,
                }
            )
            if image_document is not None and timestamp_local is not None:
                date_key = observed_at.astimezone(ZoneInfo(timezone_name)).strftime("%Y-%m-%d")
                image_collection.update_one(
                    {"_id": image_document["_id"]},
                    {
                        "$set": {
                            "timestamp": observed_at,
                            "date": date_key,
                            **cycle_context,
                        }
                    },
                )
                affected_dates.add(date_key)
            else:
                affected_dates.add(
                    observed_at.astimezone(ZoneInfo(timezone_name)).strftime("%Y-%m-%d")
                )

            updated_rows += 1

    for date_key in sorted(affected_dates):
        summarize_day(
            sensor_collection,
            image_collection,
            summary_collection,
            timezone_name,
            date_key,
        )

    print(f"cycle_id: {cycle_id}")
    print(f"rows updated: {updated_rows}")
    print(f"affected_dates: {len(affected_dates)}")
    print(f"input_csv: {input_csv}")
    return {
        "cycle_id": cycle_id,
        "rows_updated": updated_rows,
        "affected_dates": sorted(affected_dates),
        "input_csv": str(input_csv),
    }


def main():
    args = parse_args()
    import_seed_readings(
        input_csv=args.input_csv,
        cycle_id=args.cycle_id,
        timezone_name=args.timezone,
        skip_blank_rows=args.skip_blank_rows,
    )


if __name__ == "__main__":
    main()
