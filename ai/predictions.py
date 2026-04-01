import json
import math
import os
import threading
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import pstdev
from zoneinfo import ZoneInfo


HARVEST_PREDICTION_TYPE = "harvest_days_to_harvest"
HARVEST_STUB_MODEL_VERSION = "stub_no_model_v1"
HARVEST_MODEL_DEFAULT_VERSION = "baseline_v2"
HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS = [
    "coverage_now",
    "coverage_avg",
    "coverage_max",
    "temp_avg",
    "temp_max",
    "ph_avg",
    "ph_max",
    "lag1_coverage",
    "lag1_temp",
    "lag1_ph",
    "delta_coverage",
    "delta_temp",
    "delta_ph",
    "roll3_coverage_mean",
    "roll3_temp_mean",
    "roll3_ph_mean",
    "light_lux",
    "fertilizer_mg_l",
    "ph_gap_from_optimal",
    "light_in_optimal_band",
    "fertilizer_in_optimal_band",
    "growth_score",
    "coverage_running_max",
]
_MODEL_RUNTIME_LOCK = threading.RLock()
_MODEL_RUNTIME_CACHE = {
    "model_path": None,
    "metrics_path": None,
    "model_mtime": None,
    "metrics_mtime": None,
    "model": None,
    "feature_columns": list(HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS),
    "metrics": {},
    "error": None,
}


def ensure_prediction_indexes(collection):
    collection.create_index(
        [("prediction_type", 1), ("created_at", -1)],
        name="prediction_type_created_idx",
    )
    collection.create_index("cycle_id", name="prediction_cycle_id_idx")
    collection.create_index("status", name="prediction_status_idx")
    collection.create_index("updated_at", name="prediction_updated_idx")


def _coerce_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_bool_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return 1
    if text in {"0", "false", "no", "off"}:
        return 0
    return None


def _last_non_none(values):
    for value in reversed(values):
        if value is not None:
            return value
    return None


def _first_non_none(*values):
    for value in values:
        if value is not None:
            return value
    return None


def _rolling_mean(values):
    numeric = [float(value) for value in values if value is not None]
    if not numeric:
        return None
    return round(sum(numeric) / len(numeric), 4)


def _clamp(value, low: float, high: float):
    return max(low, min(high, value))


def _gaussian_score(value, center: float, spread: float):
    if value is None:
        return None
    return math.exp(-((float(value) - center) ** 2) / (2 * (spread ** 2)))


def _light_score(light_lux):
    if light_lux is None:
        return None
    light_lux = float(light_lux)
    if 5000 <= light_lux <= 10000:
        return 1.0
    if light_lux < 5000:
        return _clamp(light_lux / 5000.0, 0.45, 0.95)
    return _clamp(10000.0 / light_lux, 0.4, 0.95)


def _fertilizer_score(fertilizer_mg_l):
    if fertilizer_mg_l is None:
        return None
    mapping = {
        50: 0.9,
        100: 1.0,
        200: 0.86,
        400: 0.7,
        800: 0.45,
        1600: 0.2,
    }
    return mapping.get(int(float(fertilizer_mg_l)), 0.65)


