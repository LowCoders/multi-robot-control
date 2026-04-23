/**
 * Komponens-táblázat panel a V2 csőhajlító modellhez.
 *
 * # Funkciók
 *
 * - **Fa-szerű csoport-nézet**: a sub-assembly-k saját sorként jelennek meg
 *   (`Folder` ikon + chevron toggle), alattuk behúzva a komponensek.
 *   A csoport-szintű "rejtés / megjelenítés" minden leszármazottat megérint.
 * - **Sor-kijelölés**: a teljes sorra kattintva történik (külön "select" oszlop
 *   nincs); az assembly-soroknál a kijelölés a hierarchia kiemelését indítja a
 *   3D nézetben (`AssemblyNode.highlight-descendants` viselkedés).
 * - **Egységes sor-eleje gombok**: minden sor első oszlopa `GripVertical` (drag),
 *   második oszlopa `Eye/EyeOff` (rejtés / megjelenítés). Ezek a panel
 *   szélességétől függetlenül láthatók maradnak.
 * - **Responsive név**: csak az angol megnevezés látszik, alapból két soros
 *   `line-clamp-2` (a 2. sor végén ellipszissel csonkolva, ha nem fér ki). A
 *   `num` és az `id` slug a name `title` (tooltip) attribútumában vannak.
 * - **Panel-collapse**: a fejléc JOBB szélén egyetlen `ChevronRight` gomb
 *   a teljes táblázatot egy keskeny oldalsávra zsugorítja (a g-code panel
 *   konvencióját követve). Az ikon `rotate-180` transzformmal és
 *   `transition-transform`-mal flippelődik a két állapot között (nyitottban
 *   jobbra, csíkban balra mutat). A collapsed-strip-en a panel-cím
 *   függőlegesen kiírva (`writing-mode: vertical-rl`), így a felhasználó
 *   anélkül is látja, milyen panelről van szó, hogy ki kellene bontania.
 * - **Resize-handle**: a panel BAL szélén egy 4 px-es `cursor-col-resize` `<div>`,
 *   pointer-eseményekkel a `panelWidth`-et frissíti, localStorage-ba menti.
 * - **Drag-and-drop sor-átrendezés (sibling-szinten)**: minden sor első
 *   oszlopában `GripVertical` ikon `draggable={true}`. A drop CSAK akkor
 *   engedélyezett, ha a forrás és a cél AZONOS `parentId`-jű (szigorú sibling).
 *   A `parentId` és a registry-hierarchia VÁLTOZATLAN — csak a megjelenítési
 *   sorrend módosul (`customOrder` map, localStorage).
 *
 * # Perszisztencia (localStorage kulcsok)
 *
 *   - `mrc-tb-collapsed`        — összecsukott assembly-id-k JSON tömb
 *   - `mrc-tb-panel-collapsed`  — bool: a panel-szintű összecsukás állapota
 *   - `mrc-tb-panel-width`      — number: a panel szélessége px-ben
 *   - `mrc-tb-row-order`        — JSON: { [parentKey]: string[] } sorrend per parent
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Folder,
  GripVertical,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import {
  getAssemblies,
  getAssemblyIds,
  getChildren,
  getContainingAssemblyId,
  getDescendantComponents,
  getDescendantNodeIds,
  getOrderedComponents,
  getRegistryNode,
} from './componentRegistry'
import type { AssemblyDef, ComponentDef, RegistryNode } from './types'
import { isComponent } from './types'
import { useHighlightStore } from './highlightStore'
import { useTransformOverrideStore } from './transformOverrideStore'

interface Props {
  className?: string
}

/** A `customOrder` perszisztencia formája: minden parentKey-hez egy id-lista. */
type CustomOrder = Record<string, string[]>

/** A renderelt sorok diszkriminált union-ja. */
type Row =
  | {
      kind: 'assembly'
      def: AssemblyDef
      depth: number
      descendantNodeIds: string[]
      descendantComponentIds: string[]
      parentKey: string
    }
  | {
      kind: 'component'
      def: ComponentDef
      depth: number
      parentAssemblyId: string | null
      parentKey: string
    }

const PANEL_WIDTH_DEFAULT = 320
const PANEL_WIDTH_MIN = 220
const PANEL_WIDTH_MAX = 720
const PANEL_COLLAPSED_WIDTH = 32

const ROOT_KEY = '__root__'

// localStorage helpers (csendes hibakezelés) ---------------------------------

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === '1' || raw === 'true'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // ignore
  }
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function writeNumber(key: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}

