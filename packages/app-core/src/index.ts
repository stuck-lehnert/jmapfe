import type { Capability, JmapSession } from "@jmapfe/jmap-core"

export type AccountAuthKind = "bearer" | "oauth2-pkce" | "basic" | "custom-header"

export interface AccountSetupDraft {
  readonly displayName: string
  readonly email: string
  readonly username?: string
  readonly sessionUrl?: string
  readonly authKind: AccountAuthKind
  readonly secret?: string
}

export interface ConfiguredAccount {
  readonly id: string
  readonly displayName: string
  readonly email: string
  readonly username?: string
  readonly serverKey: string
  readonly sessionUrl?: string
  readonly authKind: AccountAuthKind
  readonly secretRef?: string
  readonly status: "needs-secret" | "ready" | "error"
  readonly lastError?: string
  readonly verifiedAt?: string
  readonly capabilities?: readonly string[]
  readonly primaryMailAccountId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AccountValidationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
}

export const EMPTY_ACCOUNT_SETUP_DRAFT: AccountSetupDraft = {
  displayName: "",
  email: "",
  authKind: "bearer",
}

export function validateAccountSetupDraft(draft: AccountSetupDraft): AccountValidationResult {
  const errors: string[] = []
  if (draft.displayName.trim().length === 0) errors.push("Display name is required.")
  if (!isLikelyEmail(draft.email)) errors.push("Valid email address is required.")
  if (draft.sessionUrl !== undefined && draft.sessionUrl.trim().length > 0 && !isHttpsUrl(draft.sessionUrl)) {
    errors.push("Session URL must be HTTPS.")
  }
  if (accountLoginUsername(draft).length === 0) errors.push("Username is required.")
  if (draft.authKind === "bearer" && draft.secret !== undefined && draft.secret.trim().length === 0) {
    errors.push("Token cannot be blank.")
  }
  return { ok: errors.length === 0, errors }
}

export function createConfiguredAccount(
  draft: AccountSetupDraft,
  options: {
    readonly now?: string
    readonly id?: string
    readonly secretRef?: string
    readonly status?: ConfiguredAccount["status"]
    readonly verifiedAt?: string
    readonly capabilities?: readonly string[]
    readonly primaryMailAccountId?: string
    readonly sessionUrl?: string
  } = {},
): ConfiguredAccount {
  const validation = validateAccountSetupDraft(draft)
  if (!validation.ok) throw new Error(validation.errors.join(" "))

  const now = options.now ?? new Date().toISOString()
  const sessionUrl = normalizeOptional(options.sessionUrl) ?? normalizeOptional(draft.sessionUrl)
  return {
    id: options.id ?? accountIdFromDraft(draft, now),
    displayName: draft.displayName.trim(),
    email: draft.email.trim().toLowerCase(),
    ...(draft.username === undefined ? {} : { username: accountLoginUsername(draft) }),
    serverKey: sessionUrl ?? domainFromEmail(draft.email),
    ...(sessionUrl === undefined ? {} : { sessionUrl }),
    authKind: draft.authKind,
    ...(options.secretRef === undefined ? {} : { secretRef: options.secretRef }),
    status: options.status ?? (options.secretRef === undefined ? "needs-secret" : "ready"),
    ...(options.verifiedAt === undefined ? {} : { verifiedAt: options.verifiedAt }),
    ...(options.capabilities === undefined ? {} : { capabilities: [...options.capabilities].sort() }),
    ...(options.primaryMailAccountId === undefined ? {} : { primaryMailAccountId: options.primaryMailAccountId }),
    createdAt: now,
    updatedAt: now,
  }
}

export function serializeConfiguredAccounts(accounts: readonly ConfiguredAccount[]): string {
  return JSON.stringify(accounts.map(stripRuntimeOnlyAccountFields))
}

export function parseConfiguredAccounts(serialized: string | null | undefined): ConfiguredAccount[] {
  if (serialized === undefined || serialized === null || serialized.trim().length === 0) return []
  const parsed: unknown = JSON.parse(serialized)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item) => (isConfiguredAccount(item) ? [item] : []))
}

export function configuredAccountServerLabel(account: ConfiguredAccount): string {
  return account.sessionUrl ?? account.serverKey
}

export function accountLoginUsername(draft: AccountSetupDraft): string {
  return draft.username === undefined ? draft.email.trim() : draft.username.trim()
}

