const DEFAULT_API_BASE_URL = '/api/v1'

/**
 * Application base path derived from the Vite build base (`base` / BASE_URL).
 * '' when deployed at the root ('/'), otherwise the base without a trailing
 * slash (e.g. '/pipegate' for base '/pipegate/').
 *
 * When the app is served under a sub-path (e.g. behind an nginx
 * `location /pipegate/` entry), every browser-facing URL — page routes, API
 * calls, WebSocket, public assets — must carry this prefix. The reverse proxy
 * strips the prefix before forwarding to the backend, so the backend itself
 * keeps serving root-relative routes.
 */
export const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL)

const API_BASE_URL = normalizeAPIBaseURL(import.meta.env.VITE_API_BASE_URL)

function normalizeBasePath(value: unknown): string {
  const raw = String(value || '/').trim()
  if (raw === '' || raw === '/') return ''
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.replace(/\/+$/, '')
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function normalizeAPIBaseURL(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) {
    return `${APP_BASE_PATH}${DEFAULT_API_BASE_URL}`
  }
  const withoutTrailingSlash = raw.replace(/\/+$/, '')
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(withoutTrailingSlash) || withoutTrailingSlash.startsWith('//')) {
    return withoutTrailingSlash
  }
  return normalizePath(withoutTrailingSlash)
}

export function getAPIBaseURL(): string {
  return API_BASE_URL
}

export function buildApiUrl(path: string): string {
  const base = getAPIBaseURL().replace(/\/+$/, '')
  let suffix = normalizePath(path)
  if (suffix === DEFAULT_API_BASE_URL) {
    suffix = ''
  } else if (suffix.startsWith(`${DEFAULT_API_BASE_URL}/`)) {
    suffix = suffix.slice(DEFAULT_API_BASE_URL.length)
  }
  return `${base}${suffix}`
}

export function buildGatewayUrl(path: string): string {
  const suffix = normalizePath(path)
  try {
    const origin =
      typeof window === 'undefined'
        ? new URL(getAPIBaseURL()).origin
        : new URL(getAPIBaseURL(), window.location.origin).origin
    return `${origin}${APP_BASE_PATH}${suffix}`
  } catch {
    return `${APP_BASE_PATH}${suffix}`
  }
}

/**
 * Build an absolute-path URL for an in-app page (e.g. '/login'),
 * prefixed with the deployment base path.
 */
export function buildAppUrl(path: string): string {
  return `${APP_BASE_PATH}${normalizePath(path)}`
}

/**
 * Build the URL for a public/ static asset (e.g. 'logo.svg'),
 * prefixed with the deployment base path.
 */
export function publicAssetUrl(path: string): string {
  return `${APP_BASE_PATH}${normalizePath(path)}`
}

/**
 * Strip the deployment base path from a URL path so the remainder can be
 * compared against root-relative backend routes (e.g. '/api/v1/admin').
 */
export function stripAppBasePath(path: string): string {
  if (!APP_BASE_PATH) return path
  if (path === APP_BASE_PATH) return '/'
  if (path.startsWith(`${APP_BASE_PATH}/`)) {
    return path.slice(APP_BASE_PATH.length)
  }
  return path
}
