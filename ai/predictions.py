from datetime import datetime, timezone


HARVEST_PREDICTION_TYPE = "harvest_days_to_harvest"
HARVEST_STUB_MODEL_VERSION = "stub_no_model_v1"


def ensure_prediction_indexes(collection):
    collection.create_index(
        [("prediction_type", 1), ("created_at", -1)],
        name="prediction_type_created_idx",
    )
    collection.create_index("cycle_id", name="prediction_cycle_id_idx")
    collection.create_index("status", name="prediction_status_idx")
    collection.create_index("updated_at", name="prediction_updated_idx")


def assess_harvest_prediction_readiness(feature_bundle: dict):
    cycle = feature_bundle.get("cycle") or {}
    window = feature_bundle.get("window") or {}
    latest = feature_bundle.get("latest") or {}
    latest_sensor = latest.get("sensor") or {}
    latest_daily_summary = latest.get("daily_summary") or {}
    latest_image_analysis = latest.get("image_analysis") or {}
    model_input = feature_bundle.get("model_input") or {}
    source_status = feature_bundle.get("source_status") or {}

    blocking_reasons = []
    warnings = []

    if not cycle.get("cycle_id"):
        blocking_reasons.append("no active grow cycle")

    if model_input.get("cycle_day_index") is None:
        blocking_reasons.append("missing cycle day index")

    if model_input.get("target_harvest_days") is None:
        blocking_reasons.append("missing target harvest days")

    if model_input.get("latest_temp_c") is None:
        blocking_reasons.append("missing latest temperature")

    if model_input.get("latest_ph") is None:
        blocking_reasons.append("missing latest pH")

    has_coverage = any(
        value is not None
        for value in (
            model_input.get("latest_green_coverage_percent"),
            model_input.get("latest_daily_image_coverage_percent"),
            latest_daily_summary.get("green_coverage_avg"),
            latest_image_analysis.get("green_coverage_percent"),
        )
    )
    if not has_coverage:
        blocking_reasons.append("missing green coverage features")

    if int(window.get("summary_days_available") or 0) <= 0:
        blocking_reasons.append("missing daily summary history")

    if int(window.get("sensor_points_available") or 0) <= 0:
        blocking_reasons.append("missing raw sensor history")

    requested_days = int(window.get("summary_days_requested") or 0)
    available_days = int(window.get("summary_days_available") or 0)
    if available_days < min(requested_days, 3):
        warnings.append("daily summary history is still shallow for sequence models")

    latest_sensor_age = source_status.get("latest_sensor_age_hours")
    if latest_sensor_age is not None and latest_sensor_age > 24:
        warnings.append("latest sensor point is older than 24 hours")

    latest_image_age = source_status.get("latest_image_analysis_age_hours")
    if latest_image_age is None:
        warnings.append("no archived image analysis snapshot yet")
    elif latest_image_age > 48:
        warnings.append("latest image analysis snapshot is older than 48 hours")

    if latest_sensor.get("green_coverage_percent") is None:
        warnings.append("hourly sensor payload does not include current coverage value")

    return {
        "ready": len(blocking_reasons) == 0,
        "blocking_reasons": blocking_reasons,
        "warnings": warnings,
    }


def build_stub_prediction_run(feature_bundle: dict):
    now_utc = datetime.now(timezone.utc)
    readiness = assess_harvest_prediction_readiness(feature_bundle)
    cycle = feature_bundle.get("cycle") or {}
    model_input = feature_bundle.get("model_input") or {}

    return {
        "prediction_type": HARVEST_PREDICTION_TYPE,
        "target_name": feature_bundle.get("target_name"),
        "feature_version": feature_bundle.get("feature_version"),
        "status": "ready_no_model" if readiness["ready"] else "blocked_no_model",
        "ready_for_model": readiness["ready"],
        "blocking_reasons": readiness["blocking_reasons"],
        "warnings": readiness["warnings"],
        "cycle_id": cycle.get("cycle_id"),
        "cycle_name": cycle.get("name"),
        "cycle_day_index": cycle.get("cycle_day_index"),
        "lookback_days": feature_bundle.get("lookback_days"),
        "prediction": {
            "days_to_harvest": None,
            "predicted_harvest_at": None,
            "confidence": None,
            "baseline_expected_days_to_harvest": model_input.get(
                "baseline_expected_days_to_harvest"
            ),
            "baseline_expected_harvest_at": cycle.get("expected_harvest_at"),
        },
        "model": {
            "name": None,
            "version": HARVEST_STUB_MODEL_VERSION,
            "source": "backend_placeholder",
        },
        "feature_snapshot": feature_bundle,
        "created_at": now_utc,
        "updated_at": now_utc,
    }


def store_prediction_run(collection, document: dict):
    inserted = collection.insert_one(document)
    return collection.find_one({"_id": inserted.inserted_id})


def get_latest_prediction_run(collection, prediction_type: str = HARVEST_PREDICTION_TYPE):
    return collection.find_one(
        {"prediction_type": prediction_type},
        sort=[("created_at", -1), ("_id", -1)],
    )


def list_prediction_runs(
    collection,
    prediction_type: str = HARVEST_PREDICTION_TYPE,
    limit: int = 20,
):
    safe_limit = max(min(int(limit), 120), 1)
    return list(
        collection.find({"prediction_type": prediction_type}).sort(
            [("created_at", -1), ("_id", -1)]
        ).limit(safe_limit)
    )
