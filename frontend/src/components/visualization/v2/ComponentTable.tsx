/**
 * Komponens-táblázat panel a V2 csőhajlító modellhez.
 *
 * - Az aktív LOD/szín-mód/highlight állapotot a `useHighlightStore`-ból olvassa.
 * - Sorszám, színminta, magyar név, angol név, szülő-szerelvény, kiemelés.
 * - Sorra kattintás: kijelöli az alkatrészt (és a 3D nézet azt kiemeli).
 * - Szerelvény (assemblyId) szerinti szűrés.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair, Eye, EyeOff } from 'lucide-react'
import { getAssemblyIds, getOrderedComponents } from './componentRegistry'
import { useHighlightStore } from './highlightStore'

interface Props {
  className?: string
}

export default function ComponentTable({ className = '' }: Props) {
  const { t } = useTranslation('visualization')
  const selectedId = useHighlightStore((s) => s.selectedId)
  const setSelectedId = useHighlightStore((s) => s.setSelectedId)
  const setHoveredId = useHighlightStore((s) => s.setHoveredId)
  const hiddenIdsArr = useHighlightStore((s) => s.hiddenIds)
  const toggleHidden = useHighlightStore((s) => s.toggleHidden)
  const showAll = useHighlightStore((s) => s.showAll)
  const hideAll = useHighlightStore((s) => s.hideAll)
  const [filter, setFilter] = useState<string>('')

  const assemblies = useMemo(() => getAssemblyIds(), [])
  const components = useMemo(() => getOrderedComponents(), [])
  const filtered = useMemo(
    () => (filter ? components.filter((c) => c.assemblyId === filter) : components),
    [components, filter],
  )
  const hiddenIds = useMemo(() => new Set(hiddenIdsArr), [hiddenIdsArr])
  /** Igaz, ha a JELENLEG SZŰRT lista MINDEN eleme rejtett. */
  const allFilteredHidden = useMemo(
    () => filtered.length > 0 && filtered.every((c) => hiddenIds.has(c.id)),
    [filtered, hiddenIds],
  )

  return (
    <div className={`flex flex-col bg-steel-900/90 border border-steel-700 rounded ${className}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-steel-700 bg-steel-800/60">
        <div className="text-sm font-medium text-steel-100">{t('component_table.title')}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (allFilteredHidden) {
                // Mindet látható-vá teszi (a SZŰRT lista elemeit törli a hidden-ből)
                const remaining = hiddenIdsArr.filter(
                  (id) => !filtered.some((c) => c.id === id),
                )
                hideAll(remaining)
              } else {
                // A SZŰRT lista MINDEN elemét rejtett-té teszi (mellette megőrzi
                // a többi szűrön kívül eső rejtett elemet is).
                const next = Array.from(
                  new Set([...hiddenIdsArr, ...filtered.map((c) => c.id)]),
                )
                hideAll(next)
              }
            }}
            title={
              allFilteredHidden
                ? t('component_table.show_all_filtered')
                : t('component_table.hide_all_filtered')
            }
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 bg-steel-900 hover:bg-steel-800 border border-steel-700 rounded text-steel-300"
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
              className="text-[11px] px-2 py-1 bg-steel-900 hover:bg-steel-800 border border-steel-700 rounded text-steel-400"
            >
              Reset ({hiddenIdsArr.length})
            </button>
          )}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-steel-900 text-steel-200 border border-steel-700 rounded px-2 py-1"
          >
            <option value="">{t('component_table.filter_all_assemblies')}</option>
            {assemblies.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-auto max-h-full">
        <table className="w-full text-xs">
          <thead className="text-steel-400 sticky top-0 bg-steel-900/95 backdrop-blur">
            <tr>
              <th className="text-right px-2 py-1 w-8">#</th>
              <th className="text-left px-2 py-1 w-6"></th>
              <th className="text-center px-2 py-1 w-8" title={t('component_table.col_visibility')}>
                <Eye className="w-3.5 h-3.5 inline-block opacity-60" />
              </th>
              <th className="text-left px-2 py-1">{t('component_table.col_name_hu')}</th>
              <th className="text-left px-2 py-1 text-steel-500">{t('component_table.col_name_en')}</th>
              <th className="text-left px-2 py-1 text-steel-500">{t('component_table.col_parent')}</th>
              <th className="text-center px-2 py-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const isSel = selectedId === c.id
              const isHidden = hiddenIds.has(c.id)
              return (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(isSel ? null : c.id)}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`cursor-pointer border-t border-steel-800 hover:bg-steel-800/60 ${
                    isSel ? 'bg-blue-500/10 ring-1 ring-blue-400/40' : ''
                  } ${isHidden ? 'opacity-50' : ''}`}
                >
                  <td className="text-right px-2 py-1 font-mono text-steel-400">{c.num}</td>
                  <td className="px-2 py-1">
                    <span
                      className="inline-block w-4 h-4 rounded border border-steel-600"
                      style={{ background: c.color }}
                      title={c.color}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleHidden(c.id)
                      }}
                      title={
                        isHidden ? t('component_table.toggle_hidden_show') : t('component_table.toggle_hidden_hide')
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
                  </td>
                  <td className={`px-2 py-1 font-medium ${isHidden ? 'text-steel-400 line-through' : 'text-steel-100'}`}>
                    {c.nameHu}
                  </td>
                  <td className="px-2 py-1 text-steel-400">{c.nameEn}</td>
                  <td className="px-2 py-1 text-steel-500">{c.assemblyId ?? '-'}</td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(isSel ? null : c.id)
                      }}
                      title={isSel ? t('component_table.selection_clear') : t('component_table.selection_select')}
                      className={`p-0.5 rounded hover:bg-steel-700 ${
                        isSel ? 'text-blue-400' : 'text-steel-500'
                      }`}
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-xs text-steel-500 px-3 py-4 text-center">
            {t('component_table.empty_filter')}
          </div>
        )}
      </div>
    </div>
  )
}
