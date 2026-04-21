/**
 * V2 csőhajlító modell — közös típusok.
 *
 * Konvenciók:
 *   - Mértékegység: mm.
 *   - Koordináta-rendszer: +X = csőelőtolás iránya, +Y = függőlegesen fel, +Z = operátor felé.
 *   - A hajlító egység forgástengelye a +X (csőtengely körül).
 *   - A hajlítókerék (Z motor) tengelye a +Y körül forog.
 */
import type { ComponentType } from 'react'

export type LodLevel = 'schematic' | 'medium' | 'realistic'

export interface PartBuilderProps {
  /** A regiszterben szereplő egyedi alkatrész-id; a renderer ezt rekurzívan minden mesh.userData-ba beteszi. */
  componentId: string
}

export type PartBuilder = ComponentType<PartBuilderProps>

export interface ComponentDef {
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
  /** Szülő alkatrész id-je vagy null (gyökér). */
  parentId: string | null
  /** Logikai szerelvény (pl. 'z-motor-assembly'); a táblázat ez alapján csoportosít. */
  assemblyId?: string
  /** Lokális transzformáció a szülőhöz képest. */
  transform: {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
  /**
   * Sematikus fallback bounding box mérete (mm). Akkor használjuk,
   * ha az adott LOD-on nincs builder, vagy ha az STL-bbox export kell.
   */
  bbox?: { size: [number, number, number] }
  /** A 3 LOD-szint builder-ei. Ami hiányzik, arra a renderer fallback-et rajzol. */
  builders: Partial<Record<LodLevel, PartBuilder>>
  description?: string
}
