import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { 
  Play, 
  Pause, 
  Trash2, 
  Upload, 
  GripVertical,
  FileCode,
  Clock,
  X,
  Loader2,
  FolderOpen,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Code,
  Box,
  GripHorizontal,
} from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import { MachineVisualization, GcodePanel } from '../components/visualization'
import { useMachineConfig } from '../hooks/useMachineConfig'

interface Job {
  id: string
  name: string
  deviceId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  estimatedTime?: number
  filepath: string
  createdAt?: number
}


interface AddJobModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (job: { name: string; deviceId: string; filepath: string; estimatedTime?: number }) => void
  devices: { id: string; name: string }[]
}

// Előre definiált teszt fájlok
const TEST_FILES = [
  { name: 'test_square.nc', path: '/web/arduino/test_gcode/test_square.nc', time: 2 },
  { name: 'test_circle.nc', path: '/web/arduino/test_gcode/test_circle.nc', time: 3 },
  { name: 'test_engrave.nc', path: '/web/arduino/test_gcode/test_engrave.nc', time: 5 },
]

// Job Visualization Panel - combines G-code and 3D view
interface JobVisualizationPanelProps {
  job: Job
  showGcode: boolean
  show3D: boolean
}

function JobVisualizationPanel({ job, showGcode, show3D }: JobVisualizationPanelProps) {
  const { devices } = useDeviceStore()
  const device = devices.find(d => d.id === job.deviceId)
  const { config: machineConfig, loading: configLoading } = useMachineConfig(
    job.deviceId,
    device?.type
  )
  
  // Resizable state
  const [panelHeight, setPanelHeight] = useState(280)
  const [gcodeWidthPercent, setGcodeWidthPercent] = useState(45)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingH = useRef(false)
  const isDraggingV = useRef(false)
  const lastPosH = useRef(0)
  const lastPosV = useRef(0)

  // Horizontal resize handler (for splitter between 3D and G-code)
  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingH.current = true
    lastPosH.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Vertical resize handler (for panel height)
  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingV.current = true
    lastPosV.current = e.clientY
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingH.current && containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        const delta = e.clientX - lastPosH.current
        lastPosH.current = e.clientX
        const deltaPercent = (delta / containerWidth) * 100
        setGcodeWidthPercent(prev => Math.min(70, Math.max(25, prev - deltaPercent)))
      }
      if (isDraggingV.current) {
        const delta = e.clientY - lastPosV.current
        lastPosV.current = e.clientY
        setPanelHeight(prev => Math.min(500, Math.max(200, prev + delta)))
      }
    }

    const handleMouseUp = () => {
      isDraggingH.current = false
      isDraggingV.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  if (!showGcode && !show3D) return null

  return (
    <div className="border-t border-steel-700 bg-steel-900/50 overflow-hidden flex flex-col">
      {/* Main content area */}
      <div 
        ref={containerRef}
        className="flex overflow-hidden"
        style={{ height: panelHeight }}
      >
        {/* 3D Visualization - left side */}
        {show3D && (
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            {configLoading ? (
              <div className="flex items-center justify-center h-full text-steel-400">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span>Konfiguráció betöltése...</span>
              </div>
            ) : machineConfig ? (
              <MachineVisualization
                config={machineConfig}
                position={device?.status?.position}
                status={device?.status}
                className="h-full"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-steel-400">
                <span>Nincs elérhető konfiguráció</span>
              </div>
            )}
          </div>
        )}
        
        {/* Horizontal resize handle */}
        {show3D && showGcode && (
          <div
            onMouseDown={handleHorizontalMouseDown}
            className="w-1.5 flex-shrink-0 bg-steel-700 hover:bg-machine-500 cursor-col-resize flex items-center justify-center group transition-colors"
          >
            <GripVertical className="w-3 h-3 text-steel-600 group-hover:text-white" />
          </div>
        )}
        
        {/* G-code Panel - right side */}
        {showGcode && (
          <div 
            className="flex-shrink-0 h-full overflow-hidden"
            style={{ width: show3D ? `${gcodeWidthPercent}%` : '100%' }}
          >
            <GcodePanel
              deviceId={job.deviceId}
              filepath={job.filepath}
              status={device?.status}
              showHeader={true}
              className="h-full border-0 rounded-none"
            />
          </div>
        )}
      </div>
      
      {/* Vertical resize handle at bottom */}
      <div
        onMouseDown={handleVerticalMouseDown}
        className="h-1.5 flex-shrink-0 bg-steel-700 hover:bg-machine-500 cursor-row-resize flex items-center justify-center group transition-colors"
      >
        <GripHorizontal className="w-4 h-4 text-steel-600 group-hover:text-white" />
      </div>
    </div>
  )
}

