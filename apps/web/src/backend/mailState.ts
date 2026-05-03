import { EmailHtml } from "./emailHtml"
import { MailModel } from "./mailModel"

type AccountMailState = MailModel.AccountMailState
type InlineImagePart = MailModel.InlineImagePart
type MailMessage = MailModel.MailMessage
type MessageBody = MailModel.MessageBody
type MessageFlagState = MailModel.MessageFlagState
type LoadedMessageBatch = MailModel.LoadedMessageBatch
type LoadedMailTargetBatch = MailModel.LoadedMailTargetBatch

const MESSAGE_REVEAL_CHUNK_SIZE = 8
const MESSAGE_REVEAL_DELAY_MS = 35

export namespace MailState {
  export function mergeLoadedMessageBatches(mailByAccount: Record<string, AccountMailState>, batches: readonly LoadedMessageBatch[]): Record<string, AccountMailState> {
    return batches.reduce((current, batch) => {
      if (batch.messages.length === 0) return current
      const state = current[batch.accountId] ?? emptyAccountMailState()
      const byKey = new Map(state.messages.map((message) => [message.key, message]))
      for (const message of batch.messages) byKey.set(message.key, mergeMessageMetadata(byKey.get(message.key), message))
      return {
        ...current,
        [batch.accountId]: {
          status: "ready",
          mailboxes: state.mailboxes,
          messages: [...byKey.values()].sort((left, right) => messageTime(right) - messageTime(left)),
          syncedAt: new Date().toISOString(),
        },
      }
    }, mailByAccount)
  }

  export function mergeMailTargetBatch(mailByAccount: Record<string, AccountMailState>, accountId: string, batch: LoadedMailTargetBatch): Record<string, AccountMailState> {
    const state = mailByAccount[accountId] ?? emptyAccountMailState()
    const mailboxesById = new Map(state.mailboxes.map((mailbox) => [mailbox.id, mailbox]))
    const messagesByKey = new Map(state.messages.map((message) => [message.key, message]))
    for (const mailbox of batch.mailboxes) mailboxesById.set(mailbox.id, mailbox)
    for (const message of batch.messages) messagesByKey.set(message.key, mergeMessageMetadata(messagesByKey.get(message.key), message))
    return {
      ...mailByAccount,
      [accountId]: {
        status: "syncing",
        mailboxes: [...mailboxesById.values()],
        messages: [...messagesByKey.values()].sort((left, right) => messageTime(right) - messageTime(left)),
        ...(state.syncedAt === undefined ? {} : { syncedAt: state.syncedAt }),
      },
    }
  }

  export function mergeFetchedMailState(existing: AccountMailState | undefined, next: AccountMailState): AccountMailState {
    const byKey = new Map(existing?.messages.map((message) => [message.key, message]) ?? [])
    return {
      ...next,
      messages: next.messages.map((message) => mergeMessageMetadata(byKey.get(message.key), message)),
    }
  }

  // Preserve already-loaded body/inline data when fresh metadata arrives from sync/search.
  export function mergeMessageMetadata(existing: MailMessage | undefined, metadata: MailMessage): MailMessage {
    if (existing?.bodyLoaded !== true) return metadata
    return {
      ...metadata,
      bodyLoaded: true,
      bodyText: existing.bodyText ?? "",
      ...(existing.bodyHtml === undefined ? {} : { bodyHtml: existing.bodyHtml }),
      ...(existing.inlineImages === undefined ? {} : { inlineImages: existing.inlineImages }),
      ...(existing.inlineImageDataByCid === undefined ? {} : { inlineImageDataByCid: existing.inlineImageDataByCid }),
    }
  }

  export function mergeMessageBody(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, body: MessageBody): Record<string, AccountMailState> {
    const state = mailByAccount[accountId]
    if (state === undefined) return mailByAccount
    return {
      ...mailByAccount,
      [accountId]: {
        ...state,
        messages: state.messages.map((message) => {
          if (message.key !== messageKey) return message
          const { bodyHtml: _oldBodyHtml, ...metadata } = message
          return {
            ...metadata,
            bodyLoaded: true,
            bodyText: body.bodyText,
            ...(body.bodyHtml === undefined ? {} : { bodyHtml: body.bodyHtml }),
            inlineImages: body.inlineImages,
            attachments: body.attachments,
            hasAttachment: message.hasAttachment || body.attachments.length > 0,
            hasSignatureAttachment: message.hasSignatureAttachment === true || body.attachments.some(isSignatureAttachment),
            hasPublicKeyAttachment: message.hasPublicKeyAttachment === true || body.attachments.some(isPublicKeyAttachment),
          }
        }),
      },
    }
  }

  export function mergeInlineImageData(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, inlineImageDataByCid: Record<string, string>): Record<string, AccountMailState> {
    const state = mailByAccount[accountId]
    if (state === undefined) return mailByAccount
    return {
      ...mailByAccount,
      [accountId]: {
        ...state,
        messages: state.messages.map((message) => message.key === messageKey ? {
          ...message,
          inlineImageDataByCid: { ...(message.inlineImageDataByCid ?? {}), ...inlineImageDataByCid },
        } : message),
      },
    }
  }

