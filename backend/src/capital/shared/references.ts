import type { ReferenceData } from './contracts.js'

export const defaultReferences: ReferenceData = {
  assets: [
    { id: 'rub', symbol: 'RUB', name: 'Российский рубль', kind: 'fiat', decimals: 2 },
    { id: 'usdt', symbol: 'USDT', name: 'Tether', kind: 'crypto', decimals: 6 },
    { id: 'usdc', symbol: 'USDC', name: 'USD Coin', kind: 'crypto', decimals: 6 },
    { id: 'btc', symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', decimals: 8 },
    { id: 'eth', symbol: 'ETH', name: 'Ethereum', kind: 'crypto', decimals: 18 },
  ],
  locations: [
    { id: 'p2p-okx', name: 'P2P OKX', kind: 'exchange' },
    { id: 'okx', name: 'OKX', kind: 'exchange' },
    { id: 'okx-wallet', name: 'OKX Wallet', kind: 'wallet' },
    { id: 'external-wallet', name: 'Внешний кошелек', kind: 'wallet' },
    { id: 'fiat', name: 'Фиат', kind: 'fiat' },
  ],
  networks: [
    { id: 'arbitrum', name: 'Arbitrum One', code: 'ARBITRUM' },
    { id: 'ethereum', name: 'Ethereum', code: 'ERC20' },
    { id: 'tron', name: 'TRON', code: 'TRC20' },
    { id: 'bitcoin', name: 'Bitcoin Network', code: 'BTC' },
  ],
}
