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
PUMP_FERTILIZER_PINS = get_int_list_env(
    "PUMP_FERTILIZER_PINS",
    [get_int_env("PUMP_FERTILIZER_PIN", 13)],
)
PUMP_FERTILIZER_ACTIVE_LOW = get_bool_env("PUMP_FERTILIZER_ACTIVE_LOW", False)
AUTOMATION_COLLECTION = os.getenv("AUTOMATION_COLLECTION", "automation_rules")
AUTOMATION_POLL_SECONDS = get_int_env("AUTOMATION_POLL_SECONDS", 5)
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Bangkok")
DEFAULT_GROW_CYCLE_DAYS = max(get_int_env("DEFAULT_GROW_CYCLE_DAYS", 14), 1)
PREDICTION_LOOKBACK_DAYS = max(get_int_env("PREDICTION_LOOKBACK_DAYS", 7), 1)
PREDICTION_SENSOR_LIMIT = max(get_int_env("PREDICTION_SENSOR_LIMIT", 240), 1)

CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]
