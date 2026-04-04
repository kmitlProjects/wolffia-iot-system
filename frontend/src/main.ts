import {
    createLightSchedule,
    createPumpWaterSchedule,
    deleteAutomationRule,
    downloadModelDataTemplate,
    exportTrainingDataset,
    fetchAnomalyAlerts,
    fetchAnomalyWatchStatus,
    fetchDailySummaryHistory,
    fetchDashboardState,
    fetchLiveCameraAnalysis,
    fetchSensorHistory,
    harvestGrowCycle,
    importModelDataTemplate,
    importTimeseriesGapCsv,
    previewHarvestPrediction,
    setTimeseriesCapturePolicy,
    setAutomationRuleEnabled,
    startFertilizerPump,
    startGrowCycle,
    startWaterPump,
    stopFertilizerPump,
    stopWaterPump,
    turnLight,
} from "./api.js?v=20260404be"
import type {
    AnomalyAlert,
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
const EVERYDAY_VALUES = DAY_OPTIONS.map(([value]) => value)

const POLL_VISIBLE_MS = 30000
const POLL_HIDDEN_MS = 30000
const ANOMALY_POLL_MS = 5000
const CAMERA_REFRESH_MS = 2500
const CAMERA_RETRY_MS = 3000
const LIVE_ANALYSIS_REFRESH_MS = 8000
const LIVE_ANALYSIS_RETRY_MS = 10000
const DEFAULT_WATER_PUMP_LITERS = "1"
const DEFAULT_FERTILIZER_WATER_LITERS = "10"
const FALLBACK_TIMEZONE = "Asia/Bangkok"

let dashboardState: DashboardState | null = null
let sensorHistory: SensorReading[] = []
let dailySummaryHistory: DailySummary[] = []
let pollTimer: number | undefined
let anomalyPollTimer: number | undefined
let messageTimer: number | undefined
let cameraRetryTimer: number | undefined
let liveAnalysisTimer: number | undefined
let nextSensorSaveTimer: number | undefined
let cameraWanted = true
let cameraLoaded = false
let cameraStreamNonce = 0
let cycleActionPending = false
let analysisRefreshPending = false
let datasetExportPending = false
let datasetImportPending = false
let gapImportPending = false
let templateDownloadPending = false
let predictionPreviewPending = false
let predictionPreview: HarvestPredictionPreviewResponse | null = null
let timeseriesCapturePolicyPending = false
let liveCameraAnalysisPending = false
let liveCameraAnalysis: LiveCameraAnalysis | null = null
let anomalyWatchState: DashboardState["anomaly_watch"] | null = null
let anomalyAlerts: AnomalyAlert[] = []
let anomalyPollPending = false
let lastSeenAnomalyAlertId: string | null = null
let anomalyAlertPrimed = false
let analysisAdvancedOpen = false
let cameraGapOpen = false
let liveAnalysisOpen = false
let lightScheduleOpen = false
let pumpWaterScheduleOpen = false
let lightRulesOpen = false
let pumpWaterRulesOpen = false

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

function renderIcon(filename: string, label: string, className = "ui-icon"): string {
    return `<img src="/assets/icon/${filename}" class="${className}" alt="" aria-hidden="true">`
}

function createLayout(): string {
    return `
        <div class="app-shell">
            <main class="dashboard-grid">
                <aside id="info-rail-section" class="panel info-rail-panel">
                    <div class="panel-inner info-rail-inner">
                        <div class="info-rail-copy hero-copy">
                            <span class="eyebrow">Wolffia Dashboard</span>
                            <h1>ภาพสด ควบคุมอุปกรณ์ และข้อมูลสำคัญในหน้าเดียว</h1>
                            <p>
                                หน้าเดียวสำหรับดูบ่อ เช็กค่าล่าสุด ควบคุมอุปกรณ์ และดูข้อมูลที่จำเป็นก่อนตัดสินใจ
                            </p>
                        </div>
                        <div class="info-rail-summary">
                            <article class="hero-stat-card info-rail-card">
                                <span class="card-label">ระบบ</span>
                                <div class="hero-stat-inline">
                                    <span id="connection-badge" class="status-badge">กำลังเชื่อมต่อ</span>
                                    <span id="timezone-chip" class="mini-chip">-</span>
                                </div>
                                <span class="helper-text">สถานะเชื่อมต่อและ timezone ที่ระบบใช้จริง</span>
                            </article>
                            <article class="hero-stat-card info-rail-card">
                                <span class="card-label">อัปเดตล่าสุด</span>
                                <strong id="generated-at">-</strong>
                                <span class="helper-text">เวลาที่ state ล่าสุดถูกสร้าง</span>
                            </article>
                            <article class="hero-stat-card info-rail-card">
                                <span class="card-label">โฟลว์ข้อมูล</span>
                                <div class="hero-feature-list">
                                    <span class="mini-chip">Live camera</span>
                                    <span class="mini-chip">Sensor history</span>
                                    <span class="mini-chip">Harvest prediction</span>
                                </div>
                                <span class="helper-text">หน้าเดียวสำหรับดูบ่อ คุมอุปกรณ์ และดูข้อมูลที่ต้องใช้ก่อนตัดสินใจ</span>
                            </article>
                        </div>
                    </div>
                </aside>

                <section id="camera-section" class="panel camera-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2 class="section-heading">
                                    ${renderIcon("camera.svg", "Camera Snapshot", "section-icon")}
                                    <span>Camera Snapshot</span>
                                </h2>
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
                            <div id="camera-overlay" class="camera-overlay hidden">
                                <p id="camera-overlay-copy">
                                    Camera paused to reduce CPU load.
                                </p>
                            </div>
                            <div
                                id="live-analysis-shell"
                                class="live-analysis-shell"
                                hidden
                                style="display: none;"
                            >
                                <div id="live-analysis-strip" class="image-strip live-analysis-shell-grid"></div>
                            </div>
                        </div>
                        <div class="camera-analysis-block">
                            <div class="panel-title">
                                <h3 class="section-heading">
                                    ${renderIcon("LiveCV.svg", "Live OpenCV Preview", "section-icon")}
                                    <span>Live OpenCV Preview</span>
                                </h3>
                                <p>ประมวลผลจากภาพสดที่แสดงอยู่ตอนนี้โดยไม่บันทึกภาพลง storage ใช้สำหรับดูผลการแยกพื้นที่สีเขียว ณ ตอนนั้น</p>
                            </div>
                            <button
                                id="live-analysis-toggle"
                                class="button-ghost live-analysis-toggle"
                                type="button"
                                aria-expanded="false"
                                aria-controls="live-analysis-content"
                            >
                                แสดงภาพตรวจสอบ OpenCV
                            </button>
                            <div
                                id="live-analysis-content"
                                class="live-analysis-content"
                                hidden
                                style="display: none;"
                            >
                                <div id="live-analysis-meta" class="analysis-preview-note"></div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="status-section" class="panel status-panel">
                    <div class="panel-inner">
                        <div class="panel-title">
                            <h2 class="section-heading">
                                ${renderIcon("stat.svg", "Live Snapshot", "section-icon")}
                                <span>Live Snapshot</span>
                            </h2>
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
                                <span id="sensor-coverage-copy" class="helper-text">
                                    เปอร์เซ็นต์พื้นที่สีเขียวล่าสุด
                                </span>
                            </article>
                            <article class="metric-card">
                                <span class="metric-label">Sensor Timestamp</span>
                                <strong id="sensor-timestamp">-</strong>
                                <span id="sensor-timestamp-copy" class="helper-text">
                                    เวลาที่ temp / pH ล่าสุดถูกบันทึก
                                </span>
                            </article>
                        </div>
                        <div class="summary-grid">
                            <article class="summary-card summary-card-compact">
                                <span class="card-label">Grow Cycle</span>
                                <strong id="grow-cycle-status-chip">-</strong>
                                <span id="grow-cycle-copy" class="helper-text">-</span>
                            </article>
                            <article class="summary-card summary-card-compact">
                                <span class="card-label">Next Timeseries Save</span>
                                <strong id="next-sensor-save-countdown">-</strong>
                                <span id="next-sensor-save-copy" class="helper-text">-</span>
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

                <aside id="timeseries-capture-section" class="panel timeseries-capture-panel">
                    <div class="panel-inner">
                        <article class="summary-card timeseries-progress-card">
                            <div class="summary-card-head">
                                <span class="card-label">Timeseries Progress</span>
                                <span id="timeseries-progress-chip" class="mini-chip">-</span>
                            </div>
                            <strong id="timeseries-progress-title">-</strong>
                            <span id="timeseries-progress-copy" class="helper-text">-</span>
                            <div
                                id="timeseries-progress-track"
                                class="timeseries-progress-track"
                                role="progressbar"
                                aria-label="Timeseries collection progress for 14 days"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow="0"
                            >
                                <span id="timeseries-progress-bar" class="timeseries-progress-bar"></span>
                            </div>
                            <div class="timeseries-progress-meta">
                                <span id="timeseries-progress-detail">-</span>
                                <span>เต็มเมื่อครบ 14 วัน</span>
                            </div>
                        </article>
                        <article class="summary-card actuator-status-card">
                            <div class="summary-card-head">
                                <span class="card-label">Actuator Status</span>
                            </div>
                            <div id="timeseries-actuator-status-strip" class="actuator-status-strip" aria-label="สถานะอุปกรณ์ปัจจุบัน"></div>
                            <span class="helper-text">สถานะสดของไฟ ปั๊มหลัก และปั๊มปุ๋ย 1-3</span>
                        </article>
                        <article class="summary-card timeseries-capture-card">
                            <div class="summary-card-head">
                                <span class="card-label">Timeseries Snap</span>
                                <span id="timeseries-capture-mode-chip" class="mini-chip">-</span>
                            </div>
                            <span class="helper-text">เลือกว่าจะใช้สภาพไฟเดิม หรือปิดไฟชั่วคราวก่อนเก็บข้อมูลรอบถัดไป</span>
                            <div class="timeseries-capture-actions" role="group" aria-label="Timeseries snapshot light mode">
                                <button
                                    id="timeseries-capture-keep-light-button"
                                    class="button-ghost timeseries-capture-button"
                                    type="button"
                                >
                                    เปิดไฟตามเดิม
                                </button>
                                <button
                                    id="timeseries-capture-force-off-button"
                                    class="button-ghost timeseries-capture-button"
                                    type="button"
                                >
                                    ปิดไฟก่อนถ่าย
                                </button>
                            </div>
                            <span id="timeseries-capture-copy" class="helper-text">-</span>
                            <span id="timeseries-capture-last-copy" class="helper-text timeseries-capture-last-copy">-</span>
                        </article>
                        <article class="summary-card anomaly-watch-card">
                            <div class="summary-card-head">
                                <span class="card-label">Anomaly Watch</span>
                                <span id="anomaly-watch-chip" class="mini-chip">-</span>
                            </div>
                            <strong id="anomaly-watch-title">-</strong>
                            <span id="anomaly-watch-copy" class="helper-text">-</span>
                            <span id="anomaly-watch-last-copy" class="helper-text timeseries-capture-last-copy">-</span>
                            <div id="anomaly-watch-preview-wrap" class="anomaly-watch-preview hidden">
                                <img id="anomaly-watch-preview" class="anomaly-watch-preview-image" alt="ภาพแจ้งเตือนล่าสุด">
                            </div>
                            <div id="anomaly-log-list" class="anomaly-log-list"></div>
                        </article>
                    </div>
                </aside>

                <section id="prediction-section" class="panel prediction-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2 class="section-heading">
                                    ${renderIcon("HarvestPredict.svg", "Predict Harvest", "section-icon")}
                                    <span>Predict Harvest</span>
                                </h2>
                                <p>ใช้โมเดล baseline จาก Colab เพื่อทำนายวันเก็บเกี่ยวจาก coverage, temp และ pH ปัจจุบัน</p>
                            </div>
                            <button id="prediction-preview-button" class="button-primary" type="button">
                                Predict Harvest
                            </button>
                        </div>
                        <div id="prediction-preview-summary" class="daily-highlight-grid"></div>
                        <div id="prediction-preview-copy" class="rule-card rule-empty">
                            ยังไม่มี prediction preview
                            กด Predict Harvest เพื่อคำนวณจากข้อมูลที่บันทึกล่าสุดในระบบ
                        </div>
                    </div>
                </section>

                <section class="control-grid">
                    <section id="light-section" class="panel light-control-panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3 class="section-heading">
                                    ${renderIcon("LightRelay.svg", "Light Control", "section-icon")}
                                    <span>Light Control</span>
                                </h3>
                                <p>สั่งไฟแบบ manual หรือวางรอบเปิดปิดอัตโนมัติจาก card เดียวกัน</p>
                            </div>
                            <section class="control-surface">
                                <div class="control-surface-head">
                                    <div>
                                        <span class="card-label">Manual Light</span>
                                        <strong>สั่งไฟทันที</strong>
                                    </div>
                                    <span class="helper-text">เปิดหรือปิดไฟทันทีจากการ์ดนี้</span>
                                </div>
                                <div class="control-input-grid">
                                    <label for="manual-light-status">
                                        สถานะไฟตอนนี้
                                        <div id="manual-light-status" class="control-display-field">OFF</div>
                                    </label>
                                </div>
                                <div id="light-manual-copy" class="helper-text control-surface-copy">
                                    ไฟพร้อมสั่งงาน กด Turn On หรือ Turn Off ได้ทันที
                                </div>
                                <div class="actions control-actions">
                                    <button id="light-on-button" class="button-primary" type="button">
                                        Turn On
                                    </button>
                                    <button id="light-off-button" class="button-secondary" type="button">
                                        Turn Off
                                    </button>
                                </div>
                            </section>
                            <button
                                id="light-schedule-toggle"
                                class="button-ghost schedule-section-toggle"
                                type="button"
                                aria-expanded="false"
                                aria-controls="light-schedule-content"
                            >
                                แสดงการตั้งเวลา light schedule
                            </button>
                            <div
                                id="light-schedule-content"
                                class="schedule-section-content"
                                hidden
                                style="display: none;"
                            >
                                <section class="schedule-builder scheduler-builder">
                                    <div class="schedule-builder-head">
                                        <div>
                                            <span class="card-label">Light Schedule</span>
                                            <strong>ตั้งเวลาเปิดปิดอัตโนมัติ</strong>
                                        </div>
                                        <span class="helper-text">กำหนดช่วงวันที่เริ่ม-สิ้นสุด หรือเลือกให้ทำงานเวลาเดิมทุกวัน</span>
                                    </div>
                                    <form id="light-schedule-form" class="stack scheduler-form">
                                        <label class="day-option schedule-toggle schedule-repeat-toggle">
                                            <input id="light-repeat-daily" type="checkbox">
                                            <span>ทำงานทุกวัน เวลาเดิม</span>
                                        </label>
                                        <div class="inline-fields">
                                            <label for="light-start-date">
                                                Start date
                                                <input id="light-start-date" type="date">
                                            </label>
                                            <label for="light-end-date">
                                                End date
                                                <input id="light-end-date" type="date">
                                            </label>
                                            <label for="light-on-time">
                                                On time
                                                <input id="light-on-time" type="time" value="18:00">
                                            </label>
                                            <label for="light-off-time">
                                                Off time
                                                <input id="light-off-time" type="time" value="22:00">
                                            </label>
                                        </div>
                                        <button class="button-primary schedule-submit-button" type="submit">
                                            Add Light Schedule
                                        </button>
                                    </form>
                                    <button
                                        id="light-rules-toggle"
                                        class="button-ghost schedule-rules-toggle"
                                        type="button"
                                        aria-expanded="false"
                                        aria-controls="light-rules-content"
                                    >
                                        แสดงรายการ light schedule
                                    </button>
                                    <div
                                        id="light-rules-content"
                                        class="schedule-rules-content"
                                        hidden
                                        style="display: none;"
                                    >
                                        <div id="light-rule-list" class="schedule-rule-grid"></div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </section>

                    <section id="water-section" class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3 class="section-heading">
                                    ${renderIcon("waterPump.svg", "Water Pump", "section-icon")}
                                    <span>Water Pump</span>
                                </h3>
                                <p>กรอกลิตรน้ำที่ต้องการ แล้วระบบจะคำนวณเวลาเปิดปั๊มจากอัตราไหลให้อัตโนมัติ</p>
                            </div>
                            <section class="control-surface">
                                <div class="control-surface-head">
                                    <div>
                                        <span class="card-label">Manual Water Pump</span>
                                        <strong>สั่งปั๊มน้ำทันที</strong>
                                    </div>
                                    <span class="helper-text">กรอกลิตรแล้วสั่งปั๊มได้ทันที</span>
                                </div>
                                <div class="control-input-grid">
                                    <label for="manual-water-liters">
                                        ปริมาณน้ำ (L)
                                        <input id="manual-water-liters" min="0.1" step="0.1" type="number" value="1">
                                    </label>
                                </div>
                                <div id="water-pump-helper-copy" class="helper-text control-surface-copy">
                                    อัตราไหลปั๊มน้ำ 1 L/min
                                </div>
                                <div class="actions control-actions">
                                    <button id="water-start-button" class="button-primary" type="button">
                                        Start Pump
                                    </button>
                                    <button id="water-stop-button" class="button-danger" type="button">
                                        Stop Pump
                                    </button>
                                </div>
                            </section>
                            <button
                                id="pump-water-schedule-toggle"
                                class="button-ghost schedule-section-toggle"
                                type="button"
                                aria-expanded="false"
                                aria-controls="pump-water-schedule-content"
                            >
                                แสดงการตั้งเวลา water pump schedule
                            </button>
                            <div
                                id="pump-water-schedule-content"
                                class="schedule-section-content"
                                hidden
                                style="display: none;"
                            >
                                <section class="schedule-builder scheduler-builder">
                                    <div class="schedule-builder-head">
                                        <div>
                                            <span class="card-label">Water Pump Schedule</span>
                                            <strong>ตั้งรอบให้น้ำอัตโนมัติ</strong>
                                        </div>
                                        <span class="helper-text">กำหนดช่วงวันที่เริ่ม-สิ้นสุด หรือเลือกให้ทำงานทุกวันเวลาเดิม</span>
                                    </div>
                                    <form id="pump-water-schedule-form" class="stack scheduler-form">
                                        <label class="day-option schedule-toggle schedule-repeat-toggle">
                                            <input id="pump-water-repeat-daily" type="checkbox">
                                            <span>ทำงานทุกวัน เวลาเดิม</span>
                                        </label>
                                        <div class="inline-fields">
                                            <label for="pump-water-start-date">
                                                Start date
                                                <input id="pump-water-start-date" type="date">
                                            </label>
                                            <label for="pump-water-end-date">
                                                End date
                                                <input id="pump-water-end-date" type="date">
                                            </label>
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
                                        <button class="button-primary schedule-submit-button" type="submit">
                                            Add Water Pump Schedule
                                        </button>
                                    </form>
                                    <button
                                        id="pump-water-rules-toggle"
                                        class="button-ghost schedule-rules-toggle"
                                        type="button"
                                        aria-expanded="false"
                                        aria-controls="pump-water-rules-content"
                                    >
                                        แสดงรายการ water pump schedule
                                    </button>
                                    <div
                                        id="pump-water-rules-content"
                                        class="schedule-rules-content"
                                        hidden
                                        style="display: none;"
                                    >
                                        <div id="pump-water-rule-list" class="schedule-rule-grid"></div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </section>
                </section>

                <section id="fertilizer-section" class="panel fertilizer-section-panel">
                    <div class="panel-inner">
                        <div class="panel-title">
                            <h2 class="section-heading">
                                ${renderIcon("FertilizerPumps.svg", "Fertilizer Pumps", "section-icon")}
                                <span>Fertilizer Pumps</span>
                            </h2>
                            <p>กรอกปริมาณน้ำต่อหัวปั๊ม แล้วระบบจะคำนวณเวลาเปิดปั๊มให้อัตโนมัติ</p>
                        </div>
                        <div id="pump-fertilizer-list" class="fertilizer-grid"></div>
                    </div>
                </section>

                <section class="analytics-grid">
                    <section id="timeseries-section" class="panel timeseries-panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2 class="section-heading">
                                    ${renderIcon("stat.svg", "Coverage Time Series", "section-icon")}
                                    <span>Coverage Time Series</span>
                                </h2>
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
                </section>

                <section id="timeseries-gap-section" class="panel timeseries-gap-panel">
                    <div class="panel-inner">
                        <div id="camera-gap-block" class="camera-gap-block">
                            <div class="panel-title">
                                <h2 class="section-heading">
                                    ${renderIcon("stat.svg", "Timeseries Gap Fill", "section-icon")}
                                    <span>Timeseries Gap Fill</span>
                                </h2>
                                <p>ตรวจชั่วโมงที่ขาดของรอบปลูก แล้วเติม temp/pH ย้อนหลังด้วย CSV จากการ์ดเดียว</p>
                            </div>
                            <div id="camera-gap-summary" class="analysis-preview-note"></div>
                            <button
                                id="camera-gap-toggle"
                                class="button-ghost camera-gap-toggle"
                                type="button"
                                aria-expanded="false"
                                aria-controls="camera-gap-content"
                            >
                                แสดงช่วงเวลาที่ขาดและเครื่องมือเติมข้อมูล
                            </button>
                            <div
                                id="camera-gap-content"
                                class="camera-gap-content"
                                hidden
                                style="display: none;"
                            >
                                <div class="camera-gap-tools">
                                    <button id="camera-gap-download-button" class="button-secondary" type="button">
                                        Download Gap CSV
                                    </button>
                                    <label for="camera-gap-file-input" class="camera-gap-file-field">
                                        Import Gap CSV
                                        <input
                                            id="camera-gap-file-input"
                                            type="file"
                                            accept=".csv,text/csv"
                                        >
                                    </label>
                                    <button id="camera-gap-upload-button" class="button-primary" type="button">
                                        Import Gap CSV
                                    </button>
                                </div>
                                <div id="camera-gap-copy" class="helper-text">
                                    ดาวน์โหลด CSV ช่องว่าง -> กรอก temp/pH เฉพาะชั่วโมงที่ขาด -> import กลับเข้า Mongo ได้ทันที
                                </div>
                                <div id="camera-gap-list" class="camera-gap-list"></div>
                                <section class="schedule-builder gap-import-builder">
                                    <div class="schedule-builder-head">
                                        <div>
                                            <span class="card-label">Historical temp/pH</span>
                                            <strong>Seed Cycle CSV Import</strong>
                                        </div>
                                        <span class="helper-text">
                                            ใช้เมื่ออยากเติม temp/pH ย้อนหลังทั้งชุดสำหรับ seed cycle โดยไม่ต้องเปิด Advanced DB
                                        </span>
                                    </div>
                                    <div class="panel-actions">
                                        <button id="download-template-button" class="button-secondary" type="button">
                                            ${renderIcon("ChooseFile.svg", "Download CSV Template", "button-icon")}
                                            Download CSV Template
                                        </button>
                                    </div>
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
                                            Import Historical temp/pH CSV
                                            <input
                                                id="seed-readings-file-input"
                                                type="file"
                                                accept=".csv,text/csv"
                                            >
                                        </label>
                                        <button id="upload-template-button" class="button-secondary" type="button">
                                            ${renderIcon("ChooseFile.svg", "Import CSV", "button-icon")}
                                            Import CSV
                                        </button>
                                    </div>
                                    <div id="model-data-upload-copy" class="helper-text">
                                        ดาวน์โหลด template -> กรอก temp/pH ย้อนหลัง -> import กลับเข้า Mongo สำหรับ seed cycle
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="analysis-section" class="panel analysis-hub-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2 class="section-heading">
                                    ${renderIcon("db.svg", "Model Data (Advanced)", "section-icon")}
                                    <span>Model Data (Advanced)</span>
                                </h2>
                                <p>ข้อมูลสำหรับ dataset และ workflow โมเดล ใช้เมื่อจำเป็น</p>
                            </div>
                            <div class="panel-actions">
                                <button id="export-dataset-button" class="button-primary" type="button">
                                    ${renderIcon("Export.svg", "Export Dataset", "button-icon")}
                                    Export Dataset
                                </button>
                                <button id="analysis-refresh-button" class="button-ghost" type="button">
                                    ${renderIcon("RefreshHub.svg", "Refresh Hub", "button-icon")}
                                    Refresh Hub
                                </button>
                            </div>
                        </div>
                        <div id="daily-summary-highlights" class="daily-highlight-grid"></div>
                        <button
                            id="analysis-advanced-toggle"
                            class="button-ghost analysis-advanced-toggle"
                            type="button"
                            aria-expanded="false"
                            aria-controls="analysis-advanced-content"
                        >
                            แสดงรายละเอียดโมเดลและเครื่องมือขั้นสูง
                        </button>
                        <div
                            id="analysis-advanced-content"
                            class="analysis-advanced-content"
                            hidden
                            style="display: none;"
                        >
                            <div id="analysis-preview-meta" class="history-metrics"></div>
                            <div id="analysis-process-grid" class="analysis-process-grid"></div>
                            <div id="analysis-footer-note" class="analysis-note"></div>
                        </div>
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

function formatCountdownLabel(totalSeconds: number): string {
    const safeSeconds = Math.max(0, totalSeconds)
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const seconds = safeSeconds % 60

    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, "0")}m`
    }
    if (minutes > 0) {
        return `${minutes}m ${String(seconds).padStart(2, "0")}s`
    }
    return `${seconds}s`
}

