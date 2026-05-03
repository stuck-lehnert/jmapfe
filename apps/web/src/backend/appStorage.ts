import { parseConfiguredAccounts, serializeConfiguredAccounts, type ConfiguredAccount } from "@jmapfe/app-core"
import { MailModel } from "./mailModel"
import { MailState } from "./mailState"

type AccountMailState = MailModel.AccountMailState
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type MailboxRights = MailModel.MailboxRights
type MailboxSummary = MailModel.MailboxSummary
type MailMessage = MailModel.MailMessage
type MessageFlagState = MailModel.MessageFlagState

const ACCOUNTS_STORAGE_KEY = "jmapfe.accounts.v1"
const MAIL_CACHE_STORAGE_KEY = "jmapfe.mail-cache.v1"
const REMOTE_IMAGE_PROXY_STORAGE_KEY = "jmapfe.remote-image-proxy.v1"

export namespace AppStorage {
  export function loadAccounts(): ConfiguredAccount[] {
    try {
      return parseConfiguredAccounts(globalThis.localStorage?.getItem(ACCOUNTS_STORAGE_KEY))
    } catch {
      return []
    }
  }

  export function saveAccounts(accounts: readonly ConfiguredAccount[]): void {
    try {
      globalThis.localStorage?.setItem(ACCOUNTS_STORAGE_KEY, serializeConfiguredAccounts(accounts))
    } catch {
      // Native vault/store wiring will replace browser storage.
    }
  }

  export function loadMailCache(): Record<string, AccountMailState> {
    try {
      const raw = globalThis.localStorage?.getItem(MAIL_CACHE_STORAGE_KEY)
      if (raw === undefined || raw === null || raw.trim().length === 0) return {}
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
      return Object.fromEntries(Object.entries(parsed).flatMap(([accountId, value]) => {
        const cached = parseCachedMailState(value)
        return cached === undefined ? [] : [[accountId, cached]]
      }))
    } catch {
      return {}
    }
  }

  export function saveMailCache(mailByAccount: Record<string, AccountMailState>): void {
    try {
      const cache = Object.fromEntries(Object.entries(mailByAccount).flatMap(([accountId, state]) => {
        if (state.mailboxes.length === 0 && state.messages.length === 0) return []
        return [[accountId, {
          status: "ready",
          mailboxes: state.mailboxes,
          messages: state.messages.map(MailState.stripMessageContent),
          ...(state.syncedAt === undefined ? {} : { syncedAt: state.syncedAt }),
        } satisfies AccountMailState]]
      }))
      globalThis.localStorage?.setItem(MAIL_CACHE_STORAGE_KEY, JSON.stringify(cache))
    } catch {
      // Durable SQLite cache replaces localStorage later.
    }
  }

  export function pruneMailCache(mailByAccount: Record<string, AccountMailState>, accounts: readonly ConfiguredAccount[]): Record<string, AccountMailState> {
    const accountIds = new Set(accounts.map((account) => account.id))
    return Object.fromEntries(Object.entries(mailByAccount).filter(([accountId]) => accountIds.has(accountId)))
  }

  export function loadRemoteImageProxyBase(): string | undefined {
    try {
      const value = globalThis.localStorage?.getItem(REMOTE_IMAGE_PROXY_STORAGE_KEY)?.trim()
      return value === undefined || value.length === 0 || !isHttpsUrl(value) ? undefined : value
    } catch {
      return undefined
    }
  }

  export function saveRemoteImageProxyBase(value: string | undefined): void {
    try {
      if (value === undefined) {
        globalThis.localStorage?.removeItem(REMOTE_IMAGE_PROXY_STORAGE_KEY)
      } else {
        globalThis.localStorage?.setItem(REMOTE_IMAGE_PROXY_STORAGE_KEY, value)
      }
    } catch {
      // Settings storage moves to app store with rest of local config later.
    }
  }

