# Project Context for Other Models

Generated from the codebase on 2026-04-04.

Purpose of this file:
- สรุปภาพรวมโปรเจกต์นี้ในรูปแบบที่เอาไปป้อน model อื่นต่อได้ทันที
- แยกให้ชัดว่าอะไรคือข้อเท็จจริงจาก repo และอะไรคือการตีความเจตนาของโปรเจกต์

Primary sources used:
- `README.md`
- `frontend/src/main.ts`
- `api/api.py`
- `mqtt/publisher.py`
- `mqtt/subscriber.py`
- `automation/scheduler.py`
- `automation/daily_capture.py`
- `grow_cycle.py`
- `ai/daily_summary.py`
- `ai/feature_builder.py`
- `ai/predictions.py`
- `start.sh`
- `HOWTO/COLAB_BASELINE_WORKFLOW.md`
- `git log`

## 1. One-paragraph summary

โปรเจกต์นี้คือระบบ `Wolffia IoT System` สำหรับรันบน Raspberry Pi เพื่อดูแลบ่อ Wolffia แบบกึ่งอัตโนมัติ โดยรวม 4 เรื่องไว้ในระบบเดียว: `monitoring`, `device control`, `data collection`, และ `ML readiness/prediction`. เว็บไซต์ในโปรเจกต์นี้ไม่ใช่เว็บประชาสัมพันธ์ แต่เป็น `single operational dashboard` สำหรับดูภาพสดจากกล้อง, ดูค่า temp/pH/green coverage, ควบคุมไฟและปั๊ม, ตั้ง schedule อัตโนมัติ, export/import ชุดข้อมูล, และกดทำนายวันเก็บเกี่ยวจาก baseline model ที่ฝึกมาจาก Colab.

## 2. Facts from the repository

### 2.1 Runtime shape

- ระบบนี้รันตรงบน Raspberry Pi ผ่าน `systemd` ไม่ได้ใช้ Docker
- FastAPI เป็นตัว serve ทั้ง API และ frontend assets
- frontend เป็น TypeScript แบบไม่ใช้ framework หนัก และมีการ check-in `frontend/dist` ไว้เพื่อให้ Pi ใช้งานได้โดยไม่ต้องมี Node.js
- ข้อมูลหลักถูกเก็บใน MongoDB
- sensor data flow ผ่าน MQTT

### 2.2 Main subsystems

- `frontend/`: dashboard สำหรับ operator
- `api/`: FastAPI backend, static serving, actuator endpoints, data endpoints, prediction endpoints
- `mqtt/`: publisher/subscriber สำหรับอ่าน sensor และบันทึกลง MongoDB
- `automation/`: scheduler สำหรับ light/water pump และ daily image capture
- `camera/`: live frame acquisition
- `ai/`: coverage analysis, daily summary, feature builder, dataset export/import, prediction runtime, training helpers
- `grow_cycle.py`: ผูกข้อมูลทุกอย่างเข้ากับรอบการปลูก

### 2.3 Website structure

หน้าเว็บหลักมี section สำคัญดังนี้:

1. `Hero / Summary`
- แสดงสถานะการเชื่อมต่อ
- แสดง timezone
- แสดงเวลาที่ dashboard state ถูก generate
- สื่อสารว่า dashboard นี้รวม camera, hourly MongoDB, และ prediction-ready flow

2. `Camera Snapshot`
- ดูภาพบ่อสดแบบ refresh เป็นช่วง
- pause camera ได้เพื่อลดภาระเครื่อง

3. `Live OpenCV Preview`
- ดูผลวิเคราะห์จากภาพสด ณ ตอนนั้น
- แสดง raw ROI, mask, overlay
- ใช้เพื่อ inspect คุณภาพการแยกพื้นที่สีเขียว

4. `Live Snapshot`
- ค่า temp, pH, green coverage ล่าสุด
- เวลา sensor timestamp ล่าสุด
- สถานะ light relay, water pump, fertilizer pumps, grow cycle
- ปุ่มเริ่มปลูก / สิ้นสุดการปลูก

