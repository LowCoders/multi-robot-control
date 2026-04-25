/**
 * Egységesített komponens-szerkesztő panel a V2 csőhajlító modellhez.
 *
 * Összevonja a régi `TransformEditPanel` (pozíció / forgatás) és
 * `VisualPropsEditPanel` (szín / anyag / skála / láthatóság / meta)
 * panelek funkcionalitását egyetlen overlay-be, fülezett (tab) layouttal.
 *
 * # Tab-ok
 *
 *   - Position  (Move3D):     pos X/Y/Z + rot X/Y/Z (mm + °)
 *   - Sizes     (Ruler):      bbox X/Y/Z méretek mm-ben (scale override-on keresztül)
 *   - Color     (Palette):    color picker (per-color-scheme!)
 *   - Material  (Sparkles):   opacity, metalness, roughness (per-color-scheme!)
 *   - Scale     (Maximize2):  scale X/Y/Z + uniform-step preset
 *   - Other     (Info):       hidden toggle + name override + num override
 *
 * # Per-color-scheme override (Color + Material tab)
 *
 * A material-jellegű mezőket (color/opacity/metalness/roughness) a store
 * a `schemes.<colorMode>` map-ben tárolja — lásd `visualPropsStore.ts`.
 * A panel az AKTÍV `useHighlightStore.colorMode`-hoz tartozó scheme-et
 * mutatja és módosítja, így pl. PBR módban más színt rendelhetsz egy
 * alkatrészhez, mint Registry módban, és a két "paletta" függetlenül
 * perzisztálódik. A tab fejlécében egy kis badge jelzi, melyik scheme-et
 * szerkeszted éppen.
 *
 * # Edit-mode
 *
 * Két háttér-store vezérli (`transformOverrideStore.editMode` ÉS
 * `visualPropsStore.editMode`) — a `Pencil` toolbar-gomb mindkettőt egyszerre
 * kapcsolja. A panel akkor látszik, ha LEGALÁBB AZ EGYIK aktív és van
 * kijelölt node. Az X gomb mindkettőt lekapcsolja. (A kijelölést NEM
 * töröljük, hogy a táblázat-highlight és a 3D-kontextus megmaradjon.)
 *
 * # Undo / redo
 *
 * Minden numerikus commit egy `pushHistory()`-t hív a megfelelő store-ban,
 * így a globális Ctrl+Z visszafordítja. A SliderRow folyamatos onChange-t
 * használ ⇒ egy slider-húzás N undo-lépést generál; ezt az egyszerűbb
 * UX érdekében elfogadjuk (finomhangolás visszafele is lépésenként).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Eye,
  EyeOff,
  Info,
  Maximize2,
  Move3D,
  Palette,
  RotateCw,
  Ruler,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { getRegistryNode } from './componentRegistry'
import { isComponent } from './types'
import { resolveTransform, type TransformOverride } from './transformResolver'
import { useTransformOverrideStore } from './transformOverrideStore'
import {
  useVisualPropsStore,
  type SchemePatch,
  type VisualPropsPatch,
} from './visualPropsStore'
import { useHighlightStore } from './highlightStore'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

const POS_STEPS = [0.1, 1, 5, 10] as const
const ROT_STEPS = [0.1, 1, 5, 15, 45, 90] as const
const SIZE_STEPS = [0.1, 1, 5, 10] as const
const SCALE_STEPS = [0.1, 0.5, 1, 2] as const

type TabId = 'position' | 'sizes' | 'color' | 'material' | 'scale' | 'other'

interface Props {
  className?: string
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.parseFloat(n.toFixed(4)).toString()
}

function normalizeHex(s: string | undefined, fallback: string): string {
  if (!s) return fallback
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s.trim())
  if (!m) return fallback
  if (s.length === 4) {
    const r = s[1]!
    const g = s[2]!
    const b = s[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return s
}

export default function CombinedEditPanel({ className = '' }: Props) {
  const { t } = useTranslation('visualization')

  // === Store-szelektorok ===
  const transformEditMode = useTransformOverrideStore((s) => s.editMode)
  const setTransformEditMode = useTransformOverrideStore((s) => s.setEditMode)
  const transformDrafts = useTransformOverrideStore((s) => s.drafts)
  const transformBaseline = useTransformOverrideStore((s) => s.baseline)
  const setTransformDraft = useTransformOverrideStore((s) => s.setDraft)
  const clearTransformOverride = useTransformOverrideStore((s) => s.clearOverride)
  const pushTransformHistory = useTransformOverrideStore((s) => s.pushHistory)

  const visualEditMode = useVisualPropsStore((s) => s.editMode)
  const setVisualEditMode = useVisualPropsStore((s) => s.setEditMode)
  const visualDrafts = useVisualPropsStore((s) => s.drafts)
  const visualBaseline = useVisualPropsStore((s) => s.baseline)
  const patchVisualDraft = useVisualPropsStore((s) => s.patchDraft)
  const patchSchemeDraft = useVisualPropsStore((s) => s.patchSchemeDraft)
  const clearVisualOverride = useVisualPropsStore((s) => s.clearOverride)
  const pushVisualHistory = useVisualPropsStore((s) => s.pushHistory)

  const selectedId = useHighlightStore((s) => s.selectedId)
  const selectedIdsCount = useHighlightStore((s) => s.selectedIds.length)
  const colorMode = useHighlightStore((s) => s.colorMode)

  // === Lokális UI állapot ===
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'position'
    const v = window.localStorage.getItem('mrc-v2-edit-panel-tab')
    if (
      v === 'position' ||
      v === 'sizes' ||
      v === 'color' ||
      v === 'material' ||
      v === 'scale' ||
      v === 'other'
    ) {
      return v
    }
    return 'position'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem('mrc-v2-edit-panel-tab', activeTab)
    } catch {
      // ignore
    }
  }, [activeTab])

  const [posStep, setPosStep] = usePersistentNumber('mrc-v2-edit-pos-step', 1)
  const [rotStep, setRotStep] = usePersistentNumber('mrc-v2-edit-rot-step', 5)
  const [sizeStep, setSizeStep] = usePersistentNumber('mrc-v2-edit-size-step', 1)

  // === Számolt értékek ===
  const node = useMemo(
    () => (selectedId ? getRegistryNode(selectedId) : undefined),
    [selectedId],
  )

  const transformOverride = selectedId
    ? transformDrafts[selectedId] ?? transformBaseline[selectedId]
    : undefined
  const visualOverride = selectedId
    ? visualDrafts[selectedId] ?? visualBaseline[selectedId]
    : undefined

  const effectiveTransform = useMemo(() => {
    if (!node) return null
    const getOv = (id: string): TransformOverride | undefined =>
      transformDrafts[id] ?? transformBaseline[id]
    return resolveTransform(node, getRegistryNode, getOv)
  }, [node, transformDrafts, transformBaseline])

  const hasTransformOverride = !!transformOverride
  const hasVisualOverride = !!visualOverride
  const hasAnyOverride = hasTransformOverride || hasVisualOverride

  // === Korai kilépés: a panel csak edit mode + selection esetén látszik ===
  const isAnyEditModeActive = transformEditMode || visualEditMode
  if (!isAnyEditModeActive || !selectedId || !node || !effectiveTransform) {
    return null
  }

  const isComp = isComponent(node)
  const displayName =
    visualOverride?.displayName || node.nameEn || node.nameHu || node.id
  const bboxSize = isComp ? node.bbox?.size : undefined
  const currentScale: [number, number, number] = visualOverride?.scale ?? [1, 1, 1]
  const effectiveSize = bboxSize
    ? ([
        bboxSize[0] * currentScale[0],
        bboxSize[1] * currentScale[1],
        bboxSize[2] * currentScale[2],
      ] as [number, number, number])
    : undefined

  // === Action wrapperek ===

  const writeAbsoluteTransform = (
    kind: 'pos' | 'rot',
    axis: 0 | 1 | 2,
    valueRadOrMm: number,
  ) => {
    if (!effectiveTransform) return
    pushTransformHistory()
    const next: TransformOverride = {
      position: [...effectiveTransform.position] as [number, number, number],
      rotation: [...effectiveTransform.rotation] as [number, number, number],
    }
    if (kind === 'pos') next.position[axis] = valueRadOrMm
    else next.rotation[axis] = valueRadOrMm
    setTransformDraft(selectedId, next)
  }

  const stepTransformBy = (
    kind: 'pos' | 'rot',
    axis: 0 | 1 | 2,
    sign: 1 | -1,
  ) => {
    if (!effectiveTransform) return
    if (kind === 'pos') {
      writeAbsoluteTransform('pos', axis, effectiveTransform.position[axis] + sign * posStep)
    } else {
      const curDeg = effectiveTransform.rotation[axis] * RAD2DEG
      writeAbsoluteTransform('rot', axis, (curDeg + sign * rotStep) * DEG2RAD)
    }
  }

  /** Top-level (mode-független) visual mezők patch-elése. */
  const applyVisualPatch = (patch: VisualPropsPatch) => {
    pushVisualHistory()
    patchVisualDraft(selectedId, patch)
  }

  /** Per-color-scheme material patch (color / opacity / metalness / roughness). */
  const applySchemePatch = (patch: SchemePatch) => {
    pushVisualHistory()
    patchSchemeDraft(selectedId, colorMode, patch)
  }

  /** "Reset all" — az aktuális id-n minden override-ot töröl mindkét store-ban. */
  const resetAll = () => {
    if (hasTransformOverride) {
      pushTransformHistory()
      clearTransformOverride(selectedId)
    }
    if (hasVisualOverride) {
      pushVisualHistory()
      clearVisualOverride(selectedId)
    }
  }

  const closePanel = () => {
    setTransformEditMode(false)
    setVisualEditMode(false)
  }

  // === Render ===

  return (
    <div
      className={`pointer-events-auto bg-steel-900/95 backdrop-blur border border-steel-700 rounded shadow-lg text-xs text-steel-200 w-72 ${className}`}
    >
      {/* === Fejléc === */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-steel-700 bg-steel-800/70">
        <Move3D className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-steel-100 truncate" title={`${displayName} (${node.id})`}>
            {displayName}
          </div>
          <div className="text-[10px] text-steel-500 truncate">
            <span className="font-mono">{node.id}</span>
            {isComp && typeof node.num === 'number' && (
              <span className="font-mono text-steel-600"> #{node.num}</span>
            )}
          </div>
        </div>
        {selectedIdsCount > 1 && (
          <span
            title={t('panel.multiselect_count', { count: selectedIdsCount })}
            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/40 font-mono shrink-0"
          >
            +{selectedIdsCount - 1}
          </span>
        )}
        {hasAnyOverride && (
          <button
            type="button"
            onClick={resetAll}
            title={t('combined_edit.reset_all_tooltip', {
              defaultValue: 'Reset all overrides on this part',
            })}
            className="p-0.5 rounded hover:bg-steel-700 text-steel-400 hover:text-amber-400"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={closePanel}
          title={t('combined_edit.close_tooltip', {
            defaultValue: 'Close edit panel (deselects edit mode)',
          })}
          className="p-0.5 rounded hover:bg-steel-700 text-steel-400 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* === Tab bar === */}
      <div
        className="flex items-stretch border-b border-steel-700 bg-steel-900/60"
        role="tablist"
      >
        <TabButton
          icon={<Move3D className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_position', { defaultValue: 'Position' })}
          active={activeTab === 'position'}
          onClick={() => setActiveTab('position')}
        />
        <TabButton
          icon={<Ruler className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_sizes', { defaultValue: 'Sizes' })}
          active={activeTab === 'sizes'}
          disabled={!effectiveSize || !bboxSize}
          disabledTitle={t('combined_edit.sizes_no_bbox_hint', {
            defaultValue: 'Sizes require a component bounding box',
          })}
          onClick={() => setActiveTab('sizes')}
        />
        <TabButton
          icon={<Palette className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_color', { defaultValue: 'Color' })}
          active={activeTab === 'color'}
          disabled={!isComp}
          disabledTitle={t('combined_edit.color_assembly_hint', {
            defaultValue: 'Color is per-component (assemblies have no material)',
          })}
          onClick={() => setActiveTab('color')}
        />
        <TabButton
          icon={<Sparkles className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_material', { defaultValue: 'Material' })}
          active={activeTab === 'material'}
          disabled={!isComp}
          disabledTitle={t('combined_edit.color_assembly_hint', {
            defaultValue: 'Material is per-component (assemblies have no material)',
          })}
          onClick={() => setActiveTab('material')}
        />
        <TabButton
          icon={<Maximize2 className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_scale', { defaultValue: 'Scale' })}
          active={activeTab === 'scale'}
          onClick={() => setActiveTab('scale')}
        />
        <TabButton
          icon={<Info className="w-3.5 h-3.5" />}
          label={t('combined_edit.tab_other', { defaultValue: 'Other' })}
          active={activeTab === 'other'}
          onClick={() => setActiveTab('other')}
        />
      </div>

      {/* === Tab content === */}
      <div className="max-h-[60vh] overflow-y-auto">
        {activeTab === 'position' && (
          <PositionTab
            effective={effectiveTransform}
            posStep={posStep}
            rotStep={rotStep}
            setPosStep={setPosStep}
            setRotStep={setRotStep}
            onWriteAbsolute={writeAbsoluteTransform}
            onStep={stepTransformBy}
          />
        )}

        {activeTab === 'sizes' && effectiveSize && bboxSize && (
          <SizesTab
            baseSize={bboxSize}
            effectiveSize={effectiveSize}
            scale={visualOverride?.scale}
            sizeStep={sizeStep}
            setSizeStep={setSizeStep}
            onApply={applyVisualPatch}
          />
        )}

        {activeTab === 'color' && isComp && (
          <ColorTab
            colorMode={colorMode}
            schemeProps={visualOverride?.schemes?.[colorMode]}
            defaultColor={node.color}
            onApply={applySchemePatch}
          />
        )}

        {activeTab === 'material' && isComp && (
          <MaterialTab
            colorMode={colorMode}
            schemeProps={visualOverride?.schemes?.[colorMode]}
            onApply={applySchemePatch}
          />
        )}

        {activeTab === 'scale' && (
          <ScaleTab
            scale={visualOverride?.scale}
            onApply={applyVisualPatch}
          />
        )}

        {activeTab === 'other' && (
          <OtherTab
            visualOverride={visualOverride}
            defaultName={node.nameEn || node.nameHu || ''}
            defaultNum={isComp && typeof node.num === 'number' ? String(node.num) : ''}
            onApply={applyVisualPatch}
          />
        )}
      </div>

      {/* === Lábléc — globális hint === */}
      <div className="px-2 py-1 text-[10px] text-steel-500 border-t border-steel-700 leading-snug">
        {activeTab === 'position'
          ? t('transform_edit.hint')
          : t('visual_props.hint')}
      </div>
    </div>
  )
}

// =============================================================================
// Tab gombok
// =============================================================================

interface TabButtonProps {
  icon: React.ReactNode
  label: string
  active: boolean
  disabled?: boolean
  disabledTitle?: string
  onClick: () => void
}
function TabButton({ icon, label, active, disabled, disabledTitle, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled && disabledTitle ? disabledTitle : label}
      className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 px-1 py-1.5 text-[10px] leading-none transition-colors border-b-2 ${
        active
          ? 'border-blue-400 text-blue-300 bg-steel-800/40'
          : disabled
            ? 'border-transparent text-steel-600 cursor-not-allowed'
            : 'border-transparent text-steel-400 hover:text-steel-100 hover:bg-steel-800/40'
      }`}
    >
      {icon}
      <span className="truncate w-full text-center">{label}</span>
    </button>
  )
}

// =============================================================================
// Tab: Position
// =============================================================================

interface PositionTabProps {
  effective: { position: [number, number, number]; rotation: [number, number, number] }
  posStep: number
  rotStep: number
  setPosStep: (v: number) => void
  setRotStep: (v: number) => void
  onWriteAbsolute: (kind: 'pos' | 'rot', axis: 0 | 1 | 2, value: number) => void
  onStep: (kind: 'pos' | 'rot', axis: 0 | 1 | 2, sign: 1 | -1) => void
}
function PositionTab({
  effective,
  posStep,
  rotStep,
  setPosStep,
  setRotStep,
  onWriteAbsolute,
  onStep,
}: PositionTabProps) {
  const { t } = useTranslation('visualization')
  return (
    <>
      <Section
        title={t('transform_edit.position_title')}
        icon={<Move3D className="w-3 h-3" />}
        steps={POS_STEPS}
        currentStep={posStep}
        onStepChange={setPosStep}
        unitLabel={t('transform_edit.unit_mm')}
      >
        {(['X', 'Y', 'Z'] as const).map((label, i) => (
          <AxisRow
            key={`pos-${label}`}
            label={label}
            displayValue={fmt(effective.position[i as 0 | 1 | 2])}
            onAbsolute={(v) => onWriteAbsolute('pos', i as 0 | 1 | 2, v)}
            onStep={(sign) => onStep('pos', i as 0 | 1 | 2, sign)}
            step={posStep}
            tDelta={t('transform_edit.delta_tooltip', {
              axis: label,
              step: posStep,
              unit: t('transform_edit.unit_mm'),
            })}
          />
        ))}
      </Section>

      <Section
        title={t('transform_edit.rotation_title')}
        icon={<RotateCw className="w-3 h-3" />}
        steps={ROT_STEPS}
        currentStep={rotStep}
        onStepChange={setRotStep}
        unitLabel={t('transform_edit.unit_deg')}
      >
        {(['X', 'Y', 'Z'] as const).map((label, i) => {
          const valDeg = effective.rotation[i as 0 | 1 | 2] * RAD2DEG
          return (
            <AxisRow
              key={`rot-${label}`}
              label={label}
              displayValue={fmt(valDeg)}
              onAbsolute={(v) => onWriteAbsolute('rot', i as 0 | 1 | 2, v * DEG2RAD)}
              onStep={(sign) => onStep('rot', i as 0 | 1 | 2, sign)}
              step={rotStep}
              tDelta={t('transform_edit.delta_tooltip', {
                axis: label,
                step: rotStep,
                unit: t('transform_edit.unit_deg'),
              })}
            />
          )
        })}
      </Section>
    </>
  )
}

// =============================================================================
// Tab: Sizes
// =============================================================================

interface SizesTabProps {
  baseSize: [number, number, number]
  effectiveSize: [number, number, number]
  scale: [number, number, number] | undefined
  sizeStep: number
  setSizeStep: (s: number) => void
  onApply: (patch: VisualPropsPatch) => void
}
function SizesTab({
  baseSize,
  effectiveSize,
  scale,
  sizeStep,
  setSizeStep,
  onApply,
}: SizesTabProps) {
  const { t } = useTranslation('visualization')
  const curScale: [number, number, number] = scale ?? [1, 1, 1]
  const commitSize = (idx: 0 | 1 | 2, sizeMm: number) => {
    const base = baseSize[idx]
    if (base <= 0) return
    const next: [number, number, number] = [...curScale]
    next[idx] = sizeMm / base
    onApply({ scale: next })
  }
  return (
    <div className="px-2 py-2 space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-steel-400">
          {t('combined_edit.sizes_title', { defaultValue: 'Sizes' })}
        </span>
        <div className="flex items-center gap-0.5">
          {SIZE_STEPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSizeStep(s)}
              className={`px-1 py-0.5 rounded text-[10px] leading-none border ${
                sizeStep === s
                  ? 'bg-blue-500/20 border-blue-400/50 text-blue-200'
                  : 'border-transparent text-steel-500 hover:text-steel-200 hover:bg-steel-800'
              }`}
              title={t('combined_edit.size_step_tooltip', {
                step: s,
                defaultValue: `Set size step to ${s} mm`,
              })}
            >
              {s}
            </button>
          ))}
          <span className="pl-1 text-[10px] text-steel-500">
            {t('transform_edit.unit_mm')}
          </span>
        </div>
      </div>
      {(['X', 'Y', 'Z'] as const).map((label, i) => {
        const idx = i as 0 | 1 | 2
        return (
          <SizeAxisRow
            key={`size-${label}`}
            label={label}
            displayValue={fmt(effectiveSize[idx])}
            step={sizeStep}
            onStep={(sign) => commitSize(idx, Math.max(0.001, effectiveSize[idx] + sign * sizeStep))}
            onCommit={(sizeMm) => commitSize(idx, sizeMm)}
          />
        )
      })}
      <p className="text-[10px] text-steel-500 leading-snug">
        {t('combined_edit.sizes_scale_hint', {
          defaultValue:
            'Sizes are stored as scale overrides relative to the registry bounding box.',
        })}
      </p>
      {scale !== undefined && (
        <button
          type="button"
          onClick={() => onApply({ scale: undefined })}
          className="text-[10px] text-amber-400 hover:text-amber-300 underline w-full text-center mt-1"
        >
          {t('visual_props.field_reset_tooltip', {
            defaultValue: 'Reset to default',
          })}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// Tab: Color (per-color-scheme!)
// =============================================================================

interface ColorTabProps {
  colorMode: 'pbr' | 'registry'
  schemeProps: { color?: string } | undefined
  defaultColor: string
  onApply: (patch: SchemePatch) => void
}
function ColorTab({ colorMode, schemeProps, defaultColor, onApply }: ColorTabProps) {
  const { t } = useTranslation('visualization')
  const curColor = normalizeHex(schemeProps?.color, defaultColor)
  const isDirty = schemeProps?.color !== undefined
  return (
    <div className="px-2 py-2 space-y-2">
      <SchemeBadge mode={colorMode} />
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={curColor}
          onChange={(e) => onApply({ color: e.currentTarget.value })}
          className="w-10 h-8 rounded border border-steel-700 bg-steel-950 cursor-pointer p-0"
          aria-label={t('visual_props.color_picker_aria')}
        />
        <input
          key={`hex-${colorMode}-${curColor}`}
          type="text"
          defaultValue={curColor}
          placeholder="#rrggbb"
          onBlur={(e) => {
            const norm = normalizeHex(e.currentTarget.value, curColor)
            if (norm !== curColor) onApply({ color: norm })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const norm = normalizeHex(e.currentTarget.value, curColor)
              if (norm !== curColor) onApply({ color: norm })
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.value = curColor
              e.currentTarget.blur()
            }
          }}
          className="flex-1 min-w-0 bg-steel-950 border border-steel-700 rounded px-1.5 py-1 font-mono text-steel-100 focus:border-blue-500 focus:outline-none"
        />
        {isDirty && (
          <button
            type="button"
            onClick={() => onApply({ color: undefined })}
            title={t('visual_props.field_reset_tooltip', {
              defaultValue: 'Reset to default',
            })}
            className="p-1 rounded hover:bg-steel-700 text-steel-400 hover:text-amber-400 shrink-0"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-[10px] text-steel-500 leading-snug">
        {t('combined_edit.scheme_hint', {
          defaultValue:
            'The color is stored per scheme (PBR / Registry). Toggle the color mode in the toolbar to edit the other palette.',
        })}
      </p>
    </div>
  )
}

// =============================================================================
// Tab: Material (per-color-scheme!)
// =============================================================================

interface MaterialTabProps {
  colorMode: 'pbr' | 'registry'
  schemeProps: { opacity?: number; metalness?: number; roughness?: number } | undefined
  onApply: (patch: SchemePatch) => void
}
function MaterialTab({ colorMode, schemeProps, onApply }: MaterialTabProps) {
  const { t } = useTranslation('visualization')
  const curOpacity = schemeProps?.opacity ?? 1
  const curMetalness = schemeProps?.metalness ?? 0.4
  const curRoughness = schemeProps?.roughness ?? 0.5
  return (
    <div className="px-2 py-2 space-y-2">
      <SchemeBadge mode={colorMode} />
      <SliderRow
        label={t('visual_props.opacity')}
        value={curOpacity}
        min={0}
        max={1}
        step={0.05}
        onCommit={(v) => onApply({ opacity: v })}
        isDirty={schemeProps?.opacity !== undefined}
        onReset={() => onApply({ opacity: undefined })}
      />
      <SliderRow
        label={t('visual_props.metalness')}
        value={curMetalness}
        min={0}
        max={1}
        step={0.05}
        onCommit={(v) => onApply({ metalness: v })}
        isDirty={schemeProps?.metalness !== undefined}
        onReset={() => onApply({ metalness: undefined })}
      />
      <SliderRow
        label={t('visual_props.roughness')}
        value={curRoughness}
        min={0}
        max={1}
        step={0.05}
        onCommit={(v) => onApply({ roughness: v })}
        isDirty={schemeProps?.roughness !== undefined}
        onReset={() => onApply({ roughness: undefined })}
      />
    </div>
  )
}

// =============================================================================
// Tab: Scale
// =============================================================================

interface ScaleTabProps {
  scale: [number, number, number] | undefined
  onApply: (patch: VisualPropsPatch) => void
}
function ScaleTab({ scale, onApply }: ScaleTabProps) {
  const { t } = useTranslation('visualization')
  const cur: [number, number, number] = scale ?? [1, 1, 1]
  return (
    <div className="px-2 py-2 space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-steel-400">
          {t('visual_props.scale_title')}
        </span>
        <div className="flex items-center gap-0.5">
          {SCALE_STEPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onApply({ scale: [s, s, s] })}
              className="px-1 py-0.5 rounded text-[10px] leading-none border border-transparent text-steel-500 hover:text-steel-200 hover:bg-steel-800"
              title={t('visual_props.scale_preset_tooltip', {
                value: s,
                defaultValue: `Set scale to ${s}× (uniform)`,
              })}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      {(['X', 'Y', 'Z'] as const).map((label, i) => {
        const idx = i as 0 | 1 | 2
        const v = cur[idx]
        return (
          <ScaleAxisRow
            key={`scale-${label}`}
            label={label}
            displayValue={fmt(v)}
            onCommit={(nv) => {
              const next: [number, number, number] = [...cur]
              next[idx] = nv
              onApply({ scale: next })
            }}
          />
        )
      })}
      {scale !== undefined && (
        <button
          type="button"
          onClick={() => onApply({ scale: undefined })}
          className="text-[10px] text-amber-400 hover:text-amber-300 underline w-full text-center mt-1"
        >
          {t('visual_props.field_reset_tooltip', {
            defaultValue: 'Reset to default',
          })}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// Tab: Other (visibility + meta)
// =============================================================================

interface OtherTabProps {
  visualOverride:
    | { hidden?: boolean; displayName?: string; num?: string }
    | undefined
  defaultName: string
  defaultNum: string
  onApply: (patch: VisualPropsPatch) => void
}
function OtherTab({ visualOverride, defaultName, defaultNum, onApply }: OtherTabProps) {
  const { t } = useTranslation('visualization')
  const curHidden = visualOverride?.hidden ?? false
  const curName = visualOverride?.displayName ?? defaultName
  const curNum = visualOverride?.num ?? defaultNum
  return (
    <div className="px-2 py-2 space-y-2">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel-400 mb-1">
          {t('visual_props.visibility_title')}
        </div>
        <button
          type="button"
          onClick={() => onApply({ hidden: !curHidden })}
          className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded border ${
            curHidden
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              : 'bg-steel-800 border-steel-700 text-steel-200 hover:bg-steel-700'
          }`}
        >
          {curHidden ? (
            <>
              <EyeOff className="w-3.5 h-3.5" />
              {t('visual_props.hidden_state')}
            </>
          ) : (
            <>
              <Eye className="w-3.5 h-3.5" />
              {t('visual_props.visible_state')}
            </>
          )}
        </button>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel-400 mb-1">
          {t('visual_props.meta_title')}
        </div>
        <div className="space-y-1.5">
          <LabeledInput
            label={t('visual_props.name')}
            value={curName}
            placeholder={defaultName}
            onCommit={(v) =>
              onApply({ displayName: v.trim() === '' ? undefined : v })
            }
          />
          <LabeledInput
            label={t('visual_props.num')}
            value={curNum}
            placeholder={defaultNum || '—'}
            onCommit={(v) => onApply({ num: v.trim() === '' ? undefined : v })}
            monospace
          />
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Belső UI komponensek
// =============================================================================

function SchemeBadge({ mode }: { mode: 'pbr' | 'registry' }) {
  const { t } = useTranslation('visualization')
  const label =
    mode === 'pbr'
      ? t('combined_edit.scheme_pbr', { defaultValue: 'PBR (mesh material)' })
      : t('combined_edit.scheme_registry', { defaultValue: 'Registry palette' })
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-steel-500 uppercase tracking-wide">
        {t('combined_edit.scheme_label', { defaultValue: 'Scheme' })}
      </span>
      <span
        className={`px-1.5 py-0.5 rounded font-mono border ${
          mode === 'pbr'
            ? 'bg-purple-500/15 border-purple-400/40 text-purple-300'
            : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
        }`}
        title={t('combined_edit.scheme_tooltip', {
          defaultValue:
            'Color & material edits go into this scheme; the other scheme keeps its own palette.',
        })}
      >
        {label}
      </span>
    </div>
  )
}

interface SectionProps {
  title: string
  icon: React.ReactNode
  steps: readonly number[]
  currentStep: number
  onStepChange: (s: number) => void
  unitLabel: string
  children: React.ReactNode
}
function Section({
  title,
  icon,
  steps,
  currentStep,
  onStepChange,
  unitLabel,
  children,
}: SectionProps) {
  return (
    <div className="px-2 py-2 border-b border-steel-800 last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel-400">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-0.5">
          {steps.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStepChange(s)}
              className={`px-1 py-0.5 rounded text-[10px] leading-none border ${
                currentStep === s
                  ? 'bg-blue-500/20 border-blue-400/50 text-blue-300'
                  : 'border-transparent text-steel-500 hover:text-steel-200 hover:bg-steel-800'
              }`}
              title={`${s} ${unitLabel}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

interface AxisRowProps {
  label: string
  displayValue: string
  onAbsolute: (v: number) => void
  onStep: (sign: 1 | -1) => void
  step: number
  tDelta: string
}
function AxisRow({ label, displayValue, onAbsolute, onStep, step, tDelta }: AxisRowProps) {
  return (
    <div className="flex items-center gap-1">
      <span
        className={`w-3 text-center font-mono font-semibold text-[11px] ${
          label === 'X'
            ? 'text-red-400'
            : label === 'Y'
              ? 'text-green-400'
              : 'text-blue-400'
        }`}
      >
        {label}
      </span>
      <input
        key={displayValue}
        type="number"
        defaultValue={displayValue}
        step={step}
        onBlur={(e) => {
          const v = Number.parseFloat(e.currentTarget.value)
          if (Number.isFinite(v)) onAbsolute(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = Number.parseFloat(e.currentTarget.value)
            if (Number.isFinite(v)) onAbsolute(v)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = displayValue
            e.currentTarget.blur()
          }
        }}
        className="flex-1 min-w-0 bg-steel-950 border border-steel-700 rounded px-1.5 py-0.5 font-mono text-right text-steel-100 focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onStep(-1)}
        title={tDelta}
        className="px-1.5 py-0.5 rounded border border-steel-700 bg-steel-800 hover:bg-steel-700 text-steel-200 leading-none font-mono"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        title={tDelta}
        className="px-1.5 py-0.5 rounded border border-steel-700 bg-steel-800 hover:bg-steel-700 text-steel-200 leading-none font-mono"
      >
        +
      </button>
    </div>
  )
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (v: number) => void
  isDirty: boolean
  onReset: () => void
}
function SliderRow({ label, value, min, max, step, onCommit, isDirty, onReset }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[10px] uppercase tracking-wide text-steel-500 shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number.parseFloat(e.currentTarget.value)
          if (Number.isFinite(v)) onCommit(v)
        }}
        className="flex-1 min-w-0 accent-blue-500"
      />
      <span className="w-10 text-right font-mono text-[10px] text-steel-300">
        {value.toFixed(2)}
      </span>
      {isDirty && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to default"
          className="p-0.5 rounded hover:bg-steel-700 text-steel-400 hover:text-amber-400 shrink-0"
        >
          <Undo2 className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

interface LabeledInputProps {
  label: string
  value: string
  placeholder?: string
  monospace?: boolean
  onCommit: (v: string) => void
}
function LabeledInput({ label, value, placeholder, monospace, onCommit }: LabeledInputProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[10px] uppercase tracking-wide text-steel-500 shrink-0">
        {label}
      </span>
      <input
        key={`lbl-${value}`}
        type="text"
        defaultValue={value}
        placeholder={placeholder ?? ''}
        onBlur={(e) => {
          if (e.currentTarget.value !== value) onCommit(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.currentTarget.value !== value) onCommit(e.currentTarget.value)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = value
            e.currentTarget.blur()
          }
        }}
        className={`flex-1 min-w-0 bg-steel-950 border border-steel-700 rounded px-1.5 py-1 text-steel-100 focus:border-blue-500 focus:outline-none ${
          monospace ? 'font-mono' : ''
        }`}
      />
    </div>
  )
}

interface ScaleAxisRowProps {
  label: string
  displayValue: string
  onCommit: (v: number) => void
}
function ScaleAxisRow({ label, displayValue, onCommit }: ScaleAxisRowProps) {
  return (
    <div className="flex items-center gap-1">
      <span
        className={`w-3 text-center font-mono font-semibold text-[11px] ${
          label === 'X'
            ? 'text-red-400'
            : label === 'Y'
              ? 'text-green-400'
              : 'text-blue-400'
        }`}
      >
        {label}
      </span>
      <input
        key={`scl-${displayValue}`}
        type="number"
        defaultValue={displayValue}
        step={0.1}
        min={0.001}
        onBlur={(e) => {
          const v = Number.parseFloat(e.currentTarget.value)
          if (Number.isFinite(v) && v > 0) onCommit(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = Number.parseFloat(e.currentTarget.value)
            if (Number.isFinite(v) && v > 0) onCommit(v)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = displayValue
            e.currentTarget.blur()
          }
        }}
        className="flex-1 min-w-0 bg-steel-950 border border-steel-700 rounded px-1.5 py-0.5 font-mono text-right text-steel-100 focus:border-blue-500 focus:outline-none"
      />
    </div>
  )
}

interface SizeAxisRowProps {
  label: string
  displayValue: string
  step: number
  onStep: (sign: 1 | -1) => void
  onCommit: (v: number) => void
}
function SizeAxisRow({ label, displayValue, step, onStep, onCommit }: SizeAxisRowProps) {
  const { t } = useTranslation('visualization')
  return (
    <div className="flex items-center gap-1">
      <span
        className={`w-3 text-center font-mono font-semibold text-[11px] ${
          label === 'X'
            ? 'text-red-400'
            : label === 'Y'
              ? 'text-green-400'
              : 'text-blue-400'
        }`}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => onStep(-1)}
        title={t('transform_edit.delta_tooltip', {
          axis: label,
          step,
          unit: t('transform_edit.unit_mm'),
        })}
        className="w-5 h-5 rounded bg-steel-800 hover:bg-steel-700 text-steel-300 hover:text-white border border-steel-700"
      >
        −
      </button>
      <input
        key={`size-${displayValue}`}
        type="number"
        defaultValue={displayValue}
        step={step}
        min={0.001}
        onBlur={(e) => {
          const v = Number.parseFloat(e.currentTarget.value)
          if (Number.isFinite(v) && v > 0) onCommit(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = Number.parseFloat(e.currentTarget.value)
            if (Number.isFinite(v) && v > 0) onCommit(v)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = displayValue
            e.currentTarget.blur()
          }
        }}
        className="flex-1 min-w-0 bg-steel-950 border border-steel-700 rounded px-1.5 py-0.5 font-mono text-right text-steel-100 focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onStep(1)}
        title={t('transform_edit.delta_tooltip', {
          axis: label,
          step,
          unit: t('transform_edit.unit_mm'),
        })}
        className="w-5 h-5 rounded bg-steel-800 hover:bg-steel-700 text-steel-300 hover:text-white border border-steel-700"
      >
        +
      </button>
      <span className="w-7 text-[10px] text-steel-500">
        {t('transform_edit.unit_mm')}
      </span>
    </div>
  )
}

// =============================================================================
// Helper hook
// =============================================================================

/** localStorage-perzisztált number — a step-preset választások a session-ön
 * túl is megmaradnak. SSR-safe és csendes-fail. */
function usePersistentNumber(
  key: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const [value, setValue] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return defaultValue
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) ? n : defaultValue
    } catch {
      return defaultValue
    }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, String(value))
    } catch {
      // ignore
    }
  }, [key, value])
  // useCallback nélkül is OK: a `setValue` referencia stabil React-en belül.
  return [value, setValue]
}