  function parseCachedMailState(value: unknown): AccountMailState | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const input = value as Partial<AccountMailState>
    const mailboxes = Array.isArray(input.mailboxes) ? input.mailboxes.filter(isMailboxSummary) : []
    const messages = Array.isArray(input.messages) ? input.messages.flatMap(parseCachedMailMessage).map(MailState.stripMessageContent) : []
    if (mailboxes.length === 0 && messages.length === 0) return undefined
    return {
      status: "ready",
      mailboxes,
      messages,
      ...(typeof input.syncedAt === "string" ? { syncedAt: input.syncedAt } : {}),
    }
  }

  function isMailboxSummary(value: unknown): value is MailboxSummary {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const mailbox = value as Partial<MailboxSummary>
    return typeof mailbox.id === "string"
      && typeof mailbox.name === "string"
      && (mailbox.serverId === undefined || typeof mailbox.serverId === "string")
      && (mailbox.jmapAccountId === undefined || typeof mailbox.jmapAccountId === "string")
      && (mailbox.jmapAccountName === undefined || typeof mailbox.jmapAccountName === "string")
      && (mailbox.jmapAccountIsPersonal === undefined || typeof mailbox.jmapAccountIsPersonal === "boolean")
      && (mailbox.jmapAccountIsReadOnly === undefined || typeof mailbox.jmapAccountIsReadOnly === "boolean")
      && (mailbox.role === undefined || typeof mailbox.role === "string")
      && (mailbox.parentId === undefined || typeof mailbox.parentId === "string")
      && (mailbox.sortOrder === undefined || typeof mailbox.sortOrder === "number")
      && (mailbox.totalEmails === undefined || typeof mailbox.totalEmails === "number")
      && (mailbox.unreadEmails === undefined || typeof mailbox.unreadEmails === "number")
      && (mailbox.isSubscribed === undefined || typeof mailbox.isSubscribed === "boolean")
      && (mailbox.myRights === undefined || isMailboxRights(mailbox.myRights))
      && (mailbox.isSynthetic === undefined || typeof mailbox.isSynthetic === "boolean")
  }

  function isMailboxRights(value: unknown): value is MailboxRights {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const rights = value as Record<string, unknown>
    return [
      rights.mayReadItems,
      rights.mayAddItems,
      rights.mayRemoveItems,
      rights.maySetSeen,
      rights.maySetKeywords,
      rights.mayCreateChild,
      rights.mayRename,
      rights.mayDelete,
      rights.maySubmit,
      rights.mayShare,
    ].every((item) => item === undefined || typeof item === "boolean")
  }

  function parseCachedMailMessage(value: unknown): MailMessage[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return []
    const input = value as Record<string, unknown>
    const attachments = Array.isArray(input.attachments) ? input.attachments.filter(isEmailAttachmentPart) : []
    const flagState = isMessageFlagState(input.flagState) ? input.flagState : "unflagged"
    const read = typeof input.read === "boolean" ? input.read : true
    const normalized = { ...input, attachments, flagState, read }
    return isMailMessage(normalized) ? [normalized] : []
  }

  function isMessageFlagState(value: unknown): value is MessageFlagState {
    return value === "unflagged" || value === "flagged" || value === "done"
  }

  function isEmailAttachmentPart(value: unknown): value is EmailAttachmentPart {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const attachment = value as Partial<EmailAttachmentPart>
    return typeof attachment.name === "string"
      && typeof attachment.type === "string"
      && (attachment.partId === undefined || typeof attachment.partId === "string")
      && (attachment.blobId === undefined || typeof attachment.blobId === "string")
      && (attachment.size === undefined || typeof attachment.size === "number")
      && (attachment.disposition === undefined || typeof attachment.disposition === "string")
      && (attachment.cid === undefined || typeof attachment.cid === "string")
  }

  function isMailMessage(value: unknown): value is MailMessage {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const message = value as Partial<MailMessage>
    return typeof message.id === "string" &&
      typeof message.key === "string" &&
      typeof message.accountId === "string" &&
      typeof message.accountName === "string" &&
      (message.jmapAccountId === undefined || typeof message.jmapAccountId === "string") &&
      Array.isArray(message.mailboxIds) && message.mailboxIds.every((mailboxId) => typeof mailboxId === "string") &&
      typeof message.subject === "string" &&
      typeof message.read === "boolean" &&
      isMessageFlagState(message.flagState) &&
      typeof message.from === "string" &&
      Array.isArray(message.to) && message.to.every((address) => typeof address === "string") &&
      (message.receivedAt === undefined || typeof message.receivedAt === "string") &&
      (message.sentAt === undefined || typeof message.sentAt === "string") &&
      (message.bodyText === undefined || typeof message.bodyText === "string") &&
      (message.bodyHtml === undefined || typeof message.bodyHtml === "string") &&
      (message.bodyLoaded === undefined || typeof message.bodyLoaded === "boolean") &&
      (message.inlineImages === undefined || Array.isArray(message.inlineImages)) &&
      (message.inlineImageDataByCid === undefined || typeof message.inlineImageDataByCid === "object") &&
      Array.isArray(message.attachments) && message.attachments.every(isEmailAttachmentPart) &&
      typeof message.hasAttachment === "boolean" &&
      (message.hasSignatureAttachment === undefined || typeof message.hasSignatureAttachment === "boolean") &&
      (message.hasPublicKeyAttachment === undefined || typeof message.hasPublicKeyAttachment === "boolean")
  }

  function isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === "https:"
    } catch {
      return false
    }
  }
}
