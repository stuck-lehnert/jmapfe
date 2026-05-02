export interface ParsedMimeMessage {
  readonly headers: readonly MimeHeader[]
  readonly text?: string
  readonly html?: string
  readonly attachments: readonly MimeAttachment[]
}

export interface MimeHeader {
  readonly name: string
  readonly value: string
}

export interface MimeAttachment {
  readonly filename?: string
  readonly contentType: string
  readonly body: Uint8Array
}

export type PgpMimeKind = "encrypted" | "signed" | "keys" | "none"

export function detectPgpMime(contentType: string): PgpMimeKind {
  const lower = contentType.toLowerCase()
  if (lower.includes("multipart/encrypted") && lower.includes('protocol="application/pgp-encrypted"')) return "encrypted"
  if (lower.includes("multipart/signed") && lower.includes('protocol="application/pgp-signature"')) return "signed"
  if (lower.includes("application/pgp-keys")) return "keys"
  return "none"
}

export function shouldBlockRemoteContent(url: string): boolean {
  const parsed = new URL(url)
  return parsed.protocol === "http:" || parsed.protocol === "https:"
}

export function canonicalizeHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-")
}
