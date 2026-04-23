/**
 * V2 csőhajlító 3D modell renderer.
 *
 * - Bejárja a regisztert (parentId hierarchia szerint), és minden alkatrészt
 *   az aktuális LOD-szinten renderel; ha az adott szinten nincs builder,
 *   sematikus fallback-et rajzol a `bbox` méretek alapján.
 * - Az alkatrészek mesh-eire `userData.componentId`-t terjeszt rekurzívan
 *   (akkor is, ha a builder esetleg lefelejtette).
 * - Kattintás esetén beállítja a `selectedId`-t a highlight store-ban.
 * - 'registry' színmódban felülírja az anyagok színét a regiszter színére.
 * - Highlight: a kiválasztott alkatrész emissive-pulzál, a többi (opció szerint)
 *   átlátszó lesz.
 *
 * Animáció: a position prop alapján az X (cső előtolása), Y (hajlító egység forgása
 * a csőtengely körül) és Z (hajlítókerék forgása) értékeket továbbítjuk azoknak
 * az alkatrészeknek, amelyek az adott animációs csoportba tartoznak.
 *
 * NOTE: A bootstrap-ben még csak az 'alap' (base) alkatrész van regisztrálva,
 * ezért az X/Y/Z animáció jelenleg vizuálisan nem látszik. A renderer fel van
 * készítve rá: a `tube`, `bend-unit` és `bend-die` szerelvény-id-jű csoportokat
 * keresi és transzformálja.
 */
import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  TUBE_BENDER_REGISTRY,
  getChildren,
  getDescendantComponents,
  getRegistryNode,
} from './componentRegistry'
import { useHighlightStore } from './highlightStore'
import { resolveTransform, type TransformOverride } from './transformResolver'
import { useTransformOverrideStore } from './transformOverrideStore'
import { useVisualPropsStore, type VisualPropsOverride } from './visualPropsStore'
import { isAssembly, type AssemblyDef, type ComponentDef, type RegistryNode } from './types'
import { liveGroupRegistry as groupRegistry, setLiveModelRoot } from './liveSceneRegistry'

// =============================================================================
// Csoport-regiszter — a multi-select közös mozgatás backbone-ja
// =============================================================================
//
// A `groupRegistry` map most a megosztott `liveSceneRegistry` modulban él,
// hogy a Canvas-on kívüli kód (pl. `exportStl`) is olvashassa. A korábbi
// in-file `Map`-et helyettesíti — szemantika változatlan: minden mountolt
// `AssemblyNode` / `ComponentNode` bejegyzi a saját THREE.Group-ját, unmountkor
// kiveszi.
//
// Miért nem Context? Mert a TransformControls drag-handler closure-ben futna
// el, és ott React state-hez (selectedIds-hez stb.) nehezen jutnánk konzisztens
// snapshot-tal. Module-Map + zustand `getState()` egyszerűbb és gyors.

/** React-szerű ergonómia hook: belép a regisztermbe, kilép unmount-kor. */
function useRegisteredGroup(id: string, group: THREE.Group | null): void {
  useEffect(() => {
    if (!group) return
    groupRegistry.set(id, group)
    return () => {
      // Csak akkor töröljük, ha még a saját group-unk van bent — időközben
      // re-mountnál a következő instance felülírhatta.
      if (groupRegistry.get(id) === group) groupRegistry.delete(id)
    }
  }, [id, group])
}

// =============================================================================
// Drag-end "fantomklikk" elnyelés
// =============================================================================
//
// A drei `TransformControls` a canvas DOM-elemen KÖZVETLEN pointerdown/move/up
// listener-eket akaszt (lásd `node_modules/@react-three/drei/core/TransformControls.js`).
// A drag pointerup után az R3F saját raycaster-e külön `click` eseményt
// detektál a felengedés pontján lévő mesh-re, ami a `ComponentNode.handleClick`
// alá kerül és hibásan átviszi a kijelölést a gizmo alatt lévő alkatrészre.
//
// Megoldás: a NodeGizmo a drag END-kor egy ~300 ms-es "suppression window"-t
// nyit, amely alatt a `ComponentNode.handleClick` early-return-nel elnyel
// minden klikk-eseményt. A user szándékos klikkjei (drag után 300 ms-mal)
// változatlanul működnek.
//
// Module-szintű mutáns timestamp — re-rendert NEM kell hozzá, ezért nem
// store-ban / context-ben tartjuk.
let suppressClickUntilMs = 0

