import {
    createLightSchedule,
    createPumpWaterSchedule,
    deleteAutomationRule,
    downloadModelDataTemplate,
    exportTrainingDataset,
    fetchDailySummaryHistory,
    fetchDashboardState,
    fetchLiveCameraAnalysis,
    fetchSensorHistory,
    harvestGrowCycle,
    importModelDataTemplate,
    previewHarvestPrediction,
    setAutomationRuleEnabled,
    startFertilizerPump,
    startGrowCycle,
    startWaterPump,
    stopFertilizerPump,
    stopWaterPump,
    turnLight,
} from "./api.js?v=20260401aa"
import type {
    DailySummary,
    DashboardState,
    FertilizerPumpStatus,
    HarvestPredictionPreviewResponse,
    ImageAnalysis,
    ImageAnalysisDebug,
    LightRule,
    LiveCameraAnalysis,
    PumpWaterRule,
    SensorReading,
} from "./types.js"

const DAY_OPTIONS = [
    ["mon", "Mon"],
    ["tue", "Tue"],
    ["wed", "Wed"],
    ["thu", "Thu"],
    ["fri", "Fri"],
    ["sat", "Sat"],
    ["sun", "Sun"],
] as const

const POLL_VISIBLE_MS = 30000
const POLL_HIDDEN_MS = 30000
const CAMERA_REFRESH_MS = 2500
const CAMERA_RETRY_MS = 3000
const LIVE_ANALYSIS_REFRESH_MS = 8000
const LIVE_ANALYSIS_RETRY_MS = 10000
const DEFAULT_WATER_PUMP_LITERS = "1"
const DEFAULT_FERTILIZER_WATER_LITERS = "10"

let dashboardState: DashboardState | null = null
let sensorHistory: SensorReading[] = []
let dailySummaryHistory: DailySummary[] = []
let pollTimer: number | undefined
let messageTimer: number | undefined
let cameraRetryTimer: number | undefined
let liveAnalysisTimer: number | undefined
let cameraWanted = true
let cameraLoaded = false
let cameraStreamNonce = 0
let cycleActionPending = false
let analysisRefreshPending = false
let datasetExportPending = false
let datasetImportPending = false
let templateDownloadPending = false
let predictionPreviewPending = false
let predictionPreview: HarvestPredictionPreviewResponse | null = null
let liveCameraAnalysisPending = false
let liveCameraAnalysis: LiveCameraAnalysis | null = null

function $(id: string): HTMLElement {
    const element = document.getElementById(id)
    if (!element) {
        throw new Error(`Missing element: ${id}`)
    }
    return element
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

function createLayout(): string {
    return `
        <div class="app-shell">
            <header class="hero">
                <div class="hero-header">
                    <div class="hero-copy">
                        <span class="eyebrow">Wolffia Dashboard</span>
                        <h1>ภาพสด ควบคุมอุปกรณ์ และข้อมูลพร้อมทำโมเดล</h1>
                        <p>
                            เรียงข้อมูลตามลำดับการใช้งานจริง:
                            ดูบ่อ, เช็กค่าล่าสุด, ย้อนดู time series และเตรียมส่งเข้าโมเดล
                        </p>
                    </div>
                    <div class="hero-summary-grid">
                        <article class="hero-stat-card">
                            <span class="card-label">ระบบ</span>
                            <div class="hero-stat-inline">
                                <span id="connection-badge" class="status-badge">กำลังเชื่อมต่อ</span>
                                <span id="timezone-chip" class="mini-chip">-</span>
                            </div>
                            <span class="helper-text">สถานะเชื่อมต่อและ timezone ที่ระบบใช้จริง</span>
                        </article>
                        <article class="hero-stat-card">
                            <span class="card-label">อัปเดตล่าสุด</span>
                            <strong id="generated-at">-</strong>
                            <span class="helper-text">เวลาที่ state ล่าสุดถูกสร้าง</span>
                        </article>
                        <article class="hero-stat-card">
                            <span class="card-label">โฟลว์ข้อมูล</span>
                            <div class="hero-feature-list">
                                <span class="mini-chip">Camera + ROI</span>
                                <span class="mini-chip">Hourly MongoDB</span>
                                <span class="mini-chip">Prediction-ready</span>
                            </div>
                            <span class="helper-text">หน้าเดียวสำหรับดูบ่อ คุมอุปกรณ์ และตรวจข้อมูลก่อนทำโมเดล</span>
                        </article>
                    </div>
                </div>
            </header>

            <main class="dashboard-grid">
                <section class="panel camera-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2>Camera Snapshot</h2>
                                <p>รีเฟรชภาพเป็นช่วง ๆ เพื่อดูบ่อสดโดยไม่เพิ่มภาระเครื่องเกินจำเป็น</p>
                            </div>
                            <button id="camera-toggle" class="button-ghost" type="button">
                                Pause Camera
                            </button>
                        </div>
                        <div class="camera-shell">
                            <img
                                id="camera-stream"
                                class="camera-stream"
                                alt="Live pond camera stream"
                            >
                            <div id="camera-roi-box" class="camera-roi-box hidden" aria-hidden="true"></div>
                            <div id="camera-overlay" class="camera-overlay hidden">
                                <p id="camera-overlay-copy">
                                    Camera paused to reduce CPU load.
                                </p>
                            </div>
                        </div>
                        <div class="camera-analysis-block">
                            <div class="panel-title">
                                <h3>Live OpenCV Preview</h3>
                                <p>ประมวลผลจากภาพสดที่แสดงอยู่ตอนนี้โดยไม่บันทึกภาพลง storage ใช้สำหรับดูผลการแยกพื้นที่สีเขียว ณ ตอนนั้น</p>
                            </div>
                            <div id="live-analysis-meta" class="history-metrics"></div>
                            <div id="live-analysis-strip" class="image-strip"></div>
                        </div>
                    </div>
                </section>

                <section class="panel status-panel">
                    <div class="panel-inner">
                        <div class="panel-title">
                            <h2>Live Snapshot</h2>
                            <p>ค่าล่าสุดจาก sensor และสถานะอุปกรณ์ที่ใช้อยู่ตอนนี้</p>
                        </div>
                        <div class="metric-grid">
                            <article class="metric-card">
                                <span class="metric-label">Temperature</span>
                                <strong id="sensor-temp">-</strong>
                                <span class="helper-text">องศาเซลเซียส</span>
                            </article>
                            <article class="metric-card">
                                <span class="metric-label">pH</span>
                                <strong id="sensor-ph">-</strong>
                                <span class="helper-text">ค่าความเป็นกรดด่าง</span>
                            </article>
                            <article class="metric-card">
                                <span class="metric-label">Green Coverage</span>
                                <strong id="sensor-coverage">-</strong>
                                <span class="helper-text">เปอร์เซ็นต์พื้นที่สีเขียวจาก OpenCV</span>
                            </article>
                            <article class="metric-card">
                                <span class="metric-label">Sensor Timestamp</span>
                                <strong id="sensor-timestamp">-</strong>
                                <span class="helper-text">เวลาที่ข้อมูลล่าสุดถูกบันทึก</span>
                            </article>
                        </div>
                        <div class="summary-grid">
                            <article class="summary-card">
                                <span class="card-label">Light Relay</span>
                                <strong id="light-status-chip">-</strong>
                                <span id="light-mode-copy" class="helper-text">-</span>
                            </article>
                            <article class="summary-card">
                                <span class="card-label">Water Pump</span>
                                <strong id="pump-water-status-chip">-</strong>
                                <span id="pump-water-copy" class="helper-text">-</span>
                            </article>
                            <article class="summary-card">
                                <span class="card-label">Fertilizer Pumps</span>
                                <strong id="fertilizer-summary">-</strong>
                                <span class="helper-text">ควบคุมแยกเป็นรายหัวปั๊ม</span>
                            </article>
                            <article class="summary-card">
                                <span class="card-label">Grow Cycle</span>
                                <strong id="grow-cycle-status-chip">-</strong>
                                <span id="grow-cycle-copy" class="helper-text">-</span>
                            </article>
                        </div>
                        <div class="actions">
                            <button id="cycle-start-button" class="button-primary" type="button">
                                เริ่มปลูก
                            </button>
                            <button id="cycle-harvest-button" class="button-danger" type="button">
                                สิ้นสุดการปลูก
                            </button>
                        </div>
                    </div>
                </section>

                <section class="analytics-grid">
                    <section class="panel analysis-hub-panel">
                        <div class="panel-inner">
                            <div class="panel-header">
                                <div class="panel-title">
                                    <h2>Capture &amp; Model Data</h2>
                                    <p>สรุปข้อมูลที่ระบบเก็บจริงและจะถูกใช้ต่อใน feature builder สำหรับโมเดล</p>
                                </div>
                                <div class="panel-actions">
                                    <button id="analysis-refresh-button" class="button-ghost" type="button">
                                        Refresh Hub
                                    </button>
                                    <button id="download-template-button" class="button-secondary" type="button">
                                        Download Template
                                    </button>
                                    <button id="export-dataset-button" class="button-primary" type="button">
                                        Export Dataset
                                    </button>
                                </div>
                            </div>
                            <div id="analysis-preview-meta" class="history-metrics"></div>
                            <div id="daily-summary-highlights" class="daily-highlight-grid"></div>
                            <div id="analysis-process-grid" class="analysis-process-grid"></div>
                            <div id="analysis-footer-note" class="analysis-note"></div>
                            <div class="model-data-tools">
                                <label for="seed-cycle-id-input">
                                    Seed Cycle ID
                                    <input
                                        id="seed-cycle-id-input"
                                        type="text"
                                        placeholder="seed_cycle_..."
                                    >
                                </label>
                                <label for="seed-readings-file-input">
                                    Upload temp/pH CSV
                                    <input
                                        id="seed-readings-file-input"
                                        type="file"
                                        accept=".csv,text/csv"
                                    >
                                </label>
                                <button id="upload-template-button" class="button-secondary" type="button">
                                    Upload CSV
                                </button>
                            </div>
                            <div id="model-data-upload-copy" class="helper-text">
                                ดาวน์โหลด template -> กรอก temp/pH -> อัปโหลดกลับเข้า Mongo สำหรับ seed cycle
                            </div>
                        </div>
                    </section>

                    <section class="panel timeseries-panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2>Coverage Time Series</h2>
                                <p>แนวโน้มย้อนหลังจากข้อมูลรายชั่วโมงของ coverage, อุณหภูมิ และ pH</p>
                            </div>
                            <div class="chart-grid">
                                <article class="chart-card">
                                    <div class="chart-head">
                                        <strong>Green Coverage</strong>
                                        <span id="coverage-chart-meta" class="helper-text">-</span>
                                    </div>
                                    <div id="coverage-chart" class="chart-shell"></div>
                                </article>
                                <article class="chart-card">
                                    <div class="chart-head">
                                        <strong>Temperature</strong>
                                        <span id="temp-chart-meta" class="helper-text">-</span>
                                    </div>
                                    <div id="temp-chart" class="chart-shell"></div>
                                </article>
                                <article class="chart-card">
                                    <div class="chart-head">
                                        <strong>pH</strong>
                                        <span id="ph-chart-meta" class="helper-text">-</span>
                                    </div>
                                    <div id="ph-chart" class="chart-shell"></div>
                                </article>
                            </div>
                        </div>
                    </section>

                    <section class="panel prediction-panel">
                        <div class="panel-inner">
                            <div class="panel-header">
                                <div class="panel-title">
                                    <h2>Predict Harvest</h2>
                                    <p>ใช้โมเดล baseline จาก Colab เพื่อทำนายวันเก็บเกี่ยวจาก coverage, temp และ pH ปัจจุบัน</p>
                                </div>
                                <button id="prediction-preview-button" class="button-primary" type="button">
                                    Predict Harvest
                                </button>
                            </div>
                            <div id="prediction-preview-summary" class="daily-highlight-grid"></div>
                            <div id="prediction-preview-copy" class="rule-card rule-empty">
                                ยังไม่มี prediction preview
                                กด Predict Harvest เพื่อให้ backend โหลดโมเดลจริงและคำนวณวันเก็บเกี่ยวจากข้อมูลปัจจุบัน
                            </div>
                        </div>
                    </section>
                </section>

                <section class="control-grid">
                    <section class="panel light-control-panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3>Light Control</h3>
                                <p>สั่งไฟแบบ manual หรือวางรอบเปิดปิดอัตโนมัติจาก card เดียวกัน</p>
                            </div>
                            <div class="actions">
                                <button id="light-on-button" class="button-primary" type="button">
                                    Turn On
                                </button>
                                <button id="light-off-button" class="button-secondary" type="button">
                                    Turn Off
                                </button>
                            </div>
                            <div class="control-divider"></div>
                            <section class="schedule-builder">
                                <div class="schedule-builder-head">
                                    <div>
                                        <span class="card-label">Light Schedule</span>
                                        <strong>ตั้งเวลาเปิดปิดอัตโนมัติ</strong>
                                    </div>
                                    <span class="helper-text">เลือกวันและช่วงเวลาให้ไฟทำงานอัตโนมัติ</span>
                                </div>
                                <form id="light-schedule-form" class="stack">
                                    <div class="inline-fields">
                                        <label for="light-on-time">
                                            On time
                                            <input id="light-on-time" type="time" value="18:00">
                                        </label>
                                        <label for="light-off-time">
                                            Off time
                                            <input id="light-off-time" type="time" value="22:00">
                                        </label>
                                    </div>
                                    <div id="light-days" class="day-grid"></div>
                                    <button class="button-primary" type="submit">
                                        Add Light Schedule
                                    </button>
                                </form>
                            </section>
                            <div id="light-rule-list" class="schedule-rule-grid"></div>
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3>Water Pump</h3>
                                <p>กรอกลิตรน้ำที่ต้องการ แล้วระบบจะคำนวณเวลาเปิดปั๊มจากอัตราไหลให้อัตโนมัติ</p>
                            </div>
                            <div class="inline-fields">
                                <label for="manual-water-liters">
                                    ปริมาณน้ำ (L)
                                    <input id="manual-water-liters" min="0.1" step="0.1" type="number" value="1">
                                </label>
                            </div>
                            <div id="water-pump-helper-copy" class="helper-text">
                                อัตราไหลปั๊มน้ำ 1 L/min
                            </div>
                            <div class="actions">
                                <button id="water-start-button" class="button-primary" type="button">
                                    Start Pump
                                </button>
                                <button id="water-stop-button" class="button-danger" type="button">
                                    Stop Pump
                                </button>
                            </div>
                            <div class="control-divider"></div>
                            <section class="schedule-builder">
                                <div class="schedule-builder-head">
                                    <div>
                                        <span class="card-label">Water Pump Schedule</span>
                                        <strong>ตั้งรอบให้น้ำอัตโนมัติ</strong>
                                    </div>
                                    <span class="helper-text">กำหนดเวลา วัน และจำนวนลิตรที่ต้องการในแต่ละรอบ</span>
                                </div>
                                <form id="pump-water-schedule-form" class="stack">
                                    <div class="inline-fields">
                                        <label for="pump-water-start-time">
                                            Start time
                                            <input id="pump-water-start-time" type="time" value="08:00">
                                        </label>
                                        <label for="pump-water-schedule-liters">
                                            ปริมาณน้ำ (L)
                                            <input
                                                id="pump-water-schedule-liters"
                                                min="0.1"
                                                step="0.1"
                                                type="number"
                                                value="1"
                                            >
                                        </label>
                                    </div>
                                    <div id="pump-water-days" class="day-grid"></div>
                                    <button class="button-primary" type="submit">
                                        Add Water Pump Schedule
                                    </button>
                                </form>
                            </section>
                            <div id="pump-water-rule-list" class="schedule-rule-grid"></div>
                        </div>
                    </section>
                </section>

                <section class="panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2>Fertilizer Pumps</h2>
                                <p>กรอกปริมาณน้ำต่อหัวปั๊ม แล้วระบบจะคำนวณเวลาเปิดปั๊มให้อัตโนมัติ</p>
                            </div>
                        </div>
                        <div id="pump-fertilizer-list" class="fertilizer-grid"></div>
                    </div>
                </section>

            </main>

            <div class="message-bar">
                <div id="message-card" class="message-card">
                    <span id="message-copy">Ready</span>
                </div>
            </div>
        </div>
    `
}

function formatNumber(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-"
    }
    return Number(value).toFixed(digits)
}

