import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'

type LocalNotificationState = {
  fading: boolean
}

const DISPLAY_MS = 7000
const FADE_MS = 500

export default function NotificationOverlay() {
  const { t } = useTranslation('common')
  const { notifications, clearNotification } = useDeviceStore()
  const [localState, setLocalState] = useState<Record<string, LocalNotificationState>>({})
  const fadeTimersRef = useRef<Record<string, number>>({})
  const removeTimersRef = useRef<Record<string, number>>({})

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
    [notifications]
  )

  useEffect(() => {
    const sortedIds = new Set(sorted.map((n) => n.id))

    for (const id of Object.keys(fadeTimersRef.current)) {
      if (!sortedIds.has(id)) {
        window.clearTimeout(fadeTimersRef.current[id])
        delete fadeTimersRef.current[id]
      }
    }
    for (const id of Object.keys(removeTimersRef.current)) {
      if (!sortedIds.has(id)) {
        window.clearTimeout(removeTimersRef.current[id])
        delete removeTimersRef.current[id]
      }
    }
    setLocalState((prev) => {
      const next: Record<string, LocalNotificationState> = {}
      for (const id of Object.keys(prev)) {
        if (sortedIds.has(id)) {
          const st = prev[id]
          if (st) next[id] = st
        }
      }
      return next
    })

    for (const n of sorted) {
      if (fadeTimersRef.current[n.id] || removeTimersRef.current[n.id]) continue
      setLocalState((prev) => ({ ...prev, [n.id]: { fading: false } }))
      fadeTimersRef.current[n.id] = window.setTimeout(() => {
        setLocalState((prev) => ({ ...prev, [n.id]: { ...(prev[n.id] ?? { fading: false }), fading: true } }))
        removeTimersRef.current[n.id] = window.setTimeout(() => {
          clearNotification(n.id)
          delete fadeTimersRef.current[n.id]
          delete removeTimersRef.current[n.id]
          setLocalState((prev) => {
            const copy = { ...prev }
            delete copy[n.id]
            return copy
          })
        }, FADE_MS)
      }, DISPLAY_MS)
    }
  }, [sorted, clearNotification])

  useEffect(() => {
    return () => {
      for (const id of Object.keys(fadeTimersRef.current)) {
        window.clearTimeout(fadeTimersRef.current[id])
      }
      for (const id of Object.keys(removeTimersRef.current)) {
        window.clearTimeout(removeTimersRef.current[id])
      }
    }
  }, [])

  if (sorted.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[420px] max-w-[calc(100vw-2rem)] space-y-2">
      {sorted.map((n) => {
        const state = localState[n.id] ?? { fading: false }
        const severityClass =
          n.severity === 'error'
            ? 'border-red-500/40 bg-red-500/10 text-red-200'
            : n.severity === 'warning'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-green-500/40 bg-green-500/10 text-green-200'
        const Icon =
          n.severity === 'error' ? AlertTriangle : n.severity === 'warning' ? Info : CheckCircle2
        return (
          <div
            key={n.id}
            onMouseEnter={() =>
              {
                if (fadeTimersRef.current[n.id]) {
                  window.clearTimeout(fadeTimersRef.current[n.id])
                  delete fadeTimersRef.current[n.id]
                }
                if (removeTimersRef.current[n.id]) {
                  window.clearTimeout(removeTimersRef.current[n.id])
                  delete removeTimersRef.current[n.id]
                }
                setLocalState((prev) => ({ ...prev, [n.id]: { ...(prev[n.id] ?? state), fading: false } }))
              }
            }
            onMouseLeave={() =>
              {
                if (!fadeTimersRef.current[n.id]) {
                  fadeTimersRef.current[n.id] = window.setTimeout(() => {
                    setLocalState((prev) => ({
                      ...prev,
                      [n.id]: { ...(prev[n.id] ?? { fading: false }), fading: true },
                    }))
                    removeTimersRef.current[n.id] = window.setTimeout(() => {
                      clearNotification(n.id)
                      delete fadeTimersRef.current[n.id]
                      delete removeTimersRef.current[n.id]
                      setLocalState((prev) => {
                        const copy = { ...prev }
                        delete copy[n.id]
                        return copy
                      })
                    }, FADE_MS)
                  }, DISPLAY_MS)
                }
              }
            }
            className={`rounded-lg border p-3 shadow-xl transition-opacity duration-500 ${severityClass} ${
              state.fading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs opacity-80">
                  {n.deviceId}
                  {n.count && n.count > 1 ? `  •  x${n.count}` : ''}
                </div>
                <div className="text-sm">{n.message}</div>
              </div>
              <button
                onClick={() => clearNotification(n.id)}
                className="rounded p-1 text-current/80 hover:bg-white/10 hover:text-current"
                title={t('notifications.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
