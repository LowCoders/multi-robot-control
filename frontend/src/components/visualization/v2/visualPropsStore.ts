/**
 * Felhasználói VIZUÁLIS PROPERTY override store a V2 csőhajlító modellhez.
 *
 * Ikertestvére a `transformOverrideStore`-nak, csak épp más payloaddal —
 * a 3D transzformáció (position/rotation) helyett a megjelenítési
 * tulajdonságokat (color / opacity / metalness / roughness / scale /
 * hidden / displayName / num) kezeli. Külön store-ban tartjuk, hogy:
 *
 *   1. A két editor (transform vs. visual) függetlenül togglelhető legyen.
 *   2. A save payload `componentOverrides` és `componentVisualOverrides`
 *      mezője külön-külön migrálható, ha később valamelyik szemantikája
 *      változik.
 *   3. Az undo/redo verem külön él — a transform-rendszer history-ját
 *      nem szennyezi egy szín-átállítás.
 *
 * # Per-color-scheme felülírás (v2)
 *
 * A material-jellegű mezők (`color`, `opacity`, `metalness`, `roughness`)
 * MOSTANTÓL color-scheme-enként (PBR vs. Registry) tárolódnak a
 * `schemes.<mode>` map-ben. A "skin" megőrzéséhez ez azért fontos, mert
 * a felhasználó pl. PBR-módban átállíthat egy alkatrészt fényesebbre,
 * Registry-módban viszont egy másik színkódot adhat ugyanannak — és a
 * két "paletta" függetlenül perzisztálódik.
 *
 * A mode-független mezők (`scale`, `hidden`, `displayName`, `num`)
 * a `VisualPropsOverride` legfelső szintjén maradnak — ezek a 3D-térbeli
 * elhelyezkedéstől / azonosítástól / láthatóságtól függenek, nem a
 * színsémától.
 *
 * Backward-compat: a `loadFromConfig` migrálja a régi (lapos) payloadot
 * — ha talál top-level `color/opacity/metalness/roughness` mezőket egy
 * entry-n, mindkét scheme-be (`pbr` ÉS `registry`) átmásolja, mivel a
 * korábbi viselkedés colorMode-független volt.
 *
 * Architektúra: `baseline` (utoljára mentett config), `drafts` (még el nem
 * mentett user-action), `history` / `future` (undo/redo). A getEffective
 * a draft || baseline-t adja vissza, a `getMergedMap` a teljes payload-ot.
 *
 * **Perzisztencia (localStorage)**: csak az `editMode` flag — a baseline
 * és drafts a config-ból ill. a sessionből származik.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ColorMode } from './highlightStore'

/**
 * Color-scheme-enként tárolt material-felülírások. Minden mező opcionális
 * — ha hiányzik, a default (mode szerinti) érvényesül.
 *
 * - `color`: hex `#rrggbb`. PBR módban a mesh saját anyagán alkalmazódik,
 *   Registry módban a `def.color` helyett.
 * - `opacity`: 0..1. Az 1 = teljesen átlátszatlan.
 * - `metalness` / `roughness`: csak `MeshStandardMaterial` (és származékai)
 *   esetén hat — a fade-effect ezeket nem érinti.
 */
export interface PerSchemeProps {
  color?: string
  opacity?: number
  metalness?: number
  roughness?: number
}

/**
 * Egy node felhasználó által felülírt vizuális tulajdonságai.
 *
 * MINDEN MEZŐ OPCIONÁLIS — ha hiányzik, a registry default érvényesül.
 *
 * A material-mezők (`color/opacity/metalness/roughness`) MOSTANTÓL a
 * `schemes.<colorMode>` alatt élnek, hogy a felhasználó külön-külön
 * "palettát" karbantarthasson PBR és Registry módra.
 */
export interface VisualPropsOverride {
  /** Color-scheme-enkénti material override-ok. Hiányuk = default a render-időben. */
  schemes?: {
    pbr?: PerSchemeProps
    registry?: PerSchemeProps
  }
  /** Per-axis scale szorzó. `[1,1,1]` = identitás (default). Mode-független. */
  scale?: [number, number, number]
  /** True = a node és minden leszármazottja láthatatlan. Mode-független. */
  hidden?: boolean
  /** A táblázatban megjelenő név override (a config nameEn / nameHu változatlan). */
  displayName?: string
  /** Az ALK-NN sorszám override (display only). */
  num?: string
}