function formatTimestamp(value: string | null | undefined): string {
    if (!value) {
        return "No data yet"
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(parsed)
}

function formatTimeOnly(value: string | null | undefined): string {
    if (!value) {
        return "-"
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(parsed)
}

function formatDateLabel(value: string | null | undefined): string {
    if (!value) {
        return "-"
    }

    const parsed = value.includes("T")
        ? new Date(value)
        : new Date(`${value}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat("th-TH", {
        month: "short",
        day: "numeric",
    }).format(parsed)
}

function slugToFriendlyLabel(value: string | null | undefined): string {
    if (!value) {
        return "-"
    }

    return value
        .split(/[_-]+/)
        .filter(Boolean)
        .map((part) => {
            const upper = part.toUpperCase()
            if (["LAB", "HSV", "ROI", "EXG", "CLAHE"].includes(upper)) {
                return upper
            }
            if (/^V\d+$/i.test(part)) {
                return part.toUpperCase()
            }
            if (upper === "GAUSSIAN") {
                return "Gaussian"
            }
            if (upper === "BLUR") {
                return "Blur"
            }
            if (upper === "OTSU") {
                return "Otsu"
            }
            return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
        })
        .join(" ")
}

function formatCoverageMethod(value: string | null | undefined): string {
    if (!value) {
        return "-"
    }

    const normalized = value.toLowerCase()
    if (normalized === "lab_clahe_exg_otsu_v3") {
        return "OpenCV v3"
    }
    if (normalized === "lab_clahe_hsv_exg_v2") {
        return "OpenCV v2"
    }
    return slugToFriendlyLabel(value)
}

function formatCoverageProcess(
    thresholds:
        | LiveCameraAnalysis["coverage_thresholds"]
        | ImageAnalysis["coverage_thresholds"]
        | null
        | undefined,
): string {
    if (!thresholds) {
        return "-"
    }

    const parts: string[] = []
    if (thresholds.preprocess) {
        parts.push(slugToFriendlyLabel(thresholds.preprocess))
    }
    if (thresholds.exg_threshold) {
        parts.push(`ExG ${slugToFriendlyLabel(String(thresholds.exg_threshold))}`)
    }
    if (thresholds.h_min !== null && thresholds.h_min !== undefined) {
        const upper = thresholds.h_max !== null && thresholds.h_max !== undefined
            ? formatNumber(thresholds.h_max, 0)
            : "-"
        parts.push(`H ${formatNumber(thresholds.h_min, 0)}-${upper}`)
    }

    return parts.join(" • ") || "-"
}

function formatSourceMode(value: string | null | undefined): string {
    if (!value) {
        return "-"
    }

    switch (value) {
        case "camera":
            return "Camera Live"
        case "dataset":
            return "Dataset Simulation"
        default:
            return slugToFriendlyLabel(value)
    }
}

function formatRoiSize(
    roi:
        | LiveCameraAnalysis["coverage_roi"]
        | ImageAnalysis["coverage_roi"]
        | null
        | undefined,
): string {
    if (!roi?.width || !roi?.height) {
        return "-"
    }

    return `${formatNumber(roi.width, 0)} × ${formatNumber(roi.height, 0)} px`
}

function countCoveragePoints(items: SensorReading[]): number {
    return items.filter((item) => item.green_coverage_percent !== null && item.green_coverage_percent !== undefined).length
}

function countTaggedCoveragePoints(items: SensorReading[]): number {
    return items.filter((item) => item.coverage_method || item.coverage_version).length
}

function getLatestCoverageRecord(items: SensorReading[]): SensorReading | null {
    const reversed = [...items].reverse()
    return reversed.find(
        (item) =>
            item.green_coverage_percent !== null && item.green_coverage_percent !== undefined,
    ) ?? dashboardState?.sensor ?? null
}

function getCycleProgress(cycle: DashboardState["grow_cycle"], referenceAt: string): {
    dayIndex: number
    remainingDays: number
} | null {
    if (!cycle?.planted_at) {
        return null
    }

    const plantedAt = new Date(cycle.planted_at)
    const referenceTime = new Date(referenceAt)
    if (Number.isNaN(plantedAt.getTime()) || Number.isNaN(referenceTime.getTime())) {
        return null
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000
    const diffDays = Math.floor(
        (referenceTime.getTime() - plantedAt.getTime()) / millisecondsPerDay,
    )
    const dayIndex = Math.max(diffDays + 1, 1)
    const targetDays = Number(cycle.target_harvest_days ?? 0)
    const remainingDays = targetDays > 0
        ? Math.max(targetDays - dayIndex, 0)
        : 0

    return { dayIndex, remainingDays }
}

function getActiveCycleProgress(): {
    cycle: DashboardState["grow_cycle"]
    progress: ReturnType<typeof getCycleProgress>
} {
    const cycle = dashboardState?.grow_cycle ?? null
    if (!cycle || cycle.status !== "active") {
        return {
            cycle: null,
            progress: null,
        }
    }

    return {
        cycle,
        progress: getCycleProgress(cycle, dashboardState?.meta.generated_at ?? new Date().toISOString()),
    }
}

function setCycleActionState(
    cycle: DashboardState["grow_cycle"],
    cycleProgress: ReturnType<typeof getCycleProgress>,
): void {
    const startButton = $("cycle-start-button") as HTMLButtonElement
    const harvestButton = $("cycle-harvest-button") as HTMLButtonElement
    const hasActiveCycle = Boolean(cycle && cycle.status === "active")

    startButton.disabled = cycleActionPending || hasActiveCycle
    harvestButton.disabled = cycleActionPending || !hasActiveCycle

    if (cycleActionPending) {
        startButton.textContent = "กำลังบันทึก..."
        harvestButton.textContent = "กำลังบันทึก..."
        return
    }

    startButton.textContent = hasActiveCycle ? "มีรอบปลูกอยู่แล้ว" : "เริ่มปลูก"

    if (!hasActiveCycle) {
        harvestButton.textContent = "ยังไม่มีรอบปลูก"
        return
    }

    if (cycleProgress && cycleProgress.remainingDays > 0) {
        harvestButton.textContent = `เก็บเกี่ยวก่อนกำหนด (${cycleProgress.remainingDays} วัน)`
        return
    }

    harvestButton.textContent = "สิ้นสุดการปลูก"
}

function buildHarvestConfirmationMessage(
    cycle: DashboardState["grow_cycle"],
    cycleProgress: ReturnType<typeof getCycleProgress>,
): string {
    const cycleLabel = cycle?.name || cycle?.cycle_id || "รอบปลูกนี้"
    const targetDays = Number(cycle?.target_harvest_days ?? 14)

    if (cycleProgress && cycleProgress.remainingDays > 0) {
        return [
            `${cycleLabel} ยังไม่ครบระยะเก็บเกี่ยว ${targetDays} วัน`,
            `ตอนนี้อยู่วันที่ ${cycleProgress.dayIndex} และยังเหลือประมาณ ${cycleProgress.remainingDays} วันตามแผน`,
            "",
            "ต้องการเก็บเกี่ยวจริงหรือไม่?",
        ].join("\n")
    }

    return `${cycleLabel} พร้อมสิ้นสุดการปลูกแล้วใช่หรือไม่?`
}

function formatDays(days: string[]): string {
    return days
        .map((day) => DAY_OPTIONS.find(([value]) => value === day)?.[1] ?? day)
        .join(" • ")
}

function renderDayChips(days: string[]): string {
    return days
        .map((day) => DAY_OPTIONS.find(([value]) => value === day)?.[1] ?? day)
        .map((label) => `<span class="schedule-day-chip">${escapeHtml(label)}</span>`)
        .join("")
}

function setMessage(text: string, tone: "info" | "error" = "info"): void {
    const card = $("message-card")
    $("message-copy").textContent = text
    card.classList.add("visible")
    card.classList.toggle("error", tone === "error")

    if (messageTimer !== undefined) {
        window.clearTimeout(messageTimer)
    }

    messageTimer = window.setTimeout(() => {
        card.classList.remove("visible")
    }, 4200)
}

function setConnectionStatus(online: boolean, detail: string): void {
    const badge = $("connection-badge")
    badge.textContent = detail
    badge.classList.toggle("online", online)
    badge.classList.toggle("offline", !online)
}

function renderDayOptions(containerId: string, inputName: string): void {
    $(containerId).innerHTML = DAY_OPTIONS.map(
        ([value, label]) => `
            <label class="day-option">
                <input type="checkbox" name="${inputName}" value="${value}" checked>
                <span>${label}</span>
            </label>
        `,
    ).join("")
}

function collectDays(inputName: string): string[] {
    return Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[name="${inputName}"]:checked`),
    ).map((checkbox) => checkbox.value)
}

function readPositiveNumber(inputId: string): number {
    const rawValue = (document.getElementById(inputId) as HTMLInputElement | null)?.value ?? ""
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error("กรุณากรอกตัวเลขที่มากกว่า 0")
    }
    return numericValue
}

