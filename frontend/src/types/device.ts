export interface Position {
  x: number
  y: number
  z: number
  a?: number
  b?: number
  c?: number
}

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
}

export interface DeviceCapabilities {
  axes: string[]
  has_spindle: boolean
  has_laser: boolean
  has_coolant: boolean
  has_probe: boolean
  has_tool_changer: boolean
  max_feed_rate: number
  max_spindle_speed: number
  max_laser_power: number
  work_envelope: {
    x: number
    y: number
    z: number
  }
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
}
