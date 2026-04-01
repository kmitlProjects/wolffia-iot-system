async function requestJson(url, init) {
    const response = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
        ? await response.json()
        : {};

    if (!response.ok) {
        const message = data.detail || data.error || "request failed";
        throw new Error(message);
    }

    return data;
}

function extractFilename(response, fallback) {
    const header = response.headers.get("content-disposition") ?? "";
    const match = header.match(/filename="?([^"]+)"?/);
    return match?.[1] || fallback;
}

async function requestDownload(url, fallbackFilename) {
    const response = await fetch(url, {
        headers: {
            Accept: "text/csv,application/octet-stream,*/*",
        },
    });

    if (!response.ok) {
        let message = "request failed";
        try {
            const data = await response.json();
            message = data.detail || data.error || message;
        } catch {
            message = response.statusText || message;
        }
        throw new Error(message);
    }

    return {
        blob: await response.blob(),
        filename: extractFilename(response, fallbackFilename),
        headers: response.headers,
    };
}

export function fetchDashboardState() {
    return requestJson("/dashboard-state");
}

export function fetchSensorHistory(limit = 48) {
    return requestJson(`/sensor-history?limit=${limit}`);
}

export function fetchDailySummaryHistory(limit = 14) {
    return requestJson(`/daily-summary/history?limit=${limit}`);
}

export function analyzeImageNow() {
    return requestJson("/image-analysis/analyze-now", {
        method: "POST",
    });
}

export function fetchLiveCameraAnalysis(force = false) {
    return requestJson(`/camera/analysis-preview?force=${force ? "true" : "false"}`);
}

export function downloadModelDataTemplate() {
    return requestDownload(
        "/model-data/template/download",
        "image_seed_readings_template.csv",
    );
}

export function exportTrainingDataset() {
    return requestDownload(
        "/model-data/training-dataset/download?allow_missing_sensor=true",
        "harvest_training_dataset.csv",
    );
}

export function importModelDataTemplate(payload) {
    return requestJson("/model-data/template/import", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function previewHarvestPrediction(payload = {}) {
    return requestJson("/predictions/harvest/preview", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function startGrowCycle() {
    return requestJson("/grow-cycles/start", {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export function harvestGrowCycle() {
    return requestJson("/grow-cycles/harvest", {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export function turnLight(action) {
    return requestJson(`/actuators/light/${action}`, { method: "POST" });
}

export function startWaterPump(waterLiters) {
    return requestJson("/actuators/pump-water/start", {
        method: "POST",
        body: JSON.stringify({ water_liters: waterLiters }),
    });
}

export function stopWaterPump() {
    return requestJson("/actuators/pump-water/stop", { method: "POST" });
}

export function startFertilizerPump(pumpId, waterLiters) {
    return requestJson(`/actuators/pump-fertilizer/${pumpId}/start`, {
        method: "POST",
        body: JSON.stringify({ water_liters: waterLiters }),
    });
}

export function stopFertilizerPump(pumpId) {
    return requestJson(`/actuators/pump-fertilizer/${pumpId}/stop`, {
        method: "POST",
    });
}

export function createLightSchedule(payload) {
    return requestJson("/automation/light", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function createPumpWaterSchedule(payload) {
    return requestJson("/automation/pump-water", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function setAutomationRuleEnabled(ruleId, enabled) {
    return requestJson(`/automation/rules/${ruleId}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
    });
}

export function deleteAutomationRule(ruleId) {
    return requestJson(`/automation/rules/${ruleId}`, {
        method: "DELETE",
    });
}
