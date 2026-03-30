#!/bin/bash

source venv/bin/activate

python mqtt/subscriber.py &
PID1=$!

python mqtt/publisher.py &
PID2=$!

trap "kill $PID1 $PID2; exit" SIGINT SIGTERM
python -m uvicorn api.api:app --host 0.0.0.0 --port 8000
