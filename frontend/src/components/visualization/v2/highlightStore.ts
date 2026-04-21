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

interface HighlightStore {
  selectedId: string | null
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

  setSelectedId: (id: string | null) => void
  setHoveredId: (id: string | null) => void
  setLodLevel: (lod: LodLevel) => void
  setColorMode: (mode: ColorMode) => void
  setFadeOthers: (v: boolean) => void
  toggleHidden: (id: string) => void
  setHidden: (id: string, hidden: boolean) => void
  showAll: () => void
  hideAll: (ids: string[]) => void
}

export const useHighlightStore = create<HighlightStore>()(
  persist(
    (set) => ({
      selectedId: null,
      hoveredId: null,
      lodLevel: 'realistic',
      colorMode: 'pbr',
      fadeOthers: true,
      hiddenIds: [],

      setSelectedId: (id) => set({ selectedId: id }),
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
    }),
    {
      name: 'mrc-v2-ui',
      // Csak a UI-preferenciákat perzisztáljuk; a kiválasztás / hover tranziens.
      partialize: (state) => ({
        lodLevel: state.lodLevel,
        colorMode: state.colorMode,
        fadeOthers: state.fadeOthers,
        hiddenIds: state.hiddenIds,
      }),
      version: 2,
    },
  ),
)