function formatInteger(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-"
    }

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
    }).format(value)
}

function getSensorIntervalSeconds(state: DashboardState | null = dashboardState): number {
    const configuredSeconds = state?.model_data?.sensor_interval_seconds
    if (configuredSeconds && Number.isFinite(configuredSeconds) && configuredSeconds > 0) {
        return configuredSeconds
    }
    return 3600
}

function formatSensorIntervalLabel(state: DashboardState | null = dashboardState): string {
    const intervalSeconds = Math.max(1, getSensorIntervalSeconds(state))
    if (intervalSeconds % 3600 === 0) {
        return `${formatInteger(intervalSeconds / 3600)} ชั่วโมง`
    }

    const totalMinutes = intervalSeconds / 60
    if (Number.isInteger(totalMinutes)) {
        return `${formatInteger(totalMinutes)} นาที`
    }

    return `${formatNumber(totalMinutes, 1)} นาที`
}

function getTimeseriesRowsPerDay(state: DashboardState | null = dashboardState): number {
    return Math.max(
        1,
        Math.round((24 * 60 * 60) / Math.max(1, getSensorIntervalSeconds(state))),
    )
}

function getNextSensorSaveDate(state: DashboardState | null = dashboardState): Date | null {
    const sensorTimestamp = state?.sensor?.timestamp
    if (!sensorTimestamp) {
        return null
    }

    const parsed = new Date(sensorTimestamp)
    if (Number.isNaN(parsed.getTime())) {
        return null
    }

    const intervalSeconds = getSensorIntervalSeconds(state)
    let targetMs = parsed.getTime() + (intervalSeconds * 1000)
    const nowMs = Date.now()

    while (targetMs <= nowMs) {
        targetMs += intervalSeconds * 1000
    }

    return new Date(targetMs)
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

function formatFullDateLabel(value: string | null | undefined): string {
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
        dateStyle: "medium",
    }).format(parsed)
}

