import type { CoverageRoi, CoverageThresholds } from "./types.js"

export function formatNumber(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-"
    }
    return Number(value).toFixed(digits)
}

export function formatTimestamp(value: string | null | undefined): string {
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

export function formatTimeOnly(value: string | null | undefined): string {
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

export function formatCountdownLabel(totalSeconds: number): string {
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

export function formatInteger(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-"
    }

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
    }).format(value)
}

export function formatDateLabel(value: string | null | undefined): string {
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

export function formatFullDateLabel(value: string | null | undefined): string {
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

export function slugToFriendlyLabel(value: string | null | undefined): string {
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

export function formatCoverageMethod(value: string | null | undefined): string {
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

export function formatCoverageProcess(
    thresholds: CoverageThresholds | null | undefined,
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

export function formatSourceMode(value: string | null | undefined): string {
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

export function formatRoiSize(roi: CoverageRoi | null | undefined): string {
    if (!roi?.width || !roi?.height) {
        return "-"
    }

    return `${formatNumber(roi.width, 0)} × ${formatNumber(roi.height, 0)} px`
}
