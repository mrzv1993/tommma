import { afterEach, describe, expect, it } from 'vitest'
import { capitalConnection, withCapitalOwner } from './connections.js'
const previous = { ...process.env }
afterEach(() => { process.env = { ...previous } })
describe('server integration credentials', () => {
  it('never exposes a global integration without an explicit matching owner', async () => {
    process.env.OKX_API_KEY = 'owner-key'; process.env.OKX_API_SECRET = 'secret'; process.env.OKX_PASSPHRASE = 'passphrase'
    delete process.env.CAPITAL_CONNECTIONS_FILE; delete process.env.CAPITAL_OKX_OWNER_USER_ID
    expect(capitalConnection()).toEqual({})
    expect(withCapitalOwner(1n, capitalConnection)).toEqual({})
    process.env.CAPITAL_OKX_OWNER_USER_ID = '1'
    const [one, two] = await Promise.all([
      withCapitalOwner(1n, async () => { await Promise.resolve(); return capitalConnection() }),
      withCapitalOwner(2n, async () => { await Promise.resolve(); return capitalConnection() }),
    ])
    expect(one.exchange?.apiKey).toBe('owner-key'); expect(two).toEqual({}); expect(capitalConnection()).toEqual({})
  })
})
