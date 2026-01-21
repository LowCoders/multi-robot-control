import { useState, useEffect } from 'react'
import type { MachineConfig } from '../types/machine-config'
import { DEFAULT_3AXIS_CNC, DEFAULT_5AXIS_CNC } from '../types/machine-config'
import type { DeviceType } from '../types/device'

// Map device types to default machine configs
const DEFAULT_CONFIGS: Record<string, MachineConfig> = {
  cnc_mill: DEFAULT_3AXIS_CNC,
  cnc_lathe: {
    ...DEFAULT_3AXIS_CNC,
    id: 'default_lathe',
    name: 'Default Lathe',
    type: 'cnc_lathe',
    axes: [
      { name: 'X', type: 'linear', min: 0, max: 150, homePosition: 0, color: '#ef4444' },
      { name: 'Z', type: 'linear', min: -200, max: 0, homePosition: 0, color: '#3b82f6', parent: 'X' },
    ],
    workEnvelope: { x: 150, y: 0, z: 200 },
  },
  laser_cutter: {
    ...DEFAULT_3AXIS_CNC,
    id: 'default_laser',
    name: 'Default Laser',
    type: 'laser_cutter',
    axes: [
      { name: 'X', type: 'linear', min: 0, max: 400, homePosition: 0, color: '#ef4444' },
      { name: 'Y', type: 'linear', min: 0, max: 300, homePosition: 0, color: '#22c55e', parent: 'X' },
    ],
    workEnvelope: { x: 400, y: 300, z: 0 },
    spindle: undefined,
    tool: {
      diameter: 0.1, // Laser focus point
      length: 50,
      type: 'laser',
    },
  },
  '5axis': DEFAULT_5AXIS_CNC,
}

interface UseMachineConfigResult {
  config: MachineConfig | null
  loading: boolean
  error: string | null
}

export function useMachineConfig(
  deviceId: string,
  deviceType?: DeviceType
): UseMachineConfigResult {
  const [config, setConfig] = useState<MachineConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      setError(null)

      try {
        // Load device-specific config from API
        const response = await fetch(`/api/devices/${deviceId}/machine-config`)
        
        if (response.ok) {
          const data = await response.json()
          setConfig(data as MachineConfig)
        } else {
          // Fall back to default config based on device type
          const defaultConfig = deviceType 
            ? DEFAULT_CONFIGS[deviceType] || DEFAULT_3AXIS_CNC
            : DEFAULT_3AXIS_CNC
          
          setConfig({
            ...defaultConfig,
            id: deviceId,
          })
        }
      } catch (err) {
        // On error, use default config
        const defaultConfig = deviceType 
          ? DEFAULT_CONFIGS[deviceType] || DEFAULT_3AXIS_CNC
          : DEFAULT_3AXIS_CNC
        
        setConfig({
          ...defaultConfig,
          id: deviceId,
        })
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [deviceId, deviceType])

  return { config, loading, error }
}
