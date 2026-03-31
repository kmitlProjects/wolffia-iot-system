from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from grow_cycle import build_cycle_context, get_active_cycle


HARVEST_FEATURE_VERSION = "harvest_features_v1"
HARVEST_TARGET_NAME = "days_to_harvest"


def _coerce_local_datetime(value, timezone_name: str):
    local_tz = ZoneInfo(timezone_name)

    if value is None:
        return datetime.now(local_tz)

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=local_tz)
        return value.astimezone(local_tz)

    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=local_tz)
        return parsed.astimezone(local_tz)

    raise ValueError("invalid datetime value")


def _to_iso(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _coerce_float(value):
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_or_none(value, digits: int = 2):
    if value is None:
        return None
    return round(float(value), digits)


def _hours_since(reference_at: datetime, observed_at):
    timezone_name = getattr(reference_at.tzinfo, "key", "UTC")
    observed_local = _coerce_local_datetime(observed_at, timezone_name)
    delta = reference_at - observed_local
    return _round_or_none(delta.total_seconds() / 3600.0)


def _numeric_summary(values):
    numeric_values = [
        float(value)
        for value in values
        if value is not None
    ]
    if not numeric_values:
        return {
            "mean": None,
            "min": None,
            "max": None,
            "count": 0,
            "first": None,
            "last": None,
            "trend": None,
        }

    first_value = numeric_values[0]
    last_value = numeric_values[-1]
    return {
        "mean": _round_or_none(sum(numeric_values) / len(numeric_values)),
        "min": _round_or_none(min(numeric_values)),
        "max": _round_or_none(max(numeric_values)),
        "count": len(numeric_values),
        "first": _round_or_none(first_value),
        "last": _round_or_none(last_value),
        "trend": _round_or_none(last_value - first_value),
    }


def _get_numeric_series(documents, field_name: str):
    return [_coerce_float(document.get(field_name)) for document in documents]


def _build_sensor_snapshot(document):
    if document is None:
        return None

    return {
        "timestamp": _to_iso(document.get("timestamp")),
        "temp": _coerce_float(document.get("temp")),
        "ph": _coerce_float(document.get("ph")),
        "green_coverage_percent": _coerce_float(
            document.get("green_coverage_percent")
        ),
        "cycle_day_index": document.get("cycle_day_index"),
    }


def _build_image_analysis_snapshot(document):
    if document is None:
        return None

    return {
        "date": document.get("date"),
        "timestamp": _to_iso(document.get("timestamp")),
        "green_coverage_percent": _coerce_float(
            document.get("green_coverage_percent")
        ),
        "image_url": document.get("image_url"),
        "mask_url": document.get("mask_url"),
        "overlay_url": document.get("overlay_url"),
        "model_version": document.get("model_version"),
    }


def _build_daily_summary_snapshot(document):
    if document is None:
        return None

    return {
        "date": document.get("date"),
        "sensor_count": document.get("sensor_count"),
        "cycle_day_index": document.get("cycle_day_index"),
        "temp_avg": _coerce_float(document.get("temp_avg")),
        "temp_min": _coerce_float(document.get("temp_min")),
        "temp_max": _coerce_float(document.get("temp_max")),
        "ph_avg": _coerce_float(document.get("ph_avg")),
        "ph_min": _coerce_float(document.get("ph_min")),
        "ph_max": _coerce_float(document.get("ph_max")),
        "green_coverage_avg": _coerce_float(document.get("green_coverage_avg")),
        "daily_image_coverage_percent": _coerce_float(
            document.get("daily_image_coverage_percent")
        ),
        "freshness_class": document.get("freshness_class"),
        "confidence": _coerce_float(document.get("confidence")),
    }


def _build_cycle_snapshot(cycle_document, cycle_context):
    if cycle_document is None:
        return None

    return {
        "cycle_id": cycle_document.get("cycle_id"),
        "name": cycle_document.get("name"),
        "status": cycle_document.get("status"),
        "planted_at": _to_iso(cycle_document.get("planted_at")),
        "expected_harvest_at": _to_iso(cycle_document.get("expected_harvest_at")),
        "harvested_at": _to_iso(cycle_document.get("harvested_at")),
        "target_harvest_days": cycle_context.get("target_harvest_days"),
        "cycle_day_index": cycle_context.get("cycle_day_index"),
        "expected_days_to_harvest": cycle_context.get("expected_days_to_harvest"),
    }


def _build_daily_points(summary_documents):
    return [
        {
            "date": document.get("date"),
            "cycle_day_index": document.get("cycle_day_index"),
            "sensor_count": document.get("sensor_count"),
            "temp_avg": _coerce_float(document.get("temp_avg")),
            "ph_avg": _coerce_float(document.get("ph_avg")),
            "green_coverage_avg": _coerce_float(
                document.get("green_coverage_avg")
            ),
            "daily_image_coverage_percent": _coerce_float(
                document.get("daily_image_coverage_percent")
            ),
        }
        for document in summary_documents
    ]


def build_harvest_feature_bundle(
    sensor_collection,
    daily_summary_collection,
    image_analysis_collection,
    grow_cycle_collection,
    timezone_name: str,
    lookback_days: int = 7,
    sensor_limit: int = 240,
    at_time: datetime | None = None,
):
    safe_lookback_days = max(min(int(lookback_days), 90), 1)
    safe_sensor_limit = max(min(int(sensor_limit), 5000), 1)
    reference_at = _coerce_local_datetime(at_time, timezone_name)

    active_cycle = get_active_cycle(
        grow_cycle_collection,
        at_time=reference_at,
        timezone_name=timezone_name,
    )
    if active_cycle is None:
        raise ValueError("no active grow cycle")

    cycle_context = build_cycle_context(active_cycle, reference_at, timezone_name)
    planted_at = _coerce_local_datetime(active_cycle.get("planted_at"), timezone_name)
    window_start_at = max(
        planted_at,
        reference_at - timedelta(days=safe_lookback_days - 1),
    )
    start_date_key = window_start_at.strftime("%Y-%m-%d")
    end_date_key = reference_at.strftime("%Y-%m-%d")
    requested_summary_days = (
        reference_at.date() - window_start_at.date()
    ).days + 1

    sensor_documents = list(
        sensor_collection.find(
            {
                "timestamp": {
                    "$gte": window_start_at,
                    "$lte": reference_at,
                }
            }
        )
        .sort([("timestamp", -1)])
        .limit(safe_sensor_limit)
    )
    sensor_documents.reverse()

    summary_documents = list(
        daily_summary_collection.find(
            {
                "date": {
                    "$gte": start_date_key,
                    "$lte": end_date_key,
                }
            }
        ).sort([("date", 1)])
    )

    latest_image_analysis = image_analysis_collection.find_one(
        {
            "date": {
                "$gte": planted_at.strftime("%Y-%m-%d"),
                "$lte": end_date_key,
            }
        },
        sort=[("date", -1)],
    )

    latest_sensor = sensor_documents[-1] if sensor_documents else None
    latest_summary = summary_documents[-1] if summary_documents else None

    daily_temp_stats = _numeric_summary(
        _get_numeric_series(summary_documents, "temp_avg")
    )
    daily_ph_stats = _numeric_summary(
        _get_numeric_series(summary_documents, "ph_avg")
    )
    daily_sensor_coverage_stats = _numeric_summary(
        _get_numeric_series(summary_documents, "green_coverage_avg")
    )
    daily_image_coverage_stats = _numeric_summary(
        _get_numeric_series(summary_documents, "daily_image_coverage_percent")
    )
    raw_temp_stats = _numeric_summary(_get_numeric_series(sensor_documents, "temp"))
    raw_ph_stats = _numeric_summary(_get_numeric_series(sensor_documents, "ph"))
    raw_coverage_stats = _numeric_summary(
        _get_numeric_series(sensor_documents, "green_coverage_percent")
    )

    latest_sensor_at = latest_sensor.get("timestamp") if latest_sensor else None
    latest_image_at = (
        latest_image_analysis.get("timestamp") if latest_image_analysis else None
    )

    model_input = {
        "cycle_day_index": cycle_context.get("cycle_day_index"),
        "target_harvest_days": cycle_context.get("target_harvest_days"),
        "baseline_expected_days_to_harvest": cycle_context.get(
            "expected_days_to_harvest"
        ),
        "lookback_days": safe_lookback_days,
        "summary_days_available": len(summary_documents),
        "sensor_points_available": len(sensor_documents),
        "latest_temp_c": _coerce_float(latest_sensor.get("temp") if latest_sensor else None),
        "latest_ph": _coerce_float(latest_sensor.get("ph") if latest_sensor else None),
        "latest_green_coverage_percent": _coerce_float(
            latest_sensor.get("green_coverage_percent") if latest_sensor else None
        ),
        "latest_daily_image_coverage_percent": _coerce_float(
            (
                latest_summary.get("daily_image_coverage_percent")
                if latest_summary is not None
                else latest_image_analysis.get("green_coverage_percent")
                if latest_image_analysis is not None
                else None
            )
        ),
        "window_temp_avg_mean": daily_temp_stats["mean"],
        "window_temp_avg_min": daily_temp_stats["min"],
        "window_temp_avg_max": daily_temp_stats["max"],
        "window_temp_avg_trend": daily_temp_stats["trend"],
        "window_ph_avg_mean": daily_ph_stats["mean"],
        "window_ph_avg_min": daily_ph_stats["min"],
        "window_ph_avg_max": daily_ph_stats["max"],
        "window_ph_avg_trend": daily_ph_stats["trend"],
        "window_sensor_coverage_mean": daily_sensor_coverage_stats["mean"],
        "window_sensor_coverage_min": daily_sensor_coverage_stats["min"],
        "window_sensor_coverage_max": daily_sensor_coverage_stats["max"],
        "window_sensor_coverage_trend": daily_sensor_coverage_stats["trend"],
        "window_daily_image_coverage_mean": daily_image_coverage_stats["mean"],
        "window_daily_image_coverage_min": daily_image_coverage_stats["min"],
        "window_daily_image_coverage_max": daily_image_coverage_stats["max"],
        "window_daily_image_coverage_trend": daily_image_coverage_stats["trend"],
    }

    return {
        "feature_version": HARVEST_FEATURE_VERSION,
        "target_name": HARVEST_TARGET_NAME,
        "generated_at": datetime.now(ZoneInfo(timezone_name)).isoformat(),
        "timezone": timezone_name,
        "reference_at": reference_at.isoformat(),
        "lookback_days": safe_lookback_days,
        "sensor_limit": safe_sensor_limit,
        "cycle": _build_cycle_snapshot(active_cycle, cycle_context),
        "window": {
            "start_at": window_start_at.isoformat(),
            "end_at": reference_at.isoformat(),
            "start_date": start_date_key,
            "end_date": end_date_key,
            "summary_days_requested": requested_summary_days,
            "summary_days_available": len(summary_documents),
            "sensor_points_available": len(sensor_documents),
        },
        "latest": {
            "sensor": _build_sensor_snapshot(latest_sensor),
            "daily_summary": _build_daily_summary_snapshot(latest_summary),
            "image_analysis": _build_image_analysis_snapshot(latest_image_analysis),
        },
        "source_status": {
            "latest_sensor_age_hours": (
                _hours_since(reference_at, latest_sensor_at)
                if latest_sensor_at is not None
                else None
            ),
            "latest_image_analysis_age_hours": (
                _hours_since(reference_at, latest_image_at)
                if latest_image_at is not None
                else None
            ),
            "has_active_cycle": True,
        },
        "time_series": {
            "daily_summaries": _build_daily_points(summary_documents),
        },
        "aggregates": {
            "raw_sensor_temp": raw_temp_stats,
            "raw_sensor_ph": raw_ph_stats,
            "raw_sensor_green_coverage": raw_coverage_stats,
            "daily_temp_avg": daily_temp_stats,
            "daily_ph_avg": daily_ph_stats,
            "daily_sensor_green_coverage_avg": daily_sensor_coverage_stats,
            "daily_image_green_coverage": daily_image_coverage_stats,
        },
        "model_input": model_input,
    }