5. `Capture & Model Data`
- สรุป daily summary และข้อมูลที่ระบบจะใช้ต่อใน feature builder
- ปุ่ม refresh
- ปุ่ม export dataset สำหรับ training
- เครื่องมือ import temp/pH ย้อนหลังผ่าน CSV template

6. `Coverage Time Series`
- กราฟย้อนหลังของ coverage, temperature, pH
- ใช้ดูแนวโน้มรายชั่วโมงจาก MongoDB

7. `Predict Harvest`
- เรียก baseline model ปัจจุบัน
- ทำนาย days to harvest และเวลาคาดว่าจะเก็บเกี่ยว

8. `Light Control`
- เปิด/ปิดไฟแบบ manual
- ตั้ง light schedule รายวัน

9. `Water Pump`
- สั่งปั๊มน้ำจากจำนวนลิตร
- ระบบคำนวณเวลาเปิดปั๊มจาก flow rate
- ตั้ง schedule ให้น้ำอัตโนมัติ

10. `Fertilizer Pumps`
- ควบคุมแยกเป็นรายหัวปั๊ม
- คำนวณระยะเวลาจากสูตรโดสและอัตราการไหล

### 2.4 Key backend contracts

- `GET /` เสิร์ฟ dashboard
- `GET /dashboard-state` เป็น endpoint หลักสำหรับสถานะรวมหน้าเว็บ
- `GET /sensor-history`
- `GET /daily-summary/history`
- `POST /image-analysis/analyze-now`
- `GET /camera/analysis-preview`
- `POST /grow-cycles/start`
- `POST /grow-cycles/harvest`
- `POST /predictions/harvest/preview`
- `POST /automation/light`
- `POST /automation/pump-water`
- `POST /actuators/light/on`
- `POST /actuators/light/off`
- `POST /actuators/pump-water/start`
- `POST /actuators/pump-fertilizer/{pump_id}/start`

### 2.5 Data flow

1. `mqtt/publisher.py`
- อ่าน temp และ pH จาก hardware
- เรียก local API เพื่อคำนวณ green coverage
- publish ข้อมูลเข้า MQTT topic

2. `mqtt/subscriber.py`
- subscribe MQTT
- รับ payload แล้วเติม grow cycle context
- บันทึกลง MongoDB collection `sensor_data`
- rebuild `daily_summary` ของวันนั้นทันที

3. `automation/daily_capture.py`
- ทำ daily image analysis ตามเวลา
- รองรับทั้ง `camera` mode และ `dataset` simulation mode
- อาจปิดไฟชั่วคราวก่อนถ่ายภาพเพื่อให้ภาพสม่ำเสมอขึ้น

4. `ai/feature_builder.py` + `ai/predictions.py`
- สร้าง feature bundle จาก sensor history + daily summary + image analysis + grow cycle
- map เข้ากับ feature columns ของโมเดล
- เรียก baseline model เพื่อทำนายวันเก็บเกี่ยว

## 3. Interpreted project rationale

ส่วนนี้เป็น `inference` จากโค้ด, README, HOWTO, และ commit history

### 3.1 โปรเจกต์นี้ทำไปทำไม

โปรเจกต์นี้น่าจะถูกสร้างขึ้นเพื่อแก้ปัญหา 3 ชั้นพร้อมกัน:

1. `Operational problem`
- การดูบ่อ Wolffia แบบ manual ทำให้ตรวจสถานะยาก
- การเปิดปิดไฟ/ปั๊ม/ปุ๋ยแบบไม่มี dashboard ทำให้ใช้งานลำบาก
- ต้องการหน้าเดียวที่เปิดจากมือถือหรือ browser แล้วสั่งงานได้

2. `Data problem`
- ถ้าจะทำ prediction หรือวิเคราะห์ growth ต้องมีข้อมูลที่ต่อเนื่องและผูกกับรอบปลูก
- จึงต้องมี grow cycle, hourly sensor history, daily summary, และ image-derived coverage ที่เป็นระบบ

