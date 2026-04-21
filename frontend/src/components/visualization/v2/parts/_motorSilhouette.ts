/**
 * NEMA 23 motor szembenézeti silhouette — közös segédmodul.
 *
 * Az STEPPERONLINE 23HS40-5004D-E1K-1M5 hivatalos műszaki rajza alapján
 * (lásd `public/components/tube-bender/vertical-bracket-1/refs/motor-datasheet.pdf`,
 * ill. https://www.stepperonline.co.uk/...23hs40-5004d-e1k-1m5.html dimensions
 * panel) a motor body keresztmetszete:
 *
 *   - **56.4 × 56.4 mm-es négyzet** (NEMA 23 standard frame size; a rajzon
 *     "□57.3 MAX" — a 56.4 nominal, +0.9 tűréssel), mind a 4 sarka R ≈ 5 mm-rel
 *     **lekerekítve** (= klasszikus lekerekített négyzet) a flange szakaszon, a
 *     hosszabb iron main + cover szakaszon pedig **konkáv sarok-indent +
 *     konvex fillet** profillal (lásd `traceNema23IndentedSilhouette`).
 *   - **A 4 csavarhely (4-Ø5.1 THROUGH)** a 47.14 ± 0.25 mm-es négyzet pattern
 *     csúcsain ül, a body BELSEJÉBEN — vagyis a furatok teljes mértékben a body
 *     határvonalain belülre esnek (a sarokpozícióktól befelé eltolva). A furatok
 *     **átmenő furatok** (THROUGH), így a menetes szárak a teljes motor body-n át
 *     keresztülmennek — a rajzon ez kifejezetten meg van adva.
 *
 * Ezt a silhouette-et használjuk:
 *   - a motor body (`Nema23Motor`) extrúziós kontúrjaként + a 4 átmenő furattal együtt,
 *   - a függőleges konzol (`VerticalBracket1`) cutout-jaként (csak az outline,
 *     furatok nélkül — a body silhouette itt megy át a lemezen, a furatok területe
 *     amúgy is a cutout-on belül van).
 */
import * as THREE from 'three'

/** Body keresztmetszet oldalhossza, mm (NEMA 23 standard frame size). */
export const NEMA23_BODY_SIZE = 56.4

/** Body sarok-lekerekítés sugara, mm (rajzon vizuális becslés alapján). */
export const NEMA23_BODY_CORNER_R = 5

/** Csavar-pattern oldala, mm (rajz: 4-47.14 ± 0.25). */
export const NEMA23_BOLT_PATTERN = 47.14

/** Egy átmenő rögzítő furat átmérője, mm (rajz: 4-Ø5.1 THROUGH). */
export const NEMA23_BOLT_HOLE_DIAM = 5.1

/**
 * A "sarok-indent" silhouette ívsugara, mm. A 4 sarokban egy R = `NEMA23_INDENT_R`
 * mm-es **konkáv** ív hajlik BEFELÉ a body-ba — eltávolítva a sarok-anyagot a
 * 47.14 pattern szerinti csavarpozíciók köré. Ezt a silhouette-t használjuk a
 * motor iron body main szakaszához és a hátsó plast fedőhöz, hogy a 4 menetes
 * szár vizuálisan láthatóvá váljon az indent voidokban.
 *
 * Geometriai megkötés (fillet-tel + outward-offset-tel):
 *   `(indentR + filletR)² > (dx_eff - filletR)²`, ahol
 *   `dx_eff = (size - boltPattern) / 2 - indentOutwardOffset / √2 ≈ 3.92 mm`.
 *
 * R = 4 mm + filletR = 2 mm + indent-shift = 1 mm jól látható, a NEMA referencia
 * rajzokon megfigyelhető arányokkal egyező sarokmotívumot ad.
 */
export const NEMA23_INDENT_R = 4

/**
 * Konvex (kifelé domború) fillet-sugár, mm. A sarok-indent ívek és a body
 * egyenes élei találkozásánál egy R = `NEMA23_INDENT_FILLET_R` mm-es ÍV az
 * ELLENKEZŐ irányba (= a body felől nézve KIFELÉ DOMBORÚ) lekerekíti a két
 * görbület metsző éleit. Ez vizuálisan azt eredményezi, hogy az indent ív
 * NEM közvetlenül a body egyenes éléhez fut be, hanem két kis konvex
 * "kupola" hidalja át a befelé hajló ív és az egyenes él találkozását
 * — pont úgy, mint a referencia motorok perspektívikus felvételein látszik.
 */
