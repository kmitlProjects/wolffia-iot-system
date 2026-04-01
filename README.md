# Wolffia IoT System

IoT monitoring system for a Wolffia pond running on Raspberry Pi.

## Main Components

- `api/`: FastAPI service for dashboard, sensor APIs, and background logging
- `ai/`: growth dataset tools, daily summaries, and prediction-ready feature builders
- `frontend/`: mobile-friendly TypeScript dashboard source and checked-in dist assets
- `mqtt/`: MQTT publisher/subscriber for sensor data flow
- `sensors/`: hardware integration for temperature, pH, and camera
- `test/`: quick hardware test scripts

## What You Should Know First

- The Raspberry Pi runs the whole stack directly with `systemd`, not Docker.
- `./start.sh`, `./stop.sh`, and `./restart.sh` are the main entry points for daily use.
- The dashboard is served by FastAPI from checked-in `frontend/dist` files, so Node.js is not required on the Pi.
- Camera preview and OpenCV preview are separated from the hourly time-series pipeline:
  - the web preview is for live inspection only
  - the stored training data is numeric coverage, not a historical image archive
- `Predict Harvest` now uses a real baseline model file from `data/train`, not just a placeholder.
- The current model is a demo baseline trained from synthetic/bootstrap data, so it proves the ML flow but is not yet a production agronomy model.

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
7. Stop or restart the stack when needed:

```bash
./stop.sh
./restart.sh
```

When `./start.sh` runs, it also prints the current usable URLs such as:

- `http://127.0.0.1:8000`
- `http://raspberrypi5.local:8000`
- `http://<current-pi-ip>:8000`

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
13. The main dashboard can show the latest raw preview, green mask, and overlay without storing a historical image archive on disk.

Current dashboard flow:

- `Camera Snapshot`: live snapshot refresh from the USB camera
- `Live OpenCV Preview`: raw / binary mask / green overlay for visual inspection
- `Capture & Model Data`: summary of the data that will be used for training/export
- `Coverage Time Series`: hourly MongoDB history
- `Predict Harvest`: runs the baseline model currently stored in `data/train`

## Prediction Readiness

- `sensor_data` stores raw time-series points with `timestamp`, `temp`, `ph`, and `green_coverage_percent`.
- `daily_image_analysis` stores analysis metadata per day without requiring a historical image archive.
- `daily_summary` aggregates each local day into model-friendly features such as `temp_avg`, `ph_avg`, `green_coverage_avg`, and cycle context.
- `grow_cycles` stores planting/harvest boundaries so labels and future predictions stay attached to the correct cycle.
- `prediction_runs` stores preview and inference runs so the backend contract is ready before later model upgrades.
- In camera mode, image analysis can temporarily force the grow light off before capture so the training data stays consistent.

For simulation mode, the analysis source can be switched to the ordered files in `test/test_image`.
This lets the system produce hourly coverage values from the dataset images while keeping the live camera stream separate.

Prediction endpoints:

- `POST /predictions/harvest/preview`
- `POST /predictions/harvest/stub`
- `GET /predictions/latest`
- `GET /predictions/history`

## Current ML Status

- The current harvest prediction is a baseline model exported from Google Colab.
- Model files currently used by the backend live in `data/train/`:
  - `harvest_baseline_model_v2.joblib`
  - `harvest_baseline_metrics_v2.json`
  - `harvest_baseline_predictions_v2.csv`
- The backend loads the model and maps current system data into the same feature shape that was used during training.
- The `Predict Harvest` button on the dashboard calls the backend and returns:
  - predicted days to harvest
  - predicted harvest datetime
  - confidence score
  - uncertainty in days

Important limitations:

- The current pH sensor values are still not calibrated for scientific use.
- The current model was trained from synthetic/bootstrap data, not from multiple real grow cycles.
- Some model inputs such as `light_lux` and `fertilizer_mg_l` are currently defaulted in config because they are not yet measured directly by the system.
- Because of the above, the current model should be presented as a working ML flow / baseline demo, not as a validated decision model.

## Data And Colab Workflow

The repository already contains exported datasets for both demo and future training work:

- raw training exports:
  - `data/exports/model_training/harvest_training_dataset.csv`
  - `data/exports/model_training/seed_cycle_training_dataset.csv`
- feature datasets:
  - `data/exports/model_training/harvest_feature_dataset_v1.csv`
  - `data/exports/model_training/synthetic_harvest_feature_dataset_v1.csv`
- synthetic bootstrap datasets:
  - `data/exports/model_training/synthetic_harvest_training_dataset.csv`
  - `data/exports/model_training/synthetic_harvest_feature_dataset_v1.csv`
- CSV template for backfilling temp/pH onto seeded historical images:
  - `data/exports/model_training/image_seed_readings_template.csv`

Helpful scripts:

- `ai/export_training_dataset.py`: export raw per-day grow-cycle rows from MongoDB
- `ai/build_feature_training_dataset.py`: build feature rows from raw training exports
- `ai/generate_synthetic_training_dataset.py`: generate synthetic/bootstrap training data using the real image-derived coverage curve as the base
- `ai/train_harvest_model.py`: train a baseline model from the feature dataset
- `ai/import_seed_readings_to_mongo.py`: import temp/pH CSV values back into MongoDB

