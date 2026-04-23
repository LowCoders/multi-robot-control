/**
 * Képernyő-relatív kamera pan-vezérlő — a ViewCube KÖRÉ rendezve, a Canvas
 * jobb-felső sarkában.
 *
 * Layout: 4 nyíl-gomb (`↑ ← → ↓`) HTML-overlay-ként pozicionálva, hogy a 3D
 * Canvas-en BELÜL renderelt drei `GizmoViewcube` (alignment="top-right",
 * margin=[80, 80]) körül egy "+"-jelet alkossanak. A kocka kb. 100×100 px,
 * a kocka középpontja kb. (right: 80px, top: 80px); a nyilakat ennek megfelelően
 * helyezzük el — a gombok közepe ugyanazon a tengelyen van, mint a kocka közepe.
 *
 * - `↑` a kocka FÖLÖTT
 * - `↓` a kocka ALATT
 * - `←` a kocka BAL oldalán
 * - `→` a kocka JOBB oldalán
 *
 * A reset (Home) gomb innen ELTÁVOLÍTOTT — a `VisualizationPanel` toolbar-ja
 * tartalmaz egy külön `Home` ikon-gombot, amely ugyanazt a `resetCamera()`-t
 * hívja. A pan-pad így csak a 4 irányt mutatja, és nem üti ki vizuálisan a
 * ViewCube-ot.
 *
 * Shift = 5x lépés (gyorsabb pan).
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { useHighlightStore } from './highlightStore'

interface Props {
  /**
   * A pan-lépés mértéke világ-mm-ben. A wrapper a config-eredetű kamera-
   * távolság ~10%-át adja át (~70 mm tipikusan).
   */
  step: number
}

/**
 * Layout-konstansok — a drei `GizmoViewcube` `margin={[80, 80]}` és default
 * 80px cube-méret feltételezésével. Ha a margin / size változik a
 * `TubeBenderVisualizationV2.tsx`-ben, ezeket is hangolni kell.
 */
const CUBE_CENTER_RIGHT = 80 // a ViewCube közepe ennyi px-re a jobb széltől
const CUBE_CENTER_TOP = 80 // és a felső széltől
const CUBE_HALF = 40 // fél kocka (drei default size = 80px)
const BTN_SIZE = 28 // nyíl-gomb mérete (w-7 h-7)
const GAP = 4 // a kocka és a gombok közti légrés

function CameraPanPadInner({ step }: Props) {
  const { t } = useTranslation('visualization')
  const panCamera = useHighlightStore((s) => s.panCamera)

  const amountFor = (e: React.MouseEvent) => (e.shiftKey ? step * 5 : step)

  const btnClass =
    'absolute pointer-events-auto w-7 h-7 flex items-center justify-center rounded bg-steel-900/85 hover:bg-steel-700 active:bg-steel-600 border border-steel-700 text-steel-200 hover:text-white shadow-lg backdrop-blur transition-colors z-10'

  return (
    // Egy "ablak" (pointer-events: none) a Canvas teljes felületén; a 4 gomb
    // pointer-events: auto-val visszakapcsolja a kattintást. Így a jobb-felső
    // sarokban semmi más nem akadályozza a Canvas pointer-eseményeit.
    <div className="absolute inset-0 pointer-events-none" aria-hidden={false}>
      {/* ↑ FELFELÉ — a kocka fölött, vízszintesen centrálva. */}
      <button
        type="button"
        onClick={(e) => panCamera('up', amountFor(e))}
        title={t('camera_ctrl.pan_up')}
        className={btnClass}
        style={{
          top: CUBE_CENTER_TOP - CUBE_HALF - BTN_SIZE - GAP,
          right: CUBE_CENTER_RIGHT - BTN_SIZE / 2,
        }}
      >
        <ArrowUp className="w-4 h-4" />
      </button>

      {/* ↓ LE — a kocka alatt. */}
      <button
        type="button"
        onClick={(e) => panCamera('down', amountFor(e))}
        title={t('camera_ctrl.pan_down')}
        className={btnClass}
        style={{
          top: CUBE_CENTER_TOP + CUBE_HALF + GAP,
          right: CUBE_CENTER_RIGHT - BTN_SIZE / 2,
        }}
      >
        <ArrowDown className="w-4 h-4" />
      </button>

      {/* ← BALRA — a kocka bal oldalán. */}
      <button
        type="button"
        onClick={(e) => panCamera('left', amountFor(e))}
        title={t('camera_ctrl.pan_left')}
        className={btnClass}
        style={{
          top: CUBE_CENTER_TOP - BTN_SIZE / 2,
          right: CUBE_CENTER_RIGHT + CUBE_HALF + GAP,
        }}
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      {/* → JOBBRA — a kocka jobb oldalán. */}
      <button
        type="button"
        onClick={(e) => panCamera('right', amountFor(e))}
        title={t('camera_ctrl.pan_right')}
        className={btnClass}
        style={{
          top: CUBE_CENTER_TOP - BTN_SIZE / 2,
          right: CUBE_CENTER_RIGHT - CUBE_HALF - BTN_SIZE - GAP,
        }}
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

const CameraPanPad = memo(CameraPanPadInner)
export default CameraPanPad
