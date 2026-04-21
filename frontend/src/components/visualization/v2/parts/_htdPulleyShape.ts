/**
 * Közös HTD 5M (5 mm pitch, ívelt fogprofilú) bordaszíj-tárcsa fog-shape
 * builder a `HtdPulley70T_25b.tsx` és a `HtdPulley15T_8b.tsx` számára.
 *
 * HTD 5M PROFIL ALAPOK:
 *   - Pitch = 5 mm (a fogak osztótávolsága az osztóköríven)
 *   - Pitch diameter d = (P · Z) / π   ahol P = 5 mm, Z = fogszám
 *   - Pulley OD ≈ d − 2·PLD,  ahol PLD ≈ 0.381 mm a HTD 5M-en (pitch line
 *     differential — a belt középvonala 0.381 mm-rel a pulley OD fölött van)
 *   - Pulley fog mélység ≈ 2.06 mm (a HTD 5M ténylegesen a belt fogával
 *     azonos mélységű)
 *   - Pulley fogprofil: ÍVELT, közelítően egy R ≈ 1.5 mm sugarú íves árok
 *     a pulley OD-ban, közbül lapos LAND-szakaszokkal
 *
 * EGYSZERŰSÍTETT VIZUÁLIS PROFIL (a hivatalos HTD evolvens nélkül):
 *   - A pulley OD-n körkörösen Z db egyenletesen elosztott "árok" van
 *   - Minden árok = egy konkáv fél-ív, ami az OD-tól a root-radius-ig benyúlik
 *   - Az árkok között "land" arc fut az OD-n (a belt fog ide kerül)
 *   - Egy fog teljes szögtartománya: 2π/Z
 *     - groove szögtartomány:  ≈ (3.05 mm) / OD_R     (a HTD 5M belt-fog szélesség az OD-n)
 *     - land szögtartomány:    2π/Z − groove szögtartomány
 *
 * Ez az approximáció vizuálisan jól néz ki és Z = 15..120 között működik
 * (15-nél a land már elég keskeny, de még megkülönböztethető a groove-tól).
 */
import * as THREE from 'three'

/** HTD 5M konstansok. */
export const HTD5M_PITCH = 5
export const HTD5M_PLD = 0.381
export const HTD5M_TOOTH_DEPTH = 2.06
/**
 * Belt fog "tövének" mérete az OD-n — a groove physical width-je.
 * (A HTD 5M belt fog kb. 3.05 mm széles a fogtövénél, és ez illeszkedik be
 *  a pulley groove-jába.)
 */
export const HTD5M_GROOVE_WIDTH_AT_OD = 3.05

/**
 * HTD 5M pulley méretek számítása fogszámból.
 * @param toothCount fogszám (Z)
 */
export function htd5mDimensions(toothCount: number) {
  const pitchDiam = (HTD5M_PITCH * toothCount) / Math.PI
  const od = pitchDiam - 2 * HTD5M_PLD
  const rootDiam = od - 2 * HTD5M_TOOTH_DEPTH
  return {
    toothCount,
    pitchDiam,
    od,
    rootDiam,
    odR: od / 2,
    rootR: rootDiam / 2,
    pitchR: pitchDiam / 2,
  }
}

/**
 * 2D HTD pulley shape builder. A shape Z = 0 síkban van, középpontja az
 * origóban, középen Ø boreDiam furattal. Z fogszámot rajzol körkörösen
 * elosztva.
 *
 * A shape körvonalát a fogak körberajzolásával adjuk meg:
 *   Minden fog (i = 0..Z-1) egy land-arc + egy groove-arc szakaszból áll.
 *   Land:    az OD-n CCW arc a (i·step + halfGroove) → ((i+1)·step − halfGroove) szögtartományban
 *   Groove:  az OD-tól lefelé hajló konkáv fél-ív, amely a root körön át halad,
 *            majd vissza az OD-ra a következő land elejére.
 *
 * Az egyszerűsítés: a groove-ot 2 db radiális egyenes + 1 root-arc kombinációval
 * helyettesítjük (trapéz-szerű árok a kerületen):
 *   - radiális le: (OD_R, ang_L)  → (ROOT_R, ang_L_root)
 *   - root arc:    (ROOT_R, ang_L_root) → (ROOT_R, ang_R_root)
 *   - radiális fel: (ROOT_R, ang_R_root) → (OD_R, ang_R)
 * ahol ang_L/ang_R a groove két oldalának szöge, ang_L_root/ang_R_root pedig
 * a root körön kissé szűkebb (mert a groove TÖVE szűkebb mint a teteje, hogy
 * a belt fog be tudjon ülni). Ez a trapéz-approximáció vizuálisan jól néz ki
 * és Z = 15..120 között megfelelő részleteket ad.
 *
 * @param toothCount fogszám
 * @param boreDiam furat átmérője (mm) — a shape közepén lyukként
 */