def _compute_growth_score(temp_avg, ph_avg, light_lux, fertilizer_mg_l):
    temp_score = _gaussian_score(temp_avg, center=29.0, spread=2.4)
    ph_score = _gaussian_score(ph_avg, center=6.0, spread=0.55)
    light_score = _light_score(light_lux)
    fert_score = _fertilizer_score(fertilizer_mg_l)
    scores = [score for score in [temp_score, ph_score, light_score, fert_score] if score is not None]
    if not scores:
        return None
    weighted = [
        (temp_score, 0.3),
        (ph_score, 0.3),
        (light_score, 0.2),
        (fert_score, 0.2),
    ]
    numerator = sum(score * weight for score, weight in weighted if score is not None)
    denominator = sum(weight for score, weight in weighted if score is not None)
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def get_model_runtime(model_path: str, metrics_path: str):
    model_path = Path(model_path)
    metrics_path = Path(metrics_path)
    with _MODEL_RUNTIME_LOCK:
        model_mtime = model_path.stat().st_mtime if model_path.exists() else None
        metrics_mtime = metrics_path.stat().st_mtime if metrics_path.exists() else None
        cache_hit = (
            _MODEL_RUNTIME_CACHE["model"] is not None
            and _MODEL_RUNTIME_CACHE["model_path"] == str(model_path)
            and _MODEL_RUNTIME_CACHE["metrics_path"] == str(metrics_path)
            and _MODEL_RUNTIME_CACHE["model_mtime"] == model_mtime
            and _MODEL_RUNTIME_CACHE["metrics_mtime"] == metrics_mtime
        )
        if cache_hit:
            return {
                "available": True,
                "model": _MODEL_RUNTIME_CACHE["model"],
                "feature_columns": list(_MODEL_RUNTIME_CACHE["feature_columns"]),
                "metrics": dict(_MODEL_RUNTIME_CACHE["metrics"]),
                "error": None,
            }

        if not model_path.exists():
            return {
                "available": False,
                "model": None,
                "feature_columns": list(HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS),
                "metrics": {},
                "error": f"model file not found: {model_path}",
            }

        try:
            import joblib
        except ImportError as exc:
            return {
                "available": False,
                "model": None,
                "feature_columns": list(HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS),
                "metrics": {},
                "error": f"missing dependency: {exc}",
            }

        metrics = {}
        feature_columns = list(HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS)
        if metrics_path.exists():
            try:
                metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
                feature_columns = list(
                    metrics.get("feature_cols")
                    or metrics.get("feature_columns")
                    or HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS
                )
            except Exception as exc:
                metrics = {"warning": f"failed to read metrics json: {exc}"}

        try:
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message="Trying to unpickle estimator.*",
                )
                loaded_model = joblib.load(model_path)
        except Exception as exc:
            return {
                "available": False,
                "model": None,
                "feature_columns": feature_columns,
                "metrics": metrics,
                "error": f"failed to load model: {exc}",
            }

        _MODEL_RUNTIME_CACHE.update(
            {
                "model_path": str(model_path),
                "metrics_path": str(metrics_path),
                "model_mtime": model_mtime,
                "metrics_mtime": metrics_mtime,
                "model": loaded_model,
                "feature_columns": list(feature_columns),
                "metrics": dict(metrics),
                "error": None,
            }
        )
        return {
            "available": True,
            "model": loaded_model,
            "feature_columns": list(feature_columns),
            "metrics": dict(metrics),
            "error": None,
        }


