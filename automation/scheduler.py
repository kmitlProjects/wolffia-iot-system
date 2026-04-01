import threading
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from bson import ObjectId

from actuators.ligth import light_off, light_on
from actuators.pump_water_control import run_pump_water

WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAY_LABELS = {
    "mon": "Mon",
    "tue": "Tue",
    "wed": "Wed",
    "thu": "Thu",
    "fri": "Fri",
    "sat": "Sat",
    "sun": "Sun",
}
WEEKDAY_ALIASES = {
    "mon": "mon",
    "monday": "mon",
    "tue": "tue",
    "tues": "tue",
    "tuesday": "tue",
    "wed": "wed",
    "wednesday": "wed",
    "thu": "thu",
    "thur": "thu",
    "thurs": "thu",
    "thursday": "thu",
    "fri": "fri",
    "friday": "fri",
    "sat": "sat",
    "saturday": "sat",
    "sun": "sun",
    "sunday": "sun",
    "all": "all",
    "daily": "all",
    "everyday": "all",
}


def _utcnow():
    return datetime.now(timezone.utc)


def normalize_time_value(value: str):
    if not isinstance(value, str):
        raise ValueError("time value must be a string in HH:MM format")

    try:
        parsed = datetime.strptime(value.strip(), "%H:%M")
    except ValueError as exc:
        raise ValueError("time must be in HH:MM format") from exc

    return parsed.strftime("%H:%M")


def normalize_days(days):
    if not isinstance(days, list) or not days:
        raise ValueError("days must be a non-empty list")

    normalized = []
    for day in days:
        if not isinstance(day, str):
            raise ValueError("days must contain weekday strings")

        key = WEEKDAY_ALIASES.get(day.strip().lower())
        if key is None:
            raise ValueError(f"unsupported weekday value: {day}")
        if key == "all":
            return list(WEEKDAY_ORDER)
        if key not in normalized:
            normalized.append(key)

    if not normalized:
        raise ValueError("days must contain at least one weekday")

    return normalized


def serialize_rule(document):
    if document is None:
        return None

    serialized = {
        "id": str(document["_id"]),
        "device": document["device"],
        "enabled": bool(document.get("enabled", True)),
        "days": list(document.get("days", [])),
        "created_at": document.get("created_at").isoformat()
        if document.get("created_at") is not None
        else None,
        "updated_at": document.get("updated_at").isoformat()
        if document.get("updated_at") is not None
        else None,
    }

    if document["device"] == "light":
        serialized["on_time"] = document.get("on_time")
        serialized["off_time"] = document.get("off_time")
    elif document["device"] == "pump_water":
        serialized["start_time"] = document.get("start_time")
        serialized["duration_seconds"] = document.get("duration_seconds")
        serialized["water_liters"] = document.get("water_liters")

    return serialized


