import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Download, FileCode, GripVertical, Wind } from 'lucide-react'
import type { MachineConfig } from '../../types/machine-config'
import type { DeviceStatus, Position } from '../../types/device'
import MachineVisualization from './MachineVisualization'
import RobotArmVisualization from './RobotArmVisualization'
import TubeBenderVisualization from './TubeBenderVisualization'
import {
  ComponentTable,
  LOD_LABELS_EN,
  LOD_LABELS_HU,
  LOD_LEVELS,
  TubeBenderVisualizationV2,
  exportStl,
  useHighlightStore,
} from './v2'

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  showDebugInfo?: boolean
  showHeader?: boolean
  headerExtra?: React.ReactNode
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
  // Default: useV2 = true (új modell aktív), showTable = true.
  const [useV2, setUseV2] = useState<boolean>(() => readLocalBool('mrc-tb-useV2', true))
  const [showTable, setShowTable] = useState<boolean>(() => readLocalBool('mrc-tb-showTable', true))
  useEffect(() => writeLocalBool('mrc-tb-useV2', useV2), [useV2])
  useEffect(() => writeLocalBool('mrc-tb-showTable', showTable), [showTable])
  const isTubeBender = config.type === 'tube_bender'
  const lodLevel = useHighlightStore((s) => s.lodLevel)
  const setLodLevel = useHighlightStore((s) => s.setLodLevel)
  const colorMode = useHighlightStore((s) => s.colorMode)
  const setColorMode = useHighlightStore((s) => s.setColorMode)
  const fadeOthers = useHighlightStore((s) => s.fadeOthers)
  const setFadeOthers = useHighlightStore((s) => s.setFadeOthers)
  const selectedId = useHighlightStore((s) => s.selectedId)

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

      {/* V2 vezérlő sáv (LOD, színmód, táblázat toggle, STL export) */}
      {isTubeBender && useV2 && (
        <div className="bg-steel-900/95 border-b border-steel-700 px-3 py-1.5 flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1">
            <span className="text-steel-400">{t('panel.lod_label')}</span>
            <select
              value={lodLevel}
              onChange={(e) => setLodLevel(e.target.value as typeof lodLevel)}
              className="bg-steel-800 text-steel-100 border border-steel-700 rounded px-1.5 py-0.5"
            >
              {LOD_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>{lodLabels[lvl]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-steel-400">{t('panel.color_label')}</span>
            <select
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as typeof colorMode)}
              className="bg-steel-800 text-steel-100 border border-steel-700 rounded px-1.5 py-0.5"
            >
              <option value="pbr">{t('panel.color_pbr')}</option>
              <option value="registry">{t('panel.color_registry')}</option>
            </select>
          </div>
          <label className="flex items-center gap-1 text-steel-300 cursor-pointer">
            <input
              type="checkbox"
              checked={fadeOthers}
              onChange={(e) => setFadeOthers(e.target.checked)}
              className="accent-blue-500"
            />
            {t('panel.fade_others')}
          </label>
          <label className="flex items-center gap-1 text-steel-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showTable}
              onChange={(e) => setShowTable(e.target.checked)}
              className="accent-blue-500"
            />
            {t('panel.show_table')}
          </label>
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => exportStl()}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-steel-800 hover:bg-steel-700 text-steel-100 border border-steel-700 rounded"
              title={t('panel.stl_full_title')}
            >
              <Download className="w-3.5 h-3.5" />
              STL
            </button>
            <button
              type="button"
              disabled={!selectedId}
              onClick={() => selectedId && exportStl({ rootId: selectedId })}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-steel-800 hover:bg-steel-700 disabled:opacity-40 disabled:cursor-not-allowed text-steel-100 border border-steel-700 rounded"
              title={
                selectedId ? t('panel.stl_selected_title', { id: selectedId }) : t('panel.stl_pick_first')
              }
            >
              <Download className="w-3.5 h-3.5" />
              {t('panel.stl_selected_btn')}
            </button>
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

        {/* V2 alkatrész-táblázat oldalsáv */}
        {isTubeBender && useV2 && showTable && (
          <ComponentTable className="w-72 shrink-0 border-l border-steel-700" />
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
