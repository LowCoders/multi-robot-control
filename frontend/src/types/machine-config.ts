// Machine Configuration Types for 3D Visualization

export type AxisName = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'
export type AxisType = 'linear' | 'rotary'
export type MachineType = 'cnc_mill' | 'cnc_lathe' | 'laser_cutter' | '5axis' | 'custom'

export interface AxisConfig {
  name: AxisName
  type: AxisType
  min: number
  max: number
  homePosition: number
  color: string
  // Kinematic chain - which axis moves this one
  parent?: AxisName
  // Visual dimensions for the axis carriage (mm)
  dimensions?: {
    width: number
    height: number
    depth: number
  }
}

export interface SpindleConfig {
  maxRpm: number
  minRpm?: number
  diameter?: number
  length?: number
}

export interface ToolConfig {
  diameter: number
  length: number
  type?: 'endmill' | 'ballnose' | 'drill' | 'laser' | 'custom'
}

export interface MachineConfig {
  id: string
  name: string
  type: MachineType
  axes: AxisConfig[]
  workEnvelope: {
    x: number
    y: number
    z: number
  }
  spindle?: SpindleConfig
  tool?: ToolConfig
  // Base/frame dimensions
  base?: {
    width: number
    height: number
    depth: number
  }
  // Visual settings
  visuals?: {
    showGrid?: boolean
    showAxesHelper?: boolean
    backgroundColor?: string
    frameColor?: string      // Gép váz színe
    carriageColor?: string   // Tengelyszán alapszín
    // Default camera position
    cameraPosition?: {
      x: number
      y: number
      z: number
    }
    // Camera look-at target (default: center of work envelope)
    cameraTarget?: {
      x: number
      y: number
      z: number
    }
    cameraFov?: number       // Field of view (degrees)
  }
}

// Default configurations for common machine types
export const DEFAULT_3AXIS_CNC: MachineConfig = {
  id: 'default_3axis',
  name: 'Default 3-Axis CNC',
  type: 'cnc_mill',
  workEnvelope: { x: 300, y: 400, z: 80 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 400, homePosition: 0, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -80, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
  ],
  spindle: {
    maxRpm: 24000,
    diameter: 52,
    length: 80,
  },
  tool: {
    diameter: 6,
    length: 30,
    type: 'endmill',
  },
  base: {
    width: 400,
    height: 50,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_5AXIS_CNC: MachineConfig = {
  id: 'default_5axis',
  name: 'Default 5-Axis CNC',
  type: '5axis',
  workEnvelope: { x: 300, y: 300, z: 200 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -200, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
    { name: 'A', type: 'rotary', min: -90, max: 90, homePosition: 0, color: '#f59e0b', parent: 'Z' },
    { name: 'B', type: 'rotary', min: -180, max: 180, homePosition: 0, color: '#8b5cf6', parent: 'A' },
  ],
  spindle: {
    maxRpm: 20000,
    diameter: 65,
    length: 100,
  },
  tool: {
    diameter: 6,
    length: 40,
    type: 'endmill',
  },
  base: {
    width: 450,
    height: 80,
    depth: 450,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_CNC_LATHE: MachineConfig = {
  id: 'default_lathe',
  name: 'Default CNC Lathe',
  type: 'cnc_lathe',
  workEnvelope: { x: 200, y: 200, z: 400 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 200, homePosition: 200, color: '#ef4444' },
    { name: 'Z', type: 'linear', min: 0, max: 400, homePosition: 0, color: '#3b82f6', parent: 'X' },
  ],
  spindle: {
    maxRpm: 4000,
    diameter: 120,
    length: 150,
  },
  tool: {
    diameter: 12,
    length: 25,
    type: 'custom',
  },
  base: {
    width: 300,
    height: 60,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_LASER_CUTTER: MachineConfig = {
  id: 'default_laser',
  name: 'Default Laser Cutter',
  type: 'laser_cutter',
  workEnvelope: { x: 600, y: 400, z: 50 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 600, homePosition: 0, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 400, homePosition: 0, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -50, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
  ],
  tool: {
    diameter: 0.1,
    length: 20,
    type: 'laser',
  },
  base: {
    width: 700,
    height: 40,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_CUSTOM: MachineConfig = {
  id: 'default_custom',
  name: 'Custom Machine',
  type: 'custom',
  workEnvelope: { x: 200, y: 200, z: 100 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 200, homePosition: 0, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 200, homePosition: 0, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -100, max: 0, homePosition: 0, color: '#3b82f6', parent: 'Y' },
  ],
  base: {
    width: 300,
    height: 50,
    depth: 300,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

// Get default config for a machine type
export function getDefaultConfigForType(type: MachineType): MachineConfig {
  switch (type) {
    case 'cnc_mill':
      return DEFAULT_3AXIS_CNC
    case '5axis':
      return DEFAULT_5AXIS_CNC
    case 'cnc_lathe':
      return DEFAULT_CNC_LATHE
    case 'laser_cutter':
      return DEFAULT_LASER_CUTTER
    case 'custom':
    default:
      return DEFAULT_CUSTOM
  }
}
