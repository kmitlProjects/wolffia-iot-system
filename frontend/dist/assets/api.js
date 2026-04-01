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

export function startWaterPump(durationSeconds) {
    return requestJson("/actuators/pump-water/start", {
        method: "POST",
        body: JSON.stringify({ duration_seconds: durationSeconds }),
    });
}

export function stopWaterPump() {
    return requestJson("/actuators/pump-water/stop", { method: "POST" });
}

export function startAllFertilizerPumps(durationSeconds) {
    return requestJson("/actuators/pump-fertilizer/start", {
        method: "POST",
        body: JSON.stringify({ duration_seconds: durationSeconds }),
    });
}

export function stopAllFertilizerPumps() {
    return requestJson("/actuators/pump-fertilizer/stop", { method: "POST" });
}

export function startFertilizerPump(pumpId, durationSeconds) {
    return requestJson(`/actuators/pump-fertilizer/${pumpId}/start`, {
        method: "POST",
        body: JSON.stringify({ duration_seconds: durationSeconds }),
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