function buildLineChartMarkup(
    points: Array<{ label: string; value: number | null }>,
    color: string,
): string {
    const validPoints = points
        .map((point, index) => ({
            index,
            label: point.label,
            value: point.value,
        }))
        .filter((point) => point.value !== null && Number.isFinite(point.value))

    if (validPoints.length === 0) {
        return `<div class="chart-empty">ยังไม่มีข้อมูลสำหรับช่วงเวลานี้</div>`
    }

    const width = 640
    const height = 180
    const paddingX = 18
    const paddingY = 16
    const plotWidth = width - paddingX * 2
    const plotHeight = height - paddingY * 2
    const values = validPoints.map((point) => Number(point.value))
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const range = maxValue - minValue || 1

    const pointLine = validPoints.map((point) => {
        const x = paddingX + (point.index / Math.max(points.length - 1, 1)) * plotWidth
        const y = paddingY + ((maxValue - Number(point.value)) / range) * plotHeight
        return `${x.toFixed(2)},${y.toFixed(2)}`
    }).join(" ")

    const areaLine = `${paddingX},${height - paddingY} ${pointLine} ${width - paddingX},${height - paddingY}`
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((step) => {
        const y = paddingY + step * plotHeight
        return `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" />`
    }).join("")

    const dots = validPoints.map((point) => {
        const x = paddingX + (point.index / Math.max(points.length - 1, 1)) * plotWidth
        const y = paddingY + ((maxValue - Number(point.value)) / range) * plotHeight
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" />`
    }).join("")

    const firstLabel = escapeHtml(validPoints[0].label)
    const lastLabel = escapeHtml(validPoints[validPoints.length - 1].label)

    return `
        <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
            <g class="chart-grid-lines">${gridLines}</g>
            <polygon class="chart-area" points="${areaLine}" style="color: ${color};"></polygon>
            <polyline class="chart-line" points="${pointLine}" style="color: ${color};"></polyline>
            <g class="chart-dots" style="color: ${color};">${dots}</g>
        </svg>
        <div class="chart-footer">
            <span>${firstLabel}</span>
            <span>${lastLabel}</span>
        </div>
    `
}

function renderSensorChart(
    containerId: string,
    metaId: string,
    points: Array<{ label: string; value: number | null }>,
    color: string,
    digits: number,
    suffix: string,
): void {
    $(containerId).innerHTML = buildLineChartMarkup(points, color)

    const validValues = points
        .map((point) => point.value)
        .filter((value): value is number => value !== null && Number.isFinite(value))

    if (validValues.length === 0) {
        $(metaId).textContent = "ยังไม่มีข้อมูล"
        return
    }

    const latestValue = validValues[validValues.length - 1]
    const minValue = Math.min(...validValues)
    const maxValue = Math.max(...validValues)
    $(metaId).textContent =
        `ล่าสุด ${formatNumber(latestValue, digits)}${suffix} • ` +
        `ต่ำสุด ${formatNumber(minValue, digits)} • สูงสุด ${formatNumber(maxValue, digits)}`
}

