import os
from pathlib import Path


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def get_int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError:
        return default


def get_float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        return float(value)
    except ValueError:
        return default


def get_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_int_list_env(name: str, default: list[int]) -> list[int]:
    value = os.getenv(name)
    if value is None:
        return list(default)

    pins = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue

        try:
            pins.append(int(item))
        except ValueError:
            continue

    return pins or list(default)


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "wolffia")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "sensor_data")
IMAGE_ANALYSIS_COLLECTION = os.getenv(
    "IMAGE_ANALYSIS_COLLECTION",
    "daily_image_analysis",
)
DAILY_SUMMARY_COLLECTION = os.getenv("DAILY_SUMMARY_COLLECTION", "daily_summary")
GROW_CYCLE_COLLECTION = os.getenv("GROW_CYCLE_COLLECTION", "grow_cycles")
PREDICTION_COLLECTION = os.getenv("PREDICTION_COLLECTION", "prediction_runs")
DEBUG_OUTPUT_DIR = os.getenv("DEBUG_OUTPUT_DIR", str(BASE_DIR / "data" / "debug"))
TRAINED_MODEL_DIR = os.getenv("TRAINED_MODEL_DIR", str(BASE_DIR / "data" / "train"))

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = get_int_env("MQTT_PORT", 1883)
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "pond1/data")
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
SENSOR_INTERVAL_SECONDS = max(get_int_env("SENSOR_INTERVAL_SECONDS", 3600), 1)
LOCAL_API_BASE_URL = os.getenv("LOCAL_API_BASE_URL", "http://127.0.0.1:8000")
IMAGE_ANALYSIS_REQUEST_TIMEOUT_SECONDS = max(
    get_int_env("IMAGE_ANALYSIS_REQUEST_TIMEOUT_SECONDS", 30),
    1,
)

