/**
 * Típusos fetch-wrapper a backend Bridge API-hoz.
 *
 * A `bridge-types.ts` fájlt a `scripts/generate-api-types.sh` generálja
 * a Python (FastAPI) bridge OpenAPI sémájából. A backend változtatásakor
 * újra kell futtatni a generátort, és a TypeScript ellenőrzés azonnal
 * jelzi a hívási helyek inkonzisztenciáit.
 *
 * Miért nem axios? A frontend ma csak `fetch` hívásokat használ, így nem
 * vezetünk be új függőséget. Ez a wrapper csak azokat a típusos
 * elemeket teszi hozzá, ami eddig hiányzott.
 *
 * Használat:
 *
 *   import { apiGet, apiPost } from '../utils/apiClient'
 *
 *   const settings = await apiGet('/devices/{device_id}/grbl-settings', {
 *     path: { device_id: 'deviceA' },
 *   })
 *
 *   await apiPost('/devices/{device_id}/grbl-settings/batch', {
 *     path: { device_id: 'deviceA' },
 *     body: { settings: { 100: 80 } },
 *   })
 *
 * Megjegyzés: a fenti minta nem CDN-szintű kényelem, viszont a generált
 * `paths` típusból valódi compile-time hibát ad, ha a backend
 * elérhetetlenné teszi az endpointot.
 */

import type { paths } from '../types/bridge-types'

const API_BASE = '/api'

export interface ApiError extends Error {
  status: number
  payload: unknown
}

/** Egyszerű hibatípus, amit a hívók `instanceof`-ot tudnak használni rá. */
class HttpError extends Error implements ApiError {
  status: number
  payload: unknown

  constructor(status: number, payload: unknown, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.payload = payload
  }
}

type Method = 'get' | 'post' | 'put' | 'delete' | 'patch'

type PathsWithMethod<M extends Method> = {
  [K in keyof paths]: paths[K] extends Record<M, unknown> ? K : never
}[keyof paths]

type Operation<P extends keyof paths, M extends Method> = paths[P] extends Record<M, infer Op>
  ? Op
  : never

type PathParams<P extends keyof paths, M extends Method> = Operation<P, M> extends {
  parameters: { path: infer Path }
}
  ? Path extends Record<string, unknown>
    ? Path
    : Record<string, never>
  : Record<string, never>

type QueryParams<P extends keyof paths, M extends Method> = Operation<P, M> extends {
  parameters: { query?: infer Query }
}
  ? Query extends Record<string, unknown>
    ? Query
    : Record<string, never>
  : Record<string, never>

type RequestBody<P extends keyof paths, M extends Method> = Operation<P, M> extends {
  requestBody?: { content: { 'application/json': infer Body } }
}
  ? Body
  : never

type SuccessResponse<P extends keyof paths, M extends Method> = Operation<P, M> extends {
  responses: { 200: { content: { 'application/json': infer Resp } } }
}
  ? Resp
  : Operation<P, M> extends {
      responses: { 200: { content: Record<string, infer Resp> } }
    }
  ? Resp
  : unknown

interface RequestOptions<P extends keyof paths, M extends Method> {
  path?: PathParams<P, M>
  query?: QueryParams<P, M>
  body?: RequestBody<P, M>
  signal?: AbortSignal
}

function buildUrl(template: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
  let url = template
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value)))
    }
  }
  if (query) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      search.append(key, String(value))
    }
    const qs = search.toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }
  return `${API_BASE}${url}`
}

async function request<P extends keyof paths, M extends Method>(
  method: M,
  path: P,
  options?: RequestOptions<P, M>
): Promise<SuccessResponse<P, M>> {
  const url = buildUrl(
    path as string,
    options?.path as Record<string, unknown> | undefined,
    options?.query as Record<string, unknown> | undefined
  )
  const init: RequestInit = {
    method: method.toUpperCase(),
    signal: options?.signal,
  }
  if (options?.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }

  const response = await fetch(url, init)
  let payload: unknown = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : response.statusText
    throw new HttpError(response.status, payload, `${response.status} ${detail}`)
  }

  return payload as SuccessResponse<P, M>
}

export function apiGet<P extends PathsWithMethod<'get'>>(
  path: P,
  options?: RequestOptions<P, 'get'>
): Promise<SuccessResponse<P, 'get'>> {
  return request('get', path, options)
}

export function apiPost<P extends PathsWithMethod<'post'>>(
  path: P,
  options?: RequestOptions<P, 'post'>
): Promise<SuccessResponse<P, 'post'>> {
  return request('post', path, options)
}

export function apiPut<P extends PathsWithMethod<'put'>>(
  path: P,
  options?: RequestOptions<P, 'put'>
): Promise<SuccessResponse<P, 'put'>> {
  return request('put', path, options)
}

export function apiDelete<P extends PathsWithMethod<'delete'>>(
  path: P,
  options?: RequestOptions<P, 'delete'>
): Promise<SuccessResponse<P, 'delete'>> {
  return request('delete', path, options)
}

export { HttpError }
