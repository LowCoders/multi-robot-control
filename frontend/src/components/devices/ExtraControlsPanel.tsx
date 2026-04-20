import { useEffect, useState } from 'react'
import { Hand, MousePointer2, Zap, Disc3, Droplets, Power, Gauge } from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'
import { effectiveCapabilities } from '../../utils/capabilities'
import type { Device, DeviceCapabilities } from '../../types/device'
import type { MachineConfig, CoolantMode } from '../../types/machine-config'

interface Props {
  device: Device
  machineConfig: MachineConfig | null
  capabilities?: DeviceCapabilities
}

async function postJSON(url: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

// Egyszerű badge komponens a forrás (declared/runtime/sync) jelzésére
function SourceBadge({ source, runtimeSupported }: { source: 'declared' | 'runtime' | 'both' | 'none'; runtimeSupported: boolean }) {
  if (source === 'none') return null
  if (!runtimeSupported && source === 'declared') {
    return (
      <span className="text-[9px] uppercase tracking-wide px-1 rounded border bg-amber-500/20 text-amber-300 border-amber-500/40">
        nincs runtime
      </span>
    )
  }
  return null
}

export default function ExtraControlsPanel({ device, machineConfig, capabilities }: Props) {
  const { sendMDI } = useDeviceStore()
  const effective = effectiveCapabilities(machineConfig, capabilities)

  // Helyi UI állapotok
  const [feedOverride, setFeedOverride] = useState<number>(device.status?.feed_override ?? 100)
  const [spindleOverride, setSpindleOverride] = useState<number>(device.status?.spindle_override ?? 100)
  const defaultLaserPower = machineConfig?.laser?.defaultPower
    ?? (effective.maxLaserPower > 0 ? Math.round(effective.maxLaserPower / 2) : 500)
  const [laserPower, setLaserPower] = useState<number>(defaultLaserPower)
  const [laserOn, setLaserOn] = useState<boolean>(false)
  const [coolantState, setCoolantState] = useState<'off' | CoolantMode>('off')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Backend értékek frissülésekor szinkronizáljuk a slider állapotot
  useEffect(() => {
    if (typeof device.status?.feed_override === 'number') setFeedOverride(device.status.feed_override)
  }, [device.status?.feed_override])
  useEffect(() => {
    if (typeof device.status?.spindle_override === 'number') setSpindleOverride(device.status.spindle_override)
  }, [device.status?.spindle_override])

  const isOnline = device.connected && device.state !== 'disconnected'
  const isAlarm = device.state === 'alarm'
  const canControl = isOnline && !isAlarm

  // A végszerszám típusát az EndEffectorEditor tartja karban (gripper / sucker / none).
  // A "Fogókar" képesség checkbox csak azt jelzi, hogy van-e végszerszám; a
  // konkrét típus pedig itt dönti el, melyik runtime kártya látsszon.
  const endEffectorType = machineConfig?.robotArm?.endEffector?.type
  const hasEndEffector = effective.hasGripper || effective.hasSucker
  const showSuckerCard = hasEndEffector && (endEffectorType === 'sucker' || effective.hasSucker)
  const showGripperCard = hasEndEffector && !showSuckerCard

  const showAny =
    showGripperCard ||
    showSuckerCard ||
    effective.hasLaser ||
    effective.hasSpindle ||
    effective.hasCoolant ||
    device.type === 'robot_arm'

  if (!showAny) return null

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba')
    } finally {
      setBusy(null)
    }
  }

  const callApi = async (label: string, path: string, body?: Record<string, unknown>) => {
    return guard(label, async () => {
      const resp = await postJSON(`/api/devices/${device.id}${path}`, body)
      if (!resp.ok) {
        throw new Error(`${path} sikertelen (${resp.status})`)
      }
    })
  }

  const sendGcode = (label: string, gcode: string) =>
    guard(label, async () => {
      sendMDI(device.id, gcode)
    })

  // Lézer kezelés (MDI fallback)
  const turnLaserOn = (power: number) => {
    setLaserOn(true)
    sendGcode('laser_on', `M3 S${Math.max(0, Math.round(power))}`)
  }
  const turnLaserOff = () => {
    setLaserOn(false)
    sendGcode('laser_off', 'M5')
  }

  // Coolant kezelés (MDI fallback) - tiszteletben tartja az override M-kódokat
  const coolantOnGcode = (mode: CoolantMode) => {
    if (machineConfig?.coolant?.mGcodeOn) return machineConfig.coolant.mGcodeOn
    return mode === 'mist' ? 'M7' : 'M8' // air → M8 a flood-tal
  }
  const coolantOffGcode = () => machineConfig?.coolant?.mGcodeOff ?? 'M9'

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span className="font-medium flex items-center gap-2">
          <Gauge className="w-4 h-4 text-machine-400" />
          Extra vezérlés
        </span>
        {busy && <span className="text-[11px] text-steel-400">{busy}…</span>}
      </div>
      <div className="card-body space-y-4">
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Feed/Spindle override sliderek (mindig megjelennek, ha online) */}
        {canControl && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs text-steel-400 mb-1">
                <span>Feed override</span>
                <span className="text-steel-200 font-mono">{feedOverride}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={feedOverride}
                onChange={(e) => setFeedOverride(parseInt(e.target.value, 10))}
                onMouseUp={() => callApi('feed_override', '/feed-override', { percent: feedOverride })}
                onTouchEnd={() => callApi('feed_override', '/feed-override', { percent: feedOverride })}
                className="w-full"
              />
            </div>
            {effective.hasSpindle && (
              <div>
                <div className="flex items-center justify-between text-xs text-steel-400 mb-1">
                  <span className="flex items-center gap-1">
                    <Disc3 className="w-3 h-3" /> Spindle override
                    <SourceBadge source={effective.source.hasSpindle} runtimeSupported={capabilities?.has_spindle === true} />
                  </span>
                  <span className="text-steel-200 font-mono">{spindleOverride}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={spindleOverride}
                  onChange={(e) => setSpindleOverride(parseInt(e.target.value, 10))}
                  onMouseUp={() => callApi('spindle_override', '/spindle-override', { percent: spindleOverride })}
                  onTouchEnd={() => callApi('spindle_override', '/spindle-override', { percent: spindleOverride })}
                  className="w-full"
                />
              </div>
            )}
          </div>
        )}

        {/* Gripper / Sucker (REST endpoint létezik) */}
        {(showGripperCard || showSuckerCard) && (
          <div className="grid grid-cols-2 gap-2">
            {showGripperCard && (
              <div className="bg-steel-800/40 rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between text-xs text-steel-400">
                  <span className="flex items-center gap-1">
                    <Hand className="w-3 h-3" /> Fogókar
                  </span>
                  <SourceBadge source={effective.source.hasGripper} runtimeSupported={capabilities?.has_gripper === true} />
                </div>
                <div className="flex gap-1">
                  <button
                    disabled={!canControl}
                    onClick={() => callApi('gripper_on', '/gripper/on')}
                    className="btn btn-secondary btn-sm flex-1 text-xs"
                  >
                    Bezár
                  </button>
                  <button
                    disabled={!canControl}
                    onClick={() => callApi('gripper_off', '/gripper/off')}
                    className="btn btn-secondary btn-sm flex-1 text-xs"
                  >
                    Kinyit
                  </button>
                </div>
                {device.status?.gripper_state && (
                  <div className="text-[10px] text-steel-500">Állapot: {device.status.gripper_state}</div>
                )}
              </div>
            )}
            {showSuckerCard && (
              <div className="bg-steel-800/40 rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between text-xs text-steel-400">
                  <span className="flex items-center gap-1">
                    <MousePointer2 className="w-3 h-3" /> Vákuumos
                  </span>
                  <SourceBadge source={effective.source.hasSucker} runtimeSupported={capabilities?.has_sucker === true} />
                </div>
                <div className="flex gap-1">
                  <button
                    disabled={!canControl}
                    onClick={() => callApi('sucker_on', '/sucker/on')}
                    className="btn btn-secondary btn-sm flex-1 text-xs"
                  >
                    Be
                  </button>
                  <button
                    disabled={!canControl}
                    onClick={() => callApi('sucker_off', '/sucker/off')}
                    className="btn btn-secondary btn-sm flex-1 text-xs"
                  >
                    Ki
                  </button>
                </div>
                {typeof device.status?.sucker_state === 'boolean' && (
                  <div className="text-[10px] text-steel-500">
                    Állapot: {device.status.sucker_state ? 'aktív' : 'inaktív'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Lézer (MDI fallback) */}
        {effective.hasLaser && (
          <div className="bg-steel-800/40 rounded-lg p-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-steel-400">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" /> Lézer (M3/M5)
              </span>
              <SourceBadge source={effective.source.hasLaser} runtimeSupported={capabilities?.has_laser === true} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={Math.max(1, effective.maxLaserPower || 1000)}
                step={1}
                value={laserPower}
                onChange={(e) => setLaserPower(parseInt(e.target.value, 10) || 0)}
                className="flex-1"
              />
              <span className="text-xs text-steel-200 font-mono w-14 text-right">S{laserPower}</span>
            </div>
            <div className="flex gap-1">
              <button
                disabled={!canControl}
                onClick={() => turnLaserOn(laserPower)}
                className={`btn btn-sm flex-1 text-xs ${laserOn ? 'btn-warning' : 'btn-secondary'}`}
              >
                Be
              </button>
              <button
                disabled={!canControl}
                onClick={() => turnLaserOff()}
                className="btn btn-secondary btn-sm flex-1 text-xs"
              >
                Ki (M5)
              </button>
            </div>
            <div className="text-[10px] text-steel-500">
              MDI fallback — egyedi backend endpoint nincs, M3/M5 G-kódot küldünk.
            </div>
          </div>
        )}

        {/* Coolant (MDI fallback) */}
        {effective.hasCoolant && (
          <div className="bg-steel-800/40 rounded-lg p-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-steel-400">
              <span className="flex items-center gap-1">
                <Droplets className="w-3 h-3" /> Hűtés (M7/M8/M9)
              </span>
              <SourceBadge source={effective.source.hasCoolant} runtimeSupported={capabilities?.has_coolant === true} />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button
                disabled={!canControl}
                onClick={() => {
                  setCoolantState('flood')
                  sendGcode('coolant_flood', coolantOnGcode('flood'))
                }}
                className={`btn btn-sm text-xs ${coolantState === 'flood' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Flood
              </button>
              <button
                disabled={!canControl}
                onClick={() => {
                  setCoolantState('mist')
                  sendGcode('coolant_mist', coolantOnGcode('mist'))
                }}
                className={`btn btn-sm text-xs ${coolantState === 'mist' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Mist
              </button>
              <button
                disabled={!canControl}
                onClick={() => {
                  setCoolantState('off')
                  sendGcode('coolant_off', coolantOffGcode())
                }}
                className={`btn btn-sm text-xs ${coolantState === 'off' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Ki (M9)
              </button>
            </div>
            <div className="text-[10px] text-steel-500">MDI fallback — M-kódokat küldünk.</div>
          </div>
        )}

        {/* Robot enable/disable */}
        {device.type === 'robot_arm' && (
          <div className="bg-steel-800/40 rounded-lg p-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-steel-400">
              <span className="flex items-center gap-1">
                <Power className="w-3 h-3" /> Motorok
              </span>
            </div>
            <div className="flex gap-1">
              <button
                disabled={!canControl}
                onClick={() => callApi('robot_enable', '/enable')}
                className="btn btn-secondary btn-sm flex-1 text-xs"
              >
                Engedélyez
              </button>
              <button
                disabled={!canControl}
                onClick={() => callApi('robot_disable', '/disable')}
                className="btn btn-secondary btn-sm flex-1 text-xs"
              >
                Letilt
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
