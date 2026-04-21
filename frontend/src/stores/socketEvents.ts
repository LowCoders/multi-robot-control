/**
 * Socket.IO esemény-alakok — a kliens `Socket<Listen, Emit>` típusához.
 * A backend `StateManager` ezeket az eseményneveket használja.
 */

import type { Device, DeviceStatus, Position, DeviceCapabilities, DeviceControlState } from '../types/device'

export interface ServerToClientEvents {
  'devices:list': (data: { devices: Device[] }) => void
  'device:status': (data: { deviceId: string; status: DeviceStatus }) => void
  'device:position': (data: { deviceId: string; position: Position }) => void
  'device:state_change': (data: { deviceId: string; newState: string }) => void
  'device:capabilities': (data: { deviceId: string; capabilities: DeviceCapabilities }) => void
  'device:control_state': (data: { deviceId: string; control: DeviceControlState }) => void
  'device:control_denied': (data: {
    deviceId: string
    reason: string
    control: DeviceControlState
  }) => void
  'device:error': (data: { deviceId: string; message: string }) => void
  'job:progress': (data: {
    deviceId: string
    progress: number
    currentLine: number
    totalLines: number
  }) => void
  'job:complete': (data: { deviceId: string; file: string }) => void
}

export interface ClientToServerEvents {
  'device:command': (data: {
    deviceId: string
    command: string
    params?: Record<string, unknown>
  }) => void
  'device:jog': (data: {
    deviceId: string
    axis: string
    distance: number
    feedRate: number
    mode?: string
  }) => void
  'device:jog:start': (data: {
    deviceId: string
    axis: string
    direction: number
    feedRate: number
    mode?: string
    heartbeatTimeout?: number
    tickMs?: number
  }) => void
  'device:jog:beat': (data: {
    deviceId: string
    axis?: string
    direction?: number
    feedRate?: number
    mode?: string
  }) => void
  'device:jog:stop': (data: { deviceId: string; hardStop?: boolean }) => void
  'device:mdi': (data: { deviceId: string; gcode: string }) => void
}
