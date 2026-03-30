# Wolffia IoT System

IoT monitoring system for a Wolffia pond running on Raspberry Pi.

## Main Components

- `api/`: FastAPI service for dashboard, sensor APIs, and background logging
- `dashboard/`: simple HTML dashboard
- `mqtt/`: MQTT publisher/subscriber for sensor data flow
- `sensors/`: hardware integration for temperature, pH, ultrasonic, camera, pumps, and light
- `test/`: quick hardware test scripts

## Hardware Used

- DS18B20 temperature sensor via 1-Wire
- pH sensor via ADS1115 over I2C
- Ultrasonic water level sensor via GPIO
- USB camera on `/dev/video0`
- Water pump, fertilizer pump, and light via GPIO/PWM

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

## Environment Variables

- `MONGO_URI`
- `MONGO_DB`
- `MONGO_COLLECTION`
- `MQTT_BROKER`
- `MQTT_PORT`
- `MQTT_TOPIC`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `CORS_ALLOW_ORIGINS`

## Notes

- `mongod` and `mosquitto` should be available on the Raspberry Pi host.
- The FastAPI app logs sensor data directly to MongoDB on startup.
- MQTT publisher/subscriber is also included for message-based ingestion.