/** Beállítja a suppression window kezdetét. */
function startClickSuppression(durationMs = 300) {
  suppressClickUntilMs = performance.now() + durationMs
}

/** True ha jelenleg a klikk-elnyelési ablakban vagyunk. */
function shouldSuppressClickNow(): boolean {
  return performance.now() < suppressClickUntilMs
}

/**
 * Exportált guard a Canvas-szintű `onPointerMissed` kezelőhöz —
 * ugyanaz a probléma: drag-end utáni "miss" eseménye törölné a kijelölést.
 */
export function isClickSuppressionActive(): boolean {
  return shouldSuppressClickNow()
}

/**
 * Rekurzívan beállítja a componentId-t a mesh.userData-ba minden leszármazotton.
 * Akkor is működik, ha a builder lefelejtette egy mesh-en — biztonsági háló.
 */
function tagComponentId(obj: THREE.Object3D, componentId: string) {
  obj.traverse((node) => {
    if (!node.userData.componentId) {
      node.userData.componentId = componentId
    }
  })
}

/** Sematikus fallback box, ha az adott LOD-on nincs builder. */
function FallbackBox({ size, color, componentId }: {
  size: [number, number, number]
  color: string
  componentId: string
}) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
    </mesh>
  )
}

/**
 * Drei `TransformControls` wrapper a kiválasztott node group-ra.
 *
 * # Funkciók
 *
 * 1) **Drag-OrbitControls koordináció**: drag közben letiltja az
 *    `OrbitControls`-ot (a drei `makeDefault`-os OrbitControls automatikusan
 *    elérhető a `useThree(s => s.controls)`-on keresztül), drag végén
 *    visszaengedi.
 * 2) **Multi-select közös mozgatás**: ha a `useHighlightStore.selectedIds`
 *    több mint egy elemet tartalmaz, a primer (`nodeId`) gizmo-húzás közben a
 *    delta-ját átszámolja a többi kijelölt csoport saját parent-lokális
 *    framébe is, és live frissíti a Three.js group-okat (`groupRegistry`-ből
 *    olvasva). Drag végén minden érintett group draft-ja batch-ben mentődik.
 * 3) **Undo integráció**: a drag-START-kor egyetlen `pushHistory()` snapshot
 *    készül, így az egész drag (sok köztes objectChange) egyetlen undo
 *    lépésnek számít.
 */
