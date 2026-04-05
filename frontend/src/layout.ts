import { renderIcon } from "./html.js?v=20260405ae"

export function createLayout(): string {
    return `
        <div class="app-shell">
            <main class="dashboard-grid">
                <aside id="info-rail-section" class="panel info-rail-panel">
                    <div class="panel-inner info-rail-inner">
                        <div class="info-rail-copy hero-copy">
                            <span class="eyebrow">Wolffia Dashboard</span>
                            <h1>ภาพสด ควบคุมอุปกรณ์ และข้อมูลสำคัญในหน้าเดียว</h1>
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
                            <article class="summary-card info-rail-card anomaly-watch-card info-rail-anomaly-card">
                                <div class="summary-card-head">
                                    <span class="card-label">Anomaly Watch</span>
                                    <div class="anomaly-watch-head-tools">
                                        <button id="anomaly-check-button" class="anomaly-watch-db-button" type="button">
                                            ${renderIcon("camera.svg", "ตรวจสิ่งแปลกปลอมทันที", "anomaly-watch-db-icon")}
                                            <span>ตรวจทันที</span>
                                        </button>
                                        <span id="anomaly-watch-chip" class="mini-chip">-</span>
                                    </div>
                                </div>
                                <strong id="anomaly-watch-title">-</strong>
                                <span id="anomaly-watch-copy" class="helper-text">-</span>
                                <div id="anomaly-watch-metrics" class="anomaly-watch-metrics">
                                    <div class="anomaly-watch-metric">
                                        <span class="anomaly-watch-metric-label">Surface Blob</span>
                                        <strong>-</strong>
                                        <span class="helper-text">-</span>
                                    </div>
                                </div>
                                <span id="anomaly-watch-debug-copy" class="helper-text anomaly-watch-debug-copy">-</span>
                                <span id="anomaly-watch-last-copy" class="helper-text timeseries-capture-last-copy">-</span>
                                <div id="anomaly-watch-preview-wrap" class="anomaly-watch-preview hidden">
                                    <img id="anomaly-watch-preview" class="anomaly-watch-preview-image" alt="ภาพแจ้งเตือนล่าสุด">
                                </div>
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
                            <section id="camera-gap-block" class="camera-gap-block advanced-tools-card">
                                <div class="panel-title">
                                    <h3 class="section-heading">
                                        ${renderIcon("stat.svg", "Timeseries Gap Fill", "section-icon")}
                                        <span>Timeseries Gap Fill</span>
                                    </h3>
                                    <p>ตรวจชั่วโมงที่ขาดของรอบปลูก แล้วเติม temp/pH ย้อนหลังจากส่วนนี้ได้ทันที</p>
                                </div>
                                <div id="camera-gap-summary" class="analysis-preview-note"></div>
                                <div id="camera-gap-content" class="camera-gap-content">
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
                                                ใช้เมื่ออยากเติม temp/pH ย้อนหลังทั้งชุดสำหรับ seed cycle โดยไม่ต้องเปิด section อื่นเพิ่ม
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
                            </section>
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
