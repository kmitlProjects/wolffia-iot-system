import argparse
import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from build_feature_training_dataset import build_feature_rows


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Generate a synthetic Wolffia training dataset by combining the "
            "real image-derived coverage curve with docs-informed environmental "
            "ranges for pH, light, and fertilizer."
        )
    )
    parser.add_argument(
        "--input-csv",
        default="data/exports/model_training/harvest_training_dataset.csv",
        help="Raw exported dataset used to extract the base coverage curve.",
    )
    parser.add_argument(
        "--base-cycle-id",
        default="seed_cycle_20260311_test_image",
        help="Cycle id whose image-derived coverage curve will seed the synthetic data.",
    )
    parser.add_argument(
        "--cycles",
        type=int,
        default=120,
        help="How many synthetic grow cycles to generate.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility.",
    )
    parser.add_argument(
        "--raw-output-csv",
        default="data/exports/model_training/synthetic_harvest_training_dataset.csv",
        help="Where to write the synthetic raw dataset.",
    )
    parser.add_argument(
        "--feature-output-csv",
        default="data/exports/model_training/synthetic_harvest_feature_dataset_v1.csv",
        help="Where to write the synthetic feature dataset.",
    )
    return parser.parse_args()


def _coerce_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value):
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _read_rows(path: Path):
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _extract_base_curve(rows, base_cycle_id: str):
    curve_rows = [row for row in rows if row.get("cycle_id") == base_cycle_id]
    if not curve_rows:
        curve_rows = [
            row
            for row in rows
            if (row.get("data_source") or "") == "historical_image_seed"
        ]
    if not curve_rows:
        raise ValueError(
            "No suitable base cycle rows were found for synthetic data generation."
        )

    curve_rows.sort(
        key=lambda row: (
            _coerce_int(row.get("day_index")) or 0,
            row.get("date") or "",
        )
    )
    curve = []
    for row in curve_rows:
        coverage = _coerce_float(row.get("daily_image_coverage_percent"))
        if coverage is None:
            coverage = _coerce_float(row.get("green_coverage_avg"))
        if coverage is None:
            continue
        curve.append(
            {
                "day_index": _coerce_int(row.get("day_index")) or (len(curve) + 1),
                "coverage": coverage,
            }
        )
    if len(curve) < 3:
        raise ValueError("Base coverage curve is too short for interpolation.")
    return curve


def _interpolate_curve(curve, target_days: int):
    if target_days <= 0:
        return []
    source_positions = [item["day_index"] for item in curve]
    source_values = [item["coverage"] for item in curve]
    if len(source_values) == target_days:
        return source_values[:]

    source_min = source_positions[0]
    source_max = source_positions[-1]
    if target_days == 1:
        return [source_values[0]]

    interpolated = []
    for index in range(target_days):
        position = source_min + (source_max - source_min) * index / (target_days - 1)
        left_index = 0
        while left_index + 1 < len(source_positions) and source_positions[left_index + 1] < position:
            left_index += 1
        right_index = min(left_index + 1, len(source_positions) - 1)
        left_pos = source_positions[left_index]
        right_pos = source_positions[right_index]
        left_val = source_values[left_index]
        right_val = source_values[right_index]
        if right_pos == left_pos:
            interpolated.append(left_val)
            continue
        ratio = (position - left_pos) / (right_pos - left_pos)
        interpolated.append(left_val + (right_val - left_val) * ratio)
    return interpolated


def _clamp(value, low, high):
    return max(low, min(high, value))


def _gaussian_score(value, center, spread):
    return math.exp(-((value - center) ** 2) / (2 * (spread ** 2)))


def _light_score(light_lux):
    if 5000 <= light_lux <= 10000:
        return 1.0
    if light_lux < 5000:
        return _clamp(light_lux / 5000, 0.45, 0.95)
    return _clamp(10000 / light_lux, 0.4, 0.95)


def _fertilizer_score(fertilizer_mg_l):
    mapping = {
        50: 0.9,
        100: 1.0,
        200: 0.86,
        400: 0.7,
        800: 0.45,
        1600: 0.2,
    }
    return mapping.get(int(fertilizer_mg_l), 0.65)