3. `Demo / research / prototyping problem`
- ข้อมูลจริงยังไม่พอหลายรอบปลูก
- ทีมเลยสร้าง flow ที่ใช้ `synthetic/bootstrap dataset` เพื่อพิสูจน์ว่า end-to-end pipeline ใช้งานได้ก่อน
- เป้าหมายจึงไม่ใช่แค่ “ให้โมเดลแม่น” แต่คือ “พิสูจน์ว่าระบบเก็บข้อมูล -> สร้าง feature -> train model -> serve prediction” ทำได้ครบ

### 3.2 ทำไมต้องมีเว็บไซต์

เว็บไซต์มีเหตุผลเชิงระบบชัดเจน 4 ข้อ:

1. `เป็น operator console`
- ระบบนี้มี hardware จริงหลายตัว
- ถ้าไม่มีเว็บ การใช้งานจะต้องอาศัย script, shell, หรือ manual relay control
- เว็บจึงลด friction ของคนใช้งานหน้างาน

2. `เป็นจุดตรวจสอบคุณภาพข้อมูล`
- live camera preview และ OpenCV preview ทำให้ตรวจได้ว่าการจับ green coverage สมเหตุสมผลหรือไม่
- ถ้าไม่มีส่วนนี้ model pipeline จะขาด visibility และ debug ยากมาก

3. `เป็นสะพานระหว่าง IoT กับ ML`
- หน้าเดียวกันมีทั้ง live operation และ export/import data สำหรับ model
- แปลว่าระบบนี้ออกแบบมาให้ operator หรือผู้สาธิตเห็น data lifecycle ครบ

4. `เป็น demo surface ที่อธิบายโปรเจกต์ได้ในตัว`
- commit history และ HOWTO ชี้ว่าทีมให้ความสำคัญกับการ present ว่า flow ทำงานครบ
- dashboard จึงมีบทบาทเป็นทั้งเครื่องมือใช้งานจริงและสื่อสำหรับสาธิตระบบ

### 3.3 แล้ว “จำเป็น” ไหม

คำตอบที่ตรงที่สุดคือ `จำเป็นในเชิงใช้งานจริง แต่ไม่จำเป็นทุกส่วนในเชิงสถาปัตยกรรม`

แยกเป็น 3 ระดับ:

1. `จำเป็นมาก`
- dashboard state
- live sensor snapshot
- actuator control
- grow cycle management
- history/basic trend view

ถ้าไม่มีส่วนนี้ ระบบจะเหลือแค่ backend script ที่ใช้งานลำบากมาก

2. `สำคัญแต่ไม่ถึงกับต้องมีทุก deployment`
- automation schedule UI
- camera live preview
- OpenCV raw/mask/overlay preview

ส่วนนี้ช่วยเรื่อง usability และ debugging มาก แต่ถ้าจำกัด scope เหลือระบบ headless ก็ถอดได้

3. `ไม่จำเป็นสำหรับการเลี้ยงบ่อขั้นพื้นฐาน แต่จำเป็นสำหรับโจทย์ ML/demo`
- export training dataset
- import historical temp/pH CSV
- Predict Harvest
- Colab handoff flow

ถ้าโจทย์คือแค่ดูค่าเซนเซอร์และสั่งปั๊ม เว็บไซต์อาจไม่ต้องมีส่วน ML เหล่านี้เลย
แต่ถ้าโจทย์คือ “ทำระบบต้นแบบที่พร้อมต่อยอดเป็น prediction product” ส่วนนี้ถือว่าจำเป็น

## 4. Project evolution from git history

ลำดับพัฒนาของโปรเจกต์โดยสรุป:

1. เริ่มจาก import โปรเจกต์และการอ่าน sensor ขั้นพื้นฐาน
2. แก้ hardware integration เช่น pH sensor
3. เปลี่ยนเป็นระบบเว็บล้วนและแยกโมดูลควบคุมอุปกรณ์
4. เพิ่ม dashboard + automation + แยกคุมปั๊มปุ๋ย
5. เพิ่ม grow cycle + image analysis + readiness สำหรับ prediction
6. เพิ่ม live OpenCV preview และ ROI
7. ปรับปรุงความแม่นของ coverage
8. เพิ่ม clean export / dataset / seed historical observations
9. เพิ่ม Colab workflow และ synthetic dataset
10. เชื่อม baseline harvest model เข้าหน้าเว็บ
11. ปรับ UX ให้ใช้งานจริงง่ายขึ้น เช่น กรอกปริมาณเป็นลิตร และรวม schedule ไว้ใน card ควบคุม

