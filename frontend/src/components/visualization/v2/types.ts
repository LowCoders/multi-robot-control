/**
 * V2 csőhajlító modell — közös típusok.
 *
 * # Koordinátarendszer (CAD Z-up, mm)
 *
 *   - **+X** = csőelőtolás iránya (operátor jobbja felé)
 *   - **+Y** = operátor felé (mélység)
 *   - **+Z** = függőlegesen FEL
 *
 * Kinematika:
 *   - **Központi forgó tengely (csőhajlító fej) → +Y körül forog**
 *     (a Tengely-csoport: EK20, slip-ring, SHF20, Ø8 tengelyek bore-jai +Y).
 *   - X-hajtás: NEMA 23 motor +X tengellyel; bevel pár 45°-ban átveszi → +Y forgás.
 *   - Z-hajtás (hajlítókerék): vertikális +Z forgás.
 *
 * # Csoportstruktúra (7 top-level assembly)
 *
 *   1. Alap                  — base lemez (önálló komponens)
 *   2. Konzol                — X-bracket sandwich (bracket-1, -2, mounting rods)
 *   3. Tengely               — központi +Y-forgó: SHF20, EK20, slip-ring, Ø8 tengelyek
 *   4. X hajtás              — NEMA 23 X + bevel pár + pinionok + gear-bracket
 *   5. Feszítő               — U-groove görgő
 *   6. Y hajtás              — HTD pulley pár (70T + 15T)
 *   7. Z hajtás              — bolygóhajtómű + NEMA 23 Z motor
 *
 * # Builder-konvenció (case-by-case)
 *
 *   - Hengeres alkatrész (motor, gear, bearing, pulley, gearbox): **builder +Z = főtengely**.
 *     A világtengelyt a `mount.parentAnchor.axis` adja → a registry-ben rotation = identity.
 *   - Lemezes / álló bracket (vertical-bracket, gear-bracket): **builder +Z = vertikális (magasság)**,
 *     vastagság = +Y mentén extrudálva. Width = +X.
 *   - Vízszintes lemez (base): **builder +Z = vastagság (vertikális)**, length = +X, depth = +Y.
 *
 * # Anchor / mount rendszer
 *
 * Minden ComponentDef / AssemblyDef nevezett anchor-pontokat (`Anchor`) exportál a builder
 * lokális keretében. A `MountSpec.parentAnchor` ↔ `MountSpec.childAnchor` egybeesés alapján
 * a `transformResolver` kiszámolja a végleges pozíciót + rotációt (anchor axis-ok illesztve).
 * Ha nincs `mount`, a `transform.position`/`rotation` esik vissza.
 */
import type { ComponentType } from 'react'

export type LodLevel = 'schematic' | 'medium' | 'realistic'

export interface PartBuilderProps {
  /** A regiszterben szereplő egyedi alkatrész-id; a renderer ezt rekurzívan minden mesh.userData-ba beteszi. */
  componentId: string
}

export type PartBuilder = ComponentType<PartBuilderProps>

/**
 * Nevezett "anchor" / datum egy komponens vagy assembly builder-lokális keretében.
 * Egy 3D pozíció + opcionális tengelyirány. A `MountSpec.parentAnchor` és
 * `MountSpec.childAnchor` ezeket egymásba illeszti.
 *
 * Bevett / standard anchor-nevek (a JSDoc-ban dokumentálva, nem kötelező használni):
 *   - `origin` — minden komponens default anchor-ja: position [0,0,0], axis [0,0,1].
 *   - `axisX-pos`, `axisX-neg`, `axisY-pos`, `axisY-neg`, `axisZ-pos`, `axisZ-neg`
 *   - Motoroknál: `shaft-tip`, `mount-flange-center`, `back-face-center`
 *   - Csapágyaknál: `bore-axis-near`, `bore-axis-far`, `mount-bottom-center`
 *   - Lemezeknél: `front-face-center`, `back-face-center`, `bolt-1`..`bolt-4`
 *   - Gearbox-nál: `input-flange-center`, `output-shaft-tip`, `mount-front`, `mount-rear`
 */
export interface Anchor {
  /** A pont a komponens/assembly lokális keretében (mm). */
  position: [number, number, number]
  /** Opcionális iránymutató tengely (egységvektor). Default: [0, 0, 1]. */
  axis?: [number, number, number]
  /** Emberi olvasható leírás (mit jelöl ez a pont). */
  description?: string
}

/**
 * Egy `ComponentDef` vagy `AssemblyDef` szülőhöz illesztésének leírása anchor-egybeesés
 * alapján. Ha jelen van, **felülírja** a `transform.position`-t (és opcionálisan
 * a `rotation`-t), és a renderer az anchor-mate-ből számolja ki a végleges transzformációt.
 *
 * Egyszerűsítés: a child anchor `axis`-a egybe lesz forgatva a parent anchor `axis`-ával,
 * majd a `axisRotation` rad-nyit forgatunk az illesztett tengely körül; végül opcionális
 * `offset` (parent-anchor lokális keretében) eltolja a child-ot.
 */