def _build_cycle_environment(rng: random.Random):
    temp_center = _clamp(rng.gauss(28.5, 1.8), 24.0, 33.0)
    ph_center = _clamp(rng.gauss(5.9, 0.45), 5.0, 7.2)
    light_lux = int(_clamp(rng.gauss(7600, 2200), 2500, 12000))
    fertilizer_mg_l = rng.choices(
        [50, 100, 200, 400, 800],
        weights=[2, 5, 3, 2, 1],
        k=1,
    )[0]

    temp_score = _gaussian_score(temp_center, center=29.0, spread=2.4)
    ph_score = _gaussian_score(ph_center, center=6.0, spread=0.55)
    light_score = _light_score(light_lux)
    fert_score = _fertilizer_score(fertilizer_mg_l)
    growth_score = round(
        0.3 * temp_score + 0.3 * ph_score + 0.2 * light_score + 0.2 * fert_score,
        4,
    )

    return {
        "temp_center": round(temp_center, 2),
        "ph_center": round(ph_center, 2),
        "light_lux": light_lux,
        "fertilizer_mg_l": fertilizer_mg_l,
        "growth_score": growth_score,
    }


def _daily_sensor_values(env, day_index: int, target_days: int, rng: random.Random):
    progress = day_index / max(target_days, 1)
    temp_avg = env["temp_center"] + math.sin(progress * math.pi) * 0.8 + rng.gauss(0, 0.35)
    temp_max = temp_avg + abs(rng.gauss(0.55, 0.2))
    ph_drift = (progress - 0.5) * 0.18
    ph_avg = env["ph_center"] + ph_drift + rng.gauss(0, 0.08)
    ph_max = ph_avg + abs(rng.gauss(0.09, 0.03))
    return {
        "temp_avg": round(_clamp(temp_avg, 22.0, 35.0), 2),
        "temp_min": round(_clamp(temp_avg - abs(rng.gauss(0.45, 0.15)), 20.0, 34.0), 2),
        "temp_max": round(_clamp(temp_max, 22.0, 36.0), 2),
        "ph_avg": round(_clamp(ph_avg, 4.8, 7.5), 2),
        "ph_min": round(_clamp(ph_avg - abs(rng.gauss(0.1, 0.03)), 4.5, 7.2), 2),
        "ph_max": round(_clamp(ph_max, 4.9, 7.6), 2),
    }


def _daily_coverage(base_curve, env, day_index: int, target_days: int, rng: random.Random):
    progress = day_index / max(target_days, 1)
    base_value = base_curve[day_index - 1]
    growth_multiplier = 0.82 + (env["growth_score"] * 0.5)
    late_boost = 0.9 + 0.25 * progress
    noise = rng.gauss(0, 1.9)
    coverage = base_value * growth_multiplier * late_boost + noise
    if day_index <= 2:
        coverage *= 0.85
    if day_index >= max(target_days - 2, 1):
        coverage *= 1.03
    return round(_clamp(coverage, 0.5, 95.0), 2)