/**
 * Régi (v1) lapos override-shape — kizárólag a `loadFromConfig` migrációhoz
 * létezik. A renderer és a UI már nem ezt használja.
 */
interface LegacyVisualPropsOverride {
  color?: string
  opacity?: number
  metalness?: number
  roughness?: number
  scale?: [number, number, number]
  hidden?: boolean
  displayName?: string
  num?: string
  // Az új mező létezhet már egy újabb config payload-ban — ilyenkor
  // egyszerűen átemeljük.
  schemes?: VisualPropsOverride['schemes']
}

type OverrideMap = Record<string, VisualPropsOverride>
type LegacyOverrideMap = Record<string, LegacyVisualPropsOverride>

/**
 * Egy mezős patch a `patchDraft`-hoz. A `Partial<VisualPropsOverride>` nem
 * elegendő, mert a `exactOptionalPropertyTypes: true` mellett a `Partial`
 * NEM enged explicit `undefined` értéket — pedig a "reset field"
 * use-case-hez pont az kell, hogy a hívó `{ scale: undefined }`-tal jelezze,
 * hogy az adott mező vissza akar állni a default-ra.
 *
 * Csak a TOP-LEVEL (mode-független) mezők patch-elhetők ezzel a hívóval.
 * A material-mezőkhöz (`color/opacity/metalness/roughness`) használd a
 * `patchSchemeDraft(id, mode, patch)` metódust — az fogja az aktív
 * scheme-et frissíteni.
 */
export type VisualPropsPatch = {
  scale?: VisualPropsOverride['scale'] | undefined
  hidden?: VisualPropsOverride['hidden'] | undefined
  displayName?: VisualPropsOverride['displayName'] | undefined
  num?: VisualPropsOverride['num'] | undefined
}

/** Patch a `schemes[mode]` slothez. Az `undefined` érték ott is "reset to default". */
export type SchemePatch = {
  color?: string | undefined
  opacity?: number | undefined
  metalness?: number | undefined
  roughness?: number | undefined
}

interface HistorySnapshot {
  drafts: OverrideMap
  baseline: OverrideMap
}

const MAX_HISTORY = 100

interface VisualPropsStore {
  /**
   * Külön edit-mode flag a transform-store-tól: a vizuális tulajdonság
   * szerkesztéséhez NEM kell a 3D gizmo, csak a panel megjelenítése.
   */
  editMode: boolean
  baseline: OverrideMap
  drafts: OverrideMap
  history: HistorySnapshot[]
  future: HistorySnapshot[]

  setEditMode: (v: boolean) => void
  toggleEditMode: () => void

  pushHistory: () => void
  setDraft: (id: string, t: VisualPropsOverride) => void
  /**
   * Egy mező patch — a top-level mode-független mezőkre (`scale`, `hidden`,
   * `displayName`, `num`). MERGE szemantika: a többi mező változatlan marad.
   * `undefined`-tal a kulcs törlődik a draft-ból (= reset to default).
   *
   * A material-mezőkhöz (`color/opacity/metalness/roughness`) használd a
   * `patchSchemeDraft`-ot.
   */
  patchDraft: (id: string, patch: VisualPropsPatch) => void
  /**
   * Per-color-scheme patch a material mezőkre. Az `undefined` érték törli
   * az adott mezőt az adott scheme-ből; ha a scheme üresre fogy, magát a
   * scheme-et is eltávolítjuk (kompakt payload, és `isDirty` egyszerűbb).
   */
  patchSchemeDraft: (id: string, mode: ColorMode, patch: SchemePatch) => void
  setDraftsBatch: (entries: Array<[string, VisualPropsOverride]>) => void
  clearOverride: (id: string) => void
  clearDraft: (id: string) => void
  clearAllDrafts: () => void
  clearAllOverrides: () => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  loadFromConfig: (overrides: LegacyOverrideMap | undefined) => void
  commitDrafts: (committed: OverrideMap) => void

