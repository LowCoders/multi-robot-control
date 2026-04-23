/**
 * Globális UI állapot a V2 csőhajlító modellhez:
 *   - melyik alkatrész van kijelölve (selectedId),
 *   - melyik fölött lebeg a kurzor (hoveredId),
 *   - aktív LOD-szint és színmód.
 *
 * A táblázat panel és a 3D renderer ugyanezt a store-t olvassa, így a két irány
 * (táblázat -> 3D, 3D -> táblázat) kétirányú kapcsolatban marad.
 *
 * **Perzisztencia:** a felhasználói preferenciák (lodLevel, colorMode, fadeOthers)
 * localStorage-ban vannak elmentve a `mrc-v2-ui` kulcs alatt, így lapfrissítés
 * (vagy új session) után is megmaradnak. A tranziens állapotok (selectedId,
 * hoveredId) NEM perzisztálnak — minden session friss kezdéssel indul.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LodLevel } from './types'

/**
 * 'pbr'      = az alkatrészek saját PBR anyagai (acél/műanyag look),
 * 'registry' = minden alkatrész a regiszterben megadott egyedi színével renderel.
 *              Ez a "közös nyelv" mód.
 */
export type ColorMode = 'pbr' | 'registry'

/**
 * A felhasználó által beállított, perzisztált kamera-poz + target
 * (OrbitControls onChange → throttled mentés). Lapfrissítés után a `Scene`
 * első mountkor visszatölti, így ugyanaz a nézet jön vissza.
 *
 * Ha az érték `null`, a Scene a config-eredetű alap-pozíciót (`cameraPos`,
 * `cameraTarget`) használja.
 */
export interface CameraPose {
  pos: [number, number, number]
  target: [number, number, number]
}

/**
 * Tranziens "pan-parancs" a CameraPanPad overlay-tól a Scene-ig: a `dir` a
 * képernyő-relatív irány (a Scene számolja ki a kamera right/up vektorát),
 * az `amount` az eltolás mértéke világ-mm-ben. A `tick` minden parancsnál
 * növekszik, így az ugyanazon irányra történő ismételt kattintás is külön
 * effect-futtatásként érvényesül.
 */
export interface PanCommand {
  dir: 'up' | 'down' | 'left' | 'right'
  amount: number
  tick: number
}

/**
 * Tranziens "reset-parancs" a CameraPanPad overlay-tól a Scene-ig: állítsuk
 * vissza a kamerát a config-eredetű alap-pozícióra, és töröljük a perzisztált
 * `cameraPose`-t. Egy egyszerű tick-számláló elég.
 */
export interface ResetCommand {
  tick: number
}

