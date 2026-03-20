import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { io, Socket } from 'socket.io-client'
import type { Device, DeviceStatus, Position, DeviceCapabilities } from '../types/device'

interface Notification {
  id: string
  deviceId: string
  message: string
  severity: 'info' | 'warning' | 'error'
  timestamp: number
  count?: number
}

interface DeviceStore {
  // State
  devices: Device[]
  selectedDeviceId: string | null
  connected: boolean
  socket: Socket | null
  notifications: Notification[]
  
  // Actions
  connect: () => void
  disconnect: () => void
  setDevices: (devices: Device[]) => void
  updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void
  updateDevicePosition: (deviceId: string, position: Position) => void
  updateDeviceState: (deviceId: string, state: string) => void
  updateDeviceCapabilities: (deviceId: string, capabilities: DeviceCapabilities) => void
  selectDevice: (deviceId: string | null) => void
  addNotification: (deviceId: string, message: string, severity?: 'info' | 'warning' | 'error') => void
  clearNotification: (id: string) => void
  
  // Commands
  sendCommand: (deviceId: string, command: string, params?: Record<string, unknown>) => void
  jog: (deviceId: string, axis: string, distance: number, feedRate: number, mode?: string) => void
  jogStart: (
    deviceId: string,
    axis: string,
    direction: number,
    feedRate: number,
    mode?: string,
    heartbeatTimeout?: number,
    tickMs?: number
  ) => void
  jogBeat: (
    deviceId: string,
    axis?: string,
    direction?: number,
    feedRate?: number,
    mode?: string
  ) => void
  jogStop: (deviceId: string, hardStop?: boolean) => void
  sendMDI: (deviceId: string, gcode: string) => void
}

// Socket event handler names for cleanup
const SOCKET_EVENTS = [
  'connect',
  'disconnect',
  'devices:list',
  'device:status',
  'device:position',
  'device:state_change',
  'device:capabilities',
  'device:error',
  'job:progress',
  'job:complete',
] as const

