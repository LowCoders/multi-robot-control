export interface Position {
  x: number
  y: number
  z: number
  a?: number
  b?: number
  c?: number
}

export type GripperState = 'open' | 'closed' | 'unknown'

export interface DeviceStatus {
  state: DeviceState
  position: Position
  work_position: Position
  feed_rate: number
  spindle_speed: number
  laser_power: number
  progress: number
  current_line: number
  total_lines: number
  current_file: string | null
  error_message: string | null
  feed_override: number
  spindle_override: number
  // Robot arm specific
  gripper_state?: GripperState
  sucker_state?: boolean
  // Endstop states per axis (true = triggered)
  endstop_states?: Record<string, boolean>
  // Endstop blocked directions: {'Y': 'positive', ...}
  endstop_blocked?: Record<string, string>
  // Dynamic limits per axis: {'X': {min: -175, max: 175}, ...}
  dynamic_limits?: Record<string, AxisLimit>
}

export interface AxisLimit {
  min: number
  max: number
}

export interface DeviceCapabilities {
  axes: string[]
  has_spindle: boolean
  has_laser: boolean
  has_coolant: boolean
  has_probe: boolean
  has_tool_changer: boolean
  has_gripper: boolean
  has_sucker: boolean
  has_endstops?: boolean
  has_vacuum_pump?: boolean
  supports_motion_test?: boolean
  supports_firmware_probe?: boolean
  supports_soft_limits?: boolean
  supports_streaming_jog?: boolean
  supports_hard_jog_stop?: boolean
  supports_panel_controller?: boolean
  max_feed_rate: number
  max_spindle_speed: number
  max_laser_power: number
  work_envelope: {
    x: number
    y: number
    z: number
  }
  // Per-axis software limits
  axis_limits?: Record<string, AxisLimit>
}

export interface DeviceControlState {
  owner: 'host' | 'panel' | 'none'
  lock_state: 'granted' | 'requested' | 'denied'
  reason?: string | null
  version: number
  last_changed_by?: string
  requested_owner?: string | null
  can_take_control?: boolean
}

export type DeviceState = 
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'running'
  | 'paused'
  | 'alarm'
  | 'homing'
  | 'probing'
  | 'jog'

export type DeviceType = 
  | 'cnc_mill'
  | 'cnc_lathe'
  | 'laser_cutter'
  | 'laser_engraver'
  | 'printer_3d'
  | 'robot_arm'
  | 'tube_bender'
  | 'custom'

export interface Device {
  id: string
  name: string
  type: DeviceType
  driver: string
  connected: boolean
  state: DeviceState
  simulated?: boolean
  connectionInfo?: string
  lastError?: string | null
  status?: DeviceStatus
  capabilities?: DeviceCapabilities
  control?: DeviceControlState
}