interface HighlightStore {
  /**
   * Az ELSŐDLEGES (legutóbb kattintott) kijelölt id. Ez az "anchor" — a gizmo
   * ezen ül, a TransformEditPanel ennek értékeit mutatja, az STL "csak ezt"
   * export erre vonatkozik.
   *
   * Multiselect (Shift / Ctrl click) esetén `selectedIds` tartalmaz további
   * id-ket is; a `selectedId` mindig az utolsóként hozzáadottra mutat.
   */
  selectedId: string | null
  /**
   * A kijelölt id-k teljes halmaza. INVARIÁNS: ha `selectedId !== null`, akkor
   * `selectedId === selectedIds[selectedIds.length - 1]` (az utolsó hozzáadott).
   * Ha `selectedId === null`, akkor `selectedIds = []`.
   *
   * A multi-selection elsősorban edit mode-ban hasznos (közös mozgatás), de a
   * highlight rendering minden kijelöltet kiemel (és fade-eli a többit, ha be
   * van kapcsolva a `fadeOthers`).
   */
  selectedIds: string[]
  hoveredId: string | null
  lodLevel: LodLevel
  colorMode: ColorMode
  /**
   * Ha be van kapcsolva, a nem-kiválasztott alkatrészek áttetszőek lesznek
   * (a kiemelés erősebb). Csak akkor van hatása, ha selectedId nem null.
   */
  fadeOthers: boolean
  /**
   * Az alkatrészek (id-k), amelyek el vannak rejtve a 3D nézetben.
   * Csak az adott komponens saját builder/mesh-e nem renderel — a children
   * (akiknek ez `parentId`-je) továbbra is láthatóak maradnak (mindegyiket
   * külön lehet rejteni). Perzisztált (localStorage), a session túléli.
   */
  hiddenIds: string[]
  /**
   * Az aktuális kamera-poz + target. PERZISZTÁLT: az OrbitControls onChange
   * eseményéből throttled módon írja a Scene, így a felhasználó utolsó nézete
   * lapfrissítés után visszatöltődik. `null` = még nem volt mentés (vagy
   * `resetCamera()` kibocsátva), a Scene a config defaultját használja.
   */
  cameraPose: CameraPose | null
  /**
   * Tranziens pan-parancs (NEM perzisztált): a CameraPanPad írja, a Scene
   * `useEffect`-tel olvassa. Null = még nem volt parancs.
   */
  panCommand: PanCommand | null
  /**
   * Tranziens reset-parancs (NEM perzisztált): a CameraPanPad reset-gombja
   * írja, a Scene `useEffect`-tel olvassa, és a config-eredetű alap-pozícióra
   * állítja a kamerát. Null = még nem volt parancs.
   */
  resetCommand: ResetCommand | null

  /**
   * Egy-elemű kijelölés (vagy törlés) — a multi-select halmazt ÜRÍTI és csak
   * ezt az egyet hagyja meg. Ezt használja a háttér-deselect (`null`) és a
   * hagyományos egyszer-kattintós kijelölés.
   */
  setSelectedId: (id: string | null) => void
  /**
   * Toggle-eli az adott id-t a multi-select halmazban. Ha még nem volt benne,
   * hozzáadja és primary-vé teszi; ha benne volt, kivesz, és új primary az
   * előző elem (vagy `null`, ha üres lett a halmaz). Shift / Ctrl + click
   * használja.
   */
  toggleInSelection: (id: string) => void
  /** Teljes kijelölés-halmaz felülírása (alacsony szintű API, ritkán kell). */
  setSelectedIds: (ids: string[]) => void
  /** Az összes kijelölés törlése. Equivalent: `setSelectedId(null)`. */
  clearSelection: () => void
  setHoveredId: (id: string | null) => void
  setLodLevel: (lod: LodLevel) => void
  setColorMode: (mode: ColorMode) => void
  setFadeOthers: (v: boolean) => void
  toggleHidden: (id: string) => void
  setHidden: (id: string, hidden: boolean) => void
  showAll: () => void
  hideAll: (ids: string[]) => void
  /**
   * A kamera-poz mentése. A Scene throttled módon hívja az OrbitControls
   * onChange eseményéből.
   */
  setCameraPose: (pose: CameraPose) => void
  /**
   * Pan-parancs küldése a Scene-nek. A `tick` automatikusan inkrementálódik,
   * így az ugyanazon irányra többszörös kattintás is "új parancs"-ként
   * érvényesül.
   */
  panCamera: (dir: PanCommand['dir'], amount: number) => void
  /**
   * Reset-parancs küldése a Scene-nek. A perzisztált `cameraPose`-t is null-ra
   * állítja, így a Scene a config-eredetű alap-pozícióra ugrik vissza.
   */
  resetCamera: () => void
}

/**
 * Sanity check egy perzisztált `CameraPose` objektumra: visszaadja `null`-t,
 * ha bármelyik szám nem véges (NaN/Infinity), vagy ha a struktúra nem stimmel.
 * Így a corrupt localStorage nem akasztja meg a Scene betöltését.
 */
