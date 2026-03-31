from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo


def ensure_grow_cycle_indexes(collection):
    collection.create_index("cycle_id", name="grow_cycle_id_uidx", unique=True)
    collection.create_index(
        [("status", 1), ("planted_at", -1)],
        name="grow_cycle_status_planted_idx",
    )
    collection.create_index("updated_at", name="grow_cycle_updated_idx")


def _coerce_datetime(value, timezone_name: str):
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


def _build_cycle_id(planted_at: datetime):
    return f"cycle_{planted_at.strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"


def get_active_cycle(collection, at_time: datetime | None = None, timezone_name: str = "Asia/Bangkok"):
    ensure_grow_cycle_indexes(collection)

    query = {"status": "active"}
    if at_time is not None:
        target_at = _coerce_datetime(at_time, timezone_name)
        query["planted_at"] = {"$lte": target_at}

    return collection.find_one(query, sort=[("planted_at", -1)])


def list_cycles(collection, limit: int = 30):
    ensure_grow_cycle_indexes(collection)
    safe_limit = max(min(int(limit), 180), 1)
    return list(collection.find().sort([("planted_at", -1)]).limit(safe_limit))


def start_cycle(
    collection,
    timezone_name: str,
    name: str | None = None,
    planted_at: datetime | str | None = None,
    target_harvest_days: int = 14,
    notes: str | None = None,
):
    ensure_grow_cycle_indexes(collection)

    active_cycle = get_active_cycle(collection, timezone_name=timezone_name)
    if active_cycle is not None:
        raise ValueError("มีรอบปลูกที่กำลัง active อยู่แล้ว")

    planted_local = _coerce_datetime(planted_at, timezone_name)
    target_days = max(int(target_harvest_days), 1)
    expected_harvest_at = planted_local + timedelta(days=target_days)
    now_utc = datetime.now(timezone.utc)
    cycle_id = _build_cycle_id(planted_local)

    collection.insert_one(
        {
            "cycle_id": cycle_id,
            "name": (name or "").strip() or None,
            "status": "active",
            "planted_at": planted_local,
            "target_harvest_days": target_days,
            "expected_harvest_at": expected_harvest_at,
            "harvested_at": None,
            "actual_duration_days": None,
            "notes": (notes or "").strip() or None,
            "created_at": now_utc,
            "updated_at": now_utc,
        }
    )

    return collection.find_one({"cycle_id": cycle_id})


def harvest_active_cycle(
    collection,
    timezone_name: str,
    harvested_at: datetime | str | None = None,
    notes: str | None = None,
):
    ensure_grow_cycle_indexes(collection)

    active_cycle = get_active_cycle(collection, timezone_name=timezone_name)
    if active_cycle is None:
        raise ValueError("ยังไม่มีรอบปลูกที่ active อยู่")

    harvested_local = _coerce_datetime(harvested_at, timezone_name)
    planted_local = _coerce_datetime(active_cycle["planted_at"], timezone_name)
    actual_duration_days = max((harvested_local.date() - planted_local.date()).days + 1, 1)
    now_utc = datetime.now(timezone.utc)

    update_fields = {
        "status": "harvested",
        "harvested_at": harvested_local,
        "actual_duration_days": actual_duration_days,
        "updated_at": now_utc,
    }

    note_text = (notes or "").strip()
    if note_text:
        update_fields["notes"] = note_text

    collection.update_one(
        {"cycle_id": active_cycle["cycle_id"]},
        {"$set": update_fields},
    )
    return collection.find_one({"cycle_id": active_cycle["cycle_id"]})


def build_cycle_context(cycle_document, observed_at: datetime, timezone_name: str):
    if cycle_document is None:
        return {}

    observed_local = _coerce_datetime(observed_at, timezone_name)
    planted_local = _coerce_datetime(cycle_document["planted_at"], timezone_name)
    day_index = max((observed_local.date() - planted_local.date()).days + 1, 1)
    target_harvest_days = max(int(cycle_document.get("target_harvest_days") or 14), 1)
    expected_days_to_harvest = max(target_harvest_days - day_index, 0)

    return {
        "cycle_id": cycle_document["cycle_id"],
        "cycle_name": cycle_document.get("name"),
        "cycle_status": cycle_document.get("status"),
        "cycle_planted_at": cycle_document.get("planted_at"),
        "cycle_day_index": day_index,
        "target_harvest_days": target_harvest_days,
        "expected_harvest_at": cycle_document.get("expected_harvest_at"),
        "expected_days_to_harvest": expected_days_to_harvest,
    }