function NodeGizmo({
  nodeId,
  target,
}: {
  nodeId: string
  target: THREE.Object3D
}) {
  const gizmoMode = useTransformOverrideStore((s) => s.gizmoMode)
  const setDraft = useTransformOverrideStore((s) => s.setDraft)
  const setDraftsBatch = useTransformOverrideStore((s) => s.setDraftsBatch)
  const pushHistory = useTransformOverrideStore((s) => s.pushHistory)
  const orbitControls = useThree((s) => s.controls) as { enabled: boolean } | null
  const tcRef = useRef<any>(null)

  // Drag-tartós állapot: a drag-start-kor mentett kiindulási pose-ok minden
  // érintett group-ra. Re-render NEM kell hozzá, ezért ref.
  const dragStartRef = useRef<{
    primaryPos: THREE.Vector3
    primaryRot: THREE.Euler
    others: Array<{
      id: string
      group: THREE.Group
      pos: THREE.Vector3
      rot: THREE.Euler
    }>
  } | null>(null)

  useEffect(() => {
    const tc = tcRef.current
    if (!tc) return

    const onObjectChange = () => {
      const start = dragStartRef.current
      if (!start || start.others.length === 0) return
      // Delta a primer kiinduló és aktuális pose-ja között, parent-LOKÁLIS
      // framébe (a target.position / .rotation parent-lokális).
      const dx = target.position.x - start.primaryPos.x
      const dy = target.position.y - start.primaryPos.y
      const dz = target.position.z - start.primaryPos.z
      const drx = (target.rotation as THREE.Euler).x - start.primaryRot.x
      const dry = (target.rotation as THREE.Euler).y - start.primaryRot.y
      const drz = (target.rotation as THREE.Euler).z - start.primaryRot.z

      // Minden szekunder group: SAJÁT parent-lokális kiindulási pose + ugyanaz
      // a delta. Ha nem ugyanazon parent gyermekei, a "közös delta" parent-
      // lokálisan értelmezve (mindegyikük saját koordrendszerében) értelmes
      // approximáció. Sibling-csoportoknál (jellemző use case) tökéletes.
      for (const o of start.others) {
        o.group.position.set(o.pos.x + dx, o.pos.y + dy, o.pos.z + dz)
        o.group.rotation.set(o.rot.x + drx, o.rot.y + dry, o.rot.z + drz)
      }
    }

    const onDraggingChanged = (e: { value: boolean }) => {
      if (orbitControls) orbitControls.enabled = !e.value

      if (e.value) {
        // === Drag START ===
        // 1) History push — egy drag = egy undo lépés.
        pushHistory()
        // 2) Snapshot: primer + minden ÉLŐ szekunder kiinduló pose.
        const selectedIds = useHighlightStore.getState().selectedIds
        const others: Array<{
          id: string
          group: THREE.Group
          pos: THREE.Vector3
          rot: THREE.Euler
        }> = []
        for (const id of selectedIds) {
          if (id === nodeId) continue
          const g = groupRegistry.get(id)
          if (!g) continue
          others.push({
            id,
            group: g,
            pos: g.position.clone(),
            rot: g.rotation.clone(),
          })
        }
        dragStartRef.current = {
          primaryPos: target.position.clone(),
          primaryRot: (target.rotation as THREE.Euler).clone(),
          others,
        }
      } else {
        // === Drag END ===
        // 1) Klikk-elnyelési ablak nyitása — különben az R3F raycaster a
        //    pointerup utáni következő `click` eseményt a gizmo alatt lévő
        //    mesh-re küldené és átvándorolna a kijelölés.
        startClickSuppression(300)
        // 2) Batch-write a primer + minden szekunder draft-ját.
        const start = dragStartRef.current
        const entries: Array<[string, TransformOverride]> = [
          [
            nodeId,
            {
              position: [target.position.x, target.position.y, target.position.z],
              rotation: [
                (target.rotation as THREE.Euler).x,
                (target.rotation as THREE.Euler).y,
                (target.rotation as THREE.Euler).z,
              ],
            },
          ],
        ]
        if (start) {
          for (const o of start.others) {
            entries.push([
              o.id,
              {
                position: [o.group.position.x, o.group.position.y, o.group.position.z],
                rotation: [
                  o.group.rotation.x,
                  o.group.rotation.y,
                  o.group.rotation.z,
                ],
              },
            ])
          }
        }
        if (entries.length > 1) setDraftsBatch(entries)
        else setDraft(nodeId, entries[0]![1])
        dragStartRef.current = null
      }
    }

    tc.addEventListener('dragging-changed', onDraggingChanged)
    tc.addEventListener('objectChange', onObjectChange)
    return () => {
      tc.removeEventListener('dragging-changed', onDraggingChanged)
      tc.removeEventListener('objectChange', onObjectChange)
      // Biztos ami biztos: visszakapcsoljuk az orbitot ha unmount közben dragolt
      if (orbitControls) orbitControls.enabled = true
    }
  }, [nodeId, setDraft, setDraftsBatch, pushHistory, target, orbitControls])

  return (
    <TransformControls
      ref={tcRef}
      object={target}
      mode={gizmoMode}
      space="local"
      size={0.8}
    />
  )
}

