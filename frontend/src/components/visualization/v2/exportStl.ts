/**
 * STL export az élő (renderelt) Three.js scene-ből.
 *
 * # Hogy működik?
 *
 * Az R3F (`@react-three/fiber`) `<Canvas>` belül futó `TubeBenderModelV2`
 * minden frame-ben felépíti a teljes Three.js fát az aktuális LOD-szinten.
 * A `liveSceneRegistry` modul-szinten tartja a model root group referenciáját
 * (és a per-komponens groupokat) — innen olvasunk.
 *
 * Az exporter:
 *   1) Megkeresi a forrás-group-ot:
 *      - `opts.rootId` adott → `liveGroupRegistry.get(rootId)` (subtree).
 *      - különben a `liveModelRoot` (teljes modell).
 *   2) Bejárja a fát, és minden `THREE.Mesh`-t — amelynek `userData.componentId`
 *      van — felvesz az export-jelölt halmazba. Ezzel kiszűrjük az R3F belső
 *      / drei helper meshjeit (TransformControls handle-jei, GizmoViewcube,
 *      OrbitControls debug-helperek stb.).
 *   3) Opcionálisan kihagyja a `hiddenIds`-ben szereplő komponenseket — bár
 *      azokat a renderer eleve ki sem rajzolja, így a fában sincsenek; ez
 *      csak biztonsági háló.
 *   4) Minden megmaradt mesh geometriáját klónozza, és a klónra rákeni a
 *      `mesh.matrixWorld`-et — így a klón geometria már WORLD-koordinátákban
 *      van. Az export-scene ezeket azonosság-mátrixú mesh-ekként tartalmazza,
 *      amit az `STLExporter` egyszerűen kiír.
 *   5) Bináris STL-ként letölti a fájlt, majd a klón geometriákat eldobja.
 *
 * # Miért nem headless React-render?
 *
 * Az alkatrészek React komponensek (lásd `parts/*.tsx`). Headless példányosításhoz
 * vagy minden builderhez kéne egy duplikált, pure-Three.js variáns (~20 fájl
 * karbantartás), vagy R3F off-screen Canvas-t kéne futtatni. Az élő scene-ből
 * való export pragmatikusabb: a felhasználó EXACT azt exportálja, amit lát.
 *
 * # Fallback (live scene nincs)
 *
 * Ha a `<Canvas>` még nem mountolódott vagy az `exportStl()`-t Canvas-mentes
 * kontextusból hívják, a `liveModelRoot === null`. Ekkor a régi bbox-alapú
 * exportra esünk vissza (registry-ből BoxGeometry komponensenként). Ez a viz.
 * panel hibakezeléséhez kell, hogy a STL gomb sose dobjon error-t.
 *
 * # FreeCAD kompatibilitás
 *
 * - Egységek: a model mm-ben van, FreeCAD STL-importer alapból mm-t feltételez.
 * - Z-up: a Three.js scene Z-up konvencióban van (`THREE.Object3D.DEFAULT_UP`),
 *   és FreeCAD is Z-up. STL maga nem hordoz koordinátarendszer-info-t, de a
 *   számértékek megegyeznek.
 * - Bináris STL header: 80 byte (üres) — a `STLExporter` korrekt formátumban írja.
 * - Normálok: a `STLExporter` a háromszög-vertexek cross-product-jából számol.
 *   Degenerált háromszögek (collinear vertexek) esetén NaN normálokat adhat;
 *   a builderek mindenhol valós, nem-zérus geometriát építenek (`BoxGeometry`,
 *   `CylinderGeometry`, `LatheGeometry` stb.), így ez nem szokott előfordulni.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import {
  TUBE_BENDER_REGISTRY,
  getChildren,
  getRegistryNode,
} from './componentRegistry'
import { useHighlightStore } from './highlightStore'
import { getLiveModelRoot, liveGroupRegistry } from './liveSceneRegistry'
import { resolveTransform } from './transformResolver'
import { isAssembly, type RegistryNode } from './types'
import { createLogger } from '../../../utils/logger'

const log = createLogger('exportStl')

export interface ExportOptions {
  /**
   * Ha meg van adva, csak az adott alkatrész és leszármazottai kerülnek be
   * az exportba. Egyébként az egész fa.
   */
  rootId?: string
  /** Fájlnév javaslat (kiterjesztés nélkül). */
  filename?: string
  /**
   * Ha `true`, a regiszter-bbox alapú legacy exportot használja (BoxGeometry
   * minden komponensre). Default: `false` — az élő scene realisztikus geometriáját
   * exportálja. Akkor lehet hasznos, ha gyors méret-validáció kell, vagy a
   * Canvas még nem mountolódott.
   */
  bboxOnly?: boolean
}

