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
import { memo, useEffect, useMemo, useRef, useCallback } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  TUBE_BENDER_REGISTRY,
  getChildren,
} from './componentRegistry'
import { useHighlightStore } from './highlightStore'
import type { ComponentDef } from './types'

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

interface ComponentNodeProps {
  def: ComponentDef
  highlightedId: string | null
  fadeOthers: boolean
  colorMode: 'pbr' | 'registry'
  lodLevel: 'schematic' | 'medium' | 'realistic'
  hiddenIds: ReadonlySet<string>
}

/**
 * Egy komponens renderelése + a gyermekei rekurzív renderelése.
 * A transzformációt egy group adja, alá kerül a builder + a children.
 */
function ComponentNode({
  def,
  highlightedId,
  fadeOthers,
  colorMode,
  lodLevel,
  hiddenIds,
}: ComponentNodeProps) {
  const isHidden = hiddenIds.has(def.id)
  const groupRef = useRef<THREE.Group>(null)
  const setSelectedId = useHighlightStore((s) => s.setSelectedId)

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

  const isSelected = highlightedId === def.id
  const isFaded = highlightedId !== null && fadeOthers && !isSelected

  // A teljes group materiáljainak felülírása a tárolt állapot szerint:
  // - 'registry' színmódban a komponens színére,
  // - kijelölt alkatrésznél emissive,
  // - fade módban opacitás csökkentése.
  useEffect(() => {
    const grp = groupRef.current
    if (!grp) return
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
        if (colorMode === 'registry') {
          if (!m.userData.__origColorHex) {
            m.userData.__origColorHex = '#' + (m as THREE.MeshStandardMaterial).color.getHexString()
          }
          ;(m as THREE.MeshStandardMaterial).color.set(def.color)
        } else {
          if (m.userData.__origColorHex) {
            ;(m as THREE.MeshStandardMaterial).color.set(m.userData.__origColorHex as string)
            delete m.userData.__origColorHex
          }
        }

        // 2) emissive (csak meshstandard / phong / physical)
        if ('emissive' in m) {
          if (isSelected) {
            ;(m as THREE.MeshStandardMaterial).emissive.set(def.color)
            ;(m as THREE.MeshStandardMaterial).emissiveIntensity = 0.5
          } else {
            ;(m as THREE.MeshStandardMaterial).emissive.set('#000')
            ;(m as THREE.MeshStandardMaterial).emissiveIntensity = 0
          }
        }

        // 3) opacitás
        if (isFaded) {
          m.transparent = true
          m.opacity = 0.15
          m.depthWrite = false
        } else {
          m.opacity = 1
          m.depthWrite = true
          m.transparent = false
        }
        m.needsUpdate = true
      }
      if (Array.isArray(mat)) mat.forEach(apply)
      else apply(mat)
    })
  }, [colorMode, isSelected, isFaded, def.color, def.id, lodLevel, Builder])

  // Mount után tag-eljük a userData-t azokon a node-okon, amik kimaradtak.
  useEffect(() => {
    if (groupRef.current) tagComponentId(groupRef.current, def.id)
  }, [def.id, Builder])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // A kattintott mesh.userData.componentId pontosabb (lehet child),
    // de itt biztosan a saját id-nk az is, ha a builder helyesen tag-elt.
    const cid = (e.object.userData?.componentId as string | undefined) ?? def.id
    setSelectedId(cid)
  }, [def.id, setSelectedId])

  const t = def.transform
  const children = getChildren(def.id)

  return (
    <group
      ref={groupRef}
      position={t.position}
      rotation={t.rotation ?? [0, 0, 0]}
      scale={t.scale ?? [1, 1, 1]}
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
        <ComponentNode
          key={child.id}
          def={child}
          highlightedId={highlightedId}
          fadeOthers={fadeOthers}
          colorMode={colorMode}
          lodLevel={lodLevel}
          hiddenIds={hiddenIds}
        />
      ))}
    </group>
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
  const fadeOthers = useHighlightStore((s) => s.fadeOthers)
  const hiddenIdsArr = useHighlightStore((s) => s.hiddenIds)
  const hiddenIds = useMemo(() => new Set(hiddenIdsArr), [hiddenIdsArr])

  const roots = useMemo(
    () => TUBE_BENDER_REGISTRY.filter((c) => c.parentId === null),
    [],
  )

  return (
    <group>
      {roots.map((root) => (
        <ComponentNode
          key={root.id}
          def={root}
          highlightedId={selectedId}
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