function getTimestampDayKey(
    value: string | Date | null | undefined,
    timeZone = getResolvedTimeZone(),
): string | null {
    if (!value) {
        return null
    }

    const parsed = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return null
    }

    return getDateInputValueInTimeZone(parsed, timeZone)
}

function getResolvedTimeZone(state: DashboardState | null = dashboardState): string {
    return state?.meta.timezone || FALLBACK_TIMEZONE
}

function getDateInputValueInTimeZone(date: Date, timeZone = getResolvedTimeZone()): string {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date)

    const year = parts.find((part) => part.type === "year")?.value ?? ""
    const month = parts.find((part) => part.type === "month")?.value ?? ""
    const day = parts.find((part) => part.type === "day")?.value ?? ""

    return `${year}-${month}-${day}`
}

function getTodayScheduleDateValue(timeZone = getResolvedTimeZone()): string {
    return getDateInputValueInTimeZone(new Date(), timeZone)
}

function syncScheduleDateInputs(state: DashboardState | null = dashboardState): void {
    const today = getTodayScheduleDateValue(getResolvedTimeZone(state))

    const pairs: Array<[string, string]> = [
        ["light-start-date", "light-end-date"],
        ["pump-water-start-date", "pump-water-end-date"],
    ]

    pairs.forEach(([startId, endId]) => {
        const startInput = document.getElementById(startId) as HTMLInputElement | null
        const endInput = document.getElementById(endId) as HTMLInputElement | null
        if (!startInput || !endInput) {
            return
        }

        startInput.min = today
        if (!startInput.value || startInput.value < today) {
            startInput.value = today
        }

        endInput.min = startInput.value
        if (!endInput.value || endInput.value < startInput.value) {
            endInput.value = startInput.value
        }
    })
}

function bindScheduleDateRange(startId: string, endId: string): void {
    const startInput = document.getElementById(startId) as HTMLInputElement | null
    const endInput = document.getElementById(endId) as HTMLInputElement | null
    if (!startInput || !endInput) {
        return
    }

    const syncEndDate = () => {
        const today = getTodayScheduleDateValue()
        startInput.min = today
        if (!startInput.value || startInput.value < today) {
            startInput.value = today
        }

        endInput.min = startInput.value
        if (!endInput.value || endInput.value < startInput.value) {
            endInput.value = startInput.value
        }
    }

    startInput.addEventListener("input", syncEndDate)
    endInput.addEventListener("input", () => {
        if (endInput.value && endInput.value < startInput.value) {
            endInput.value = startInput.value
        }
    })
    syncEndDate()
}

function bindScheduleRepeatToggle(checkboxId: string, startId: string, endId: string): void {
    const checkbox = document.getElementById(checkboxId) as HTMLInputElement | null
    const startInput = document.getElementById(startId) as HTMLInputElement | null
    const endInput = document.getElementById(endId) as HTMLInputElement | null
    if (!checkbox || !startInput || !endInput) {
        return
    }

    const syncState = () => {
        const repeatDaily = checkbox.checked
        startInput.disabled = repeatDaily
        endInput.disabled = repeatDaily
        startInput.closest("label")?.classList.toggle("is-disabled", repeatDaily)
        endInput.closest("label")?.classList.toggle("is-disabled", repeatDaily)

        if (!repeatDaily) {
            const today = getTodayScheduleDateValue()
            startInput.min = today
            if (!startInput.value || startInput.value < today) {
                startInput.value = today
            }

            endInput.min = startInput.value
            if (!endInput.value || endInput.value < startInput.value) {
                endInput.value = startInput.value
            }
        }
    }

    checkbox.addEventListener("change", syncState)
    syncState()
}

