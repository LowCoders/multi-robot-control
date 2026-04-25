/**
 * Anchor-mate alapú transzformáció-feloldó.
 *
 * A `MountSpec` (lásd `types.ts`) szemantikája:
 *   - A child egyik anchorja (`childAnchor`, default 'origin') EGYBEESIK a parent
 *     egy anchorjával (`parentAnchor`).
 *   - A child anchor `axis`-a egybe van forgatva a parent anchor `axis`-ával
 *     (rövidebb-ívű kvaternion).
 *   - Opcionálisan további `axisRotation` rad-nyi forgatás az illesztett tengely
 *     körül (pl. csavar-mintázat orientáció finomhangolása).
 *   - Opcionális `offset` eltolás a parent lokális keretében az illesztés UTÁN.
 *
 * Az output a `{position, rotation, scale}` triplet a child saját szülő-lokális
 * keretében, amit a `<group>` propként közvetlenül megehet.
 */
import * as THREE from 'three'
import type { Anchor, MountSpec, RegistryNode } from './types'

const DEFAULT_AXIS: [number, number, number] = [0, 0, 1]
const ORIGIN_ANCHOR: Anchor = { position: [0, 0, 0], axis: DEFAULT_AXIS }

function getAnchor(node: RegistryNode, name: string): Anchor | undefined {
  if (name === 'origin') return node.anchors?.[name] ?? ORIGIN_ANCHOR
  return node.anchors?.[name]
}

/**
 * Feloldja a `node.mount`-ot anchor-illesztéssel, és visszaadja a child saját
 * szülő-lokális transzformációját. Ha a `mount` érvénytelen (pl. ismeretlen
 * anchor), `null`-t ad — ekkor a hívó visszaeshet a `node.transform`-ra.
 */
export function resolveMountedTransform(
  node: RegistryNode,
  parent: RegistryNode,
  mount: MountSpec,
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  const parentAnchor = getAnchor(parent, mount.parentAnchor)
  if (!parentAnchor) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[transformResolver] parent anchor not found: parent=${parent.id}, anchor=${mount.parentAnchor}`,
      )
    }
    return null
  }
  const childAnchor = getAnchor(node, mount.childAnchor ?? 'origin')
  if (!childAnchor) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[transformResolver] child anchor not found: child=${node.id}, anchor=${mount.childAnchor ?? 'origin'}`,
      )
    }
    return null
  }

  const ac = new THREE.Vector3().fromArray(childAnchor.axis ?? DEFAULT_AXIS).normalize()
  const ap = new THREE.Vector3().fromArray(parentAnchor.axis ?? DEFAULT_AXIS).normalize()

  // Rövidebb-ívű kvaternion ami az `ac` tengelyt az `ap` tengelyre forgatja.
  // Ha a kettő antipodális (dot ≈ -1), egy tetszőleges merőleges tengely körüli π forgás.
  const q = new THREE.Quaternion().setFromUnitVectors(ac, ap)

  // Plusz forgatás az illesztett tengely (= ap) körül.
  if (mount.axisRotation && mount.axisRotation !== 0) {
    const qAxis = new THREE.Quaternion().setFromAxisAngle(ap, mount.axisRotation)
    q.premultiply(qAxis)
  }

  // A child origin a parent-ben:
  //   A child egy P_child pontja a forgatás+eltolás után: t + R*P_child
  //   Akarjuk: t + R*childAnchor.position = parentAnchor.position
  //   => t = parentAnchor.position - R*childAnchor.position
  const cPosRotated = new THREE.Vector3().fromArray(childAnchor.position).applyQuaternion(q)
  const t = new THREE.Vector3().fromArray(parentAnchor.position).sub(cPosRotated)

  // Opcionális offset a PARENT LOKÁLIS keretben (tehát az anchor-axis-okkal NINCS
  // egybeforgatva — egyszerű additív eltolás).
  if (mount.offset) {
    t.add(new THREE.Vector3().fromArray(mount.offset))
  }

  const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return {
    position: [t.x, t.y, t.z],
    rotation: [euler.x, euler.y, euler.z],
  }
}

/**
 * Felhasználó-szintű override: a renderer/exporter által beolvasható
 * felülírás egy adott node parent-lokális poz/forg-jára. A scale-t nem
 * érinti — az override csak a `position` és `rotation` (XYZ Euler, rad)
 * értékeket cseréli le, a feloldott (mount vagy transform) eredmény
 * helyett. Ha jelen van, a `mount`-feloldás kimarad ezen a node-on.
 */
export interface TransformOverride {
  position?: [number, number, number]
  rotation?: [number, number, number]
}

/**
 * Visszaadja egy node által használt VÉGLEGES szülő-lokális transzformációt.
 * Ha van `mount`, az anchor-mate-ből számol; egyébként a `transform` mezőt használja.
 *
 * `parentLookup`: a parent-resolver (általában `getRegistryNode` a registry-ből).
 * Ha a parent nem található, vagy nincs `mount`, a `transform` esik vissza.
 *
 * `getOverride` (opcionális): ha visszaad értéket az adott node-id-re, akkor
 * az override `position` + `rotation` mindent felülír (mount és transform is).
 * A scale a `transform.scale`-ból (vagy default [1,1,1]) jön.
 */
export function resolveTransform(
  node: RegistryNode,
  parentLookup: (id: string) => RegistryNode | undefined,
  getOverride?: (id: string) => TransformOverride | undefined,
): {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
} {
  const fallback = {
    position: node.transform.position,
    rotation: node.transform.rotation ?? ([0, 0, 0] as [number, number, number]),
    scale: node.transform.scale ?? ([1, 1, 1] as [number, number, number]),
  }

  // 1) Ha van override, az nyer mindent.
  if (getOverride) {
    const ov = getOverride(node.id)
    if (ov) {
      return {
        position: ov.position ?? fallback.position,
        rotation: ov.rotation ?? fallback.rotation,
        scale: fallback.scale,
      }
    }
  }

  if (!node.mount) return fallback

  // Hová mount-olunk: explicit `mount.parentId`, vagy a regiszter-szülő.
  const targetId = node.mount.parentId ?? node.parentId
  if (!targetId) return fallback
  const parent = parentLookup(targetId)
  if (!parent) return fallback

  const resolved = resolveMountedTransform(node, parent, node.mount)
  if (!resolved) return fallback

  return {
    position: resolved.position,
    rotation: resolved.rotation,
    scale: fallback.scale,
  }
}