export const useDeviceStore = create<DeviceStore>()(
  immer((set, get) => ({
    devices: [],
    selectedDeviceId: null,
    connected: false,
    socket: null,
    notifications: [],
    
    connect: () => {
      // Prevent duplicate connections
      const existingSocket = get().socket
      if (existingSocket) {
        // If already connected or connecting, don't create new connection
        if (existingSocket.connected || existingSocket.active) {
          console.log('WebSocket already connected or connecting')
          return
        }
        // Clean up existing socket before creating new one
        get().disconnect()
      }
      
      const socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      })
      
      socket.on('connect', () => {
        console.log('WebSocket connected')
        set((state) => { state.connected = true })
      })
      
      socket.on('disconnect', () => {
        console.log('WebSocket disconnected')
        set((state) => { state.connected = false })
      })
      
      socket.on('devices:list', (data: { devices: Device[] }) => {
        set((state) => { state.devices = data.devices })
      })
      
      socket.on('device:status', (data: { deviceId: string; status: DeviceStatus }) => {
        get().updateDeviceStatus(data.deviceId, data.status)
      })
      
      socket.on('device:position', (data: { deviceId: string; position: Position }) => {
        get().updateDevicePosition(data.deviceId, data.position)
      })
      
      socket.on('device:state_change', (data: { deviceId: string; newState: string }) => {
        get().updateDeviceState(data.deviceId, data.newState)
      })

      socket.on('device:capabilities', (data: { deviceId: string; capabilities: DeviceCapabilities }) => {
        get().updateDeviceCapabilities(data.deviceId, data.capabilities)
      })
      
      socket.on('device:error', (data: { deviceId: string; message: string }) => {
        console.error(`Device error (${data.deviceId}):`, data.message)
        get().addNotification(data.deviceId, data.message, 'error')
      })
      
      socket.on('job:progress', (data: { 
        deviceId: string; 
        progress: number; 
        currentLine: number; 
        totalLines: number 
      }) => {
        set((state) => {
          const device = state.devices.find(d => d.id === data.deviceId)
          if (device && device.status) {
            device.status.progress = data.progress
            device.status.current_line = data.currentLine
            device.status.total_lines = data.totalLines
          }
        })
      })
      
      socket.on('job:complete', (data: { deviceId: string; file: string }) => {
        console.log(`Job complete (${data.deviceId}): ${data.file}`)
        get().addNotification(data.deviceId, `Munka kész: ${data.file}`, 'info')
      })
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((state) => { state.socket = socket as any })
    },
    
    disconnect: () => {
      const { socket } = get()
      if (socket) {
        // Remove all event listeners before disconnecting
        SOCKET_EVENTS.forEach(event => socket.off(event))
        socket.disconnect()
        set((state) => {
          state.socket = null
          state.connected = false
        })
      }
    },
    
    addNotification: (deviceId, message, severity = 'info') => {
      const normalizedMessage = message.includes('transient state window')
        ? 'Átmeneti firmware állapotablak (error:8). A rendszer automatikus újrapróbálkozást végez.'
        : message
      const notification: Notification = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        deviceId,
        message: normalizedMessage,
        severity,
        timestamp: Date.now(),
        count: 1,
      }
      set((state) => {
        const now = Date.now()
        const existing = state.notifications.find(
          n =>
            n.deviceId === deviceId &&
            n.severity === severity &&
            n.message === normalizedMessage &&
            now - n.timestamp < 2000
        )
        if (existing) {
          existing.timestamp = now
          existing.count = (existing.count ?? 1) + 1
          return
        }
        state.notifications.push(notification)
        // Keep last 50 notifications
        if (state.notifications.length > 50) {
          state.notifications = state.notifications.slice(-50)
        }
      })
    },
    
    clearNotification: (id) => {
      set((state) => {
        const index = state.notifications.findIndex(n => n.id === id)
        if (index !== -1) {
          state.notifications.splice(index, 1)
        }
      })
    },
    
    setDevices: (devices) => set((state) => { state.devices = devices }),
    
    updateDeviceStatus: (deviceId, status) => {
      set((state) => {
        const device = state.devices.find(d => d.id === deviceId)
        if (device) {
          device.status = status
          device.state = status.state
          device.connected = status.state !== 'disconnected'
        }
      })
    },
    
    updateDevicePosition: (deviceId, position) => {
      set((state) => {
        const device = state.devices.find(d => d.id === deviceId)
        if (device) {
          // Create status object if it doesn't exist
          if (!device.status) {
            device.status = {
              state: device.state,
              position: position,
              work_position: position,
              feed_rate: 0,
              spindle_speed: 0,
              laser_power: 0,
              progress: 0,
              current_line: 0,
              total_lines: 0,
              current_file: null,
              error_message: null,
              feed_override: 100,
              spindle_override: 100,
            }
          } else {
            device.status.position = position
          }
        }
      })
    },
    
    updateDeviceState: (deviceId, newState) => {
      set((state) => {
        const device = state.devices.find(d => d.id === deviceId)
        if (device) {
          device.state = newState as Device['state']
          device.connected = newState !== 'disconnected'
        }
      })
    },

    updateDeviceCapabilities: (deviceId, capabilities) => {
      set((state) => {
        const device = state.devices.find(d => d.id === deviceId)
        if (device) {
          device.capabilities = capabilities
        }
      })
    },
    
    selectDevice: (deviceId) => set((state) => { state.selectedDeviceId = deviceId }),
    
    sendCommand: (deviceId, command, params) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:command', { deviceId, command, params })
      }
    },
    
    jog: (deviceId, axis, distance, feedRate, mode) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:jog', { deviceId, axis, distance, feedRate, mode })
      }
    },

    jogStart: (deviceId, axis, direction, feedRate, mode, heartbeatTimeout = 0.5, tickMs = 40) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:jog:start', {
          deviceId,
          axis,
          direction,
          feedRate,
          mode,
          heartbeatTimeout,
          tickMs,
        })
      }
    },

    jogBeat: (deviceId, axis, direction, feedRate, mode) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:jog:beat', {
          deviceId,
          axis,
          direction,
          feedRate,
          mode,
        })
      }
    },
    
    jogStop: (deviceId, hardStop = false) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:jog:stop', { deviceId, hardStop })
      }
    },
    
    sendMDI: (deviceId, gcode) => {
      const { socket } = get()
      if (socket) {
        socket.emit('device:mdi', { deviceId, gcode })
      }
    },
  }))
)
