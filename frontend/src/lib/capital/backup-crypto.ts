const format = 'defi-ledger-encrypted-backup'
const version = 1
const iterations = 600_000
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export interface EncryptedBackup {
  format: typeof format
  version: typeof version
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
    salt: string
  }
  cipher: {
    name: 'AES-GCM'
    keyLength: 256
    iv: string
  }
  ciphertext: string
}

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupCryptoError'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new BackupCryptoError('Файл резервной копии повреждён')
  }
}

function additionalData() {
  return encoder.encode(`${format}:${version}`)
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, workFactor: number, usages: KeyUsage[]) {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: workFactor },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

function assertPassword(password: string) {
  if (password.length < 12) throw new BackupCryptoError('Пароль должен содержать не менее 12 символов')
  if (password.length > 1024) throw new BackupCryptoError('Пароль слишком длинный')
}

export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EncryptedBackup>
  return candidate.format === format && candidate.version === version && typeof candidate.ciphertext === 'string'
}

export async function encryptBackup(value: unknown, password: string): Promise<EncryptedBackup> {
  assertPassword(password)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations, ['encrypt'])
  const plaintext = encoder.encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(), tagLength: 128 }, key, plaintext)
  return {
    format,
    version,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', keyLength: 256, iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptBackup(value: unknown, password: string): Promise<unknown> {
  assertPassword(password)
  if (!isEncryptedBackup(value)) throw new BackupCryptoError('Формат зашифрованной резервной копии не поддерживается')
  if (
    value.kdf?.name !== 'PBKDF2' ||
    value.kdf.hash !== 'SHA-256' ||
    !Number.isInteger(value.kdf.iterations) ||
    value.kdf.iterations < 100_000 ||
    value.kdf.iterations > 2_000_000 ||
    value.cipher?.name !== 'AES-GCM' ||
    value.cipher.keyLength !== 256
  )
    throw new BackupCryptoError('Параметры шифрования не поддерживаются')

  try {
    const salt = base64ToBytes(value.kdf.salt)
    const iv = base64ToBytes(value.cipher.iv)
    if (salt.length !== 16 || iv.length !== 12) throw new BackupCryptoError('Файл резервной копии повреждён')
    const key = await deriveKey(password, salt, value.kdf.iterations, ['decrypt'])
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(), tagLength: 128 },
      key,
      base64ToBytes(value.ciphertext),
    )
    return JSON.parse(decoder.decode(decrypted)) as unknown
  } catch (error) {
    if (error instanceof BackupCryptoError) throw error
    throw new BackupCryptoError('Неверный пароль или файл резервной копии повреждён')
  }
}
