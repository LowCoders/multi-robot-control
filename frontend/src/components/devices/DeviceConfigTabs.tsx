import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Gauge, Activity, SlidersHorizontal, Wrench } from 'lucide-react'
import { Tabs, TabPanel } from '../common/Tabs'
import ControlPanelContent from './ControlPanelContent'
import MotorTuningPanel from './MotorTuningPanel'
import DiagnosticsPanel from './DiagnosticsPanel'
import GrblConfigPanel from './GrblConfigPanel'
import MachineConfigTab from './MachineConfigTab'
import type { Device, DeviceCapabilities } from '../../types/device'
import type { MachineConfig } from '../../types/machine-config'

type TabId = 'control' | 'motor-tuning' | 'diagnostics' | 'grbl-config' | 'config'

interface DeviceConfigTabsProps {
  device: Device
  machineConfig: MachineConfig | null
  configLoading: boolean
  sendCommand: (deviceId: string, command: string) => void
  jogStop: (deviceId: string) => void
  capabilities?: DeviceCapabilities
  enabledTabs?: TabId[]
  defaultTab?: TabId
}

export default function DeviceConfigTabs({
  device,
  machineConfig,
  configLoading,
  sendCommand,
  jogStop,
  capabilities,
  enabledTabs = ['control', 'motor-tuning', 'diagnostics', 'config'],
  defaultTab = 'control',
}: DeviceConfigTabsProps) {
  const { t } = useTranslation('devices')
  const initialTab = enabledTabs.includes(defaultTab) ? defaultTab : enabledTabs[0]
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'control')

  const allTabs = useMemo(
    () => [
      {
        id: 'control' as const,
        label: t('device_config_tabs.control'),
        icon: Monitor,
        disabled: !enabledTabs.includes('control'),
      },
      {
        id: 'motor-tuning' as const,
        label: t('device_config_tabs.motor_tuning'),
        icon: Gauge,
        disabled: !enabledTabs.includes('motor-tuning'),
      },
      {
        id: 'diagnostics' as const,
        label: t('device_config_tabs.diagnostics'),
        icon: Activity,
        disabled: !enabledTabs.includes('diagnostics'),
      },
      {
        id: 'grbl-config' as const,
        label: t('device_config_tabs.grbl_config'),
        icon: SlidersHorizontal,
        disabled: !enabledTabs.includes('grbl-config'),
      },
      {
        id: 'config' as const,
        label: t('device_config_tabs.machine_config'),
        icon: Wrench,
        disabled: !enabledTabs.includes('config'),
      },
    ],
    [t, enabledTabs],
  )

  const tabs = allTabs.filter(tab => enabledTabs.includes(tab.id))

  return (
    <div className="card">
      <Tabs 
        tabs={tabs} 
        activeTab={activeTab} 
        onTabChange={(id) => setActiveTab(id as TabId)} 
      />
      
      <div className="card-body">
        <TabPanel isActive={activeTab === 'control'} keepMounted>
          <ControlPanelContent
            device={device}
            machineConfig={machineConfig}
            configLoading={configLoading}
            sendCommand={sendCommand}
            jogStop={jogStop}
            capabilities={capabilities}
          />
        </TabPanel>

        <TabPanel isActive={activeTab === 'motor-tuning'} keepMounted>
          <MotorTuningPanel 
            deviceId={device.id} 
            capabilities={capabilities}
            embedded 
          />
        </TabPanel>

        <TabPanel isActive={activeTab === 'diagnostics'} keepMounted>
          <DiagnosticsPanel 
            deviceId={device.id} 
            capabilities={capabilities}
            embedded 
          />
        </TabPanel>

        <TabPanel isActive={activeTab === 'grbl-config'} keepMounted>
          <GrblConfigPanel deviceId={device.id} />
        </TabPanel>

        <TabPanel isActive={activeTab === 'config'} keepMounted>
          <MachineConfigTab 
            deviceId={device.id}
            deviceName={device.name}
            deviceType={device.type}
            capabilities={capabilities}
          />
        </TabPanel>
      </div>
    </div>
  )
}