export interface MountSpec {
  /** A szülő id-je, akihez illesztünk. Default: a `parentId` mező. */
  parentId?: string
  /** A szülő anchor-jának neve. */
  parentAnchor: string
  /** A child anchor-jának neve. Default: 'origin'. */
  childAnchor?: string
  /** Forgatás az illesztett tengely körül (rad). Default: 0. */
  axisRotation?: number
  /** Eltolás a parent anchor lokális keretében az illesztés UTÁN (mm). Default: [0,0,0]. */
  offset?: [number, number, number]
}

export interface ComponentDef {
  /** Discriminator: csak a `'component'` érték (default), a `AssemblyDef` ezt felülírja. */
  kind?: 'component'
  /** Egyedi slug, pl. 'base', 'tube-spindle'. */
  id: string
  /** Sorszám (1..N) — a táblázatban és kommunikációban erre lehet hivatkozni. */
  num: number
  /** Magyar megnevezés (a kommunikációban erre lehet hivatkozni). */
  nameHu: string
  /** Angol megnevezés. */
  nameEn: string
  /** Egyedi szín (hex), a táblázatban és a 'registry' színmódban ez jelenik meg. */
  color: string
  /** Szülő alkatrész vagy assembly id-je vagy null (gyökér). */
  parentId: string | null
  /** Lokális transzformáció a szülőhöz képest. Ha `mount` is meg van adva, az felülírja. */
  transform: {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
  /**
   * Anchor-alapú illesztés a szülőhöz. Ha jelen van, a `transform.position` és
   * `transform.rotation` figyelmen kívül marad, helyette az anchor-mate-ből
   * számolja a renderer / exporter a végleges transzformációt.
   */
  mount?: MountSpec
  /** Nevezett anchor-pontok a komponens builder-lokális keretében. */
  anchors?: Record<string, Anchor>
  /**
   * Sematikus fallback bounding box mérete (mm). Akkor használjuk,
   * ha az adott LOD-on nincs builder, vagy ha az STL-bbox export kell.
   */
  bbox?: { size: [number, number, number] }
  /** A 3 LOD-szint builder-ei. Ami hiányzik, arra a renderer fallback-et rajzol. */
  builders: Partial<Record<LodLevel, PartBuilder>>
  /** English description (primary in source). */
  descriptionEn?: string
  /** Hungarian description. */
  descriptionHu?: string
}

/**
 * Sub-assembly definíció: üres group a hierarchiában, amelynek nincs saját geometriája,
 * de gyermekei (komponensek vagy további assembly-k) anchor-mate-tel illeszkednek hozzá.
 * Önmaga is illeszkedhet egy szülő anchor-jához (`mount` mező).
 *
 * Pl. `z-motor-assembly` = `Nema23MotorZ` (mount-olva a gearbox input-flange-éhez) +
 * `PlanetaryGearbox60` (origin). Az assembly anchorjai („output-shaft-tip", „mount-bottom”)
 * a fő szerelvénybe illesztéskor használhatók.
 */
export interface AssemblyDef {
  /** Discriminator: 'assembly'. */
  kind: 'assembly'
  /** Egyedi slug, pl. 'z-motor-assembly'. */
  id: string
  /** Sorszám a táblázatban (opcionális). */
  num?: number
  /** Magyar megnevezés. */
  nameHu: string
  /** Angol megnevezés. */
  nameEn?: string
  /** Szülő id (assembly vagy komponens) vagy null (gyökér). */
  parentId: string | null
  /** Lokális transzformáció a szülőhöz képest. Ha `mount` is meg van adva, az felülírja. */
  transform: {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
  /** Anchor-alapú illesztés a szülőhöz. */
  mount?: MountSpec
  /** Nevezett anchor-pontok az assembly lokális keretében. */
  anchors?: Record<string, Anchor>
  /** Emberi olvasható leírás. */
  descriptionEn?: string
  descriptionHu?: string
}

/**
 * A registry típusa: komponensek ÉS assembly-k tetszőleges keveréke.
 * A renderer a `kind` discriminator alapján dönti el, hogy a node-ot
 * `ComponentNode`-ként (geometriával) vagy `AssemblyNode`-ként (üres group) renderelje.
 */
export type RegistryNode = ComponentDef | AssemblyDef

/** Type-guard: igaz, ha a node assembly. */
export function isAssembly(node: RegistryNode): node is AssemblyDef {
  return node.kind === 'assembly'
}

/** Type-guard: igaz, ha a node komponens (default `kind`). */
export function isComponent(node: RegistryNode): node is ComponentDef {
  return node.kind !== 'assembly'
}
