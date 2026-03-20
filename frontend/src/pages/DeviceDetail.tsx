import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import StatusBadge from '../components/common/StatusBadge'
import DeviceConfigTabs from '../components/devices/DeviceConfigTabs'
import { useMachineConfig } from '../hooks/useMachineConfig'

export default function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const { devices, sendCommand, jogStop } = useDeviceStore()

  const device = devices.find((d) => d.id === deviceId)
  const { config: machineConfig, loading: configLoading } = useMachineConfig(
    deviceId ?? '',
    device?.type
  )

  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-steel-400 mb-4">Eszköz nem található</p>
        <Link to="/" className="btn btn-primary">
          Vissza a Dashboard-ra
        </Link>
      </div>
    )
  }

  const isDisconnected = device.state === 'disconnected' || !device.connected

  const handleReconnect = () => {
    sendCommand(device.id, 'connect')
  }

  const isRobotArm = device.type === 'robot_arm'
  const isGrblCompatible =
    device.driver === 'grbl' || machineConfig?.driverConfig?.protocol === 'grbl'
  const enabledTabs: ('control' | 'motor-tuning' | 'diagnostics' | 'grbl-config' | 'config')[] =
    isRobotArm
      ? [
          'control',
          'motor-tuning',
          'diagnostics',
          ...(isGrblCompatible ? (['grbl-config'] as const) : []),
          'config',
        ]
      : ['control', ...(isGrblCompatible ? (['grbl-config'] as const) : []), 'config']

  return (
    <div className="space-y-6">
      {/* Disconnected Warning Banner */}
      {isDisconnected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-red-300 font-medium">Eszköz nem elérhető</h3>
              <p className="text-sm text-red-400/80 mt-1">
                {device.lastError || 'Az eszköz nincs csatlakoztatva vagy nem válaszol.'}
              </p>
              {device.simulated === false && (
                <p className="text-xs text-steel-500 mt-2">
                  Ellenőrizd a soros port kapcsolatot ({device.connectionInfo || '/dev/ttyUSB*'}) és
                  a hardver állapotát.
                </p>
              )}
              <button
                onClick={handleReconnect}
                className="mt-3 btn btn-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
              >
                Újracsatlakozás
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="btn-icon hover:bg-steel-800">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">{device.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge state={device.state} />
              <span className="text-sm text-steel-400">{device.driver.toUpperCase()}</span>
              {device.simulated && (
                <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">
                  Szimulált
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Tabs - Control Panel, Motor Tuning, Diagnostics, Machine Config */}
      <DeviceConfigTabs
        device={device}
        machineConfig={machineConfig}
        configLoading={configLoading}
        sendCommand={sendCommand}
        jogStop={jogStop}
        capabilities={device.capabilities}
        enabledTabs={enabledTabs}
        defaultTab="control"
      />
    </div>
  )
}
