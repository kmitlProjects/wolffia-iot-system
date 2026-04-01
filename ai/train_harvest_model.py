import argparse
import json
import pickle
from pathlib import Path


DEFAULT_FEATURE_COLUMNS = [
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
    "light_lux",
    "fertilizer_mg_l",
    "ph_gap_from_optimal",
    "light_in_optimal_band",
    "fertilizer_in_optimal_band",
    "growth_score",
    "coverage_running_max",
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train a baseline harvest-days model from the feature dataset."
    )
    parser.add_argument(
        "--input-csv",
        default="data/exports/model_training/synthetic_harvest_feature_dataset_v1.csv",
        help="Feature dataset CSV to train from.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/exports/model_training/model_artifacts",
        help="Directory where the trained model and metrics will be written.",
    )
    parser.add_argument(
        "--target-column",
        default="label_days_to_harvest",
        help="Target column for regression.",
    )
    parser.add_argument(
        "--test-cycle-ratio",
        type=float,
        default=0.2,
        help="Fraction of cycle_ids held out for evaluation.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducible splitting and model training.",
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=300,
        help="Number of trees for the RandomForestRegressor.",
    )
    return parser.parse_args()


def _normalize_bool_series(series):
    return (
        series.astype(str)
        .str.strip()
        .str.lower()
        .map({"true": 1, "false": 0, "1": 1, "0": 0, "yes": 1, "no": 0})
    )


def main():
    args = parse_args()
    try:
        import pandas as pd
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.impute import SimpleImputer
        from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
        from sklearn.pipeline import Pipeline
    except ImportError as exc:
        raise SystemExit(
            "This script is meant to run in Google Colab or an environment with "
            "pandas and scikit-learn installed. Missing dependency: "
            f"{exc}"
        )

    input_csv = Path(args.input_csv)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(input_csv)
    if df.empty:
        raise SystemExit(f"No rows found in {input_csv}")

    if "row_ready_for_training" in df.columns:
        ready_mask = _normalize_bool_series(df["row_ready_for_training"]).fillna(0).astype(int)
        df = df.loc[ready_mask == 1].copy()

    if args.target_column not in df.columns:
        raise SystemExit(f"Missing target column: {args.target_column}")

    if "cycle_id" not in df.columns:
        raise SystemExit("Feature dataset must contain cycle_id for grouped splitting.")

    feature_columns = [column for column in DEFAULT_FEATURE_COLUMNS if column in df.columns]
    if not feature_columns:
        raise SystemExit("No expected feature columns were found in the input dataset.")

    for column in feature_columns:
        if df[column].dtype == object:
            normalized = _normalize_bool_series(df[column])
            if normalized.notna().sum() > 0:
                df[column] = normalized
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df[args.target_column] = pd.to_numeric(df[args.target_column], errors="coerce")
    df = df.dropna(subset=[args.target_column])
    if df.empty:
        raise SystemExit("No trainable rows remain after filtering missing targets.")

    unique_cycles = sorted(df["cycle_id"].dropna().unique().tolist())
    if len(unique_cycles) < 2:
        raise SystemExit("Need at least 2 cycle_ids to make a grouped train/test split.")

    rng = __import__("random").Random(args.random_state)
    rng.shuffle(unique_cycles)
    test_count = max(1, int(round(len(unique_cycles) * args.test_cycle_ratio)))
    if test_count >= len(unique_cycles):
        test_count = len(unique_cycles) - 1
    test_cycles = set(unique_cycles[:test_count])
    train_cycles = set(unique_cycles[test_count:])

    train_df = df[df["cycle_id"].isin(train_cycles)].copy()
    test_df = df[df["cycle_id"].isin(test_cycles)].copy()

    X_train = train_df[feature_columns]
    y_train = train_df[args.target_column]
    X_test = test_df[feature_columns]
    y_test = test_df[args.target_column]

    model = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "regressor",
                RandomForestRegressor(
                    n_estimators=args.n_estimators,
                    random_state=args.random_state,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    mse = mean_squared_error(y_test, y_pred)
    metrics = {
        "input_csv": str(input_csv),
        "target_column": args.target_column,
        "feature_columns": feature_columns,
        "train_cycle_count": len(train_cycles),
        "test_cycle_count": len(test_cycles),
        "train_row_count": int(len(train_df)),
        "test_row_count": int(len(test_df)),
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 4),
        "rmse": round(float(mse ** 0.5), 4),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "random_state": args.random_state,
        "n_estimators": args.n_estimators,
    }

    model_path = output_dir / "harvest_baseline_model.pkl"
    metrics_path = output_dir / "harvest_baseline_metrics.json"
    columns_path = output_dir / "harvest_baseline_feature_columns.json"
    predictions_path = output_dir / "harvest_baseline_test_predictions.csv"

    with model_path.open("wb") as handle:
        pickle.dump(model, handle)
    with metrics_path.open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2, ensure_ascii=False)
    with columns_path.open("w", encoding="utf-8") as handle:
        json.dump(feature_columns, handle, indent=2, ensure_ascii=False)

    prediction_rows = test_df[["cycle_id", "date", "day_index", args.target_column]].copy()
    prediction_rows["predicted_days_to_harvest"] = y_pred
    prediction_rows.to_csv(predictions_path, index=False)

    print("baseline model training complete")
    print(f"train cycles: {len(train_cycles)}")
    print(f"test cycles: {len(test_cycles)}")
    print(f"train rows: {len(train_df)}")
    print(f"test rows: {len(test_df)}")
    print(f"mae: {metrics['mae']}")
    print(f"rmse: {metrics['rmse']}")
    print(f"r2: {metrics['r2']}")
    print(f"model: {model_path}")
    print(f"metrics: {metrics_path}")
    print(f"predictions: {predictions_path}")


if __name__ == "__main__":
    main()
