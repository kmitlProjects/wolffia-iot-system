import {
    createLightSchedule,
    createPumpWaterSchedule,
    deleteAutomationRule,
    fetchDailySummaryHistory,
    fetchDashboardState,
    fetchLiveCameraAnalysis,
    fetchSensorHistory,
    harvestGrowCycle,
    previewHarvestPrediction,
    setAutomationRuleEnabled,
    startAllFertilizerPumps,
    startFertilizerPump,
    startGrowCycle,
    startWaterPump,
    stopAllFertilizerPumps,
    stopFertilizerPump,
    stopWaterPump,
    turnLight,
} from "./api.js";

const DAY_OPTIONS = [
    ["mon", "Mon"],
    ["tue", "Tue"],
    ["wed", "Wed"],
    ["thu", "Thu"],
    ["fri", "Fri"],
    ["sat", "Sat"],
    ["sun", "Sun"],
];

const POLL_VISIBLE_MS = 30000;
const POLL_HIDDEN_MS = 30000;
const CAMERA_REFRESH_MS = 2500;
const CAMERA_RETRY_MS = 3000;
const LIVE_ANALYSIS_REFRESH_MS = 8000;
const LIVE_ANALYSIS_RETRY_MS = 10000;
const DEFAULT_PUMP_DURATION = "5";

let dashboardState = null;
let sensorHistory = [];
let dailySummaryHistory = [];
let pollTimer;
let messageTimer;
let cameraRetryTimer;
let liveAnalysisTimer;
let cameraWanted = true;
let cameraLoaded = false;
let cameraStreamNonce = 0;
let cycleActionPending = false;
let analysisRefreshPending = false;
let predictionPreviewPending = false;
let predictionPreview = null;
let liveCameraAnalysisPending = false;
let liveCameraAnalysis = null;

function $(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function createLayout() {
    return `
        <div class="app-shell">
            <header class="hero">
                <div class="hero-header">
                    <div class="hero-copy">
                        <span class="eyebrow">Wolffia Control Deck</span>
                        <h1>Pond ops built for your phone, not just your desk.</h1>
                        <p>
                            หน้าใหม่ถูกแยกสำหรับมือถือโดยเฉพาะ ลด polling ฝั่งเว็บ
                            และรวมข้อมูลหลักไว้ที่ state endpoint เดียวเพื่อให้ลื่นขึ้นกว่าเดิม
                        </p>
                    </div>
                    <div class="hero-meta">
                        <div class="badge-row">
                            <span id="connection-badge" class="status-badge">กำลังเชื่อมต่อ</span>
                            <span id="timezone-chip" class="mini-chip">-</span>
                        </div>
                        <p>อัปเดตล่าสุด <strong id="generated-at">-</strong></p>
                        <div class="link-row">
                            <span class="mini-chip">Mobile-first dashboard</span>
                            <span class="mini-chip">Camera snapshot refresh เบากว่า MJPEG</span>
                        </div>
                    </div>
                </div>
            </header>

            <main class="dashboard-grid">
                <section class="panel camera-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2>Camera Snapshot</h2>
                                <p>รีเฟรชภาพเป็นช่วง ๆ แทน MJPEG เพื่อช่วยลดภาระ Raspberry Pi และลด error ใน browser</p>
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
                            <p>ภาพรวมสถานะล่าสุดของระบบจาก MongoDB และ actuator controller</p>
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
                                    <p>ฮับนี้สรุปข้อมูลที่ระบบใช้จริงจากภาพสดด้านบน, ข้อมูลรายชั่วโมงใน MongoDB และ daily rollup ที่จะถูกส่งต่อไปยัง feature builder สำหรับทำโมเดล</p>
                                </div>
                                <button id="analysis-refresh-button" class="button-ghost" type="button">
                                    Refresh Hub
                                </button>
                            </div>
                            <div id="analysis-preview-meta" class="history-metrics"></div>
                            <div id="daily-summary-highlights" class="daily-highlight-grid"></div>
                            <div id="analysis-process-grid" class="analysis-process-grid"></div>
                            <div class="analysis-note">
                                ภาพ raw, binary mask และ overlay ให้ดูจาก Live OpenCV Preview ด้านบนเท่านั้น
                                ส่วนการ์ดนี้ใช้สรุปข้อมูลที่ถูกเก็บจริงในระบบเพื่อทำ time series และเตรียม train model
                            </div>
                            <div id="daily-summary-list" class="history-list"></div>
                        </div>
                    </section>

                    <section class="panel timeseries-panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2>Coverage Time Series</h2>
                                <p>ดูแนวโน้มย้อนหลังของ temp, pH และ green coverage จากข้อมูลรายชั่วโมง</p>
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
                                    <p>กดเพื่อเช็กว่า feature ที่เก็บมาจนถึงตอนนี้พร้อมส่งเข้าโมเดลหรือยัง และดู baseline ก่อนมีโมเดลจริง</p>
                                </div>
                                <button id="prediction-preview-button" class="button-primary" type="button">
                                    Predict Harvest
                                </button>
                            </div>
                            <div id="prediction-preview-summary" class="daily-highlight-grid"></div>
                            <div id="prediction-preview-copy" class="rule-card rule-empty">
                                ยังไม่มี prediction preview
                                กด Predict Harvest เพื่อดู readiness ของข้อมูลและ baseline วันเก็บเกี่ยวจากโครง feature ปัจจุบัน
                            </div>
                        </div>
                    </section>
                </section>

                <section class="control-grid">
                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3>Light Control</h3>
                                <p>ควบคุมไฟแบบ manual ได้ทันที และมี schedule แยกด้านล่าง</p>
                            </div>
                            <div class="actions">
                                <button id="light-on-button" class="button-primary" type="button">
                                    Turn On
                                </button>
                                <button id="light-off-button" class="button-secondary" type="button">
                                    Turn Off
                                </button>
                            </div>
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h3>Water Pump</h3>
                                <p>กดรันแบบ manual หรือให้ scheduler สั่งแทนตามเวลาที่กำหนด</p>
                            </div>
                            <div class="inline-fields">
                                <label for="manual-water-duration">
                                    Duration (s)
                                    <input id="manual-water-duration" min="1" type="number" value="5">
                                </label>
                            </div>
                            <div class="actions">
                                <button id="water-start-button" class="button-primary" type="button">
                                    Start Pump
                                </button>
                                <button id="water-stop-button" class="button-danger" type="button">
                                    Stop Pump
                                </button>
                            </div>
                        </div>
                    </section>
                </section>

                <section class="panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2>Fertilizer Pumps</h2>
                                <p>แต่ละหัวปั๊มสั่งแยกได้ และยังมีปุ่ม start/stop ทั้งชุดให้ใช้เร็ว ๆ</p>
                            </div>
                        </div>
                        <div class="inline-fields">
                            <label for="fertilizer-all-duration">
                                Duration for all pumps (s)
                                <input id="fertilizer-all-duration" min="1" type="number" value="5">
                            </label>
                        </div>
                        <div class="actions">
                            <button
                                id="fertilizer-start-all-button"
                                class="button-primary"
                                type="button"
                            >
                                Start All
                            </button>
                            <button
                                id="fertilizer-stop-all-button"
                                class="button-danger"
                                type="button"
                            >
                                Stop All
                            </button>
                        </div>
                        <div id="pump-fertilizer-list" class="fertilizer-grid"></div>
                    </div>
                </section>

                <section class="schedule-grid">
                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2>Light Schedule</h2>
                                <p>เปิดและปิดไฟอัตโนมัติตามวันและเวลาที่กำหนด</p>
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
                            <div id="light-rule-list" class="rule-list"></div>
                        </div>
                    </section>

                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2>Water Pump Schedule</h2>
                                <p>สร้างรอบให้น้ำตามวันและระยะเวลาที่ต้องการ</p>
                            </div>
                            <form id="pump-water-schedule-form" class="stack">
                                <div class="inline-fields">
                                    <label for="pump-water-start-time">
                                        Start time
                                        <input id="pump-water-start-time" type="time" value="08:00">
                                    </label>
                                    <label for="pump-water-schedule-duration">
                                        Duration (s)
                                        <input
                                            id="pump-water-schedule-duration"
                                            min="1"
                                            type="number"
                                            value="10"
                                        >
                                    </label>
                                </div>
                                <div id="pump-water-days" class="day-grid"></div>
                                <button class="button-primary" type="submit">
                                    Add Water Pump Schedule
                                </button>
                            </form>
                            <div id="pump-water-rule-list" class="rule-list"></div>
                        </div>
                    </section>
                </section>
            </main>

            <div class="message-bar">
                <div id="message-card" class="message-card">
                    <span id="message-copy">Ready</span>
                </div>
            </div>
        </div>
    `;
}

function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-";
    }
    return Number(value).toFixed(digits);
}