def build_model_feature_vector(
    feature_bundle: dict,
    *,
    default_light_lux: float | int | None = None,
    default_fertilizer_mg_l: float | int | None = None,
    optimal_ph: float = 6.0,
):
    latest = feature_bundle.get("latest") or {}
    latest_summary = latest.get("daily_summary") or {}
    model_input = feature_bundle.get("model_input") or {}
    daily_points = list((feature_bundle.get("time_series") or {}).get("daily_summaries") or [])

    coverage_series = []
    temp_series = []
    ph_series = []
    temp_max_series = []
    ph_max_series = []
    coverage_max_series = []

    for point in daily_points:
        coverage_series.append(
            _first_non_none(
                _coerce_float(point.get("daily_image_coverage_percent")),
                _coerce_float(point.get("green_coverage_avg")),
            )
        )
        temp_series.append(_coerce_float(point.get("temp_avg")))
        ph_series.append(_coerce_float(point.get("ph_avg")))
        temp_max_series.append(_coerce_float(point.get("temp_max")))
        ph_max_series.append(_coerce_float(point.get("ph_max")))
        coverage_max_series.append(_coerce_float(point.get("green_coverage_max")))

    coverage_now = _first_non_none(
        _coerce_float(latest_summary.get("daily_image_coverage_percent")),
        _coerce_float(latest_summary.get("green_coverage_avg")),
        _coerce_float(model_input.get("latest_daily_image_coverage_percent")),
        _coerce_float(model_input.get("latest_green_coverage_percent")),
        _last_non_none(coverage_series),
    )
    coverage_avg = _first_non_none(
        _coerce_float(latest_summary.get("green_coverage_avg")),
        _coerce_float(model_input.get("window_sensor_coverage_mean")),
        coverage_now,
    )
    coverage_max = _first_non_none(
        _coerce_float(latest_summary.get("green_coverage_max")),
        _last_non_none(coverage_max_series),
        coverage_now,
    )

    temp_avg = _first_non_none(
        _coerce_float(latest_summary.get("temp_avg")),
        _coerce_float(model_input.get("latest_temp_c")),
        _last_non_none(temp_series),
    )
    temp_max = _first_non_none(
        _coerce_float(latest_summary.get("temp_max")),
        _last_non_none(temp_max_series),
        temp_avg,
    )
    ph_avg = _first_non_none(
        _coerce_float(latest_summary.get("ph_avg")),
        _coerce_float(model_input.get("latest_ph")),
        _last_non_none(ph_series),
    )
    ph_max = _first_non_none(
        _coerce_float(latest_summary.get("ph_max")),
        _last_non_none(ph_max_series),
        ph_avg,
    )

    lag1_coverage = coverage_series[-2] if len(coverage_series) >= 2 else None
    lag1_temp = temp_series[-2] if len(temp_series) >= 2 else None
    lag1_ph = ph_series[-2] if len(ph_series) >= 2 else None

    if lag1_coverage is None and len(coverage_series) == 1 and coverage_now != coverage_series[-1]:
        lag1_coverage = coverage_series[-1]
    if lag1_temp is None and len(temp_series) == 1 and temp_avg != temp_series[-1]:
        lag1_temp = temp_series[-1]
    if lag1_ph is None and len(ph_series) == 1 and ph_avg != ph_series[-1]:
        lag1_ph = ph_series[-1]

    roll3_coverage_values = [value for value in (coverage_series[-2:] + [coverage_now]) if value is not None][-3:]
    roll3_temp_values = [value for value in (temp_series[-2:] + [temp_avg]) if value is not None][-3:]
    roll3_ph_values = [value for value in (ph_series[-2:] + [ph_avg]) if value is not None][-3:]

    light_lux = _coerce_float(default_light_lux)
    fertilizer_mg_l = _coerce_float(default_fertilizer_mg_l)
    ph_gap_from_optimal = abs(ph_avg - optimal_ph) if ph_avg is not None else None
    light_in_optimal_band = (
        1 if light_lux is not None and 5000 <= light_lux <= 10000 else 0
        if light_lux is not None
        else None
    )
    fertilizer_in_optimal_band = (
        1 if fertilizer_mg_l is not None and int(fertilizer_mg_l) in {50, 100, 200} else 0
        if fertilizer_mg_l is not None
        else None
    )

    return {
        "coverage_now": coverage_now,
        "coverage_avg": coverage_avg,
        "coverage_max": coverage_max,
        "temp_avg": temp_avg,
        "temp_max": temp_max,
        "ph_avg": ph_avg,
        "ph_max": ph_max,
        "lag1_coverage": lag1_coverage,
        "lag1_temp": lag1_temp,
        "lag1_ph": lag1_ph,
        "delta_coverage": (
            round(coverage_now - lag1_coverage, 4)
            if coverage_now is not None and lag1_coverage is not None
            else None
        ),
        "delta_temp": (
            round(temp_avg - lag1_temp, 4)
            if temp_avg is not None and lag1_temp is not None
            else None
        ),
        "delta_ph": (
            round(ph_avg - lag1_ph, 4)
            if ph_avg is not None and lag1_ph is not None
            else None
        ),
        "roll3_coverage_mean": _rolling_mean(roll3_coverage_values),
        "roll3_temp_mean": _rolling_mean(roll3_temp_values),
        "roll3_ph_mean": _rolling_mean(roll3_ph_values),
        "light_lux": light_lux,
        "fertilizer_mg_l": fertilizer_mg_l,
        "ph_gap_from_optimal": round(ph_gap_from_optimal, 4) if ph_gap_from_optimal is not None else None,
        "light_in_optimal_band": light_in_optimal_band,
        "fertilizer_in_optimal_band": fertilizer_in_optimal_band,
        "growth_score": _compute_growth_score(
            temp_avg,
            ph_avg,
            light_lux,
            fertilizer_mg_l,
        ),
        "coverage_running_max": max(
            [value for value in coverage_series + [coverage_now] if value is not None],
            default=None,
        ),
    }


