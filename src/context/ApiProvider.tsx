import { backendApiUrl } from '../config/backendEndpoint'
import { createWorkerHttpClient } from '../adapters/workerHttp'
import { useMemo, type ReactNode } from 'react'
import { ApiContext } from './apiContextBase'
import type { UnifiedClient } from '../api/client'
import { createMockClient } from '../adapters/mock'
import { createGasClient, isGasHost } from '../adapters/gas'
import { createGasHttpClient } from '../adapters/gasHttp'
import { hasRemoteGas } from '../config/gasEndpoint'

export function ApiProvider({ children }: { children: ReactNode }) {
  const client = useMemo<UnifiedClient>(() => {
    if (backendApiUrl()) return createWorkerHttpClient()
    if (isGasHost()) return createGasClient()
    if (hasRemoteGas()) return createGasHttpClient()
    return createMockClient()
  }, [])

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
}