function readScheduleDateRange(startId: string, endId: string): {
    startDate: string
    endDate: string
} {
    const startInput = document.getElementById(startId) as HTMLInputElement | null
    const endInput = document.getElementById(endId) as HTMLInputElement | null
    const startDate = startInput?.value?.trim() ?? ""
    const endDate = endInput?.value?.trim() ?? ""

    if (!startDate || !endDate) {
        throw new Error("กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด")
    }

    const today = getTodayScheduleDateValue()
    if (startDate < today) {
        if (startInput) {
            startInput.value = today
        }
        throw new Error("กรุณาเลือกวันที่เริ่มเป็นวันนี้หรือวันในอนาคต")
    }

    if (endDate < startDate) {
        if (endInput) {
            endInput.value = startDate
        }
        throw new Error("วันที่สิ้นสุดต้องไม่เร็วกว่าวันที่เริ่ม")
    }

    return { startDate, endDate }
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

function getTimestampValue(value: string | null | undefined): number {
    if (!value) {
        return -1
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? -1 : parsed.getTime()
}

function getFreshCoverageSnapshot(state: DashboardState): {
    value: number | null | undefined
    timestamp: string | null | undefined
    sourceLabel: string
} {
    const candidates = [
        {
            value: liveCameraAnalysis?.green_coverage_percent,
            timestamp: liveCameraAnalysis?.captured_at,
            sourceLabel: "ภาพวิเคราะห์สด",
        },
        {
            value: state.sensor?.green_coverage_percent,
            timestamp: state.sensor?.timestamp,
            sourceLabel: "แถวข้อมูลล่าสุด",
        },
        {
            value: state.image_analysis?.green_coverage_percent,
            timestamp: state.image_analysis?.timestamp,
            sourceLabel: "ภาพวิเคราะห์ล่าสุด",
        },
    ].filter(
        (candidate) =>
            candidate.value !== null && candidate.value !== undefined,
    )

    if (candidates.length === 0) {
        return {
            value: null,
            timestamp: null,
            sourceLabel: "ยังไม่มีข้อมูล coverage",
        }
    }

    candidates.sort(
        (left, right) =>
            getTimestampValue(right.timestamp) - getTimestampValue(left.timestamp),
    )
    return candidates[0]
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

function getResolvedCycleProgress(state: DashboardState | null): {
    dayIndex: number
    remainingDays: number
    targetDays: number | null
} | null {
    const cycle = state?.grow_cycle ?? null
    if (!cycle?.planted_at) {
        return null
    }

    const derivedProgress = getCycleProgress(
        cycle,
        state?.meta.generated_at ?? new Date().toISOString(),
    )
    const explicitDayIndex =
        state?.sensor?.cycle_day_index ??
        state?.daily_summary?.cycle_day_index ??
        derivedProgress?.dayIndex ??
        null
    const targetDays =
        cycle.target_harvest_days ??
        state?.sensor?.target_harvest_days ??
        state?.daily_summary?.target_harvest_days ??
        null
    const explicitRemainingDays =
        state?.sensor?.expected_days_to_harvest ??
        state?.daily_summary?.expected_days_to_harvest ??
        null
    const remainingDays = explicitRemainingDays ??
        (
            targetDays !== null && explicitDayIndex !== null
                ? Math.max(targetDays - explicitDayIndex, 0)
                : derivedProgress?.remainingDays ?? 0
        )

    if (explicitDayIndex === null) {
        return null
    }

    return {
        dayIndex: explicitDayIndex,
        remainingDays,
        targetDays,
    }
}

function getActiveCycleProgress(): {
    cycle: DashboardState["grow_cycle"]
    progress: ReturnType<typeof getResolvedCycleProgress>
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
        progress: getResolvedCycleProgress(dashboardState),
    }
}

function setCycleActionState(
    cycle: DashboardState["grow_cycle"],
    cycleProgress: ReturnType<typeof getResolvedCycleProgress>,
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

function isEverydayRule(days: string[] | null | undefined): boolean {
    if (!Array.isArray(days) || days.length !== EVERYDAY_VALUES.length) {
        return false
    }

    const selected = new Set(days)
    return EVERYDAY_VALUES.every((value) => selected.has(value))
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

function setMiniChipTone(
    element: HTMLElement,
    tone: "default" | "active" | "danger" | "warning",
): void {
    element.classList.remove("active", "danger", "warning")
    if (tone !== "default") {
        element.classList.add(tone)
    }
}

function setMiniChip(
    id: string,
    text: string,
    tone: "default" | "active" | "danger" | "warning" = "default",
): void {
    const element = $(id)
    element.textContent = text
    setMiniChipTone(element, tone)
}

function getMinutesSince(value: string | null | undefined): number | null {
    if (!value) {
        return null
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return null
    }

    const diff = Date.now() - parsed.getTime()
    return Math.max(Math.round(diff / 60000), 0)
}

function formatRelativeAge(value: string | null | undefined): string {
    const minutes = getMinutesSince(value)
    if (minutes === null) {
        return "No data"
    }
    if (minutes < 60) {
        return `${minutes} min ago`
    }
    if (minutes < 24 * 60) {
        return `${formatNumber(minutes / 60, 1)} h ago`
    }
    return `${formatNumber(minutes / (24 * 60), 1)} d ago`
}

function buildRecommendedAction(
    state: DashboardState,
    cycleProgress: ReturnType<typeof getCycleProgress>,
): {
    icon: string
    label: string
    copy: string
    href: string
} {
    const enabledLightRules = state.automation.light.filter((rule) => rule.enabled).length
    const enabledWaterRules = state.automation.pump_water.filter((rule) => rule.enabled).length
    const sensorAgeMinutes = getMinutesSince(state.sensor?.timestamp)

    if (!cycleProgress) {
        return {
            icon: "calendar.svg",
            label: "เริ่ม Grow Cycle",
            copy: "ยังไม่มี active cycle ทำให้ข้อมูลชุดใหม่ยังไม่ถูกผูกกับรอบปลูกสำหรับ prediction",
            href: "#status-section",
        }
    }

    if (sensorAgeMinutes !== null && sensorAgeMinutes > 240) {
        return {
            icon: "network.svg",
            label: "ตรวจ sensor / MQTT flow",
            copy: "ข้อมูลล่าสุดค่อนข้างเก่า ควรเช็ก ingestion ก่อนใช้ค่าชุดนี้ตัดสินใจ",
            href: "#status-section",
        }
    }

    if (enabledWaterRules === 0) {
        return {
            icon: "waterPump.svg",
            label: "ตั้ง Water Schedule",
            copy: "ตอนนี้ water pump ยังไม่มี automation rule ถ้าต้องการให้ระบบรันเองควรตั้งไว้ก่อน",
            href: "#water-section",
        }
    }

    if (enabledLightRules === 0) {
        return {
            icon: "LightRelay.svg",
            label: "ตั้ง Light Schedule",
            copy: "light relay ยังเป็น manual-first อยู่ ควรเพิ่ม schedule ถ้าต้องการให้ flow คงที่",
            href: "#light-section",
        }
    }

    if (state.model_data?.harvest_model_enabled) {
        return {
            icon: "HarvestPredict.svg",
            label: "ลอง Predict Harvest",
            copy: "เมื่อ cycle กับข้อมูลล่าสุดพร้อมแล้ว คุณสามารถ preview ความพร้อมของโมเดลและวันเก็บเกี่ยวได้ทันที",
            href: "#prediction-section",
        }
    }

    return {
        icon: "camera.svg",
        label: "ติดตามภาพสดและ time series",
        copy: "โฟลว์หลักพร้อมแล้ว ใช้ภาพสดและกราฟย้อนหลังเพื่อประเมินบ่อก่อนสั่งงานรอบถัดไป",
        href: "#camera-section",
    }
}

function renderOperatorFocus(state: DashboardState): void {
    const container = $("ops-focus-grid")
    const cycle = state.grow_cycle
    const cycleProgress = getResolvedCycleProgress(state)
    const enabledLightRules = state.automation.light.filter((rule) => rule.enabled).length
    const enabledWaterRules = state.automation.pump_water.filter((rule) => rule.enabled).length
    const sensorAgeMinutes = getMinutesSince(state.sensor?.timestamp)
    const sensorTone = sensorAgeMinutes === null
        ? "danger"
        : sensorAgeMinutes <= 90
            ? "active"
            : sensorAgeMinutes <= 240
                ? "warning"
                : "danger"
    const sensorBadge = sensorAgeMinutes === null
        ? "No Data"
        : sensorAgeMinutes <= 90
            ? "Fresh"
            : sensorAgeMinutes <= 240
                ? "Aging"
                : "Stale"
    const automationRules = enabledLightRules + enabledWaterRules
    const automationTone = automationRules > 0 ? "active" : "warning"
    const automationBadge = automationRules > 0 ? "Armed" : "Manual"
    const predictionDays = predictionPreview?.prediction?.days_to_harvest
    const predictionTone = !cycleProgress
        ? "warning"
        : predictionPreview?.readiness?.ready
            ? "active"
            : state.model_data?.harvest_model_enabled
                ? "default"
                : "danger"
    const predictionBadge = !cycleProgress
        ? "Need Cycle"
        : predictionPreview?.readiness?.ready
            ? "Predicted"
            : state.model_data?.harvest_model_enabled
                ? "Ready"
                : "Model Off"
    const predictionValue = predictionDays != null
        ? `${formatNumber(predictionDays, 1)} days left`
        : !cycleProgress
            ? "รอ active cycle"
            : state.model_data?.harvest_model_enabled
                ? "พร้อม preview"
                : "prediction disabled"
    const predictionCopy = predictionDays != null
        ? `คาดว่าจะเก็บเกี่ยวได้ประมาณ ${formatTimestamp(predictionPreview?.prediction?.predicted_harvest_at)}`
        : !cycleProgress
            ? "เริ่ม grow cycle ก่อน เพื่อให้ระบบผูกข้อมูลปัจจุบันเข้ากับรอบปลูก"
            : state.model_data?.harvest_model_enabled
                ? "backend พร้อมให้กด preview ความพร้อมและ baseline prediction"
                : "backend ยังไม่ได้เปิด harvest model ใน config"
    const recommendedAction = buildRecommendedAction(state, cycleProgress)
    const cameraTone = !state.camera.status.is_open
        ? "danger"
        : cameraWanted
            ? "active"
            : "warning"
    const cameraBadge = !state.camera.status.is_open
        ? "Camera Error"
        : cameraWanted
            ? "Live View"
            : "Paused"
    const cameraValue = !state.camera.status.is_open
        ? "ตรวจกล้อง"
        : cameraWanted
            ? "preview running"
            : "preview paused"
    const cameraCopy = state.camera.status.last_error
        ? state.camera.status.last_error
        : liveCameraAnalysis?.captured_at
            ? `Live OpenCV ล่าสุด ${formatRelativeAge(liveCameraAnalysis.captured_at)} • ${formatNumber(liveCameraAnalysis.green_coverage_percent, 2)}% coverage`
            : "ใช้ panel ด้านล่างเพื่อตรวจ raw, mask และ overlay จากเฟรมปัจจุบัน"

    const cards = [
        {
            icon: "calendar.svg",
            label: "Cycle Status",
            badge: cycleProgress ? "Active" : "Idle",
            tone: cycleProgress ? "active" : "warning",
            value: cycleProgress
                ? `DAY ${cycleProgress.dayIndex} / ${cycle?.target_harvest_days ?? "-"}`
                : "ยังไม่มี active cycle",
            copy: cycleProgress
                ? `${cycle?.name || cycle?.cycle_id || "current cycle"} • เหลือ ${cycleProgress.remainingDays} วันตามแผน`
                : "เริ่มปลูกก่อน เพื่อให้ระบบผูก sensor history, daily summary และ prediction เข้ากับรอบนี้",
            href: "#status-section",
        },
        {
            icon: "db.svg",
            label: "Sensor Freshness",
            badge: sensorBadge,
            tone: sensorTone,
            value: formatRelativeAge(state.sensor?.timestamp),
            copy: state.sensor
                ? `Temp ${formatNumber(state.sensor.temp, 1)} °C • pH ${formatNumber(state.sensor.ph, 2)} • Coverage ${formatNumber(state.sensor.green_coverage_percent, 2)}%`
                : "ยังไม่มี sensor row ล่าสุดจาก backend",
            href: "#status-section",
        },
        {
            icon: "LightRelay.svg",
            label: "Automation",
            badge: automationBadge,
            tone: automationTone,
            value: `${enabledLightRules} light • ${enabledWaterRules} water`,
            copy: `Light ${state.actuators.light.is_on ? "ON" : "OFF"} • Water ${state.actuators.pump_water.is_running ? "RUNNING" : "READY"} • Fertilizer ${state.actuators.pump_fertilizer.running_count}/${state.actuators.pump_fertilizer.pump_count} running`,
            href: "#light-section",
        },
        {
            icon: "LiveCV.svg",
            label: "Camera + Vision",
            badge: cameraBadge,
            tone: cameraTone,
            value: cameraValue,
            copy: cameraCopy,
            href: "#camera-section",
        },
        {
            icon: "HarvestPredict.svg",
            label: "Prediction",
            badge: predictionBadge,
            tone: predictionTone,
            value: predictionValue,
            copy: predictionCopy,
            href: "#prediction-section",
        },
        {
            icon: recommendedAction.icon,
            label: "Suggested Next Step",
            badge: "Action",
            tone: "default",
            value: recommendedAction.label,
            copy: recommendedAction.copy,
            href: recommendedAction.href,
        },
    ] as const

    container.innerHTML = cards.map((card) => `
        <article class="focus-card">
            <div class="focus-card-top">
                <span class="focus-card-label">
                    ${renderIcon(card.icon, card.label, "focus-card-icon")}
                    <span>${escapeHtml(card.label)}</span>
                </span>
                <span class="mini-chip ${card.tone === "default" ? "" : card.tone}">
                    ${escapeHtml(card.badge)}
                </span>
            </div>
            <strong>${escapeHtml(card.value)}</strong>
            <span class="helper-text">${escapeHtml(card.copy)}</span>
            <a class="focus-link" href="${card.href}">Open section</a>
        </article>
    `).join("")
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
    const cycleProgress = getResolvedCycleProgress(dashboardState)
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
        ? `${cycleProgress.dayIndex}/${cycleProgress.targetDays ?? cycle?.target_harvest_days ?? "-"}`
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
            <span class="card-label">Daily Rollup</span>
            <strong>${formatNumber(latestSummary?.green_coverage_avg, 2)} %</strong>
            <span class="helper-text">max ${formatNumber(latestSummary?.green_coverage_max, 2)}%</span>
            <span class="helper-text">${escapeHtml(latestSummary?.date ?? "-")}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Coverage Pipeline</span>
            <strong class="summary-compact-text">${escapeHtml(liveMethod)}</strong>
            <span class="helper-text">version ${escapeHtml(String(liveVersion))}</span>
            <span class="helper-text wrap-anywhere">${escapeHtml(pipelineCopy)}</span>
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
        ส่วนนี้เป็นเครื่องมือสำหรับ dataset และโมเดล
        ถ้าต้องการดูบ่อและควบคุมอุปกรณ์เป็นหลัก ใช้ Camera, Live Snapshot และ Control cards ด้านบนได้เลย
    `
}

function renderLightRules(rules: LightRule[]): void {
    const container = $("light-rule-list")
    const today = getTodayScheduleDateValue()
    if (rules.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี light schedule</div>`
        return
    }

    container.innerHTML = rules.map(
        (rule) => {
            const hasDateWindow = Boolean(rule.start_date || rule.end_date)
            const repeatEveryday = isEverydayRule(rule.days)
            const repeatLabel = repeatEveryday
                ? "ทุกวัน"
                : rule.days?.length
                    ? formatDays(rule.days)
                    : null
            const isPending = Boolean(rule.start_date && rule.start_date > today)
            const isEnded = Boolean(rule.end_date && rule.end_date < today)
            const statusTone = !rule.enabled ? "danger" : isEnded ? "danger" : isPending ? "warning" : "active"
            let statusText = "Enabled"
            if (!rule.enabled) {
                statusText = "Disabled"
            } else if (isEnded) {
                statusText = "Ended"
            } else if (isPending) {
                statusText = "Starts later"
            } else if (repeatEveryday) {
                statusText = "Every day"
            } else if (hasDateWindow) {
                statusText = "Active window"
            }
            const startDateLabel = rule.start_date ? formatFullDateLabel(rule.start_date) : "วันนี้"
            const endDateLabel = rule.end_date ? formatFullDateLabel(rule.end_date) : startDateLabel
            const dateWindowMarkup = hasDateWindow
                ? `
                    <div class="schedule-time-box">
                        <span>Start date</span>
                        <strong>${escapeHtml(startDateLabel)}</strong>
                    </div>
                    <div class="schedule-time-box">
                        <span>End date</span>
                        <strong>${escapeHtml(endDateLabel)}</strong>
                    </div>
                `
                : ""
            const repeatMarkup = repeatLabel
                ? `
                    <div class="schedule-time-box">
                        <span>Repeat</span>
                        <strong>${escapeHtml(repeatLabel)}</strong>
                    </div>
                `
                : ""

            return `
            <article class="schedule-rule-card">
                <div class="schedule-rule-top">
                    <div>
                        <span class="card-label">Light Schedule</span>
                        <strong>${repeatEveryday ? "เปิดปิดไฟอัตโนมัติทุกวัน" : "เปิดปิดไฟอัตโนมัติ"}</strong>
                    </div>
                    <span class="mini-chip ${statusTone}">
                        ${statusText}
                    </span>
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
                    ${repeatMarkup}
                    ${dateWindowMarkup}
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
        `
        },
    ).join("")
}

function renderPumpWaterRules(rules: PumpWaterRule[]): void {
    const container = $("pump-water-rule-list")
    const today = getTodayScheduleDateValue()
    if (rules.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี water pump schedule</div>`
        return
    }

    container.innerHTML = rules.map(
        (rule) => {
            const hasDateWindow = Boolean(rule.start_date || rule.end_date)
            const repeatEveryday = isEverydayRule(rule.days)
            const repeatLabel = repeatEveryday
                ? "ทุกวัน"
                : rule.days?.length
                    ? formatDays(rule.days)
                    : null
            const isPending = Boolean(rule.start_date && rule.start_date > today)
            const isEnded = Boolean(rule.end_date && rule.end_date < today)
            const statusTone = !rule.enabled ? "danger" : isEnded ? "danger" : isPending ? "warning" : "active"
            let statusText = "Enabled"
            if (!rule.enabled) {
                statusText = "Disabled"
            } else if (isEnded) {
                statusText = "Ended"
            } else if (isPending) {
                statusText = "Starts later"
            } else if (repeatEveryday) {
                statusText = "Every day"
            } else if (hasDateWindow) {
                statusText = "Active window"
            }
            const startDateLabel = rule.start_date ? formatFullDateLabel(rule.start_date) : "วันนี้"
            const endDateLabel = rule.end_date ? formatFullDateLabel(rule.end_date) : startDateLabel
            const dateWindowMarkup = hasDateWindow
                ? `
                    <div class="schedule-time-box">
                        <span>Start date</span>
                        <strong>${escapeHtml(startDateLabel)}</strong>
                    </div>
                    <div class="schedule-time-box">
                        <span>End date</span>
                        <strong>${escapeHtml(endDateLabel)}</strong>
                    </div>
                `
                : ""
            const repeatMarkup = repeatLabel
                ? `
                    <div class="schedule-time-box">
                        <span>Repeat</span>
                        <strong>${escapeHtml(repeatLabel)}</strong>
                    </div>
                `
                : ""

            return `
            <article class="schedule-rule-card">
                <div class="schedule-rule-top">
                    <div>
                        <span class="card-label">Water Pump Schedule</span>
                        <strong>${repeatEveryday ? "รอบให้น้ำอัตโนมัติทุกวัน" : "รอบให้น้ำอัตโนมัติ"}</strong>
                    </div>
                    <span class="mini-chip ${statusTone}">
                        ${statusText}
                    </span>
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
                    ${repeatMarkup}
                    ${dateWindowMarkup}
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
        `
        },
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
                        <div class="rule-meta">ควบคุมแยกอิสระ</div>
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
    const cycleItems = getCycleTimeseriesItems(state)
    const latestTimeseriesRow = getLatestCoverageRecord(cycleItems)
    const latestCoverageValue = latestTimeseriesRow?.green_coverage_percent ?? state.sensor?.green_coverage_percent
    const latestCycleDay = latestTimeseriesRow?.cycle_day_index ?? state.daily_summary?.cycle_day_index ?? null
    const latestTimeseriesCopy = latestTimeseriesRow?.timestamp
        ? `บันทึกล่าสุด ${formatTimestamp(latestTimeseriesRow.timestamp)}`
        : "ยังไม่มี hourly row ในรอบปลูก"
    const latestTimeseriesMeta = latestTimeseriesRow
        ? `Temp ${formatNumber(latestTimeseriesRow.temp, 1)} °C • pH ${formatNumber(latestTimeseriesRow.ph, 2)}`
        : "รอข้อมูล temp / pH / coverage จาก timeseries"

    if (!predictionPreview) {
        copyContainer.classList.add("rule-empty")
        copyContainer.classList.remove("prediction-preview-copy-compact")
        summaryContainer.innerHTML = `
            <article class="summary-card">
                <span class="card-label">Active Cycle</span>
                <strong class="summary-compact-text">${cycle?.cycle_id ? escapeHtml(cycle.cycle_id) : "No active cycle"}</strong>
                <span class="helper-text">
                    ${cycle?.target_harvest_days ? `target ${escapeHtml(String(cycle.target_harvest_days))} days` : "เริ่มรอบปลูกก่อนเพื่อให้ระบบผูกข้อมูลกับรอบนั้น"}
                </span>
            </article>
            <article class="summary-card">
                <span class="card-label">Latest Saved Coverage</span>
                <strong>${formatNumber(latestCoverageValue, 2)} %</strong>
                <span class="helper-text">${escapeHtml(latestTimeseriesCopy)}</span>
            </article>
            <article class="summary-card">
                <span class="card-label">Latest Timeseries Row</span>
                <strong>${latestCycleDay !== null ? `DAY ${escapeHtml(String(latestCycleDay))}` : "-"}</strong>
                <span class="helper-text">${escapeHtml(latestTimeseriesMeta)}</span>
            </article>
        `
        copyContainer.innerHTML = `
            กด Predict Harvest เพื่อเช็กความพร้อมของข้อมูลที่บันทึกล่าสุดและวันเก็บเกี่ยวที่คาด
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
    const coverageValue = modelInput.latest_green_coverage_percent ?? modelInput.latest_daily_image_coverage_percent
    const cycleDayLabel = cycleSnapshot.cycle_day_index != null && cycleSnapshot.target_harvest_days != null
        ? `${formatNumber(cycleSnapshot.cycle_day_index, 0)} / ${formatNumber(cycleSnapshot.target_harvest_days, 0)}`
        : "-"
    const readinessLabel = model.available
        ? (readiness.ready ? "Predicted" : "Needs more data")
        : "Model unavailable"
    const dataPoints = [
        `coverage ${formatNumber(coverageValue, 2)}%`,
        `temp ${formatNumber(modelInput.latest_temp_c, 1)} °C`,
        `pH ${formatNumber(modelInput.latest_ph, 2)}`,
    ]
    const issueText = readiness.blocking_reasons.length > 0
        ? readiness.blocking_reasons.join(" • ")
        : readiness.warnings.join(" • ")
    const compactCopy = model.available
        ? readiness.ready
            ? `อิง ${dataPoints.join(" • ")} ของรอบปลูกนี้`
            : issueText || "ข้อมูลยังไม่พร้อมพอสำหรับทำนาย"
        : `backend ยังโหลดโมเดลไม่ได้${model.error ? `: ${model.error}` : ""}`

    copyContainer.classList.remove("rule-empty")
    copyContainer.classList.add("prediction-preview-copy-compact")
    summaryContainer.innerHTML = `
        <article class="summary-card">
            <span class="card-label">Model Result</span>
            <strong>${predictedDays != null ? `${formatNumber(predictedDays, 1)} days` : model.available ? "-" : "No model"}</strong>
            <span class="helper-text">${predictedDays != null ? "คาดว่าเหลืออีกกี่วันจะเก็บเกี่ยวได้" : "รอ readiness หรือแก้ model path ก่อน"}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Predicted Harvest</span>
            <strong class="summary-compact-text">${escapeHtml(formatTimestamp(prediction.predicted_harvest_at))}</strong>
            <span class="helper-text">วันที่คาดว่าจะเก็บเกี่ยวได้จากโมเดล</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Confidence</span>
            <strong>${confidencePercent != null ? `${confidencePercent}%` : "-"}</strong>
            <span class="helper-text">
                ${cycleDayLabel !== "-" ? `day ${cycleDayLabel}` : "ยังไม่มี cycle day"}${prediction.uncertainty_days != null ? ` • ±${formatNumber(prediction.uncertainty_days, 2)} days` : ""}
            </span>
        </article>
    `

    copyContainer.innerHTML = `
        <div class="panel-badge-row">
            <span class="mini-chip ${readinessClass}">
                ${escapeHtml(readinessLabel)}
            </span>
            <span class="helper-text">${escapeHtml(model.name ?? predictionPreview.prediction_type)}</span>
        </div>
        <p class="helper-text">
            ${escapeHtml(compactCopy)}
        </p>
    `
}

function clearCameraTimer(): void {
    if (cameraRetryTimer !== undefined) {
        window.clearTimeout(cameraRetryTimer)
        cameraRetryTimer = undefined
    }
}

function clearNextSensorSaveTimer(): void {
    if (nextSensorSaveTimer !== undefined) {
        window.clearInterval(nextSensorSaveTimer)
        nextSensorSaveTimer = undefined
    }
}

function renderNextSensorSaveCountdown(state: DashboardState | null = dashboardState): void {
    const countdown = document.getElementById("next-sensor-save-countdown")
    const copy = document.getElementById("next-sensor-save-copy")
    if (!(countdown instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
        return
    }

    const nextSaveAt = getNextSensorSaveDate(state)
    if (!nextSaveAt) {
        countdown.textContent = "-"
        copy.textContent = "ยังไม่มี sensor timestamp สำหรับคำนวณรอบบันทึกถัดไป"
        return
    }

    const intervalMinutes = Math.max(1, Math.round(getSensorIntervalSeconds(state) / 60))
    const remainingSeconds = Math.max(
        0,
        Math.ceil((nextSaveAt.getTime() - Date.now()) / 1000),
    )

    countdown.textContent = formatCountdownLabel(remainingSeconds)
    copy.textContent = `บันทึกลง DB เวลา ${formatTimeOnly(nextSaveAt.toISOString())} • ทุก ${intervalMinutes} นาที`
}

function getTodayTimeseriesCount(state: DashboardState | null = dashboardState): number {
    const cycleItems = getCycleTimeseriesItems(state)
    const timeZone = getResolvedTimeZone(state)
    const todayKey = getTimestampDayKey(new Date(), timeZone)
    return cycleItems.filter((item) => (
        getTimestampDayKey(item.timestamp, timeZone) === todayKey
    )).length
}

function getCurrentCycleId(state: DashboardState | null = dashboardState): string {
    return (
        state?.grow_cycle?.cycle_id?.trim() ||
        state?.sensor?.cycle_id?.trim() ||
        ""
    )
}

function getCycleTimeseriesItems(state: DashboardState | null = dashboardState): SensorReading[] {
    const cycleId = state?.grow_cycle?.cycle_id ?? state?.sensor?.cycle_id ?? null
    const plantedAt = state?.grow_cycle?.planted_at ?? state?.sensor?.cycle_planted_at ?? null
    const plantedAtMs = getTimestampValue(plantedAt)
    const rowsPerDay = getTimeseriesRowsPerDay(state)
    const fallbackLimit = rowsPerDay * 14

    const filtered = sensorHistory.filter((item) => {
        const itemTimestampMs = getTimestampValue(item.timestamp)
        if (itemTimestampMs < 0) {
            return false
        }

        if (cycleId && item.cycle_id && item.cycle_id !== cycleId) {
            return false
        }

        if (plantedAtMs >= 0 && itemTimestampMs < plantedAtMs) {
            return false
        }

        return true
    })

    return filtered.length > 0
        ? filtered
        : sensorHistory.slice(-fallbackLimit)
}

function getCycleDayIndexForDate(
    value: Date,
    state: DashboardState | null = dashboardState,
): number | null {
    const plantedAt = state?.grow_cycle?.planted_at ?? state?.sensor?.cycle_planted_at ?? null
    if (!plantedAt) {
        return null
    }

    const plantedDate = new Date(plantedAt)
    if (Number.isNaN(plantedDate.getTime())) {
        return null
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000
    return Math.max(
        Math.floor((value.getTime() - plantedDate.getTime()) / millisecondsPerDay) + 1,
        1,
    )
}

function getTimeseriesGapAnalysis(state: DashboardState | null = dashboardState): {
    cycleId: string
    slots: Array<{
        at: Date
        label: string
        csvTimestamp: string
        dayIndex: number | null
    }>
    groups: Array<{
        startLabel: string
        endLabel: string
        count: number
        slots: Array<{
            at: Date
            label: string
            csvTimestamp: string
            dayIndex: number | null
        }>
    }>
} {
    const cycleId = getCurrentCycleId(state)
    const intervalMs = Math.max(1, getSensorIntervalSeconds(state)) * 1000
    const toleranceMs = Math.min(
        Math.max(intervalMs * 0.25, 5 * 60 * 1000),
        15 * 60 * 1000,
    )
    const items = getCycleTimeseriesItems(state)
        .map((item) => ({
            item,
            timestamp: item.timestamp ? new Date(item.timestamp) : null,
        }))
        .filter((entry) => entry.timestamp && !Number.isNaN(entry.timestamp.getTime()))
        .sort((left, right) => left.timestamp!.getTime() - right.timestamp!.getTime())

    const slots: Array<{
        at: Date
        label: string
        csvTimestamp: string
        dayIndex: number | null
    }> = []

    const pushSlotsBetween = (startMs: number, endMs: number) => {
        let candidateMs = startMs + intervalMs
        while (candidateMs < endMs - toleranceMs) {
            const candidateDate = new Date(candidateMs)
            slots.push({
                at: candidateDate,
                label: formatTimestamp(candidateDate.toISOString()),
                csvTimestamp: candidateDate.toISOString(),
                dayIndex: getCycleDayIndexForDate(candidateDate, state),
            })
            candidateMs += intervalMs
        }
    }

    if (items.length > 0) {
        const plantedAtMs = getTimestampValue(
            state?.grow_cycle?.planted_at ?? state?.sensor?.cycle_planted_at ?? null,
        )
        if (plantedAtMs >= 0) {
            pushSlotsBetween(plantedAtMs, items[0].timestamp!.getTime())
        }

        for (let index = 0; index < items.length - 1; index += 1) {
            pushSlotsBetween(
                items[index].timestamp!.getTime(),
                items[index + 1].timestamp!.getTime(),
            )
        }

        const referenceEndMs = getTimestampValue(
            state?.meta.generated_at ?? state?.sensor?.timestamp ?? null,
        )
        if (referenceEndMs >= 0) {
            pushSlotsBetween(items[items.length - 1].timestamp!.getTime(), referenceEndMs)
        }
    }

    const groups: Array<{
        startLabel: string
        endLabel: string
        count: number
        slots: typeof slots
    }> = []

    slots.forEach((slot) => {
        const previousGroup = groups[groups.length - 1]
        const previousSlot = previousGroup?.slots[previousGroup.slots.length - 1]
        if (
            previousGroup &&
            previousSlot &&
            (slot.at.getTime() - previousSlot.at.getTime()) <= intervalMs + 1000
        ) {
            previousGroup.slots.push(slot)
            previousGroup.count = previousGroup.slots.length
            previousGroup.endLabel = slot.label
            return
        }

        groups.push({
            startLabel: slot.label,
            endLabel: slot.label,
            count: 1,
            slots: [slot],
        })
    })

    return {
        cycleId,
        slots,
        groups,
    }
}

function buildTimeseriesGapCsv(state: DashboardState | null = dashboardState): {
    csvText: string
    filename: string
    slotCount: number
} | null {
    const gapAnalysis = getTimeseriesGapAnalysis(state)
    if (!gapAnalysis.cycleId || gapAnalysis.slots.length === 0) {
        return null
    }

    const header = ["timestamp_local", "temp", "ph", "cycle_id", "cycle_day_index"]
    const rows = gapAnalysis.slots.map((slot) => [
        slot.csvTimestamp,
        "",
        "",
        gapAnalysis.cycleId,
        slot.dayIndex !== null ? String(slot.dayIndex) : "",
    ])
    const csvText = [header, ...rows]
        .map((row) => row.join(","))
        .join("\n")
    const safeCycleId = gapAnalysis.cycleId.replace(/[^a-zA-Z0-9_-]+/g, "_")
    const filename = `${safeCycleId}_timeseries_gap_fill.csv`

    return {
        csvText,
        filename,
        slotCount: gapAnalysis.slots.length,
    }
}

function setCameraGapImportState(pending: boolean): void {
    const button = document.getElementById("camera-gap-upload-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending ? "Importing..." : "Import Gap CSV"
}

function renderTimeseriesGapFill(state: DashboardState | null = dashboardState): void {
    const summary = document.getElementById("camera-gap-summary")
    const list = document.getElementById("camera-gap-list")
    const copy = document.getElementById("camera-gap-copy")
    const downloadButton = document.getElementById("camera-gap-download-button") as HTMLButtonElement | null

    if (!(summary instanceof HTMLElement) || !(list instanceof HTMLElement) || !(copy instanceof HTMLElement) || !downloadButton) {
        return
    }

    const gapAnalysis = getTimeseriesGapAnalysis(state)
    const cycleItems = getCycleTimeseriesItems(state)
    const slotCount = gapAnalysis.slots.length
    const groupCount = gapAnalysis.groups.length

    downloadButton.disabled = !gapAnalysis.cycleId || slotCount === 0

    if (!gapAnalysis.cycleId) {
        summary.textContent = "ยังไม่มีรอบปลูก active สำหรับตรวจว่าชั่วโมงไหนของ timeseries หายไป"
        copy.textContent = "เริ่มรอบปลูกก่อน แล้วระบบจะแสดงช่องว่างของข้อมูลรายชั่วโมงให้เติมได้ตรงนี้"
        list.innerHTML = `<div class="rule-card rule-empty">ยังไม่มีรอบปลูกสำหรับตรวจ gap</div>`
        return
    }

    if (cycleItems.length === 0) {
        summary.textContent = "ยังไม่มีแถว timeseries ของรอบปลูกนี้พอสำหรับตรวจช่องว่าง"
        copy.textContent = "เมื่อมีข้อมูลรายชั่วโมงอย่างน้อย 1 จุด ระบบจะเริ่มคำนวณ gap ให้ทันที"
        list.innerHTML = `<div class="rule-card rule-empty">ยังไม่มีข้อมูลรายชั่วโมงของรอบปลูกนี้</div>`
        return
    }

    if (slotCount === 0) {
        summary.textContent = "ยังไม่พบชั่วโมงที่ขาดของรอบปลูกนี้จากข้อมูลที่โหลดอยู่ตอนนี้"
        copy.textContent = "ถ้ามีการขาดช่วงในอนาคต ระบบจะแสดงรายการ gap ตรงนี้และให้ดาวน์โหลด CSV ไปกรอก temp/pH ได้ทันที"
        list.innerHTML = `<div class="rule-card rule-empty">ยังไม่พบ gap ของข้อมูลรายชั่วโมง</div>`
        return
    }

    summary.textContent = `พบช่องว่าง ${formatInteger(slotCount)} ชั่วโมง จาก ${formatInteger(groupCount)} ช่วง ของรอบปลูกนี้`
    copy.textContent = "ดาวน์โหลด CSV ช่องว่าง -> กรอก temp/pH เฉพาะชั่วโมงที่หาย -> import กลับเข้า Mongo ได้ทันที"

    list.innerHTML = gapAnalysis.groups
        .slice(0, 8)
        .map((group, index) => {
            const visibleSlots = group.slots.slice(0, 10)
            const extraCount = group.slots.length - visibleSlots.length
            return `
                <article class="rule-card gap-card">
                    <div class="gap-card-head">
                        <strong>Gap ${index + 1}</strong>
                        <span class="mini-chip warning">ขาด ${formatInteger(group.count)} ชั่วโมง</span>
                    </div>
                    <div class="helper-text">${escapeHtml(group.startLabel)} - ${escapeHtml(group.endLabel)}</div>
                    <div class="gap-chip-list">
                        ${visibleSlots.map((slot) => `<span class="gap-chip">${escapeHtml(slot.label)}</span>`).join("")}
                        ${extraCount > 0 ? `<span class="gap-chip gap-chip-muted">+ อีก ${formatInteger(extraCount)} ชั่วโมง</span>` : ""}
                    </div>
                </article>
            `
        })
        .join("")

    if (gapAnalysis.groups.length > 8) {
        list.innerHTML += `
            <div class="rule-card rule-empty">
                ยังมี gap เพิ่มอีก ${formatInteger(gapAnalysis.groups.length - 8)} ช่วง
                ดาวน์โหลด CSV เพื่อดูรายการชั่วโมงที่ขาดทั้งหมดได้
            </div>
        `
    }
}

function renderTimeseriesProgressSummary(state: DashboardState | null = dashboardState): void {
    const title = document.getElementById("timeseries-progress-title")
    const chip = document.getElementById("timeseries-progress-chip")
    const copy = document.getElementById("timeseries-progress-copy")
    const detail = document.getElementById("timeseries-progress-detail")
    const track = document.getElementById("timeseries-progress-track")
    const bar = document.getElementById("timeseries-progress-bar")

    if (
        !(title instanceof HTMLElement) ||
        !(chip instanceof HTMLElement) ||
        !(copy instanceof HTMLElement) ||
        !(detail instanceof HTMLElement) ||
        !(track instanceof HTMLElement) ||
        !(bar instanceof HTMLElement)
    ) {
        return
    }

    const rowsPerDay = getTimeseriesRowsPerDay(state)
    const maxRows = rowsPerDay * 14
    const cycleItems = getCycleTimeseriesItems(state)
    const rowsInWindow = Math.max(
        0,
        Math.min(
            cycleItems.length,
            maxRows,
        ),
    )
    const todayRows = Math.max(0, getTodayTimeseriesCount(state))
    const collectedDays = rowsInWindow / rowsPerDay
    const displayDays = Math.min(collectedDays, 14)
    const progressPercent = Math.max(0, Math.min((rowsInWindow / maxRows) * 100, 100))
    const intervalLabel = formatSensorIntervalLabel(state)

    chip.textContent = `วันนี้ ${formatInteger(todayRows)}/${formatInteger(rowsPerDay)} รอบ`
    track.setAttribute("aria-valuenow", progressPercent.toFixed(0))
    bar.style.width = `${progressPercent}%`
    detail.textContent = `${formatNumber(displayDays, displayDays >= 3 ? 1 : 2)} / 14 วัน`

    if (rowsInWindow <= 0) {
        title.textContent = "ยังไม่มีข้อมูลสะสม"
        copy.textContent = `เมื่อเริ่มบันทึก temp/pH ทุก ${intervalLabel} หลอดนี้จะค่อย ๆ เต็มจากข้อมูลของรอบปลูกนี้`
        return
    }

    if (rowsInWindow < rowsPerDay) {
        title.textContent = `วันนี้เก็บแล้ว ${formatInteger(todayRows)}/${formatInteger(rowsPerDay)} รอบ`
        copy.textContent = `อิงเฉพาะรอบปลูกนี้ • สะสมแล้ว ${formatInteger(rowsInWindow)}/${formatInteger(maxRows)} รอบ`
        return
    }

    if (rowsInWindow < rowsPerDay * 7) {
        title.textContent = `สะสมข้อมูลรายชั่วโมงแล้ว ${formatNumber(displayDays, displayDays >= 3 ? 1 : 2)} วัน`
        copy.textContent = `อิงเฉพาะรอบปลูกนี้ • วันนี้เก็บเพิ่ม ${formatInteger(todayRows)}/${formatInteger(rowsPerDay)} รอบ`
        return
    }

    if (rowsInWindow < maxRows) {
        title.textContent = `สะสมข้อมูลรายชั่วโมงแล้ว ${formatNumber(displayDays / 7, 2)} สัปดาห์`
        copy.textContent = `อิงเฉพาะรอบปลูกนี้ • วันนี้เก็บเพิ่ม ${formatInteger(todayRows)}/${formatInteger(rowsPerDay)} รอบ`
        return
    }

    title.textContent = "สะสมข้อมูลรายชั่วโมงครบ 14 วันแล้ว"
    copy.textContent = `อิงเฉพาะรอบปลูกนี้ • วันนี้เก็บเพิ่ม ${formatInteger(todayRows)}/${formatInteger(rowsPerDay)} รอบ`
}

function ensureNextSensorSaveTimer(): void {
    clearNextSensorSaveTimer()
    renderNextSensorSaveCountdown()
    nextSensorSaveTimer = window.setInterval(() => {
        renderNextSensorSaveCountdown()
    }, 1000)
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

function setAnalysisAdvancedOpenState(open: boolean): void {
    analysisAdvancedOpen = open
    const button = document.getElementById("analysis-advanced-toggle") as HTMLButtonElement | null
    const content = document.getElementById("analysis-advanced-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนรายละเอียดโมเดลและเครื่องมือขั้นสูง"
        : "แสดงรายละเอียดโมเดลและเครื่องมือขั้นสูง"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
}

function setLiveAnalysisOpenState(open: boolean): void {
    liveAnalysisOpen = open
    const button = document.getElementById("live-analysis-toggle") as HTMLButtonElement | null
    const content = document.getElementById("live-analysis-content") as HTMLDivElement | null
    const shell = document.getElementById("live-analysis-shell") as HTMLDivElement | null
    const cameraSection = document.getElementById("camera-section") as HTMLElement | null
    if (!button || !content || !shell || !cameraSection) {
        return
    }

    button.textContent = open
        ? "ซ่อนภาพตรวจสอบ OpenCV"
        : "แสดงภาพตรวจสอบ OpenCV"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
    shell.hidden = !open
    shell.style.display = open ? "grid" : "none"
    shell.setAttribute("aria-hidden", open ? "false" : "true")
    cameraSection.classList.toggle("live-analysis-open", open)
}

function setCameraGapOpenState(open: boolean): void {
    cameraGapOpen = open
    const button = document.getElementById("camera-gap-toggle") as HTMLButtonElement | null
    const content = document.getElementById("camera-gap-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนช่วงเวลาที่ขาดและเครื่องมือเติมข้อมูล"
        : "แสดงช่วงเวลาที่ขาดและเครื่องมือเติมข้อมูล"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
}

function setLightScheduleOpenState(open: boolean): void {
    lightScheduleOpen = open
    const button = document.getElementById("light-schedule-toggle") as HTMLButtonElement | null
    const content = document.getElementById("light-schedule-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนการตั้งเวลา light schedule"
        : "แสดงการตั้งเวลา light schedule"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
}

function setPumpWaterScheduleOpenState(open: boolean): void {
    pumpWaterScheduleOpen = open
    const button = document.getElementById("pump-water-schedule-toggle") as HTMLButtonElement | null
    const content = document.getElementById("pump-water-schedule-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนการตั้งเวลา water pump schedule"
        : "แสดงการตั้งเวลา water pump schedule"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
}

function setLightRulesOpenState(open: boolean): void {
    lightRulesOpen = open
    const button = document.getElementById("light-rules-toggle") as HTMLButtonElement | null
    const content = document.getElementById("light-rules-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนรายการ light schedule"
        : "แสดงรายการ light schedule"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
}

function setPumpWaterRulesOpenState(open: boolean): void {
    pumpWaterRulesOpen = open
    const button = document.getElementById("pump-water-rules-toggle") as HTMLButtonElement | null
    const content = document.getElementById("pump-water-rules-content") as HTMLDivElement | null
    if (!button || !content) {
        return
    }

    button.textContent = open
        ? "ซ่อนรายการ water pump schedule"
        : "แสดงรายการ water pump schedule"
    button.setAttribute("aria-expanded", open ? "true" : "false")
    button.classList.toggle("open", open)
    content.hidden = !open
    content.style.display = open ? "grid" : "none"
    content.setAttribute("aria-hidden", open ? "false" : "true")
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
    button.textContent = pending ? "Preparing..." : "Download CSV Template"
}

function setDatasetImportState(pending: boolean): void {
    const button = document.getElementById("upload-template-button") as HTMLButtonElement | null
    if (!button) {
        return
    }

    button.disabled = pending
    button.textContent = pending ? "Importing..." : "Import CSV"
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

    roiBox.classList.add("hidden")
}

function renderLiveCameraAnalysis(): void {
    const meta = $("live-analysis-meta")
    const strip = $("live-analysis-strip")

    if (!liveCameraAnalysis) {
        meta.textContent =
            "กำลังรอเฟรมสดเพื่อแสดง Current Snapshot, Binary Mask และ Green Overlay"
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

    meta.textContent =
        "แสดงเฉพาะภาพปัจจุบัน, binary mask และ green overlay ของเฟรมสดเพื่อช่วยเช็กคุณภาพการแยกพื้นที่สีเขียว"

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
            renderLiveSnapshot(dashboardState)
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

function renderLiveSnapshot(state: DashboardState): void {
    const sensor = state.sensor
    const light = state.actuators.light
    const cycle = state.grow_cycle
    const cycleProgress = getResolvedCycleProgress(state)
    const coverageSnapshot = getFreshCoverageSnapshot(state)
    const cycleName = cycle?.name?.trim() || state.sensor?.cycle_name?.trim() || "รอบปลูกปัจจุบัน"
    const targetDays =
        cycleProgress?.targetDays ??
        cycle?.target_harvest_days ??
        state.sensor?.target_harvest_days ??
        null

    $("sensor-temp").textContent = `${formatNumber(sensor?.temp)} °C`
    $("sensor-ph").textContent = formatNumber(sensor?.ph, 2)
    $("sensor-coverage").textContent = `${formatNumber(coverageSnapshot.value, 2)} %`
    $("sensor-coverage-copy").textContent = coverageSnapshot.timestamp
        ? `${coverageSnapshot.sourceLabel} • ${formatTimeOnly(coverageSnapshot.timestamp)}`
        : coverageSnapshot.sourceLabel
    $("sensor-timestamp").textContent = formatTimestamp(sensor?.timestamp)
    $("sensor-timestamp-copy").textContent = sensor?.timestamp
        ? "อ้างอิงค่า temp / pH ล่าสุดในระบบ"
        : "ยังไม่มีข้อมูล temp / pH ล่าสุด"
    renderTimeseriesCapturePolicy(state)
    renderTimeseriesActuatorStatus(state)
    renderNextSensorSaveCountdown(state)
    renderTimeseriesProgressSummary(state)

    const manualLightStatus = document.getElementById("manual-light-status")
    if (manualLightStatus) {
        manualLightStatus.textContent = light.is_on ? "ON" : "OFF"
    }
    const manualLightCopy = document.getElementById("light-manual-copy")
    if (manualLightCopy) {
        manualLightCopy.textContent = light.is_on
            ? "ไฟกำลังทำงานอยู่ กด Turn Off ได้ทันที"
            : "ไฟพร้อมสั่งงาน กด Turn On ได้ทันที"
    }

    $("grow-cycle-status-chip").textContent = cycleProgress
        ? `DAY ${cycleProgress.dayIndex}/${targetDays ?? "-"}`
        : "IDLE"
    $("grow-cycle-copy").textContent = cycleProgress
        ? `${cycleName} • เหลือ ${cycleProgress.remainingDays} วันตามแผน`
        : "ยังไม่มีรอบปลูก active อยู่"
    setCycleActionState(cycle, cycleProgress)
}

function renderTimeseriesCapturePolicy(state: DashboardState): void {
    const chip = document.getElementById("timeseries-capture-mode-chip")
    const copy = document.getElementById("timeseries-capture-copy")
    const lastCopy = document.getElementById("timeseries-capture-last-copy")
    const keepButton = document.getElementById("timeseries-capture-keep-light-button") as HTMLButtonElement | null
    const forceOffButton = document.getElementById("timeseries-capture-force-off-button") as HTMLButtonElement | null
    if (
        !(chip instanceof HTMLElement)
        || !(copy instanceof HTMLElement)
        || !(lastCopy instanceof HTMLElement)
        || !keepButton
        || !forceOffButton
    ) {
        return
    }

    const policy = state.model_data?.timeseries_capture ?? null
    const mode = policy?.mode === "keep_light_state" ? "keep_light_state" : "force_light_off"
    const settleSeconds = Math.max(Number(policy?.light_settle_seconds ?? 0), 0)
    const latestSaved = state.image_analysis

    chip.textContent = mode === "force_light_off" ? "ปิดไฟชั่วคราว" : "เปิดไฟตามเดิม"
    chip.className = `mini-chip ${mode === "force_light_off" ? "warning" : "active"}`
    copy.textContent = mode === "force_light_off"
        ? `รอบบันทึก timeseries ถัดไปจะปิดไฟชั่วคราว${settleSeconds > 0 ? ` รอ ${formatNumber(settleSeconds, 0)} วินาที` : ""} แล้วค่อยเปิดกลับหลังถ่าย`
        : "รอบบันทึก timeseries ถัดไปจะใช้สภาพไฟปัจจุบันแล้วบันทึกทันที"

    if (latestSaved?.timestamp) {
        const latestCoverage = latestSaved.green_coverage_percent
        const latestAction = latestSaved.light_forced_off_for_capture
            ? `วิเคราะห์ล่าสุด ${formatTimestamp(latestSaved.timestamp)} • ปิดไฟก่อนถ่าย${latestSaved.light_restored_after_capture ? " และเปิดไฟกลับแล้ว" : ""}`
            : `วิเคราะห์ล่าสุด ${formatTimestamp(latestSaved.timestamp)} • ใช้สภาพไฟเดิม`
        const latestSensorSave = state.sensor?.timestamp
            ? `DB sensor ล่าสุด ${formatTimestamp(state.sensor.timestamp)}`
            : "ยังไม่มีข้อมูล sensor ที่บันทึกล่าสุด"
        const latestCoverageCopy = latestCoverage === null || latestCoverage === undefined
            ? latestAction
            : `${latestAction} • coverage ${formatNumber(latestCoverage, 2)}%`
        lastCopy.textContent = `${latestCoverageCopy} • ${latestSensorSave}`
    } else {
        lastCopy.textContent = "ยังไม่มีข้อมูลบันทึกล่าสุดให้ตรวจสอบ"
    }

    keepButton.classList.toggle("is-selected", mode === "keep_light_state")
    forceOffButton.classList.toggle("is-selected", mode === "force_light_off")
    keepButton.disabled = timeseriesCapturePolicyPending || mode === "keep_light_state"
    forceOffButton.disabled = timeseriesCapturePolicyPending || mode === "force_light_off"
    keepButton.textContent = timeseriesCapturePolicyPending && mode !== "keep_light_state"
        ? "กำลังบันทึก..."
        : "เปิดไฟตามเดิม"
    forceOffButton.textContent = timeseriesCapturePolicyPending && mode !== "force_light_off"
        ? "กำลังบันทึก..."
        : "ปิดไฟก่อนถ่าย"
}

function renderTimeseriesActuatorStatus(state: DashboardState): void {
    const container = document.getElementById("timeseries-actuator-status-strip")
    if (!(container instanceof HTMLElement)) {
        return
    }

    const fertilizerStatusById = new Map(
        (state.actuators.pump_fertilizer.pumps ?? []).map((pump) => [pump.id, pump.is_running]),
    )
    const items = [
        {
            key: "light",
            label: "ไฟ",
            icon: "LightRelay.svg",
            isActive: state.actuators.light.is_on,
            stateLabel: state.actuators.light.is_on ? "ON" : "OFF",
        },
        {
            key: "water-main",
            label: "หลัก",
            icon: "waterPump.svg",
            isActive: state.actuators.pump_water.is_running,
            stateLabel: state.actuators.pump_water.is_running ? "RUN" : "IDLE",
        },
        ...[1, 2, 3].map((pumpId) => {
            const isActive = Boolean(fertilizerStatusById.get(pumpId))
            return {
                key: `fert-${pumpId}`,
                label: `P${pumpId}`,
                icon: "FertilizerPumps.svg",
                isActive,
                stateLabel: isActive ? "RUN" : "IDLE",
            }
        }),
    ]

    container.innerHTML = items
        .map(
            (item) => `
                <div
                    class="actuator-status-item ${item.isActive ? "is-active" : "is-idle"}"
                    title="${escapeHtml(`${item.label}: ${item.stateLabel}`)}"
                    aria-label="${escapeHtml(`${item.label}: ${item.stateLabel}`)}"
                >
                    <span class="actuator-status-badge">
                        <img
                            src="/assets/icon/${item.icon}"
                            class="actuator-status-icon"
                            alt=""
                            aria-hidden="true"
                        >
                    </span>
                    <span class="actuator-status-name">${escapeHtml(item.label)}</span>
                </div>
            `,
        )
        .join("")
}

function renderAnomalyWatch(state: DashboardState): void {
    const chip = document.getElementById("anomaly-watch-chip")
    const title = document.getElementById("anomaly-watch-title")
    const copy = document.getElementById("anomaly-watch-copy")
    const lastCopy = document.getElementById("anomaly-watch-last-copy")
    const previewWrap = document.getElementById("anomaly-watch-preview-wrap")
    const previewImage = document.getElementById("anomaly-watch-preview")
    const logList = document.getElementById("anomaly-log-list")
    if (
        !(chip instanceof HTMLElement)
        || !(title instanceof HTMLElement)
        || !(copy instanceof HTMLElement)
        || !(lastCopy instanceof HTMLElement)
        || !(previewWrap instanceof HTMLElement)
        || !(previewImage instanceof HTMLImageElement)
        || !(logList instanceof HTMLElement)
    ) {
        return
    }

    const anomalyState = anomalyWatchState ?? state.anomaly_watch ?? null
    const status = anomalyState?.status ?? null
    const latestAlert = anomalyAlerts[0] ?? anomalyState?.latest_alert ?? null
    if (!status) {
        chip.textContent = "-"
        chip.className = "mini-chip"
        title.textContent = "ยังไม่มี anomaly watcher"
        copy.textContent = "backend ยังไม่ส่งสถานะ watcher มา"
        lastCopy.textContent = "-"
        previewWrap.classList.add("hidden")
        previewImage.removeAttribute("src")
        logList.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี anomaly log</div>`
        return
    }

    const enabled = Boolean(status.enabled)
    const running = Boolean(status.running)
    const webhookConfigured = Boolean(status.webhook_configured)
    const recentAlerts = Number(status.recent_alerts_24h ?? 0)
    const pollSeconds = Number(status.poll_seconds ?? 0)
    const minAreaPercent = Number(status.min_area_percent ?? 0)
    const hasError = Boolean(status.last_error)
    const latestPreviewUrl = anomalyState?.latest_preview_url ?? null
    const latestPreviewToken = anomalyState?.latest_preview_token ?? latestAlert?._id ?? latestAlert?.detected_at ?? ""

    if (hasError) {
        chip.textContent = "มีปัญหา"
        chip.className = "mini-chip danger"
        title.textContent = "Anomaly watcher มีข้อผิดพลาด"
    } else if (!enabled) {
        chip.textContent = "ปิดอยู่"
        chip.className = "mini-chip warning"
        title.textContent = "หยุดเฝ้าดูสิ่งแปลกปลอมชั่วคราว"
    } else if (running) {
        chip.textContent = webhookConfigured ? "Webhook พร้อม" : "เก็บ local"
        chip.className = "mini-chip active"
        title.textContent = recentAlerts > 0
            ? `พบ alert ใน 24 ชม. ล่าสุด ${formatNumber(recentAlerts, 0)} ครั้ง`
            : "กำลังเฝ้าดูภาพสดอยู่"
    } else {
        chip.textContent = "ไม่ทำงาน"
        chip.className = "mini-chip danger"
        title.textContent = "Anomaly watcher ยังไม่เริ่มทำงาน"
    }

    copy.textContent = [
        pollSeconds > 0 ? `ตรวจทุก ${formatNumber(pollSeconds, 0)} วินาที` : null,
        minAreaPercent > 0 ? `แจ้งเมื่อ blob เกิน ${formatNumber(minAreaPercent, 1)}%` : null,
        webhookConfigured ? "มี webhook แล้ว" : "เก็บเฉพาะ text log",
        "ไม่บันทึกไฟล์ภาพลงระบบ",
    ].filter(Boolean).join(" • ")

    if (latestPreviewUrl && latestAlert?.detected_at) {
        previewWrap.classList.remove("hidden")
        const cacheToken = encodeURIComponent(String(latestPreviewToken))
        previewImage.src = `${latestPreviewUrl}?t=${cacheToken}`
    } else {
        previewWrap.classList.add("hidden")
        previewImage.removeAttribute("src")
    }

    if (hasError) {
        lastCopy.textContent = String(status.last_error || "-")
    } else if (latestAlert?.detected_at) {
        const blobPercent = latestAlert.largest_blob_percent
        lastCopy.textContent = [
            `ล่าสุด ${formatTimestamp(latestAlert.detected_at)}`,
            blobPercent !== null && blobPercent !== undefined
                ? `blob ${formatNumber(blobPercent, 2)}%`
                : null,
            latestAlert.summary_text || "บันทึกเป็น text log แล้ว",
        ].filter(Boolean).join(" • ")
    } else if (status.last_checked_at) {
        lastCopy.textContent = `เช็กล่าสุด ${formatTimestamp(status.last_checked_at)} • ยังไม่พบ alert`
    } else {
        lastCopy.textContent = "กำลังรอ baseline รอบแรกจากกล้อง"
    }

    renderAnomalyLog(logList, anomalyAlerts)
}

function renderAnomalyLog(container: HTMLElement, alerts: AnomalyAlert[]): void {
    if (alerts.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี anomaly log</div>`
        return
    }

    container.innerHTML = alerts
        .slice(0, 5)
        .map((alert) => {
            const severity = Number(alert.largest_blob_percent ?? 0) >= 5 ? "danger" : "warning"
            const summary = alert.summary_text || "ตรวจพบสิ่งแปลกปลอม"
            return `
                <article class="anomaly-log-item">
                    <div class="anomaly-log-head">
                        <span class="mini-chip ${severity}">
                            ${escapeHtml(`blob ${formatNumber(alert.largest_blob_percent, 2)}%`)}
                        </span>
                        <span class="helper-text">${escapeHtml(formatTimestamp(alert.detected_at))}</span>
                    </div>
                    <strong>${escapeHtml(summary)}</strong>
                </article>
            `
        })
        .join("")
}

function queueAnomalyRefresh(delayMs = ANOMALY_POLL_MS): void {
    if (document.hidden) {
        if (anomalyPollTimer !== undefined) {
            window.clearTimeout(anomalyPollTimer)
        }
        return
    }

    if (anomalyPollTimer !== undefined) {
        window.clearTimeout(anomalyPollTimer)
    }
    anomalyPollTimer = window.setTimeout(() => {
        void refreshAnomalyWatchFast()
    }, delayMs)
}

async function refreshAnomalyWatchFast(): Promise<void> {
    if (anomalyPollPending) {
        return
    }

    anomalyPollPending = true
    try {
        const [statusResponse, alertsResponse] = await Promise.all([
            fetchAnomalyWatchStatus(),
            fetchAnomalyAlerts(5),
        ])
        anomalyWatchState = {
            status: statusResponse.watcher,
            latest_alert: statusResponse.latest_alert ?? alertsResponse.items[0] ?? null,
            latest_preview_url: statusResponse.latest_preview_url ?? null,
            latest_preview_token: statusResponse.latest_preview_token ?? null,
        }
        anomalyAlerts = alertsResponse.items

        const newestAlertId = alertsResponse.items[0]?._id ?? null
        if (!anomalyAlertPrimed) {
            lastSeenAnomalyAlertId = newestAlertId
            anomalyAlertPrimed = true
        } else if (newestAlertId && newestAlertId !== lastSeenAnomalyAlertId) {
            lastSeenAnomalyAlertId = newestAlertId
            setMessage(
                alertsResponse.items[0]?.summary_text || "ตรวจพบสิ่งแปลกปลอมในบ่อ",
                "error",
            )
        }

        if (dashboardState) {
            renderAnomalyWatch(dashboardState)
        }
    } catch {
        // keep the last rendered anomaly state
    } finally {
        anomalyPollPending = false
        queueAnomalyRefresh(ANOMALY_POLL_MS)
    }
}

function renderDashboard(state: DashboardState): void {
    const fertilizer = state.actuators.pump_fertilizer

    $("timezone-chip").textContent = `TZ: ${state.meta.timezone}`
    $("generated-at").textContent = formatTimestamp(state.meta.generated_at)
    syncScheduleDateInputs(state)

    const seedCycleInput = document.getElementById("seed-cycle-id-input") as HTMLInputElement | null
    const modelDataCopy = document.getElementById("model-data-upload-copy") as HTMLElement | null
    const latestSeedCycleId = state.model_data?.latest_seed_cycle_id ?? ""
    if (seedCycleInput && !seedCycleInput.value.trim() && latestSeedCycleId) {
        seedCycleInput.value = latestSeedCycleId
    }
    if (modelDataCopy) {
        modelDataCopy.textContent = latestSeedCycleId
            ? `seed cycle ล่าสุด: ${latestSeedCycleId} • ดาวน์โหลด template -> กรอก temp/pH ย้อนหลัง -> import กลับเข้า Mongo`
            : "ดาวน์โหลด template -> กรอก temp/pH ย้อนหลัง -> import กลับเข้า Mongo สำหรับ seed cycle"
    }

    renderLiveSnapshot(state)

    renderLightRules(state.automation.light)
    renderPumpWaterRules(state.automation.pump_water)
    renderFertilizerPumps(fertilizer.pumps)
    renderWaterPumpHelper(state)
    renderSensorCharts(sensorHistory)
    renderTimeseriesGapFill(state)
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
    renderAnomalyWatch(state)

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
            fetchSensorHistory(336),
            fetchDailySummaryHistory(14),
        ])
        dashboardState = state
        sensorHistory = sensorHistoryResponse.items
        dailySummaryHistory = dailySummaryResponse.items
        anomalyWatchState = state.anomaly_watch ?? null
        if (!anomalyAlertPrimed) {
            lastSeenAnomalyAlertId = state.anomaly_watch?.latest_alert?._id ?? null
            anomalyAlertPrimed = true
        }
        anomalyAlerts = state.anomaly_watch?.latest_alert
            ? [state.anomaly_watch.latest_alert]
            : []
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
    setAnalysisAdvancedOpenState(false)
    setCameraGapOpenState(false)
    setLiveAnalysisOpenState(false)
    setLightScheduleOpenState(false)
    setPumpWaterScheduleOpenState(false)
    setLightRulesOpenState(false)
    setPumpWaterRulesOpenState(false)
    setDatasetExportState(false)
    setDatasetImportState(false)
    setCameraGapImportState(false)
    setTemplateDownloadState(false)
    setPredictionPreviewState(false)
    ensureNextSensorSaveTimer()
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

    $("live-analysis-toggle").addEventListener("click", () => {
        setLiveAnalysisOpenState(!liveAnalysisOpen)
    })

    $("camera-gap-toggle").addEventListener("click", () => {
        setCameraGapOpenState(!cameraGapOpen)
    })

    $("light-schedule-toggle").addEventListener("click", () => {
        setLightScheduleOpenState(!lightScheduleOpen)
    })

    $("pump-water-schedule-toggle").addEventListener("click", () => {
        setPumpWaterScheduleOpenState(!pumpWaterScheduleOpen)
    })

    $("light-rules-toggle").addEventListener("click", () => {
        setLightRulesOpenState(!lightRulesOpen)
    })

    $("pump-water-rules-toggle").addEventListener("click", () => {
        setPumpWaterRulesOpenState(!pumpWaterRulesOpen)
    })

    $("camera-gap-download-button").addEventListener("click", () => {
        const exportMeta = buildTimeseriesGapCsv(dashboardState)
        if (!exportMeta) {
            setMessage("ยังไม่มีชั่วโมงที่ขาดให้ดาวน์โหลดเป็น CSV", "error")
            return
        }

        triggerBlobDownload(
            new Blob([exportMeta.csvText], { type: "text/csv;charset=utf-8" }),
            exportMeta.filename,
        )
        setMessage(`ดาวน์โหลด CSV ช่องว่างแล้ว (${exportMeta.slotCount} ชั่วโมง)`)
    })

    $("camera-gap-upload-button").addEventListener("click", async () => {
        if (gapImportPending) {
            return
        }

        const cycleId = getCurrentCycleId(dashboardState)
        const fileInput = document.getElementById("camera-gap-file-input") as HTMLInputElement | null
        const file = fileInput?.files?.[0]

        if (!cycleId) {
            setMessage("ยังไม่มี cycle_id สำหรับ import gap CSV", "error")
            return
        }

        if (!file) {
            setMessage("กรุณาเลือกไฟล์ Gap CSV ก่อน import", "error")
            return
        }

        gapImportPending = true
        setCameraGapImportState(true)
        try {
            const csvText = await file.text()
            const result = await importTimeseriesGapCsv({
                cycle_id: cycleId,
                csv_text: csvText,
                filename: file.name,
                skip_blank_rows: true,
            })
            const rowsCreated = result.import_result?.rows_created ?? 0
            const rowsUpdated = result.import_result?.rows_updated ?? 0
            await refreshDashboard(true)
            if (dashboardState) {
                renderDashboard(dashboardState)
            }
            if (fileInput) {
                fileInput.value = ""
            }
            setMessage(`import gap CSV แล้ว (create ${rowsCreated} / update ${rowsUpdated})`)
        } catch (error) {
            const text = error instanceof Error ? error.message : "import gap CSV ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            gapImportPending = false
            setCameraGapImportState(false)
        }
    })

    $("analysis-advanced-toggle").addEventListener("click", () => {
        setAnalysisAdvancedOpenState(!analysisAdvancedOpen)
    })

    window.addEventListener("pageshow", () => {
        setCameraGapOpenState(false)
        setLiveAnalysisOpenState(false)
        setAnalysisAdvancedOpenState(false)
        setLightScheduleOpenState(false)
        setPumpWaterScheduleOpenState(false)
        setLightRulesOpenState(false)
        setPumpWaterRulesOpenState(false)
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
            setMessage("ดาวน์โหลด CSV template สำหรับกรอก temp/pH ย้อนหลังแล้ว")
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
            setMessage(`import CSV แล้ว (${rowsUpdated} rows updated)`)
        } catch (error) {
            const text = error instanceof Error ? error.message : "import CSV ไม่สำเร็จ"
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

    $("timeseries-capture-keep-light-button").addEventListener("click", async () => {
        if (!dashboardState || timeseriesCapturePolicyPending) {
            return
        }

        timeseriesCapturePolicyPending = true
        renderTimeseriesCapturePolicy(dashboardState)
        try {
            const result = await setTimeseriesCapturePolicy({
                mode: "keep_light_state",
            })
            dashboardState = {
                ...dashboardState,
                model_data: {
                    ...(dashboardState.model_data ?? {}),
                    timeseries_capture: result.capture_policy,
                },
            }
            renderTimeseriesCapturePolicy(dashboardState)
            setMessage("ตั้งค่าให้รอบถัดไปเก็บ timeseries โดยไม่ปิดไฟแล้ว")
            await refreshDashboard(true)
        } catch (error) {
            const text = error instanceof Error ? error.message : "อัปเดตโหมด timeseries ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            timeseriesCapturePolicyPending = false
            if (dashboardState) {
                renderTimeseriesCapturePolicy(dashboardState)
            }
        }
    })

    $("timeseries-capture-force-off-button").addEventListener("click", async () => {
        if (!dashboardState || timeseriesCapturePolicyPending) {
            return
        }

        timeseriesCapturePolicyPending = true
        renderTimeseriesCapturePolicy(dashboardState)
        try {
            const result = await setTimeseriesCapturePolicy({
                mode: "force_light_off",
            })
            dashboardState = {
                ...dashboardState,
                model_data: {
                    ...(dashboardState.model_data ?? {}),
                    timeseries_capture: result.capture_policy,
                },
            }
            renderTimeseriesCapturePolicy(dashboardState)
            setMessage("ตั้งค่าให้รอบถัดไปปิดไฟชั่วคราวก่อนเก็บ timeseries แล้ว")
            await refreshDashboard(true)
        } catch (error) {
            const text = error instanceof Error ? error.message : "อัปเดตโหมด timeseries ไม่สำเร็จ"
            setMessage(text, "error")
        } finally {
            timeseriesCapturePolicyPending = false
            if (dashboardState) {
                renderTimeseriesCapturePolicy(dashboardState)
            }
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
        setCycleActionState(activeCycle ?? null, getResolvedCycleProgress(dashboardState))
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
        const repeatDaily = (document.getElementById("light-repeat-daily") as HTMLInputElement | null)?.checked ?? false
        const { startDate, endDate } = repeatDaily
            ? { startDate: "", endDate: "" }
            : readScheduleDateRange("light-start-date", "light-end-date")
        const onTime = (document.getElementById("light-on-time") as HTMLInputElement).value
        const offTime = (document.getElementById("light-off-time") as HTMLInputElement).value

        await runAction("Light schedule added", async () => {
            await createLightSchedule({
                on_time: onTime,
                off_time: offTime,
                days: repeatDaily ? [...EVERYDAY_VALUES] : undefined,
                start_date: repeatDaily ? undefined : startDate,
                end_date: repeatDaily ? undefined : endDate,
                enabled: true,
            })
        })
    })

    $("pump-water-schedule-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const repeatDaily = (document.getElementById("pump-water-repeat-daily") as HTMLInputElement | null)?.checked ?? false
        const { startDate, endDate } = repeatDaily
            ? { startDate: "", endDate: "" }
            : readScheduleDateRange("pump-water-start-date", "pump-water-end-date")
        const startTime = (document.getElementById("pump-water-start-time") as HTMLInputElement).value

        await runAction("Water pump schedule added", async () => {
            await createPumpWaterSchedule({
                start_time: startTime,
                water_liters: readPositiveNumber("pump-water-schedule-liters"),
                days: repeatDaily ? [...EVERYDAY_VALUES] : undefined,
                start_date: repeatDaily ? undefined : startDate,
                end_date: repeatDaily ? undefined : endDate,
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
            void refreshAnomalyWatchFast()
        } else {
            clearLiveAnalysisTimer()
        }
        renderNextSensorSaveCountdown()
        queueRefresh()
        queueAnomalyRefresh()
    })
}

async function bootstrap(): Promise<void> {
    const root = document.getElementById("app")
    if (!root) {
        throw new Error("Missing app root")
    }

    root.innerHTML = createLayout()
    syncScheduleDateInputs(null)
    bindEvents()
    bindScheduleDateRange("light-start-date", "light-end-date")
    bindScheduleDateRange("pump-water-start-date", "pump-water-end-date")
    bindScheduleRepeatToggle("light-repeat-daily", "light-start-date", "light-end-date")
    bindScheduleRepeatToggle("pump-water-repeat-daily", "pump-water-start-date", "pump-water-end-date")
    syncCamera()
    void refreshLiveCameraAnalysis(true)
    await refreshDashboard()
    void refreshAnomalyWatchFast()
    renderNextSensorSaveCountdown()
    setAnalysisAdvancedOpenState(false)
    setCameraGapOpenState(false)
    setLiveAnalysisOpenState(false)
    queueRefresh()
    queueAnomalyRefresh()
}

void bootstrap()