export const NEMA23_INDENT_FILLET_R = 2

/**
 * Az indent-ív KÖZÉPPONTJÁNAK diagonális KIFELÉ-eltolása a csavar-pozícióhoz
 * képest, mm-ben mérve a body-sarok felé mutató (1, ±1)/√2 irányban. Vagyis
 * tengelyenként `NEMA23_INDENT_OUTWARD_OFFSET / √2 ≈ 0.707 mm` az eltolás.
 *
 * Eredménye: a 4 csavarpozíció (a 47.14 pattern csúcsai) ~1 mm-rel BENT van
 * az indent-void körön, így a Ø5.1 menetes-szár furatok középpontjai már a
 * void területén vannak. A bracket-fülön ez ~0.45 mm anyag-clearance-et hagy
 * a furat széle és az indent-határ között a body közepe felé — a NEMA standard
 * referencia rajzokon ez az arány hasonló (lásd a hátsó nézet referencia képet).
 */
export const NEMA23_INDENT_OUTWARD_OFFSET = 1

/**
 * A NEMA 23 body **lekerekített négyzet** kontúrjának hozzáfűzése egy létező
 * Path/Shape-hez (CCW bejárás). Sarokpontok R = `cornerR`-rel lekerekítve.
 *
 * @param target THREE.Path vagy THREE.Shape
 * @param cx silhouette közép X
 * @param cy silhouette közép Y
 * @param size body oldalhossz (default 57)
 * @param cornerR sarok-lekerekítés sugara (default 5)
 */
export function traceNema23BodyOutline(
  target: THREE.Path,
  cx: number,
  cy: number,
  size = NEMA23_BODY_SIZE,
  cornerR = NEMA23_BODY_CORNER_R,
): void {
  const half = size / 2
  const xL = cx - half
  const xR = cx + half
  const yB = cy - half
  const yT = cy + half
  const r = cornerR

  // CCW bejárás: alsó él bal-vége → alsó él → BR sarok-ív → jobb él → TR ív → ...
  // absarc(centerX, centerY, radius, startAngle, endAngle, clockwise)
  // Sarok-ívek középpontja a tényleges sarokpozíciótól R-rel BELJEBB van mindkét tengelyen.
  target.moveTo(xL + r, yB)
  target.lineTo(xR - r, yB)
  // BR sarok: ív középpont (xR-r, yB+r), -π/2 → 0
  target.absarc(xR - r, yB + r, r, -Math.PI / 2, 0, false)
  target.lineTo(xR, yT - r)
  // TR sarok: ív középpont (xR-r, yT-r), 0 → π/2
  target.absarc(xR - r, yT - r, r, 0, Math.PI / 2, false)
  target.lineTo(xL + r, yT)
  // TL sarok: ív középpont (xL+r, yT-r), π/2 → π
  target.absarc(xL + r, yT - r, r, Math.PI / 2, Math.PI, false)
  target.lineTo(xL, yB + r)
  // BL sarok: ív középpont (xL+r, yB+r), π → 3π/2
  target.absarc(xL + r, yB + r, r, Math.PI, (3 * Math.PI) / 2, false)
}

/**
 * Hozzáad 4 db kör alakú furatot egy Shape `holes` listájához a 47.14 mm pattern
 * négy sarkára. A furatokat CW bejárással adjuk meg (`absarc(..., true)`), hogy a
 * Three.js Triangulation szempontjából helyesen "lyukak" legyenek a body-ban.
 *
 * @param shape THREE.Shape — a holes listájához fűzünk
 * @param cx pattern közép X (= body közép X)
 * @param cy pattern közép Y
 * @param holeDiam furat-átmérő (default Ø5.1)
 * @param pattern bolt-pattern oldala (default 47.14)
 */
