import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { BackupCryptoError, decryptBackup, encryptBackup, isEncryptedBackup } from './backup-crypto'

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
})

describe('encrypted backup', () => {
  it('round-trips decimal strings without exposing plaintext in the envelope', async () => {
    const source = { schemaVersion: 1, operations: [{ amount: '1875.000001', note: 'личная операция' }] }
    const encrypted = await encryptBackup(source, 'correct horse battery staple')

    expect(isEncryptedBackup(encrypted)).toBe(true)
    expect(JSON.stringify(encrypted)).not.toContain('1875.000001')
    expect(JSON.stringify(encrypted)).not.toContain('личная операция')
    await expect(decryptBackup(encrypted, 'correct horse battery staple')).resolves.toEqual(source)
  })

  it('rejects a wrong password and detects ciphertext tampering', async () => {
    const encrypted = await encryptBackup({ schemaVersion: 1, operations: [] }, 'correct horse battery staple')
    await expect(decryptBackup(encrypted, 'incorrect password value')).rejects.toBeInstanceOf(BackupCryptoError)

    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -4)}AAAA`
    await expect(decryptBackup(encrypted, 'correct horse battery staple')).rejects.toThrow(
      'Неверный пароль или файл резервной копии повреждён',
    )
  })

  it('requires a meaningful password length', async () => {
    await expect(encryptBackup({}, 'short')).rejects.toThrow('не менее 12 символов')
  })
})
