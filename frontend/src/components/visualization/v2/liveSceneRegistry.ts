/**
 * Élő (renderelt) Three.js scene-objektumok modul-szintű regisztere.
 *
 * # Mit oldunk meg vele?
 *
 * Az R3F (`@react-three/fiber`) Canvas-on belül futó komponensek (`TubeBenderModelV2`,
 * `ComponentNode`, `AssemblyNode`) már egy live Three.js fát építenek fel — ezt
 * a renderer minden frame-ben frissíti (matrix world, materialok). A Canvas-on
 * KÍVÜL futó kódnak (pl. `exportStl()` az `VisualizationPanel`-ből) szüksége
 * van rá, hogy elérje:
 *   - a fa gyökerét — STL export
 *   - egy konkrét komponens / assembly group-ját — pl. csak a kiválasztott
 *     subtree exportálása, vagy multi-select drag delta számításához.
 *
 * React Context nem jó: az `exportStl` hívása sima függvényhívás, nem React
 * komponens — nincs hook-context. Module-szintű refek ellenben mindenhonnan
 * elérhetők, és a lifecycle-t a használó komponens `useEffect`-jei szabályozzák.
 *
 * # Lifecycle szabályok
 *
 *   - `setLiveModelRoot(group)` → `useEffect` mountkor a `TubeBenderModelV2`
 *     gyökér `<group>`-jából.
 *   - `setLiveModelRoot(null)` → ugyanannak a useEffect-nek a cleanup-jában.
 *   - `liveGroupRegistry` → `useRegisteredGroup` hook (ld. `TubeBenderModelV2`)
 *     minden node mountkor `set`-tel jegyzi be, unmountkor eltávolítja.
 *     **Fontos:** csak akkor töröljük, ha még a saját group-unk van bent (re-mount
 *     közben az új instance felülírhatta — ezt a hook lekezeli).
 */
import type * as THREE from 'three'

let liveModelRoot: THREE.Group | null = null

/**
 * Beállítja vagy törli az élő model root group referenciáját.
 * A `TubeBenderModelV2` hívja mount/unmount cikluson.
 */
export function setLiveModelRoot(group: THREE.Group | null): void {
  liveModelRoot = group
}

/**
 * Visszaadja az élő model root group-ot, vagy `null`-t, ha még nincs mountolva
 * (pl. a Canvas még nem jelent meg, vagy unmount közbeni hívás).
 */
export function getLiveModelRoot(): THREE.Group | null {
  return liveModelRoot
}

/**
 * Per-komponens / per-assembly group registry. A `useRegisteredGroup` hook
 * írja minden `ComponentNode` / `AssemblyNode` mount-cyclus-án keresztül.
 *
 * Use case-ek:
 *   - Multi-select drag (NodeGizmo): a primer drag delta-ját szekunder group-okra
 *     applikáljuk a saját parent-lokális keretükben.
 *   - STL export subtree: `exportStl({ rootId: 'foo' })` esetén a `foo` id alatti
 *     subtree group-ját olvassuk és arra hívjuk a `STLExporter`-t.
 */
export const liveGroupRegistry = new Map<string, THREE.Group>()