export function addNema23BoltHoles(
  shape: THREE.Shape,
  cx: number,
  cy: number,
  holeDiam = NEMA23_BOLT_HOLE_DIAM,
  pattern = NEMA23_BOLT_PATTERN,
): void {
  const halfBP = pattern / 2
  const r = holeDiam / 2
  const positions: Array<[number, number]> = [
    [cx - halfBP, cy - halfBP],
    [cx + halfBP, cy - halfBP],
    [cx + halfBP, cy + halfBP],
    [cx - halfBP, cy + halfBP],
  ]
  for (const [px, py] of positions) {
    const hole = new THREE.Path()
    // CW bejárás (a Shape.holes-ban CW kell hogy legyen, ezért `clockwise=true`).
    hole.absarc(px, py, r, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
}

/**
 * A motor body **teljes** Shape-je: lekerekített négyzet outline + 4 db Ø5.1
 * átmenő furat a 47.14 pattern szerint. Ez a Shape közvetlenül `ExtrudeGeometry`-be
 * adva ad egy testet, amelyben a 4 furat végigmegy a teljes vastagságon.
 */
export function buildNema23Shape(cx = 0, cy = 0): THREE.Shape {
  const shape = new THREE.Shape()
  traceNema23BodyOutline(shape, cx, cy)
  addNema23BoltHoles(shape, cx, cy)
  return shape
}

/**
 * **Csak** a body outline (lekerekített négyzet) Path-ként — `Shape.holes`-ba
 * pusholáshoz. A bracket cutout-jához használjuk: a motor body itt megy keresztül
 * a lemezen, és a 4 furat területe amúgy is a cutout-on belül van, így nincs
 * szükség külön furatokra a lemez-cutout-ban.
 */
export function buildNema23HolePath(cx = 0, cy = 0): THREE.Path {
  const path = new THREE.Path()
  traceNema23BodyOutline(path, cx, cy)
  return path
}

/**
 * A NEMA 23 body **sarok-indent + fillet** silhouette-jének hozzáfűzése egy
 * létező Path/Shape-hez.
 *
 * Geometria: a body egy `size` × `size` mm-es négyzet (NEMA 23 standard 56.4),
 * mind a 4 sarokban egy R = `indentR` mm-es **konkáv** ÍV "bemélyed" — eltávolítva
 * a sarok-anyagot. Az indent ív és a body egyenes éleinek találkozásánál egy
 * R = `filletR` mm-es **konvex** (a body felől nézve KIFELÉ DOMBORÚ) ív simítja
 * le a metsző éleket.
 *
 * Az indent ív KÖZÉPPONTJA a csavar-pozícióhoz képest `outwardOffset` mm-rel
 * DIAGONÁLISAN KIFELÉ van eltolva (a body sarka felé), így a Ø5.1 menetes-szár
 * furat-középpontok ~`outwardOffset` mm-rel BENT esnek az indent-void körön.
 *
 * Egy sarok kontúrja CCW bejárásban tehát:
 *   egyenes él → konvex fillet → konkáv indent → konvex fillet → másik egyenes él
 *
 * Konstrukció:
 *   - `boltX, boltY = cx + sx*halfBolt, cy + sy*halfBolt` — csavar-pozíció (47.14 pattern).
 *   - `offsetAxis = outwardOffset / √2` — indent center axis-irányú off-set.
 *   - `indCx, indCy = boltX + sx*offsetAxis, boltY + sy*offsetAxis` — indent center.
 *   - `dx = (size - boltPattern)/2 - offsetAxis` — indent center ↔ legközelebbi body él.
 *   - Az indent kör (radius `indentR`, INDENT center) és a fillet kör (radius
 *     `filletR`) **EXTERNAL TANGENS**, középpontjaik távolsága `indentR + filletR`.
 *     A fillet kör tangens a body éléhez (a body interiorja felől, középpont az
 *     élhez `filletR` mélyen befelé esik).
 *   - `L = sqrt((indentR + filletR)² - (dx - filletR)²)` — fillet center axis-irányú
 *     off-set az indent centerhez képest a megfelelő él mentén.
 *
 * Geometriai megkötés: `(indentR + filletR)² > (dx - filletR)²`. Ez ekvivalens
 * azzal, hogy a fillet kör középpontja az élen INNEN, és a két kör tangenciális
 * találkozása létezik.
 *
 * @param target THREE.Path vagy THREE.Shape
 * @param cx silhouette közép X
 * @param cy silhouette közép Y
 * @param size body oldalhossz (default NEMA standard 56.4)
 * @param boltPattern csavar-pattern oldala (default 47.14)
 * @param indentR konkáv sarok-bemélyedés sugara (default 4)
 * @param filletR konvex fillet sugár az indent és az él találkozásánál (default 2)
 * @param outwardOffset indent center diagonális KIFELÉ eltolása a csavar-pozíciótól, mm (default 1)
 */
export function traceNema23IndentedSilhouette(
  target: THREE.Path,
  cx: number,
  cy: number,
  size = NEMA23_BODY_SIZE,
  boltPattern = NEMA23_BOLT_PATTERN,
  indentR = NEMA23_INDENT_R,
  filletR = NEMA23_INDENT_FILLET_R,
  outwardOffset = NEMA23_INDENT_OUTWARD_OFFSET,
): void {
  const half = size / 2
  const halfBolt = boltPattern / 2
  // offsetAxis = az indent center axis-irányú eltolása a bolt-pozíciótól
  // (az outwardOffset diagonális vektor 1/√2-szerese minden tengelyen).
  const offsetAxis = outwardOffset / Math.SQRT2
  // dx = az indent center és a legközelebbi body él közötti axis-irányú távolság.
  const dx = half - halfBolt - offsetAxis

  if (filletR <= 0) {
    throw new Error(`NEMA23 indented silhouette: filletR (${filletR}) must be positive.`)
  }
  if (dx <= 0) {
    throw new Error(
      `NEMA23 indented silhouette: outwardOffset (${outwardOffset}) too large; ` +
        `dx_eff = ${dx} ≤ 0 — az indent center átment a body élen.`,
    )
  }

  const innerSq = (indentR + filletR) * (indentR + filletR) - (dx - filletR) * (dx - filletR)
  if (innerSq <= 0) {
    throw new Error(
      `NEMA23 indented silhouette: invalid (indentR=${indentR}, filletR=${filletR}, dx_eff=${dx}); ` +
        '(indentR+filletR)² must exceed (dx-filletR)².',
    )
  }
  const L = Math.sqrt(innerSq)

  const yB = cy - half

  // CCW bejárás: a 4 sarkon megyünk át sorrendben BR → TR → TL → BL.
  // - sx*sy = -1 (BR, TL): horizontális élről jövünk → h-fillet → indent → v-fillet → vert. élre megyünk
  // - sx*sy = +1 (TR, BL): vertikális élről jövünk → v-fillet → indent → h-fillet → horiz. élre megyünk
  //
  // Path-kezdet: a BL sarok exit (h-) fillet-jének body-él tangenspontja az alsó élen.
  // BL indent center: (cx - halfBolt - offsetAxis, cy - halfBolt - offsetAxis)
  // BL bottom fillet center x: indCx_BL - sx*L = indCx_BL + L = cx - halfBolt - offsetAxis + L
  target.moveTo(cx - halfBolt - offsetAxis + L, yB)

  const corners: ReadonlyArray<{ sx: 1 | -1; sy: 1 | -1 }> = [
    { sx: +1, sy: -1 }, // BR
    { sx: +1, sy: +1 }, // TR
    { sx: -1, sy: +1 }, // TL
    { sx: -1, sy: -1 }, // BL
  ]
  const ratio = filletR / (indentR + filletR)

  for (const { sx, sy } of corners) {
    const isHEntry = sx * sy === -1
    const boltX = cx + sx * halfBolt
    const boltY = cy + sy * halfBolt
    // Indent center: a csavar-pozíciótól diagonálisan KIFELÉ eltolva.
    const indCx = boltX + sx * offsetAxis
    const indCy = boltY + sy * offsetAxis

    // Fillet centerek (az INDENT centerhez képest L axis-irányban + filletR az él felé).
    const hCx = indCx - sx * L
    const hCy = indCy + sy * (dx - filletR)
    const vCx = indCx + sx * (dx - filletR)
    const vCy = indCy - sy * L

    // Body-él tangenspontok (a body határoló négyzet élein vannak)
    const hEdgeX = hCx
    const hEdgeY = indCy + sy * dx // = cy + sy*half (a horizontális élen)
    const vEdgeX = indCx + sx * dx // = cx + sx*half (a vertikális élen)
    const vEdgeY = vCy

    // Indent-tangenspontok (a fillet center és az INDENT center közötti egyenes mentén,
    // a fillet centerhez `filletR` távolságra; ezen a ponton mindkét kör tangense azonos).
    const hIndentX = hCx + ratio * (indCx - hCx)
    const hIndentY = hCy + ratio * (indCy - hCy)
    const vIndentX = vCx + ratio * (indCx - vCx)
    const vIndentY = vCy + ratio * (indCy - vCy)

    // Szögek a fillet centerek körül.
    const hEdgeAngle = Math.atan2(hEdgeY - hCy, hEdgeX - hCx) // = sy * π/2
    const hIndentAngle = Math.atan2(hIndentY - hCy, hIndentX - hCx)
    const vEdgeAngle = Math.atan2(vEdgeY - vCy, vEdgeX - vCx) // = 0 ha sx=+1, π ha sx=-1
    const vIndentAngle = Math.atan2(vIndentY - vCy, vIndentX - vCx)

    // Szögek az INDENT center körül.
    const indentHAngle = Math.atan2(hIndentY - indCy, hIndentX - indCx)
    const indentVAngle = Math.atan2(vIndentY - indCy, vIndentX - indCx)

    if (isHEntry) {
      // Bejövünk a horizontális élről → h-fillet (CCW) → indent (CW) → v-fillet (CCW) → kimegyünk a vert. élre.
      target.lineTo(hEdgeX, hEdgeY)
      target.absarc(hCx, hCy, filletR, hEdgeAngle, hIndentAngle, false)
      target.absarc(indCx, indCy, indentR, indentHAngle, indentVAngle, true)
      target.absarc(vCx, vCy, filletR, vIndentAngle, vEdgeAngle, false)
    } else {
      // Bejövünk a vertikális élről → v-fillet (CCW) → indent (CW) → h-fillet (CCW) → kimegyünk a horiz. élre.
      target.lineTo(vEdgeX, vEdgeY)
      target.absarc(vCx, vCy, filletR, vEdgeAngle, vIndentAngle, false)
      target.absarc(indCx, indCy, indentR, indentVAngle, indentHAngle, true)
      target.absarc(hCx, hCy, filletR, hIndentAngle, hEdgeAngle, false)
    }
  }
  // A BL sarok exit fillet-je pontosan a startpontnál végződik, így a path
  // természetesen zárt — `closePath()` nem szükséges (a Three.js Shape /
  // ExtrudeGeometry tolerálja).
}

/**
 * Új Shape a NEMA 23 sarok-indent + fillet silhouette-tel (külső kontúrként). A
 * `holes` lista ÜRES — az indent voidok elég clearance-t adnak a Ø5 menetes
 * száraknak, nem kell külön furat. Ezt a Shape-t a motor iron body main
 * szakaszához és a hátsó plast fedőhöz használjuk extrúzióhoz.
 */
export function buildNema23IndentedShape(cx = 0, cy = 0): THREE.Shape {
  const shape = new THREE.Shape()
  traceNema23IndentedSilhouette(shape, cx, cy)
  return shape
}

/**
 * **Csak** a sarok-indent + fillet body silhouette Path-ként — `Shape.holes`-ba
 * pusholáshoz. Ezt a függőleges konzol cutout-jához használjuk: a bracket-anyag
 * a 4 sarok-indent voidban BENT marad (a bracket-cutout nyílásból "befelé álló
 * fülek" alakulnak ki a 4 csavar-pozíció köré), és ezeken a füleken egészülnek
 * ki a Ø5.1 menetes-szár furatok (külön `addNema23BoltHoles` hívással a Shape-en).
 *
 * A bracket cutout pontosan ugyanazt a fillet-aware silhouette-et követi, mint
 * a motor body, így a két alkatrész vizuálisan és geometriailag tökéletesen
 * illeszkedik egymáshoz.
 */
export function buildNema23IndentedHolePath(cx = 0, cy = 0): THREE.Path {
  const path = new THREE.Path()
  traceNema23IndentedSilhouette(path, cx, cy)
  return path
}