export function upsertConfiguredAccount(
  accounts: readonly ConfiguredAccount[],
  account: ConfiguredAccount,
): ConfiguredAccount[] {
  const index = accounts.findIndex((item) => item.id === account.id)
  if (index < 0) return [...accounts, account]
  return accounts.map((item) => (item.id === account.id ? account : item))
}

export function removeConfiguredAccount(accounts: readonly ConfiguredAccount[], accountId: string): ConfiguredAccount[] {
  return accounts.filter((account) => account.id !== accountId)
}

export interface JmapCapabilityModule {
  readonly capability: Capability
  isSupported(session: JmapSession, accountId: string): boolean
  bootstrap(accountId: string): Promise<void>
  sync(accountId: string): Promise<void>
  registerRoutes(): void
}

export class CapabilityModuleRegistry {
  private readonly modules = new Map<Capability, JmapCapabilityModule>()

  register(module: JmapCapabilityModule): void {
    this.modules.set(module.capability, module)
  }

  supportedModules(session: JmapSession, accountId: string): JmapCapabilityModule[] {
    return [...this.modules.values()].filter((module) => module.isSupported(session, accountId))
  }

  featureReason(session: JmapSession, accountId: string, capability: Capability): string | undefined {
    const module = this.modules.get(capability)
    if (module === undefined) return "Client module not installed."
    if (session.capabilities[capability] === undefined) return "Server does not advertise capability."
    if (!module.isSupported(session, accountId)) return "Capability not enabled for this account."
    return undefined
  }
}

export function serverCapabilityEnabled(session: JmapSession, accountId: string, capability: Capability): boolean {
  const account = session.accounts[accountId]
  return session.capabilities[capability] !== undefined && account?.accountCapabilities[capability] !== undefined
}

export function startupSummary(): readonly string[] {
  return [
    "One TypeScript monorepo",
    "Expo/RN Web shell",
    "Tauri desktop bridge shell",
    "Typed JMAP core",
    "SQLite migration baseline",
  ]
}

function stripRuntimeOnlyAccountFields(account: ConfiguredAccount): ConfiguredAccount {
  const clean: ConfiguredAccount = {
    id: account.id,
    displayName: account.displayName,
    email: account.email,
    ...(account.username === undefined ? {} : { username: account.username }),
    serverKey: account.serverKey,
    authKind: account.authKind,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
  return {
    ...clean,
    ...(account.sessionUrl === undefined ? {} : { sessionUrl: account.sessionUrl }),
    ...(account.secretRef === undefined ? {} : { secretRef: account.secretRef }),
    ...(account.lastError === undefined ? {} : { lastError: account.lastError }),
    ...(account.verifiedAt === undefined ? {} : { verifiedAt: account.verifiedAt }),
    ...(account.capabilities === undefined ? {} : { capabilities: account.capabilities }),
    ...(account.primaryMailAccountId === undefined ? {} : { primaryMailAccountId: account.primaryMailAccountId }),
  }
}

function isConfiguredAccount(input: unknown): input is ConfiguredAccount {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.email === "string" &&
    (value.username === undefined || typeof value.username === "string") &&
    typeof value.serverKey === "string" &&
    isAccountAuthKind(value.authKind) &&
    isAccountStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.sessionUrl === undefined || typeof value.sessionUrl === "string") &&
    (value.secretRef === undefined || typeof value.secretRef === "string") &&
    (value.lastError === undefined || typeof value.lastError === "string") &&
    (value.verifiedAt === undefined || typeof value.verifiedAt === "string") &&
    (value.primaryMailAccountId === undefined || typeof value.primaryMailAccountId === "string") &&
    (value.capabilities === undefined || isStringArray(value.capabilities))
  )
}

function isAccountAuthKind(value: unknown): value is AccountAuthKind {
  return value === "bearer" || value === "oauth2-pkce" || value === "basic" || value === "custom-header"
}

function isAccountStatus(value: unknown): value is ConfiguredAccount["status"] {
  return value === "needs-secret" || value === "ready" || value === "error"
}

function isLikelyEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function accountIdFromDraft(draft: AccountSetupDraft, now: string): string {
  return `${domainFromEmail(draft.email)}:${draft.email.trim().toLowerCase()}:${now}`
    .replace(/[^a-z0-9:._-]/gi, "-")
    .toLowerCase()
}

function domainFromEmail(email: string): string {
  return email.trim().toLowerCase().split("@").at(1) ?? "unknown"
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
