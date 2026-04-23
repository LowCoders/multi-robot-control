import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Box,
  Boxes,
  Camera,
  Compass,
  Download,
  FileCode,
  GripVertical,
  Highlighter,
  Home,
  Palette,
  Pencil,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Wind,
} from 'lucide-react'
import type { MachineConfig } from '../../types/machine-config'
import type { DeviceStatus, Position } from '../../types/device'
import { hostPut } from '../../utils/hostApi'
import { createLogger } from '../../utils/logger'
import MachineVisualization from './MachineVisualization'
import RobotArmVisualization from './RobotArmVisualization'
import TubeBenderVisualization from './TubeBenderVisualization'
import {
  CombinedEditPanel,
  ComponentTable,
  LOD_LABELS_EN,
  LOD_LABELS_HU,
  LOD_LEVELS,
  TubeBenderVisualizationV2,
  exportStl,
  useHighlightStore,
  useTransformOverrideStore,
  useVisualPropsStore,
} from './v2'

const log = createLogger('VisualizationPanel')

interface Props {
  config: MachineConfig
  /**
   * Az eszköz egyedi azonosítója a `/api/devices/{id}/...` API-hoz. A "mentés
   * alapértelmezett nézetként" gomb használja a `cameraPose` perzisztálásához.
   * Ha nincs megadva, a save-gomb le van tiltva.
   */
  deviceId?: string
  position?: Position
  status?: DeviceStatus
  className?: string
  showDebugInfo?: boolean
  showHeader?: boolean
  headerExtra?: React.ReactNode
}

/**
 * Kis ikon-gomb wrapper a fejléc-kontrollokhoz: konzisztens méret, hover-stílus,
 * és kétállapotú highlight (`active=true` → blue accent + bg-steel-700/60).
 */
interface IconBtnProps {
  active?: boolean
  onClick: () => void
  title: string
  disabled?: boolean
  children: React.ReactNode
}
function IconBtn({ active, onClick, title, disabled, children }: IconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded border border-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-steel-700/70 text-blue-400 border-steel-600'
          : 'text-steel-400 hover:text-white hover:bg-steel-800'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Vékony függőleges elválasztó vonal a toolbar logikai csoportjai között.
 * 1 px széles, magasság a sor magasságához igazodik (`h-5`); a két oldalra
 * kis margó (`mx-1`), hogy a szomszédos ikongombokhoz "kötőjel" jellegű
 * lélegzetet adjon. A szín a többi border-rel harmonizál (`bg-steel-700`).
 */
function ToolbarSeparator() {
  return <div className="w-px h-5 bg-steel-700 mx-1 self-center shrink-0" aria-hidden="true" />
}

/** Bool olvasás localStorage-ból; SSR / kivétel esetén a default érték. */
function readLocalBool(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    return raw === '1' || raw === 'true'
  } catch {
    return defaultValue
  }
}

/** Bool írás localStorage-ba; hibát csendben elnyel (privát mód, kvóta, stb). */
function writeLocalBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // ignore
  }
}