function renderSensorCharts(items: SensorReading[]): void {
    const recent = items.slice(-48)
    renderSensorChart(
        "coverage-chart",
        "coverage-chart-meta",
        recent.map((item) => ({
            label: formatTimeOnly(item.timestamp),
            value: item.green_coverage_percent ?? null,
        })),
        "#12806a",
        2,
        "%",
    )
    renderSensorChart(
        "temp-chart",
        "temp-chart-meta",
        recent.map((item) => ({
            label: formatTimeOnly(item.timestamp),
            value: item.temp ?? null,
        })),
        "#cf4e42",
        1,
        "C",
    )
    renderSensorChart(
        "ph-chart",
        "ph-chart-meta",
        recent.map((item) => ({
            label: formatTimeOnly(item.timestamp),
            value: item.ph ?? null,
        })),
        "#f29b38",
        2,
        "",
    )
}

function renderDailySummarySection(
    latestSummary: DailySummary | null,
    latestImage: ImageAnalysis | null,
    latestDebug: ImageAnalysisDebug | null,
    summaries: DailySummary[],
): void {
    const previewMeta = $("analysis-preview-meta")
    const summaryContainer = $("daily-summary-highlights")
    const processGrid = $("analysis-process-grid")
    const footerNote = $("analysis-footer-note")
    const cycle = dashboardState?.grow_cycle ?? null
    const cycleProgress = getCycleProgress(
        cycle,
        dashboardState?.meta.generated_at ?? new Date().toISOString(),
    )
    const latestCoverageRecord = getLatestCoverageRecord(sensorHistory)
    const coveragePoints = countCoveragePoints(sensorHistory)
    const taggedCoveragePoints = countTaggedCoveragePoints(sensorHistory)
    const liveMethod = formatCoverageMethod(
        liveCameraAnalysis?.coverage_method ??
        latestCoverageRecord?.coverage_method ??
        latestImage?.coverage_method,
    )
    const liveVersion =
        liveCameraAnalysis?.coverage_version ??
        latestCoverageRecord?.coverage_version ??
        latestImage?.coverage_version ??
        "-"
    const pipelineCopy = formatCoverageProcess(
        liveCameraAnalysis?.coverage_thresholds ??
        latestImage?.coverage_thresholds,
    )
    const storedSourceMode = formatSourceMode(
        latestImage?.analysis_source_mode ??
        latestDebug?.source_mode,
    )
    const sourceLabel = latestImage?.analysis_source_label ?? latestDebug?.source_label ?? "-"
    const cycleDayLabel = cycleProgress
        ? `${cycleProgress.dayIndex}/${cycle?.target_harvest_days ?? "-"}`
        : String(latestSummary?.cycle_day_index ?? latestDebug?.cycle_day_index ?? "-")
    const summaryCount = summaries.length

    previewMeta.innerHTML = `
        <span>live ${escapeHtml(liveMethod)}</span>
        <span>version ${escapeHtml(String(liveVersion))}</span>
        <span>stored source ${escapeHtml(storedSourceMode)}</span>
        <span>${cycleProgress ? `cycle day ${escapeHtml(cycleDayLabel)}` : "ยังไม่มี active cycle"}</span>
    `

    summaryContainer.innerHTML = `
        <article class="summary-card">
            <span class="card-label">Live Coverage</span>
            <strong>${formatNumber(liveCameraAnalysis?.green_coverage_percent, 2)} %</strong>
            <span class="helper-text">${escapeHtml(formatTimestamp(liveCameraAnalysis?.captured_at))}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Latest Hourly Row</span>
            <strong>${formatNumber(latestCoverageRecord?.green_coverage_percent, 2)} %</strong>
            <span class="helper-text">Temp ${formatNumber(latestCoverageRecord?.temp, 1)} °C • pH ${formatNumber(latestCoverageRecord?.ph, 2)}</span>
            <span class="helper-text">${escapeHtml(formatTimestamp(latestCoverageRecord?.timestamp))}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Coverage Pipeline</span>
            <strong class="summary-compact-text">${escapeHtml(liveMethod)}</strong>
            <span class="helper-text">version ${escapeHtml(String(liveVersion))}</span>
            <span class="helper-text wrap-anywhere">${escapeHtml(pipelineCopy)}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Daily Rollup</span>
            <strong>${formatNumber(latestSummary?.green_coverage_avg, 2)} %</strong>
            <span class="helper-text">max ${formatNumber(latestSummary?.green_coverage_max, 2)}%</span>
            <span class="helper-text">${escapeHtml(latestSummary?.date ?? "-")}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Model Feed</span>
            <strong>${taggedCoveragePoints} / ${sensorHistory.length}</strong>
            <span class="helper-text">tagged hourly rows</span>
            <span class="helper-text">${summaryCount} summary day • cycle ${escapeHtml(cycleDayLabel)}</span>
        </article>
    `

    processGrid.innerHTML = `
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Live Snapshot</span>
                <strong>${escapeHtml(formatSourceMode("camera"))}</strong>
            </div>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Captured</span>
                    <strong>${escapeHtml(formatTimestamp(liveCameraAnalysis?.captured_at))}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Coverage</span>
                    <strong>${formatNumber(liveCameraAnalysis?.green_coverage_percent, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>ROI</span>
                    <strong>${escapeHtml(formatRoiSize(liveCameraAnalysis?.coverage_roi ?? latestImage?.coverage_roi))}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Source</span>
                    <strong>preview only</strong>
                </div>
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Hourly Input</span>
                <strong>MongoDB Row</strong>
            </div>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Temp / pH</span>
                    <strong>${formatNumber(latestCoverageRecord?.temp, 1)} °C • pH ${formatNumber(latestCoverageRecord?.ph, 2)}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Stored Coverage</span>
                    <strong>${formatNumber(latestCoverageRecord?.green_coverage_percent, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Saved</span>
                    <strong>${escapeHtml(formatTimestamp(latestCoverageRecord?.timestamp))}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Rows In View</span>
                    <strong>${coveragePoints} / ${sensorHistory.length}</strong>
                </div>
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Daily Rollup</span>
                <strong>Daily Rollup</strong>
            </div>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Day</span>
                    <strong>${escapeHtml(latestSummary?.date ?? "-")}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Avg / Max</span>
                    <strong>${formatNumber(latestSummary?.green_coverage_avg, 2)} % • ${formatNumber(latestSummary?.green_coverage_max, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Image Coverage</span>
                    <strong>${formatNumber(latestImage?.green_coverage_percent, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Hourly Points</span>
                    <strong>${latestSummary?.sensor_count ?? 0}</strong>
                </div>
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Training Scope</span>
                <strong>Model Feed Snapshot</strong>
            </div>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Tagged Rows</span>
                    <strong>${taggedCoveragePoints} / ${sensorHistory.length}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Summary Days</span>
                    <strong>${summaryCount}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Cycle</span>
                    <strong>${cycleProgress ? `DAY ${escapeHtml(cycleDayLabel)}` : "IDLE"}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Stored Source</span>
                    <strong>${escapeHtml(storedSourceMode)}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Source Label</span>
                    <strong>${escapeHtml(sourceLabel)}</strong>
                </div>
            </div>
        </article>
    `
    footerNote.innerHTML = `
        ใช้การ์ดนี้ดูเฉพาะข้อมูลที่ส่งต่อไปทำ dataset และโมเดล
        ส่วนภาพ raw, binary mask และ overlay ให้ดูจาก Live OpenCV Preview ด้านบน
        Template ใช้กรอก temp/pH ย้อนหลัง แล้วค่อย import กลับเข้า Mongo ก่อน export dataset รอบถัดไป
    `
}

function renderLightRules(rules: LightRule[]): void {
    const container = $("light-rule-list")
    if (rules.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี light schedule</div>`
        return
    }

    container.innerHTML = rules.map(
        (rule) => `
            <article class="schedule-rule-card">
                <div class="schedule-rule-top">
                    <div>
                        <span class="card-label">Light Schedule</span>
                        <strong>เปิดปิดไฟอัตโนมัติประจำสัปดาห์</strong>
                    </div>
                    <span class="mini-chip ${rule.enabled ? "active" : "danger"}">
                        ${rule.enabled ? "Enabled" : "Disabled"}
                    </span>
                </div>
                <div class="schedule-day-chips">
                    ${renderDayChips(rule.days)}
                </div>
                <div class="schedule-time-grid">
                    <div class="schedule-time-box">
                        <span>On</span>
                        <strong>${escapeHtml(rule.on_time)}</strong>
                    </div>
                    <div class="schedule-time-box">
                        <span>Off</span>
                        <strong>${escapeHtml(rule.off_time)}</strong>
                    </div>
                </div>
                <div class="schedule-rule-actions">
                    <label class="day-option schedule-toggle">
                        <input
                            data-rule-toggle="true"
                            data-rule-id="${escapeHtml(rule.id)}"
                            type="checkbox"
                            ${rule.enabled ? "checked" : ""}
                        >
                        <span>Active</span>
                    </label>
                    <button
                        class="button-danger"
                        data-rule-delete="true"
                        data-rule-id="${escapeHtml(rule.id)}"
                        type="button"
                    >
                        Delete
                    </button>
                </div>
            </article>
        `,
    ).join("")
}

function renderPumpWaterRules(rules: PumpWaterRule[]): void {
    const container = $("pump-water-rule-list")
    if (rules.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี water pump schedule</div>`
        return
    }

    container.innerHTML = rules.map(
        (rule) => `
            <article class="schedule-rule-card">
                <div class="schedule-rule-top">
                    <div>
                        <span class="card-label">Water Pump Schedule</span>
                        <strong>รอบให้น้ำอัตโนมัติประจำสัปดาห์</strong>
                    </div>
                    <span class="mini-chip ${rule.enabled ? "active" : "danger"}">
                        ${rule.enabled ? "Enabled" : "Disabled"}
                    </span>
                </div>
                <div class="schedule-day-chips">
                    ${renderDayChips(rule.days)}
                </div>
                <div class="schedule-time-grid">
                    <div class="schedule-time-box">
                        <span>Start</span>
                        <strong>${escapeHtml(rule.start_time)}</strong>
                    </div>
                    <div class="schedule-time-box">
                        <span>Water</span>
                        <strong>${formatNumber(rule.water_liters, 2)} L</strong>
                    </div>
                </div>
                <div class="schedule-rule-actions">
                    <label class="day-option schedule-toggle">
                        <input
                            data-rule-toggle="true"
                            data-rule-id="${escapeHtml(rule.id)}"
                            type="checkbox"
                            ${rule.enabled ? "checked" : ""}
                        >
                        <span>Active</span>
                    </label>
                    <button
                        class="button-danger"
                        data-rule-delete="true"
                        data-rule-id="${escapeHtml(rule.id)}"
                        type="button"
                    >
                        Delete
                    </button>
                </div>
            </article>
        `,
    ).join("")
}