Colab handoff:

- The recommended quick-start guide is in `HOWTO/COLAB_BASELINE_WORKFLOW.md`
- This is the intended demo flow:
  - export or use the provided synthetic feature dataset
  - upload to Colab
  - train a baseline model
  - download `.joblib`, metrics, and prediction sample
  - place the model files in `data/train`
  - let the Pi backend serve predictions through the dashboard

## Real Data Vs Demo Data

At this stage the project intentionally supports both modes:

- real operational mode:
  - reads temp / pH / camera-derived coverage
  - stores hourly time-series points into MongoDB
  - uses grow cycles and daily summaries
- demo / bootstrap mode:
  - uses `test/test_image` as a simulated image sequence
  - generates synthetic training rows for Colab and baseline ML
  - is useful when there are not enough harvested real cycles yet

This split is important for presentation:

- the system flow is complete end-to-end
- the model is real and runnable
- but the training data is still partially synthetic until more real grow cycles are collected

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

## systemd Service

You can manage the whole stack as one systemd unit because FastAPI already serves the frontend assets.

Install and enable the service:

```bash
cd /home/pi/Project
./install_systemd_service.sh
```

After that, you can keep using the same helper scripts:

```bash
./start.sh
./stop.sh
./restart.sh
```

Useful commands after installation:

```bash
sudo systemctl start wolffia-stack
sudo systemctl stop wolffia-stack
sudo systemctl restart wolffia-stack
systemctl status wolffia-stack
journalctl -u wolffia-stack -f
```

Remove the service:

```bash
cd /home/pi/Project
./uninstall_systemd_service.sh
```

## Environment Variables

- `MONGO_URI`
- `MONGO_DB`
- `MONGO_COLLECTION`
- `IMAGE_ANALYSIS_COLLECTION`
- `DAILY_SUMMARY_COLLECTION`
- `GROW_CYCLE_COLLECTION`
- `PREDICTION_COLLECTION`
- `TRAINED_MODEL_DIR`
- `MQTT_BROKER`
- `MQTT_PORT`
- `MQTT_TOPIC`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `SENSOR_INTERVAL_SECONDS`
- `LOCAL_API_BASE_URL`
- `IMAGE_ANALYSIS_REQUEST_TIMEOUT_SECONDS`
- `CAMERA_DEVICE`
- `IMAGE_OUTPUT_DIR`
- `IMAGE_ANALYSIS_SOURCE_MODE`
- `IMAGE_ANALYSIS_SIMULATION_DIR`
- `IMAGE_ANALYSIS_ARCHIVE_ENABLED`
- `IMAGE_ANALYSIS_FORCE_LIGHT_OFF`
- `IMAGE_ANALYSIS_LIGHT_SETTLE_SECONDS`
- `SNAPSHOT_TIME`
- `SNAPSHOT_POLL_SECONDS`
- `SNAPSHOT_TIMEOUT_SECONDS`
- `COVERAGE_H_MIN`
- `COVERAGE_H_MAX`
- `COVERAGE_S_MIN`
- `COVERAGE_V_MIN`
- `COVERAGE_ROI_X`
- `COVERAGE_ROI_Y`
- `COVERAGE_ROI_WIDTH`
- `COVERAGE_ROI_HEIGHT`
- `COVERAGE_ROI_CORNER_RADIUS`
- `COVERAGE_ROI_REFERENCE_WIDTH`
- `COVERAGE_ROI_REFERENCE_HEIGHT`
- `LIGHT_PIN`
- `LIGHT_ACTIVE_LOW`
- `PUMP_WATER_PIN`
- `PUMP_WATER_ACTIVE_LOW`
- `PUMP_FERTILIZER_PINS`
- `PUMP_FERTILIZER_ACTIVE_LOW`
- `AUTOMATION_COLLECTION`
- `AUTOMATION_POLL_SECONDS`
- `APP_TIMEZONE`
- `DEFAULT_GROW_CYCLE_DAYS`
- `PREDICTION_LOOKBACK_DAYS`
- `PREDICTION_SENSOR_LIMIT`
- `HARVEST_MODEL_ENABLED`
- `HARVEST_MODEL_PATH`
- `HARVEST_MODEL_METRICS_PATH`
- `HARVEST_MODEL_DEFAULT_LIGHT_LUX`
- `HARVEST_MODEL_DEFAULT_FERTILIZER_MG_L`
- `HARVEST_MODEL_PH_OPTIMAL`
- `CORS_ALLOW_ORIGINS`

## Notes

- `mongod` and `mosquitto` should be available on the Raspberry Pi host.
- Sensor data is written to MongoDB through the MQTT publisher/subscriber flow.
- MQTT publisher/subscriber is also included for message-based ingestion.
- Enable SPI before using MCP3008: `sudo raspi-config nonint do_spi 0`
- The checked-in baseline model currently expects `scikit-learn==1.6.1`.