CAMERA_DEVICE = os.getenv("CAMERA_DEVICE", "/dev/video0")
IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", str(BASE_DIR / "data" / "images"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
IMAGE_ANALYSIS_SOURCE_MODE = os.getenv(
    "IMAGE_ANALYSIS_SOURCE_MODE",
    "dataset",
).strip().lower()
IMAGE_ANALYSIS_SIMULATION_DIR = os.getenv(
    "IMAGE_ANALYSIS_SIMULATION_DIR",
    str(BASE_DIR / "test" / "test_image"),
)
IMAGE_ANALYSIS_ARCHIVE_ENABLED = get_bool_env(
    "IMAGE_ANALYSIS_ARCHIVE_ENABLED",
    False,
)
IMAGE_ANALYSIS_FORCE_LIGHT_OFF = get_bool_env(
    "IMAGE_ANALYSIS_FORCE_LIGHT_OFF",
    True,
)
IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS = max(
    get_int_env("IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS", 2),
    0,
)
SNAPSHOT_TIME = os.getenv("SNAPSHOT_TIME", "09:00")
SNAPSHOT_POLL_SECONDS = max(get_int_env("SNAPSHOT_POLL_SECONDS", 30), 5)
SNAPSHOT_TIMEOUT_SECONDS = max(get_int_env("SNAPSHOT_TIMEOUT_SECONDS", 15), 1)
COVERAGE_H_MIN = get_int_env("COVERAGE_H_MIN", 35)
COVERAGE_H_MAX = get_int_env("COVERAGE_H_MAX", 95)
COVERAGE_S_MIN = get_int_env("COVERAGE_S_MIN", 40)
COVERAGE_V_MIN = get_int_env("COVERAGE_V_MIN", 40)
COVERAGE_VERSION = os.getenv("COVERAGE_VERSION", "2026-04-01")
COVERAGE_ROI_X = max(get_int_env("COVERAGE_ROI_X", 0), 0)
COVERAGE_ROI_Y = max(get_int_env("COVERAGE_ROI_Y", 0), 0)
COVERAGE_ROI_WIDTH = max(get_int_env("COVERAGE_ROI_WIDTH", 0), 0)
COVERAGE_ROI_HEIGHT = max(get_int_env("COVERAGE_ROI_HEIGHT", 0), 0)
COVERAGE_ROI_CORNER_RADIUS = max(get_int_env("COVERAGE_ROI_CORNER_RADIUS", 0), 0)
COVERAGE_ROI_REFERENCE_WIDTH = max(get_int_env("COVERAGE_ROI_REFERENCE_WIDTH", 640), 1)
COVERAGE_ROI_REFERENCE_HEIGHT = max(get_int_env("COVERAGE_ROI_REFERENCE_HEIGHT", 480), 1)
LIGHT_PIN = get_int_env("LIGHT_PIN", 19)
LIGHT_ACTIVE_LOW = get_bool_env("LIGHT_ACTIVE_LOW", True)
PUMP_WATER_PIN = get_int_env("PUMP_WATER_PIN", 16)
PUMP_WATER_ACTIVE_LOW = get_bool_env("PUMP_WATER_ACTIVE_LOW", False)
WATER_PUMP_FLOW_L_PER_MIN = max(
    get_float_env("WATER_PUMP_FLOW_L_PER_MIN", 1.0),
    0.0,
)
PUMP_FERTILIZER_PINS = get_int_list_env(
    "PUMP_FERTILIZER_PINS",
    [get_int_env("PUMP_FERTILIZER_PIN", 13)],
)
PUMP_FERTILIZER_ACTIVE_LOW = get_bool_env("PUMP_FERTILIZER_ACTIVE_LOW", False)
FERTILIZER_PUMP_FLOW_ML_PER_MIN = max(
    get_float_env("FERTILIZER_PUMP_FLOW_ML_PER_MIN", 8.0),
    0.0,
)
FERTILIZER_DOSE_ML_PER_10L = max(
    get_float_env("FERTILIZER_DOSE_ML_PER_10L", 50.0),
    0.0,
)
AUTOMATION_COLLECTION = os.getenv("AUTOMATION_COLLECTION", "automation_rules")
AUTOMATION_POLL_SECONDS = get_int_env("AUTOMATION_POLL_SECONDS", 5)
ANOMALY_ALERT_COLLECTION = os.getenv(
    "ANOMALY_ALERT_COLLECTION",
    "anomaly_alerts",
)
ANOMALY_WATCH_ENABLED = get_bool_env("ANOMALY_WATCH_ENABLED", True)
ANOMALY_WEBHOOK_URL = os.getenv("ANOMALY_WEBHOOK_URL", "").strip()
ANOMALY_POLL_SECONDS = max(get_int_env("ANOMALY_POLL_SECONDS", 5), 2)
ANOMALY_MIN_AREA_PERCENT = max(
    get_float_env("ANOMALY_MIN_AREA_PERCENT", 2.5),
    0.1,
)
ANOMALY_PERSIST_FRAMES = max(get_int_env("ANOMALY_PERSIST_FRAMES", 1), 1)
ANOMALY_COOLDOWN_SECONDS = max(
    get_int_env("ANOMALY_COOLDOWN_SECONDS", 300),
    0,
)
ANOMALY_DIFF_THRESHOLD = max(get_int_env("ANOMALY_DIFF_THRESHOLD", 28), 1)
ANOMALY_OUTPUT_DIR = os.getenv(
    "ANOMALY_OUTPUT_DIR",
    str(BASE_DIR / "data" / "anomaly_alerts"),
)
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Bangkok")
DEFAULT_GROW_CYCLE_DAYS = max(get_int_env("DEFAULT_GROW_CYCLE_DAYS", 14), 1)
PREDICTION_LOOKBACK_DAYS = max(get_int_env("PREDICTION_LOOKBACK_DAYS", 7), 1)
PREDICTION_SENSOR_LIMIT = max(get_int_env("PREDICTION_SENSOR_LIMIT", 240), 1)
HARVEST_MODEL_ENABLED = get_bool_env("HARVEST_MODEL_ENABLED", True)
HARVEST_MODEL_PATH = os.getenv(
    "HARVEST_MODEL_PATH",
    str(Path(TRAINED_MODEL_DIR) / "harvest_baseline_model_v2.joblib"),
)
HARVEST_MODEL_METRICS_PATH = os.getenv(
    "HARVEST_MODEL_METRICS_PATH",
    str(Path(TRAINED_MODEL_DIR) / "harvest_baseline_metrics_v2.json"),
)
HARVEST_MODEL_DEFAULT_LIGHT_LUX = max(
    get_int_env("HARVEST_MODEL_DEFAULT_LIGHT_LUX", 7500),
    0,
)
HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L = max(
    get_int_env("HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L", 100),
    0,
)
HARVEST_MODEL_PH_OPTIMAL = float(os.getenv("HARVEST_MODEL_PH_OPTIMAL", "6.0"))

CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]
