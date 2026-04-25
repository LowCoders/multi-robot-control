/**
 * Felhasználói transzformáció-override store a V2 csőhajlító modellhez.
 *
 * Két szint:
 *   - **baseline**: a `MachineConfig.visuals.componentOverrides`-ból betöltött,
 *     már szerveren mentett override-ok pillanatképe. Külső (config) változás
 *     után a `loadFromConfig()` frissíti.
 *   - **drafts**: a felhasználó által az aktuális sessionben módosított, de még
 *     NEM mentett értékek. Ha egy id-re van draft, az nyer a baseline felett.
 *
 * Az `getEffective(id)` az átfedett (draft || baseline) értéket adja vissza —
 * ezt használja a `resolveTransform` `getOverride` paramétereként a renderer
 * és az STL exporter is.
 *
 * **Perzisztencia**: a `editMode` és `gizmoMode` localStorage-be kerül
 * (UX-preferencia), a baseline és drafts NEM — azok az aktuális config + a
 * kézzel mozgatott állapot tükrei.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TransformOverride } from './transformResolver'

export type GizmoMode = 'translate' | 'rotate'

type OverrideMap = Record<string, TransformOverride>

/**
 * Undo/Redo snapshot — a `drafts` ÉS a `baseline` együtt mentődik, mert
 * pl. a `clearOverride` a baseline-t is megpiszkálja, és a visszavonáskor
 * vissza kell állítani.
 */
interface HistorySnapshot {
  drafts: OverrideMap
  baseline: OverrideMap
}

/** History korlát — több mint ennyi snapshot fölött a legrégebbiek elveszhetnek. */
const MAX_HISTORY = 100

interface TransformOverrideStore {
  /** Edit mode: ha igaz, a kiválasztott node-on TransformControls gizmo jelenik meg. */
  editMode: boolean
  /** Aktuális gizmo-mód (csak edit mode-ban van hatása). */
  gizmoMode: GizmoMode
  /** Szerveren mentett override-ok pillanatképe (config-ból). */
  baseline: OverrideMap
  /** Aktuális, még el nem mentett változások. */
  drafts: OverrideMap
  /**
   * Undo verem: minden user-action ELŐTT egy `pushHistory()` snapshot-tal egy
   * elemet kap. `undo()` visszaolvassa, `commitDrafts` / `loadFromConfig`
   * kiüríti (másik kontextus, nincs értelme visszaugrani egy mentés előttre).
   * NEM PERZISZTÁLT — sessionön kívüli undo nincs.
   */
  history: HistorySnapshot[]
  /**
   * Redo verem: az undo-zott snapshot-ok kerülnek ide, így a Ctrl+Y / Ctrl+Shift+Z
   * vissza tudja venni az utoljára visszavont lépést. Bármi NEM-undo/redo
   * akció (`pushHistory`) kiüríti.
   */
  future: HistorySnapshot[]

  setEditMode: (v: boolean) => void
  toggleEditMode: () => void
  setGizmoMode: (m: GizmoMode) => void
  /**
   * Translate ↔ rotate váltás. A 3D nézetben a már kijelölt elemre
   * újra-kattintás triggereli (a gizmo-mode pill ikongombokat ezzel váltottuk
   * ki). A `gizmoMode` perzisztálódik (`partialize`), így új sessionben is az
   * utoljára használt mód jön vissza.
   */
  toggleGizmoMode: () => void

  /**
   * Snapshot kiírása az undo verembe a JELENLEGI állapotból. Hívd MEG MINDEN
   * user-action ELŐTT (drag start, numerikus input commit, clearOverride).
   * Egy "user action" = egy undo lépés. A drag közbeni minden köztes setDraft
   * ne hívjon push-ot, csak a drag-start.
   */
  pushHistory: () => void

  /** Új draft beírása (tipikusan a TransformControls drag után). */
  setDraft: (id: string, t: TransformOverride) => void
  /** Több draft batch beírása (multi-select közös mozgatás drag-end-jénél). */
  setDraftsBatch: (entries: Array<[string, TransformOverride]>) => void
  /** Egy id draft + baseline törlése (visszaáll a registry default / mount-resolve). */
  clearOverride: (id: string) => void
  /** Csak a draft visszavonása (baseline marad). */
  clearDraft: (id: string) => void
  /** Minden draft visszavonása (baseline marad). */
  clearAllDrafts: () => void
  /** Minden override (draft + baseline) törlése. */
  clearAllOverrides: () => void

  /**
   * Egy lépéssel vissza. Az aktuális állapotot a `future`-ba írja, az utolsó
   * `history` snapshot-ot pedig betölti. Ha üres a history, no-op.
   */
  undo: () => void
  /**
   * Az utoljára visszavont lépés újra. Ha üres a future, no-op.
   */
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  /**
   * A config-ból érkező mentett override-ok betöltése a baseline-ba.
   * A drafts-ot NEM érinti — ezzel a felhasználó éppen mozgatott állapota
   * megmarad config-frissítés közben is. A history/future-t kiüríti
   * (új kontextus, nincs értelme visszaugrani).
   */
  loadFromConfig: (overrides: OverrideMap | undefined) => void

  /**
   * Sikeres mentés után hívandó: a draft → baseline-ba kerül (commit), és a
   * draft kiürül. A history/future kiürül (a mentés egy "checkpoint").
   */
  commitDrafts: (committed: OverrideMap) => void

