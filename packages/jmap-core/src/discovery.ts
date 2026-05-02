import type { AuthProvider } from "./auth.ts"
import { FetchJmapTransport, type JmapTransport } from "./transport.ts"
import type { JmapSession } from "./types.ts"

export interface SrvRecord {
  readonly target: string
  readonly port?: number
  readonly priority?: number
  readonly weight?: number
}

export interface DnsOverHttpsOptions {
  readonly endpoint?: string
  readonly fetchImpl?: typeof fetch
  readonly bypassCache?: boolean
}

export interface DiscoverJmapSessionInput {
  readonly email?: string
  readonly sessionUrl?: string
  readonly auth: AuthProvider
  readonly transport?: Pick<JmapTransport, "getSession">
  readonly resolveSrv?: (service: "_jmap._tcp", domain: string) => Promise<SrvRecord[]>
  readonly random?: () => number
}

export interface JmapSessionDiscoveryResult {
  readonly session: JmapSession
  readonly sessionUrl: string
  readonly attemptedUrls: readonly string[]
}

export class JmapDiscoveryError extends Error {
  readonly attemptedUrls: string[]

  constructor(attemptedUrls: string[], cause?: unknown) {
    super(
      `Could not discover JMAP session. Tried: ${attemptedUrls.join(", ")}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = "JmapDiscoveryError"
    this.attemptedUrls = attemptedUrls
  }
}

export async function discoverJmapSession(input: DiscoverJmapSessionInput): Promise<JmapSession> {
  return (await discoverJmapSessionWithUrl(input)).session
}

export async function discoverJmapSessionWithUrl(input: DiscoverJmapSessionInput): Promise<JmapSessionDiscoveryResult> {
  const transport = input.transport ?? new FetchJmapTransport({ auth: input.auth })
  const urls = await discoveryCandidates(input)
  let lastError: unknown

  for (const url of urls) {
    try {
      return { session: await transport.getSession(url, input.auth), sessionUrl: url, attemptedUrls: urls }
    } catch (error) {
      lastError = error
    }
  }

  throw new JmapDiscoveryError(urls, lastError)
}

export async function discoveryCandidates(input: DiscoverJmapSessionInput): Promise<string[]> {
  if (input.sessionUrl !== undefined) return [input.sessionUrl]
  if (input.email === undefined) throw new Error("JMAP discovery needs sessionUrl or email")

  const domain = domainFromEmail(input.email)
  const urls: string[] = []

  if (input.resolveSrv !== undefined) {
    try {
      const records = await input.resolveSrv("_jmap._tcp", domain)
      urls.push(...srvRecordsToSessionUrls(orderSrvRecords(records, input.random)))
    } catch {
      // DNS discovery failure must not block RFC 8620 well-known fallback.
    }
  }

  urls.push(`https://${domain}/.well-known/jmap`)
  return [...new Set(urls)]
}

export async function resolveJmapSrvOverHttps(
  service: "_jmap._tcp",
  domain: string,
  options: DnsOverHttpsOptions = {},
): Promise<SrvRecord[]> {
  const endpoint = options.endpoint ?? "https://cloudflare-dns.com/dns-query"
  const fetchImpl = options.fetchImpl ?? fetch
  const url = new URL(endpoint)
  url.searchParams.set("name", `${service}.${domain}`)
  url.searchParams.set("type", "SRV")
  if (options.bypassCache === true) url.searchParams.set("_", `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const response = await fetchImpl(url.toString(), {
    cache: options.bypassCache === true ? "no-store" : "default",
    headers: {
      accept: "application/dns-json",
      ...(options.bypassCache === true ? { "cache-control": "no-cache", pragma: "no-cache" } : {}),
    },
  })
  if (!response.ok) throw new Error(`DNS SRV lookup failed: HTTP ${response.status}`)
  const body = await response.json() as DnsJsonResponse
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DNS SRV lookup failed: status ${body.Status}`)
  return (body.Answer ?? []).flatMap((answer) => parseSrvAnswer(answer.data))
}

export function srvRecordsToSessionUrls(records: readonly SrvRecord[]): string[] {
  return records.map((record) => {
    const port = record.port === undefined || record.port === 443 ? "" : `:${record.port}`
    return `https://${trimTrailingDot(record.target)}${port}/.well-known/jmap`
  })
}

export function orderSrvRecords(records: readonly SrvRecord[], random: () => number = Math.random): SrvRecord[] {
  const byPriority = new Map<number, SrvRecord[]>()
  for (const record of records) {
    const priority = record.priority ?? 0
    byPriority.set(priority, [...(byPriority.get(priority) ?? []), record])
  }

  return [...byPriority.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, group]) => weightedOrder(group, random))
}

interface DnsJsonResponse {
  readonly Status: number
  readonly Answer?: readonly { readonly data: string }[]
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@")
  if (at < 0 || at === email.length - 1) throw new Error("JMAP discovery email must contain domain")
  return email.slice(at + 1).toLowerCase()
}

function trimTrailingDot(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value
}

function parseSrvAnswer(data: string): SrvRecord[] {
  const parts = data.trim().split(/\s+/)
  if (parts.length < 4) return []
  const [priority, weight, port, ...targetParts] = parts
  const parsedPriority = Number(priority)
  const parsedWeight = Number(weight)
  const parsedPort = Number(port)
  const target = targetParts.join(" ")
  if (!Number.isFinite(parsedPriority) || !Number.isFinite(parsedWeight) || !Number.isFinite(parsedPort) || target.length === 0) return []
  return [{ priority: parsedPriority, weight: parsedWeight, port: parsedPort, target }]
}

function weightedOrder(records: readonly SrvRecord[], random: () => number): SrvRecord[] {
  const remaining = [...records]
  const ordered: SrvRecord[] = []
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, record) => sum + Math.max(0, record.weight ?? 0), 0)
    if (totalWeight <= 0) {
      ordered.push(...remaining.sort((a, b) => trimTrailingDot(a.target).localeCompare(trimTrailingDot(b.target))))
      break
    }

    let threshold = random() * totalWeight
    let pickedIndex = 0
    for (let index = 0; index < remaining.length; index += 1) {
      threshold -= Math.max(0, remaining[index]?.weight ?? 0)
      if (threshold <= 0) {
        pickedIndex = index
        break
      }
    }
    const [picked] = remaining.splice(pickedIndex, 1)
    if (picked !== undefined) ordered.push(picked)
  }
  return ordered
}
