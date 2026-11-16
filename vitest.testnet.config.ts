import { mergeConfig } from 'vitest/config'
import base from './vitest.config'

// Live tests against the public testnet; see e2e/testnet/.
export default mergeConfig(base, {
  test: {
    include: ['e2e/testnet/**/*.testnet.ts'],
    testTimeout: 900_000,
  },
})
