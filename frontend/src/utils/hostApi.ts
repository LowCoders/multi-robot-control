/**
 * Vékony fetch-wrapper a Node backend `/api/*` végpontokhoz (nem bridge).
 * A `apiClient` a Python bridge OpenAPI útvonalaira van szabva; ez a modul
 * a host-only JSON API-t fedi le egységes HttpError-rel.
 */

import { HttpError } from './apiClient'

const API_PREFIX = '/api'

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function throwIfNotOk(response: Response, payload: unknown): void {
  if (response.ok) return
  const detail =
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { error: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : typeof payload === 'object' &&
          payload !== null &&
          'detail' in payload &&
          typeof (payload as { detail: unknown }).detail === 'string'
        ? (payload as { detail: string }).detail
        : response.statusText
  throw new HttpError(response.status, payload, `${response.status} ${detail}`)
}

export async function hostGet(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'GET',
    ...init,
  })
  const payload = await readPayload(response)
  throwIfNotOk(response, payload)
  return payload
}

export async function hostPost(path: string, body?: unknown, init?: RequestInit): Promise<unknown> {
  const { headers: extraHeaders, ...restInit } = init ?? {}
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders as Record<string, string> | undefined),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...restInit,
  })
  const payload = await readPayload(response)
  throwIfNotOk(response, payload)
  return payload
}

export async function hostPut(path: string, body?: unknown, init?: RequestInit): Promise<unknown> {
  const { headers: extraHeaders, ...restInit } = init ?? {}
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders as Record<string, string> | undefined),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...restInit,
  })
  const payload = await readPayload(response)
  throwIfNotOk(response, payload)
  return payload
}

export async function hostDelete(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'DELETE',
    ...init,
  })
  const payload = await readPayload(response)
  throwIfNotOk(response, payload)
  return payload
}
