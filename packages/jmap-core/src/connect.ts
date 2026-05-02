import type { AuthProvider } from "./auth.ts"
import type { CapabilityRegistry } from "./capabilities.ts"
import { discoverJmapSession, type SrvRecord } from "./discovery.ts"
import { JmapClient, type RequestLimits } from "./request.ts"
import { FetchJmapTransport, type JmapTransport } from "./transport.ts"
import type { JmapSession } from "./types.ts"

export interface ConnectJmapInput {
  readonly email?: string
  readonly sessionUrl?: string
  readonly auth: AuthProvider
  readonly transport?: JmapTransport
  readonly registry?: CapabilityRegistry
  readonly limits?: RequestLimits
  readonly maxRetries?: number
  readonly retryDelayMs?: number
  readonly resolveSrv?: (service: "_jmap._tcp", domain: string) => Promise<SrvRecord[]>
}

export interface ConnectedJmapClient {
  readonly session: JmapSession
  readonly transport: JmapTransport
  readonly client: JmapClient
}

export async function connectJmap(input: ConnectJmapInput): Promise<ConnectedJmapClient> {
  const transport = input.transport ?? new FetchJmapTransport({ auth: input.auth })
  const session = await discoverJmapSession({
    auth: input.auth,
    transport,
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.sessionUrl === undefined ? {} : { sessionUrl: input.sessionUrl }),
    ...(input.resolveSrv === undefined ? {} : { resolveSrv: input.resolveSrv }),
  })
  const client = new JmapClient({
    session,
    transport,
    ...(input.registry === undefined ? {} : { registry: input.registry }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
    ...(input.retryDelayMs === undefined ? {} : { retryDelayMs: input.retryDelayMs }),
  })
  return { session, transport, client }
}
