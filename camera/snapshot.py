from datetime import datetime
from pathlib import Path

from camera.camera import get_latest_frame_bytes
from config import IMAGE_OUTPUT_DIR, SNAPSHOT_TIMEOUT_SECONDS


def build_snapshot_path(captured_at: datetime, output_dir: Path) -> Path:
    filename = captured_at.strftime("%Y-%m-%d_%H-%M-%S.jpg")
    return output_dir / filename


def capture_snapshot(
    captured_at: datetime,
    output_dir: str = IMAGE_OUTPUT_DIR,
    timeout_seconds: int = SNAPSHOT_TIMEOUT_SECONDS,
):
    frame_bytes = get_latest_frame_bytes(timeout_seconds=timeout_seconds)
    if frame_bytes is None:
        raise RuntimeError("cannot capture snapshot from camera")

    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    snapshot_path = build_snapshot_path(captured_at, target_dir)
    snapshot_path.write_bytes(frame_bytes)

    return {
        "image_path": str(snapshot_path),
        "size_bytes": len(frame_bytes),
    }