function AddJobModal({ isOpen, onClose, onSubmit, devices }: AddJobModalProps) {
  const [formData, setFormData] = useState(() => {
    const lastDeviceId = loadFromStorage(STORAGE_KEYS.LAST_DEVICE_ID, '')
    return {
      name: '',
      deviceId: lastDeviceId,
      filepath: '',
      estimatedTime: '',
    }
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  useEffect(() => {
    if (devices.length > 0 && !formData.deviceId) {
      // Use stored device or first available
      const lastDeviceId = loadFromStorage(STORAGE_KEYS.LAST_DEVICE_ID, '')
      const validDeviceId = devices.find(d => d.id === lastDeviceId)?.id || devices[0].id
      setFormData(prev => ({ ...prev, deviceId: validDeviceId }))
    }
  }, [devices, formData.deviceId])
  
  // Save selected device to localStorage
  const handleDeviceChange = (deviceId: string) => {
    setFormData({ ...formData, deviceId })
    saveToStorage(STORAGE_KEYS.LAST_DEVICE_ID, deviceId)
  }
  
  if (!isOpen) return null
  
  const handleSelectTestFile = (file: typeof TEST_FILES[0]) => {
    setFormData({
      ...formData,
      name: file.name,
      filepath: file.path,
      estimatedTime: file.time.toString(),
    })
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    await onSubmit({
      name: formData.name || formData.filepath.split('/').pop() || 'Új Job',
      deviceId: formData.deviceId,
      filepath: formData.filepath,
      estimatedTime: formData.estimatedTime ? parseInt(formData.estimatedTime, 10) : undefined,
    })
    
    setIsSubmitting(false)
    setFormData({ name: '', deviceId: devices[0]?.id || '', filepath: '', estimatedTime: '' })
    onClose()
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-lg mx-4">
        <div className="card-header flex items-center justify-between">
          <span className="font-medium">Új Job Hozzáadása</span>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="card-body space-y-4">
          {/* Teszt fájlok */}
          <div>
            <label className="block text-sm text-steel-400 mb-2">Gyors választás (teszt fájlok)</label>
            <div className="grid grid-cols-3 gap-2">
              {TEST_FILES.map(file => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => handleSelectTestFile(file)}
                  className={`
                    p-2 rounded-lg border text-sm text-left transition-colors
                    ${formData.filepath === file.path 
                      ? 'border-machine-500 bg-machine-500/20 text-machine-400' 
                      : 'border-steel-700 hover:border-steel-500 text-steel-300'
                    }
                  `}
                >
                  <FileCode className="w-4 h-4 mb-1" />
                  {file.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="text-center text-steel-500 text-sm">vagy</div>
          
          {/* Manuális fájl útvonal */}
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              <FolderOpen className="w-4 h-4 inline mr-1" />
              Fájl útvonal
            </label>
            <input
              type="text"
              value={formData.filepath}
              onChange={(e) => setFormData({ ...formData, filepath: e.target.value })}
              className="input w-full"
              placeholder="/path/to/file.nc"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-steel-400 mb-1">Job neve (opcionális)</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input w-full"
              placeholder="Automatikus a fájlnév alapján"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">Cél eszköz</label>
              <select
                value={formData.deviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="input w-full"
                required
              >
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm text-steel-400 mb-1">Becsült idő (perc)</label>
              <input
                type="number"
                value={formData.estimatedTime}
                onChange={(e) => setFormData({ ...formData, estimatedTime: e.target.value })}
                className="input w-full"
                placeholder="Opcionális"
                min="1"
              />
            </div>
          </div>
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              Mégse
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.filepath || !formData.deviceId}
              className="btn btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Hozzáadás
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// LocalStorage keys
const STORAGE_KEYS = {
  EXECUTION_MODE: 'jobManager.executionMode',
  LAST_DEVICE_ID: 'jobManager.lastDeviceId',
}

// Helper functions for localStorage
const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

const saveToStorage = <T,>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('Failed to save to localStorage:', error)
  }
}

export default function JobManager() {
  const { devices } = useDeviceStore()
  
  // Load initial values from localStorage
  const [executionMode, setExecutionMode] = useState<'sequential' | 'parallel' | 'manual'>(() => 
    loadFromStorage(STORAGE_KEYS.EXECUTION_MODE, 'sequential')
  )
  const [jobs, setJobs] = useState<Job[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddJob, setShowAddJob] = useState(false)
  const [isRunningAll, setIsRunningAll] = useState(false)
  // Track which views are expanded per job
  const [expandedViews, setExpandedViews] = useState<Record<string, { gcode: boolean; viz3d: boolean }>>({})
  
  // Toggle G-code view for a job
  const toggleGcode = (jobId: string) => {
    setExpandedViews(prev => ({
      ...prev,
      [jobId]: {
        gcode: !prev[jobId]?.gcode,
        viz3d: prev[jobId]?.viz3d ?? false,
      }
    }))
  }
  
  // Toggle 3D view for a job
  const toggle3D = (jobId: string) => {
    setExpandedViews(prev => ({
      ...prev,
      [jobId]: {
        gcode: prev[jobId]?.gcode ?? false,
        viz3d: !prev[jobId]?.viz3d,
      }
    }))
  }
  
  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  
  // Load jobs from API and sync mode from backend on first load
  useEffect(() => {
    let isFirstLoad = true
    
    const loadJobs = async () => {
      try {
        const response = await fetch('/api/jobs')
        if (response.ok) {
          const data = await response.json()
          setJobs(data.jobs)
          
          // On first load, sync localStorage mode with backend
          if (isFirstLoad && data.executionMode) {
            // If localStorage has a different mode, update backend
            const storedMode = loadFromStorage(STORAGE_KEYS.EXECUTION_MODE, 'sequential')
            if (storedMode !== data.executionMode) {
              // Update backend to match localStorage
              fetch('/api/jobs/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: storedMode }),
              }).catch(console.error)
            }
            isFirstLoad = false
          }
        }
      } catch (error) {
        console.error('Failed to load jobs:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadJobs()
    
    // Poll faster when jobs are running
    const hasRunningJobs = jobs.some(j => j.status === 'running')
    const pollInterval = hasRunningJobs ? 500 : 2000
    const interval = setInterval(loadJobs, pollInterval)
    return () => clearInterval(interval)
  }, [jobs.some(j => j.status === 'running')])
  
  // Sync execution mode with backend and localStorage
  const handleModeChange = async (mode: typeof executionMode) => {
    setExecutionMode(mode)
    saveToStorage(STORAGE_KEYS.EXECUTION_MODE, mode)
    
    try {
      await fetch('/api/jobs/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
    } catch (error) {
      console.error('Failed to update mode:', error)
    }
  }
  
  const handleAddJob = async (jobData: { name: string; deviceId: string; filepath: string; estimatedTime?: number }) => {
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData),
      })
      
      if (response.ok) {
        const newJob = await response.json()
        setJobs([...jobs, newJob])
      }
    } catch (error) {
      console.error('Failed to add job:', error)
    }
  }
  
  const handleRunJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/run`, {
        method: 'POST',
      })
      
      if (response.ok) {
        const data = await response.json()
        setJobs(jobs.map(j => j.id === jobId ? data.job : j))
      }
    } catch (error) {
      console.error('Failed to run job:', error)
    }
  }
  
  const handlePauseJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/pause`, {
        method: 'POST',
      })
      
      if (response.ok) {
        const data = await response.json()
        setJobs(jobs.map(j => j.id === jobId ? data.job : j))
      }
    } catch (error) {
      console.error('Failed to pause job:', error)
    }
  }
  
  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Biztosan törölni szeretnéd ezt a job-ot?')) return
    
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        setJobs(jobs.filter(j => j.id !== jobId))
        // Clean up expanded views state
        setExpandedViews(prev => {
          const { [jobId]: _, ...rest } = prev
          return rest
        })
      }
    } catch (error) {
      console.error('Failed to delete job:', error)
    }
  }
  
  const handleRunAll = async () => {
    setIsRunningAll(true)
    try {
      const response = await fetch('/api/jobs/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: executionMode }),
      })
      
      if (response.ok) {
        // Refresh jobs list
        const jobsResponse = await fetch('/api/jobs')
        if (jobsResponse.ok) {
          const data = await jobsResponse.json()
          setJobs(data.jobs)
        }
      }
    } catch (error) {
      console.error('Failed to run all jobs:', error)
    } finally {
      setIsRunningAll(false)
    }
  }
  
  // Drag and Drop handlers - allow reordering all non-running jobs
  const canDrag = (job: Job) => job.status !== 'running'
  
  const handleDragStart = (e: React.DragEvent, index: number) => {
    const job = jobs[index]
    if (!canDrag(job)) {
      e.preventDefault()
      return
    }
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
  }
  
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }
  
  const handleDragLeave = () => {
    setDragOverIndex(null)
  }
  
  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }
    
    // Reorder locally first for instant feedback
    const newJobs = [...jobs]
    const [draggedJob] = newJobs.splice(draggedIndex, 1)
    newJobs.splice(dropIndex, 0, draggedJob)
    setJobs(newJobs)
    
    // Send reorder to backend
    try {
      await fetch('/api/jobs/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newJobs.map(j => j.id) }),
      })
    } catch (error) {
      console.error('Failed to reorder jobs:', error)
    }
    
    setDraggedIndex(null)
    setDragOverIndex(null)
  }
  
  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }
  
  const getDeviceName = (deviceId: string) => {
    const device = devices.find(d => d.id === deviceId)
    return device?.name || deviceId
  }
  
  const getStatusColor = (status: Job['status']) => {
    switch (status) {
      case 'completed': return 'text-green-400'
      case 'running': return 'text-blue-400'
      case 'pending': return 'text-steel-400'
      case 'failed': return 'text-red-400'
    }
  }
  
  const getStatusIcon = (status: Job['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4" />
      case 'running': return <Loader2 className="w-4 h-4 animate-spin" />
      case 'pending': return <Clock className="w-4 h-4" />
      case 'failed': return <AlertCircle className="w-4 h-4" />
    }
  }
  
  const getStatusLabel = (status: Job['status']) => {
    switch (status) {
      case 'completed': return 'Kész'
      case 'running': return 'Fut'
      case 'pending': return 'Várakozik'
      case 'failed': return 'Sikertelen'
    }
  }
  
  const pendingCount = jobs.filter(j => j.status === 'pending').length
  const runningCount = jobs.filter(j => j.status === 'running').length
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Job Manager</h1>
          <p className="text-steel-400">Munkák kezelése és ütemezése</p>
        </div>
        
        <button 
          onClick={() => setShowAddJob(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          Fájl Feltöltés
        </button>
      </div>
      
      {/* Add Job Modal */}
      <AddJobModal
        isOpen={showAddJob}
        onClose={() => setShowAddJob(false)}
        onSubmit={handleAddJob}
        devices={devices.map(d => ({ id: d.id, name: d.name }))}
      />
      
      {/* Execution Mode */}
      <div className="card">
        <div className="card-body">
          <label className="text-sm text-steel-400 mb-2 block">Végrehajtási Mód</label>
          <div className="flex gap-2">
            {[
              { value: 'sequential', label: 'Szekvenciális', desc: 'Egymás után' },
              { value: 'parallel', label: 'Párhuzamos', desc: 'Egyszerre' },
              { value: 'manual', label: 'Manuális', desc: 'Kézi indítás' },
            ].map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => handleModeChange(value as typeof executionMode)}
                className={`
                  flex-1 py-2 px-3 rounded-md font-medium transition-colors text-left
                  ${executionMode === value 
                    ? 'bg-machine-600 text-white' 
                    : 'bg-steel-800 text-steel-300 hover:bg-steel-700'
                  }
                `}
              >
                <div>{label}</div>
                <div className="text-xs opacity-70">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Job Queue */}
      <div className="card">
        <div className="card-header">
          <div>
            <span className="font-medium">Job Queue</span>
            <span className="text-sm text-steel-400 ml-2">
              ({pendingCount} várakozik, {runningCount} fut)
            </span>
          </div>
          <button 
            onClick={handleRunAll}
            disabled={isRunningAll || pendingCount === 0}
            className="btn btn-primary btn-sm flex items-center gap-1 disabled:opacity-50"
          >
            {isRunningAll ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Start All
          </button>
        </div>
        <div className="divide-y divide-steel-700">
          {isLoading ? (
            <div className="p-8 text-center text-steel-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Betöltés...
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-steel-400">
              <FileCode className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nincs job a queue-ban.</p>
              <button 
                onClick={() => setShowAddJob(true)}
                className="text-machine-400 hover:text-machine-300 mt-2"
              >
                Tölts fel G-code fájlokat
              </button>
            </div>
          ) : (
            jobs.map((job, index) => (
              <div key={job.id}>
                <div 
                  draggable={canDrag(job)}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`
                    p-4 flex items-center gap-4 transition-all
                    ${draggedIndex === index ? 'opacity-50' : ''}
                    ${dragOverIndex === index ? 'bg-machine-600/20 border-t-2 border-machine-500' : 'hover:bg-steel-800/50'}
                    ${canDrag(job) ? 'cursor-grab active:cursor-grabbing' : ''}
                  `}
                >
                  {/* Drag handle */}
                  <div className={`${canDrag(job) ? 'text-steel-500 hover:text-steel-300' : 'text-steel-700'}`}>
                    <GripVertical className="w-5 h-5" />
                  </div>
                  
                  {/* Index */}
                  <div className="w-8 h-8 rounded-full bg-steel-800 flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-steel-400" />
                      <span className="font-medium text-white truncate">{job.name}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm">
                      <Link 
                        to={`/device/${job.deviceId}`}
                        className="text-steel-400 hover:text-machine-400 transition-colors"
                      >
                        Eszköz: {getDeviceName(job.deviceId)}
                      </Link>
                      {job.estimatedTime && (
                        <span className="flex items-center gap-1 text-steel-400">
                          <Clock className="w-3 h-3" />
                          {job.estimatedTime} perc
                        </span>
                      )}
                    </div>
                    
                    {/* Progress bar for running jobs */}
                    {job.status === 'running' && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-steel-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-steel-400 mt-1">{Math.round(job.progress)}%</div>
                      </div>
                    )}
                  </div>
                  
                  {/* Status */}
                  <div className={`flex items-center gap-1.5 text-sm font-medium ${getStatusColor(job.status)}`}>
                    {getStatusIcon(job.status)}
                    {getStatusLabel(job.status)}
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {/* G-code viewer toggle */}
                    <button 
                      onClick={() => toggleGcode(job.id)}
                      className={`btn-icon ${expandedViews[job.id]?.gcode ? 'text-machine-400 bg-machine-500/20' : 'text-steel-400 hover:text-steel-300'}`}
                      title={expandedViews[job.id]?.gcode ? 'G-code elrejtése' : 'G-code megjelenítése'}
                    >
                      <Code className="w-4 h-4" />
                    </button>
                    
                    {/* 3D Visualization toggle */}
                    <button 
                      onClick={() => toggle3D(job.id)}
                      className={`btn-icon ${expandedViews[job.id]?.viz3d ? 'text-blue-400 bg-blue-500/20' : 'text-steel-400 hover:text-steel-300'}`}
                      title={expandedViews[job.id]?.viz3d ? '3D nézet elrejtése' : '3D nézet megjelenítése'}
                    >
                      <Box className="w-4 h-4" />
                    </button>
                    
                    {/* Expand indicator when any view is open */}
                    {(expandedViews[job.id]?.gcode || expandedViews[job.id]?.viz3d) && (
                      <ChevronDown className="w-4 h-4 text-steel-500" />
                    )}
                    
                    <div className="w-px h-4 bg-steel-700 mx-1" />
                    
                    {(job.status === 'pending' || job.status === 'completed' || job.status === 'failed') && (
                      <button 
                        onClick={() => handleRunJob(job.id)}
                        className="btn-icon text-machine-400 hover:text-machine-300"
                        title={job.status === 'pending' ? 'Indítás' : 'Újraindítás'}
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    {job.status === 'running' && (
                      <button 
                        onClick={() => handlePauseJob(job.id)}
                        className="btn-icon text-amber-400 hover:text-amber-300"
                        title="Szünet"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    )}
                    <button 
                      onClick={() => handleDeleteJob(job.id)}
                      className="btn-icon text-red-400 hover:text-red-300"
                      title="Törlés"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {/* Inline Visualization Panel */}
                <JobVisualizationPanel 
                  job={job} 
                  showGcode={expandedViews[job.id]?.gcode ?? false}
                  show3D={expandedViews[job.id]?.viz3d ?? false}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