interface NodeRenderProps {
  /**
   * A primer (utoljára kattintott) selection — a gizmo ezen ül, a fade /
   * highlight-descendants pivot-ja is ez.
   */
  highlightedId: string | null
  /**
   * MULTI-select: minden kijelölt id (beleértve a primer-t is). A
   * `selectedIds.length > 1` esetén a NodeGizmo közös delta-val mozgatja az
   * összeset, és a highlight is kiterjed mindre.
   */
  selectedIdsSet: ReadonlySet<string>
  /**
   * A jelenleg highlight-olt assembly összes leszármazott komponens-id-je
   * (a `useHighlightStore.selectedId` ID-jából számolva). Egy komponens akkor
   * "selected", ha a saját ID-je a highlightedId, VAGY benne van ebben a halmazban,
   * VAGY benne van a `selectedIdsSet`-ben (multi-select).
   */
  highlightDescendants: ReadonlySet<string>
  fadeOthers: boolean
  colorMode: 'pbr' | 'registry'
  lodLevel: 'schematic' | 'medium' | 'realistic'
  hiddenIds: ReadonlySet<string>
}

interface ComponentNodeProps extends NodeRenderProps {
  def: ComponentDef
}

interface AssemblyNodeProps extends NodeRenderProps {
  def: AssemblyDef
}

/**
 * Discriminated dispatch: a registry node `kind`-ja alapján rendereli a megfelelő
 * komponenst (`ComponentNode` vagy `AssemblyNode`).
 */
function RegistryNodeView(props: NodeRenderProps & { node: RegistryNode }) {
  const { node, ...rest } = props
  if (isAssembly(node)) {
    return <AssemblyNode def={node} {...rest} />
  }
  return <ComponentNode def={node} {...rest} />
}

/**
 * Üres `<group>`-szerű sub-assembly node: csak a transzformációt alkalmazza, és
 * rekurzívan rendereli a gyermek node-okat (komponens vagy további assembly).
 *
 * Saját geometriája NINCS, kattintási / hover-detektálása sincs külön (a gyermekek
 * mesh-jei kapják a kattintásokat). A transzformáció az anchor-mate-ből (`mount`)
 * vagy fallback-ben a `transform`-ból jön. Ha van felhasználói override
 * (`transformOverrideStore`), az mindkettőt felülírja.
 *
 * Edit mode-ban, ha ez az assembly van kijelölve, gizmo jelenik meg rajta.
 */
function AssemblyNode({
  def,
  highlightedId,
  selectedIdsSet,
  highlightDescendants,
  fadeOthers,
  colorMode,
  lodLevel,
  hiddenIds,
}: AssemblyNodeProps) {
  const override = useTransformOverrideStore(
    (s) => s.drafts[def.id] ?? s.baseline[def.id],
  )
  // Az assembly is támogatja a vizuális override-ot — a `scale` és a `hidden`
  // a teljes alfára hat (a children örökli). A material-mezők (color, opacity,
  // metalness, roughness) az assembly-n értelmetlenek, mert nincs saját
  // geometriája — ezeket a leszármazott `ComponentNode`-okra kell rakni.
  const visualOverride = useVisualPropsStore(
    (s): VisualPropsOverride | undefined => s.drafts[def.id] ?? s.baseline[def.id],
  )
  const editMode = useTransformOverrideStore((s) => s.editMode)
  // A gizmo CSAK a primer selection-en jelenik meg; a többi multi-selected
  // group szinkronban mozog vele a NodeGizmo `objectChange` handler-éből.
  const isSelectedTarget = highlightedId === def.id
  const groupRef = useRef<THREE.Group>(null)
  const [groupObj, setGroupObj] = useState<THREE.Group | null>(null)

  useEffect(() => {
    setGroupObj(groupRef.current)
  }, [])
  // Csoport-regiszter — multi-select közös mozgatáshoz.
  useRegisteredGroup(def.id, groupObj)

  const getOverride = useCallback(
    (id: string): TransformOverride | undefined => (id === def.id ? override : undefined),
    [def.id, override],
  )
  const t = useMemo(
    () => resolveTransform(def, getRegistryNode, getOverride),
    [def, getOverride],
  )
  // Effective scale = transform-scale × visual-override-scale (komponensenként).
  const effectiveScale = useMemo<[number, number, number]>(() => {
    const ts = t.scale
    const vs = visualOverride?.scale
    if (!vs) return ts
    return [ts[0] * vs[0], ts[1] * vs[1], ts[2] * vs[2]]
  }, [t.scale, visualOverride?.scale])
  const isAssemblyHidden = visualOverride?.hidden === true
  const children = getChildren(def.id)

  return (
    <>
      <group
        ref={groupRef}
        position={t.position}
        rotation={t.rotation}
        scale={effectiveScale}
        visible={!isAssemblyHidden}
      >
        {children.map((child) => (
          <RegistryNodeView
            key={child.id}
            node={child}
            highlightedId={highlightedId}
            selectedIdsSet={selectedIdsSet}
            highlightDescendants={highlightDescendants}
            fadeOthers={fadeOthers}
            colorMode={colorMode}
            lodLevel={lodLevel}
            hiddenIds={hiddenIds}
          />
        ))}
      </group>
      {editMode && isSelectedTarget && groupObj && (
        <NodeGizmo nodeId={def.id} target={groupObj} />
      )}
    </>
  )
}

