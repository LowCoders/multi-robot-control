/**
 * G-code fájl HTTP műveletek — a store csak állapotot tart, a hálózat itt van.
 */

import { hostGet, hostPost } from '../utils/hostApi'

export async function fetchGcodeFile(
  filepath: string,
  signal?: AbortSignal
): Promise<{ lines: string[]; filename: string }> {
  const init: RequestInit = signal ? { signal } : {}
  const data = (await hostGet(`/gcode/file?path=${encodeURIComponent(filepath)}`, init)) as {
    lines?: string[]
    filename?: string
  }
  const lines: string[] = Array.isArray(data.lines) ? data.lines : []
  const filename: string =
    typeof data.filename === 'string' ? data.filename : filepath.split('/').pop() || 'program.nc'
  return { lines, filename }
}

export async function saveGcodeFile(
  path: string,
  content: string,
  overwrite: boolean,
  signal?: AbortSignal
): Promise<{ filepath?: string; filename?: string }> {
  const init: RequestInit = signal ? { signal } : {}
  return hostPost('/gcode/file', { path, content, overwrite }, init) as Promise<{
    filepath?: string
    filename?: string
  }>
}
