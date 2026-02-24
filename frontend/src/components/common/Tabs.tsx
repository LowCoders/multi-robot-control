import { type ReactNode, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

export interface TabDefinition {
  id: string
  label: string
  icon?: ComponentType<LucideProps>
  disabled?: boolean
}

interface TabsProps {
  tabs: TabDefinition[]
  activeTab: string
  onTabChange: (tabId: string) => void
  variant?: 'default' | 'card'
  size?: 'sm' | 'md'
}

export function Tabs({ 
  tabs, 
  activeTab, 
  onTabChange, 
  variant = 'default',
  size = 'md' 
}: TabsProps) {
  const baseClass = variant === 'card' 
    ? 'bg-steel-900 rounded-t-lg' 
    : 'border-b border-steel-700'

  const buttonSize = size === 'sm' 
    ? 'px-3 py-2 text-xs' 
    : 'px-4 py-2.5 text-sm'

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <div className={`flex ${baseClass}`}>
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        const isDisabled = tab.disabled
        
        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={`
              flex items-center gap-1.5 ${buttonSize} font-medium border-b-2 transition-colors
              ${isActive
                ? 'border-machine-500 text-machine-400'
                : isDisabled
                  ? 'border-transparent text-steel-600 cursor-not-allowed'
                  : 'border-transparent text-steel-400 hover:text-steel-200'
              }
            `}
          >
            {Icon && <Icon className={iconSize} />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

interface TabPanelProps {
  children: ReactNode
  isActive: boolean
  className?: string
  keepMounted?: boolean
}

export function TabPanel({ children, isActive, className = '', keepMounted = false }: TabPanelProps) {
  if (!keepMounted && !isActive) return null
  
  return (
    <div className={`${className} ${keepMounted && !isActive ? 'hidden' : ''}`}>
      {children}
    </div>
  )
}

interface TabContentProps {
  tabs: TabDefinition[]
  activeTab: string
  onTabChange: (tabId: string) => void
  children: ReactNode
  variant?: 'default' | 'card'
  size?: 'sm' | 'md'
  className?: string
}

export function TabContent({
  tabs,
  activeTab,
  onTabChange,
  children,
  variant = 'default',
  size = 'md',
  className = ''
}: TabContentProps) {
  return (
    <div className={className}>
      <Tabs 
        tabs={tabs} 
        activeTab={activeTab} 
        onTabChange={onTabChange}
        variant={variant}
        size={size}
      />
      <div className={variant === 'card' ? 'bg-steel-900 rounded-b-lg p-4' : 'pt-4'}>
        {children}
      </div>
    </div>
  )
}

export default Tabs
