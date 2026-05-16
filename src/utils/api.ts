const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:5000/api"

import { cognitoLogout, getAccessToken, getIdToken } from '@/lib/cognito'

export function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  const idToken = getIdToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (idToken) headers['X-Cognito-Id-Token'] = idToken
  return headers
}

async function handleAuthFailure(r: Response, tokenUsed: string | null) {
  // Only force-logout if we actually attempted an authenticated request.
  // On initial app load, Cognito session restoration is async; requests without a token
  // can legitimately return 401 and should not clear the session.
  if (r.status === 401 && tokenUsed) {
    try {
      cognitoLogout()
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.location.hash = '#/'
    }
  }
}

export const api = {
  get: <T = unknown>(path: string): Promise<T | null> =>
    (() => {
      const tokenUsed = getAccessToken()
      return fetch(BASE + path, {
        headers: authHeaders(),
      })
        .then(async (r) => {
          await handleAuthFailure(r, tokenUsed)
          return r.json()
        })
        .catch(() => null)
    })(),
  post: (path: string, body?: unknown) =>
    (() => {
      const tokenUsed = getAccessToken()
      return fetch(BASE + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          await handleAuthFailure(r, tokenUsed)
          return r.json()
        })
        .catch(() => null)
    })(),

  /** POST that rejects when the response is not OK or fetch fails (for flows that need real error handling). */
  postExpectOk: async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const tokenUsed = getAccessToken()
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(body ?? {}),
    })
    let data: unknown = null
    try {
      data = await r.json()
    } catch {
      /* ignore non-JSON */
    }
    await handleAuthFailure(r, tokenUsed)
    if (!r.ok) {
      const msg =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${r.status})`
      throw new Error(msg)
    }
    return data as T
  },

  /** DELETE that rejects when the response is not OK or fetch fails. */
  deleteExpectOk: async <T = unknown>(path: string): Promise<T> => {
    const tokenUsed = getAccessToken()
    const r = await fetch(BASE + path, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    let data: unknown = null
    try {
      data = await r.json()
    } catch {
      /* ignore non-JSON */
    }
    await handleAuthFailure(r, tokenUsed)
    if (!r.ok) {
      const msg =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${r.status})`
      throw new Error(msg)
    }
    return data as T
  },
}

export async function checkHealth(): Promise<boolean> {
  try {
    const r = await fetch(BASE + '/health')
    return r.ok
  } catch {
    return false
  }
}
