/**
 * STL export a regiszter alapján.
 *
 * - Headless (renderer nélkül) felépít egy `THREE.Scene`-t a regiszter realisztikus
 *   szintű geometriáiból, és binary STL-ben exportálja.
 * - Ehhez React-független módon kell a builder-eket példányosítani — viszont
 *   a builder-ek React komponensek. Megoldás: a buildert egy off-screen React-rendererrel
 *   szerelnénk össze, vagy egyszerűbben: kérünk a builder-től egy nem-React verziót.
 *
 * Egyszerűsítés a bootstrap-hez:
 *   - A jelenlegi modellben a `buildSceneForExport()` a regiszterben szereplő
 *     `bbox` méretek alapján BoxGeometry-t generál minden alkatrészhez (ez a
 *     "minimum garantált" szint). A CAD-szintű geometria akkor lesz exportálva,
 *     amikor a builder komponensek megkapják majd a `toMesh()` non-React változatot
 *     (lásd a follow-up alatt).
 *   - Ez az egyszerűsített export ÍGY IS használható: ki lehet menteni az
 *     alkatrészek bounding box-szerű kompozícióját — szerelvény-ellenőrzéshez,
 *     ütközés-vizsgálathoz, méretarány-validáláshoz.
 *
 * Follow-up (külön körben):
 *   - A parts/<Id>.tsx fájlokban opcionális `<Id>Geometry()` export, amely
 *     pure-Three.js (React nélkül) építi fel ugyanazt a geometriát; a registry-be
 *     külön mező; az exporter ezt használja, ha létezik.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { TUBE_BENDER_REGISTRY, getChildren } from './componentRegistry'
import type { ComponentDef } from './types'

export interface ExportOptions {
  /**
   * Ha meg van adva, csak az adott alkatrész és leszármazottai kerülnek be
   * az exportba. Egyébként az egész fa.
   */
  rootId?: string
  /** Fájlnév javaslat (kiterjesztés nélkül). */
  filename?: string
}

/**
 * Felépít egy headless `THREE.Scene`-t a regiszter alapján,
 * BoxGeometry-vel a bbox méretekből (lásd a fájl tetejét).
 */
function buildSceneForExport(rootId?: string): THREE.Scene {
  const scene = new THREE.Scene()

  function addNode(parentObj: THREE.Object3D, def: ComponentDef) {
    const grp = new THREE.Group()
    grp.position.fromArray(def.transform.position)
    if (def.transform.rotation) grp.rotation.fromArray(def.transform.rotation)
    if (def.transform.scale) grp.scale.fromArray(def.transform.scale)
    grp.userData.componentId = def.id
    grp.name = `${def.num}_${def.id}`

    const size = def.bbox?.size ?? [40, 40, 40]
    const geom = new THREE.BoxGeometry(size[0], size[1], size[2])
    const mat = new THREE.MeshStandardMaterial({ color: def.color })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.userData.componentId = def.id
    mesh.name = `${def.id}_mesh`
    grp.add(mesh)

    parentObj.add(grp)

    for (const child of getChildren(def.id)) addNode(grp, child)
  }

  if (rootId) {
    const def = TUBE_BENDER_REGISTRY.find((c) => c.id === rootId)
    if (def) addNode(scene, def)
  } else {
    for (const def of TUBE_BENDER_REGISTRY) {
      if (def.parentId === null) addNode(scene, def)
    }
  }
  return scene
}

/**
 * Exportálja a modellt STL-be és letölthető fájlként a böngészőben elindítja.
 */
export function exportStl(opts: ExportOptions = {}): void {
  const scene = buildSceneForExport(opts.rootId)
  const exporter = new STLExporter()
  // Binary STL — kompaktabb, mm egységeket feltételez.
  const data = exporter.parse(scene, { binary: true }) as DataView | string

  const blob =
    data instanceof DataView
      ? new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' })
      : new Blob([data], { type: 'model/stl' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.filename ?? (opts.rootId ? `tube-bender-${opts.rootId}` : 'tube-bender')}.stl`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      const mat = node.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
  })
}
