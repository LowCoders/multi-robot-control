import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  Cpu, 
  ListTodo, 
  Zap, 
  Settings,
  Wifi,
  WifiOff,
  Box,
} from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'

interface Props {
  children: ReactNode
}

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/jobs', icon: ListTodo, label: 'Job Manager' },
  { path: '/automation', icon: Zap, label: 'Automatizálás' },
  { path: '/machine-config', icon: Box, label: 'Gép Konfiguráció' },
  { path: '/settings', icon: Settings, label: 'Beállítások' },
]

export default function MainLayout({ children }: Props) {
  const location = useLocation()
  const { connected, devices } = useDeviceStore()
  
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
              <p className="text-xs text-steel-400">Multi-Robot Control</p>
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
                    <span>{item.label}</span>
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
                {connected ? 'Kapcsolódva' : 'Nincs kapcsolat'}
              </span>
            </div>
            <span className="text-steel-400">
              {activeDevices}/{totalDevices} eszköz
            </span>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