  getEffective: (id: string) => VisualPropsOverride | undefined
  /**
   * Effektív material-tulajdonságok az aktív color-scheme-re. Az `undefined`
   * scheme-et (vagy hiányzó kulcsot) üres `{}`-ként kezeli — a renderer
   * dönt róla, mit használ default-ként.
   */
  getEffectiveScheme: (id: string, mode: ColorMode) => PerSchemeProps | undefined
  isDirty: (id: string) => boolean
  getMergedMap: () => OverrideMap
}

/** PerSchemeProps mezőszintű egyenlőség. */
function schemeEqual(a: PerSchemeProps | undefined, b: PerSchemeProps | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.color === b.color &&
    a.opacity === b.opacity &&
    a.metalness === b.metalness &&
    a.roughness === b.roughness
  )
}

function vEqual(a: VisualPropsOverride, b: VisualPropsOverride): boolean {
  if (a.hidden !== b.hidden) return false
  if (a.displayName !== b.displayName) return false
  if (a.num !== b.num) return false
  const as = a.scale,
    bs = b.scale
  if (as || bs) {
    if (!as || !bs) return false
    if (as[0] !== bs[0] || as[1] !== bs[1] || as[2] !== bs[2]) return false
  }
  if (!schemeEqual(a.schemes?.pbr, b.schemes?.pbr)) return false
  if (!schemeEqual(a.schemes?.registry, b.schemes?.registry)) return false
  return true
}

/**
 * Migrálás: a régi lapos shape-ből (`{color, opacity, ...}`) áthelyezzük
 * a material-mezőket `schemes.pbr` ÉS `schemes.registry` alá. Mivel a
 * korábbi viselkedés colorMode-független volt (egyetlen lapos override
 * mindkét módban érvényesült), mindkét sémába másoljuk — így a felhasználó
 * a régi configgal pontosan ugyanazt látja, és bármelyik módban tudja
 * tovább finomítani.
 *
 * Ha egy entry MÁR rendelkezik `schemes` mezővel, azt használjuk
 * elsődlegesen, és a top-level material-mezőket figyelmen kívül hagyjuk
 * (egy újabb config-formátum konzervatívan felülír).
 */
function migrateOverride(o: LegacyVisualPropsOverride): VisualPropsOverride {
  const out: VisualPropsOverride = {}
  if (o.scale) out.scale = o.scale
  if (typeof o.hidden === 'boolean') out.hidden = o.hidden
  if (typeof o.displayName === 'string') out.displayName = o.displayName
  if (typeof o.num === 'string') out.num = o.num

  // Ha az új shape már jelen van, azt vesszük át.
  if (o.schemes) {
    const schemes: { pbr?: PerSchemeProps; registry?: PerSchemeProps } = {}
    if (o.schemes.pbr && Object.keys(o.schemes.pbr).length > 0) {
      schemes.pbr = { ...o.schemes.pbr }
    }
    if (o.schemes.registry && Object.keys(o.schemes.registry).length > 0) {
      schemes.registry = { ...o.schemes.registry }
    }
    if (schemes.pbr || schemes.registry) out.schemes = schemes
    return out
  }

  // Lapos legacy mezők → mindkét scheme-be.
  const flat: PerSchemeProps = {}
  if (typeof o.color === 'string') flat.color = o.color
  if (typeof o.opacity === 'number') flat.opacity = o.opacity
  if (typeof o.metalness === 'number') flat.metalness = o.metalness
  if (typeof o.roughness === 'number') flat.roughness = o.roughness
  if (Object.keys(flat).length > 0) {
    out.schemes = { pbr: { ...flat }, registry: { ...flat } }
  }
  return out
}

function migrateMap(m: LegacyOverrideMap | undefined): OverrideMap {
  if (!m) return {}
  const out: OverrideMap = {}
  for (const [id, o] of Object.entries(m)) {
    out[id] = migrateOverride(o)
  }
  return out
}

/**
 * Kompakt patch alkalmazása egy scheme-re. `undefined` értékek törlik a
 * mezőt; ha a scheme üresre fogy, `undefined`-ot adunk vissza, így a
 * `schemes` map-ből kihagyható.
 */
function applySchemePatch(
  prev: PerSchemeProps | undefined,
  patch: SchemePatch,
): PerSchemeProps | undefined {
  const merged: Record<string, unknown> = { ...(prev ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k]
    else merged[k] = v
  }
  if (Object.keys(merged).length === 0) return undefined
  return merged as PerSchemeProps
}

