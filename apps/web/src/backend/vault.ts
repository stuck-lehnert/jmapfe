import type { AccountAuthKind, ConfiguredAccount } from "@jmapfe/app-core"
import type { AuthProvider } from "@jmapfe/jmap-core"
import { invoke } from "@tauri-apps/api/core"
import { Binary } from "./binary"
import { RuntimeBackend } from "./runtime"

const FALLBACK_VAULT_STORAGE_KEY = "jmapfe.vault.fallback.v1"
const FALLBACK_VAULT_SALT_BYTES = 16
const FALLBACK_VAULT_IV_BYTES = 12
const FALLBACK_VAULT_KDF_ITERATIONS = 250_000

export namespace VaultBackend {
  export type Mode = "os" | "fallback"

  interface StoredAuthSecret {
    readonly authKind: AccountAuthKind
    readonly username: string
    readonly secret: string
  }

  interface FallbackVaultRecord {
    readonly version: 1
    readonly salt: string
    readonly iv: string
    readonly ciphertext: string
  }

  export async function loadSavedAuth(accounts: readonly ConfiguredAccount[], masterPassword: string | undefined): Promise<{ readonly auth: Record<string, AuthProvider>; readonly mode: Mode }> {
    const authEntries = await Promise.all(accounts.map(async (account) => {
      const stored = await loadStoredAuthSecret(account.id, masterPassword)
      return stored === undefined ? undefined : [account.id, authFromStoredSecret(stored)] as const
    }))
    const auth = Object.fromEntries(authEntries.filter((entry): entry is readonly [string, AuthProvider] => entry !== undefined))
    const mode = RuntimeBackend.isTauriRuntime() && masterPassword === undefined ? "os" : "fallback"
    return { auth, mode }
  }

  export async function storeAccountAuth(account: ConfiguredAccount, auth: AuthProvider, masterPassword: string | undefined): Promise<Mode> {
    const stored = storedSecretFromAuth(account, auth)
    const serialized = JSON.stringify(stored)
    if (RuntimeBackend.isTauriRuntime()) {
      try {
        await invoke("vault_set", { req: { key: vaultKey(account.id), secret: serialized } })
        return "os"
      } catch {
        // Fall through to manual fallback below.
      }
    }
    const existingVault = hasFallbackVault()
    const promptText = existingVault ? "OS keyring unavailable. Enter master password to save credentials." : "OS keyring unavailable. Choose a master password to encrypt saved credentials."
    const password = masterPassword ?? prompt(promptText)?.trim()
    if (password === undefined || password.length === 0) throw new Error("Credentials are only kept until app closes because no master password was set.")
    await putFallbackVaultSecret(account.id, serialized, password)
    return "fallback"
  }

  export async function deleteAccountAuth(accountId: string, masterPassword: string | undefined): Promise<void> {
    if (RuntimeBackend.isTauriRuntime()) {
      try {
        await invoke("vault_delete", { req: { key: vaultKey(accountId) } })
        return
      } catch {
        // Also attempt fallback removal.
      }
    }
    if (masterPassword !== undefined && masterPassword.length > 0) await deleteFallbackVaultSecret(accountId, masterPassword)
  }

  export function hasFallbackVault(): boolean {
    return Object.keys(loadFallbackVault()).length > 0
  }

  function loadStoredAuthSecret(accountId: string, masterPassword: string | undefined): Promise<StoredAuthSecret | undefined> {
    return loadStoredAuthSecretAsync(accountId, masterPassword)
  }

  async function loadStoredAuthSecretAsync(accountId: string, masterPassword: string | undefined): Promise<StoredAuthSecret | undefined> {
    if (RuntimeBackend.isTauriRuntime() && masterPassword === undefined) {
      const secret = await invoke<string | null>("vault_get", { req: { key: vaultKey(accountId) } })
      return secret === null ? undefined : parseStoredAuthSecret(secret)
    }
    if (masterPassword === undefined) throw new Error("Master password required.")
    const secret = await getFallbackVaultSecret(accountId, masterPassword)
    return secret === undefined ? undefined : parseStoredAuthSecret(secret)
  }

