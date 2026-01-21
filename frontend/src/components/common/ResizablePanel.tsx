import { useState, useRef, useCallback, useEffect } from 'react'
import { GripVertical, GripHorizontal } from 'lucide-react'

export function ResizableHandle({ 
  direction, 
  onDrag 
}: { 
  direction: 'horizontal' | 'vertical'
  onDrag: (delta: number) => void 
}) {
  const handleRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [direction])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = currentPos - lastPos.current
      lastPos.current = currentPos
      onDrag(delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [direction, onDrag])

  if (direction === 'horizontal') {
    return (
      <div
        ref={handleRef}
        onMouseDown={handleMouseDown}
        className="w-2 flex-shrink-0 bg-steel-700 hover:bg-machine-600 cursor-col-resize flex items-center justify-center group transition-colors"
      >
        <GripVertical className="w-3 h-3 text-steel-500 group-hover:text-white" />
      </div>
    )
  }

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className="h-2 flex-shrink-0 bg-steel-700 hover:bg-machine-600 cursor-row-resize flex items-center justify-center group transition-colors"
    >
      <GripHorizontal className="w-4 h-4 text-steel-500 group-hover:text-white" />
    </div>
  )
}

interface SplitPanelProps {
  left: React.ReactNode
  right: React.ReactNode
  initialRightWidth?: number  // percentage
  minRightWidth?: number      // percentage
  maxRightWidth?: number      // percentage
  className?: string
}

export function HorizontalSplitPanel({
  left,
  right,
  initialRightWidth = 40,
  minRightWidth = 20,
  maxRightWidth = 70,
  className = '',
}: SplitPanelProps) {
  const [rightWidthPercent, setRightWidthPercent] = useState(initialRightWidth)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDrag = useCallback((delta: number) => {
    if (!containerRef.current) return
    
    const containerWidth = containerRef.current.offsetWidth
    const deltaPercent = (delta / containerWidth) * 100
    
    setRightWidthPercent(prev => {
      const newWidth = prev - deltaPercent  // negative because dragging right shrinks right panel
      return Math.min(maxRightWidth, Math.max(minRightWidth, newWidth))
    })
  }, [minRightWidth, maxRightWidth])

  return (
    <div ref={containerRef} className={`flex h-full ${className}`}>
      {/* Left panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {left}
      </div>
      
      {/* Resize handle */}
      <ResizableHandle direction="horizontal" onDrag={handleDrag} />
      
      {/* Right panel */}
      <div 
        className="flex-shrink-0 h-full overflow-hidden"
        style={{ width: `${rightWidthPercent}%` }}
      >
        {right}
      </div>
    </div>
  )
}

interface ResizableHeightPanelProps {
  children: React.ReactNode
  initialHeight?: number  // pixels
  minHeight?: number
  maxHeight?: number
  className?: string
}

export function ResizableHeightPanel({
  children,
  initialHeight = 300,
  minHeight = 150,
  maxHeight = 600,
  className = '',
}: ResizableHeightPanelProps) {
  const [height, setHeight] = useState(initialHeight)

  const handleDrag = useCallback((delta: number) => {
    setHeight(prev => Math.min(maxHeight, Math.max(minHeight, prev + delta)))
  }, [minHeight, maxHeight])

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Content */}
      <div className="overflow-hidden" style={{ height }}>
        {children}
      </div>
      
      {/* Resize handle at bottom */}
      <ResizableHandle direction="vertical" onDrag={handleDrag} />
    </div>
  )
}