  export function updateMessageFlagState(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, flagState: MessageFlagState): Record<string, AccountMailState> {
    const state = mailByAccount[accountId]
    if (state === undefined) return mailByAccount
    return {
      ...mailByAccount,
      [accountId]: {
        ...state,
        messages: state.messages.map((message) => message.key === messageKey ? { ...message, flagState } : message),
      },
    }
  }

  export function nextMessageFlagState(flagState: MessageFlagState): MessageFlagState {
    if (flagState === "unflagged") return "flagged"
    if (flagState === "flagged") return "done"
    return "unflagged"
  }

  export function updateMessageReadState(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, read: boolean): Record<string, AccountMailState> {
    const state = mailByAccount[accountId]
    if (state === undefined) return mailByAccount
    return {
      ...mailByAccount,
      [accountId]: {
        ...state,
        messages: state.messages.map((message) => message.key === messageKey ? { ...message, read } : message),
      },
    }
  }

  export function updateMessageMailboxIds(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, mailboxIds: readonly string[]): Record<string, AccountMailState> {
    const state = mailByAccount[accountId]
    if (state === undefined) return mailByAccount
    return {
      ...mailByAccount,
      [accountId]: {
        ...state,
        messages: state.messages.map((message) => message.key === messageKey ? { ...message, mailboxIds } : message),
      },
    }
  }

  export function canSetMessageReadState(mail: AccountMailState | undefined, message: MailMessage): boolean {
    if (mail === undefined) return true
    const messageMailboxIds = new Set(message.mailboxIds)
    const containingMailboxes = mail.mailboxes.filter((mailbox) => messageMailboxIds.has(mailbox.id))
    return containingMailboxes.every((mailbox) => mailbox.jmapAccountIsReadOnly !== true && mailbox.myRights?.maySetSeen !== false)
  }

  export function inlineImagesToLoad(message: MailMessage): InlineImagePart[] {
    const loaded = message.inlineImageDataByCid ?? {}
    const referencedCids = message.bodyHtml === undefined ? undefined : EmailHtml.inlineImageCidsInHtml(message.bodyHtml)
    return (message.inlineImages ?? []).filter((image) => loaded[image.cid] === undefined && (referencedCids === undefined || referencedCids.has(image.cid)))
  }

  export function stripMessageContent(message: MailMessage): MailMessage {
    const { bodyText: _bodyText, bodyHtml: _bodyHtml, bodyLoaded: _bodyLoaded, inlineImages: _inlineImages, inlineImageDataByCid: _inlineImageDataByCid, preview: _preview, ...metadata } = message as MailMessage & { readonly preview?: string }
    return metadata
  }

  export function uniqueMessages(messages: readonly MailMessage[]): MailMessage[] {
    const byKey = new Map<string, MailMessage>()
    for (const message of messages) if (!byKey.has(message.key)) byKey.set(message.key, message)
    return [...byKey.values()]
  }

  export function messageChunks(messages: readonly MailMessage[]): MailMessage[][] {
    const chunks: MailMessage[][] = []
    for (let index = 0; index < messages.length; index += MESSAGE_REVEAL_CHUNK_SIZE) chunks.push([...messages.slice(index, index + MESSAGE_REVEAL_CHUNK_SIZE)])
    return chunks
  }

  export function waitForMessageReveal(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, MESSAGE_REVEAL_DELAY_MS))
  }

  export function loadFailuresMessage(label: string, failures: readonly string[]): string {
    const first = failures[0]
    if (first === undefined) return "Load failed."
    return `${failures.length} ${label}${failures.length === 1 ? "" : "s"} failed. ${first}`
  }

  export function sumKnownMailboxCounts(values: readonly (number | undefined)[]): number | undefined {
    const known = values.filter((value): value is number => value !== undefined)
    return known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0)
  }

  export function messageTime(message: MailMessage): number {
    return Date.parse(message.receivedAt ?? message.sentAt ?? "") || 0
  }

  export function emptyAccountMailState(): AccountMailState {
    return { status: "idle", mailboxes: [], messages: [] }
  }

  export function isSignatureAttachment(attachment: { readonly type?: unknown; readonly name?: unknown }): boolean {
    const type = stringValue(attachment.type)?.toLowerCase() ?? ""
    const name = stringValue(attachment.name)?.toLowerCase() ?? ""
    return type.includes("pgp-signature")
      || type.includes("pkcs7-signature")
      || name.endsWith(".sig")
      || name.endsWith(".p7s")
      || name === "signature.asc"
  }

  export function isPublicKeyAttachment(attachment: { readonly type?: unknown; readonly name?: unknown }): boolean {
    if (isSignatureAttachment(attachment)) return false
    const type = stringValue(attachment.type)?.toLowerCase() ?? ""
    const name = stringValue(attachment.name)?.toLowerCase() ?? ""
    return type.includes("pgp-keys")
      || type.includes("pgp-key")
      || type.includes("x-pgp-key")
      || name.endsWith(".pub")
      || name.endsWith(".gpg")
      || name.endsWith(".pgp")
      || (name.endsWith(".asc") && /(pub|public|key|pgp|openpgp)/.test(name))
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
  }
}
