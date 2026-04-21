import { useState, useEffect } from 'react'
import { 
  Plus, 
  Zap, 
  Trash2, 
  Edit2,
  ToggleLeft,
  ToggleRight,
  X,
  Save,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../stores/deviceStore'
import { createLogger } from '../utils/logger'

const log = createLogger('automation')

interface Rule {
  id: string
  name: string
  description: string
  enabled: boolean
  trigger: {
    type: string
    device?: string
    condition?: Record<string, unknown>
  }
  actions: {
    type: string
    device?: string
    params?: Record<string, unknown>
  }[]
}

const TRIGGER_VALUES = [
  'job_complete',
  'state_change',
  'position',
  'timer',
  'manual',
] as const

const ACTION_VALUES = ['run', 'pause', 'stop', 'home', 'send_gcode', 'notify'] as const

interface RuleEditorProps {
  rule: Rule | null
  isNew: boolean
  onSave: (rule: Partial<Rule>) => void
  onCancel: () => void
  devices: { id: string; name: string }[]
}

function RuleEditor({ rule, isNew, onSave, onCancel, devices }: RuleEditorProps) {
  const { t } = useTranslation('pages')
  const [formData, setFormData] = useState<Partial<Rule>>({
    name: '',
    description: '',
    enabled: true,
    trigger: { type: 'job_complete' },
    actions: [{ type: 'run' }],
  })
  const [isSaving, setIsSaving] = useState(false)
  
  useEffect(() => {
    if (rule) {
      setFormData({
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        trigger: { ...rule.trigger },
        actions: [...rule.actions],
      })
    } else {
      setFormData({
        name: '',
        description: '',
        enabled: true,
        trigger: { type: 'job_complete' },
        actions: [{ type: 'run' }],
      })
    }
  }, [rule])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    await onSave(formData)
    setIsSaving(false)
  }
  
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span className="font-medium">
          {isNew ? t('automation.editor.new_rule') : t('automation.editor.edit_rule')}
        </span>
        <button onClick={onCancel} className="text-steel-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="card-body space-y-4">
        <div>
          <label className="block text-sm text-steel-400 mb-1">
            {t('automation.editor.rule_name_label')}
          </label>
          <input
            type="text"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="input w-full"
            placeholder={t('automation.editor.rule_name_placeholder')}
            required
          />
        </div>
        
        <div>
          <label className="block text-sm text-steel-400 mb-1">
            {t('automation.editor.description_label')}
          </label>
          <input
            type="text"
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="input w-full"
            placeholder={t('automation.editor.description_placeholder')}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('automation.editor.trigger_type')}
            </label>
            <select
              value={formData.trigger?.type || 'job_complete'}
              onChange={(e) => setFormData({
                ...formData,
                trigger: { ...formData.trigger, type: e.target.value }
              })}
              className="input w-full"
            >
              {TRIGGER_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`automation.triggers.${value}`)}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('automation.editor.trigger_device')}
            </label>
            <select
              value={formData.trigger?.device || ''}
              onChange={(e) => setFormData({
                ...formData,
                trigger: { type: formData.trigger?.type || 'state_change', ...formData.trigger, device: e.target.value || undefined }
              })}
              className="input w-full"
            >
              <option value="">{t('automation.editor.any_device')}</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('automation.editor.action_type')}
            </label>
            <select
              value={formData.actions?.[0]?.type || 'run'}
              onChange={(e) => setFormData({
                ...formData,
                actions: [{ ...formData.actions?.[0], type: e.target.value }]
              })}
              className="input w-full"
            >
              {ACTION_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`automation.actions.${value}`)}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('automation.editor.target_device')}
            </label>
            <select
              value={formData.actions?.[0]?.device || ''}
              onChange={(e) => setFormData({
                ...formData,
                actions: [{ type: formData.actions?.[0]?.type || 'run', ...formData.actions?.[0], device: e.target.value || undefined }]
              })}
              className="input w-full"
            >
              <option value="">{t('automation.editor.target_default')}</option>
              <option value="all">{t('automation.editor.all_devices')}</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary flex-1"
          >
            {t('automation.editor.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSaving || !formData.name}
            className="btn btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isNew ? t('automation.editor.create') : t('automation.editor.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Automation() {
  const { t } = useTranslation('pages')
  const [rules, setRules] = useState<Rule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const { devices } = useDeviceStore()
  
  // Load rules from API
  useEffect(() => {
    const loadRules = async () => {
      try {
        const response = await fetch('/api/automation/rules')
        if (response.ok) {
          const data = await response.json()
          setRules(data.rules)
        }
      } catch (error) {
        log.error('Failed to load rules:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadRules()
  }, [])
  
  const toggleRule = async (ruleId: string) => {
    try {
      const response = await fetch(`/api/automation/rules/${ruleId}/toggle`, {
        method: 'POST',
      })
      if (response.ok) {
        const updatedRule = await response.json()
        setRules(rules.map(r => r.id === ruleId ? updatedRule : r))
      }
    } catch (error) {
      log.error('Failed to toggle rule:', error)
    }
  }
  
  const deleteRule = async (ruleId: string) => {
    if (!confirm(t('automation.confirm_delete_rule'))) return
    
    try {
      const response = await fetch(`/api/automation/rules/${ruleId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setRules(rules.filter(r => r.id !== ruleId))
      }
    } catch (error) {
      log.error('Failed to delete rule:', error)
    }
  }
  
  const handleSaveRule = async (ruleData: Partial<Rule>) => {
    try {
      if (isCreatingNew) {
        const response = await fetch('/api/automation/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ruleData),
        })
        if (response.ok) {
          const newRule = await response.json()
          setRules([...rules, newRule])
          setIsCreatingNew(false)
        }
      } else if (editingRule) {
        const response = await fetch(`/api/automation/rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ruleData),
        })
        if (response.ok) {
          const updatedRule = await response.json()
          setRules(rules.map(r => r.id === editingRule.id ? updatedRule : r))
          setEditingRule(null)
        }
      }
    } catch (error) {
      log.error('Failed to save rule:', error)
    }
  }
  
  const handleCancelEdit = () => {
    setEditingRule(null)
    setIsCreatingNew(false)
  }
  
  const getTriggerLabel = (trigger: Rule['trigger']) =>
    String(t(`automation.triggers.${trigger.type}`, { defaultValue: trigger.type }))
  const getActionLabel = (action: Rule['actions'][0]) =>
    String(t(`automation.actions.${action.type}`, { defaultValue: action.type }))
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('automation.title')}</h1>
          <p className="text-steel-400">{t('automation.subtitle')}</p>
        </div>
        
        <button 
          onClick={() => { setIsCreatingNew(true); setEditingRule(null); }}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('automation.new_rule')}
        </button>
      </div>
      
      {/* Rule Editor */}
      {(isCreatingNew || editingRule) && (
        <RuleEditor
          rule={editingRule}
          isNew={isCreatingNew}
          onSave={handleSaveRule}
          onCancel={handleCancelEdit}
          devices={devices.map(d => ({ id: d.id, name: d.name }))}
        />
      )}
      
      {/* Active Rules */}
      <div className="card">
        <div className="card-header">
          <span className="font-medium">{t('automation.rules_heading')}</span>
          <span className="text-sm text-steel-400">
            {t('automation.active_count', { count: rules.filter((r) => r.enabled).length })}
          </span>
        </div>
        <div className="divide-y divide-steel-700">
          {isLoading ? (
            <div className="p-8 text-center text-steel-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              {t('automation.loading')}
            </div>
          ) : rules.length === 0 ? (
            <div className="p-8 text-center text-steel-400">{t('automation.empty')}</div>
          ) : (
            rules.map((rule) => (
              <div 
                key={rule.id}
                className={`
                  p-4 transition-colors
                  ${rule.enabled ? 'bg-steel-900' : 'bg-steel-900/50 opacity-60'}
                `}
              >
                <div className="flex items-start gap-4">
                  {/* Toggle */}
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`
                      mt-1 transition-colors
                      ${rule.enabled ? 'text-machine-400' : 'text-steel-500'}
                    `}
                  >
                    {rule.enabled ? (
                      <ToggleRight className="w-6 h-6" />
                    ) : (
                      <ToggleLeft className="w-6 h-6" />
                    )}
                  </button>
                  
                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${rule.enabled ? 'text-amber-400' : 'text-steel-500'}`} />
                      <span className="font-medium text-white">{rule.name}</span>
                    </div>
                    <p className="text-sm text-steel-400 mt-1">{rule.description}</p>
                    
                    <div className="flex items-center gap-4 mt-3 text-sm">
                      <div>
                        <span className="text-steel-500">{t('automation.when_prefix')} </span>
                        <span className="text-steel-300">
                          {getTriggerLabel(rule.trigger)}
                          {rule.trigger.device && ` (${rule.trigger.device})`}
                        </span>
                      </div>
                      <div>
                        <span className="text-steel-500">{t('automation.then_prefix')} </span>
                        <span className="text-steel-300">
                          {rule.actions.map(a => getActionLabel(a)).join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => { setEditingRule(rule); setIsCreatingNew(false); }}
                      className="btn-icon"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => deleteRule(rule.id)}
                      className="btn-icon text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
