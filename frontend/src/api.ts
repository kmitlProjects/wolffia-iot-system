import type {
    AnomalyAlert,
    AnomalyCheckResult,
    AnomalyWatchStatus,
    DailySummary,
    DashboardState,
    HarvestPredictionPreviewResponse,
    LightSchedulePayload,
    LiveCameraAnalysis,
    PumpWaterSchedulePayload,
    SensorReading,
} from "./types.js"

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    })

    const contentType = response.headers.get("content-type") ?? ""
    const data = contentType.includes("application/json")
        ? await response.json()
        : {}

    if (!response.ok) {
        const message =
            (data as { detail?: string; error?: string }).detail ||
            (data as { detail?: string; error?: string }).error ||
            "request failed"
        throw new Error(message)
    }

    return data as T
}

function extractFilename(response: Response, fallback: string): string {
    const header = response.headers.get("content-disposition") ?? ""
    const match = header.match(/filename="?([^"]+)"?/)
    return match?.[1] || fallback
}

async function requestDownload(
    url: string,
    fallbackFilename: string,
): Promise<{
    blob: Blob
    filename: string
    headers: Headers
}> {
    const response = await fetch(url, {
        headers: {
            Accept: "text/csv,application/octet-stream,*/*",
        },
    })

    if (!response.ok) {
        let message = "request failed"
        try {
            const data = await response.json()
            message =
                (data as { detail?: string; error?: string }).detail ||
                (data as { detail?: string; error?: string }).error ||
                message
        } catch {
            message = response.statusText || message
        }
        throw new Error(message)
    }

    return {
        blob: await response.blob(),
        filename: extractFilename(response, fallbackFilename),
        headers: response.headers,
    }
}

export function fetchDashboardState(): Promise<DashboardState> {
    return requestJson<DashboardState>("/dashboard-state")
}

export function fetchSensorHistory(limit = 48): Promise<{ items: SensorReading[] }> {
    return requestJson(`/sensor-history?limit=${limit}`)
}

export function fetchDailySummaryHistory(limit = 14): Promise<{ items: DailySummary[] }> {
    return requestJson(`/daily-summary/history?limit=${limit}`)
}

export function analyzeImageNow(): Promise<{ analysis: unknown }> {
    return requestJson("/image-analysis/analyze-now", {
        method: "POST",
    })
}

export function fetchLiveCameraAnalysis(
    force = false,
): Promise<{ analysis: LiveCameraAnalysis }> {
    return requestJson(`/camera/analysis-preview?force=${force ? "true" : "false"}`)
}

export function fetchAnomalyWatchStatus(): Promise<{
    watcher: AnomalyWatchStatus
    latest_alert?: AnomalyAlert | null
    latest_preview_url?: string | null
    latest_preview_token?: string | null
}> {
    return requestJson("/anomaly-watch/status")
}

export function fetchAnomalyAlerts(limit = 1): Promise<{
    items: AnomalyAlert[]
}> {
    return requestJson(`/anomaly-alerts?limit=${limit}`)
}

export function checkAnomalyNow(): Promise<{
    result: AnomalyCheckResult
}> {
    return requestJson("/anomaly-watch/check-now", {
        method: "POST",
    })
}

export function downloadModelDataTemplate(): Promise<{
    blob: Blob
    filename: string
    headers: Headers
}> {
    return requestDownload(
        "/model-data/template/download",
        "image_seed_readings_template.csv",
    )
}

export function exportTrainingDataset(): Promise<{
    blob: Blob
    filename: string
    headers: Headers
}> {
    return requestDownload(
        "/model-data/training-dataset/download?allow_missing_sensor=true",
        "harvest_training_dataset.csv",
    )
}

export function importModelDataTemplate(payload: {
    cycle_id: string
    csv_text: string
    filename?: string
    skip_blank_rows?: boolean
}): Promise<{
    import_result: {
        cycle_id: string
        rows_updated: number
        affected_dates: string[]
        input_csv: string
    }
}> {
    return requestJson("/model-data/template/import", {
        method: "POST",
        body: JSON.stringify(payload),
    })
}

export function importTimeseriesGapCsv(payload: {
    cycle_id: string
    csv_text: string
    filename?: string
    skip_blank_rows?: boolean
}): Promise<{
    import_result: {
        cycle_id: string
        rows_created: number
        rows_updated: number
        affected_dates: string[]
    }
}> {
    return requestJson("/timeseries/gap-import", {
        method: "POST",
        body: JSON.stringify(payload),
    })
}

export function previewHarvestPrediction(
    payload: { lookback_days?: number; sensor_limit?: number } = {},
): Promise<HarvestPredictionPreviewResponse> {
    return requestJson("/predictions/harvest/preview", {
        method: "POST",
        body: JSON.stringify(payload),
    })
}

export function setTimeseriesCapturePolicy(
    payload: { mode: "keep_light_state" | "force_light_off"; light_settle_seconds?: number },
): Promise<{
    capture_policy: {
        mode?: string | null
        force_light_off?: boolean | null
        light_settle_seconds?: number | null
        restore_light_after_capture?: boolean | null
    }
}> {
    return requestJson("/timeseries/capture-policy", {
        method: "PATCH",
        body: JSON.stringify(payload),
    })
}

export function startGrowCycle(): Promise<{ grow_cycle: unknown }> {
    return requestJson("/grow-cycles/start", {
        method: "POST",
        body: JSON.stringify({}),
    })
}

export function harvestGrowCycle(): Promise<{ grow_cycle: unknown }> {
    return requestJson("/grow-cycles/harvest", {
        method: "POST",
        body: JSON.stringify({}),
    })
}

export function turnLight(action: "on" | "off"): Promise<{ light: unknown }> {
    return requestJson(`/actuators/light/${action}`, { method: "POST" })
}

export function startWaterPump(waterLiters: number): Promise<{ pump_water: unknown }> {
    return requestJson("/actuators/pump-water/start", {
        method: "POST",
        body: JSON.stringify({ water_liters: waterLiters }),
    })
}

export function stopWaterPump(): Promise<{ pump_water: unknown }> {
    return requestJson("/actuators/pump-water/stop", { method: "POST" })
}

export function startFertilizerPump(
    pumpId: number,
    waterLiters: number,
): Promise<{ pump_fertilizer: unknown }> {
    return requestJson(`/actuators/pump-fertilizer/${pumpId}/start`, {
        method: "POST",
        body: JSON.stringify({ water_liters: waterLiters }),
    })
}

export function stopFertilizerPump(
    pumpId: number,
): Promise<{ pump_fertilizer: unknown }> {
    return requestJson(`/actuators/pump-fertilizer/${pumpId}/stop`, {
        method: "POST",
    })
}

export function createLightSchedule(
    payload: LightSchedulePayload,
): Promise<{ rule: unknown }> {
    return requestJson("/automation/light", {
        method: "POST",
        body: JSON.stringify(payload),
    })
}

export function createPumpWaterSchedule(
    payload: PumpWaterSchedulePayload,
): Promise<{ rule: unknown }> {
    return requestJson("/automation/pump-water", {
        method: "POST",
        body: JSON.stringify(payload),
    })
}

export function setAutomationRuleEnabled(
    ruleId: string,
    enabled: boolean,
): Promise<{ rule: unknown }> {
    return requestJson(`/automation/rules/${ruleId}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
    })
}

export function deleteAutomationRule(ruleId: string): Promise<{ deleted: boolean }> {
    return requestJson(`/automation/rules/${ruleId}`, {
        method: "DELETE",
    })
}
