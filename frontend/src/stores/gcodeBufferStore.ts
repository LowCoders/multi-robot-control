import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'

// Set/Map használathoz immer 10-ben a plugin opt-in szükséges; e nélkül a
// draft-en végzett Set műveletek (.add(), spread) az első produce után
// fagyasztott Set-en hibát dobnak vagy csendben elhalnak.
enableMapSet()

export interface GcodeBuffer {
  filepath: string | null
  filename: string
  originalLines: string[]
  lines: string[]
  // Indices (0-based) of lines that are "new" relative to originalLines
  newLineSet: Set<number>
  dirty: boolean
  editing: boolean
  loading: boolean
  saving: boolean
  error: string | null
  // Bumps every time the buffer is replaced (load/reset) so editors know
  // to refresh their model contents from outside.
  revision: number
}

interface GcodeBufferStore {
  buffers: Record<string, GcodeBuffer>

  getBuffer: (deviceId: string) => GcodeBuffer
  loadFromServer: (deviceId: string, filepath: string) => Promise<void>
  loadFromText: (deviceId: string, filename: string, text: string, filepath?: string | null) => void
  appendLineFromMdi: (deviceId: string, line: string, opts?: { running?: boolean }) => void
  setLines: (deviceId: string, lines: string[]) => void
  saveToServer: (deviceId: string, savePath?: string, overwrite?: boolean) => Promise<{ ok: true; filepath: string } | { ok: false; error: string; status?: number }>
  setEditing: (deviceId: string, editing: boolean) => void
  reset: (deviceId: string) => void
}

function createEmptyBuffer(): GcodeBuffer {
  return {
    filepath: null,
    filename: '',
    originalLines: [],
    lines: [],
    newLineSet: new Set<number>(),
    dirty: false,
    editing: false,
    loading: false,
    saving: false,
    error: null,
    revision: 0,
  }
}

function ensureBuffer(state: { buffers: Record<string, GcodeBuffer> }, deviceId: string): GcodeBuffer {
  if (!state.buffers[deviceId]) {
    state.buffers[deviceId] = createEmptyBuffer()
  }
  return state.buffers[deviceId]
}

function recomputeDirty(buffer: GcodeBuffer): void {
  if (buffer.lines.length !== buffer.originalLines.length) {
    buffer.dirty = true
    return
  }
  for (let i = 0; i < buffer.lines.length; i++) {
    if (buffer.lines[i] !== buffer.originalLines[i]) {
      buffer.dirty = true
      return
    }
  }
  buffer.dirty = false
}