export const useVisualPropsStore = create<VisualPropsStore>()(
  persist(
    (set, get) => ({
      editMode: false,
      baseline: {},
      drafts: {},
      history: [],
      future: [],

      setEditMode: (v) => set({ editMode: v }),
      toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),

      pushHistory: () =>
        set((s) => {
          const snap: HistorySnapshot = {
            drafts: { ...s.drafts },
            baseline: { ...s.baseline },
          }
          const next = [...s.history, snap]
          if (next.length > MAX_HISTORY) next.shift()
          return { history: next, future: [] }
        }),

      setDraft: (id, t) =>
        set((s) => ({
          drafts: { ...s.drafts, [id]: { ...t } },
        })),

      patchDraft: (id, patch) =>
        set((s) => {
          const existing = s.drafts[id] ?? s.baseline[id] ?? {}
          const merged: Record<string, unknown> = { ...existing }
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete merged[k]
            else merged[k] = v
          }
          return {
            drafts: { ...s.drafts, [id]: merged as VisualPropsOverride },
          }
        }),

      patchSchemeDraft: (id, mode, patch) =>
        set((s) => {
          const existing = s.drafts[id] ?? s.baseline[id] ?? {}
          const prevSchemes = existing.schemes ?? {}
          const nextScheme = applySchemePatch(prevSchemes[mode], patch)
          // Új schemes objektum összerakása a változatlan másik mode-dal.
          const otherMode: ColorMode = mode === 'pbr' ? 'registry' : 'pbr'
          const otherScheme = prevSchemes[otherMode]
          const newSchemes: VisualPropsOverride['schemes'] = {}
          if (nextScheme) newSchemes[mode] = nextScheme
          if (otherScheme) newSchemes[otherMode] = otherScheme

          // Új top-level objektum: a mode-független mezőket változatlanul
          // másoljuk; a `schemes`-t csak akkor írjuk ki, ha van benne valami.
          const next: VisualPropsOverride = {}
          if (existing.scale) next.scale = existing.scale
          if (typeof existing.hidden === 'boolean') next.hidden = existing.hidden
          if (typeof existing.displayName === 'string')
            next.displayName = existing.displayName
          if (typeof existing.num === 'string') next.num = existing.num
          if (newSchemes.pbr || newSchemes.registry) next.schemes = newSchemes

          return {
            drafts: { ...s.drafts, [id]: next },
          }
        }),

      setDraftsBatch: (entries) =>
        set((s) => {
          const next = { ...s.drafts }
          for (const [id, t] of entries) next[id] = { ...t }
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
          baseline: migrateMap(overrides),
          history: [],
          future: [],
        }),

      commitDrafts: (committed) =>
        set(() => ({ baseline: { ...committed }, drafts: {}, history: [], future: [] })),

      getEffective: (id) => {
        const s = get()
        return s.drafts[id] ?? s.baseline[id]
      },

      getEffectiveScheme: (id, mode) => {
        const s = get()
        const eff = s.drafts[id] ?? s.baseline[id]
        return eff?.schemes?.[mode]
      },

      isDirty: (id) => {
        const s = get()
        const d = s.drafts[id]
        if (!d) return false
        const b = s.baseline[id]
        if (!b) return true
        return !vEqual(d, b)
      },

      getMergedMap: () => {
        const s = get()
        return { ...s.baseline, ...s.drafts }
      },
    }),
    {
      name: 'mrc-v2-visual-props-edit',
      partialize: (state) => ({
        editMode: state.editMode,
      }),
      version: 2,
    },
  ),
)

/** Az aktuálisan piszkos (drafts !== baseline) id-k halmaza UI-jelölőkhöz. */
export function useDirtyVisualIds(): ReadonlySet<string> {
  const drafts = useVisualPropsStore((s) => s.drafts)
  const baseline = useVisualPropsStore((s) => s.baseline)
  const ids = new Set<string>()
  for (const [id, d] of Object.entries(drafts)) {
    const b = baseline[id]
    if (!b || !vEqual(d, b)) ids.add(id)
  }
  return ids
}
