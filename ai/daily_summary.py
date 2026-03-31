from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def ensure_daily_summary_indexes(summary_collection):
    summary_collection.create_index("date", name="daily_summary_date_uidx", unique=True)
    summary_collection.create_index("updated_at", name="daily_summary_updated_idx")


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
        value = _coerce_float(document.get(field_name))
        if value is not None:
            values.append(value)

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


def build_local_day_bounds(date_key: str, timezone_name: str):
    local_tz = ZoneInfo(timezone_name)
    start_local = datetime.strptime(date_key, "%Y-%m-%d").replace(tzinfo=local_tz)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local


def _extract_cycle_metadata(sensor_documents, image_analysis):
    candidate_sources = []
    if sensor_documents:
        candidate_sources.extend(sensor_documents)
    if image_analysis is not None:
        candidate_sources.append(image_analysis)

    for source in candidate_sources:
        cycle_id = source.get("cycle_id")
        if not cycle_id:
            continue

        return {
            "cycle_id": cycle_id,
            "cycle_name": source.get("cycle_name"),
            "cycle_status": source.get("cycle_status"),
            "cycle_planted_at": source.get("cycle_planted_at"),
            "cycle_day_index": source.get("cycle_day_index"),
            "target_harvest_days": source.get("target_harvest_days"),
            "expected_harvest_at": source.get("expected_harvest_at"),
            "expected_days_to_harvest": source.get("expected_days_to_harvest"),
        }

    return {
        "cycle_id": None,
        "cycle_name": None,
        "cycle_status": None,
        "cycle_planted_at": None,
        "cycle_day_index": None,
        "target_harvest_days": None,
        "expected_harvest_at": None,
        "expected_days_to_harvest": None,
    }


def summarize_day(
    sensor_collection,
    image_analysis_collection,
    summary_collection,
    timezone_name: str,
    date_key: str,
):
    ensure_daily_summary_indexes(summary_collection)

    start_local, end_local = build_local_day_bounds(date_key, timezone_name)
    sensor_documents = list(
        sensor_collection.find(
            {
                "timestamp": {
                    "$gte": start_local,
                    "$lt": end_local,
                }
            }
        ).sort("timestamp", 1)
    )

    image_analysis = image_analysis_collection.find_one({"date": date_key})

    if not sensor_documents and image_analysis is None:
        return None

    temp_stats = _numeric_stats(sensor_documents, "temp")
    ph_stats = _numeric_stats(sensor_documents, "ph")
    coverage_stats = _numeric_stats(sensor_documents, "green_coverage_percent")
    cycle_metadata = _extract_cycle_metadata(sensor_documents, image_analysis)
    now_utc = datetime.now(timezone.utc)

    summary_collection.update_one(
        {"date": date_key},
        {
            "$set": {
                "date": date_key,
                "timezone": timezone_name,
                "sensor_count": len(sensor_documents),
                "coverage_count": coverage_stats["count"],
                "first_sensor_at": sensor_documents[0]["timestamp"] if sensor_documents else None,
                "last_sensor_at": sensor_documents[-1]["timestamp"] if sensor_documents else None,
                "temp_avg": temp_stats["avg"],
                "temp_min": temp_stats["min"],
                "temp_max": temp_stats["max"],
                "ph_avg": ph_stats["avg"],
                "ph_min": ph_stats["min"],
                "ph_max": ph_stats["max"],
                "green_coverage_avg": coverage_stats["avg"],
                "green_coverage_min": coverage_stats["min"],
                "green_coverage_max": coverage_stats["max"],
                "cycle_id": cycle_metadata["cycle_id"],
                "cycle_name": cycle_metadata["cycle_name"],
                "cycle_status": cycle_metadata["cycle_status"],
                "cycle_planted_at": cycle_metadata["cycle_planted_at"],
                "cycle_day_index": cycle_metadata["cycle_day_index"],
                "target_harvest_days": cycle_metadata["target_harvest_days"],
                "expected_harvest_at": cycle_metadata["expected_harvest_at"],
                "expected_days_to_harvest": cycle_metadata["expected_days_to_harvest"],
                "image_path": image_analysis.get("image_path") if image_analysis else None,
                "image_url": image_analysis.get("image_url") if image_analysis else None,
                "mask_url": image_analysis.get("mask_url") if image_analysis else None,
                "overlay_url": image_analysis.get("overlay_url") if image_analysis else None,
                "daily_image_coverage_percent": (
                    image_analysis.get("green_coverage_percent") if image_analysis else None
                ),
                "freshness_class": image_analysis.get("freshness_class") if image_analysis else None,
                "confidence": image_analysis.get("confidence") if image_analysis else None,
                "updated_at": now_utc,
            },
            "$setOnInsert": {
                "created_at": now_utc,
            },
        },
        upsert=True,
    )

    return summary_collection.find_one({"date": date_key})
