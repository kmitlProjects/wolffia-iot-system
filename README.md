# Wolffia IoT System

IoT monitoring system for a Wolffia pond running on Raspberry Pi.

## Main Components

- `api/`: FastAPI service for dashboard, sensor APIs, and background logging
- `frontend/`: mobile-friendly TypeScript dashboard source and checked-in dist assets
- `mqtt/`: MQTT publisher/subscriber for sensor data flow
- `sensors/`: hardware integration for temperature, pH, and camera
- `test/`: quick hardware test scripts

## Hardware Used

- DS18B20 temperature sensor via 1-Wire
- pH sensor via MCP3008 over SPI (`Po -> CH0`)
- USB camera on `/dev/video0`
- Water pump, fertilizer relays, and light via GPIO relay outputs

## Quick Start

1. Create and activate a Python virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Copy environment variables:

```bash
cp .env.example .env
```

4. Update `.env` with your MongoDB and MQTT settings.
5. Start the stack:

```bash
./start.sh
```

6. Open `http://<raspberry-pi-ip>:8000`

## Web Dashboard

The dashboard is fully web-based and includes the live USB camera feed.

1. Copy `.env.example` to `.env`.
2. Set `CAMERA_DEVICE` if your USB camera is not `/dev/video0`.
3. Set `LIGHT_ACTIVE_LOW=true` if your relay board is low-trigger, or `false` if it is high-trigger.
4. Start the stack with `./start.sh`.
5. Open `http://<raspberry-pi-ip>:8000`.
6. The new mobile-first dashboard is served from the checked-in `frontend/dist` assets.
7. The live camera feed is served directly from `http://<raspberry-pi-ip>:8000/video`.
8. Light, water pump, and fertilizer pumps can be controlled from the dashboard.
9. If you have multiple fertilizer pumps, set `PUMP_FERTILIZER_PINS` in `.env`, for example `5,6,13`.
10. Each fertilizer pump can be controlled separately from the web dashboard.
11. Light and water pump support optional automation schedules from the web dashboard.
12. The frontend now reads a single `/dashboard-state` endpoint for most data to reduce request volume.

## Frontend Development

- Source files live in `frontend/src`.
- Runtime assets served by FastAPI live in `frontend/dist`.
- This repository checks in `frontend/dist` so the dashboard still works on devices without Node.js installed.
- If you later install Node.js, you can rebuild the frontend with:

```bash
cd frontend
npm install
npm run build
```

## Environment Variables

- `MONGO_URI`
- `MONGO_DB`
- `MONGO_COLLECTION`
- `MQTT_BROKER`
- `MQTT_PORT`
- `MQTT_TOPIC`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `CAMERA_DEVICE`
- `LIGHT_PIN`
- `LIGHT_ACTIVE_LOW`
- `PUMP_WATER_PIN`
- `PUMP_WATER_ACTIVE_LOW`
- `PUMP_FERTILIZER_PINS`
- `PUMP_FERTILIZER_ACTIVE_LOW`
- `AUTOMATION_COLLECTION`
- `AUTOMATION_POLL_SECONDS`
- `APP_TIMEZONE`
- `CORS_ALLOW_ORIGINS`

## Notes

- `mongod` and `mosquitto` should be available on the Raspberry Pi host.
- Sensor data is written to MongoDB through the MQTT publisher/subscriber flow.
- MQTT publisher/subscriber is also included for message-based ingestion.
- Enable SPI before using MCP3008: `sudo raspi-config nonint do_spi 0`
