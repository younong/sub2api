import { describe, it, expect, vi, afterEach } from 'vitest'

async function importUrlModule(baseUrl?: string, apiBaseUrl?: string) {
  vi.resetModules()
  if (baseUrl !== undefined) {
    vi.stubEnv('BASE_URL', baseUrl)
  } else {
    vi.stubEnv('BASE_URL', '/')
  }
  if (apiBaseUrl !== undefined) {
    vi.stubEnv('VITE_API_BASE_URL', apiBaseUrl)
  }
  return import('@/api/url')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('api/url（根路径部署，BASE_URL=/）', () => {
  it('保持原有行为：API base 为 /api/v1', async () => {
    const mod = await importUrlModule('/')
    expect(mod.APP_BASE_PATH).toBe('')
    expect(mod.getAPIBaseURL()).toBe('/api/v1')
  })

  it('buildGatewayUrl 不加前缀', async () => {
    const mod = await importUrlModule('/')
    expect(mod.buildGatewayUrl('/v1/usage')).toBe(`${window.location.origin}/v1/usage`)
  })

  it('buildAppUrl / publicAssetUrl 保持根路径', async () => {
    const mod = await importUrlModule('/')
    expect(mod.buildAppUrl('/login')).toBe('/login')
    expect(mod.publicAssetUrl('logo.svg')).toBe('/logo.svg')
  })
})

describe('api/url（子路径部署，BASE_URL=/pipegate/）', () => {
  it('APP_BASE_PATH 为 /pipegate', async () => {
    const mod = await importUrlModule('/pipegate/')
    expect(mod.APP_BASE_PATH).toBe('/pipegate')
  })

  it('API base 默认带前缀', async () => {
    const mod = await importUrlModule('/pipegate/')
    expect(mod.getAPIBaseURL()).toBe('/pipegate/api/v1')
    expect(mod.buildApiUrl('/auth/me')).toBe('/pipegate/api/v1/auth/me')
  })

  it('buildGatewayUrl 带前缀（WS/OAuth/setup 共用）', async () => {
    const mod = await importUrlModule('/pipegate/')
    expect(mod.buildGatewayUrl('/v1/usage')).toBe(`${window.location.origin}/pipegate/v1/usage`)
    expect(mod.buildGatewayUrl('/setup/status')).toBe(`${window.location.origin}/pipegate/setup/status`)
  })

  it('buildAppUrl / publicAssetUrl 带前缀', async () => {
    const mod = await importUrlModule('/pipegate/')
    expect(mod.buildAppUrl('/login')).toBe('/pipegate/login')
    expect(mod.publicAssetUrl('logo.svg')).toBe('/pipegate/logo.svg')
  })

  it('stripAppBasePath 还原为后端路由', async () => {
    const mod = await importUrlModule('/pipegate/')
    expect(mod.stripAppBasePath('/pipegate/api/v1/admin')).toBe('/api/v1/admin')
    expect(mod.stripAppBasePath('/pipegate/admin/ops')).toBe('/admin/ops')
    expect(mod.stripAppBasePath('/pipegate')).toBe('/')
    expect(mod.stripAppBasePath('/other/path')).toBe('/other/path')
  })

  it('显式 VITE_API_BASE_URL 仍然优先', async () => {
    const mod = await importUrlModule('/pipegate/', 'https://api.example.com/api/v1')
    expect(mod.getAPIBaseURL()).toBe('https://api.example.com/api/v1')
  })
})