export function buildHtdPulleyShape(
  toothCount: number,
  boreDiam: number,
): THREE.Shape {
  const { odR, rootR } = htd5mDimensions(toothCount)
  const step = (Math.PI * 2) / toothCount

  // Groove fél-szögtartomány az OD-n: a groove fizikai szélességét osztjuk
  // a OD_R-rel, az ívhossz → szög konverzióhoz.
  const grooveHalfAngleAtOD = HTD5M_GROOVE_WIDTH_AT_OD / 2 / odR
  // A groove TÖVÉN (root körön) kissé szűkebb — a belt fog tövénél keskenyebb,
  // mint a tetején. ~70%-kal csökkentjük az ívhosszat.
  const grooveHalfAngleAtRoot =
    Math.min(
      (HTD5M_GROOVE_WIDTH_AT_OD * 0.7) / 2 / rootR,
      step / 2 - 0.005,
    )

  const shape = new THREE.Shape()

  // Indulás: az első land bal-széle (i = 0).
  const startAng = 0 + grooveHalfAngleAtOD
  shape.moveTo(odR * Math.cos(startAng), odR * Math.sin(startAng))

  for (let i = 0; i < toothCount; i++) {
    const center = i * step
    // Land arc a (center + halfGroove) → ((i+1)·step − halfGroove) tartományban.
    const landStart = center + grooveHalfAngleAtOD
    const landEnd = (i + 1) * step - grooveHalfAngleAtOD
    shape.absarc(0, 0, odR, landStart, landEnd, false)

    // Groove (trapéz-árok) a következő fog felé:
    //   - radiális le a root körre
    //   - root arc a groove tövén (kissé szűkebb)
    //   - radiális fel az OD-ra a következő land elejére
    const grooveOdLeftNextAng = (i + 1) * step + grooveHalfAngleAtOD
    const grooveRootRightAng = (i + 1) * step - grooveHalfAngleAtRoot
    const grooveRootLeftNextAng = (i + 1) * step + grooveHalfAngleAtRoot

    // Lemegy a root körre a jobb oldalon
    shape.lineTo(
      rootR * Math.cos(grooveRootRightAng),
      rootR * Math.sin(grooveRootRightAng),
    )
    // Root arc CCW a groove tövén
    shape.absarc(0, 0, rootR, grooveRootRightAng, grooveRootLeftNextAng, false)
    // Felmegy az OD-ra a következő land bal-szélén
    shape.lineTo(
      odR * Math.cos(grooveOdLeftNextAng),
      odR * Math.sin(grooveOdLeftNextAng),
    )
  }

  shape.closePath()

  // Furat (bore) mint hole.
  if (boreDiam > 0) {
    const bore = new THREE.Path()
    bore.absarc(0, 0, boreDiam / 2, 0, Math.PI * 2, true)
    shape.holes.push(bore)
  }

  return shape
}

/**
 * Sima körlap shape (flange) — bore furattal. A flange OD a pulley OD-nál
 * kissé nagyobb (a belt megtámasztásához).
 */
export function buildPulleyFlangeShape(
  flangeOuterDiam: number,
  boreDiam: number,
): THREE.Shape {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, flangeOuterDiam / 2, 0, Math.PI * 2, false)
  if (boreDiam > 0) {
    const bore = new THREE.Path()
    bore.absarc(0, 0, boreDiam / 2, 0, Math.PI * 2, true)
    shape.holes.push(bore)
  }
  return shape
}