export default function VisualizationPanel({
  config,
  deviceId,
  position,
  status,
  className = '',
  showDebugInfo = false,
  showHeader = true,
  headerExtra,
}: Props) {
  const { t, i18n } = useTranslation('visualization')
  const lodLabels = i18n.language.startsWith('hu') ? LOD_LABELS_HU : LOD_LABELS_EN
  const currentFile = status?.current_file
  const filename = currentFile?.split('/').pop()

  // V2 (új tube bender modell) opcionális engedélyezése — csak tube_bender-nél jelenik meg.
  // A kapcsolók állapota localStorage-ban perzisztál, így lapfrissítés után is megmarad.
  // Default: useV2 = true (új modell aktív).
  //
  // **Megjegyzés**: a táblázat-panel külön "show table" kapcsolója megszűnt —
  // a panel mostantól MINDIG renderel, és a felhasználó a `ComponentTable`
  // saját `panelCollapsed` strip-jét használja az elrejtéshez/kibontáshoz
  // (a függőlegesen kiírt cím + chevron-gomb miatt önmagát magyarázza).
  const [useV2, setUseV2] = useState<boolean>(() => readLocalBool('mrc-tb-useV2', true))
  const [showCameraCtrl, setShowCameraCtrl] = useState<boolean>(() =>
    readLocalBool('mrc-tb-camCtrl-visible', true),
  )
  useEffect(() => writeLocalBool('mrc-tb-useV2', useV2), [useV2])
  useEffect(() => writeLocalBool('mrc-tb-camCtrl-visible', showCameraCtrl), [showCameraCtrl])
  const isTubeBender = config.type === 'tube_bender'
  const lodLevel = useHighlightStore((s) => s.lodLevel)
  const setLodLevel = useHighlightStore((s) => s.setLodLevel)
  const colorMode = useHighlightStore((s) => s.colorMode)
  const setColorMode = useHighlightStore((s) => s.setColorMode)
  const fadeOthers = useHighlightStore((s) => s.fadeOthers)
  const setFadeOthers = useHighlightStore((s) => s.setFadeOthers)
  const selectedId = useHighlightStore((s) => s.selectedId)

  // V2 transform-override (edit mode) állapot — dirty draftok, baseline
  // (configból betöltött) override-ok kezelése.
  //
  // **Megjegyzés**: a `gizmoMode` váltását (translate ↔ rotate) a felhasználó
  // úgy kezeli, hogy a már kijelölt elemre rákattint a 3D nézetben — a logika
  // a `TubeBenderModelV2`-ben él, így itt nincs szükség sem a `gizmoMode`
  // szelektorra, sem külön toolbar-gombokra.
  //
  // Hasonlóan a "reset selected" toolbar-gomb is megszűnt (a globális undo /
  // redo pótolja), így a `clearOverride` és a `pushHistory` se kell ide —
  // a per-row "reset override" gomb a táblázatban a saját store-szelektorát
  // használja.
  const editMode = useTransformOverrideStore((s) => s.editMode)
  const setEditMode = useTransformOverrideStore((s) => s.setEditMode)
  const drafts = useTransformOverrideStore((s) => s.drafts)
  const baseline = useTransformOverrideStore((s) => s.baseline)
  const loadFromConfig = useTransformOverrideStore((s) => s.loadFromConfig)
  const commitDrafts = useTransformOverrideStore((s) => s.commitDrafts)
  const undo = useTransformOverrideStore((s) => s.undo)
  const redo = useTransformOverrideStore((s) => s.redo)
  // history.length / future.length szelektor — boolean-ként figyeljük, hogy a
  // toolbar gombok disabled állapota csak a "van/nincs" váltáskor renderelje
  // újra a panelt (nem minden push/pop-nál).
  const canUndoTransform = useTransformOverrideStore((s) => s.history.length > 0)
  const canRedoTransform = useTransformOverrideStore((s) => s.future.length > 0)

  // V2 visual-props (Palette panel) állapot — független edit-mode flag,
  // saját drafts / baseline / undo-redo verem.
  const visualEditMode = useVisualPropsStore((s) => s.editMode)
  const setVisualEditMode = useVisualPropsStore((s) => s.setEditMode)
  const visualDrafts = useVisualPropsStore((s) => s.drafts)
  const visualBaseline = useVisualPropsStore((s) => s.baseline)
  const loadVisualFromConfig = useVisualPropsStore((s) => s.loadFromConfig)
  const commitVisualDrafts = useVisualPropsStore((s) => s.commitDrafts)
  const undoVisual = useVisualPropsStore((s) => s.undo)
  const redoVisual = useVisualPropsStore((s) => s.redo)
  const canUndoVisual = useVisualPropsStore((s) => s.history.length > 0)
  const canRedoVisual = useVisualPropsStore((s) => s.future.length > 0)
  // Egyesített undo/redo enabled flag a toolbar gombhoz.
  const canUndo = canUndoTransform || canUndoVisual
  const canRedo = canRedoTransform || canRedoVisual

  // Config-ból (és annak változásakor) betöltjük a baseline override-okat. A
  // drafts NEM íródnak felül — ha a felhasználó éppen mozgat valamit, a
  // mozgatás folytatódhat. A `loadFromConfig` defenzív: undefined → üres.
  const configOverrides = config.visuals?.componentOverrides
  useEffect(() => {
    loadFromConfig(configOverrides)
  }, [configOverrides, loadFromConfig])
  const configVisualOverrides = config.visuals?.componentVisualOverrides
  useEffect(() => {
    loadVisualFromConfig(configVisualOverrides)
  }, [configVisualOverrides, loadVisualFromConfig])

  // Van-e bármilyen módosítatlan draft? (a táblázat dirty jelölésén túl egy
  // gyors logikai flag a "Save layout" gomb engedélyezéséhez). A transform és
  // a visual draft-okat is beleszámoljuk — a "Save layout" mindkettőt menti
  // egy `PUT /machine-config`-pal.
  const hasDirty = useMemo(() => {
    for (const [id, d] of Object.entries(drafts)) {
      const b = baseline[id]
      if (
        !b ||
        b.position[0] !== d.position[0] ||
        b.position[1] !== d.position[1] ||
        b.position[2] !== d.position[2] ||
        b.rotation[0] !== d.rotation[0] ||
        b.rotation[1] !== d.rotation[1] ||
        b.rotation[2] !== d.rotation[2]
      ) {
        return true
      }
    }
    // Visual drafts: shallow JSON-equality (a mezők elsősorban primitívek és
    // 3-elemű scale array; a JSON-stringify olcsó és pontos egyenlőséget ad).
    for (const [id, d] of Object.entries(visualDrafts)) {
      const b = visualBaseline[id]
      if (!b || JSON.stringify(d) !== JSON.stringify(b)) return true
    }
    return false
  }, [drafts, baseline, visualDrafts, visualBaseline])

  // Save view: PUT a teljes machine-config-ot, frissített `visuals.cameraPosition`
  // / `cameraTarget` mezőkkel a store-ban élő `cameraPose` alapján. A backend
  // ugyanazt a végpontot használja, mint a MachineConfigTab "Mentés" gombja —
  // így a beállítás perzisztens (jelenlegi és későbbi sessionökben is).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null)
  const handleSaveCameraView = useCallback(async () => {
    const pose = useHighlightStore.getState().cameraPose
    if (!pose) {
      // A `Scene` first-mount init már akkor is feltölti a store-t, ha a user
      // nem nyúlt a kamerához — de robbanás-biztonságból kezeljük a null esetet.
      setSaveStatus('error')
      setSaveErrorDetail(t('panel.save_view_no_pose'))
      setTimeout(() => setSaveStatus('idle'), 2500)
      return
    }
    if (!deviceId) {
      setSaveStatus('error')
      setSaveErrorDetail(t('panel.save_view_no_device'))
      setTimeout(() => setSaveStatus('idle'), 2500)
      return
    }
    setSaveStatus('saving')
    setSaveErrorDetail(null)
    try {
      // Egész mm-re kerekítünk (a MachineConfigTab eredeti viselkedésével
      // megegyezően — a sub-mm pontosság a localStorage-ban él tovább).
      const updated: MachineConfig = {
        ...config,
        visuals: {
          ...config.visuals,
          cameraPosition: {
            x: Math.round(pose.pos[0]),
            y: Math.round(pose.pos[1]),
            z: Math.round(pose.pos[2]),
          },
          cameraTarget: {
            x: Math.round(pose.target[0]),
            y: Math.round(pose.target[1]),
            z: Math.round(pose.target[2]),
          },
        },
      }
      await hostPut(`/devices/${deviceId}/machine-config`, updated)
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      log.error('Failed to save default camera view', err)
      setSaveStatus('error')
      setSaveErrorDetail(err instanceof Error ? err.message : String(err))
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [config, deviceId, t])

  // Save layout: a felhasználó által átállított V2 alkatrész-poz/forg
  // override-okat (drafts ∪ baseline) menti a `MachineConfig.visuals.componentOverrides`
  // mezőbe, ugyanazzal a `PUT /devices/{id}/machine-config` végponttal.
  // Sikeres mentés után a draftok beolvadnak a baseline-ba.
  const [layoutSaveStatus, setLayoutSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [layoutSaveErrorDetail, setLayoutSaveErrorDetail] = useState<string | null>(null)
  const handleSaveLayout = useCallback(async () => {
    if (!deviceId) {
      setLayoutSaveStatus('error')
      setLayoutSaveErrorDetail(t('panel.save_view_no_device'))
      setTimeout(() => setLayoutSaveStatus('idle'), 2500)
      return
    }
    setLayoutSaveStatus('saving')
    setLayoutSaveErrorDetail(null)
    try {
      // Egy "Save layout" mindkét store-ot egyszerre menti — egyetlen
      // `PUT /machine-config` payload-ban a `componentOverrides` (transform)
      // és a `componentVisualOverrides` (vizuális props) is.
      const merged = useTransformOverrideStore.getState().getMergedMap()
      const mergedVisual = useVisualPropsStore.getState().getMergedMap()
      // `exactOptionalPropertyTypes: true` miatt nem szabad `undefined`-ot
      // explicit kulcsként hozzárendelni; a kulcsot vagy beletesszük (ha van
      // nem-üres override-map), vagy egyáltalán nem szerepeltetjük.
      const visualsBase = { ...config.visuals }
      if (Object.keys(merged).length > 0) {
        visualsBase.componentOverrides = merged
      } else {
        delete visualsBase.componentOverrides
      }
      if (Object.keys(mergedVisual).length > 0) {
        visualsBase.componentVisualOverrides = mergedVisual
      } else {
        delete visualsBase.componentVisualOverrides
      }
      const updated: MachineConfig = {
        ...config,
        visuals: visualsBase,
      }
      await hostPut(`/devices/${deviceId}/machine-config`, updated)
      commitDrafts(merged)
      commitVisualDrafts(mergedVisual)
      setLayoutSaveStatus('success')
      setTimeout(() => setLayoutSaveStatus('idle'), 2000)
    } catch (err) {
      log.error('Failed to save component layout', err)
      setLayoutSaveStatus('error')
      setLayoutSaveErrorDetail(err instanceof Error ? err.message : String(err))
      setTimeout(() => setLayoutSaveStatus('idle'), 3000)
    }
  }, [config, deviceId, commitDrafts, commitVisualDrafts, t])

  /**
   * Home / kamera-reset: a `useHighlightStore.resetCamera()` parancsot küldi,
   * amit a `Scene` `useEffect` figyel és az alap-pozícióra ugrik vissza.
   * A perzisztált `cameraPose`-t is törli (új session-ön is alap nézet jön).
   */
  const handleHomeView = useCallback(() => {
    useHighlightStore.getState().resetCamera()
  }, [])

  /**
   * Egyetlen "Edit mode" toolbar-gomb (ceruza ikon) — egyszerre kapcsolja a
   * transform-edit és a vizuális-tulajdonság-edit módot is. Az aktiválás után
   * a felhasználó kattintsa rá egy alkatrészre / assembly-re (3D-ben vagy a
   * táblázatban) és MINDKÉT panel megjelenik. A panelek X gombjai külön-külön
   * zárhatók be (a saját editMode-ot kapcsolják le), ezért az
   * "aktív összeg" `editMode || visualEditMode`.
   *
   * Klikk-szemantika:
   *   - Bármelyik aktív → mindkettőt KIkapcsolja (hard-stop az editing-ből).
   *   - Mindkettő ki → mindkettőt BEkapcsolja.
   *
   * Ezzel egyetlen kattintás a globális "edit mode on/off" — nem kell külön
   * be-bekapcsolgatni a két panelt.
   */
  const isEditingActive = editMode || visualEditMode
  const handleToggleEdit = useCallback(() => {
    if (isEditingActive) {
      setEditMode(false)
      setVisualEditMode(false)
    } else {
      setEditMode(true)
      setVisualEditMode(true)
    }
  }, [isEditingActive, setEditMode, setVisualEditMode])

  // Egységes undo/redo wrapper a két store felé.
  //
  // Megközelítés: a két store undo verme TELJESEN független, mert egy user
  // action vagy az egyikhez vagy a másikhoz tartozik (transform-mozgatás vs.
  // vizuális prop-állítás). Egyszerre soha nem jön push mindkettőbe, ezért a
  // wrapper "bármelyik csak az egyiken hívja az undo-t":
  //   - először a vizuálisra próbálunk vissza (gyakrabban "felső" rétegnek
  //     érzékelhető a UI-felhasználói modellben),
  //   - aztán a transform-ra,
  //   - ha egyik sem tud, no-op.
  //
  // Ha a jövőben kell egy globális idősor (egy lépés = egy snapshot), egy
  // külön "history-coordinator" store kell — most a két verem külön él.
  const undoCombined = useCallback(() => {
    if (useVisualPropsStore.getState().history.length > 0) {
      undoVisual()
    } else if (useTransformOverrideStore.getState().history.length > 0) {
      undo()
    }
  }, [undo, undoVisual])
  const redoCombined = useCallback(() => {
    if (useVisualPropsStore.getState().future.length > 0) {
      redoVisual()
    } else if (useTransformOverrideStore.getState().future.length > 0) {
      redo()
    }
  }, [redo, redoVisual])

  // STL export dropdown menu — egy gomb, amely lenyíló listát mutat a két
  // export-tipusra (teljes modell / csak kijelölt). A korábbi két különálló
  // gomb helyett ez egy ikont visel a fejlécben (hely-takarékos), és
  // click-outside / Escape zárás-szemantikát ad. A `stlMenuRef` az anchor
  // konténer (gomb + lenyíló) — minden ezen kívüli kattintás zár.
  const [stlMenuOpen, setStlMenuOpen] = useState(false)
  const stlMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!stlMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as Node | null
      if (stlMenuRef.current && tgt && !stlMenuRef.current.contains(tgt)) {
        setStlMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStlMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [stlMenuOpen])

  // Globális billentyűzet-rövidítés: Ctrl+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo.
  // Az aktív elem (input / textarea / contenteditable) nem-elnyelt — natív undo
  // marad működőképes a szövegmezőkben. macOS-en a Cmd-et is elfogadja (metaKey).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      // Ne lopjuk el a fókuszált szöveg-input undo-ját.
      const tgt = e.target as HTMLElement | null
      if (tgt) {
        const tag = tgt.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tgt.isContentEditable
        ) {
          return
        }
      }
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoCombined()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redoCombined()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoCombined, redoCombined])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with program name */}
      {showHeader && (
        <div className="bg-steel-900/95 backdrop-blur border-b border-steel-700 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileCode className="w-4 h-4 text-steel-400" />
            {filename ? (
              <span className="text-steel-200 font-medium">{filename}</span>
            ) : (
              <span className="text-steel-500">{t('panel.no_program')}</span>
            )}
            {status?.state === 'running' && (
              <span className="ml-2 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                {t('panel.running')}
              </span>
            )}
            {status?.state === 'paused' && (
              <span className="ml-2 px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">
                {t('panel.paused')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
          </div>
        </div>
      )}

      {/* V2 alapsáv: az 'Új modell (béta)' kapcsoló MINDIG látszik tube_bender-nél,
          akkor is, ha a header rejtve van (showHeader=false). */}
      {isTubeBender && (
        <div className="bg-steel-900/95 border-b border-steel-700 px-3 py-1 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-steel-300 cursor-pointer">
            <input
              type="checkbox"
              checked={useV2}
              onChange={(e) => setUseV2(e.target.checked)}
              className="accent-blue-500"
            />
            {t('panel.beta_model')}
          </label>
          {!useV2 && (
            <span className="text-steel-500 italic">
              {t('panel.beta_hint')}
            </span>
          )}
        </div>
      )}

      {/* V2 vezérlő sáv — csoportosított ikon-only kontrollok, függőleges
          elválasztókkal a csoportok között. Sorrend balról jobbra:
            BAL OLDAL:
              [LOD pill] | [Színmód + Fade] | [Edit toggle (Pencil)]
            JOBB OLDAL (ml-auto után):
              [Undo + Redo] | [Home + Save view] | [Save layout] | [STL export]
          A korábbi **Compass** kamera-vezérlő toggle ÁTKERÜLT a 3D canvas
          jobb-felső sarkába (a ViewCube mellé). A korábbi **SlidersHorizontal**
          (vizuális props edit) toggle MEGSZŰNT — a Pencil mostantól MINDKÉT
          panelt egyszerre kapcsolja. A korábbi gizmo-mode pill (Move/RotateCcw)
          és a reset-selected gomb is törölve: gizmo-mode váltás = a kijelölt
          elemre újra-kattintás (3D), a glob. undo/redo a reset-selected-et
          pótolja. */}
      {isTubeBender && useV2 && (
        <div className="bg-steel-900/95 border-b border-steel-700 px-3 py-1.5 flex items-center gap-1.5 flex-wrap text-xs">
          {/* === Group: LOD szint === */}
          <div className="inline-flex rounded border border-steel-700 overflow-hidden">
            {LOD_LEVELS.map((lvl) => {
              const Icon = lvl === 'schematic' ? Box : lvl === 'medium' ? Boxes : Sparkles
              const active = lodLevel === lvl
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLodLevel(lvl)}
                  title={t('panel.lod_tooltip', { level: lodLabels[lvl] })}
                  className={`p-1 transition-colors ${
                    active
                      ? 'bg-steel-700/70 text-blue-400'
                      : 'text-steel-400 hover:text-white hover:bg-steel-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              )
            })}
          </div>

          <ToolbarSeparator />

          {/* === Group: Vizuális megjelenítés (színmód + fade) ===
              A két ikont egy saját `flex` konténerbe csomagoljuk `gap-0`-val
              (1 px-es vizuális közüket a gombok belső `border` adja), hogy
              összetartozó "egységnek" lássák a fejléc-szülő `gap-1.5`-jétől
              függetlenül. */}
          <div className="flex items-center" style={{ gap: '1px' }}>
            <IconBtn
              active={colorMode === 'registry'}
              onClick={() => setColorMode(colorMode === 'pbr' ? 'registry' : 'pbr')}
              title={t('panel.color_tooltip', {
                mode: colorMode === 'pbr' ? t('panel.color_pbr') : t('panel.color_registry'),
              })}
            >
              <Palette className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn
              active={fadeOthers}
              onClick={() => setFadeOthers(!fadeOthers)}
              title={fadeOthers ? t('panel.fade_tooltip_on') : t('panel.fade_tooltip_off')}
            >
              <Highlighter className="w-3.5 h-3.5" />
            </IconBtn>
          </div>

          <ToolbarSeparator />

          {/* === Group: Szerkesztés + History ===
              Egy gomb (Pencil) — egyszerre kapcsolja a transform és a
              vizuális-prop edit módot. Kijelölés nélkül disabled (mindkét
              panel selectedId nélkül üres lenne); kivéve, ha bármelyik már be
              van kapcsolva — akkor hagyjuk kikapcsolni (különben "ON-de-
              disabled" csapdába esnénk, ha menet közben deszelektált a user).
              Mögötte közvetlenül (egy elválasztó után) az Undo / Redo gombok
              — egy edit-action vagy az transform vagy a visual store-ba megy,
              a wrapper hívja a megfelelőt. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
              ugyanezt teszi (window-listener fent). */}
          <IconBtn
            active={isEditingActive}
            disabled={!selectedId && !isEditingActive}
            onClick={handleToggleEdit}
            title={
              !selectedId && !isEditingActive
                ? t('panel.edit_mode_pick_first')
                : isEditingActive
                  ? t('panel.edit_mode_tooltip_on')
                  : t('panel.edit_mode_tooltip_off')
            }
          >
            <Pencil className="w-3.5 h-3.5" />
          </IconBtn>

          <ToolbarSeparator />

          <IconBtn
            disabled={!canUndo}
            onClick={() => undoCombined()}
            title={canUndo ? t('panel.undo_tooltip') : t('panel.undo_disabled')}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            disabled={!canRedo}
            onClick={() => redoCombined()}
            title={canRedo ? t('panel.redo_tooltip') : t('panel.redo_disabled')}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </IconBtn>

          <div className="flex items-center gap-1 ml-auto">
            {/* === Group: Kamera-nézet ===
                Az Undo / Redo átkerült a bal oldali csoportba (a szerkesztő
                gomb mögé), így itt nincs szükség indító elválasztóra. */}
            {/* Home / kamera-reset — a kamerát a config-eredetű alap-pozícióra
                állítja vissza, és a perzisztált `cameraPose`-t törli. */}
            <IconBtn
              onClick={handleHomeView}
              title={t('panel.home_view_tooltip')}
            >
              <Home className="w-3.5 h-3.5" />
            </IconBtn>
            {/* Save current camera view as default for this device. */}
            <IconBtn
              active={saveStatus === 'success'}
              disabled={!deviceId || saveStatus === 'saving'}
              onClick={() => void handleSaveCameraView()}
              title={
                saveStatus === 'error' && saveErrorDetail
                  ? t('panel.save_view_failed', { detail: saveErrorDetail })
                  : saveStatus === 'success'
                    ? t('panel.save_view_success')
                    : t('panel.save_view_title')
              }
            >
              <Camera
                className={`w-3.5 h-3.5 ${
                  saveStatus === 'saving' ? 'animate-pulse' : ''
                } ${saveStatus === 'error' ? 'text-red-400' : ''}`}
              />
            </IconBtn>

            {/* === Group: Layout-mentés ===
                Jobb oldalon nincs elválasztó: a kontextusból (kameracsoport →
                mentés-ikon → exporter-ikon) az ikonok közti gap önmagában
                elég vizuális határt ad. */}
            {/* Save layout: a felhasználó által átállított alkatrész-poz/forg
                ÉS vizuális override-okat menti a configba. */}
            <IconBtn
              active={layoutSaveStatus === 'success'}
              disabled={!deviceId || layoutSaveStatus === 'saving' || !hasDirty}
              onClick={() => void handleSaveLayout()}
              title={
                layoutSaveStatus === 'error' && layoutSaveErrorDetail
                  ? t('panel.save_layout_failed', { detail: layoutSaveErrorDetail })
                  : layoutSaveStatus === 'success'
                    ? t('panel.save_layout_success')
                    : hasDirty
                      ? t('panel.save_layout_title')
                      : t('panel.save_layout_clean')
              }
            >
              <Save
                className={`w-3.5 h-3.5 ${
                  layoutSaveStatus === 'saving' ? 'animate-pulse' : ''
                } ${layoutSaveStatus === 'error' ? 'text-red-400' : ''}`}
              />
            </IconBtn>

            {/* === Group: Export ===
                Egy ikon-only Download gomb — kattintásra lenyíló menüben
                választható az export tipusa (teljes / csak kijelölt;
                realisztikus vagy bbox-mód). A korábbi két különálló gomb
                helyett ez kompaktabb és jövőbiztos: új export-tipus
                hozzáadása csak egy menüpont kérdése.

                A `relative` szülő ad anchor-t az `absolute right-0 top-full`
                lenyíló panelnek; a click-outside / Escape kezelést a fenti
                `useEffect` (`stlMenuOpen` watcher) végzi a `stlMenuRef`-en. */}
            <div ref={stlMenuRef} className="relative">
              <IconBtn
                active={stlMenuOpen}
                onClick={() => setStlMenuOpen((v) => !v)}
                title={t('panel.stl_menu_title')}
              >
                <Download className="w-3.5 h-3.5" />
              </IconBtn>
              {stlMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-30 min-w-[220px] bg-steel-900 border border-steel-700 rounded shadow-lg py-1"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setStlMenuOpen(false)
                      exportStl()
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-steel-100 hover:bg-steel-800 flex items-center gap-2"
                    title={t('panel.stl_full_title')}
                  >
                    <Download className="w-3.5 h-3.5 text-steel-400 shrink-0" />
                    <span>{t('panel.stl_menu_full')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!selectedId}
                    onClick={() => {
                      setStlMenuOpen(false)
                      if (selectedId) exportStl({ rootId: selectedId })
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-steel-100 hover:bg-steel-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    title={
                      selectedId
                        ? t('panel.stl_selected_title', { id: selectedId })
                        : t('panel.stl_pick_first')
                    }
                  >
                    <Download className="w-3.5 h-3.5 text-steel-400 shrink-0" />
                    <span>
                      {t('panel.stl_menu_selected')}
                      {selectedId ? ` (${selectedId})` : ''}
                    </span>
                  </button>
                  <div className="my-1 border-t border-steel-700" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setStlMenuOpen(false)
                      exportStl({ bboxOnly: true })
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-steel-100 hover:bg-steel-800 flex items-center gap-2"
                    title={t('panel.stl_bbox_title')}
                  >
                    <Box className="w-3.5 h-3.5 text-steel-400 shrink-0" />
                    <span>{t('panel.stl_menu_bbox')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3D Visualization */}
      <div className="flex-1 min-h-0 relative flex">
        <div className="flex-1 min-w-0 relative">
          {config.type === 'robot_arm' ? (
            <RobotArmVisualization
              config={config}
              position={position}
              status={status}
            />
          ) : config.type === 'tube_bender' ? (
            useV2 ? (
              <TubeBenderVisualizationV2
                config={config}
                position={position}
                status={status}
                showCameraControls={showCameraCtrl}
              />
            ) : (
              <TubeBenderVisualization
                config={config}
                position={position}
                status={status}
              />
            )
          ) : (
            <MachineVisualization
              config={config}
              position={position}
              status={status}
            />
          )}

          {/* Egységesített edit overlay panel — fülezett (Position / Color /
              Material / Scale / Other) layouttal egyesíti a korábbi külön
              `TransformEditPanel` és `VisualPropsEditPanel` funkcionalitását.
              Akkor jelenik meg, ha a transform vagy a visual edit-mode aktív
              és van kijelölt node. A pointer-events trükk (wrapper "none",
              panel "auto") változatlan: a panel közötti üres tér a 3D-szakasz
              kattintásait átengedi. */}
          {isTubeBender && useV2 && (
            <div className="absolute top-2 left-2 z-10 pointer-events-none flex flex-col gap-2">
              <CombinedEditPanel />
            </div>
          )}

          {/* Kamera-vezérlő toggle a JOBB-FELSŐ sarokban — a `GizmoViewcube`
              közvetlen szomszédságában (a viewcube alignment="top-right",
              margin=[80, 80] → ~80 px-re a sarkoktól). A toggle ENNÉL
              kintebb (top-2 right-2) helyezkedik el, hogy a viewcube fölé
              kerüljön és kattintható maradjon akkor is, amikor a
              CameraPanPad / ViewCube ki van kapcsolva.
              Korábban toolbar-szintű ikon volt, de a felhasználói kérés
              szerint a 3D nézethez kapcsolódó UI a 3D nézet sarkában él. */}
          {isTubeBender && useV2 && (
            <button
              type="button"
              onClick={() => setShowCameraCtrl(!showCameraCtrl)}
              title={
                showCameraCtrl
                  ? t('panel.cam_ctrl_tooltip_on')
                  : t('panel.cam_ctrl_tooltip_off')
              }
              className={`absolute top-2 right-2 z-20 p-1.5 rounded border transition-colors ${
                showCameraCtrl
                  ? 'bg-steel-800/80 backdrop-blur text-blue-400 border-steel-600 hover:bg-steel-700/80'
                  : 'bg-steel-900/70 backdrop-blur text-steel-400 border-steel-700 hover:text-white hover:bg-steel-800/80'
              }`}
            >
              <Compass className="w-4 h-4" />
            </button>
          )}

          {/* Debug overlay - show position updates */}
          {showDebugInfo && (
            <div className="absolute top-2 left-2 bg-black/80 text-xs font-mono p-2 rounded text-green-400">
              <div>POS: X={position?.x?.toFixed(2) ?? '?'} Y={position?.y?.toFixed(2) ?? '?'} Z={position?.z?.toFixed(2) ?? '?'}</div>
              <div>STATE: {status?.state ?? 'unknown'}</div>
              <div>LINE: {status?.current_line ?? 0} / {status?.total_lines ?? 0}</div>
              <div>FILE: {status?.current_file?.split('/').pop() ?? 'none'}</div>
            </div>
          )}
        </div>

        {/* V2 alkatrész-táblázat oldalsáv — a panel maga állítja a szélességét
            (resize-handle + collapse + localStorage), csak a határvonalat húzzuk ki. */}
        {/* Alkatrész-táblázat oldalsáv — MINDIG renderelődik tube_bender +
            useV2 esetén. A megjelenítés finomhangolása (collapsed strip vs.
            teljes táblázat) a panel saját state-jében (`panelCollapsed`) él,
            ami localStorage-ba perzisztálódik. */}
        {isTubeBender && useV2 && (
          <ComponentTable className="shrink-0 border-l border-steel-700" />
        )}
      </div>
      
      {/* Status bar at bottom */}
      <div className="bg-steel-900/95 backdrop-blur border-t border-steel-700 px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          {/* Position display */}
          {config.type === 'tube_bender' ? (
            <div className="flex items-center gap-3 font-mono">
              <span className="text-red-400">
                X: {(position?.x ?? 0).toFixed(2)} mm
              </span>
              <span className="text-green-400">
                Y: {(position?.y ?? 0).toFixed(2)}°
              </span>
              <span className="text-blue-400">
                Z: {(position?.z ?? 0).toFixed(2)}°
              </span>
            </div>
          ) : config.type === 'robot_arm' ? (
            <div className="flex items-center gap-3 font-mono">
              <span className="text-red-400">
                X: {(position?.x ?? 0).toFixed(2)}°
              </span>
              <span className="text-green-400">
                Y: {(position?.y ?? 0).toFixed(2)}°
              </span>
              <span className="text-blue-400">
                Z: {(position?.z ?? 0).toFixed(2)}°
              </span>
              {/* Gripper állapot */}
              {status?.gripper_state && (
                <span className={`flex items-center gap-1 ${status.gripper_state === 'closed' ? 'text-red-400' : 'text-green-400'}`}>
                  <GripVertical className="w-3 h-3" />
                  {status.gripper_state === 'closed'
                    ? t('panel.gripper_closed')
                    : status.gripper_state === 'open'
                      ? t('panel.gripper_open')
                      : t('panel.gripper_unknown')}
                </span>
              )}
              {/* Szívó állapot */}
              {status?.sucker_state !== undefined && (
                <span className={`flex items-center gap-1 ${status.sucker_state ? 'text-cyan-400' : 'text-steel-500'}`}>
                  <Wind className="w-3 h-3" />
                  {status.sucker_state ? t('panel.sucker_on') : t('panel.sucker_off')}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 font-mono">
              <span className="text-red-400">
                X: {(position?.x ?? 0).toFixed(3)}
              </span>
              <span className="text-green-400">
                Y: {(position?.y ?? 0).toFixed(3)}
              </span>
              <span className="text-blue-400">
                Z: {(position?.z ?? 0).toFixed(3)}
              </span>
              {position?.a !== undefined && (
                <span className="text-amber-400">
                  A: {position.a.toFixed(2)}°
                </span>
              )}
              {position?.b !== undefined && (
                <span className="text-purple-400">
                  B: {position.b.toFixed(2)}°
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4 text-steel-400">
          {/* Feed rate */}
          {status && (
            <span>F: {status.feed_rate?.toFixed(0) ?? 0} mm/min</span>
          )}
          
          {/* Spindle */}
          {status && status.spindle_speed > 0 && (
            <span>S: {status.spindle_speed.toFixed(0)} RPM</span>
          )}
          
          {/* Connection indicator */}
          {!status && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertCircle className="w-3 h-3" />
              {t('panel.no_connection')}
            </span>
          )}
          
          {/* State indicator */}
          {status && (
            <span className={`
              px-2 py-0.5 rounded text-xs font-medium
              ${status.state === 'running' ? 'bg-blue-500/20 text-blue-400' : ''}
              ${status.state === 'idle' ? 'bg-green-500/20 text-green-400' : ''}
              ${status.state === 'paused' ? 'bg-amber-500/20 text-amber-400' : ''}
              ${status.state === 'alarm' ? 'bg-red-500/20 text-red-400' : ''}
              ${status.state === 'disconnected' ? 'bg-gray-500/20 text-gray-400' : ''}
              ${status.state === 'homing' ? 'bg-cyan-500/20 text-cyan-400' : ''}
              ${status.state === 'jog' ? 'bg-purple-500/20 text-purple-400' : ''}
            `}>
              {status.state?.toUpperCase() ?? 'UNKNOWN'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
