import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronUp,
  Loader2,
  Folder,
  FileCode,
  FolderPlus,
  Home,
  Trash2,
  Check,
  X as XIcon,
} from 'lucide-react'

interface DirEntry {
  name: string
  path: string
}

interface FileEntry {
  name: string
  path: string
  size: number
  mtime: number
}

interface ListResponse {
  dir: string
  relpath: string
  root: string
  parent: string | null
  files: FileEntry[]
  dirs: DirEntry[]
}

export interface GcodeFileBrowserProps {
  initialDir?: string | null
  onPickFile?: (file: FileEntry) => void
  // If true, file rows are not selectable (e.g. for "Save As" mode)
  hideFiles?: boolean
  // Notifies the parent of the current directory whenever it changes
  onCurrentDirChange?: (dir: string) => void
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(ms: number, localeTag: string): string {
  try {
    return new Date(ms).toLocaleString(localeTag === 'hu' ? 'hu-HU' : 'en-US')
  } catch {
    return ''
  }
}

export default function GcodeFileBrowser({
  initialDir,
  onPickFile,
  hideFiles = false,
  onCurrentDirChange,
}: GcodeFileBrowserProps) {
  const { t, i18n } = useTranslation('visualization')
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; isDir: boolean } | null>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  const loadDir = useCallback(
    async (dir?: string) => {
      setLoading(true)
      setError(null)
      try {
        const url = dir ? `/api/gcode/list?dir=${encodeURIComponent(dir)}` : '/api/gcode/list'
        const res = await fetch(url)
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${res.status}`)
        }
        const json: ListResponse = await res.json()
        setData(json)
        onCurrentDirChange?.(json.dir)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('file_browser.load_dir_error'))
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [onCurrentDirChange, t]
  )

  useEffect(() => {
    loadDir(initialDir || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (creatingFolder) {
      newFolderInputRef.current?.focus()
    }
  }, [creatingFolder])

  const breadcrumbs = useMemo(() => {
    if (!data) return [] as Array<{ label: string; path: string }>
    const root = data.root
    const rel = data.relpath === '.' ? '' : data.relpath
    const parts = rel.split('/').filter(Boolean)
    const crumbs: Array<{ label: string; path: string }> = []
    let acc = root
    for (const p of parts) {
      acc = `${acc}/${p}`
      crumbs.push({ label: p, path: acc })
    }
    return crumbs
  }, [data])

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name || !data) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/gcode/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: data.dir, name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setCreatingFolder(false)
      setNewFolderName('')
      await loadDir(data.dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('file_browser.mkdir_error'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (target: { path: string; isDir: boolean }, recursive = false) => {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/gcode/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.path, recursive }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (res.status === 409 && target.isDir && !recursive) {
          // Ask for recursive confirmation
          const ok = window.confirm(t('file_browser.delete_recursive_confirm'))
          if (ok) {
            await handleDelete(target, true)
          }
          setBusy(false)
          return
        }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setConfirmDelete(null)
      await loadDir(data.dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('file_browser.delete_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => loadDir(data?.root)}
          className="btn btn-secondary btn-sm flex items-center gap-1"
          title={t('file_browser.root_title')}
          disabled={loading || busy}
        >
          <Home className="w-4 h-4" />
        </button>
        <button
          onClick={() => data?.parent && loadDir(data.parent)}
          className="btn btn-secondary btn-sm flex items-center gap-1"
          title={t('file_browser.up_title')}
          disabled={!data?.parent || loading || busy}
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            setCreatingFolder((v) => !v)
            setNewFolderName('')
          }}
          className="btn btn-secondary btn-sm flex items-center gap-1"
          title={t('file_browser.new_folder_title')}
          disabled={loading || busy || !data}
        >
          <FolderPlus className="w-4 h-4" />
          {t('file_browser.new_folder_btn')}
        </button>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs text-steel-400 flex-wrap">
        <button
          onClick={() => data && loadDir(data.root)}
          className="px-1.5 py-0.5 rounded hover:bg-steel-800 hover:text-steel-200"
          title={data?.root || ''}
        >
          gcode
        </button>
        {breadcrumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1">
            <span className="text-steel-600">/</span>
            <button
              onClick={() => loadDir(c.path)}
              disabled={i === breadcrumbs.length - 1}
              className={`px-1.5 py-0.5 rounded ${
                i === breadcrumbs.length - 1
                  ? 'text-steel-200 font-medium cursor-default'
                  : 'hover:bg-steel-800 hover:text-steel-200'
              }`}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {/* New folder inline form */}
      {creatingFolder && (
        <div className="flex items-center gap-2 p-2 rounded bg-steel-800/40 border border-steel-700">
          <FolderPlus className="w-4 h-4 text-machine-400" />
          <input
            ref={newFolderInputRef}
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') {
                setCreatingFolder(false)
                setNewFolderName('')
              }
            }}
            placeholder={t('file_browser.placeholder_folder_name')}
            className="input input-sm flex-1 text-sm"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || busy}
            className="btn btn-primary btn-sm"
            title={t('file_browser.create_title')}
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setCreatingFolder(false)
              setNewFolderName('')
            }}
            className="btn btn-secondary btn-sm"
            title={t('file_browser.cancel_title')}
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Listing */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-steel-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          {t('file_browser.loading')}
        </div>
      ) : error ? (
        <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-sm text-red-200">
          {error}
        </div>
      ) : (
        <div className="border border-steel-700 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          <ul className="divide-y divide-steel-800">
            {(data?.dirs ?? []).map((d) => (
              <li key={d.path} className="group flex items-stretch hover:bg-steel-800/50">
                <button
                  onClick={() => loadDir(d.path)}
                  className="flex-1 px-3 py-2 flex items-center gap-2 text-sm text-steel-200 text-left"
                >
                  <Folder className="w-4 h-4 text-machine-400" />
                  <span className="truncate">{d.name}</span>
                </button>
                {confirmDelete?.path === d.path ? (
                  <div className="flex items-center gap-1 pr-2">
                    <span className="text-xs text-red-300 mr-1">{t('file_browser.confirm_delete')}</span>
                    <button
                      onClick={() => handleDelete({ path: d.path, isDir: true })}
                      className="p-1 rounded hover:bg-red-500/30 text-red-300"
                      disabled={busy}
                      title={t('file_browser.yes_title')}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="p-1 rounded hover:bg-steel-700 text-steel-300"
                      title={t('file_browser.cancel_title')}
                    >
                      <XIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete({ path: d.path, isDir: true })}
                    className="opacity-0 group-hover:opacity-100 p-2 text-steel-500 hover:text-red-400"
                    title={t('file_browser.delete_title')}
                    disabled={busy}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}

            {!hideFiles &&
              (data?.files ?? []).map((f) => (
                <li key={f.path} className="group flex items-stretch hover:bg-steel-800/50">
                  <button
                    onClick={() => onPickFile?.(f)}
                    className="flex-1 px-3 py-2 flex items-center gap-2 text-sm text-steel-200 text-left"
                  >
                    <FileCode className="w-4 h-4 text-blue-400" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-xs text-steel-500 tabular-nums">{formatSize(f.size)}</span>
                    <span className="text-xs text-steel-500 tabular-nums hidden sm:inline">
                      {formatDate(f.mtime, i18n.language)}
                    </span>
                  </button>
                  {confirmDelete?.path === f.path ? (
                    <div className="flex items-center gap-1 pr-2">
                      <span className="text-xs text-red-300 mr-1">{t('file_browser.confirm_delete')}</span>
                      <button
                        onClick={() => handleDelete({ path: f.path, isDir: false })}
                        className="p-1 rounded hover:bg-red-500/30 text-red-300"
                        disabled={busy}
                        title={t('file_browser.yes_title')}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="p-1 rounded hover:bg-steel-700 text-steel-300"
                        title={t('file_browser.cancel_title')}
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete({ path: f.path, isDir: false })}
                      className="opacity-0 group-hover:opacity-100 p-2 text-steel-500 hover:text-red-400"
                      title={t('file_browser.delete_title')}
                      disabled={busy}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}

            {(data?.dirs.length ?? 0) === 0 && (hideFiles || (data?.files.length ?? 0) === 0) && (
              <li className="px-3 py-6 text-center text-sm text-steel-500">{t('file_browser.empty_dir')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