function sanitizeCameraPose(input: unknown): CameraPose | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const pos = obj['pos']
  const target = obj['target']
  if (!Array.isArray(pos) || !Array.isArray(target)) return null
  if (pos.length !== 3 || target.length !== 3) return null
  if (!pos.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (!target.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return {
    pos: [pos[0] as number, pos[1] as number, pos[2] as number],
    target: [target[0] as number, target[1] as number, target[2] as number],
  }
}

export const useHighlightStore = create<HighlightStore>()(
  persist(
    (set) => ({
      selectedId: null,
      selectedIds: [],
      hoveredId: null,
      lodLevel: 'realistic',
      colorMode: 'pbr',
      fadeOthers: true,
      hiddenIds: [],
      cameraPose: null,
      panCommand: null,
      resetCommand: null,

      setSelectedId: (id) =>
        set({
          selectedId: id,
          selectedIds: id === null ? [] : [id],
        }),
      toggleInSelection: (id) =>
        set((s) => {
          const idx = s.selectedIds.indexOf(id)
          if (idx === -1) {
            // Nincs benne → hozzáadjuk, és ez lesz az új primary.
            const next = [...s.selectedIds, id]
            return { selectedIds: next, selectedId: id }
          }
          // Benne van → kivesszük; új primary az új lista utolsó eleme (vagy null).
          const next = s.selectedIds.filter((x) => x !== id)
          return {
            selectedIds: next,
            selectedId: next.length > 0 ? (next[next.length - 1] ?? null) : null,
          }
        }),
      setSelectedIds: (ids) =>
        set({
          selectedIds: [...ids],
          selectedId: ids.length > 0 ? (ids[ids.length - 1] ?? null) : null,
        }),
      clearSelection: () => set({ selectedId: null, selectedIds: [] }),
      setHoveredId: (id) => set({ hoveredId: id }),
      setLodLevel: (lod) => set({ lodLevel: lod }),
      setColorMode: (mode) => set({ colorMode: mode }),
      setFadeOthers: (v) => set({ fadeOthers: v }),
      toggleHidden: (id) =>
        set((s) => ({
          hiddenIds: s.hiddenIds.includes(id)
            ? s.hiddenIds.filter((x) => x !== id)
            : [...s.hiddenIds, id],
        })),
      setHidden: (id, hidden) =>
        set((s) => {
          const has = s.hiddenIds.includes(id)
          if (hidden && !has) return { hiddenIds: [...s.hiddenIds, id] }
          if (!hidden && has) return { hiddenIds: s.hiddenIds.filter((x) => x !== id) }
          return s
        }),
      showAll: () => set({ hiddenIds: [] }),
      hideAll: (ids) => set({ hiddenIds: ids }),
      setCameraPose: (pose) => set({ cameraPose: pose }),
      panCamera: (dir, amount) =>
        set((s) => ({
          panCommand: {
            dir,
            amount,
            tick: (s.panCommand?.tick ?? 0) + 1,
          },
        })),
      resetCamera: () =>
        set((s) => ({
          cameraPose: null,
          resetCommand: { tick: (s.resetCommand?.tick ?? 0) + 1 },
        })),
    }),
    {
      name: 'mrc-v2-ui',
      // Csak a UI-preferenciákat + a kamera-poz-t perzisztáljuk; a kiválasztás,
      // hover, pan/reset parancsok tranziensek.
      partialize: (state) => ({
        lodLevel: state.lodLevel,
        colorMode: state.colorMode,
        fadeOthers: state.fadeOthers,
        hiddenIds: state.hiddenIds,
        cameraPose: state.cameraPose,
      }),
      // A merge step betöltéskor sanitize-olja a cameraPose-t (NaN/Infinity védelem).
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<HighlightStore>
        return {
          ...currentState,
          ...persisted,
          cameraPose: sanitizeCameraPose(persisted.cameraPose),
        }
      },
      version: 3,
    },
  ),
)