class AutomationScheduler:
    def __init__(self, collection, timezone_name: str, poll_seconds: int = 5):
        self.collection = collection
        self.timezone_name = timezone_name
        self.timezone = ZoneInfo(timezone_name)
        self.poll_seconds = max(int(poll_seconds), 1)
        self._stop_event = threading.Event()
        self._thread = None
        self._lock = threading.RLock()

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="automation-scheduler",
                daemon=True,
            )
            self._thread.start()

    def stop(self):
        with self._lock:
            thread = self._thread
            if thread is None:
                return

            self._thread = None
            self._stop_event.set()

        thread.join(timeout=self.poll_seconds + 1)

    def get_rules(self):
        documents = list(
            self.collection.find().sort(
                [("device", 1), ("created_at", 1), ("_id", 1)]
            )
        )
        return [serialize_rule(document) for document in documents]

    def create_light_rule(self, on_time: str, off_time: str, days, enabled: bool = True):
        normalized_on = normalize_time_value(on_time)
        normalized_off = normalize_time_value(off_time)
        if normalized_on == normalized_off:
            raise ValueError("on_time and off_time must be different")

        document = {
            "device": "light",
            "enabled": bool(enabled),
            "days": normalize_days(days),
            "on_time": normalized_on,
            "off_time": normalized_off,
            "last_triggered": {"on": None, "off": None},
            "created_at": _utcnow(),
            "updated_at": _utcnow(),
        }
        inserted = self.collection.insert_one(document)
        return serialize_rule(self.collection.find_one({"_id": inserted.inserted_id}))

    def create_pump_water_rule(
        self,
        start_time: str,
        duration_seconds: float,
        water_liters: float | None,
        days,
        enabled: bool = True,
    ):
        duration_seconds = float(duration_seconds)
        if duration_seconds <= 0:
            raise ValueError("duration_seconds must be greater than 0")

        document = {
            "device": "pump_water",
            "enabled": bool(enabled),
            "days": normalize_days(days),
            "start_time": normalize_time_value(start_time),
            "duration_seconds": duration_seconds,
            "water_liters": float(water_liters) if water_liters is not None else None,
            "last_triggered": {"start": None},
            "created_at": _utcnow(),
            "updated_at": _utcnow(),
        }
        inserted = self.collection.insert_one(document)
        return serialize_rule(self.collection.find_one({"_id": inserted.inserted_id}))

    def set_rule_enabled(self, rule_id: str, enabled: bool):
        object_id = self._parse_object_id(rule_id)
        result = self.collection.update_one(
            {"_id": object_id},
            {"$set": {"enabled": bool(enabled), "updated_at": _utcnow()}},
        )
        if result.matched_count == 0:
            raise ValueError("automation rule not found")

        return serialize_rule(self.collection.find_one({"_id": object_id}))

    def delete_rule(self, rule_id: str):
        object_id = self._parse_object_id(rule_id)
        result = self.collection.delete_one({"_id": object_id})
        if result.deleted_count == 0:
            raise ValueError("automation rule not found")

        return {"deleted": True, "rule_id": rule_id}

    def _parse_object_id(self, value: str):
        try:
            return ObjectId(value)
        except Exception as exc:
            raise ValueError("invalid automation rule id") from exc

    def _run_loop(self):
        print(
            f"[scheduler] เริ่มทำงานที่ timezone {self.timezone_name} "
            f"และจะตรวจทุก {self.poll_seconds} วินาที"
        )

        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                print(f"[scheduler] เกิดข้อผิดพลาด: {exc}")

            self._stop_event.wait(self.poll_seconds)

    def _tick(self):
        now = datetime.now(self.timezone)
        current_time = now.strftime("%H:%M")
        today_key = now.strftime("%Y-%m-%d")
        weekday = WEEKDAY_ORDER[now.weekday()]

        rules = list(self.collection.find({"enabled": True}))
        for rule in rules:
            days = rule.get("days") or []
            if weekday not in days:
                continue

            if rule.get("device") == "light":
                self._process_light_rule(rule, current_time, today_key)
            elif rule.get("device") == "pump_water":
                self._process_pump_water_rule(rule, current_time, today_key)

    def _process_light_rule(self, rule, current_time: str, today_key: str):
        if rule.get("on_time") == current_time and not self._was_triggered(rule, "on", today_key):
            light_on()
            self._mark_triggered(rule["_id"], "on", today_key)
            print(
                f"[scheduler] เปิดไฟตาม rule {rule['_id']} เวลา {current_time}"
            )

        if rule.get("off_time") == current_time and not self._was_triggered(rule, "off", today_key):
            light_off()
            self._mark_triggered(rule["_id"], "off", today_key)
            print(
                f"[scheduler] ปิดไฟตาม rule {rule['_id']} เวลา {current_time}"
            )

    def _process_pump_water_rule(self, rule, current_time: str, today_key: str):
        if rule.get("start_time") != current_time:
            return

        if self._was_triggered(rule, "start", today_key):
            return

        try:
            run_pump_water(float(rule.get("duration_seconds", 0)))
            water_liters = rule.get("water_liters")
            print(
                f"[scheduler] เปิดปั๊มน้ำตาม rule {rule['_id']} "
                f"{water_liters if water_liters is not None else '-'} ลิตร "
                f"({rule.get('duration_seconds')} วินาที)"
            )
        except ValueError as exc:
            print(f"[scheduler] ข้าม rule {rule['_id']}: {exc}")
        finally:
            self._mark_triggered(rule["_id"], "start", today_key)

    def _was_triggered(self, rule, event_name: str, today_key: str):
        last_triggered = rule.get("last_triggered") or {}
        return last_triggered.get(event_name) == today_key

    def _mark_triggered(self, rule_id, event_name: str, today_key: str):
        self.collection.update_one(
            {"_id": rule_id},
            {
                "$set": {
                    f"last_triggered.{event_name}": today_key,
                    "updated_at": _utcnow(),
                }
            },
        )