/**
 * Egy komponens renderelése + a gyermekei rekurzív renderelése.
 * A transzformációt egy group adja, alá kerül a builder + a children.
 */
function ComponentNode({
  def,
  highlightedId,
  selectedIdsSet,
  highlightDescendants,
  fadeOthers,
  colorMode,
  lodLevel,
  hiddenIds,
}: ComponentNodeProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [groupObj, setGroupObj] = useState<THREE.Group | null>(null)
  const override = useTransformOverrideStore(
    (s) => s.drafts[def.id] ?? s.baseline[def.id],
  )
  // Vizuális tulajdonság-override (color / opacity / metalness / roughness /
  // scale / hidden / displayName / num). A `getEffective`-vel egyenértékű
  // szelektor: draft || baseline. Inline-olva a re-rendert csak a saját id
  // változására triggereljük.
  const visualOverride = useVisualPropsStore(
    (s): VisualPropsOverride | undefined => s.drafts[def.id] ?? s.baseline[def.id],
  )
  const editMode = useTransformOverrideStore((s) => s.editMode)
  const isSelectedTarget = highlightedId === def.id
  // Az effective hidden = registry hiddenIds ∪ visualOverride.hidden.
  const isHidden = hiddenIds.has(def.id) || visualOverride?.hidden === true

  useEffect(() => {
    setGroupObj(groupRef.current)
  }, [])
  // Csoport-regiszter — multi-select közös mozgatáshoz.
  useRegisteredGroup(def.id, groupObj)

  // Builder kiválasztás — fallback rendszer:
  // 1) próbáljuk az aktuális szintet,
  // 2) ha nincs, lépjünk lefelé (realistic -> medium -> schematic),
  // 3) ha sehol sincs, fallback box.
  const Builder = useMemo(() => {
    const order: Array<'schematic' | 'medium' | 'realistic'> =
      lodLevel === 'realistic'
        ? ['realistic', 'medium', 'schematic']
        : lodLevel === 'medium'
          ? ['medium', 'schematic', 'realistic']
          : ['schematic', 'medium', 'realistic']
    for (const lod of order) {
      const b = def.builders[lod]
      if (b) return b
    }
    return null
  }, [def.builders, lodLevel])

  // "Selected" akkor is, ha a highlightedId egy SZÜLŐ assembly id-je, és ez a komponens
  // a leszármazottja — assembly-szintű highlight. Multi-select: ha bármelyik
  // selected id (vagy annak leszármazottja) ez a komponens.
  const isSelected =
    highlightedId === def.id ||
    highlightDescendants.has(def.id) ||
    selectedIdsSet.has(def.id)
  const isFaded = highlightedId !== null && fadeOthers && !isSelected

  // A teljes group materiáljainak felülírása a tárolt állapot szerint:
  // - 'registry' színmódban a komponens színére (vagy a visual override szín-ére),
  // - kijelölt alkatrésznél emissive,
  // - fade módban opacitás csökkentése,
  // - visual override esetén color / opacity / metalness / roughness alkalmazása.
  //
  // A visual override mezők PER-COLOR-SCHEME tárolódnak (ld. visualPropsStore):
  // a `schemes.pbr` és `schemes.registry` map-ből az AKTÍV `colorMode`-hoz
  // tartozó scheme értékeit használjuk. Ha a scheme-ben nincs adott mező,
  // a default érvényesül (def.color / 1.0 opacity / mesh saját PBR-anyaga).
  //
  // PRIORITÁSOK:
  //   - color: scheme.color > (registry-mode ? def.color : eredeti mesh-szín)
  //   - opacity: scheme.opacity > 1.0 (fade overlay az emissive-vel együtt
  //     mindig 0.15-re csökkentheti, ha másik elem van highlightolva).
  //   - metalness / roughness: scheme.* > mesh-anyag default-ja.
  //
  // A `__origColorHex` userData csak a `'registry'` mód toggle-jét segíti,
  // a visual override külön ágon megy.
  const schemeProps = visualOverride?.schemes?.[colorMode]
  useEffect(() => {
    const grp = groupRef.current
    if (!grp) return
    const overrideColor = schemeProps?.color
    const overrideOpacity = schemeProps?.opacity
    const overrideMetalness = schemeProps?.metalness
    const overrideRoughness = schemeProps?.roughness
    grp.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      // Csak azokat módosítjuk, amik EHHEZ az alkatrészhez tartoznak.
      if (node.userData.componentId !== def.id) return
      const mat = node.material as THREE.Material | THREE.Material[] | null
      if (!mat) return
      const apply = (m: THREE.Material) => {
        if (!(m instanceof THREE.MeshStandardMaterial) &&
            !(m instanceof THREE.MeshPhysicalMaterial) &&
            !(m instanceof THREE.MeshLambertMaterial) &&
            !(m instanceof THREE.MeshPhongMaterial) &&
            !(m instanceof THREE.MeshBasicMaterial)) return

        // 1) szín
        // Effective szín: visual override > registry mode (def.color) > eredeti.
        if (overrideColor !== undefined) {
          // Az eredeti hex-et megőrizzük, hogy visszaállhassunk később.
          if (!m.userData.__origColorHex) {
            m.userData.__origColorHex = '#' + (m as THREE.MeshStandardMaterial).color.getHexString()
          }
          ;(m as THREE.MeshStandardMaterial).color.set(overrideColor)
        } else if (colorMode === 'registry') {
          if (!m.userData.__origColorHex) {
            m.userData.__origColorHex = '#' + (m as THREE.MeshStandardMaterial).color.getHexString()
          }
          ;(m as THREE.MeshStandardMaterial).color.set(def.color)
        } else {
          if (m.userData.__origColorHex) {
            (m as THREE.MeshStandardMaterial).color.set(m.userData.__origColorHex as string)
            delete m.userData.__origColorHex
          }
        }

        // 2) emissive (csak meshstandard / phong / physical)
        if ('emissive' in m) {
          if (isSelected) {
            (m as THREE.MeshStandardMaterial).emissive.set(def.color)
            ;(m as THREE.MeshStandardMaterial).emissiveIntensity = 0.5
          } else {
            (m as THREE.MeshStandardMaterial).emissive.set('#000')
            ;(m as THREE.MeshStandardMaterial).emissiveIntensity = 0
          }
        }

        // 3) opacitás — fade > override > default sorrend (a fade mindig
        // felülír mert a UX szempontjából elsődleges, hogy a kijelölés
        // kontrasztja meglegyen).
        if (isFaded) {
          m.transparent = true
          m.opacity = 0.15
          m.depthWrite = false
        } else if (overrideOpacity !== undefined && overrideOpacity < 1) {
          m.transparent = true
          m.opacity = overrideOpacity
          m.depthWrite = overrideOpacity > 0.5
        } else {
          m.opacity = overrideOpacity ?? 1
          m.depthWrite = true
          m.transparent = false
        }

        // 4) metalness / roughness — csak MeshStandardMaterial-en (és a
        // származékain, pl. MeshPhysicalMaterial).
        if (m instanceof THREE.MeshStandardMaterial) {
          if (overrideMetalness !== undefined) m.metalness = overrideMetalness
          if (overrideRoughness !== undefined) m.roughness = overrideRoughness
        }

        m.needsUpdate = true
      }
      if (Array.isArray(mat)) mat.forEach(apply)
      else apply(mat)
    })
  }, [
    colorMode,
    isSelected,
    isFaded,
    def.color,
    def.id,
    lodLevel,
    Builder,
    visualOverride,
    schemeProps,
  ])

  // Mount után tag-eljük a userData-t azokon a node-okon, amik kimaradtak.
  useEffect(() => {
    if (groupRef.current) tagComponentId(groupRef.current, def.id)
  }, [def.id, Builder])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Drag-end utáni "fantomklikk" elnyelés: ha az imént engedte el a user
    // a TransformControls gizmóját, a következő R3F `click` esemény átfut
    // a gizmo alatt lévő mesh-en — ezt itt eltüntetjük.
    if (shouldSuppressClickNow()) return
    // A kattintott mesh.userData.componentId pontosabb (lehet child),
    // de itt biztosan a saját id-nk az is, ha a builder helyesen tag-elt.
    const cid = (e.object.userData?.componentId as string | undefined) ?? def.id
    const ne = e.nativeEvent as MouseEvent
    const isMultiMod = ne.shiftKey || ne.ctrlKey || ne.metaKey
    // Re-click a már kijelölt elemre EDIT MODE-ban → gizmo-mode toggle
    // (translate ↔ rotate). A korábbi külön "Move/Rotate" toolbar pill-t
    // ezzel váltottuk ki — a felhasználó a 3D nézetből közvetlenül vált.
    // Multi-modifier kombinációkat NEM kezeljük itt (Shift/Ctrl re-click
    // jelenleg "no-op" volt → marad: toggleInSelection valami).
    const transformStore = useTransformOverrideStore.getState()
    if (transformStore.editMode && !isMultiMod) {
      const currentSelected = useHighlightStore.getState().selectedId
      if (currentSelected === cid) {
        transformStore.toggleGizmoMode()
        return
      }
    }
    // Shift / Ctrl / Cmd → multi-select toggle. Egyébként single select.
    if (isMultiMod) {
      useHighlightStore.getState().toggleInSelection(cid)
    } else {
      useHighlightStore.getState().setSelectedId(cid)
    }
  }, [def.id])

  const getOverride = useCallback(
    (id: string): TransformOverride | undefined => (id === def.id ? override : undefined),
    [def.id, override],
  )
  const t = useMemo(
    () => resolveTransform(def, getRegistryNode, getOverride),
    [def, getOverride],
  )
  // Effective scale = transform-scale × visual-override-scale komponensenként.
  // A transform-scale a registry / mount-resolver-ből jön; a visual-scale a
  // felhasználó szándéka. A szorzat ad helyes eredményt mindkét forrás
  // aktivitásakor.
  const effectiveScale = useMemo<[number, number, number]>(() => {
    const ts = t.scale
    const vs = visualOverride?.scale
    if (!vs) return ts
    return [ts[0] * vs[0], ts[1] * vs[1], ts[2] * vs[2]]
  }, [t.scale, visualOverride?.scale])
  const children = getChildren(def.id)

  return (
    <>
      <group
        ref={groupRef}
        position={t.position}
        rotation={t.rotation}
        scale={effectiveScale}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          useHighlightStore.getState().setHoveredId(def.id)
        }}
        onPointerOut={() => {
          useHighlightStore.getState().setHoveredId(null)
        }}
      >
        {!isHidden && (
          Builder ? (
            <Builder componentId={def.id} />
          ) : (
            <FallbackBox
              componentId={def.id}
              size={def.bbox?.size ?? [40, 40, 40]}
              color={def.color}
            />
          )
        )}

        {children.map((child) => (
          <RegistryNodeView
            key={child.id}
            node={child}
            highlightedId={highlightedId}
            selectedIdsSet={selectedIdsSet}
            highlightDescendants={highlightDescendants}
            fadeOthers={fadeOthers}
            colorMode={colorMode}
            lodLevel={lodLevel}
            hiddenIds={hiddenIds}
          />
        ))}
      </group>
      {editMode && isSelectedTarget && groupObj && (
        <NodeGizmo nodeId={def.id} target={groupObj} />
      )}
    </>
  )
}

