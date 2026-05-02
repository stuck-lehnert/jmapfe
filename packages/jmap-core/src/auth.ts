import type { JsonObject } from "./types.ts"

type MaybePromise<T> = T | Promise<T>
type SecretSource = string | (() => MaybePromise<string>)

export interface BearerTokenAuth {
  readonly kind: "bearer"
  readonly token: SecretSource
  readonly username?: string
  readonly refresh?: () => Promise<string>
}

export interface OAuth2PkceAuth {
  readonly kind: "oauth2-pkce"
  readonly accessToken: SecretSource
  readonly tokenType?: string
  readonly refresh?: () => Promise<string>
  readonly metadata?: JsonObject
}

export interface BasicAuth {
  readonly kind: "basic"
  readonly username: string
  readonly password: SecretSource
  readonly warnUser?: boolean
}

export interface CustomHeaderAuth {
  readonly kind: "custom-header"
  readonly headers: Record<string, SecretSource>
  readonly redactedHeaderNames?: string[]
}

export type AuthProvider = BearerTokenAuth | OAuth2PkceAuth | BasicAuth | CustomHeaderAuth

export async function authHeaders(auth: AuthProvider): Promise<Record<string, string>> {
  switch (auth.kind) {
    case "bearer":
      return { Authorization: `Bearer ${await readSecret(auth.token)}` }
    case "oauth2-pkce": {
      const tokenType = auth.tokenType ?? "Bearer"
      return { Authorization: `${tokenType} ${await readSecret(auth.accessToken)}` }
    }
    case "basic": {
      const password = await readSecret(auth.password)
      const encoded = base64(`${auth.username}:${password}`)
      return { Authorization: `Basic ${encoded}` }
    }
    case "custom-header": {
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(auth.headers)) {
        headers[name] = await readSecret(value)
      }
      return headers
    }
  }
}

export async function refreshAuth(auth: AuthProvider): Promise<string | undefined> {
  if (auth.kind === "custom-header" || auth.kind === "basic") return undefined
  return auth.refresh?.()
}

export function redactedHeaders(
  headers: Record<string, string>,
  extraSecretHeaderNames: readonly string[] = [],
): Record<string, string> {
  const secretNames = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    ...extraSecretHeaderNames.map((name) => name.toLowerCase()),
  ])

  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      secretNames.has(name.toLowerCase()) ? "[REDACTED]" : redactSecretText(value),
    ]),
  )
}

export function redactSecretText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
}

async function readSecret(source: SecretSource): Promise<string> {
  return typeof source === "function" ? source() : source
}

function base64(value: string): string {
  if (typeof btoa === "function") return btoa(value)
  return Buffer.from(value, "utf8").toString("base64")
}
