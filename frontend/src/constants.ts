export const DAY_OPTIONS = [
    ["mon", "Mon"],
    ["tue", "Tue"],
    ["wed", "Wed"],
    ["thu", "Thu"],
    ["fri", "Fri"],
    ["sat", "Sat"],
    ["sun", "Sun"],
] as const

export const EVERYDAY_VALUES = DAY_OPTIONS.map(([value]) => value)

export const POLL_VISIBLE_MS = 30000
export const POLL_HIDDEN_MS = 30000
export const ANOMALY_POLL_MS = 5000
export const CAMERA_REFRESH_MS = 2500
export const CAMERA_RETRY_MS = 3000
export const LIVE_ANALYSIS_REFRESH_MS = 8000
export const LIVE_ANALYSIS_RETRY_MS = 10000

export const DEFAULT_WATER_PUMP_LITERS = "1"
export const DEFAULT_FERTILIZER_WATER_LITERS = "10"
export const FALLBACK_TIMEZONE = "Asia/Bangkok"