// =============================================================================
// REALISZTIKUS export — élő scene-ből
// =============================================================================

/**
 * Skálázás-szanitálás: ha a `t.scale` bármelyik komponense ≈ 0, akkor a
 * keletkező BoxGeometry degenerált plane-né esik össze, és az STLExporter
 * normál-számítása NaN-okat ad (a `cb.cross(ab).normalize()` 0-hosszú vektoron).
 */
function sanitizeScale(scale: [number, number, number]): [number, number, number] {
  const safe = (n: number): number => (Number.isFinite(n) && Math.abs(n) > 1e-6 ? n : 1)
  return [safe(scale[0]), safe(scale[1]), safe(scale[2])]
}

/** BBox-méret szanitálás: 0 / negatív / NaN esetén 1 mm-es minimum. */
function sanitizeSize(size: [number, number, number]): [number, number, number] {
  const safe = (n: number): number => (Number.isFinite(n) && n > 1e-6 ? n : 1)
  return [safe(size[0]), safe(size[1]), safe(size[2])]
}

/**
 * Felépít egy headless export-scene-t az élő modell renderelt geometriájából.
 * Minden mesh geometriáját klónozza, és a klónra "beleégeti" a world-mátrixot.
 * A visszatérő scene-en a `STLExporter` azonosság-mátrixokkal találkozik, így
 * minden vertex már a végleges WORLD-pozícióban van.
 *
 * @param sourceGroup A live scene-beli group, amelyből exportálunk (root vagy subtree).
 * @param hiddenIds  A felhasználó által elrejtett komponens-id-k (ezeket kihagyjuk).
 * @returns Friss `THREE.Scene` és a klónozott geometriák tömbje (dispose-hoz).
 */
function buildSceneFromLive(
  sourceGroup: THREE.Group,
  hiddenIds: ReadonlySet<string>,
): { scene: THREE.Scene; clonedGeometries: THREE.BufferGeometry[] } {
  // A forrás world-mátrixait frissen tartjuk. A renderer minden frame-ben
  // megteszi, de ha az export pl. paused canvas-ból fut, akkor ez biztosítja
  // a konzisztenciát.
  sourceGroup.updateMatrixWorld(true)

  const exportScene = new THREE.Scene()
  const clonedGeometries: THREE.BufferGeometry[] = []
  // Egy default material elég — STL nem hordoz material info-t, csak triangleset.
  const placeholderMat = new THREE.MeshBasicMaterial()

  let totalMeshes = 0
  let untaggedMeshes = 0
  let hiddenSkipped = 0
  let invalidGeomSkipped = 0
  let invisibleSkipped = 0
  let exportedMeshCount = 0
  sourceGroup.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return
    totalMeshes += 1
    const mesh = node as THREE.Mesh

    // 1) Komponens-tag-eltség: kiszűri a TransformControls handle-eket,
    //    GizmoViewcube-ot, OrbitControls debug-mesheket stb.
    const componentId = mesh.userData?.componentId as string | undefined
    if (!componentId) {
      untaggedMeshes += 1
      return
    }
    if (hiddenIds.has(componentId)) {
      hiddenSkipped += 1
      return
    }

    // 2) Láthatóság: rejtett mesh-eket (pl. drei TransformControls elrejtett
    //    handle-jei, vagy edit-módban kikapcsolt vizuálisok) ne exportáljunk.
    if (!mesh.visible) {
      invisibleSkipped += 1
      return
    }

    // 3) Geometria-validitás: a `STLExporter` belső `traverse`-e a
    //    `geometry.getAttribute('position').count`-tal számol; ha a position
    //    attribute undefined → `TypeError: positionAttribute is undefined`
    //    az `STLExporter.js:36`-on. Ez a leggyakrabban azért fordul elő, mert
    //    egy drei/three helper-mesh (TransformControls picker-plane, edges-
    //    helper, BoxHelper child) öröklődési láncon át a parent group
    //    `tagComponentId` rekurziójától véletlenül megkapja a `componentId`
    //    userData-t. A strict filter itt veszi le ezeket az export-jelölt
    //    halmazról.
    const geom = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geom || !geom.isBufferGeometry) {
      invalidGeomSkipped += 1
      return
    }
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!posAttr || posAttr.count === 0) {
      invalidGeomSkipped += 1
      return
    }
    // Háromszög-szám épség: indexed → index.count % 3 === 0;
    // non-indexed → position.count % 3 === 0. Az STLExporter floor-olna,
    // de tisztább, ha eleve nem etetjük rossz adattal.
    const idx = geom.index
    const triCount = idx ? idx.count : posAttr.count
    if (triCount === 0 || triCount % 3 !== 0) {
      invalidGeomSkipped += 1
      return
    }

    let baked: THREE.BufferGeometry
    try {
      baked = geom.clone()
      baked.applyMatrix4(mesh.matrixWorld)
    } catch (err) {
      // Csendes védelem: egzotikus geometriánál (custom subclass, prototype
      // hekkelve) a clone / applyMatrix4 dobhat. Ne állítsa meg az exportot.
      log.warn(`Geometriát nem lehet klónozni '${componentId}'-hez:`, err)
      invalidGeomSkipped += 1
      return
    }
    clonedGeometries.push(baked)

    const exportMesh = new THREE.Mesh(baked, placeholderMat)
    exportMesh.userData.componentId = componentId
    exportMesh.name = `${componentId}_${exportedMeshCount}`
    exportScene.add(exportMesh)
    exportedMeshCount += 1
  })

  log.info(
    `Live scene traverse: ${totalMeshes} mesh összesen, ${exportedMeshCount} exportálva, ` +
      `${untaggedMeshes} tag-eletlen, ${hiddenSkipped} elrejtett, ` +
      `${invisibleSkipped} láthatatlan, ${invalidGeomSkipped} érvénytelen geometria`,
  )

  return { scene: exportScene, clonedGeometries }
}

