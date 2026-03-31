export interface SensorReading {
    _id: string
    temp?: number | null
    ph?: number | null
    timestamp?: string | null
}

export interface CameraStatus {
    device: string
    is_open: boolean
    last_error: string | null
    last_frame_at: number | null
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