function formatTimestamp(value) {
    if (!value) {
        return "No data yet";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(parsed);
}

function formatTimeOnly(value) {
    if (!value) {
        return "-";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(parsed);
}

function formatDateLabel(value) {
    if (!value) {
        return "-";
    }

    const parsed = value.includes("T")
        ? new Date(value)
        : new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("th-TH", {
        month: "short",
        day: "numeric",
    }).format(parsed);
}

function slugToFriendlyLabel(value) {
    if (!value) {
        return "-";
    }

    return value
        .split(/[_-]+/)
        .filter(Boolean)
        .map((part) => {
            const upper = part.toUpperCase();
            if (["LAB", "HSV", "ROI", "EXG", "CLAHE"].includes(upper)) {
                return upper;
            }
            if (/^V\d+$/i.test(part)) {
                return part.toUpperCase();
            }
            if (upper === "GAUSSIAN") {
                return "Gaussian";
            }
            if (upper === "BLUR") {
                return "Blur";
            }
            if (upper === "OTSU") {
                return "Otsu";
            }
            return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
        })
        .join(" ");
}

function formatCoverageMethod(value) {
    if (!value) {
        return "-";
    }

    const normalized = value.toLowerCase();
    if (normalized === "lab_clahe_exg_otsu_v3") {
        return "OpenCV v3";
    }
    if (normalized === "lab_clahe_hsv_exg_v2") {
        return "OpenCV v2";
    }
    return slugToFriendlyLabel(value);
}

function formatCoverageProcess(thresholds) {
    if (!thresholds) {
        return "-";
    }

    const parts = [];
    if (thresholds.preprocess) {
        parts.push(slugToFriendlyLabel(thresholds.preprocess));
    }
    if (thresholds.exg_threshold) {
        parts.push(`ExG ${slugToFriendlyLabel(String(thresholds.exg_threshold))}`);
    }
    if (thresholds.h_min !== null && thresholds.h_min !== undefined) {
        const upper = thresholds.h_max !== null && thresholds.h_max !== undefined
            ? formatNumber(thresholds.h_max, 0)
            : "-";
        parts.push(`H ${formatNumber(thresholds.h_min, 0)}-${upper}`);
    }

    return parts.join(" • ") || "-";
}

function formatSourceMode(value) {
    if (!value) {
        return "-";
    }

    switch (value) {
        case "camera":
            return "Camera Live";
        case "dataset":
            return "Dataset Simulation";
        default:
            return slugToFriendlyLabel(value);
    }
}

function formatRoiSize(roi) {
    if (!roi?.width || !roi?.height) {
        return "-";
    }

    return `${formatNumber(roi.width, 0)} × ${formatNumber(roi.height, 0)} px`;
}

function countCoveragePoints(items) {
    return items.filter((item) => item.green_coverage_percent !== null && item.green_coverage_percent !== undefined).length;
}

function countTaggedCoveragePoints(items) {
    return items.filter((item) => item.coverage_method || item.coverage_version).length;
}

function getLatestCoverageRecord(items) {
    const reversed = [...items].reverse();
    return reversed.find(
        (item) =>
            item.green_coverage_percent !== null && item.green_coverage_percent !== undefined,
    ) ?? dashboardState?.sensor ?? null;
}

function getCycleProgress(cycle, referenceAt) {
    if (!cycle?.planted_at) {
        return null;
    }

    const plantedAt = new Date(cycle.planted_at);
    const referenceTime = new Date(referenceAt);
    if (Number.isNaN(plantedAt.getTime()) || Number.isNaN(referenceTime.getTime())) {
        return null;
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor(
        (referenceTime.getTime() - plantedAt.getTime()) / millisecondsPerDay,
    );
    const dayIndex = Math.max(diffDays + 1, 1);
    const targetDays = Number(cycle.target_harvest_days ?? 0);
    const remainingDays = targetDays > 0
        ? Math.max(targetDays - dayIndex, 0)
        : 0;

    return { dayIndex, remainingDays };
}

function getActiveCycleProgress() {
    const cycle = dashboardState?.grow_cycle ?? null;
    if (!cycle || cycle.status !== "active") {
        return {
            cycle: null,
            progress: null,
        };
    }

    return {
        cycle,
        progress: getCycleProgress(cycle, dashboardState?.meta.generated_at ?? new Date().toISOString()),
    };
}

function setCycleActionState(cycle, cycleProgress) {
    const startButton = $("cycle-start-button");
    const harvestButton = $("cycle-harvest-button");
    const hasActiveCycle = Boolean(cycle && cycle.status === "active");

    startButton.disabled = cycleActionPending || hasActiveCycle;
    harvestButton.disabled = cycleActionPending || !hasActiveCycle;

    if (cycleActionPending) {
        startButton.textContent = "กำลังบันทึก...";
        harvestButton.textContent = "กำลังบันทึก...";
        return;
    }

    startButton.textContent = hasActiveCycle ? "มีรอบปลูกอยู่แล้ว" : "เริ่มปลูก";

    if (!hasActiveCycle) {
        harvestButton.textContent = "ยังไม่มีรอบปลูก";
        return;
    }

    if (cycleProgress && cycleProgress.remainingDays > 0) {
        harvestButton.textContent = `เก็บเกี่ยวก่อนกำหนด (${cycleProgress.remainingDays} วัน)`;
        return;
    }

    harvestButton.textContent = "สิ้นสุดการปลูก";
}

function buildHarvestConfirmationMessage(cycle, cycleProgress) {
    const cycleLabel = cycle?.name || cycle?.cycle_id || "รอบปลูกนี้";
    const targetDays = Number(cycle?.target_harvest_days ?? 14);

    if (cycleProgress && cycleProgress.remainingDays > 0) {
        return [
            `${cycleLabel} ยังไม่ครบระยะเก็บเกี่ยว ${targetDays} วัน`,
            `ตอนนี้อยู่วันที่ ${cycleProgress.dayIndex} และยังเหลือประมาณ ${cycleProgress.remainingDays} วันตามแผน`,
            "",
            "ต้องการเก็บเกี่ยวจริงหรือไม่?",
        ].join("\n");
    }

    return `${cycleLabel} พร้อมสิ้นสุดการปลูกแล้วใช่หรือไม่?`;
}

function formatDays(days) {
    return days
        .map((day) => DAY_OPTIONS.find(([value]) => value === day)?.[1] ?? day)
        .join(" • ");
}

function setMessage(text, tone = "info") {
    const card = $("message-card");
    $("message-copy").textContent = text;
    card.classList.add("visible");
    card.classList.toggle("error", tone === "error");

    if (messageTimer !== undefined) {
        window.clearTimeout(messageTimer);
    }

    messageTimer = window.setTimeout(() => {
        card.classList.remove("visible");
    }, 4200);
}

function setConnectionStatus(online, detail) {
    const badge = $("connection-badge");
    badge.textContent = detail;
    badge.classList.toggle("online", online);
    badge.classList.toggle("offline", !online);
}

function renderDayOptions(containerId, inputName) {
    $(containerId).innerHTML = DAY_OPTIONS.map(
        ([value, label]) => `
            <label class="day-option">
                <input type="checkbox" name="${inputName}" value="${value}" checked>
                <span>${label}</span>
            </label>
        `,
    ).join("");
}

function collectDays(inputName) {
    return Array.from(
        document.querySelectorAll(`input[name="${inputName}"]:checked`),
    ).map((checkbox) => checkbox.value);
}

function readPositiveNumber(inputId) {
    const input = document.getElementById(inputId);
    const rawValue = input ? input.value : "";
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error("กรุณากรอกตัวเลขที่มากกว่า 0");
    }
    return numericValue;
}

function buildLineChartMarkup(points, color) {
    const validPoints = points
        .map((point, index) => ({
            index,
            label: point.label,
            value: point.value,
        }))
        .filter((point) => point.value !== null && Number.isFinite(point.value));

    if (validPoints.length === 0) {
        return '<div class="chart-empty">ยังไม่มีข้อมูลสำหรับช่วงเวลานี้</div>';
    }

    const width = 640;
    const height = 180;
    const paddingX = 18;
    const paddingY = 16;
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingY * 2;
    const values = validPoints.map((point) => Number(point.value));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue || 1;

    const pointLine = validPoints.map((point) => {
        const x = paddingX + (point.index / Math.max(points.length - 1, 1)) * plotWidth;
        const y = paddingY + ((maxValue - Number(point.value)) / range) * plotHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");

    const areaLine = `${paddingX},${height - paddingY} ${pointLine} ${width - paddingX},${height - paddingY}`;
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((step) => {
        const y = paddingY + step * plotHeight;
        return `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" />`;
    }).join("");

    const dots = validPoints.map((point) => {
        const x = paddingX + (point.index / Math.max(points.length - 1, 1)) * plotWidth;
        const y = paddingY + ((maxValue - Number(point.value)) / range) * plotHeight;
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" />`;
    }).join("");

    const firstLabel = escapeHtml(validPoints[0].label);
    const lastLabel = escapeHtml(validPoints[validPoints.length - 1].label);

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
    `;
}

function renderSensorChart(containerId, metaId, points, color, digits, suffix) {
    $(containerId).innerHTML = buildLineChartMarkup(points, color);

    const validValues = points
        .map((point) => point.value)
        .filter((value) => value !== null && Number.isFinite(value));

    if (validValues.length === 0) {
        $(metaId).textContent = "ยังไม่มีข้อมูล";
        return;
    }

    const latestValue = validValues[validValues.length - 1];
    const minValue = Math.min(...validValues);
    const maxValue = Math.max(...validValues);
    $(metaId).textContent =
        `ล่าสุด ${formatNumber(latestValue, digits)}${suffix} • ` +
        `ต่ำสุด ${formatNumber(minValue, digits)} • สูงสุด ${formatNumber(maxValue, digits)}`;
}

function renderSensorCharts(items) {
    const recent = items.slice(-48);
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
    );
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
    );
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
    );
}

function renderDailySummarySection(latestSummary, latestImage, latestDebug, summaries) {
    const previewMeta = $("analysis-preview-meta");
    const summaryContainer = $("daily-summary-highlights");
    const processGrid = $("analysis-process-grid");
    const cycle = dashboardState?.grow_cycle ?? null;
    const cycleProgress = getCycleProgress(
        cycle,
        dashboardState?.meta.generated_at ?? new Date().toISOString(),
    );
    const latestCoverageRecord = getLatestCoverageRecord(sensorHistory);
    const coveragePoints = countCoveragePoints(sensorHistory);
    const taggedCoveragePoints = countTaggedCoveragePoints(sensorHistory);
    const liveMethod = formatCoverageMethod(
        liveCameraAnalysis?.coverage_method ??
        latestCoverageRecord?.coverage_method ??
        latestImage?.coverage_method,
    );
    const liveVersion =
        liveCameraAnalysis?.coverage_version ??
        latestCoverageRecord?.coverage_version ??
        latestImage?.coverage_version ??
        "-";
    const pipelineCopy = formatCoverageProcess(
        liveCameraAnalysis?.coverage_thresholds ??
        latestImage?.coverage_thresholds,
    );
    const storedSourceMode = formatSourceMode(
        latestImage?.analysis_source_mode ??
        latestDebug?.source_mode,
    );
    const sourceLabel = latestImage?.analysis_source_label ?? latestDebug?.source_label ?? "-";
    const cycleDayLabel = cycleProgress
        ? `${cycleProgress.dayIndex}/${cycle?.target_harvest_days ?? "-"}`
        : String(latestSummary?.cycle_day_index ?? latestDebug?.cycle_day_index ?? "-");
    const summaryCount = summaries.length;

    previewMeta.innerHTML = `
        <span>live ${escapeHtml(liveMethod)}</span>
        <span>version ${escapeHtml(String(liveVersion))}</span>
        <span>stored source ${escapeHtml(storedSourceMode)}</span>
        <span>${cycleProgress ? `cycle day ${escapeHtml(cycleDayLabel)}` : "ยังไม่มี active cycle"}</span>
    `;

    summaryContainer.innerHTML = `
        <article class="summary-card">
            <span class="card-label">Live Coverage Now</span>
            <strong>${formatNumber(liveCameraAnalysis?.green_coverage_percent, 2)} %</strong>
            <span class="helper-text">captured ${escapeHtml(formatTimestamp(liveCameraAnalysis?.captured_at))}</span>
            <span class="helper-text">preview only</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Hourly Records In View</span>
            <strong>${formatNumber(sensorHistory.length, 0)}</strong>
            <span class="helper-text">${coveragePoints} coverage rows</span>
            <span class="helper-text">saved ${escapeHtml(formatTimestamp(latestCoverageRecord?.timestamp))}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Coverage Pipeline</span>
            <strong class="summary-compact-text">${escapeHtml(liveMethod)}</strong>
            <span class="helper-text">version ${escapeHtml(String(liveVersion))}</span>
            <span class="helper-text wrap-anywhere">${escapeHtml(pipelineCopy)}</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Daily Rollup</span>
            <strong>${escapeHtml(latestSummary?.date ?? "-")}</strong>
            <span class="helper-text">${latestSummary?.sensor_count ?? 0} hourly points</span>
            <span class="helper-text">avg ${formatNumber(latestSummary?.green_coverage_avg, 2)}%</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Stored Source</span>
            <strong class="summary-compact-text">${escapeHtml(storedSourceMode)}</strong>
            <span class="helper-text">cycle day ${escapeHtml(cycleDayLabel)}</span>
            <span class="helper-text wrap-anywhere">${escapeHtml(sourceLabel)}</span>
        </article>
    `;

    processGrid.innerHTML = `
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Stage 1</span>
                <strong>Live Camera + ROI</strong>
            </div>
            <p class="helper-text">
                ภาพสด, binary mask และ green overlay ที่อยู่ด้านบนเป็นภาพปัจจุบันอย่างเดียว
                ใช้ดูว่าการตีกรอบผิวน้ำและแยกพื้นที่สีเขียวโอเคหรือยังโดยไม่เก็บรูปลง storage
            </p>
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
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Stage 2</span>
                <strong>Hourly MongoDB Record</strong>
            </div>
            <p class="helper-text">
                ทุกหนึ่งชั่วโมงระบบจะเก็บ temp, pH, green_coverage_percent,
                coverage_method และ coverage_version ลง MongoDB เพื่อทำ time series ต่อ
            </p>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Latest Temp / pH</span>
                    <strong>${formatNumber(latestCoverageRecord?.temp, 1)} °C • pH ${formatNumber(latestCoverageRecord?.ph, 2)}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Latest Stored Coverage</span>
                    <strong>${formatNumber(latestCoverageRecord?.green_coverage_percent, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Saved At</span>
                    <strong>${escapeHtml(formatTimestamp(latestCoverageRecord?.timestamp))}</strong>
                </div>
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Stage 3</span>
                <strong>Daily Rollup</strong>
            </div>
            <p class="helper-text">
                ส่วนนี้คือ daily summary ที่จะเอาไปดูแนวโน้มรายวันและใช้ต่อกับ feature builder
                โดยไม่เอารูปเก่ามาโชว์ซ้ำในหน้าเว็บ
            </p>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Latest Day</span>
                    <strong>${escapeHtml(latestSummary?.date ?? "-")}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Coverage Avg / Max</span>
                    <strong>${formatNumber(latestSummary?.green_coverage_avg, 2)} % • ${formatNumber(latestSummary?.green_coverage_max, 2)} %</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Daily Image Coverage</span>
                    <strong>${formatNumber(latestImage?.green_coverage_percent, 2)} %</strong>
                </div>
            </div>
        </article>
        <article class="analysis-stage-card">
            <div class="analysis-stage-head">
                <span class="mini-chip active">Stage 4</span>
                <strong>Model Feed Snapshot</strong>
            </div>
            <p class="helper-text">
                ตรงนี้บอกว่าหน้าต่างข้อมูลที่เปิดดูอยู่ตอนนี้มีแถวที่ติด method/version พร้อมส่งต่อไปทำ dataset แค่ไหน
            </p>
            <div class="analysis-detail-list">
                <div class="analysis-detail-row">
                    <span>Tagged Hourly Rows</span>
                    <strong>${taggedCoveragePoints} / ${sensorHistory.length}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Summary Days On Screen</span>
                    <strong>${summaryCount}</strong>
                </div>
                <div class="analysis-detail-row">
                    <span>Cycle Context</span>
                    <strong>${cycleProgress ? `DAY ${escapeHtml(cycleDayLabel)}` : "IDLE"}</strong>
                </div>
            </div>
        </article>
    `;

    const listContainer = $("daily-summary-list");
    if (summaries.length === 0) {
        listContainer.innerHTML = '<div class="rule-card rule-empty">ยังไม่มีประวัติ daily summary</div>';
        return;
    }

    listContainer.innerHTML = summaries.map((summary) => `
        <article class="history-card">
            <div class="rule-title">
                <div>
                    <strong>${escapeHtml(summary.date)}</strong>
                    <div class="rule-meta">
                        ${summary.sensor_count ?? 0} hourly points •
                        coverage avg ${formatNumber(summary.green_coverage_avg, 2)}%
                    </div>
                </div>
                <span class="mini-chip ${summary.coverage_count ? "active" : "danger"}">
                    ${summary.coverage_count ?? 0} coverage points
                </span>
            </div>
            <div class="history-metrics">
                <span>Temp ${formatNumber(summary.temp_avg, 1)} °C</span>
                <span>pH ${formatNumber(summary.ph_avg, 2)}</span>
                <span>Coverage avg ${formatNumber(summary.green_coverage_avg, 2)}%</span>
                <span>Coverage max ${formatNumber(summary.green_coverage_max, 2)}%</span>
            </div>
            <div class="history-metrics">
                <span>Daily image ${formatNumber(summary.daily_image_coverage_percent, 2)}%</span>
                <span>Cycle day ${escapeHtml(String(summary.cycle_day_index ?? "-"))}</span>
                <span>Target ${escapeHtml(String(summary.target_harvest_days ?? "-"))} days</span>
            </div>
        </article>
    `).join("");
}

function renderPredictionPreview(state) {
    const summaryContainer = $("prediction-preview-summary");
    const copyContainer = $("prediction-preview-copy");
    const cycle = state.grow_cycle;
    const latestImage = state.image_analysis;

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
        `;
        copyContainer.innerHTML = `
            ยังไม่มี prediction preview
            กด Predict Harvest เพื่อดู readiness ของข้อมูล, จำนวน history ที่มี, และ baseline วันเก็บเกี่ยวก่อนเสียบโมเดลจริง
        `;
        return;
    }

    const readiness = predictionPreview.readiness;
    const modelInput = predictionPreview.feature_bundle?.model_input ?? {};
    const cycleSnapshot = predictionPreview.feature_bundle?.cycle ?? {};
    const readinessClass = readiness.ready ? "active" : "danger";

    summaryContainer.innerHTML = `
        <article class="summary-card">
            <span class="card-label">Readiness</span>
            <strong>${readiness.ready ? "READY" : "BLOCKED"}</strong>
            <span class="helper-text">${readiness.blocking_reasons.length} blocking reason(s)</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Baseline Days Left</span>
            <strong>${formatNumber(modelInput.baseline_expected_days_to_harvest, 0)}</strong>
            <span class="helper-text">ค่าประมาณตาม cycle plan ก่อนมีโมเดลจริง</span>
        </article>
        <article class="summary-card">
            <span class="card-label">Lookback Window</span>
            <strong>${formatNumber(modelInput.lookback_days, 0)} days</strong>
            <span class="helper-text">
                ${formatNumber(modelInput.summary_days_available, 0)} summary days •
                ${formatNumber(modelInput.sensor_points_available, 0)} sensor points
            </span>
        </article>
        <article class="summary-card">
            <span class="card-label">Cycle Day</span>
            <strong>${formatNumber(cycleSnapshot.cycle_day_index, 0)} / ${formatNumber(cycleSnapshot.target_harvest_days, 0)}</strong>
            <span class="helper-text">${escapeHtml(cycleSnapshot.expected_harvest_at ?? "-")}</span>
        </article>
    `;

    copyContainer.innerHTML = `
        <div class="rule-title">
            <div>
                <strong>Prediction Placeholder</strong>
                <div class="rule-meta">${escapeHtml(predictionPreview.prediction_type)}</div>
            </div>
            <span class="mini-chip ${readinessClass}">
                ${readiness.ready ? "Ready for model" : "Needs more data"}
            </span>
        </div>
        <div class="history-metrics">
            <span>Temp ${formatNumber(modelInput.latest_temp_c, 1)} °C</span>
            <span>pH ${formatNumber(modelInput.latest_ph, 2)}</span>
            <span>Coverage ${formatNumber(modelInput.latest_daily_image_coverage_percent ?? modelInput.latest_green_coverage_percent, 2)}%</span>
        </div>
        <p class="helper-text">
            ตอนนี้ยังไม่มีโมเดลจริง ระบบจึงแสดง readiness และ baseline feature snapshot เพื่อเตรียมเสียบ model ภายหลัง
        </p>
        <div class="rule-meta">
            Blocking: ${escapeHtml(readiness.blocking_reasons.join(" • ") || "none")}
        </div>
        <div class="rule-meta">
            Warnings: ${escapeHtml(readiness.warnings.join(" • ") || "none")}
        </div>
    `;
}

function renderLightRules(rules) {
    const container = $("light-rule-list");
    if (rules.length === 0) {
        container.innerHTML = '<div class="rule-card rule-empty">ยังไม่มี light schedule</div>';
        return;
    }

    container.innerHTML = rules.map(
        (rule) => `
            <article class="rule-card">
                <div class="rule-title">
                    <div>
                        <strong>On ${escapeHtml(rule.on_time)} / Off ${escapeHtml(rule.off_time)}</strong>
                        <div class="rule-meta">${escapeHtml(formatDays(rule.days))}</div>
                    </div>
                    <span class="mini-chip ${rule.enabled ? "active" : "danger"}">
                        ${rule.enabled ? "Enabled" : "Disabled"}
                    </span>
                </div>
                <div class="rule-actions">
                    <label class="day-option">
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
    ).join("");
}

function renderPumpWaterRules(rules) {
    const container = $("pump-water-rule-list");
    if (rules.length === 0) {
        container.innerHTML = '<div class="rule-card rule-empty">ยังไม่มี water pump schedule</div>';
        return;
    }

    container.innerHTML = rules.map(
        (rule) => `
            <article class="rule-card">
                <div class="rule-title">
                    <div>
                        <strong>Start ${escapeHtml(rule.start_time)}</strong>
                        <div class="rule-meta">
                            ${rule.duration_seconds}s • ${escapeHtml(formatDays(rule.days))}
                        </div>
                    </div>
                    <span class="mini-chip ${rule.enabled ? "active" : "danger"}">
                        ${rule.enabled ? "Enabled" : "Disabled"}
                    </span>
                </div>
                <div class="rule-actions">
                    <label class="day-option">
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
    ).join("");
}

function renderFertilizerPumps(pumps) {
    const existingValues = new Map();
    document
        .querySelectorAll("[data-fertilizer-duration]")
        .forEach((input) => {
            existingValues.set(Number(input.dataset.pumpId), input.value);
        });

    $("pump-fertilizer-list").innerHTML = pumps.map((pump) => {
        const statusText = pump.is_running
            ? `RUNNING • ${pump.remaining_seconds}s left`
            : "OFF";
        const defaultValue = existingValues.get(pump.id) ?? DEFAULT_PUMP_DURATION;

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
                <label for="pump-duration-${pump.id}">
                    Duration (s)
                    <input
                        id="pump-duration-${pump.id}"
                        data-fertilizer-duration="true"
                        data-pump-id="${pump.id}"
                        min="1"
                        type="number"
                        value="${escapeHtml(defaultValue)}"
                    >
                </label>
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
        `;
    }).join("");
}

function clearCameraTimer() {
    if (cameraRetryTimer !== undefined) {
        window.clearTimeout(cameraRetryTimer);
        cameraRetryTimer = undefined;
    }
}

function setAnalysisRefreshState(pending) {
    const button = document.getElementById("analysis-refresh-button");
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    button.disabled = pending;
    button.textContent = pending
        ? "Refreshing..."
        : "Refresh Hub";
    button.title = "รีเฟรชภาพสด, ข้อมูลรายชั่วโมง และ daily summary ล่าสุด";
}

function setPredictionPreviewState(pending) {
    const button = document.getElementById("prediction-preview-button");
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    const requiresActiveCycle = !dashboardState?.grow_cycle;

    button.disabled = pending || requiresActiveCycle;
    button.textContent = pending
        ? "Checking..."
        : requiresActiveCycle
            ? "Need Active Cycle"
            : "Predict Harvest";
    button.title = requiresActiveCycle
        ? "เริ่มรอบปลูกก่อน แล้วระบบจึงจะ preview ความพร้อมสำหรับการทำนายวันเก็บเกี่ยวได้"
        : "";
}

function buildCameraSnapshotUrl(baseUrl) {
    cameraStreamNonce += 1;
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}snapshot=${cameraStreamNonce}`;
}

function buildAnalysisAssetUrl(url, cacheKey) {
    if (!url) {
        return null;
    }

    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(cacheKey)}`;
}

function getLiveAnalysisPreviewKey(analysis) {
    return String(analysis.captured_at || Date.now());
}

function preloadImageAsset(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`โหลดภาพวิเคราะห์ไม่สำเร็จ: ${url}`));
        image.src = url;
    });
}

async function preloadLiveAnalysisAssets(analysis) {
    const previewKey = getLiveAnalysisPreviewKey(analysis);
    const urls = [
        buildAnalysisAssetUrl(analysis.raw_url, previewKey),
        buildAnalysisAssetUrl(analysis.mask_url, previewKey),
        buildAnalysisAssetUrl(analysis.overlay_url, previewKey),
    ].filter((url) => Boolean(url));

    await Promise.all(urls.map((url) => preloadImageAsset(url)));
}

function ensureLiveAnalysisStrip() {
    const strip = $("live-analysis-strip");
    if (strip.dataset.mode === "tiles") {
        return;
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
    `;
    strip.dataset.mode = "tiles";
}

function updateLiveAnalysisTile(tileId, label, url) {
    const tile = document.getElementById(tileId);
    if (!(tile instanceof HTMLAnchorElement)) {
        return;
    }

    const image = tile.querySelector("img");
    const caption = tile.querySelector("span");
    if (caption) {
        caption.textContent = label;
    }
    if (image) {
        image.setAttribute("alt", label);
        if (url && image.getAttribute("src") !== url) {
            image.setAttribute("src", url);
        }
    }

    if (url) {
        if (tile.getAttribute("href") !== url) {
            tile.setAttribute("href", url);
        }
    } else {
        tile.removeAttribute("href");
        if (image) {
            image.removeAttribute("src");
        }
    }
}

function clearLiveAnalysisTimer() {
    if (liveAnalysisTimer !== undefined) {
        window.clearTimeout(liveAnalysisTimer);
        liveAnalysisTimer = undefined;
    }
}

function renderCameraRoiOverlay() {
    const roiBox = document.getElementById("camera-roi-box");
    if (!(roiBox instanceof HTMLDivElement)) {
        return;
    }

    const roi = liveCameraAnalysis?.coverage_roi;
    const imageWidth = liveCameraAnalysis?.image_width || 640;
    const imageHeight = liveCameraAnalysis?.image_height || 480;
    if (
        !cameraWanted ||
        !roi ||
        !roi.width ||
        !roi.height ||
        !imageWidth ||
        !imageHeight
    ) {
        roiBox.classList.add("hidden");
        return;
    }

    const leftPercent = (roi.x / imageWidth) * 100;
    const topPercent = (roi.y / imageHeight) * 100;
    const widthPercent = (roi.width / imageWidth) * 100;
    const heightPercent = (roi.height / imageHeight) * 100;
    const cornerRadius = roi.corner_radius || 0;
    const radiusXPercent = (cornerRadius / roi.width) * 100;
    const radiusYPercent = (cornerRadius / roi.height) * 100;

    roiBox.style.left = `${leftPercent}%`;
    roiBox.style.top = `${topPercent}%`;
    roiBox.style.width = `${widthPercent}%`;
    roiBox.style.height = `${heightPercent}%`;
    roiBox.style.borderRadius = cornerRadius > 0
        ? `${radiusXPercent}% / ${radiusYPercent}%`
        : "0";
    roiBox.classList.remove("hidden");
}

function renderLiveCameraAnalysis() {
    const meta = $("live-analysis-meta");
    const strip = $("live-analysis-strip");

    if (!liveCameraAnalysis) {
        meta.innerHTML = `
            <span>กำลังรอภาพสดสำหรับวิเคราะห์ด้วย OpenCV</span>
            <span>ไม่มีการบันทึกรูปลง storage</span>
        `;
        strip.innerHTML = `
            <div class="rule-card rule-empty">
                พื้นที่นี้จะแสดงภาพปัจจุบัน, binary mask และ green overlay จากเฟรมสดที่กำลังดูอยู่
            </div>
        `;
        strip.dataset.mode = "placeholder";
        renderCameraRoiOverlay();
        return;
    }

    const previewKey = getLiveAnalysisPreviewKey(liveCameraAnalysis);
    const rawUrl = buildAnalysisAssetUrl(liveCameraAnalysis.raw_url, previewKey);
    const maskUrl = buildAnalysisAssetUrl(liveCameraAnalysis.mask_url, previewKey);
    const overlayUrl = buildAnalysisAssetUrl(liveCameraAnalysis.overlay_url, previewKey);

    meta.innerHTML = `
        <span>captured ${escapeHtml(formatTimestamp(liveCameraAnalysis.captured_at))}</span>
        <span>coverage ${formatNumber(liveCameraAnalysis.green_coverage_percent, 2)}%</span>
        <span>${formatNumber(liveCameraAnalysis.green_pixels, 0)} / ${formatNumber(liveCameraAnalysis.total_pixels, 0)} green pixels</span>
        <span>${escapeHtml(formatCoverageMethod(liveCameraAnalysis.coverage_method))}</span>
        <span>${escapeHtml(formatCoverageProcess(liveCameraAnalysis.coverage_thresholds))}</span>
        <span>ROI ${escapeHtml(formatRoiSize(liveCameraAnalysis.coverage_roi))}</span>
    `;

    ensureLiveAnalysisStrip();
    updateLiveAnalysisTile("live-analysis-raw-tile", "Current Snapshot", rawUrl);
    updateLiveAnalysisTile("live-analysis-mask-tile", "Binary Mask", maskUrl);
    updateLiveAnalysisTile("live-analysis-overlay-tile", "Green Overlay", overlayUrl);
    renderCameraRoiOverlay();
}

function queueLiveAnalysisRefresh(delayMs = LIVE_ANALYSIS_REFRESH_MS) {
    if (!cameraWanted || document.hidden) {
        clearLiveAnalysisTimer();
        return;
    }

    clearLiveAnalysisTimer();
    liveAnalysisTimer = window.setTimeout(() => {
        void refreshLiveCameraAnalysis(false);
    }, delayMs);
}

async function refreshLiveCameraAnalysis(force = false) {
    if (liveCameraAnalysisPending || !cameraWanted || document.hidden) {
        return;
    }

    liveCameraAnalysisPending = true;
    try {
        const response = await fetchLiveCameraAnalysis(force);
        await preloadLiveAnalysisAssets(response.analysis);
        liveCameraAnalysis = response.analysis;
        renderLiveCameraAnalysis();
        if (dashboardState) {
            renderDailySummarySection(
                dashboardState.daily_summary,
                dashboardState.image_analysis,
                dashboardState.image_analysis_debug,
                dailySummaryHistory,
            );
        }
        queueLiveAnalysisRefresh(LIVE_ANALYSIS_REFRESH_MS);
    } catch (_error) {
        queueLiveAnalysisRefresh(LIVE_ANALYSIS_RETRY_MS);
    } finally {
        liveCameraAnalysisPending = false;
    }
}

function queueNextCameraFrame(delayMs = CAMERA_REFRESH_MS) {
    const stream = document.getElementById("camera-stream");
    if (!(stream instanceof HTMLImageElement) || !cameraWanted || document.hidden) {
        return;
    }

    clearCameraTimer();
    cameraRetryTimer = window.setTimeout(() => {
        if (!cameraWanted || document.hidden) {
            return;
        }

        const streamUrl = dashboardState?.camera.stream_url ?? "/camera/frame";
        stream.setAttribute("src", buildCameraSnapshotUrl(streamUrl));
    }, delayMs);
}

function syncCamera() {
    const stream = document.getElementById("camera-stream");
    const overlay = $("camera-overlay");
    const overlayCopy = $("camera-overlay-copy");
    const button = $("camera-toggle");
    const streamUrl = dashboardState?.camera.stream_url ?? "/camera/frame";
    const shouldStream = cameraWanted && !document.hidden;

    if (!(stream instanceof HTMLImageElement)) {
        return;
    }

    if (shouldStream) {
        if (!stream.getAttribute("src")) {
            cameraLoaded = false;
            stream.setAttribute("src", buildCameraSnapshotUrl(streamUrl));
        }
        queueLiveAnalysisRefresh(600);
        button.textContent = "Pause Camera";
        if (cameraLoaded) {
            overlay.classList.add("hidden");
        } else {
            overlay.classList.remove("hidden");
            overlayCopy.textContent =
                dashboardState?.camera.status.last_error ||
                "กำลังดึง snapshot จากกล้อง...";
        }
        return;
    }

    clearCameraTimer();
    clearLiveAnalysisTimer();
    stream.removeAttribute("src");
    cameraLoaded = false;
    renderCameraRoiOverlay();
    overlay.classList.remove("hidden");
    overlayCopy.textContent = cameraWanted
        ? "กล้องพักอัตโนมัติเมื่อแท็บไม่ถูกใช้งาน เพื่อลดภาระเครื่อง"
        : "กล้องถูกพักไว้ คุณสามารถกด Resume เมื่ออยากดูภาพสดได้";
    button.textContent = "Resume Camera";
}

function renderDashboard(state) {
    const sensor = state.sensor;
    const light = state.actuators.light;
    const waterPump = state.actuators.pump_water;
    const fertilizer = state.actuators.pump_fertilizer;
    const cycle = state.grow_cycle;
    const cycleProgress = getCycleProgress(cycle, state.meta.generated_at);

    $("timezone-chip").textContent = `TZ: ${state.meta.timezone}`;
    $("generated-at").textContent = formatTimestamp(state.meta.generated_at);

    $("sensor-temp").textContent = `${formatNumber(sensor?.temp)} °C`;
    $("sensor-ph").textContent = formatNumber(sensor?.ph, 2);
    $("sensor-coverage").textContent = `${formatNumber(sensor?.green_coverage_percent, 2)} %`;
    $("sensor-timestamp").textContent = formatTimestamp(sensor?.timestamp);

    $("light-status-chip").textContent = light.is_on ? "ON" : "OFF";
    $("light-mode-copy").textContent = light.active_low
        ? `GPIO ${light.pin} • relay is active-low`
        : `GPIO ${light.pin} • relay is active-high`;

    $("pump-water-status-chip").textContent = waterPump.is_running
        ? "RUNNING"
        : "READY";
    $("pump-water-copy").textContent = waterPump.is_running
        ? `${waterPump.remaining_seconds}s left on GPIO ${waterPump.pin}`
        : `GPIO ${waterPump.pin} • waiting for manual or scheduled run`;

    $("fertilizer-summary").textContent = `${fertilizer.running_count}/${fertilizer.pump_count} running`;
    $("grow-cycle-status-chip").textContent = cycleProgress
        ? `DAY ${cycleProgress.dayIndex}/${cycle?.target_harvest_days ?? "-"}`
        : "IDLE";
    $("grow-cycle-copy").textContent = cycleProgress
        ? `${cycle?.name || cycle?.cycle_id || "active cycle"} • เหลือ ${cycleProgress.remainingDays} วันตามแผน`
        : "ยังไม่มีรอบปลูก active อยู่";
    setCycleActionState(cycle, cycleProgress);

    renderLightRules(state.automation.light);
    renderPumpWaterRules(state.automation.pump_water);
    renderFertilizerPumps(fertilizer.pumps);
    renderSensorCharts(sensorHistory);
    renderDailySummarySection(
        state.daily_summary,
        state.image_analysis,
        state.image_analysis_debug,
        dailySummaryHistory,
    );
    setAnalysisRefreshState(analysisRefreshPending);
    renderPredictionPreview(state);
    setPredictionPreviewState(predictionPreviewPending);
    renderLiveCameraAnalysis();
    if (!cameraLoaded && state.camera.status.last_error) {
        $("camera-overlay").classList.remove("hidden");
        $("camera-overlay-copy").textContent = state.camera.status.last_error;
    }
    syncCamera();
}

function queueRefresh() {
    if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
    }

    const delay = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    pollTimer = window.setTimeout(async () => {
        await refreshDashboard(true);
        queueRefresh();
    }, delay);
}

async function refreshDashboard(silent = false) {
    try {
        const [state, sensorHistoryResponse, dailySummaryResponse] = await Promise.all([
            fetchDashboardState(),
            fetchSensorHistory(48),
            fetchDailySummaryHistory(14),
        ]);
        dashboardState = state;
        sensorHistory = sensorHistoryResponse.items;
        dailySummaryHistory = dailySummaryResponse.items;
        renderDashboard(state);
        setConnectionStatus(true, document.hidden ? "พักการ sync บางส่วน" : "Live sync");
    } catch (error) {
        setConnectionStatus(false, "Offline");
        if (!silent) {
            const message = error instanceof Error ? error.message : "โหลด dashboard ไม่สำเร็จ";
            setMessage(message, "error");
        }
    }
}

async function runAction(message, action) {
    try {
        await action();
        await refreshDashboard(true);
        setMessage(message);
    } catch (error) {
        const text = error instanceof Error ? error.message : "request failed";
        setMessage(text, "error");
    }
}

function bindRuleContainer(containerId) {
    $(containerId).addEventListener("click", async (event) => {
        if (!(event.target instanceof HTMLElement)) {
            return;
        }

        const deleteButton = event.target.closest("[data-rule-delete]");
        if (!(deleteButton instanceof HTMLButtonElement)) {
            return;
        }

        const ruleId = deleteButton.dataset.ruleId;
        if (!ruleId) {
            return;
        }

        await runAction("Schedule deleted", async () => {
            await deleteAutomationRule(ruleId);
        });
    });

    $(containerId).addEventListener("change", async (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
            return;
        }

        if (!event.target.matches("[data-rule-toggle]")) {
            return;
        }

        const ruleId = event.target.dataset.ruleId;
        if (!ruleId) {
            return;
        }

        await runAction(
            `Schedule ${event.target.checked ? "enabled" : "disabled"}`,
            async () => {
                await setAutomationRuleEnabled(ruleId, event.target.checked);
            },
        );
    });
}

function bindEvents() {
    setAnalysisRefreshState(false);
    setPredictionPreviewState(false);
    renderLiveCameraAnalysis();

    const cameraStream = document.getElementById("camera-stream");
    if (cameraStream instanceof HTMLImageElement) {
        cameraStream.addEventListener("load", () => {
            cameraLoaded = true;
            clearCameraTimer();
            $("camera-overlay").classList.add("hidden");
            queueNextCameraFrame(CAMERA_REFRESH_MS);
            if (!liveCameraAnalysis) {
                void refreshLiveCameraAnalysis(true);
            }
        });

        cameraStream.addEventListener("error", () => {
            cameraLoaded = false;
            $("camera-overlay").classList.remove("hidden");
            $("camera-overlay-copy").textContent =
                dashboardState?.camera.status.last_error ||
                "ไม่สามารถโหลด snapshot จากกล้องได้ กำลังลองใหม่";

            cameraStream.removeAttribute("src");
            clearCameraTimer();
            clearLiveAnalysisTimer();
            queueNextCameraFrame(CAMERA_RETRY_MS);
            queueLiveAnalysisRefresh(LIVE_ANALYSIS_RETRY_MS);
        });
    }

    $("camera-toggle").addEventListener("click", () => {
        cameraWanted = !cameraWanted;
        syncCamera();
    });

    $("analysis-refresh-button").addEventListener("click", async () => {
        if (analysisRefreshPending) {
            return;
        }

        analysisRefreshPending = true;
        setAnalysisRefreshState(true);
        try {
            await refreshDashboard(true);
            if (cameraWanted && !document.hidden) {
                await refreshLiveCameraAnalysis(true);
            }
            if (dashboardState) {
                renderDashboard(dashboardState);
            }
            setMessage("รีเฟรชข้อมูลวิเคราะห์และชุดข้อมูลสำหรับโมเดลแล้ว");
        } catch (error) {
            const text = error instanceof Error ? error.message : "รีเฟรชข้อมูลวิเคราะห์ไม่สำเร็จ";
            setMessage(text, "error");
        } finally {
            analysisRefreshPending = false;
            setAnalysisRefreshState(false);
        }
    });

    $("prediction-preview-button").addEventListener("click", async () => {
        if (predictionPreviewPending) {
            return;
        }

        predictionPreviewPending = true;
        setPredictionPreviewState(true);
        try {
            predictionPreview = await previewHarvestPrediction({
                lookback_days: 7,
                sensor_limit: 240,
            });
            if (dashboardState) {
                renderPredictionPreview(dashboardState);
            }
            setMessage("อัปเดต prediction preview แล้ว");
        } catch (error) {
            predictionPreview = null;
            const text = error instanceof Error ? error.message : "prediction preview ไม่สำเร็จ";
            setMessage(text, "error");
        } finally {
            predictionPreviewPending = false;
            setPredictionPreviewState(false);
        }
    });

    $("light-on-button").addEventListener("click", async () => {
        await runAction("Light turned on", async () => {
            await turnLight("on");
        });
    });

    $("light-off-button").addEventListener("click", async () => {
        await runAction("Light turned off", async () => {
            await turnLight("off");
        });
    });

    $("water-start-button").addEventListener("click", async () => {
        await runAction("Water pump started", async () => {
            await startWaterPump(readPositiveNumber("manual-water-duration"));
        });
    });

    $("water-stop-button").addEventListener("click", async () => {
        await runAction("Water pump stopped", async () => {
            await stopWaterPump();
        });
    });

    $("fertilizer-start-all-button").addEventListener("click", async () => {
        await runAction("All fertilizer pumps started", async () => {
            await startAllFertilizerPumps(readPositiveNumber("fertilizer-all-duration"));
        });
    });

    $("cycle-start-button").addEventListener("click", async () => {
        const activeCycle = dashboardState?.grow_cycle;
        if (cycleActionPending) {
            return;
        }

        if (activeCycle?.status === "active") {
            setMessage("มีรอบปลูกที่กำลัง active อยู่แล้ว", "error");
            return;
        }

        cycleActionPending = true;
        setCycleActionState(activeCycle ?? null, getCycleProgress(activeCycle ?? null, dashboardState?.meta.generated_at ?? new Date().toISOString()));
        try {
            await runAction("เริ่มรอบปลูกแล้ว", async () => {
                await startGrowCycle();
            });
        } finally {
            cycleActionPending = false;
            const { cycle, progress } = getActiveCycleProgress();
            setCycleActionState(cycle, progress);
        }
    });

    $("cycle-harvest-button").addEventListener("click", async () => {
        if (cycleActionPending) {
            return;
        }

        const { cycle, progress } = getActiveCycleProgress();
        if (!cycle) {
            setMessage("ยังไม่มีรอบปลูกที่ active อยู่", "error");
            return;
        }

        if (!window.confirm(buildHarvestConfirmationMessage(cycle, progress))) {
            setMessage("ยกเลิกการสิ้นสุดรอบปลูกแล้ว");
            return;
        }

        cycleActionPending = true;
        setCycleActionState(cycle, progress);
        try {
            await runAction("สิ้นสุดรอบปลูกแล้ว", async () => {
                await harvestGrowCycle();
            });
        } finally {
            cycleActionPending = false;
            const nextState = getActiveCycleProgress();
            setCycleActionState(nextState.cycle, nextState.progress);
        }
    });

    $("fertilizer-stop-all-button").addEventListener("click", async () => {
        await runAction("All fertilizer pumps stopped", async () => {
            await stopAllFertilizerPumps();
        });
    });

    $("pump-fertilizer-list").addEventListener("click", async (event) => {
        if (!(event.target instanceof HTMLElement)) {
            return;
        }

        const button = event.target.closest("[data-pump-action]");
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const pumpId = Number(button.dataset.pumpId);
        if (!Number.isFinite(pumpId)) {
            return;
        }

        if (button.dataset.pumpAction === "start") {
            await runAction(`Fertilizer pump ${pumpId} started`, async () => {
                await startFertilizerPump(pumpId, readPositiveNumber(`pump-duration-${pumpId}`));
            });
            return;
        }

        await runAction(`Fertilizer pump ${pumpId} stopped`, async () => {
            await stopFertilizerPump(pumpId);
        });
    });

    $("light-schedule-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const onTime = $("light-on-time").value;
        const offTime = $("light-off-time").value;
        const days = collectDays("light-days");

        if (days.length === 0) {
            setMessage("เลือกวันอย่างน้อย 1 วันก่อนสร้าง schedule", "error");
            return;
        }

        await runAction("Light schedule added", async () => {
            await createLightSchedule({
                on_time: onTime,
                off_time: offTime,
                days,
                enabled: true,
            });
        });
    });

    $("pump-water-schedule-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const startTime = $("pump-water-start-time").value;
        const days = collectDays("pump-water-days");

        if (days.length === 0) {
            setMessage("เลือกวันอย่างน้อย 1 วันก่อนสร้าง schedule", "error");
            return;
        }

        await runAction("Water pump schedule added", async () => {
            await createPumpWaterSchedule({
                start_time: startTime,
                duration_seconds: readPositiveNumber("pump-water-schedule-duration"),
                days,
                enabled: true,
            });
        });
    });

    bindRuleContainer("light-rule-list");
    bindRuleContainer("pump-water-rule-list");

    document.addEventListener("visibilitychange", () => {
        syncCamera();
        if (!document.hidden) {
            void refreshLiveCameraAnalysis(true);
        } else {
            clearLiveAnalysisTimer();
        }
        queueRefresh();
    });
}

async function bootstrap() {
    const root = document.getElementById("app");
    if (!root) {
        throw new Error("Missing app root");
    }

    root.innerHTML = createLayout();
    renderDayOptions("light-days", "light-days");
    renderDayOptions("pump-water-days", "pump-water-days");
    bindEvents();
    syncCamera();
    void refreshLiveCameraAnalysis(true);
    await refreshDashboard();
    queueRefresh();
}

void bootstrap();