// =============================================================================
// LEGACY bbox export — ha nincs élő scene
// =============================================================================

/**
 * Felépít egy headless `THREE.Scene`-t a regiszter alapján,
 * BoxGeometry-vel a bbox méretekből. Csak fallback / debug céllal.
 */
function buildBboxScene(rootId?: string): THREE.Scene {
  const scene = new THREE.Scene()

  function addNode(parentObj: THREE.Object3D, node: RegistryNode) {
    const t = resolveTransform(node, getRegistryNode)
    const grp = new THREE.Group()
    grp.position.fromArray(t.position)
    grp.rotation.fromArray(t.rotation)
    grp.scale.fromArray(sanitizeScale(t.scale))
    grp.userData.componentId = node.id
    const numPart = 'num' in node && node.num != null ? `${node.num}_` : ''
    grp.name = `${numPart}${node.id}`

    if (!isAssembly(node)) {
      const size = sanitizeSize(node.bbox?.size ?? [40, 40, 40])
      const geom = new THREE.BoxGeometry(size[0], size[1], size[2])
      const mat = new THREE.MeshStandardMaterial({ color: node.color })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.userData.componentId = node.id
      mesh.name = `${node.id}_mesh`
      grp.add(mesh)
    }

    parentObj.add(grp)
    for (const child of getChildren(node.id)) addNode(grp, child)
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

// =============================================================================
// Public API
// =============================================================================

/**
 * Exportálja a modellt STL-be és letölthető fájlként a böngészőben elindítja.
 *
 * Default: az élő scene-ből exportálja a renderelt valós geometriát az aktuális
 * LOD-szinten. Ha realisztikus modellt akarsz exportálni, **válts át "realistic"
 * LOD-ra** az export előtt — a fájlba az kerül, amit a viewerben látsz.
 *
 * Ha a Canvas még nem mountolódott (pl. SSR, korai hívás), vagy `bboxOnly: true`,
 * akkor a regiszter `bbox` méretek alapján BoxGeometry-vel exportál (legacy).
 */
export function exportStl(opts: ExportOptions = {}): void {
  const useLive = !opts.bboxOnly
  const liveRoot = getLiveModelRoot()
  const subtreeRoot = opts.rootId ? liveGroupRegistry.get(opts.rootId) ?? null : null

  let scene: THREE.Scene
  let clonedGeometries: THREE.BufferGeometry[] = []
  let exportSourceMode: 'live' | 'bbox'

  // Forrás-választás: live root / live subtree / bbox fallback.
  const sourceGroup = opts.rootId ? subtreeRoot : liveRoot
  log.info(
    `exportStl indul: rootId=${opts.rootId ?? '(teljes)'}, ` +
      `liveRoot=${liveRoot ? 'OK' : 'NULL'}, ` +
      `subtreeRoot=${opts.rootId ? (subtreeRoot ? 'OK' : 'NULL') : '-'}, ` +
      `bboxOnly=${!!opts.bboxOnly}`,
  )
  if (useLive && sourceGroup) {
    const hiddenIds = new Set(useHighlightStore.getState().hiddenIds)
    const built = buildSceneFromLive(sourceGroup, hiddenIds)
    scene = built.scene
    clonedGeometries = built.clonedGeometries
    exportSourceMode = 'live'
  } else {
    log.warn(
      `Live scene nem elérhető (rootId=${opts.rootId ?? '(teljes)'}) — bbox fallback. ` +
        `Ellenőrizd, hogy a Canvas mountolva van és a TubeBenderModelV2 root group bejegyezte magát.`,
    )
    scene = buildBboxScene(opts.rootId)
    exportSourceMode = 'bbox'
  }

  // Védelem üres scene ellen — ha mégis 0 mesh-szel jutottunk volna ide
  // (pl. a live root traverse semmit sem talált), ne töltsünk le egy 84-byte-os
  // üres STL-t (az csendben "nem történik semmi"-szerű élmény).
  let meshCount = 0
  scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshCount += 1
  })
  if (meshCount === 0) {
    log.error(
      `STL export ABORT: 0 exportálható mesh (forrás: ${exportSourceMode}, rootId=${opts.rootId ?? '(teljes)'}). ` +
        `Lehetséges ok: live scene még nem mountolódott, vagy minden alkatrész elrejtve.`,
    )
    if (typeof window !== 'undefined') {
      window.alert(
        'STL export sikertelen: nincs exportálható geometria.\n\n' +
          'Lehetséges okok:\n' +
          '  • A 3D nézet még nem töltődött be teljesen — várj pár másodpercet és próbáld újra.\n' +
          '  • Minden alkatrész el van rejtve a komponens-táblázatban.\n\n' +
          'Részletek a fejlesztői konzolon.',
      )
    }
    return
  }

  // Headless mátrix-frissítés. Bbox-fallback esetén kötelező (renderer nincs);
  // live esetben a klónozott geometriák azonosság-mátrixú mesh-eken vannak,
  // így ez no-op, de a hívás olcsó és biztonsági háló.
  scene.updateMatrixWorld(true)

  const exporter = new STLExporter()
  // Binary STL — kompaktabb, mm egységeket feltételez. A `STLExporter` típus-
  // signature `string`-ként deklarálja, valójában `DataView`-t ad vissza binary
  // módban (lásd `node_modules/three/examples/jsm/exporters/STLExporter.js`).
  const data = exporter.parse(scene, { binary: true }) as unknown as DataView | string

  // A `Blob` BlobPart-ja `BufferSource | string | Blob`, ahol BufferSource =
  // `ArrayBufferView<ArrayBuffer> | ArrayBuffer`. A DOM-typing szigorú a generikus
  // ArrayBufferLike → ArrayBuffer megszorításra, ezért a `data.buffer`-t explicit
  // `ArrayBuffer`-ré cast-oljuk. (Az `STLExporter` bináris módban friss
  // `new ArrayBuffer(...)`-ral hozza létre a target-et — ez tényleges ArrayBuffer.)
  const blob = typeof data === 'string'
    ? new Blob([data], { type: 'model/stl' })
    : new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // Fájlnév suffix: realistic/bbox + opcionális rootId. Pl. `tube-bender-realistic.stl`.
  const baseName = opts.filename ?? (opts.rootId
    ? `tube-bender-${opts.rootId}-${exportSourceMode}`
    : `tube-bender-${exportSourceMode}`)
  a.download = `${baseName}.stl`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  // Cleanup: a klónozott geometriák felszabadítása (a live scene-belieket
  // SOSE dispose-oljuk, azokat a renderer / React tartja). A bbox-fallback
  // mesh-jei a `scene.traverse`-szel kerülnek felszabadításra.
  for (const g of clonedGeometries) g.dispose()
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      // Csak akkor dispose, ha NEM az általunk klónozott geometriák egyike
      // (azokat már fent dispose-oltuk). Bbox-fallback esetén az itt szereplő
      // geometriák épp a fent generált BoxGeometry-k → dispose-olandók.
      if (!clonedGeometries.includes(node.geometry as THREE.BufferGeometry)) {
        node.geometry.dispose()
      }
      const mat = node.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat !== undefined) mat.dispose()
    }
  })
}
