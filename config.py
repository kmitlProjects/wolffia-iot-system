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

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = get_int_env("MQTT_PORT", 1883)
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "pond1/data")
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")

CAMERA_DEVICE = os.getenv("CAMERA_DEVICE", "/dev/video0")
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

CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]
