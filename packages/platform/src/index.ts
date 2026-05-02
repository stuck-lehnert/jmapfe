export interface SecureVault {
  getSecret(ref: string): Promise<string | undefined>
  setSecret(ref: string, value: string): Promise<void>
  deleteSecret(ref: string): Promise<void>
}

export interface FileCache {
  put(path: string, bytes: Uint8Array, options?: { readonly encrypted?: boolean }): Promise<void>
  get(path: string): Promise<Uint8Array | undefined>
  delete(path: string): Promise<void>
}

export interface NotificationScheduler {
  schedule(input: LocalNotification): Promise<void>
  cancel(id: string): Promise<void>
}

export interface LocalNotification {
  readonly id: string
  readonly title: string
  readonly body?: string
  readonly fireAt: string
}

export interface CorsProbeResult {
  readonly ok: boolean
  readonly reason?: "cors" | "auth" | "network" | "unknown"
  readonly message: string
}

export function classifyCorsSetupFailure(error: unknown): CorsProbeResult {
  if (error instanceof TypeError) {
    return { ok: false, reason: "cors", message: "Server does not allow this web origin." }
  }
  return { ok: false, reason: "unknown", message: error instanceof Error ? error.message : "Unknown setup failure" }
}

export function assertNoTokenInUrl(url: string): void {
  const parsed = new URL(url)
  for (const key of parsed.searchParams.keys()) {
    if (/token|auth|secret|password/i.test(key)) throw new Error(`Secret-like URL parameter is forbidden: ${key}`)
  }
}
