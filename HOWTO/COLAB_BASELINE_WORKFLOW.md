# Colab Baseline Workflow

ใช้ไฟล์ชุดนี้เมื่อยังมีข้อมูลจริงน้อย และต้องการเดโมว่า flow ของระบบไปถึงขั้น train model ได้แล้ว

## ไฟล์ที่ใช้

- feature dataset สำหรับ baseline:
  - `data/exports/model_training/synthetic_harvest_feature_dataset_v1.csv`
- raw dataset สำหรับดูบริบท:
  - `data/exports/model_training/synthetic_harvest_training_dataset.csv`
- สคริปต์เทรน baseline:
  - `ai/train_harvest_model.py`

## เป้าหมายของโมเดล

โมเดลตัวแรกใช้ทำนาย `label_days_to_harvest`

ความหมายคือ:
- จากข้อมูลของวันปัจจุบัน เหลืออีกกี่วันจะเก็บเกี่ยว

## วิธีใช้บน Google Colab

### 1. อัปโหลดไฟล์

อัปโหลด 2 ไฟล์นี้ขึ้น Colab:

- `synthetic_harvest_feature_dataset_v1.csv`
- `train_harvest_model.py`

### 2. ติดตั้งไลบรารี

```python
!pip install pandas scikit-learn
```

### 3. รันสคริปต์เทรน

```python
!python train_harvest_model.py \
  --input-csv synthetic_harvest_feature_dataset_v1.csv \
  --output-dir model_artifacts
```

### 4. ไฟล์ผลลัพธ์ที่ได้

ในโฟลเดอร์ `model_artifacts` จะมี:

- `harvest_baseline_model.pkl`
- `harvest_baseline_metrics.json`
- `harvest_baseline_feature_columns.json`
- `harvest_baseline_test_predictions.csv`

## ถ้าจะอ่าน CSV ใน Colab เองก่อน

```python
import pandas as pd

df = pd.read_csv("synthetic_harvest_feature_dataset_v1.csv")
df.head()
df.shape
df["label_days_to_harvest"].describe()
```

## คอลัมน์สำคัญที่โมเดลใช้

- `day_index`
- `coverage_now`
- `coverage_avg`
- `coverage_max`
- `temp_avg`
- `ph_avg`
- `lag1_coverage`
- `delta_coverage`
- `roll3_coverage_mean`
- `light_lux`
- `fertilizer_mg_l`
- `ph_gap_from_optimal`
- `growth_score`

## ข้อควรอธิบายเวลา present

- ชุดข้อมูลนี้เป็น `synthetic / bootstrap dataset`
- ใช้ coverage curve จากภาพจริงเป็นแกน
- ใช้ช่วงค่าแวดล้อมอิงจากเอกสาร KU
- มีไว้เพื่อแสดงว่า `ระบบเก็บข้อมูล -> สร้าง feature -> train baseline model` ได้ครบ flow
- เมื่อมีหลายรอบปลูกจริงในอนาคต ให้แทน synthetic dataset ด้วยข้อมูลจริง

## ถ้าจะสร้าง synthetic dataset ใหม่จาก Raspberry Pi

```bash
venv/bin/python ai/generate_synthetic_training_dataset.py --cycles 300
```

จากนั้นค่อยอัปโหลดไฟล์ใหม่ขึ้น Colab แล้ว train ซ้ำอีกครั้ง
