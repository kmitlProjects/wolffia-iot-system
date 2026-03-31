import {
    createLightSchedule,
    createPumpWaterSchedule,
    deleteAutomationRule,
    fetchDailySummaryHistory,
    fetchDashboardState,
    fetchSensorHistory,
    harvestGrowCycle,
    setAutomationRuleEnabled,
    startAllFertilizerPumps,
    startFertilizerPump,
    startGrowCycle,
    startWaterPump,
    stopAllFertilizerPumps,
    stopFertilizerPump,
    stopWaterPump,
    turnLight,
} from "./api.js"
import type {
    DailySummary,
    DashboardState,
    FertilizerPumpStatus,
    ImageAnalysis,
    LightRule,
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
const DEFAULT_PUMP_DURATION = "5"

let dashboardState: DashboardState | null = null
let sensorHistory: SensorReading[] = []
let dailySummaryHistory: DailySummary[] = []
let pollTimer: number | undefined
let messageTimer: number | undefined
let cameraRetryTimer: number | undefined
let cameraWanted = true
let cameraLoaded = false

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
                            <span class="mini-chip">Camera MJPEG คืองานที่หนักสุดของระบบ</span>
                        </div>
                    </div>
                </div>
            </header>

            <main class="dashboard-grid">
                <section class="panel camera-panel">
                    <div class="panel-inner">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h2>Live Camera</h2>
                                <p>เปิดเฉพาะเวลาต้องดูภาพจริง ๆ เพื่อช่วยลดภาระ Raspberry Pi</p>
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
                    <section class="panel">
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

                    <section class="panel">
                        <div class="panel-inner">
                            <div class="panel-title">
                                <h2>Daily Summary</h2>
                                <p>สรุประดับวันพร้อมรูป archive 1 ชุด และประวัติ coverage สำหรับเช็ก trend</p>
                            </div>
                            <div id="daily-summary-highlights" class="daily-highlight-grid"></div>
                            <div id="analysis-image-strip" class="image-strip"></div>
                            <div id="daily-summary-list" class="history-list"></div>
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

function formatDays(days: string[]): string {
    return days
        .map((day) => DAY_OPTIONS.find(([value]) => value === day)?.[1] ?? day)
        .join(" • ")
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
    summaries: DailySummary[],
): void {
    const summaryContainer = $("daily-summary-highlights")
    if (!latestSummary) {
        summaryContainer.innerHTML = `
            <div class="summary-card">
                <span class="card-label">Daily Summary</span>
                <strong>-</strong>
                <span class="helper-text">ยังไม่มีข้อมูลสรุปรายวัน</span>
            </div>
        `
    } else {
        summaryContainer.innerHTML = `
            <article class="summary-card">
                <span class="card-label">Latest Day</span>
                <strong>${escapeHtml(latestSummary.date)}</strong>
                <span class="helper-text">${latestSummary.sensor_count ?? 0} hourly points</span>
            </article>
            <article class="summary-card">
                <span class="card-label">Coverage Avg</span>
                <strong>${formatNumber(latestSummary.green_coverage_avg, 2)} %</strong>
                <span class="helper-text">
                    min ${formatNumber(latestSummary.green_coverage_min, 2)} •
                    max ${formatNumber(latestSummary.green_coverage_max, 2)}
                </span>
            </article>
            <article class="summary-card">
                <span class="card-label">Temp / pH Avg</span>
                <strong>${formatNumber(latestSummary.temp_avg, 1)} °C</strong>
                <span class="helper-text">pH ${formatNumber(latestSummary.ph_avg, 2)}</span>
            </article>
        `
    }

    const imageStrip = $("analysis-image-strip")
    const rawUrl = latestImage?.image_url ?? latestSummary?.image_url ?? null
    const maskUrl = latestImage?.mask_url ?? latestSummary?.mask_url ?? null
    const overlayUrl = latestImage?.overlay_url ?? latestSummary?.overlay_url ?? null
    const imageTiles = [
        ["Raw Archive", rawUrl],
        ["Green Mask", maskUrl],
        ["Overlay", overlayUrl],
    ].filter(([, url]) => Boolean(url))

    if (imageTiles.length === 0) {
        imageStrip.innerHTML = `<div class="rule-card rule-empty">ยังไม่มีรูป archive ของวันล่าสุด</div>`
    } else {
        imageStrip.innerHTML = imageTiles.map(([label, url]) => `
            <a class="image-tile" href="${escapeHtml(url ?? "")}" target="_blank" rel="noreferrer">
                <img alt="${escapeHtml(label)}" loading="lazy" src="${escapeHtml(url ?? "")}">
                <span>${escapeHtml(label)}</span>
            </a>
        `).join("")
    }

    const listContainer = $("daily-summary-list")
    if (summaries.length === 0) {
        listContainer.innerHTML = `<div class="rule-card rule-empty">ยังไม่มีประวัติ daily summary</div>`
        return
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
                <span>Coverage max ${formatNumber(summary.green_coverage_max, 2)}%</span>
            </div>
            <div class="history-links">
                ${
                    summary.image_url
                        ? `<a class="hero-link" href="${escapeHtml(summary.image_url)}" target="_blank" rel="noreferrer">raw</a>`
                        : ""
                }
                ${
                    summary.mask_url
                        ? `<a class="hero-link" href="${escapeHtml(summary.mask_url)}" target="_blank" rel="noreferrer">mask</a>`
                        : ""
                }
                ${
                    summary.overlay_url
                        ? `<a class="hero-link" href="${escapeHtml(summary.overlay_url)}" target="_blank" rel="noreferrer">overlay</a>`
                        : ""
                }
            </div>
        </article>
    `).join("")
}

function renderLightRules(rules: LightRule[]): void {
    const container = $("light-rule-list")
    if (rules.length === 0) {
        container.innerHTML = `<div class="rule-card rule-empty">ยังไม่มี light schedule</div>`
        return
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
    ).join("")
}

function renderFertilizerPumps(pumps: FertilizerPumpStatus[]): void {
    const existingValues = new Map<number, string>()
    document
        .querySelectorAll<HTMLInputElement>("[data-fertilizer-duration]")
        .forEach((input) => {
            existingValues.set(Number(input.dataset.pumpId), input.value)
        })

    $("pump-fertilizer-list").innerHTML = pumps.map((pump) => {
        const statusText = pump.is_running
            ? `RUNNING • ${pump.remaining_seconds}s left`
            : "OFF"
        const defaultValue = existingValues.get(pump.id) ?? DEFAULT_PUMP_DURATION

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
        `
    }).join("")
}

