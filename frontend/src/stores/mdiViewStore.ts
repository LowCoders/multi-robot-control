import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MdiLayer = 'command' | 'raw' | 'response' | 'detailed' | 'debug'

export type MdiLayerConfig = Record<MdiLayer, boolean>

export type CaptureMode = 'relative' | 'absolute'

const DEFAULT_LAYERS: MdiLayerConfig = {
  command: true,
  raw: false,
  response: true,
  detailed: false,
  debug: false,
}

const DEFAULT_CAPTURE_MODE: CaptureMode = 'relative'

export const ALL_LAYERS: MdiLayer[] = ['command', 'raw', 'response', 'detailed', 'debug']

interface MdiViewState {
  // Layer visibility per deviceId. Missing entries fall back to DEFAULT_LAYERS.
  layers: Record<string, MdiLayerConfig>
  // Capture mode per deviceId (relative vs absolute coords for jog command layer).
  captureMode: Record<string, CaptureMode>
  // Recording per deviceId: when true, every entry with a non-empty command
  // is auto-appended to the gcode buffer.
  recording: Record<string, boolean>
  toggleLayer: (deviceId: string, layer: MdiLayer) => void
  setLayer: (deviceId: string, layer: MdiLayer, enabled: boolean) => void
  getLayers: (deviceId: string) => MdiLayerConfig
  resetLayers: (deviceId: string) => void
  getCaptureMode: (deviceId: string) => CaptureMode
  setCaptureMode: (deviceId: string, mode: CaptureMode) => void
  isRecording: (deviceId: string) => boolean
  setRecording: (deviceId: string, recording: boolean) => void
  toggleRecording: (deviceId: string) => void
}

function ensureConfig(existing: MdiLayerConfig | undefined): MdiLayerConfig {
  if (!existing) return { ...DEFAULT_LAYERS }
  // Backfill any missing keys to keep persisted state forward-compatible.
  return ALL_LAYERS.reduce<MdiLayerConfig>((acc, key) => {
    acc[key] = typeof existing[key] === 'boolean' ? existing[key] : DEFAULT_LAYERS[key]
    return acc
  }, {} as MdiLayerConfig)
}

export const useMdiViewStore = create<MdiViewState>()(
  persist(
    (set, get) => ({
      layers: {},
      captureMode: {},
      recording: {},

      toggleLayer: (deviceId, layer) => {
        set((state) => {
          const current = ensureConfig(state.layers[deviceId])
          return {
            layers: {
              ...state.layers,
              [deviceId]: { ...current, [layer]: !current[layer] },
            },
          }
        })
      },

      setLayer: (deviceId, layer, enabled) => {
        set((state) => {
          const current = ensureConfig(state.layers[deviceId])
          return {
            layers: {
              ...state.layers,
              [deviceId]: { ...current, [layer]: enabled },
            },
          }
        })
      },

      getLayers: (deviceId) => ensureConfig(get().layers[deviceId]),

      resetLayers: (deviceId) => {
        set((state) => ({
          layers: { ...state.layers, [deviceId]: { ...DEFAULT_LAYERS } },
        }))
      },

      getCaptureMode: (deviceId) => get().captureMode[deviceId] ?? DEFAULT_CAPTURE_MODE,

      setCaptureMode: (deviceId, mode) => {
        set((state) => ({
          captureMode: { ...state.captureMode, [deviceId]: mode },
        }))
      },

      isRecording: (deviceId) => Boolean(get().recording[deviceId]),

      setRecording: (deviceId, recording) => {
        set((state) => ({
          recording: { ...state.recording, [deviceId]: recording },
        }))
      },

      toggleRecording: (deviceId) => {
        set((state) => ({
          recording: { ...state.recording, [deviceId]: !state.recording[deviceId] },
        }))
      },
    }),
    {
      name: 'mdi-view-layers',
      version: 2,
    },
  ),
)

export const DEFAULT_MDI_LAYERS = DEFAULT_LAYERS
export { DEFAULT_CAPTURE_MODE }
