import { ReactNode, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  LayoutDashboard, 
  Cpu, 
  ListTodo, 
  Zap, 
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'
import LanguageSwitcher from '../common/LanguageSwitcher'

interface Props {
  children: ReactNode
}

export default function MainLayout({ children }: Props) {
  const location = useLocation()
  const { connected, devices } = useDeviceStore()
  const { t } = useTranslation('common')

  const navItems = useMemo(
    () =>
      [
        { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' as const },
        { path: '/jobs', icon: ListTodo, labelKey: 'nav.jobs' as const },
        { path: '/automation', icon: Zap, labelKey: 'nav.automation' as const },
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' as const },
      ] as const,
    [],
  )
  
  const activeDevices = devices.filter(d => d.connected).length
  const totalDevices = devices.length
  
  return (
    <div className="min-h-screen bg-steel-950 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-steel-900 border-r border-steel-700 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-steel-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-machine-500 to-machine-700 rounded-lg flex items-center justify-center">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-white">Robot Hub</h1>
              <p className="text-xs text-steel-400">{t('layout.brandSubtitle')}</p>
            </div>
          </div>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path
              const Icon = item.icon
              
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`
                      flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
                      ${isActive 
                        ? 'bg-machine-600/20 text-machine-400' 
                        : 'text-steel-300 hover:bg-steel-800 hover:text-white'
                      }
                    `}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        
        {/* Status */}
        <div className="p-4 border-t border-steel-700">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {connected ? (
                <Wifi className="w-4 h-4 text-machine-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
              <span className={connected ? 'text-machine-400' : 'text-red-400'}>
                {connected ? t('layout.connection.connected') : t('layout.connection.disconnected')}
              </span>
            </div>
            <span className="text-steel-400">
              {t('layout.deviceCount', { active: activeDevices, total: totalDevices })}
            </span>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="shrink-0 flex justify-end items-center px-6 pt-4 pb-2">
          <LanguageSwitcher />
        </div>
        <div className="flex-1 overflow-auto p-6 pt-2">
          {children}
        </div>
      </main>
    </div>
  )
}
