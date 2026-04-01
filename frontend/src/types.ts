export interface SensorReading {
    _id: string
    temp?: number | null
    ph?: number | null
    green_coverage_percent?: number | null
    coverage_method?: string | null
    coverage_version?: string | null
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
    image_path?: string | null
    image_url?: string | null
    mask_path?: string | null
    mask_url?: string | null
    overlay_path?: string | null
    overlay_url?: string | null
    green_coverage_percent?: number | null
    green_pixels?: number | null
    total_pixels?: number | null
    coverage_method?: string | null
    coverage_version?: string | null
    coverage_roi?: {
        x: number
        y: number
        width: number
        height: number
        corner_radius?: number | null
        reference_width?: number | null
        reference_height?: number | null
    } | null
    coverage_thresholds?: {
        h_min?: number | null
        h_max?: number | null
        s_min?: number | null
        v_min?: number | null
        exg_threshold?: string | null
        preprocess?: string | null
    } | null
    analysis_source_mode?: string | null
    analysis_source_label?: string | null
    analysis_source_selected_from?: string | null
    freshness_class?: string | null
    confidence?: number | null
}

export interface ImageAnalysisDebug {
    captured_at?: string | null
    source_mode?: string | null
    source_label?: string | null
    source_path?: string | null
    cycle_day_index?: number | null
    selected_from?: string | null
    requested_day_index?: number | null
    raw_url?: string | null
    mask_url?: string | null
    overlay_url?: string | null
}

export interface LiveCameraAnalysis {
    captured_at?: string | null
    green_coverage_percent?: number | null
    green_pixels?: number | null
    total_pixels?: number | null
    image_width?: number | null
    image_height?: number | null
    coverage_method?: string | null
    coverage_version?: string | null
    coverage_roi?: {
        x: number
        y: number
        width: number
        height: number
        corner_radius?: number | null
        reference_width?: number | null
        reference_height?: number | null
    } | null
    coverage_thresholds?: {
        h_min?: number | null
        h_max?: number | null
        s_min?: number | null
        v_min?: number | null
        exg_threshold?: string | null
        preprocess?: string | null
    } | null
    raw_url?: string | null
    mask_url?: string | null
    overlay_url?: string | null
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
    water_liters?: number | null
    remaining_liters?: number | null
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
    water_liters?: number | null
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
    image_analysis_debug: ImageAnalysisDebug | null
    daily_summary: DailySummary | null
    grow_cycle: GrowCycle | null
    actuators: ActuatorState
    automation: AutomationState
    prediction_latest?: unknown
    model_data?: {
        latest_seed_cycle_id?: string | null
        training_dataset_download_url?: string | null
        template_download_url?: string | null
        harvest_model_enabled?: boolean
        harvest_model_path?: string | null
        water_pump_dosing?: {
            pump_flow_l_per_min?: number | null
            seconds_per_liter?: number | null
        } | null
        fertilizer_dosing?: {
            pump_flow_ml_per_min?: number | null
            dose_ml_per_10l?: number | null
            dose_ml_per_liter?: number | null
            seconds_per_liter?: number | null
        } | null
    }
}

export interface HarvestPredictionPreviewResponse {
    prediction_type: string
    readiness: {
        ready: boolean
        blocking_reasons: string[]
        warnings: string[]
    }
    prediction?: {
        days_to_harvest?: number | null
        predicted_harvest_at?: string | null
        confidence_score?: number | null
        uncertainty_days?: number | null
        baseline_expected_days_to_harvest?: number | null
        baseline_expected_harvest_at?: string | null
    }
    model?: {
        available?: boolean
        name?: string | null
        version?: string | null
        source?: string | null
        feature_count?: number | null
        error?: string | null
    }
    feature_vector?: Record<string, number | null>
    feature_bundle: {
        cycle?: {
            cycle_id?: string | null
            name?: string | null
            cycle_day_index?: number | null
            target_harvest_days?: number | null
            expected_days_to_harvest?: number | null
            expected_harvest_at?: string | null
        }
        model_input?: {
            cycle_day_index?: number | null
            target_harvest_days?: number | null
            baseline_expected_days_to_harvest?: number | null
            lookback_days?: number | null
            summary_days_available?: number | null
            sensor_points_available?: number | null
            latest_temp_c?: number | null
            latest_ph?: number | null
            latest_green_coverage_percent?: number | null
            latest_daily_image_coverage_percent?: number | null
            window_sensor_coverage_trend?: number | null
            window_daily_image_coverage_trend?: number | null
        }
    }
}

export interface LightSchedulePayload {
    on_time: string
    off_time: string
    days: string[]
    enabled: boolean
}

export interface PumpWaterSchedulePayload {
    start_time: string
    water_liters: number
    days: string[]
    enabled: boolean
}
