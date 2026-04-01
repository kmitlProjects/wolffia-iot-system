import argparse
import csv
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a first-pass feature dataset for model training."
    )
    parser.add_argument(
        "--input-csv",
        default="data/exports/model_training/harvest_training_dataset.csv",
        help="Raw training dataset exported from MongoDB.",
    )
    parser.add_argument(
        "--output-csv",
        default="data/exports/model_training/harvest_feature_dataset_v1.csv",
        help="Feature dataset ready to feed into a model pipeline.",
    )
    parser.add_argument(
        "--include-nonready",
        action="store_true",
        help="Keep rows even when temp/ph or label are missing.",
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


def _rolling_mean(values):
    numeric = [value for value in values if value is not None]
    if not numeric:
        return None
    return round(sum(numeric) / len(numeric), 2)


def build_feature_rows(rows, include_nonready: bool):
    grouped = {}
    for row in rows:
        grouped.setdefault(row["cycle_id"], []).append(row)

    feature_rows = []
    for cycle_rows in grouped.values():
        cycle_rows.sort(key=lambda item: (_coerce_int(item.get("day_index")) or 0, item.get("date") or ""))

        coverage_history = []
        temp_history = []
        ph_history = []

        for row in cycle_rows:
            ready = str(row.get("row_ready_for_training") or "").lower() in {"true", "1", "yes"}
            if not include_nonready and not ready:
                coverage_history.append(_coerce_float(row.get("daily_image_coverage_percent")) or _coerce_float(row.get("green_coverage_avg")))
                temp_history.append(_coerce_float(row.get("temp_avg")))
                ph_history.append(_coerce_float(row.get("ph_avg")))
                continue

            coverage_now = _coerce_float(row.get("daily_image_coverage_percent"))
            if coverage_now is None:
                coverage_now = _coerce_float(row.get("green_coverage_avg"))
            temp_now = _coerce_float(row.get("temp_avg"))
            ph_now = _coerce_float(row.get("ph_avg"))

            lag1_coverage = coverage_history[-1] if coverage_history else None
            lag1_temp = temp_history[-1] if temp_history else None
            lag1_ph = ph_history[-1] if ph_history else None

            last3_coverage = (coverage_history + [coverage_now])[-3:]
            last3_temp = (temp_history + [temp_now])[-3:]
            last3_ph = (ph_history + [ph_now])[-3:]

            feature_rows.append(
                {
                    "cycle_id": row.get("cycle_id"),
                    "date": row.get("date"),
                    "day_index": _coerce_int(row.get("day_index")),
                    "target_harvest_days": _coerce_int(row.get("target_harvest_days")),
                    "expected_days_to_harvest": _coerce_int(row.get("expected_days_to_harvest")),
                    "coverage_now": coverage_now,
                    "coverage_avg": _coerce_float(row.get("green_coverage_avg")),
                    "coverage_max": _coerce_float(row.get("green_coverage_max")),
                    "temp_avg": temp_now,
                    "temp_max": _coerce_float(row.get("temp_max")),
                    "ph_avg": ph_now,
                    "ph_max": _coerce_float(row.get("ph_max")),
                    "lag1_coverage": lag1_coverage,
                    "lag1_temp": lag1_temp,
                    "lag1_ph": lag1_ph,
                    "delta_coverage": (
                        round(coverage_now - lag1_coverage, 2)
                        if coverage_now is not None and lag1_coverage is not None
                        else None
                    ),
                    "delta_temp": (
                        round(temp_now - lag1_temp, 2)
                        if temp_now is not None and lag1_temp is not None
                        else None
                    ),
                    "delta_ph": (
                        round(ph_now - lag1_ph, 2)
                        if ph_now is not None and lag1_ph is not None
                        else None
                    ),
                    "roll3_coverage_mean": _rolling_mean(last3_coverage),
                    "roll3_temp_mean": _rolling_mean(last3_temp),
                    "roll3_ph_mean": _rolling_mean(last3_ph),
                    "coverage_method": row.get("coverage_method"),
                    "coverage_version": row.get("coverage_version"),
                    "analysis_source_mode": row.get("analysis_source_mode"),
                    "label_days_to_harvest": _coerce_int(row.get("days_to_harvest_label")),
                    "row_ready_for_training": ready,
                }
            )

            coverage_history.append(coverage_now)
            temp_history.append(temp_now)
            ph_history.append(ph_now)

    return feature_rows


def main():
    args = parse_args()
    input_csv = Path(args.input_csv)
    output_csv = Path(args.output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    with input_csv.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    feature_rows = build_feature_rows(rows, include_nonready=args.include_nonready)
    fieldnames = [
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
    ]

    with output_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(feature_rows)

    ready_count = sum(1 for row in feature_rows if row["row_ready_for_training"])
    print(f"rows exported: {len(feature_rows)}")
    print(f"rows ready for model: {ready_count}")
    print(f"csv: {output_csv}")


if __name__ == "__main__":
    main()
