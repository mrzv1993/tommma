export type ApiDataSource = 'production' | 'local'

export function normalizeApiDataSource(value: unknown): ApiDataSource {
  return value === 'local' ? 'local' : 'production'
}

export function scopedClientCacheOwner(dataSource: ApiDataSource, userId: string) {
  return `${dataSource}:${userId}`
}

export function scopedAuthTokenStorageKey(dataSource: ApiDataSource) {
  return `tommma.auth.token.${dataSource}.v1`
}
