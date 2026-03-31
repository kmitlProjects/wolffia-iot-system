export interface SensorReading {
    _id: string
    temp?: number | null
    ph?: number | null
    green_coverage_percent?: number | null
    timestamp?: string | null
}

export interface CameraStatus {
    device: string
    is_open: boolean
    last_error: string | null
    last_frame_at: number | null
}

export interface ImageAnalysis {
    _id: string
    date: string
    timestamp?: string | null
    image_path: string
    image_url?: string | null
    mask_url?: string | null
    overlay_url?: string | null
    green_coverage_percent?: number | null
    freshness_class?: string | null
    confidence?: number | null
}

export interface DailySummary {
    _id: string
    date: string
    timezone?: string | null
    cycle_id?: string | null
    cycle_name?: string | null
    cycle_status?: string | null
    cycle_planted_at?: string | null
    cycle_day_index?: number | null
    target_harvest_days?: number | null
    expected_harvest_at?: string | null
    expected_days_to_harvest?: number | null
    sensor_count?: number | null
    coverage_count?: number | null
    first_sensor_at?: string | null
    last_sensor_at?: string | null
    temp_avg?: number | null
    temp_min?: number | null
    temp_max?: number | null
    ph_avg?: number | null
    ph_min?: number | null
    ph_max?: number | null
    green_coverage_avg?: number | null
    green_coverage_min?: number | null
    green_coverage_max?: number | null
    daily_image_coverage_percent?: number | null
    image_url?: string | null
    mask_url?: string | null
    overlay_url?: string | null
    updated_at?: string | null
}

export interface GrowCycle {
    _id: string
    cycle_id: string
    name?: string | null
    status: string
    planted_at?: string | null
    harvested_at?: string | null
    target_harvest_days?: number | null
    actual_duration_days?: number | null
    expected_harvest_at?: string | null
    notes?: string | null
}

export interface LightStatus {
    pin: number
    active_low: boolean
    is_on: boolean
    raw_level: number
}

export interface PumpWaterStatus {
    pin: number
    active_low: boolean
    is_running: boolean
    duration_seconds: number
    remaining_seconds: number
}

export interface FertilizerPumpStatus {
    id: number
    pin: number
    active_low: boolean
    is_running: boolean
    duration_seconds: number
    remaining_seconds: number
}

export interface PumpFertilizerStatus {
    pump_count: number
    running_count: number
    active_low: boolean
    pumps: FertilizerPumpStatus[]
}

export interface ActuatorState {
    light: LightStatus
    pump_water: PumpWaterStatus
    pump_fertilizer: PumpFertilizerStatus
}

export interface LightRule {
    id: string
    device: "light"
    enabled: boolean
    days: string[]
    on_time: string
    off_time: string
    created_at?: string | null
    updated_at?: string | null
}

export interface PumpWaterRule {
    id: string
    device: "pump_water"
    enabled: boolean
    days: string[]
    start_time: string
    duration_seconds: number
    created_at?: string | null
    updated_at?: string | null
}

export interface AutomationState {
    timezone: string
    light: LightRule[]
    pump_water: PumpWaterRule[]
}

export interface DashboardState {
    meta: {
        generated_at: string
        timezone: string
    }
    camera: {
        stream_url: string
        status: CameraStatus
    }
    sensor: SensorReading | null
    image_analysis: ImageAnalysis | null
    daily_summary: DailySummary | null
    grow_cycle: GrowCycle | null
    actuators: ActuatorState
    automation: AutomationState
}

export interface LightSchedulePayload {
    on_time: string
    off_time: string
    days: string[]
    enabled: boolean
}

export interface PumpWaterSchedulePayload {
    start_time: string
    duration_seconds: number
    days: string[]
    enabled: boolean
}