def run_harvest_model_prediction(
    feature_bundle: dict,
    *,
    model_path: str,
    metrics_path: str,
    timezone_name: str,
    default_light_lux: float | int | None = None,
    default_fertilizer_mg_l: float | int | None = None,
    optimal_ph: float = 6.0,
):
    runtime = get_model_runtime(model_path, metrics_path)
    if not runtime["available"]:
        return {
            "model_available": False,
            "prediction": {
                "days_to_harvest": None,
                "predicted_harvest_at": None,
                "confidence_score": None,
                "uncertainty_days": None,
            },
            "model": {
                "available": False,
                "name": None,
                "version": HARVEST_MODEL_DEFAULT_VERSION,
                "source": str(model_path),
                "feature_count": len(runtime.get("feature_columns") or []),
                "error": runtime.get("error"),
            },
            "feature_vector": build_model_feature_vector(
                feature_bundle,
                default_light_lux=default_light_lux,
                default_fertilizer_mg_l=default_fertilizer_mg_l,
                optimal_ph=optimal_ph,
            ),
        }

    feature_vector = build_model_feature_vector(
        feature_bundle,
        default_light_lux=default_light_lux,
        default_fertilizer_mg_l=default_fertilizer_mg_l,
        optimal_ph=optimal_ph,
    )
    feature_columns = runtime["feature_columns"] or list(HARVEST_MODEL_DEFAULT_FEATURE_COLUMNS)
    ordered_values = [
        float(value) if value is not None else float("nan")
        for value in (feature_vector.get(column) for column in feature_columns)
    ]

    model = runtime["model"]
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="X does not have valid feature names, but SimpleImputer was fitted with feature names",
        )
        prediction_raw = float(model.predict([ordered_values])[0])
    days_to_harvest = round(max(prediction_raw, 0.0), 2)

    confidence_score = None
    uncertainty_days = None
    regressor = getattr(model, "named_steps", {}).get("regressor")
    imputer = getattr(model, "named_steps", {}).get("imputer")
    estimators = getattr(regressor, "estimators_", None)
    if estimators:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="X does not have valid feature names, but SimpleImputer was fitted with feature names",
            )
            transformed = imputer.transform([ordered_values]) if imputer is not None else [ordered_values]
            tree_predictions = [float(estimator.predict(transformed)[0]) for estimator in estimators]
        uncertainty_days = round(pstdev(tree_predictions), 4) if len(tree_predictions) > 1 else 0.0
        confidence_score = round(_clamp(1.0 / (1.0 + (uncertainty_days or 0.0)), 0.0, 1.0), 4)

    reference_at = feature_bundle.get("reference_at")
    predicted_harvest_at = None
    if reference_at:
        local_reference = datetime.fromisoformat(reference_at).astimezone(ZoneInfo(timezone_name))
        predicted_harvest_at = (local_reference + timedelta(days=days_to_harvest)).isoformat()

    return {
        "model_available": True,
        "prediction": {
            "days_to_harvest": days_to_harvest,
            "predicted_harvest_at": predicted_harvest_at,
            "confidence_score": confidence_score,
            "uncertainty_days": uncertainty_days,
        },
        "model": {
            "available": True,
            "name": Path(model_path).name,
            "version": HARVEST_MODEL_DEFAULT_VERSION,
            "source": str(model_path),
            "feature_count": len(feature_columns),
            "error": None,
        },
        "feature_vector": {
            column: feature_vector.get(column)
            for column in feature_columns
        },
    }


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


def build_model_prediction_run(
    feature_bundle: dict,
    *,
    model_path: str,
    metrics_path: str,
    timezone_name: str,
    default_light_lux: float | int | None = None,
    default_fertilizer_mg_l: float | int | None = None,
    optimal_ph: float = 6.0,
):
    now_utc = datetime.now(timezone.utc)
    readiness = assess_harvest_prediction_readiness(feature_bundle)
    cycle = feature_bundle.get("cycle") or {}
    model_input = feature_bundle.get("model_input") or {}
    model_result = run_harvest_model_prediction(
        feature_bundle,
        model_path=model_path,
        metrics_path=metrics_path,
        timezone_name=timezone_name,
        default_light_lux=default_light_lux,
        default_fertilizer_mg_l=default_fertilizer_mg_l,
        optimal_ph=optimal_ph,
    )

    if not readiness["ready"]:
        status = "blocked_not_ready"
    elif not model_result["model_available"]:
        status = "blocked_model_unavailable"
    else:
        status = "predicted"

    return {
        "prediction_type": HARVEST_PREDICTION_TYPE,
        "target_name": feature_bundle.get("target_name"),
        "feature_version": feature_bundle.get("feature_version"),
        "status": status,
        "ready_for_model": readiness["ready"] and model_result["model_available"],
        "blocking_reasons": readiness["blocking_reasons"],
        "warnings": readiness["warnings"],
        "cycle_id": cycle.get("cycle_id"),
        "cycle_name": cycle.get("name"),
        "cycle_day_index": cycle.get("cycle_day_index"),
        "lookback_days": feature_bundle.get("lookback_days"),
        "prediction": {
            "days_to_harvest": model_result["prediction"].get("days_to_harvest"),
            "predicted_harvest_at": model_result["prediction"].get("predicted_harvest_at"),
            "confidence_score": model_result["prediction"].get("confidence_score"),
            "uncertainty_days": model_result["prediction"].get("uncertainty_days"),
            "baseline_expected_days_to_harvest": model_input.get(
                "baseline_expected_days_to_harvest"
            ),
            "baseline_expected_harvest_at": cycle.get("expected_harvest_at"),
        },
        "model": model_result["model"],
        "feature_vector": model_result["feature_vector"],
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