  function storedSecretFromAuth(account: ConfiguredAccount, auth: AuthProvider): StoredAuthSecret {
    if (auth.kind === "basic") return { authKind: "basic", username: auth.username, secret: readStringSecret(auth.password) }
    if (auth.kind === "bearer") return { authKind: "bearer", username: auth.username ?? account.username ?? account.email, secret: readStringSecret(auth.token) }
    throw new Error("Only password and API token credentials can be saved yet.")
  }

  function authFromStoredSecret(stored: StoredAuthSecret): AuthProvider {
    if (stored.authKind === "basic") return { kind: "basic", username: stored.username, password: stored.secret, warnUser: true }
    if (stored.authKind === "bearer") return { kind: "bearer", username: stored.username, token: stored.secret }
    throw new Error("Saved credential type is not supported.")
  }

  function readStringSecret(secret: unknown): string {
    if (typeof secret !== "string") throw new Error("Credential cannot be saved yet.")
    return secret
  }

  function parseStoredAuthSecret(value: string): StoredAuthSecret {
    const parsed = JSON.parse(value) as Partial<StoredAuthSecret>
    if ((parsed.authKind !== "basic" && parsed.authKind !== "bearer") || typeof parsed.username !== "string" || typeof parsed.secret !== "string") throw new Error("Saved credential is invalid.")
    return { authKind: parsed.authKind, username: parsed.username, secret: parsed.secret }
  }

  function vaultKey(accountId: string): string {
    return `account:${accountId}:auth`
  }

  async function getFallbackVaultSecret(accountId: string, masterPassword: string): Promise<string | undefined> {
    const vault = loadFallbackVault()
    const record = vault[vaultKey(accountId)]
    if (record === undefined) return undefined
    return decryptFallbackVaultRecord(record, masterPassword)
  }

  async function putFallbackVaultSecret(accountId: string, secret: string, masterPassword: string): Promise<void> {
    const vault = loadFallbackVault()
    vault[vaultKey(accountId)] = await encryptFallbackVaultRecord(secret, masterPassword)
    saveFallbackVault(vault)
  }

  async function deleteFallbackVaultSecret(accountId: string, masterPassword: string): Promise<void> {
    const vault = loadFallbackVault()
    const key = vaultKey(accountId)
    if (vault[key] !== undefined) await decryptFallbackVaultRecord(vault[key], masterPassword)
    delete vault[key]
    saveFallbackVault(vault)
  }

  function loadFallbackVault(): Record<string, FallbackVaultRecord> {
    try {
      const value = globalThis.localStorage?.getItem(FALLBACK_VAULT_STORAGE_KEY)
      if (value === undefined || value === null || value.length === 0) return {}
      return JSON.parse(value) as Record<string, FallbackVaultRecord>
    } catch {
      return {}
    }
  }

  function saveFallbackVault(vault: Record<string, FallbackVaultRecord>): void {
    globalThis.localStorage?.setItem(FALLBACK_VAULT_STORAGE_KEY, JSON.stringify(vault))
  }

  async function encryptFallbackVaultRecord(secret: string, masterPassword: string): Promise<FallbackVaultRecord> {
    const salt = Binary.randomBytes(FALLBACK_VAULT_SALT_BYTES)
    const iv = Binary.randomBytes(FALLBACK_VAULT_IV_BYTES)
    const key = await deriveFallbackVaultKey(masterPassword, salt)
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: Binary.bufferSource(iv) }, key, new TextEncoder().encode(secret))
    return { version: 1, salt: Binary.bytesToBase64(salt), iv: Binary.bytesToBase64(iv), ciphertext: Binary.bytesToBase64(new Uint8Array(ciphertext)) }
  }

  async function decryptFallbackVaultRecord(record: FallbackVaultRecord, masterPassword: string): Promise<string> {
    const key = await deriveFallbackVaultKey(masterPassword, Binary.base64ToBytes(record.salt))
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Binary.bufferSource(Binary.base64ToBytes(record.iv)) }, key, Binary.bufferSource(Binary.base64ToBytes(record.ciphertext)))
    return new TextDecoder().decode(plaintext)
  }

  async function deriveFallbackVaultKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(masterPassword), "PBKDF2", false, ["deriveKey"])
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: Binary.bufferSource(salt), iterations: FALLBACK_VAULT_KDF_ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
  }
}