  /** Aktuális effektív override egy node-ra (draft || baseline). */
  getEffective: (id: string) => TransformOverride | undefined
  /** Egy id "piszkos"-e (van draft, és különbözik a baseline-tól). */
  isDirty: (id: string) => boolean
  /** A teljes effektív override map (a save payload-hez). */
  getMergedMap: () => OverrideMap
}

function arrEqual(a: [number, number, number] | undefined, b: [number, number, number] | undefined): boolean {
  if (!a || !b) return a === b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function tEqual(a: TransformOverride, b: TransformOverride): boolean {
  return arrEqual(a.position, b.position) && arrEqual(a.rotation, b.rotation)
}

export const useTransformOverrideStore = create<TransformOverrideStore>()(
  persist(
    (set, get) => ({
      editMode: false,
      gizmoMode: 'translate',
      baseline: {},
      drafts: {},
      history: [],
      future: [],

      setEditMode: (v) => set({ editMode: v }),
      toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),
      setGizmoMode: (m) => set({ gizmoMode: m }),
      toggleGizmoMode: () =>
        set((s) => ({ gizmoMode: s.gizmoMode === 'translate' ? 'rotate' : 'translate' })),

      pushHistory: () =>
        set((s) => {
          const snap: HistorySnapshot = {
            drafts: { ...s.drafts },
            baseline: { ...s.baseline },
          }
          // Az új user-action ELŐTT minden future invalid → kiürítés.
          // History csak a maximumig nőhet; a legrégebbi snapshot eldobódik.
          const next = [...s.history, snap]
          if (next.length > MAX_HISTORY) next.shift()
          return { history: next, future: [] }
        }),

      setDraft: (id, t) =>
        set((s) => ({
          drafts: { ...s.drafts, [id]: t },
        })),

      setDraftsBatch: (entries) =>
        set((s) => {
          const next = { ...s.drafts }
          for (const [id, t] of entries) next[id] = t
          return { drafts: next }
        }),

      clearOverride: (id) =>
        set((s) => {
          const { [id]: _d, ...restDrafts } = s.drafts
          const { [id]: _b, ...restBase } = s.baseline
          return { drafts: restDrafts, baseline: restBase }
        }),

      clearDraft: (id) =>
        set((s) => {
          if (!(id in s.drafts)) return s
          const { [id]: _drop, ...rest } = s.drafts
          return { drafts: rest }
        }),

      clearAllDrafts: () => set({ drafts: {} }),
      clearAllOverrides: () => set({ drafts: {}, baseline: {} }),

      undo: () =>
        set((s) => {
          if (s.history.length === 0) return s
          const prev = s.history[s.history.length - 1]!
          const newHistory = s.history.slice(0, -1)
          // A jelenlegi állapot a future tetejére kerül (redo-hoz).
          const currentSnap: HistorySnapshot = {
            drafts: { ...s.drafts },
            baseline: { ...s.baseline },
          }
          return {
            history: newHistory,
            future: [...s.future, currentSnap],
            drafts: { ...prev.drafts },
            baseline: { ...prev.baseline },
          }
        }),

      redo: () =>
        set((s) => {
          if (s.future.length === 0) return s
          const next = s.future[s.future.length - 1]!
          const newFuture = s.future.slice(0, -1)
          // A jelenlegi állapot a history tetejére (újabb undo-hoz).
          const currentSnap: HistorySnapshot = {
            drafts: { ...s.drafts },
            baseline: { ...s.baseline },
          }
          return {
            future: newFuture,
            history: [...s.history, currentSnap],
            drafts: { ...next.drafts },
            baseline: { ...next.baseline },
          }
        }),

      canUndo: () => get().history.length > 0,
      canRedo: () => get().future.length > 0,

      loadFromConfig: (overrides) =>
        set({
          baseline: overrides ? { ...overrides } : {},
          // Új config-kontextus → history/future invalid.
          history: [],
          future: [],
        }),

      commitDrafts: (committed) =>
        set(() => {
          // A clearOverride által törölt id-k esetén a `committed` nem
          // tartalmazza őket; de a baseline-ban sem kell maradniuk —
          // a save payload számolja a teljes mergedMap-et. A commit-step
          // egyszerűen átveszi a committed snapshot-ot teljes baseline-nak.
          // A history/future-t is kiürítjük: a mentés egy "checkpoint".
          return { baseline: { ...committed }, drafts: {}, history: [], future: [] }
        }),

      getEffective: (id) => {
        const s = get()
        return s.drafts[id] ?? s.baseline[id]
      },

      isDirty: (id) => {
        const s = get()
        const d = s.drafts[id]
        if (!d) return false
        const b = s.baseline[id]
        if (!b) return true
        return !tEqual(d, b)
      },

      getMergedMap: () => {
        const s = get()
        return { ...s.baseline, ...s.drafts }
      },
    }),
    {
      name: 'mrc-v2-transform-edit',
      partialize: (state) => ({
        editMode: state.editMode,
        gizmoMode: state.gizmoMode,
      }),
      version: 1,
    },
  ),
)

/**
 * Vissza adja az aktuális drafts halmaz id-jeit (rendelhető szelektor),
 * azonosítók halmazaként a UI dirty jelölőkhöz.
 */
export function useDirtyIds(): ReadonlySet<string> {
  const drafts = useTransformOverrideStore((s) => s.drafts)
  const baseline = useTransformOverrideStore((s) => s.baseline)
  const ids = new Set<string>()
  for (const [id, d] of Object.entries(drafts)) {
    const b = baseline[id]
    if (!b || !tEqual(d, b)) ids.add(id)
  }
  return ids
}