def generate_synthetic_rows(base_curve, cycle_count: int, rng: random.Random):
    rows = []
    local_tz = ZoneInfo("Asia/Bangkok")
    base_start = datetime(2026, 3, 1, 9, 0, tzinfo=local_tz)
    for cycle_number in range(1, cycle_count + 1):
        env = _build_cycle_environment(rng)
        target_days = int(
            round(
                _clamp(
                    14 - ((env["growth_score"] - 0.75) * 8) + rng.gauss(0, 1.2),
                    10,
                    18,
                )
            )
        )
        curve_for_cycle = _interpolate_curve(base_curve, target_days)
        planted_offset_days = rng.randint(0, 30)
        planted_at = base_start + timedelta(days=planted_offset_days)
        harvested_at = planted_at + timedelta(days=target_days - 1)
        planted_at_local = planted_at.isoformat()
        harvested_at_local = harvested_at.isoformat()
        cycle_id = f"synthetic_cycle_{cycle_number:03d}"
        latest_max = 0.0

        for day_index in range(1, target_days + 1):
            current_at = planted_at + timedelta(days=day_index - 1)
            date = current_at.date().isoformat()
            sensor = _daily_sensor_values(env, day_index, target_days, rng)
            coverage_now = _daily_coverage(curve_for_cycle, env, day_index, target_days, rng)
            latest_max = max(latest_max, coverage_now)
            rows.append(
                {
                    "cycle_id": cycle_id,
                    "cycle_name": "Synthetic KU baseline",
                    "cycle_status": "harvested",
                    "planted_at_local": planted_at_local,
                    "harvested_at_local": harvested_at_local,
                    "target_harvest_days": target_days,
                    "actual_duration_days": target_days,
                    "date": date,
                    "day_index": day_index,
                    "days_to_harvest_label": target_days - day_index,
                    "expected_days_to_harvest": target_days - day_index,
                    "sensor_count": 24,
                    "coverage_count": 24,
                    "temp_avg": sensor["temp_avg"],
                    "temp_min": sensor["temp_min"],
                    "temp_max": sensor["temp_max"],
                    "ph_avg": sensor["ph_avg"],
                    "ph_min": sensor["ph_min"],
                    "ph_max": sensor["ph_max"],
                    "green_coverage_avg": coverage_now,
                    "green_coverage_min": round(max(0.0, coverage_now - abs(rng.gauss(1.4, 0.7))), 2),
                    "green_coverage_max": round(min(100.0, coverage_now + abs(rng.gauss(1.8, 0.8))), 2),
                    "daily_image_coverage_percent": coverage_now,
                    "coverage_method": "synthetic_from_lab_clahe_exg_otsu_v3",
                    "coverage_version": "2026-04-01-synth-v1",
                    "analysis_source_mode": "synthetic",
                    "analysis_source_label": f"synthetic_seed_curve_{cycle_number:03d}",
                    "latest_sensor_timestamp_local": current_at.isoformat(),
                    "latest_sensor_coverage_percent": coverage_now,
                    "data_source": "synthetic_bootstrap",
                    "has_temp_ph": True,
                    "has_label": True,
                    "row_ready_for_training": True,
                    "light_lux": env["light_lux"],
                    "fertilizer_mg_l": env["fertilizer_mg_l"],
                    "ph_gap_from_optimal": round(abs(sensor["ph_avg"] - 6.0), 2),
                    "light_in_optimal_band": 5000 <= env["light_lux"] <= 10000,
                    "fertilizer_in_optimal_band": env["fertilizer_mg_l"] in {50, 100, 200},
                    "growth_score": env["growth_score"],
                    "coverage_running_max": round(latest_max, 2),
                    "source_type": "synthetic",
                }
            )
    return rows


def _feature_fieldnames():
    return [
        "cycle_id",
        "date",
        "day_index",
        "target_harvest_days",
        "expected_days_to_harvest",
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
        "coverage_method",
        "coverage_version",
        "analysis_source_mode",
        "label_days_to_harvest",
        "row_ready_for_training",
        "light_lux",
        "fertilizer_mg_l",
        "ph_gap_from_optimal",
        "light_in_optimal_band",
        "fertilizer_in_optimal_band",
        "growth_score",
        "coverage_running_max",
        "source_type",
    ]


def _write_csv(path: Path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    args = parse_args()
    rng = random.Random(args.seed)
    input_csv = Path(args.input_csv)
    raw_output = Path(args.raw_output_csv)
    feature_output = Path(args.feature_output_csv)

    rows = _read_rows(input_csv)
    base_curve = _extract_base_curve(rows, args.base_cycle_id)
    synthetic_rows = generate_synthetic_rows(base_curve, args.cycles, rng)

    raw_fieldnames = list(synthetic_rows[0].keys())
    _write_csv(raw_output, raw_fieldnames, synthetic_rows)

    feature_rows = build_feature_rows(synthetic_rows, include_nonready=True)
    raw_lookup = {(row["cycle_id"], row["date"]): row for row in synthetic_rows}
    enriched_feature_rows = []
    for row in feature_rows:
        raw_row = raw_lookup.get((row["cycle_id"], row["date"]), {})
        enriched_feature_rows.append(
            {
                **row,
                "light_lux": raw_row.get("light_lux"),
                "fertilizer_mg_l": raw_row.get("fertilizer_mg_l"),
                "ph_gap_from_optimal": raw_row.get("ph_gap_from_optimal"),
                "light_in_optimal_band": raw_row.get("light_in_optimal_band"),
                "fertilizer_in_optimal_band": raw_row.get("fertilizer_in_optimal_band"),
                "growth_score": raw_row.get("growth_score"),
                "coverage_running_max": raw_row.get("coverage_running_max"),
                "source_type": raw_row.get("source_type"),
            }
        )

    _write_csv(feature_output, _feature_fieldnames(), enriched_feature_rows)

    print(f"synthetic cycles: {args.cycles}")
    print(f"raw rows: {len(synthetic_rows)}")
    print(f"feature rows: {len(enriched_feature_rows)}")
    print(f"raw csv: {raw_output}")
    print(f"feature csv: {feature_output}")


if __name__ == "__main__":
    main()
