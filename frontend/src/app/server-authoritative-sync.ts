export type LocalCachePromotionPolicy = {
  allowExplicitImport: boolean
  hasLocalData: boolean
  serverStateIsEmpty: boolean
}

export function shouldUploadLocalCacheWhenServerEmpty(policy: LocalCachePromotionPolicy) {
  return policy.allowExplicitImport && policy.hasLocalData && policy.serverStateIsEmpty
}