function renderFertilizerPumps(pumps: FertilizerPumpStatus[]): void {
    const existingValues = new Map<number, string>()
    const dosingConfig = dashboardState?.model_data?.fertilizer_dosing
    const dosePerTenLiters = dosingConfig?.dose_ml_per_10l ?? null
    const flowPerMinute = dosingConfig?.pump_flow_ml_per_min ?? null
    const secondsPerLiter = dosingConfig?.seconds_per_liter ?? null
    const dosingCopy = dosingConfig
        ? `สูตร ${formatNumber(dosePerTenLiters, 1)} mL / 10L • ${formatNumber(flowPerMinute, 1)} mL/min • ~${formatNumber(secondsPerLiter, 1)} s/L`
        : "กรอกลิตรน้ำที่ต้องการให้ระบบคำนวณเวลาเปิดปั๊ม"

    document
        .querySelectorAll<HTMLInputElement>("[data-fertilizer-water-liters]")
        .forEach((input) => {
            existingValues.set(Number(input.dataset.pumpId), input.value)
        })

    $("pump-fertilizer-list").innerHTML = pumps.map((pump) => {
        const statusText = pump.is_running
            ? `RUNNING • ${pump.remaining_seconds}s left`
            : "OFF"
        const defaultValue = existingValues.get(pump.id) ?? DEFAULT_FERTILIZER_WATER_LITERS

        return `
            <article class="pump-card">
                <div class="rule-title">
                    <div>
                        <strong>Pump ${pump.id}</strong>
                        <div class="rule-meta">GPIO ${pump.pin}</div>
                    </div>
                    <span class="mini-chip ${pump.is_running ? "active" : ""}">
                        ${statusText}
                    </span>
                </div>
                <label for="pump-water-liters-${pump.id}">
                    ปริมาณน้ำ (L)
                    <input
                        id="pump-water-liters-${pump.id}"
                        data-fertilizer-water-liters="true"
                        data-pump-id="${pump.id}"
                        min="0.1"
                        step="0.1"
                        type="number"
                        value="${escapeHtml(defaultValue)}"
                    >
                </label>
                <div class="helper-text">${escapeHtml(dosingCopy)}</div>
                <div class="pump-actions">
                    <button
                        class="button-primary"
                        data-pump-action="start"
                        data-pump-id="${pump.id}"
                        type="button"
                    >
                        Start
                    </button>
                    <button
                        class="button-danger"
                        data-pump-action="stop"
                        data-pump-id="${pump.id}"
                        type="button"
                    >
                        Stop
                    </button>
                </div>
            </article>
        `
    }).join("")
}

function renderWaterPumpHelper(state: DashboardState): void {
    const helper = document.getElementById("water-pump-helper-copy")
    if (!helper) {
        return
    }

    const config = state.model_data?.water_pump_dosing
    const flow = config?.pump_flow_l_per_min
    const secondsPerLiter = config?.seconds_per_liter
    const remainingLiters = state.actuators.pump_water.remaining_liters

    helper.textContent = state.actuators.pump_water.is_running
        ? `กำลังจ่ายน้ำอีกประมาณ ${formatNumber(remainingLiters, 2)} L • ${formatNumber(flow, 2)} L/min • ~${formatNumber(secondsPerLiter, 1)} s/L`
        : `อัตราไหล ${formatNumber(flow, 2)} L/min • ระบบคำนวณเวลาให้อัตโนมัติ (~${formatNumber(secondsPerLiter, 1)} s/L)`
}

function renderPredictionPreview(state: DashboardState): void {
    const summaryContainer = $("prediction-preview-summary")
    const copyContainer = $("prediction-preview-copy")
    const cycle = state.grow_cycle
    const latestImage = state.image_analysis

    if (!predictionPreview) {
        summaryContainer.innerHTML = `
            <article class="summary-card">
                <span class="card-label">Active Cycle</span>
                <strong>${cycle?.cycle_id ? escapeHtml(cycle.cycle_id) : "No active cycle"}</strong>
                <span class="helper-text">
                    ${cycle?.target_harvest_days ? `target ${escapeHtml(String(cycle.target_harvest_days))} days` : "เริ่มรอบปลูกก่อนเพื่อให้ระบบผูกข้อมูลกับรอบนั้น"}
                </span>
            </article>
            <article class="summary-card">
                <span class="card-label">Latest Coverage</span>
                <strong>${formatNumber(latestImage?.green_coverage_percent, 2)} %</strong>
                <span class="helper-text">ค่าล่าสุดจาก image analysis</span>
            </article>
            <article class="summary-card">
                <span class="card-label">Latest Source Day</span>
                <strong>${escapeHtml(String(state.image_analysis_debug?.cycle_day_index ?? state.daily_summary?.cycle_day_index ?? "-"))}</strong>
                <span class="helper-text">${escapeHtml(state.image_analysis?.analysis_source_label ?? "-")}</span>
            </article>
        `
        copyContainer.innerHTML = `
            ยังไม่มี prediction preview
            กด Predict Harvest เพื่อดู readiness ของข้อมูล, จำนวน history ที่มี, และ baseline วันเก็บเกี่ยวก่อนเสียบโมเดลจริง
        `
        return
    }

    const readiness = predictionPreview.readiness
    const modelInput = predictionPreview.feature_bundle?.model_input ?? {}
    const cycleSnapshot = predictionPreview.feature_bundle?.cycle ?? {}
    const prediction = predictionPreview.prediction ?? {}
    const model = predictionPreview.model ?? {}
    const readinessClass = readiness.ready ? "active" : "danger"
    const predictedDays = prediction.days_to_harvest
    const confidencePercent = prediction.confidence_score != null
        ? Math.round(prediction.confidence_score * 100)
        : null

    summaryContainer.innerHTML = `
        <article class="summary-card">
            <span class="card-label">Model Result</span>
            <strong>${predictedDays != null ? `${formatNumber(predictedDays, 1)} days` : model.available ? "-" : "No model"}</strong>
            <span class="helper-text">${predictedDays != null ? "คาดว่าเหลืออีกกี่วันจะเก็บเกี่ยวได้" : "รอ readiness หรือแก้ model path ก่อน"}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Predicted Harvest</span>
            <strong>${escapeHtml(formatTimestamp(prediction.predicted_harvest_at))}</strong>
            <span class="helper-text">วันที่คาดว่าจะเก็บเกี่ยวได้จากโมเดล</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Confidence</span>
            <strong>${confidencePercent != null ? `${confidencePercent}%` : "-"}</strong>
            <span class="helper-text">
                ${prediction.uncertainty_days != null ? `uncertainty ±${formatNumber(prediction.uncertainty_days, 2)} days` : "ยังไม่มี confidence จากโมเดล"}
            </span>
        </article>
        <article class="summary-card">
            <span class="card-label">Cycle Day</span>
            <strong>${formatNumber(cycleSnapshot.cycle_day_index, 0)} / ${formatNumber(cycleSnapshot.target_harvest_days, 0)}</strong>
            <span class="helper-text">baseline ${formatNumber(modelInput.baseline_expected_days_to_harvest, 0)} days left</span>
        </article>
    `

    copyContainer.innerHTML = `
        <div class="rule-title">
            <div>
                <strong>${model.available ? "Baseline Model Prediction" : "Model Unavailable"}</strong>
                <div class="rule-meta">${escapeHtml(model.name ?? predictionPreview.prediction_type)}</div>
            </div>
            <span class="mini-chip ${readinessClass}">
                ${model.available ? (readiness.ready ? "Predicted" : "Needs more data") : "Fallback"}
            </span>
        </div>
        <div class="history-metrics">
            <span>Temp ${formatNumber(modelInput.latest_temp_c, 1)} °C</span>
            <span>pH ${formatNumber(modelInput.latest_ph, 2)}</span>
            <span>Coverage ${formatNumber(modelInput.latest_daily_image_coverage_percent ?? modelInput.latest_green_coverage_percent, 2)}%</span>
        </div>
        <p class="helper-text">
            ${model.available
                ? `โมเดลจาก Colab ถูกโหลดแล้วและใช้ feature ปัจจุบัน ${formatNumber(model.feature_count, 0)} ตัวในการทำนายวันเก็บเกี่ยว`
                : `backend ยังโหลดโมเดลไม่ได้${model.error ? `: ${escapeHtml(model.error)}` : ""}`}
        </p>
        <div class="rule-meta">
            Blocking: ${escapeHtml(readiness.blocking_reasons.join(" • ") || "none")}
        </div>
        <div class="rule-meta">
            Warnings: ${escapeHtml(readiness.warnings.join(" • ") || "none")}
        </div>
        <div class="rule-meta">
            Predicted harvest: ${escapeHtml(formatTimestamp(prediction.predicted_harvest_at))} • baseline ${formatNumber(prediction.baseline_expected_days_to_harvest, 0)} days
        </div>
    `
}