interface Props {
  /**
   * Csak a háttér-deselect-hez használjuk: ha üres területre kattint, töröljük
   * a kijelölést (ezt a wrapper Canvas-on lehet kezelni).
   */
  onBackgroundClick?: () => void
}

/**
 * A modell gyökere — a regiszter gyökér-szintű alkatrészeit rendereli rekurzívan.
 */
const TubeBenderModelV2 = memo(function TubeBenderModelV2(_props: Props) {
  const lodLevel = useHighlightStore((s) => s.lodLevel)
  const colorMode = useHighlightStore((s) => s.colorMode)
  const selectedId = useHighlightStore((s) => s.selectedId)
  const selectedIds = useHighlightStore((s) => s.selectedIds)
  const fadeOthers = useHighlightStore((s) => s.fadeOthers)
  const hiddenIdsArr = useHighlightStore((s) => s.hiddenIds)
  const hiddenIds = useMemo(() => new Set(hiddenIdsArr), [hiddenIdsArr])
  const selectedIdsSet = useMemo<ReadonlySet<string>>(
    () => new Set(selectedIds),
    [selectedIds],
  )

  // Ha selectedId egy assembly id, számoljuk ki a leszármazott komponens-id-ket;
  // így az assembly-szintű highlight minden almesh-t kiemel/fade-el. Multi-select
  // esetén MINDEN selected assembly leszármazottait összegyűjtjük.
  const highlightDescendants = useMemo<ReadonlySet<string>>(() => {
    if (selectedIds.length === 0) return new Set()
    const out = new Set<string>()
    for (const id of selectedIds) {
      const node = getRegistryNode(id)
      if (!node || !isAssembly(node)) continue
      for (const c of getDescendantComponents(id)) out.add(c.id)
    }
    return out
  }, [selectedIds])

  const roots = useMemo(
    () => TUBE_BENDER_REGISTRY.filter((c) => c.parentId === null),
    [],
  )

  // Élő scene root regisztrációja — az `exportStl` ezen keresztül éri el
  // a renderelt geometriát (Canvas-on KÍVÜLi sima függvényhívásból).
  //
  // **Miért callback ref és nem useEffect?** Az R3F `<group ref={...}>` attach-je
  // (a Three.js Object3D parent-be illesztése) NEM mindig esik egybe a React
  // commit-ciklusával — különösen `<Suspense>`/`memo` keretek alatt a `useEffect`
  // futásakor a `ref.current` esetenként még `null` (a render-fa már létrejött,
  // de az R3F reconciler az alávett primitive-et csak a következő tick-ben
  // csatolja). A callback ref ezzel szemben **azonnal és szinkron** lefut, amint
  // az R3F a primitive-et létrehozza vagy megsemmisíti — így garantáltan eljut
  // a `setLiveModelRoot` a tényleges Group instance-szal.
  const handleRootRef = useCallback((g: THREE.Group | null) => {
    setLiveModelRoot(g)
  }, [])

  return (
    <group ref={handleRootRef}>
      {roots.map((root) => (
        <RegistryNodeView
          key={root.id}
          node={root}
          highlightedId={selectedId}
          selectedIdsSet={selectedIdsSet}
          highlightDescendants={highlightDescendants}
          fadeOthers={fadeOthers}
          colorMode={colorMode}
          lodLevel={lodLevel}
          hiddenIds={hiddenIds}
        />
      ))}
    </group>
  )
})

export default TubeBenderModelV2
