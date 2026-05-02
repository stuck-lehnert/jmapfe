export const OPENPGP_STANDARD = "RFC9580" as const

export type TrustLevel =
  | "verified"
  | "tofu"
  | "autocrypt"
  | "wkd"
  | "manual-import"
  | "untrusted"
  | "revoked"
  | "expired"

export interface PgpPublicKeyRecord {
  readonly fingerprint: string
  readonly keyId: string
  readonly armoredPublic: string
  readonly userIds: readonly string[]
  readonly createdAt?: string
  readonly expiresAt?: string
  readonly revoked: boolean
  readonly algorithm?: string
}

export interface PgpPrivateKeyRef {
  readonly fingerprint: string
  readonly encryptedPrivateBlobId?: string
  readonly vaultRef?: string
  readonly hasPassphrase: boolean
}

export interface PgpTrustRecord {
  readonly email: string
  readonly fingerprint: string
  readonly trustLevel: TrustLevel
  readonly source: string
  readonly verifiedAt?: string
}

export interface CryptoSummary {
  readonly encrypted: boolean
  readonly signed: boolean
  readonly verified: boolean
  readonly signer?: string
  readonly warning?: string
}

export interface OpenPgpService {
  generateKey(input: { readonly userIds: readonly string[]; readonly passphrase?: string }): Promise<PgpPublicKeyRecord>
  importPublicKey(armored: string): Promise<PgpPublicKeyRecord>
  encrypt(input: { readonly plaintext: Uint8Array; readonly recipientFingerprints: readonly string[] }): Promise<Uint8Array>
  decrypt(input: { readonly ciphertext: Uint8Array; readonly privateKeyRef: PgpPrivateKeyRef }): Promise<Uint8Array>
  sign(input: { readonly bytes: Uint8Array; readonly privateKeyRef: PgpPrivateKeyRef }): Promise<Uint8Array>
  verify(input: { readonly signedBytes: Uint8Array; readonly signature: Uint8Array }): Promise<CryptoSummary>
}

export function compareProtectedFrom(input: {
  readonly outerFrom: string
  readonly protectedFrom?: string
  readonly validSignerBinding: boolean
}): CryptoSummary["warning"] {
  if (input.protectedFrom === undefined) return undefined
  if (input.validSignerBinding) return undefined
  return normalizeEmail(input.outerFrom) === normalizeEmail(input.protectedFrom)
    ? undefined
    : "Protected From differs from outer From and signer binding is not valid."
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