function clearCameraTimer(): void {
    if (cameraRetryTimer !== undefined) {
        window.clearTimeout(cameraRetryTimer)
        cameraRetryTimer = undefined
    }
}

function setAnalysisRefreshState(pending: boolean): void {
    const button = document.getElementById("analysis-refresh-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending
        ? "Refreshing..."
        : "Refresh Hub"
    button.title = "รีเฟรชภาพสด, ข้อมูลรายชั่วโมง และ daily summary ล่าสุด"
}

function setPredictionPreviewState(pending: boolean): void {
    const button = document.getElementById("prediction-preview-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    const requiresActiveCycle = !dashboardState?.grow_cycle

    button.disabled = pending || requiresActiveCycle
    button.textContent = pending
        ? "Checking..."
        : requiresActiveCycle
            ? "Need Active Cycle"
            : "Predict Harvest"
    button.title = requiresActiveCycle
        ? "เริ่มรอบปลูกก่อน แล้วระบบจึงจะ preview ความพร้อมสำหรับการทำนายวันเก็บเกี่ยวได้"
        : ""
}

function setDatasetExportState(pending: boolean): void {
    const button = document.getElementById("export-dataset-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending ? "Exporting..." : "Export Dataset"
}

function setTemplateDownloadState(pending: boolean): void {
    const button = document.getElementById("download-template-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending ? "Preparing..." : "Download Template"
}

function setDatasetImportState(pending: boolean): void {
    const button = document.getElementById("upload-template-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending ? "Uploading..." : "Upload CSV"
}

function triggerBlobDownload(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
    }, 1500)
}

function getSeedCycleInputValue(): string {
    const input = document.getElementById("seed-cycle-id-input") as HTMLInputElement | null
    return (input?.value ?? "").trim()
}

function buildCameraSnapshotUrl(baseUrl: string): string {
    cameraStreamNonce += 1
    const separator = baseUrl.includes("?") ? "&" : "?"
    return `${baseUrl}${separator}snapshot=${cameraStreamNonce}`
}

function buildAnalysisAssetUrl(url: string | null | undefined, cacheKey: string): string | null {
    if (!url) {
        return null
    }

    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}v=${encodeURIComponent(cacheKey)}`
}

function getLiveAnalysisPreviewKey(analysis: LiveCameraAnalysis): string {
    return String(analysis.captured_at || Date.now())
}

function preloadImageAsset(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.decoding = "async"
        image.onload = () => resolve()
        image.onerror = () => reject(new Error(`โหลดภาพวิเคราะห์ไม่สำเร็จ: ${url}`))
        image.src = url
    })
}

async function preloadLiveAnalysisAssets(analysis: LiveCameraAnalysis): Promise<void> {
    const previewKey = getLiveAnalysisPreviewKey(analysis)
    const urls = [
        buildAnalysisAssetUrl(analysis.raw_url, previewKey),
        buildAnalysisAssetUrl(analysis.mask_url, previewKey),
        buildAnalysisAssetUrl(analysis.overlay_url, previewKey),
    ].filter((url): url is string => Boolean(url))

    await Promise.all(urls.map((url) => preloadImageAsset(url)))
}

function ensureLiveAnalysisStrip(): void {
    const strip = $("live-analysis-strip")
    if (strip.dataset.mode === "tiles") {
        return
    }

    strip.innerHTML = `
        <a id="live-analysis-raw-tile" class="image-tile" target="_blank" rel="noreferrer">
            <img alt="Current Snapshot" decoding="async" loading="eager">
            <span>Current Snapshot</span>
        </a>
        <a id="live-analysis-mask-tile" class="image-tile" target="_blank" rel="noreferrer">
            <img alt="Binary Mask" decoding="async" loading="eager">
            <span>Binary Mask</span>
        </a>
        <a id="live-analysis-overlay-tile" class="image-tile" target="_blank" rel="noreferrer">
            <img alt="Green Overlay" decoding="async" loading="eager">
            <span>Green Overlay</span>
        </a>
    `
    strip.dataset.mode = "tiles"
}

function updateLiveAnalysisTile(tileId: string, label: string, url: string | null): void {
    const tile = document.getElementById(tileId) as HTMLAnchorElement | null
    if (!tile) {
        return
    }

    const image = tile.querySelector("img")
    const caption = tile.querySelector("span")
    if (caption) {
        caption.textContent = label
    }
    if (image) {
        image.setAttribute("alt", label)
        if (url && image.getAttribute("src") !== url) {
            image.setAttribute("src", url)
        }
    }

    if (url) {
        if (tile.getAttribute("href") !== url) {
            tile.setAttribute("href", url)
        }
    } else {
        tile.removeAttribute("href")
        if (image) {
            image.removeAttribute("src")
        }
    }
}

function clearLiveAnalysisTimer(): void {
    if (liveAnalysisTimer !== undefined) {
        window.clearTimeout(liveAnalysisTimer)
        liveAnalysisTimer = undefined
    }
}

function renderCameraRoiOverlay(): void {
    const roiBox = document.getElementById("camera-roi-box") as HTMLDivElement | null
    if (!roiBox) {
        return
    }

    const roi = liveCameraAnalysis?.coverage_roi
    const imageWidth = liveCameraAnalysis?.image_width || 640
    const imageHeight = liveCameraAnalysis?.image_height || 480
    if (
        !cameraWanted ||
        !roi ||
        !roi.width ||
        !roi.height ||
        !imageWidth ||
        !imageHeight
    ) {
        roiBox.classList.add("hidden")
        return
    }

    const leftPercent = (roi.x / imageWidth) * 100
    const topPercent = (roi.y / imageHeight) * 100
    const widthPercent = (roi.width / imageWidth) * 100
    const heightPercent = (roi.height / imageHeight) * 100
    const cornerRadius = roi.corner_radius || 0
    const radiusXPercent = (cornerRadius / roi.width) * 100
    const radiusYPercent = (cornerRadius / roi.height) * 100

    roiBox.style.left = `${leftPercent}%`
    roiBox.style.top = `${topPercent}%`
    roiBox.style.width = `${widthPercent}%`
    roiBox.style.height = `${heightPercent}%`
    roiBox.style.borderRadius = cornerRadius > 0
        ? `${radiusXPercent}% / ${radiusYPercent}%`
        : "0"
    roiBox.classList.remove("hidden")
}

function renderLiveCameraAnalysis(): void {
    const meta = $("live-analysis-meta")
    const strip = $("live-analysis-strip")

    if (!liveCameraAnalysis) {
        meta.innerHTML = `
            <span>กำลังรอภาพสดสำหรับวิเคราะห์ด้วย OpenCV</span>
            <span>ไม่มีการบันทึกรูปลง storage</span>
        `
        strip.innerHTML = `
            <div class="rule-card rule-empty">
                พื้นที่นี้จะแสดงภาพปัจจุบัน, binary mask และ green overlay จากเฟรมสดที่กำลังดูอยู่
            </div>
        `
        strip.dataset.mode = "placeholder"
        renderCameraRoiOverlay()
        return
    }

    const previewKey = getLiveAnalysisPreviewKey(liveCameraAnalysis)
    const rawUrl = buildAnalysisAssetUrl(liveCameraAnalysis.raw_url, previewKey)
    const maskUrl = buildAnalysisAssetUrl(liveCameraAnalysis.mask_url, previewKey)
    const overlayUrl = buildAnalysisAssetUrl(liveCameraAnalysis.overlay_url, previewKey)

    meta.innerHTML = `
        <span>captured ${escapeHtml(formatTimestamp(liveCameraAnalysis.captured_at))}</span>
        <span>coverage ${formatNumber(liveCameraAnalysis.green_coverage_percent, 2)}%</span>
        <span>${formatNumber(liveCameraAnalysis.green_pixels, 0)} / ${formatNumber(liveCameraAnalysis.total_pixels, 0)} green pixels</span>
        <span>${escapeHtml(formatCoverageMethod(liveCameraAnalysis.coverage_method))}</span>
        <span>${escapeHtml(formatCoverageProcess(liveCameraAnalysis.coverage_thresholds))}</span>
        <span>ROI ${escapeHtml(formatRoiSize(liveCameraAnalysis.coverage_roi))}</span>
    `

    ensureLiveAnalysisStrip()
    updateLiveAnalysisTile("live-analysis-raw-tile", "Current Snapshot", rawUrl)
    updateLiveAnalysisTile("live-analysis-mask-tile", "Binary Mask", maskUrl)
    updateLiveAnalysisTile("live-analysis-overlay-tile", "Green Overlay", overlayUrl)
    renderCameraRoiOverlay()
}

function queueLiveAnalysisRefresh(delayMs = LIVE_ANALYSIS_REFRESH_MS): void {
    if (!cameraWanted || document.hidden) {
        clearLiveAnalysisTimer()
        return
    }

    clearLiveAnalysisTimer()
    liveAnalysisTimer = window.setTimeout(() => {
        void refreshLiveCameraAnalysis(false)
    }, delayMs)
}

async function refreshLiveCameraAnalysis(force = false): Promise<void> {
    if (liveCameraAnalysisPending || !cameraWanted || document.hidden) {
        return
    }

    liveCameraAnalysisPending = true
    try {
        const response = await fetchLiveCameraAnalysis(force)
        await preloadLiveAnalysisAssets(response.analysis)
        liveCameraAnalysis = response.analysis
        renderLiveCameraAnalysis()
        if (dashboardState) {
            renderDailySummarySection(
                dashboardState.daily_summary,
                dashboardState.image_analysis,
                dashboardState.image_analysis_debug,
                dailySummaryHistory,
            )
        }
        queueLiveAnalysisRefresh(LIVE_ANALYSIS_REFRESH_MS)
    } catch (_error) {
        queueLiveAnalysisRefresh(LIVE_ANALYSIS_RETRY_MS)
    } finally {
        liveCameraAnalysisPending = false
    }
}

function queueNextCameraFrame(delayMs = CAMERA_REFRESH_MS): void {
    const stream = document.getElementById("camera-stream") as HTMLImageElement | null
    if (!stream || !cameraWanted || document.hidden) {
        return
    }

    clearCameraTimer()
    cameraRetryTimer = window.setTimeout(() => {
        if (!cameraWanted || document.hidden) {
            return
        }

        const streamUrl = dashboardState?.camera.stream_url ?? "/camera/frame"
        stream.setAttribute("src", buildCameraSnapshotUrl(streamUrl))
    }, delayMs)
}

function syncCamera(): void {
    const stream = document.getElementById("camera-stream") as HTMLImageElement | null
    const overlay = $("camera-overlay")
    const overlayCopy = $("camera-overlay-copy")
    const button = $("camera-toggle")
    const streamUrl = dashboardState?.camera.stream_url ?? "/camera/frame"
    const shouldStream = cameraWanted && !document.hidden

    if (!stream) {
        return
    }

    if (shouldStream) {
        if (!stream.getAttribute("src")) {
            cameraLoaded = false
            stream.setAttribute("src", buildCameraSnapshotUrl(streamUrl))
        }
        queueLiveAnalysisRefresh(600)
        button.textContent = "Pause Camera"
        if (cameraLoaded) {
            overlay.classList.add("hidden")
        } else {
            overlay.classList.remove("hidden")
            overlayCopy.textContent =
                dashboardState?.camera.status.last_error ||
                "กำลังดึง snapshot จากกล้อง..."
        }
        return
    }

    clearCameraTimer()
    clearLiveAnalysisTimer()
    stream.removeAttribute("src")
    cameraLoaded = false
    renderCameraRoiOverlay()
    overlay.classList.remove("hidden")
    overlayCopy.textContent = cameraWanted
        ? "กล้องพักอัตโนมัติเมื่อแท็บไม่ถูกใช้งาน เพื่อลดภาระเครื่อง"
        : "กล้องถูกพักไว้ คุณสามารถกด Resume เมื่ออยากดูภาพสดได้"
    button.textContent = "Resume Camera"
}

function renderDashboard(state: DashboardState): void {
    const sensor = state.sensor
    const light = state.actuators.light
    const waterPump = state.actuators.pump_water
    const fertilizer = state.actuators.pump_fertilizer
    const cycle = state.grow_cycle
    const cycleProgress = getCycleProgress(cycle, state.meta.generated_at)

    $("timezone-chip").textContent = `TZ: ${state.meta.timezone}`
    $("generated-at").textContent = formatTimestamp(state.meta.generated_at)

    const seedCycleInput = document.getElementById("seed-cycle-id-input") as HTMLInputElement | null
    const modelDataCopy = document.getElementById("model-data-upload-copy") as HTMLElement | null
    const latestSeedCycleId = state.model_data?.latest_seed_cycle_id ?? ""
    if (seedCycleInput && !seedCycleInput.value.trim() && latestSeedCycleId) {
        seedCycleInput.value = latestSeedCycleId
    }
    if (modelDataCopy) {
        modelDataCopy.textContent = latestSeedCycleId
            ? `seed cycle ล่าสุด: ${latestSeedCycleId} • ดาวน์โหลด template -> กรอก temp/pH -> อัปโหลดกลับเข้า Mongo`
            : "ดาวน์โหลด template -> กรอก temp/pH -> อัปโหลดกลับเข้า Mongo สำหรับ seed cycle"
    }

    $("sensor-temp").textContent = `${formatNumber(sensor?.temp)} °C`
    $("sensor-ph").textContent = formatNumber(sensor?.ph, 2)
    $("sensor-coverage").textContent = `${formatNumber(sensor?.green_coverage_percent, 2)} %`
    $("sensor-timestamp").textContent = formatTimestamp(sensor?.timestamp)

    $("light-status-chip").textContent = light.is_on ? "ON" : "OFF"
    $("light-mode-copy").textContent = light.active_low
        ? `GPIO ${light.pin} • relay is active-low`
        : `GPIO ${light.pin} • relay is active-high`

    $("pump-water-status-chip").textContent = waterPump.is_running
        ? "RUNNING"
        : "READY"
    $("pump-water-copy").textContent = waterPump.is_running
        ? `${formatNumber(waterPump.remaining_liters, 2)}L left • ${waterPump.remaining_seconds}s on GPIO ${waterPump.pin}`
        : `GPIO ${waterPump.pin} • waiting for manual or scheduled run`

    $("fertilizer-summary").textContent = `${fertilizer.running_count}/${fertilizer.pump_count} running`
    $("grow-cycle-status-chip").textContent = cycleProgress
        ? `DAY ${cycleProgress.dayIndex}/${cycle?.target_harvest_days ?? "-"}`
        : "IDLE"
    $("grow-cycle-copy").textContent = cycleProgress
        ? `${cycle?.name || cycle?.cycle_id || "active cycle"} • เหลือ ${cycleProgress.remainingDays} วันตามแผน`
        : "ยังไม่มีรอบปลูก active อยู่"
    setCycleActionState(cycle, cycleProgress)

    renderLightRules(state.automation.light)
    renderPumpWaterRules(state.automation.pump_water)
    renderFertilizerPumps(fertilizer.pumps)
    renderWaterPumpHelper(state)
    renderSensorCharts(sensorHistory)
    renderDailySummarySection(
        state.daily_summary,
        state.image_analysis,
        state.image_analysis_debug,
        dailySummaryHistory,
    )
    setAnalysisRefreshState(analysisRefreshPending)
    renderPredictionPreview(state)
    setPredictionPreviewState(predictionPreviewPending)
    renderLiveCameraAnalysis()

    if (!cameraLoaded && state.camera.status.last_error) {
        $("camera-overlay").classList.remove("hidden")
        $("camera-overlay-copy").textContent = state.camera.status.last_error
    }

    syncCamera()
}

function queueRefresh(): void {
    if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer)
    }

    const delay = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
    pollTimer = window.setTimeout(async () => {
        await refreshDashboard(true)
        queueRefresh()
    }, delay)
}

async function refreshDashboard(silent = false): Promise<void> {
    try {
        const [state, sensorHistoryResponse, dailySummaryResponse] = await Promise.all([
            fetchDashboardState(),
            fetchSensorHistory(48),
            fetchDailySummaryHistory(14),
        ])
        dashboardState = state
        sensorHistory = sensorHistoryResponse.items
        dailySummaryHistory = dailySummaryResponse.items
        renderDashboard(state)
        setConnectionStatus(true, document.hidden ? "พักการ sync บางส่วน" : "Live sync")
    } catch (error) {
        setConnectionStatus(false, "Offline")
        if (!silent) {
            const message = error instanceof Error ? error.message : "โหลด dashboard ไม่สำเร็จ"
            setMessage(message, "error")
        }
    }
}

async function runAction(message: string, action: () => Promise<unknown>): Promise<void> {
    try {
        await action()
        await refreshDashboard(true)
        setMessage(message)
    } catch (error) {
        const text = error instanceof Error ? error.message : "request failed"
        setMessage(text, "error")
    }
}

function bindRuleContainer(containerId: string): void {
    $(containerId).addEventListener("click", async (event) => {
        const target = event.target as HTMLElement
        const deleteButton = target.closest<HTMLButtonElement>("[data-rule-delete]")
        if (!deleteButton) {
            return
        }

        const ruleId = deleteButton.dataset.ruleId
        if (!ruleId) {
            return
        }

        await runAction("Schedule deleted", async () => {
            await deleteAutomationRule(ruleId)
        })
    })

    $(containerId).addEventListener("change", async (event) => {
        const target = event.target as HTMLInputElement
        if (!target.matches("[data-rule-toggle]")) {
            return
        }

        const ruleId = target.dataset.ruleId
        if (!ruleId) {
            return
        }

        await runAction(
            `Schedule ${target.checked ? "enabled" : "disabled"}`,
            async () => {
                await setAutomationRuleEnabled(ruleId, target.checked)
            },
        )
    })
}

function bindEvents(): void {
    setAnalysisRefreshState(false)
    setDatasetExportState(false)
    setDatasetImportState(false)
    setTemplateDownloadState(false)
    setPredictionPreviewState(false)
    renderLiveCameraAnalysis()

    const cameraStream = document.getElementById("camera-stream") as HTMLImageElement | null
    if (cameraStream) {
        cameraStream.addEventListener("load", () => {
            cameraLoaded = true
            clearCameraTimer()
            $("camera-overlay").classList.add("hidden")
            queueNextCameraFrame(CAMERA_REFRESH_MS)
            if (!liveCameraAnalysis) {
                void refreshLiveCameraAnalysis(true)
            }
        })

        cameraStream.addEventListener("error", () => {
            cameraLoaded = false
            $("camera-overlay").classList.remove("hidden")
            $("camera-overlay-copy").textContent =
                dashboardState?.camera.status.last_error ||
                "ไม่สามารถโหลด snapshot จากกล้องได้ กำลังลองใหม่"

            cameraStream.removeAttribute("src")
            clearCameraTimer()
            clearLiveAnalysisTimer()
            queueNextCameraFrame(CAMERA_RETRY_MS)
            queueLiveAnalysisRefresh(LIVE_ANALYSIS_RETRY_MS)
        })
    }

    $("camera-toggle").addEventListener("click", () => {
        cameraWanted = !cameraWanted
        syncCamera()
    })

    $("analysis-refresh-button").addEventListener("click", async () => {
        if (analysisRefreshPending) {
            return
        }

        analysisRefreshPending = true
        setAnalysisRefreshState(true)
        try {
            await refreshDashboard(true)
            if (cameraWanted && !document.hidden) {
                await refreshLiveCameraAnalysis(true)
            }
            if (dashboardState) {
                renderDashboard(dashboardState)
            }
            setMessage("รีเฟรชข้อมูลวิเคราะห์และชุดข้อมูลสำหรับโมเดลแล้ว")
        } catch (error) {
            const text = error instanceof Error ? error.message : "รีเฟรชข้อมูลวิเคราะห์ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            analysisRefreshPending = false
            setAnalysisRefreshState(false)
        }
    })

    $("download-template-button").addEventListener("click", async () => {
        if (templateDownloadPending) {
            return
        }

        templateDownloadPending = true
        setTemplateDownloadState(true)
        try {
            const result = await downloadModelDataTemplate()
            triggerBlobDownload(result.blob, result.filename)
            setMessage("ดาวน์โหลด template สำหรับกรอก temp/pH แล้ว")
        } catch (error) {
            const text = error instanceof Error ? error.message : "ดาวน์โหลด template ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            templateDownloadPending = false
            setTemplateDownloadState(false)
        }
    })

    $("export-dataset-button").addEventListener("click", async () => {
        if (datasetExportPending) {
            return
        }

        datasetExportPending = true
        setDatasetExportState(true)
        try {
            const result = await exportTrainingDataset()
            triggerBlobDownload(result.blob, result.filename)
            const exportedRows = result.headers.get("X-Exported-Rows") ?? "0"
            const readyRows = result.headers.get("X-Ready-Rows") ?? "0"
            setMessage(`export dataset แล้ว (${readyRows}/${exportedRows} rows ready)`)
        } catch (error) {
            const text = error instanceof Error ? error.message : "export dataset ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            datasetExportPending = false
            setDatasetExportState(false)
        }
    })

    $("upload-template-button").addEventListener("click", async () => {
        if (datasetImportPending) {
            return
        }

        const cycleId = getSeedCycleInputValue()
        const fileInput = document.getElementById("seed-readings-file-input") as HTMLInputElement | null
        const file = fileInput?.files?.[0]

        if (!cycleId) {
            setMessage("กรุณากรอก Seed Cycle ID ก่อนอัปโหลด", "error")
            return
        }

        if (!file) {
            setMessage("กรุณาเลือกไฟล์ CSV ก่อนอัปโหลด", "error")
            return
        }

        datasetImportPending = true
        setDatasetImportState(true)
        try {
            const csvText = await file.text()
            const result = await importModelDataTemplate({
                cycle_id: cycleId,
                csv_text: csvText,
                filename: file.name,
                skip_blank_rows: true,
            })
            const rowsUpdated = result.import_result?.rows_updated ?? 0
            await refreshDashboard(true)
            if (dashboardState) {
                renderDashboard(dashboardState)
            }
            if (fileInput) {
                fileInput.value = ""
            }
            setMessage(`อัปโหลด CSV แล้ว (${rowsUpdated} rows updated)`)
        } catch (error) {
            const text = error instanceof Error ? error.message : "อัปโหลด CSV ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            datasetImportPending = false
            setDatasetImportState(false)
        }
    })

    $("prediction-preview-button").addEventListener("click", async () => {
        if (predictionPreviewPending) {
            return
        }

        predictionPreviewPending = true
        setPredictionPreviewState(true)
        try {
            predictionPreview = await previewHarvestPrediction({
                lookback_days: 7,
                sensor_limit: 240,
            })
            if (dashboardState) {
                renderPredictionPreview(dashboardState)
            }
            setMessage("อัปเดต prediction preview แล้ว")
        } catch (error) {
            predictionPreview = null
            const text = error instanceof Error ? error.message : "prediction preview ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            predictionPreviewPending = false
            setPredictionPreviewState(false)
        }
    })

    $("light-on-button").addEventListener("click", async () => {
        await runAction("Light turned on", async () => {
            await turnLight("on")
        })
    })

    $("light-off-button").addEventListener("click", async () => {
        await runAction("Light turned off", async () => {
            await turnLight("off")
        })
    })

    $("water-start-button").addEventListener("click", async () => {
        await runAction("Water pump started", async () => {
            await startWaterPump(readPositiveNumber("manual-water-liters"))
        })
    })

    $("water-stop-button").addEventListener("click", async () => {
        await runAction("Water pump stopped", async () => {
            await stopWaterPump()
        })
    })

    $("cycle-start-button").addEventListener("click", async () => {
        const activeCycle = dashboardState?.grow_cycle
        if (cycleActionPending) {
            return
        }

        if (activeCycle?.status === "active") {
            setMessage("มีรอบปลูกที่กำลัง active อยู่แล้ว", "error")
            return
        }

        cycleActionPending = true
        setCycleActionState(activeCycle ?? null, getCycleProgress(activeCycle ?? null, dashboardState?.meta.generated_at ?? new Date().toISOString()))
        try {
            await runAction("เริ่มรอบปลูกแล้ว", async () => {
                await startGrowCycle()
            })
        } finally {
            cycleActionPending = false
            const { cycle, progress } = getActiveCycleProgress()
            setCycleActionState(cycle, progress)
        }
    })

    $("cycle-harvest-button").addEventListener("click", async () => {
        if (cycleActionPending) {
            return
        }

        const { cycle, progress } = getActiveCycleProgress()
        if (!cycle) {
            setMessage("ยังไม่มีรอบปลูกที่ active อยู่", "error")
            return
        }

        if (!window.confirm(buildHarvestConfirmationMessage(cycle, progress))) {
            setMessage("ยกเลิกการสิ้นสุดรอบปลูกแล้ว")
            return
        }

        cycleActionPending = true
        setCycleActionState(cycle, progress)
        try {
            await runAction("สิ้นสุดรอบปลูกแล้ว", async () => {
                await harvestGrowCycle()
            })
        } finally {
            cycleActionPending = false
            const nextState = getActiveCycleProgress()
            setCycleActionState(nextState.cycle, nextState.progress)
        }
    })

    $("pump-fertilizer-list").addEventListener("click", async (event) => {
        const target = event.target as HTMLElement
        const button = target.closest<HTMLButtonElement>("[data-pump-action]")
        if (!button) {
            return
        }

        const pumpId = Number(button.dataset.pumpId)
        if (!Number.isFinite(pumpId)) {
            return
        }

        if (button.dataset.pumpAction === "start") {
            const waterLiters = readPositiveNumber(`pump-water-liters-${pumpId}`)
            await runAction(`Fertilizer pump ${pumpId} started`, async () => {
                await startFertilizerPump(pumpId, waterLiters)
            })
            return
        }

        await runAction(`Fertilizer pump ${pumpId} stopped`, async () => {
            await stopFertilizerPump(pumpId)
        })
    })

    $("light-schedule-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const onTime = (document.getElementById("light-on-time") as HTMLInputElement).value
        const offTime = (document.getElementById("light-off-time") as HTMLInputElement).value
        const days = collectDays("light-days")

        if (days.length === 0) {
            setMessage("เลือกวันอย่างน้อย 1 วันก่อนสร้าง schedule", "error")
            return
        }

        await runAction("Light schedule added", async () => {
            await createLightSchedule({
                on_time: onTime,
                off_time: offTime,
                days,
                enabled: true,
            })
        })
    })

    $("pump-water-schedule-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const startTime = (document.getElementById("pump-water-start-time") as HTMLInputElement).value
        const days = collectDays("pump-water-days")

        if (days.length === 0) {
            setMessage("เลือกวันอย่างน้อย 1 วันก่อนสร้าง schedule", "error")
            return
        }

        await runAction("Water pump schedule added", async () => {
            await createPumpWaterSchedule({
                start_time: startTime,
                water_liters: readPositiveNumber("pump-water-schedule-liters"),
                days,
                enabled: true,
            })
        })
    })

    bindRuleContainer("light-rule-list")
    bindRuleContainer("pump-water-rule-list")

    document.addEventListener("visibilitychange", () => {
        syncCamera()
        if (!document.hidden) {
            void refreshLiveCameraAnalysis(true)
        } else {
            clearLiveAnalysisTimer()
        }
        queueRefresh()
    })
}

async function bootstrap(): Promise<void> {
    const root = document.getElementById("app")
    if (!root) {
        throw new Error("Missing app root")
    }

    root.innerHTML = createLayout()
    renderDayOptions("light-days", "light-days")
    renderDayOptions("pump-water-days", "pump-water-days")
    bindEvents()
    syncCamera()
    void refreshLiveCameraAnalysis(true)
    await refreshDashboard()
    queueRefresh()
}

void bootstrap()