export const useGcodeBufferStore = create<GcodeBufferStore>()(
  immer((set, get) => ({
    buffers: {},

    getBuffer: (deviceId) => {
      const existing = get().buffers[deviceId]
      if (existing) return existing
      // Lazily initialize without forcing a render here
      set((state) => {
        ensureBuffer(state, deviceId)
      })
      return get().buffers[deviceId]
    },

    loadFromServer: async (deviceId, filepath) => {
      set((state) => {
        const b = ensureBuffer(state, deviceId)
        b.loading = true
        b.error = null
      })

      try {
        const res = await fetch(`/api/gcode/file?path=${encodeURIComponent(filepath)}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        const lines: string[] = Array.isArray(data.lines) ? data.lines : []
        const filename: string = data.filename || filepath.split('/').pop() || 'program.nc'

        set((state) => {
          const b = ensureBuffer(state, deviceId)
          b.filepath = filepath
          b.filename = filename
          b.originalLines = lines.slice()
          b.lines = lines.slice()
          b.newLineSet = new Set<number>()
          b.dirty = false
          b.loading = false
          b.error = null
          b.revision += 1
        })
      } catch (err) {
        set((state) => {
          const b = ensureBuffer(state, deviceId)
          b.loading = false
          b.error = err instanceof Error ? err.message : 'Ismeretlen hiba'
        })
      }
    },

    loadFromText: (deviceId, filename, text, filepath = null) => {
      const lines = text.split(/\r\n|\r|\n/)
      set((state) => {
        const b = ensureBuffer(state, deviceId)
        b.filepath = filepath
        b.filename = filename
        b.originalLines = lines.slice()
        b.lines = lines.slice()
        b.newLineSet = new Set<number>()
        // Loaded from disk locally — treat as dirty if we have no server filepath
        // (so the user can save it to server). Otherwise clean.
        b.dirty = filepath === null
        b.loading = false
        b.error = null
        b.revision += 1
      })
    },

    appendLineFromMdi: (deviceId, line, opts = {}) => {
      const trimmed = line.trim()
      if (!trimmed) return

      // Az új buffer-állapotot a draft-en kívül számoljuk ki, hogy semmilyen
      // Set-et ne kelljen immer draft alatt mutálni vagy spread-elni.
      const current = get().buffers[deviceId] ?? createEmptyBuffer()
      const nextLines = current.lines.slice()
      let modifiedIdx: number
      if (nextLines.length === 0) {
        nextLines.push(trimmed)
        modifiedIdx = 0
      } else {
        const lastIdx = nextLines.length - 1
        if (nextLines[lastIdx].trim() === '') {
          nextLines[lastIdx] = trimmed
          modifiedIdx = lastIdx
        } else {
          nextLines.push(trimmed)
          modifiedIdx = nextLines.length - 1
        }
      }
      const nextNewLineSet = new Set<number>(current.newLineSet)
      nextNewLineSet.add(modifiedIdx)

      const nextBuffer: GcodeBuffer = {
        ...current,
        lines: nextLines,
        newLineSet: nextNewLineSet,
        revision: current.revision + 1,
        editing: opts.running ? current.editing : true,
        dirty: true,
      }
      // Ha a sorok hossza eltér az originál-tól vagy bármelyik sor különbözik,
      // dirty = true (recompute pontosabban itt mindig igaz, hisz épp most
      // hozzáadtunk vagy felülírtunk egy sort).
      if (
        nextLines.length === current.originalLines.length &&
        nextLines.every((l, i) => l === current.originalLines[i])
      ) {
        nextBuffer.dirty = false
      }

      set((state) => {
        state.buffers[deviceId] = nextBuffer
      })
    },

    setLines: (deviceId, lines) => {
      set((state) => {
        const b = ensureBuffer(state, deviceId)
        // Recompute newLineSet: any line not present in originalLines (by content
        // and by the same index up to the shorter length) is considered new.
        const newSet = new Set<number>()
        for (let i = 0; i < lines.length; i++) {
          if (i >= b.originalLines.length || b.originalLines[i] !== lines[i]) {
            newSet.add(i)
          }
        }
        b.lines = lines.slice()
        b.newLineSet = newSet
        recomputeDirty(b)
      })
    },

    saveToServer: async (deviceId, savePath, overwrite = false) => {
      const buffer = get().buffers[deviceId]
      if (!buffer) {
        return { ok: false, error: 'Nincs aktív G-code buffer' }
      }
      const target = savePath ?? buffer.filepath
      if (!target) {
        return { ok: false, error: 'Hiányzik a célfájl útvonala' }
      }

      set((state) => {
        const b = ensureBuffer(state, deviceId)
        b.saving = true
        b.error = null
      })

      try {
        const content = buffer.lines.join('\n')
        const res = await fetch('/api/gcode/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target, content, overwrite }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          set((state) => {
            const b = ensureBuffer(state, deviceId)
            b.saving = false
            b.error = data.error || `HTTP ${res.status}`
          })
          return { ok: false as const, error: data.error || `HTTP ${res.status}`, status: res.status }
        }
        const data = await res.json()
        set((state) => {
          const b = ensureBuffer(state, deviceId)
          b.filepath = data.filepath || target
          b.filename = data.filename || target.split('/').pop() || b.filename
          b.originalLines = b.lines.slice()
          b.newLineSet = new Set<number>()
          b.dirty = false
          b.saving = false
          b.error = null
        })
        return { ok: true as const, filepath: data.filepath || target }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ismeretlen hiba'
        set((state) => {
          const b = ensureBuffer(state, deviceId)
          b.saving = false
          b.error = msg
        })
        return { ok: false, error: msg }
      }
    },

    setEditing: (deviceId, editing) => {
      set((state) => {
        const b = ensureBuffer(state, deviceId)
        b.editing = editing
      })
    },

    reset: (deviceId) => {
      set((state) => {
        state.buffers[deviceId] = createEmptyBuffer()
      })
    },
  }))
)