function syncCamera(): void {
    const stream = document.getElementById("camera-stream") as HTMLImageElement | null
    const overlay = $("camera-overlay")
    const overlayCopy = $("camera-overlay-copy")
    const button = $("camera-toggle")
    const streamUrl = dashboardState?.camera.stream_url ?? "/video"
    const shouldStream = cameraWanted && !document.hidden

    if (!stream) {
        return
    }

    if (shouldStream) {
        if (stream.getAttribute("src") !== streamUrl) {
            cameraLoaded = false
            stream.setAttribute("src", streamUrl)
        }
        button.textContent = "Pause Camera"
        if (cameraLoaded) {
            overlay.classList.add("hidden")
        } else {
            overlay.classList.remove("hidden")
            overlayCopy.textContent =
                dashboardState?.camera.status.last_error ||
                "กำลังเชื่อมต่อกล้อง..."
        }
        return
    }

    stream.removeAttribute("src")
    cameraLoaded = false
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
        ? `${waterPump.remaining_seconds}s left on GPIO ${waterPump.pin}`
        : `GPIO ${waterPump.pin} • waiting for manual or scheduled run`

    $("fertilizer-summary").textContent = `${fertilizer.running_count}/${fertilizer.pump_count} running`
    $("grow-cycle-status-chip").textContent = cycleProgress
        ? `DAY ${cycleProgress.dayIndex}/${cycle?.target_harvest_days ?? "-"}`
        : "IDLE"
    $("grow-cycle-copy").textContent = cycleProgress
        ? `${cycle?.name || cycle?.cycle_id || "active cycle"} • เหลือ ${cycleProgress.remainingDays} วันตามแผน`
        : "ยังไม่มีรอบปลูก active อยู่"

    renderLightRules(state.automation.light)
    renderPumpWaterRules(state.automation.pump_water)
    renderFertilizerPumps(fertilizer.pumps)
    renderSensorCharts(sensorHistory)
    renderDailySummarySection(state.daily_summary, state.image_analysis, dailySummaryHistory)

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
    const cameraStream = document.getElementById("camera-stream") as HTMLImageElement | null
    if (cameraStream) {
        cameraStream.addEventListener("load", () => {
            cameraLoaded = true
            $("camera-overlay").classList.add("hidden")
        })

        cameraStream.addEventListener("error", () => {
            cameraLoaded = false
            $("camera-overlay").classList.remove("hidden")
            $("camera-overlay-copy").textContent =
                dashboardState?.camera.status.last_error ||
                "ไม่สามารถโหลดภาพจากกล้องได้ กำลังลองเชื่อมต่อใหม่"

            cameraStream.removeAttribute("src")
            if (cameraRetryTimer !== undefined) {
                window.clearTimeout(cameraRetryTimer)
            }

            cameraRetryTimer = window.setTimeout(() => {
                syncCamera()
            }, 1500)
        })
    }

    $("camera-toggle").addEventListener("click", () => {
        cameraWanted = !cameraWanted
        syncCamera()
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
            await startWaterPump(readPositiveNumber("manual-water-duration"))
        })
    })

    $("water-stop-button").addEventListener("click", async () => {
        await runAction("Water pump stopped", async () => {
            await stopWaterPump()
        })
    })

    $("fertilizer-start-all-button").addEventListener("click", async () => {
        await runAction("All fertilizer pumps started", async () => {
            await startAllFertilizerPumps(readPositiveNumber("fertilizer-all-duration"))
        })
    })

    $("cycle-start-button").addEventListener("click", async () => {
        await runAction("เริ่มรอบปลูกแล้ว", async () => {
            await startGrowCycle()
        })
    })

    $("cycle-harvest-button").addEventListener("click", async () => {
        await runAction("สิ้นสุดรอบปลูกแล้ว", async () => {
            await harvestGrowCycle()
        })
    })

    $("fertilizer-stop-all-button").addEventListener("click", async () => {
        await runAction("All fertilizer pumps stopped", async () => {
            await stopAllFertilizerPumps()
        })
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
            await runAction(`Fertilizer pump ${pumpId} started`, async () => {
                await startFertilizerPump(pumpId, readPositiveNumber(`pump-duration-${pumpId}`))
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
                duration_seconds: readPositiveNumber("pump-water-schedule-duration"),
                days,
                enabled: true,
            })
        })
    })

    bindRuleContainer("light-rule-list")
    bindRuleContainer("pump-water-rule-list")

    document.addEventListener("visibilitychange", () => {
        syncCamera()
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
    await refreshDashboard()
    queueRefresh()
}

void bootstrap()