// Sibling-rendezés a customOrder alapján -------------------------------------

/**
 * Egy sibling-listát rendez a customOrder figyelembevételével:
 *   1) Először az `order`-ben szereplő id-k abban a sorrendben (csak amik a
 *      mostani sibling-halmazban vannak).
 *   2) Utána az `order`-ben nem szereplő új sibling-ok az eredeti sorrendben.
 * Így ha új komponens kerül a registry-be, automatikusan a custom-order
 * VÉGÉRE kerül a megjelenítésben — nem szükséges manuális sync.
 */
function applyCustomOrder<T extends { id: string }>(
  siblings: T[],
  order: string[] | undefined,
): T[] {
  if (!order || order.length === 0) return siblings
  const idToItem = new Map(siblings.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const out: T[] = []
  for (const id of order) {
    const item = idToItem.get(id)
    if (item && !seen.has(id)) {
      out.push(item)
      seen.add(id)
    }
  }
  for (const s of siblings) {
    if (!seen.has(s.id)) out.push(s)
  }
  return out
}

// Komponens-implementáció ----------------------------------------------------

export default function ComponentTable({ className = '' }: Props) {
  const { t } = useTranslation('visualization')
  const selectedId = useHighlightStore((s) => s.selectedId)
  const selectedIds = useHighlightStore((s) => s.selectedIds)
  const setSelectedId = useHighlightStore((s) => s.setSelectedId)
  const toggleInSelection = useHighlightStore((s) => s.toggleInSelection)
  const setHoveredId = useHighlightStore((s) => s.setHoveredId)
  const hiddenIdsArr = useHighlightStore((s) => s.hiddenIds)
  const toggleHidden = useHighlightStore((s) => s.toggleHidden)
  const showAll = useHighlightStore((s) => s.showAll)
  const hideAll = useHighlightStore((s) => s.hideAll)
  const [filter, setFilter] = useState<string>('')

  // Transform-override állapot: a per-sor "piszkos" jelölő (sárga pötty) és a
  // per-sor "reset override" akció (Undo2) ezekből számol.
  const overrideDrafts = useTransformOverrideStore((s) => s.drafts)
  const overrideBaseline = useTransformOverrideStore((s) => s.baseline)
  const clearOverride = useTransformOverrideStore((s) => s.clearOverride)
  const dirtyIds = useMemo(() => {
    const set = new Set<string>()
    for (const [id, d] of Object.entries(overrideDrafts)) {
      const b = overrideBaseline[id]
      if (
        !b ||
        b.position[0] !== d.position[0] ||
        b.position[1] !== d.position[1] ||
        b.position[2] !== d.position[2] ||
        b.rotation[0] !== d.rotation[0] ||
        b.rotation[1] !== d.rotation[1] ||
        b.rotation[2] !== d.rotation[2]
      ) {
        set.add(id)
      }
    }
    return set
  }, [overrideDrafts, overrideBaseline])
  const overriddenIds = useMemo(() => {
    const set = new Set<string>()
    for (const id of Object.keys(overrideDrafts)) set.add(id)
    for (const id of Object.keys(overrideBaseline)) set.add(id)
    return set
  }, [overrideDrafts, overrideBaseline])

  // Perszisztált UI-state -----------------------------------------------------
  const [collapsedAssemblies, setCollapsedAssemblies] = useState<Set<string>>(
    () => new Set(readJson<string[]>('mrc-tb-collapsed', [])),
  )
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() =>
    readBool('mrc-tb-panel-collapsed', false),
  )
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const w = readNumber('mrc-tb-panel-width', PANEL_WIDTH_DEFAULT)
    return Math.min(Math.max(w, PANEL_WIDTH_MIN), PANEL_WIDTH_MAX)
  })
  const [customOrder, setCustomOrder] = useState<CustomOrder>(() =>
    readJson<CustomOrder>('mrc-tb-row-order', {}),
  )

  useEffect(() => {
    writeJson('mrc-tb-collapsed', Array.from(collapsedAssemblies))
  }, [collapsedAssemblies])
  useEffect(() => writeBool('mrc-tb-panel-collapsed', panelCollapsed), [panelCollapsed])
  useEffect(() => writeNumber('mrc-tb-panel-width', panelWidth), [panelWidth])
  useEffect(() => writeJson('mrc-tb-row-order', customOrder), [customOrder])

  // Drag-and-drop tranziens állapot ------------------------------------------
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after' | null>(null)

  // Adat-derivációk -----------------------------------------------------------
  const assemblies = useMemo(() => getAssemblyIds(), [])
  const allComponents = useMemo(() => getOrderedComponents(), [])
  const containingAssembly = useMemo(() => {
    const map = new Map<string, string | undefined>()
    for (const c of allComponents) map.set(c.id, getContainingAssemblyId(c.id))
    return map
  }, [allComponents])
  const hiddenIds = useMemo(() => new Set(hiddenIdsArr), [hiddenIdsArr])

  /**
   * A renderelendő sor-lista: DFS bejárás a gyökerektől, a customOrder szerint
   * sibling-rendezve. Az összecsukott assembly-k leszármazottait kihagyjuk.
   * Ha aktív szűrő van, csak a kiválasztott assembly fa-ágát rendereljük.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const visit = (node: RegistryNode, depth: number, parentKey: string) => {
      if (isComponent(node)) {
        out.push({
          kind: 'component',
          def: node,
          depth,
          parentAssemblyId: containingAssembly.get(node.id) ?? null,
          parentKey,
        })
        // A komponensek alá is rajzolódnak a child-ok (pl. nema23-motor-1
        // gyermeke a bevel-pair-assembly), folytatás:
        const children = applyCustomOrder(getChildren(node.id), customOrder[node.id])
        for (const child of children) visit(child, depth + 1, node.id)
      } else {
        // Assembly sor.
        const descendantNodeIds = getDescendantNodeIds(node.id)
        const descendantComponentIds = getDescendantComponents(node.id).map((c) => c.id)
        out.push({
          kind: 'assembly',
          def: node,
          depth,
          descendantNodeIds,
          descendantComponentIds,
          parentKey,
        })
        if (collapsedAssemblies.has(node.id)) return
        const children = applyCustomOrder(getChildren(node.id), customOrder[node.id])
        for (const child of children) visit(child, depth + 1, node.id)
      }
    }

    if (filter) {
      const root = getRegistryNode(filter)
      if (root) visit(root, 0, root.parentId ?? ROOT_KEY)
    } else {
      const roots = applyCustomOrder(getChildren(null), customOrder[ROOT_KEY])
      for (const root of roots) visit(root, 0, ROOT_KEY)
    }
    return out
  }, [filter, collapsedAssemblies, customOrder, containingAssembly])

  /** A szűrt komponensek listája — a hide-all gomb és az "üres" üzenet hozzá. */
  const filteredComponents = useMemo(
    () =>
      filter
        ? allComponents.filter((c) => containingAssembly.get(c.id) === filter)
        : allComponents,
    [filter, allComponents, containingAssembly],
  )
  const allFilteredHidden = useMemo(
    () =>
      filteredComponents.length > 0 &&
      filteredComponents.every((c) => hiddenIds.has(c.id)),
    [filteredComponents, hiddenIds],
  )

  // Csoport-szintű művelet helpers -------------------------------------------

  /** Egy assembly leszármazottainak láthatósági trinitása. */
  const groupVisibility = useCallback(
    (compIds: string[]): 'all-visible' | 'mixed' | 'all-hidden' => {
      if (compIds.length === 0) return 'all-visible'
      let visible = 0
      let hidden = 0
      for (const id of compIds) {
        if (hiddenIds.has(id)) hidden += 1
        else visible += 1
      }
      if (hidden === 0) return 'all-visible'
      if (visible === 0) return 'all-hidden'
      return 'mixed'
    },
    [hiddenIds],
  )

  const toggleAssemblyCollapse = useCallback((assemblyId: string) => {
    setCollapsedAssemblies((prev) => {
      const next = new Set(prev)
      if (next.has(assemblyId)) next.delete(assemblyId)
      else next.add(assemblyId)
      return next
    })
  }, [])

  const collapseAllGroups = useCallback(() => {
    setCollapsedAssemblies(new Set(getAssemblies().map((a) => a.id)))
  }, [])
  const expandAllGroups = useCallback(() => {
    setCollapsedAssemblies(new Set())
  }, [])

  const toggleGroupHidden = useCallback(
    (compIds: string[]) => {
      const vis = groupVisibility(compIds)
      if (vis === 'all-hidden') {
        // Mindet látható-vá tenni: kivesszük a leszármazott ids-t.
        const remove = new Set(compIds)
        hideAll(hiddenIdsArr.filter((id) => !remove.has(id)))
      } else {
        // Mind rejtett-té tenni: az eddigi rejtett halmazhoz hozzáadjuk
        // a leszármazott komponens-id-ket (assembly-id-ket nem teszünk
        // a hiddenIds-be — a renderer komponens-szinten dolgozik).
        const next = Array.from(new Set([...hiddenIdsArr, ...compIds]))
        hideAll(next)
      }
    },
    [groupVisibility, hiddenIdsArr, hideAll],
  )

  // Drag-and-drop sor-átrendezés ---------------------------------------------

  const onRowDragStart = useCallback(
    (e: React.DragEvent, def: { id: string; parentKey: string }) => {
      e.dataTransfer.setData('application/x-mrc-row-id', def.id)
      e.dataTransfer.effectAllowed = 'move'
      setDragId(def.id)
    },
    [],
  )

  const onRowDragEnd = useCallback(() => {
    setDragId(null)
    setDragOverId(null)
    setDragOverPos(null)
  }, [])

  const onRowDragOver = useCallback(
    (e: React.DragEvent, target: { id: string; parentKey: string }) => {
      // Csak akkor engedjük a drop-ot, ha forrás és cél AZONOS `parentKey`-en van
      // (sibling-szintű átrendezés). Ha nem, nem hívjuk a preventDefault-ot, így
      // a böngésző "no-drop" cursor-t mutat.
      if (!dragId || dragId === target.id) return
      const sourceNode = getRegistryNode(dragId)
      const targetNode = getRegistryNode(target.id)
      if (!sourceNode || !targetNode) return
      const sourceParentKey = sourceNode.parentId ?? ROOT_KEY
      const targetParentKey = targetNode.parentId ?? ROOT_KEY
      if (sourceParentKey !== targetParentKey) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const pos: 'before' | 'after' =
        e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      if (target.id !== dragOverId || pos !== dragOverPos) {
        setDragOverId(target.id)
        setDragOverPos(pos)
      }
    },
    [dragId, dragOverId, dragOverPos],
  )

  const onRowDragLeave = useCallback(
    (e: React.DragEvent, target: { id: string }) => {
      // Csak akkor töröljük az indikátort, ha tényleg elhagytuk a sort
      // (a related target nincs benne).
      const rt = e.relatedTarget as Node | null
      if (rt && (e.currentTarget as HTMLElement).contains(rt)) return
      if (dragOverId === target.id) {
        setDragOverId(null)
        setDragOverPos(null)
      }
    },
    [dragOverId],
  )

  const onRowDrop = useCallback(
    (e: React.DragEvent, target: { id: string }) => {
      e.preventDefault()
      const sourceId =
        e.dataTransfer.getData('application/x-mrc-row-id') || dragId
      const dropPos = dragOverPos
      setDragId(null)
      setDragOverId(null)
      setDragOverPos(null)
      if (!sourceId || !dropPos || sourceId === target.id) return
      const sourceNode = getRegistryNode(sourceId)
      const targetNode = getRegistryNode(target.id)
      if (!sourceNode || !targetNode) return
      const sourceParentKey = sourceNode.parentId ?? ROOT_KEY
      const targetParentKey = targetNode.parentId ?? ROOT_KEY
      if (sourceParentKey !== targetParentKey) return

      // Frissítjük a customOrder-t a sourceParentKey-en.
      setCustomOrder((prev) => {
        const siblings = applyCustomOrder(
          getChildren(sourceNode.parentId),
          prev[sourceParentKey],
        ).map((s) => s.id)
        const without = siblings.filter((id) => id !== sourceId)
        const targetIdx = without.indexOf(target.id)
        if (targetIdx === -1) return prev
        const insertAt = dropPos === 'before' ? targetIdx : targetIdx + 1
        const next = [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)]
        return { ...prev, [sourceParentKey]: next }
      })
    },
    [dragId, dragOverPos],
  )

  const resetCustomOrder = useCallback(() => setCustomOrder({}), [])
  const hasCustomOrder = useMemo(
    () => Object.keys(customOrder).length > 0,
    [customOrder],
  )

  // Resize handle ------------------------------------------------------------
  const panelRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      resizeStateRef.current = { startX: e.clientX, startWidth: panelWidth }
    },
    [panelWidth],
  )
  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const st = resizeStateRef.current
    if (!st) return
    // A resize-handle a panel BAL szélén van; jobbra húzva a panel KESKENYEDIK,
    // balra húzva SZÉLESEDIK (mert a panel jobb széle fix a layout-ban).
    const dx = e.clientX - st.startX
    const next = Math.min(
      Math.max(st.startWidth - dx, PANEL_WIDTH_MIN),
      PANEL_WIDTH_MAX,
    )
    setPanelWidth(next)
  }, [])
  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (resizeStateRef.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      resizeStateRef.current = null
    }
  }, [])

  // A `panelCollapsed` állapot kapcsolása után a layout változhat — a Canvas
  // (`@react-three/fiber`) automatikusan resize-ol, de window resize event-et
  // is dispatch-elünk a biztonság kedvéért.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event('resize'))
  }, [panelCollapsed, panelWidth])

  // Render --------------------------------------------------------------------

  if (panelCollapsed) {
    return (
      <div
        ref={panelRef}
        className={`flex flex-col bg-steel-900/90 border border-steel-700 rounded ${className}`}
        style={{ width: PANEL_COLLAPSED_WIDTH }}
      >
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          title={t('component_table.expand_panel')}
          className="w-full p-1.5 hover:bg-steel-800 text-steel-300 hover:text-white flex items-center justify-center flex-shrink-0"
        >
          {/* Csíkban balra mutat ("kattints a panel kibontásához → balra
              tolódik kifelé"). Ugyanaz az ikon a header-ben rotation
              nélkül jobbra mutat (összecsukás). CSS transition-transform a
              kapcsolt állapot vizuális flippeléséhez. */}
          <ChevronRight className="w-4 h-4 rotate-180 transition-transform duration-200" />
        </button>
        {/* Függőleges panel-cím — a felhasználó láthatja, milyen panelről
            van szó anélkül, hogy ki kellene bontania (a g-code panel mintájára).
            `writing-mode: vertical-rl` → top-to-bottom olvasás. */}
        <div className="flex-1 min-h-0 flex items-start justify-center pt-2">
          <span
            className="text-xs font-medium text-steel-300 select-none tracking-wider uppercase"
            style={{ writingMode: 'vertical-rl' }}
          >
            {t('component_table.title')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className={`relative flex flex-col bg-steel-900/90 border border-steel-700 rounded ${className}`}
      style={{ width: panelWidth }}
    >
      {/* Resize handle a BAL szélen */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-blue-500/40 z-20"
        style={{ touchAction: 'none' }}
        title="Resize"
      />

      {/* Fejléc — a collapse-gomb a JOBB szélen (a g-code panel
          konvencióját követve). A cím balra-igazítva, a csoport-műveletek
          (collapse/expand all + custom-order reset) középen, a panel-collapse
          a sor végén. */}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-steel-700 bg-steel-800/60 pl-3">
        <div className="text-sm font-medium text-steel-100 flex-1 truncate">
          {t('component_table.title')}
        </div>
        <button
          type="button"
          onClick={collapseAllGroups}
          title={t('component_table.collapse_all_groups')}
          className="p-1 rounded hover:bg-steel-700 text-steel-400 hover:text-white"
        >
          <ChevronsDownUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={expandAllGroups}
          title={t('component_table.expand_all_groups')}
          className="p-1 rounded hover:bg-steel-700 text-steel-400 hover:text-white"
        >
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
        {hasCustomOrder && (
          <button
            type="button"
            onClick={resetCustomOrder}
            title={t('component_table.reset_order_title')}
            className="p-1 rounded hover:bg-steel-700 text-steel-400 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setPanelCollapsed(true)}
          title={t('component_table.collapse_panel')}
          className="p-1 rounded hover:bg-steel-700 text-steel-400 hover:text-white"
        >
          {/* Nyitott állapotban jobbra mutat ("kattints az összecsukáshoz →
              a panel a jobb szélre csúszik"). A collapsed-strip render-ben
              ugyanez az ikon `rotate-180`-nal balra mutat. */}
          <ChevronRight className="w-3.5 h-3.5 transition-transform duration-200" />
        </button>
      </div>

      {/* Fő-eszköztár */}
      <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-steel-700 bg-steel-800/40 flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (allFilteredHidden) {
              const remaining = hiddenIdsArr.filter(
                (id) => !filteredComponents.some((c) => c.id === id),
              )
              hideAll(remaining)
            } else {
              const next = Array.from(
                new Set([...hiddenIdsArr, ...filteredComponents.map((c) => c.id)]),
              )
              hideAll(next)
            }
          }}
          title={
            allFilteredHidden
              ? t('component_table.show_all_filtered')
              : t('component_table.hide_all_filtered')
          }
          className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 bg-steel-900 hover:bg-steel-800 border border-steel-700 rounded text-steel-300"
        >
          {allFilteredHidden ? (
            <>
              <Eye className="w-3 h-3" />
              {t('component_table.show_all_short')}
            </>
          ) : (
            <>
              <EyeOff className="w-3 h-3" />
              {t('component_table.hide_all_short')}
            </>
          )}
        </button>
        {hiddenIdsArr.length > 0 && !allFilteredHidden && (
          <button
            type="button"
            onClick={showAll}
            title={t('component_table.reset_hidden_title', { count: hiddenIdsArr.length })}
            className="text-[11px] px-2 py-0.5 bg-steel-900 hover:bg-steel-800 border border-steel-700 rounded text-steel-400"
          >
            Reset ({hiddenIdsArr.length})
          </button>
        )}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs bg-steel-900 text-steel-200 border border-steel-700 rounded px-1.5 py-0.5 ml-auto max-w-[140px]"
        >
          <option value="">{t('component_table.filter_all_assemblies')}</option>
          {assemblies.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Sorok */}
      <div className="overflow-auto flex-1 min-h-0">
        {rows.map((row) =>
          row.kind === 'assembly' ? (
            <AssemblyRow
              key={`a:${row.def.id}`}
              row={row}
              isCollapsed={collapsedAssemblies.has(row.def.id)}
              isSelected={selectedIds.includes(row.def.id)}
              visibility={groupVisibility(row.descendantComponentIds)}
              isDirty={dirtyIds.has(row.def.id)}
              hasOverride={overriddenIds.has(row.def.id)}
              onResetOverride={() => clearOverride(row.def.id)}
              onToggleCollapse={() => toggleAssemblyCollapse(row.def.id)}
              onSelect={(e) => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  toggleInSelection(row.def.id)
                } else {
                  setSelectedId(selectedId === row.def.id ? null : row.def.id)
                }
              }}
              onToggleHidden={() => toggleGroupHidden(row.descendantComponentIds)}
              onMouseEnter={() => setHoveredId(row.def.id)}
              onMouseLeave={() => setHoveredId(null)}
              isDragOver={dragOverId === row.def.id}
              dragOverPos={dragOverId === row.def.id ? dragOverPos : null}
              onDragStart={(e) =>
                onRowDragStart(e, { id: row.def.id, parentKey: row.parentKey })
              }
              onDragEnd={onRowDragEnd}
              onDragOver={(e) =>
                onRowDragOver(e, { id: row.def.id, parentKey: row.parentKey })
              }
              onDragLeave={(e) => onRowDragLeave(e, { id: row.def.id })}
              onDrop={(e) => onRowDrop(e, { id: row.def.id })}
              t={t}
            />
          ) : (
            <ComponentRow
              key={`c:${row.def.id}`}
              row={row}
              isSelected={selectedIds.includes(row.def.id)}
              isHidden={hiddenIds.has(row.def.id)}
              isDirty={dirtyIds.has(row.def.id)}
              hasOverride={overriddenIds.has(row.def.id)}
              onResetOverride={() => clearOverride(row.def.id)}
              onSelect={(e) => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  toggleInSelection(row.def.id)
                } else {
                  setSelectedId(selectedId === row.def.id ? null : row.def.id)
                }
              }}
              onToggleHidden={() => toggleHidden(row.def.id)}
              onMouseEnter={() => setHoveredId(row.def.id)}
              onMouseLeave={() => setHoveredId(null)}
              isDragOver={dragOverId === row.def.id}
              dragOverPos={dragOverId === row.def.id ? dragOverPos : null}
              onDragStart={(e) =>
                onRowDragStart(e, { id: row.def.id, parentKey: row.parentKey })
              }
              onDragEnd={onRowDragEnd}
              onDragOver={(e) =>
                onRowDragOver(e, { id: row.def.id, parentKey: row.parentKey })
              }
              onDragLeave={(e) => onRowDragLeave(e, { id: row.def.id })}
              onDrop={(e) => onRowDrop(e, { id: row.def.id })}
              t={t}
            />
          ),
        )}
        {rows.length === 0 && (
          <div className="text-xs text-steel-500 px-3 py-4 text-center">
            {t('component_table.empty_filter')}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Sor-komponensek (div/flex-alapú, responsive layout)
// =============================================================================
//
// A táblázat NEM `<table>`, hanem flex-divek halmaza — így a name oszlop
// `flex-1 min-w-0` kombinációval tud responsive truncate-olni a panel
// szélességéhez. A sor-elrendezés MINDEN sornál azonos:
//
//   [drag] [hide] (depth-indent) [chevron+folder | colorSwatch] [name (2 sor)]
//
// A chevron + folder az assembly-soroké, a színes négyzet a komponens-soroké.
// A `num` és az `id` slug a name `title` (tooltip) attribútumában jelennek meg
// zárójelben — külön oszlop nincs. Magyar nevet sehol sem írunk ki, csak az
// English `nameEn`-t (fallback: `nameHu`, ha nincs `nameEn`).

const INDENT_PX = 12

interface CommonRowProps {
  isDragOver: boolean
  dragOverPos: 'before' | 'after' | null
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}

/** A drop-indikátor inset-shadow class-okat egy helyen tartja. */
function dropShadowClass(
  isDragOver: boolean,
  dragOverPos: 'before' | 'after' | null,
): string {
  if (!isDragOver) return ''
  if (dragOverPos === 'before') return 'shadow-[inset_0_2px_0_0_rgb(96_165_250)]'
  if (dragOverPos === 'after') return 'shadow-[inset_0_-2px_0_0_rgb(96_165_250)]'
  return ''
}

interface AssemblyRowProps extends CommonRowProps {
  row: Extract<Row, { kind: 'assembly' }>
  isCollapsed: boolean
  isSelected: boolean
  visibility: 'all-visible' | 'mixed' | 'all-hidden'
  isDirty: boolean
  hasOverride: boolean
  onResetOverride: () => void
  onToggleCollapse: () => void
  /**
   * A teljes sorra kattintáskor hívódik. A `MouseEvent`-en keresztül a
   * Shift / Ctrl / Cmd modifier-eket olvassuk → multi-select toggle vs
   * single-select-replace döntés.
   */
  onSelect: (e: React.MouseEvent) => void
  onToggleHidden: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function AssemblyRow({
  row,
  isCollapsed,
  isSelected,
  visibility,
  isDirty,
  hasOverride,
  onResetOverride,
  onToggleCollapse,
  onSelect,
  onToggleHidden,
  onMouseEnter,
  onMouseLeave,
  isDragOver,
  dragOverPos,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  t,
}: AssemblyRowProps) {
  const indent = row.depth * INDENT_PX
  const isAllHidden = visibility === 'all-hidden'
  // Az assembly title-jébe (tooltip) az id slug és — ha létezik — a magyar
  // megnevezés is bekerül zárójelek között, hogy a HU-EN megfeleltetés és az
  // azonosító egyetlen lebegő tooltipben elérhető legyen.
  const displayName = row.def.nameEn ?? row.def.nameHu
  const titleParts = [displayName, `(${row.def.id})`]
  if (row.def.nameEn && row.def.nameHu && row.def.nameHu !== row.def.nameEn) {
    titleParts.push(`— ${row.def.nameHu}`)
  }
  const tooltip = titleParts.join(' ')
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onSelect}
      className={`relative flex items-stretch gap-0.5 border-t border-steel-800 bg-steel-800/30 hover:bg-steel-800/60 cursor-pointer text-xs ${
        isSelected ? 'bg-blue-500/15 ring-1 ring-blue-400/40' : ''
      } ${dropShadowClass(isDragOver, dragOverPos)}`}
    >
      {/* Drag handle — a sor abszolút legelején, behúzás NÉLKÜL. */}
      <div className="flex items-center pl-1">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          title={t('component_table.drag_handle')}
          className="cursor-grab active:cursor-grabbing text-steel-500 hover:text-steel-200 p-0.5"
        >
          <GripVertical className="w-3 h-3" />
        </span>
      </div>
      {/* Hide / show — szintén behúzás nélkül, hogy minden sornál egy oszlopban legyen. */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleHidden()
          }}
          title={isAllHidden ? t('component_table.group_show') : t('component_table.group_hide')}
          className={`p-0.5 rounded hover:bg-steel-700 ${
            isAllHidden
              ? 'text-steel-600'
              : visibility === 'mixed'
                ? 'text-amber-400'
                : 'text-steel-300'
          }`}
        >
          {isAllHidden ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      {/* Behúzás (depth) + chevron + folder ikon. */}
      <div
        className="flex items-center gap-1 shrink-0"
        style={{ paddingLeft: indent }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
          className="p-0.5 rounded hover:bg-steel-700 text-steel-300"
          title={
            isCollapsed
              ? t('component_table.expand_all_groups')
              : t('component_table.collapse_all_groups')
          }
        >
          {isCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        <Folder className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
      </div>
      {/* Név — flex-1 + min-w-0 a responsive truncate-hez; line-clamp-2 maxim 2 sorra. */}
      <div className="flex-1 min-w-0 py-1 pr-2 self-center flex items-center gap-1">
        {(isDirty || hasOverride) && (
          <span
            title={
              isDirty
                ? t('component_table.override_dirty')
                : t('component_table.override_saved')
            }
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              isDirty ? 'bg-amber-400' : 'bg-blue-400'
            }`}
          />
        )}
        <div
          className="font-medium text-steel-100 leading-tight line-clamp-2 break-words flex-1 min-w-0"
          title={tooltip}
        >
          {displayName}
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onResetOverride()
            }}
            title={t('component_table.reset_override')}
            className="p-0.5 rounded hover:bg-steel-700 text-steel-500 hover:text-amber-400 shrink-0"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}

interface ComponentRowProps extends CommonRowProps {
  row: Extract<Row, { kind: 'component' }>
  isSelected: boolean
  isHidden: boolean
  isDirty: boolean
  hasOverride: boolean
  onResetOverride: () => void
  onSelect: (e: React.MouseEvent) => void
  onToggleHidden: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ComponentRow({
  row,
  isSelected,
  isHidden,
  isDirty,
  hasOverride,
  onResetOverride,
  onSelect,
  onToggleHidden,
  onMouseEnter,
  onMouseLeave,
  isDragOver,
  dragOverPos,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  t,
}: ComponentRowProps) {
  const c = row.def
  const indent = row.depth * INDENT_PX
  // A name title (tooltip) attribútumába a `(num)` és az id slug, valamint —
  // ha különbözik az angoltól — a magyar megnevezés is bekerül.
  const titleParts = [`(${c.num}) ${c.nameEn}`, `[${c.id}]`]
  if (c.nameHu && c.nameHu !== c.nameEn) titleParts.push(`— ${c.nameHu}`)
  const tooltip = titleParts.join(' ')
  return (
    <div
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex items-stretch gap-0.5 cursor-pointer border-t border-steel-800 hover:bg-steel-800/60 text-xs ${
        isSelected ? 'bg-blue-500/10 ring-1 ring-blue-400/40' : ''
      } ${isHidden ? 'opacity-50' : ''} ${dropShadowClass(isDragOver, dragOverPos)}`}
    >
      {/* Drag handle — a sor abszolút legelején, behúzás NÉLKÜL. */}
      <div className="flex items-center pl-1">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          title={t('component_table.drag_handle')}
          className="cursor-grab active:cursor-grabbing text-steel-600 hover:text-steel-300 p-0.5"
        >
          <GripVertical className="w-3 h-3" />
        </span>
      </div>
      {/* Hide gomb — szintén behúzás nélkül, az assembly-sorral egy vonalban. */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleHidden()
          }}
          title={
            isHidden
              ? t('component_table.toggle_hidden_show')
              : t('component_table.toggle_hidden_hide')
          }
          className={`p-0.5 rounded hover:bg-steel-700 ${
            isHidden ? 'text-steel-600' : 'text-steel-300'
          }`}
        >
          {isHidden ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      {/* Behúzás (depth) + chevron-helykitöltő + szín-swatch. */}
      <div
        className="flex items-center gap-1 shrink-0"
        style={{ paddingLeft: indent }}
      >
        {/* Chevron méretű placeholder a vízszintes igazításhoz az assembly-sor
            chevron-jával. */}
        <span
          className="inline-block shrink-0"
          style={{ width: 18, height: 18 }}
        />
        <span
          className="inline-block w-3.5 h-3.5 rounded-sm border border-steel-600 shrink-0"
          style={{ background: c.color }}
          title={c.color}
        />
      </div>
      {/* Név — line-clamp-2 default 2 sor, narrow esetén truncate-szerű break + 2.
          sor végén ellipszis. Az override-jelölő (sárga = dirty / kék = mentett)
          a név előtt; reset-override gomb a sor végén, csak ha van override. */}
      <div className="flex-1 min-w-0 py-1 pr-2 self-center flex items-center gap-1">
        {(isDirty || hasOverride) && (
          <span
            title={
              isDirty
                ? t('component_table.override_dirty')
                : t('component_table.override_saved')
            }
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              isDirty ? 'bg-amber-400' : 'bg-blue-400'
            }`}
          />
        )}
        <div
          className={`font-medium leading-tight line-clamp-2 break-words flex-1 min-w-0 ${
            isHidden ? 'text-steel-400 line-through' : 'text-steel-100'
          }`}
          title={tooltip}
        >
          {c.nameEn}
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onResetOverride()
            }}
            title={t('component_table.reset_override')}
            className="p-0.5 rounded hover:bg-steel-700 text-steel-500 hover:text-amber-400 shrink-0"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