ความหมายของ evolution นี้:
- โปรเจกต์ไม่ได้เริ่มจาก “เว็บ”
- โปรเจกต์เริ่มจาก “ระบบ IoT + sensor + actuator”
- แล้วค่อยขยายไปสู่ “เว็บ dashboard”
- จากนั้นค่อยขยายต่อไปสู่ “data/ML pipeline”

## 5. Current maturity assessment

โปรเจกต์นี้อยู่ในสถานะ `working prototype / demo-ready system`, ไม่ใช่ production agronomy platform

เหตุผล:
- model ปัจจุบันเป็น baseline ที่เทรนจาก synthetic/bootstrap data เป็นหลัก
- pH ยังไม่ถูกนำเสนอว่า calibrated ระดับวิทยาศาสตร์
- light และ fertilizer บาง feature ยังใช้ default config ไม่ได้วัดตรง
- แต่ end-to-end flow ทำงานจริงครบมาก: sensor -> storage -> summary -> export -> model -> prediction -> dashboard

## 6. If another model must reason about this repo

ให้ model อื่นตั้งต้นด้วย assumption นี้:

- นี่คือ `Raspberry Pi-operated IoT dashboard`, ไม่ใช่ marketing website
- frontend เป็น `single-page dashboard` แบบ TypeScript vanilla
- backend เป็น `FastAPI monolith` ที่รวม API, static serving, scheduler startup, และ model serving
- data persistence หลักอยู่ที่ MongoDB
- sensor ingestion ใช้ MQTT
- ระบบรองรับทั้ง `real mode` และ `simulation/bootstrap mode`
- ML ใน repo นี้มีเป้าหมายเชิง `workflow validation` มากกว่า `scientific decision support`

สิ่งที่ model อื่นไม่ควรเข้าใจผิด:

- live camera preview ไม่เท่ากับ historical image archive
- prediction มีอยู่จริง แต่ยังไม่ควรถูกอธิบายว่า validated production model
- เว็บไซต์นี้ไม่ได้เป็น optional skin บาง ๆ ด้านบน API อย่างเดียว แต่มันคือ UI หลักของ operator

## 7. Recommended framing for stakeholders

ถ้าต้องอธิบายโปรเจกต์นี้สั้น ๆ:

> ระบบนี้เป็น dashboard สำหรับบ่อ Wolffia ที่รวมการดูสถานะ, ควบคุมอุปกรณ์, เก็บข้อมูล, และเตรียมข้อมูลสำหรับโมเดลทำนายวันเก็บเกี่ยวไว้ในระบบเดียวบน Raspberry Pi

ถ้าต้องอธิบายว่าทำไมต้องทำ:

> เพราะการทำ prediction หรือ automation กับบ่อจริงจะเกิดขึ้นไม่ได้ ถ้าข้อมูลภาคสนามยังไม่ถูกเก็บอย่างมีโครงสร้างและ operator ยังไม่มีจุดควบคุมกลางที่ใช้งานง่าย

ถ้าต้องอธิบายว่าทำไมเว็บนี้ถึงมี:

> เว็บนี้ไม่ใช่ของเสริม แต่เป็น operational surface ที่ทำให้คนใช้งานมองเห็นบ่อ, ตรวจคุณภาพข้อมูล, คุมอุปกรณ์, และเชื่อมงาน IoT เข้ากับ workflow ของ ML ได้ในจุดเดียว

## 8. Model-ready JSON context

Copy the JSON below into another model if you want a structured handoff:

```json
{
  "project_name": "Wolffia IoT System",
  "project_type": "Raspberry Pi IoT monitoring and control dashboard with ML-ready data pipeline",
  "core_identity": "This is not a marketing website. It is an operator dashboard for a Wolffia pond.",
  "primary_goal": "Monitor pond conditions, control actuators, collect structured grow-cycle data, and support harvest prediction experiments.",
  "runtime_environment": {
    "host": "Raspberry Pi",
    "backend": "FastAPI",
    "frontend": "Vanilla TypeScript with checked-in dist assets",
    "database": "MongoDB",
    "messaging": "MQTT",
    "process_model": "systemd-managed local stack"
  },
  "main_modules": [
    "frontend dashboard",
    "FastAPI API and static serving",
    "MQTT publisher/subscriber",
    "camera capture",
    "automation scheduler",
    "daily image analysis",
    "grow cycle tracking",
    "feature building and prediction runtime"
  ],
  "website_sections": [
    "hero/status summary",
    "camera snapshot",
    "live OpenCV preview",
    "live sensor snapshot",
    "capture and model data hub",
    "coverage/temperature/pH time series",
    "predict harvest",
    "light control and schedule",
    "water pump control and schedule",
    "fertilizer pump controls"
  ],
  "data_flow": [
    "publisher reads temp and pH and requests green coverage from local API",
    "publisher publishes readings to MQTT",
    "subscriber consumes MQTT messages and writes sensor_data to MongoDB",
    "subscriber attaches grow-cycle context and rebuilds daily_summary",
    "daily image scheduler stores image-analysis metadata",
    "prediction runtime builds features from MongoDB and model files in data/train"
  ],
  "why_this_project_exists": [
    "To replace manual pond monitoring with a single operator console",
    "To create structured historical data tied to grow cycles",
    "To validate an end-to-end IoT-to-ML workflow even before enough real harvest cycles exist",
    "To support demos/presentations of a complete system, not just isolated scripts"
  ],
  "why_the_website_exists": [
    "To be the main operator UI",
    "To debug live vision coverage quality",
    "To bridge IoT operations with dataset export/import and prediction features",
    "To make the system demoable and usable from one place"
  ],
  "necessity_assessment": {
    "mandatory_for_real_operations": [
      "live state dashboard",
      "actuator controls",
      "grow cycle management",
      "basic history visibility"
    ],
    "important_but_optional": [
      "camera preview",
      "OpenCV debug preview",
      "schedule UI"
    ],
    "optional_for_basic_operations_but_needed_for_ml_scope": [
      "dataset export/import",
      "prediction UI",
      "Colab handoff workflow"
    ]
  },
  "current_maturity": "working prototype / demo-ready system",
  "limitations": [
    "harvest model is a baseline trained with synthetic/bootstrap data",
    "pH is not presented as scientifically calibrated",
    "some model inputs are config defaults rather than directly measured signals",
    "should not be described as a validated production agronomy model"
  ],
  "important_non_obvious_point": "The repo intentionally supports both real operational mode and simulation/bootstrap mode."
}
```

## 9. Copy-paste prompt for another model

Use this prompt directly:

```text
You are looking at a repository named "Wolffia IoT System".

Treat it as a Raspberry Pi IoT operator dashboard, not as a general website or marketing site.

Project purpose:
- Monitor a Wolffia pond with temp, pH, camera-derived green coverage, and actuator status.
- Control light, water pump, and fertilizer pumps.
- Track grow cycles.
- Export/import structured data for ML workflows.
- Run a baseline harvest prediction model from current system data.

Architecture assumptions:
- Frontend: vanilla TypeScript single-page dashboard.
- Backend: FastAPI monolith serving both API and frontend assets.
- Data store: MongoDB.
- Message bus: MQTT.
- Runtime: systemd on Raspberry Pi.
- The project supports both real mode and simulation/bootstrap mode.

Important caution:
- The current ML model is a baseline demo model and should not be treated as a validated production agronomy model.

When analyzing or changing this repo, optimize for:
1. operational usability of the dashboard,
2. correctness of the data flow,
3. clarity of grow-cycle-linked data,
4. compatibility with the existing IoT + ML workflow.
```
