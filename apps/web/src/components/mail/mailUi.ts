import type { ConfiguredAccount } from "@jmapfe/app-core"
import { EmailHtml, MailModel } from "../../backend"
import { Theme } from "../../theme"
import { Ui } from "../primitives"

type AccountMailState = MailModel.AccountMailState
type ComposeDraft = MailModel.ComposeDraft
type ComposeMode = MailModel.ComposeMode
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type FolderLoadTarget = MailModel.FolderLoadTarget
type LoadedMessageBatch = MailModel.LoadedMessageBatch
type MailMessage = MailModel.MailMessage
type MailboxSummary = MailModel.MailboxSummary
type MessageFlagState = MailModel.MessageFlagState
type SearchState = MailModel.SearchState
type MaterialIconName = Ui.MaterialIconName

const C = Theme.colors

export namespace MailUi {
  export interface PaneFolder {
    readonly folderId: string
    readonly label: string
    readonly icon: MaterialIconName
    readonly count?: number | undefined
    readonly level?: number | undefined
    readonly badges?: readonly string[] | undefined
  }

  export function accountFolders(account: ConfiguredAccount, mail: AccountMailState | undefined): PaneFolder[] {
    if (mail?.mailboxes.length) {
      return flattenMailboxTree(mail.mailboxes).map(({ mailbox, level }) => ({
        folderId: mailboxFolderId(account.id, mailbox.id),
        label: mailbox.name,
        icon: folderIconForMailbox(mailbox),
        count: mailbox.totalEmails ?? countMessagesForMailbox(mail, mailbox),
        level,
        badges: mailboxBadges(mailbox),
      }))
    }

    return []
  }

  export function mailboxBadges(mailbox: MailboxSummary): string[] {
    return [
      mailbox.isSynthetic === true && mailbox.jmapAccountIsPersonal === false ? "shared" : undefined,
      mailbox.jmapAccountIsReadOnly === true || mailbox.myRights?.mayAddItems === false ? "read-only" : undefined,
      mailbox.isSubscribed === false ? "unsubscribed" : undefined,
      mailbox.myRights?.mayReadItems === false ? "no access" : undefined,
    ].filter((badge): badge is string => badge !== undefined)
  }

  export function folderIconForMailbox(mailbox: MailboxSummary): MaterialIconName {
    if (mailbox.isSynthetic === true) return "folder"
    return folderIconForRole(mailbox.role)
  }

  export function folderIconForRole(role: string | undefined): MaterialIconName {
    if (role === "inbox") return "inbox"
    if (role === "sent") return "send"
    if (role === "drafts") return "drafts"
    if (role === "archive") return "archive"
    if (role === "trash") return "delete"
    if (role === "junk") return "report"
    return "folder"
  }

  export function accountEmailForMessage(accounts: readonly ConfiguredAccount[], message: MailMessage): string {
    return accounts.find((account) => account.id === message.accountId)?.email ?? message.accountName
  }

  export function composeDraftForMessage(accounts: readonly ConfiguredAccount[], message: MailMessage, mode: Exclude<ComposeMode, "new">): ComposeDraft {
    const accountEmail = accountEmailForMessage(accounts, message)
    const replyTo = replyRecipients(message)
    const primary = mode === "reply-all" ? replyAllPrimaryRecipients(message, accountEmail, replyTo) : replyTo
    const cc = mode === "reply-all" ? replyAllCcRecipients(message, accountEmail, primary) : []
    return {
      accountId: message.accountId,
      ...(message.jmapAccountId === undefined ? {} : { jmapAccountId: message.jmapAccountId }),
      mode,
      to: mode === "forward" ? "" : primary.join(", "),
      cc: mode === "reply-all" ? cc.join(", ") : "",
      bcc: "",
      subject: composeSubject(mode, message.subject),
      body: composeBody(mode, message),
      sourceMessageKey: message.key,
      ...(message.messageId?.[0] === undefined ? {} : { sourceMessageId: message.messageId[0] }),
      ...(message.references === undefined ? {} : { sourceReferences: message.references }),
    }
  }

  export function composeSubject(mode: ComposeMode, subject: string): string {
    if (mode === "new") return subject
    const trimmed = subject.trim()
    if (mode === "forward") return /^(fwd?|fw):/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`
    return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
  }

  export function composeBody(mode: ComposeMode, message: MailMessage): string {
    const sourceText = message.bodyText ?? (message.bodyHtml === undefined ? "" : EmailHtml.stripHtml(message.bodyHtml))
    if (mode === "forward") {
      return [
        "",
        "",
        "---------- Forwarded message ----------",
        `From: ${message.from || "Unknown sender"}`,
        message.to.length === 0 ? undefined : `To: ${message.to.join(", ")}`,
        `Date: ${formatMessageDate(message.sentAt ?? message.receivedAt)}`,
        `Subject: ${message.subject || "(no subject)"}`,
        "",
        sourceText,
      ].filter((part): part is string => part !== undefined).join("\n")
    }
    return [
      "",
      "",
      `On ${formatMessageDate(message.sentAt ?? message.receivedAt)}, ${message.from || "unknown sender"} wrote:`,
      quoteText(sourceText),
    ].join("\n")
  }

  function replyRecipients(message: MailMessage): string[] {
    const replyTo = uniqueAddresses(message.replyTo ?? [])
    if (replyTo.length > 0) return replyTo
    return message.from.length === 0 ? [] : [message.from]
  }

  function replyAllPrimaryRecipients(message: MailMessage, accountEmail: string, replyTo: readonly string[]): string[] {
    const ownKey = addressKey(accountEmail)
    const primary = uniqueAddresses(replyTo).filter((address) => addressKey(address) !== ownKey)
    if (primary.length > 0) return primary
    return uniqueAddresses(message.to).filter((address) => addressKey(address) !== ownKey)
  }

  function replyAllCcRecipients(message: MailMessage, accountEmail: string, primary: readonly string[]): string[] {
    const blocked = new Set([addressKey(accountEmail), ...primary.map(addressKey)])
    return uniqueAddresses([...message.to, ...(message.cc ?? [])]).filter((address) => !blocked.has(addressKey(address)))
  }

  function uniqueAddresses(addresses: readonly string[]): string[] {
    const seen = new Set<string>()
    const unique: string[] = []
    for (const address of addresses) {
      const trimmed = address.trim()
      if (trimmed.length === 0) continue
      const key = addressKey(trimmed)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(trimmed)
    }
    return unique
  }

  function addressKey(value: string): string {
    const match = /<([^<>]+)>/.exec(value)
    return (match?.[1] ?? value).trim().toLowerCase()
  }

  function quoteText(value: string): string {
    if (value.trim().length === 0) return ">"
    return value.split(/\r?\n/).map((line) => `> ${line}`).join("\n")
  }

  export function flattenMailboxTree(mailboxes: readonly MailboxSummary[]): { readonly mailbox: MailboxSummary; readonly level: number }[] {
    const byParent = new Map<string | undefined, MailboxSummary[]>()
    for (const mailbox of mailboxes) {
      const parent = mailbox.parentId
      byParent.set(parent, [...(byParent.get(parent) ?? []), mailbox])
    }
    for (const [parent, children] of byParent) byParent.set(parent, sortMailboxes(children))

    const seen = new Set<string>()
    const flattened: { readonly mailbox: MailboxSummary; readonly level: number }[] = []
    const append = (parentId: string | undefined, level: number) => {
      for (const mailbox of byParent.get(parentId) ?? []) {
        if (seen.has(mailbox.id)) continue
        seen.add(mailbox.id)
        flattened.push({ mailbox, level })
        append(mailbox.id, level + 1)
      }
    }

    append(undefined, 0)
    append("", 0)
    for (const mailbox of sortMailboxes(mailboxes)) {
      if (seen.has(mailbox.id)) continue
      seen.add(mailbox.id)
      flattened.push({ mailbox, level: 0 })
      append(mailbox.id, 1)
    }
    return flattened
  }

  export function sortMailboxes(mailboxes: readonly MailboxSummary[]): MailboxSummary[] {
    return [...mailboxes].sort((left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name))
  }

  export function accountFolderStatusText(mail: AccountMailState | undefined): string {
    if (mail === undefined || mail.status === "idle") return "Not fetched"
    if (mail.status === "syncing") return "Fetching..."
    if (mail.status === "error") return mail.error ?? "Fetch failed"
    return `${mail.messages.length} messages, ${mail.mailboxes.length} folders`
  }

  export function countMessagesForFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): number {
    return messagesForFolder(accounts, mailByAccount, folderId).length
  }

  export function countMessagesForRole(mail: AccountMailState, role: string): number {
    return mail.messages.filter((message) => messageInRole(message, mail.mailboxes, role)).length
  }

  export function countMessagesInMailbox(messages: readonly MailMessage[], mailboxId: string): number {
    return messages.filter((message) => message.mailboxIds.includes(mailboxId)).length
  }

  export function countMessagesForMailbox(mail: AccountMailState, mailbox: MailboxSummary): number {
    const mailboxIds = mailbox.isSynthetic === true ? mailboxAndDescendantIds(mail.mailboxes, mailbox.id) : [mailbox.id]
    return mail.messages.filter((message) => message.mailboxIds.some((mailboxId) => mailboxIds.includes(mailboxId))).length
  }

  export function mailboxAndDescendantIds(mailboxes: readonly MailboxSummary[], mailboxId: string): string[] {
    const byParent = new Map<string, string[]>()
    for (const mailbox of mailboxes) {
      if (mailbox.parentId === undefined) continue
      byParent.set(mailbox.parentId, [...(byParent.get(mailbox.parentId) ?? []), mailbox.id])
    }
    const ids: string[] = []
    const append = (id: string) => {
      ids.push(id)
      for (const childId of byParent.get(id) ?? []) append(childId)
    }
    append(mailboxId)
    return ids
  }

  export function mailboxFolderId(accountId: string, mailboxId: string): string {
    return `${accountId}:mailbox:${encodeURIComponent(mailboxId)}`
  }

  export function parseMailboxFolderId(folderId: string): { readonly accountId: string; readonly mailboxId: string } | undefined {
    const marker = ":mailbox:"
    const markerIndex = folderId.lastIndexOf(marker)
    if (markerIndex < 0) return undefined
    const accountId = folderId.slice(0, markerIndex)
    const encodedMailboxId = folderId.slice(markerIndex + marker.length)
    if (accountId.length === 0 || encodedMailboxId.length === 0) return undefined
    return { accountId, mailboxId: decodeURIComponent(encodedMailboxId) }
  }

  export function parseAccountRoleFolderId(accounts: readonly ConfiguredAccount[], folderId: string): { readonly account: ConfiguredAccount; readonly role: string } | undefined {
    for (const account of accounts) {
      for (const folder of MailModel.ACCOUNT_FOLDERS) {
        if (folderId === `${account.id}:${folder.id}`) return { account, role: folder.id }
      }
    }
    return undefined
  }

  export function messagesForFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): MailMessage[] {
    const mailboxFolder = parseMailboxFolderId(folderId)
    if (mailboxFolder !== undefined) {
      const mail = mailByAccount[mailboxFolder.accountId]
      const mailbox = mail?.mailboxes.find((item) => item.id === mailboxFolder.mailboxId)
      const mailboxIds = mail === undefined || mailbox?.isSynthetic !== true ? [mailboxFolder.mailboxId] : mailboxAndDescendantIds(mail.mailboxes, mailboxFolder.mailboxId)
      return (mail?.messages ?? [])
        .filter((message) => message.mailboxIds.some((mailboxId) => mailboxIds.includes(mailboxId)))
        .sort((left, right) => messageTime(right) - messageTime(left))
    }

    const roleFolder = parseAccountRoleFolderId(accounts, folderId)
    const [unifiedScope, unifiedRole] = folderId.startsWith("unified:") ? folderId.split(":") : []
    const role = roleFolder?.role ?? unifiedRole ?? "inbox"
    const scopedAccounts = unifiedScope === "unified" ? accounts : roleFolder === undefined ? [] : [roleFolder.account]
    return scopedAccounts
      .flatMap((account) => {
        const mail = mailByAccount[account.id]
        if (mail === undefined) return []
        return mail.messages.filter((message) => messageInRole(message, mail.mailboxes, role))
      })
      .sort((left, right) => messageTime(right) - messageTime(left))
  }

  export function localSearchMessages(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string, query: string): MailMessage[] {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0)
    if (terms.length === 0) return []
    return messagesForFolder(accounts, mailByAccount, folderId).filter((message) => {
      const text = localMessageSearchText(message)
      return terms.every((term) => text.includes(term))
    })
  }

  export function localMessageSearchText(message: MailMessage): string {
    return [
      message.subject,
      message.from,
      ...message.to,
      message.bodyText,
      message.bodyHtml === undefined ? undefined : EmailHtml.stripHtml(message.bodyHtml),
      message.flagState === "unflagged" ? undefined : message.flagState,
      ...message.attachments.flatMap((attachment) => [attachment.name, attachment.type]),
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("\n")
      .toLowerCase()
  }

  export function messagesForKeys(mailByAccount: Record<string, AccountMailState>, messageKeys: readonly string[]): MailMessage[] {
    return messageKeys.flatMap((key) => {
      const message = findMessageByKey(mailByAccount, key)
      return message === undefined ? [] : [message]
    })
  }

  export function findMessageByKey(mailByAccount: Record<string, AccountMailState>, messageKey: string): MailMessage | undefined {
    for (const state of Object.values(mailByAccount)) {
      const message = state.messages.find((item) => item.key === messageKey)
      if (message !== undefined) return message
    }
    return undefined
  }

  export function findMailboxByRole(mail: AccountMailState | undefined, jmapAccountId: string | undefined, role: string): MailboxSummary | undefined {
    return mail?.mailboxes.find((mailbox) => mailbox.role === role
      && mailbox.serverId !== undefined
      && mailbox.isSynthetic !== true
      && (jmapAccountId === undefined || mailbox.jmapAccountId === jmapAccountId))
  }

  export function canDropMessageOnFolder(mailByAccount: Record<string, AccountMailState>, messageKey: string | undefined, folderId: string): boolean {
    if (messageKey === undefined) return false
    const folder = parseMailboxFolderId(folderId)
    if (folder === undefined) return false
    const message = findMessageByKey(mailByAccount, messageKey)
    const destination = mailByAccount[folder.accountId]?.mailboxes.find((mailbox) => mailbox.id === folder.mailboxId)
    if (message === undefined || destination === undefined) return false
    if (message.accountId !== folder.accountId) return false
    if (destination.serverId === undefined || destination.isSynthetic === true) return false
    if (destination.jmapAccountId !== undefined && destination.jmapAccountId !== message.jmapAccountId) return false
    if (destination.myRights?.mayAddItems === false || destination.jmapAccountIsReadOnly === true) return false
    return !(message.mailboxIds.length === 1 && message.mailboxIds[0] === destination.id)
  }

  export function canLoadMoreFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): boolean {
    return folderLoadTargets(accounts, mailByAccount, folderId).some(folderTargetHasMore)
  }

  export function folderLoadTargets(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): FolderLoadTarget[] {
    const mailboxFolder = parseMailboxFolderId(folderId)
    if (mailboxFolder !== undefined) {
      const account = accounts.find((item) => item.id === mailboxFolder.accountId)
      const mail = mailByAccount[mailboxFolder.accountId]
      const mailbox = mail?.mailboxes.find((item) => item.id === mailboxFolder.mailboxId)
      if (account === undefined || mail === undefined) return []
      if (mailbox?.isSynthetic === true) {
        const descendantIds = mailboxAndDescendantIds(mail.mailboxes, mailbox.id).filter((mailboxId) => mailboxId !== mailbox.id)
        return descendantIds.flatMap((mailboxId) => folderLoadTargetForMailbox(account, mail, mailboxId))
      }
      return folderLoadTargetForMailbox(account, mail, mailboxFolder.mailboxId)
    }

    const roleFolder = parseAccountRoleFolderId(accounts, folderId)
    const [unifiedScope, unifiedRole] = folderId.startsWith("unified:") ? folderId.split(":") : []
    const role = roleFolder?.role ?? unifiedRole
    if (role === undefined) return []
    const scopedAccounts = unifiedScope === "unified" ? accounts : roleFolder === undefined ? [] : [roleFolder.account]
    return scopedAccounts.flatMap((account) => {
      const mail = mailByAccount[account.id]
      if (mail === undefined) return []
      return mailboxesForRole(mail.mailboxes, role).flatMap((mailbox) => folderLoadTargetForMailbox(account, mail, mailbox.id))
    })
  }

  export function folderLoadTargetForMailbox(account: ConfiguredAccount, mail: AccountMailState, mailboxId: string): FolderLoadTarget[] {
    const mailbox = mail.mailboxes.find((item) => item.id === mailboxId)
    if (mailbox?.isSynthetic === true || mailbox?.myRights?.mayReadItems === false) return []
    return [{
      account,
      mailboxId,
      ...(mailbox?.jmapAccountId === undefined ? {} : { jmapAccountId: mailbox.jmapAccountId }),
      jmapMailboxId: mailbox?.serverId ?? mailboxId,
      loadedCount: countMessagesInMailbox(mail.messages, mailboxId),
      ...(mailbox?.totalEmails === undefined ? {} : { totalEmails: mailbox.totalEmails }),
    }]
  }

  export function folderTargetHasMore(target: FolderLoadTarget): boolean {
    return target.totalEmails === undefined ? target.loadedCount >= MailModel.EMAIL_PAGE_SIZE : target.loadedCount < target.totalEmails
  }

  export function messageInRole(message: MailMessage, mailboxes: readonly MailboxSummary[], role: string): boolean {
    const matchingIds = mailboxesForRole(mailboxes, role).map((mailbox) => mailbox.id)
    return matchingIds.length === 0 ? role === "inbox" : message.mailboxIds.some((mailboxId) => matchingIds.includes(mailboxId))
  }

  export function mailboxesForRole(mailboxes: readonly MailboxSummary[], role: string): MailboxSummary[] {
    return mailboxes.filter((mailbox) => mailbox.role === role || mailbox.name.toLowerCase() === role)
  }

  export function mailStatusText(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>): string {
    const states = accounts.map((account) => mailByAccount[account.id]).filter((state): state is AccountMailState => state !== undefined)
    if (states.some((state) => state.status === "syncing")) return "Fetching messages..."
    const error = states.find((state) => state.status === "error")?.error
    if (error !== undefined) return error
    const count = states.reduce((sum, state) => sum + state.messages.length, 0)
    if (count === 0) return "Click Get Messages to fetch mail."
    return ""
  }

  export function searchStatusText(searchState: SearchState, loadedCount: number): string {
    if (searchState.status === "searching") return loadedCount === 0 ? `Server search for "${searchState.query}"` : `${loadedCount} result${loadedCount === 1 ? "" : "s"} loaded for "${searchState.query}"`
    if (searchState.status === "error") return searchState.error ?? "Search failed."
    if (searchState.status === "ready") {
      if (searchState.total !== undefined && searchState.total > loadedCount) return `${loadedCount} of ${searchState.total} search results loaded for "${searchState.query}".`
      return `${loadedCount} search result${loadedCount === 1 ? "" : "s"} for "${searchState.query}".`
    }
    return ""
  }

  export function appendSearchBatch(searchState: SearchState, folderId: string, query: string, batch: LoadedMessageBatch): SearchState {
    if (searchState.status !== "searching" || searchState.folderId !== folderId || searchState.query !== query) return searchState
    const seen = new Set(searchState.messageKeys)
    const messageKeys = [...searchState.messageKeys]
    for (const message of batch.messages) {
      if (seen.has(message.key)) continue
      seen.add(message.key)
      messageKeys.push(message.key)
    }
    return { ...searchState, messageKeys }
  }

  export function finishSearchState(searchState: SearchState, folderId: string, query: string, messageKeys: readonly string[], total: number | undefined, failures: readonly string[], loadFailuresMessage: (label: string, failures: readonly string[]) => string): SearchState {
    if (searchState.folderId !== folderId || searchState.query !== query) return searchState
    return {
      status: failures.length === 0 ? "ready" : "error",
      folderId,
      query,
      messageKeys,
      ...(total === undefined ? {} : { total }),
      ...(failures.length === 0 ? {} : { error: loadFailuresMessage("search target", failures) }),
    }
  }

  export function emptyAccountMailState(): AccountMailState {
    return { status: "idle", mailboxes: [], messages: [] }
  }

  export function flagIconName(flagState: MessageFlagState): MaterialIconName {
    if (flagState === "done") return "check-circle"
    if (flagState === "flagged") return "flag"
    return "outlined-flag"
  }

  export function flagIconColor(flagState: MessageFlagState): string {
    if (flagState === "done") return C.statusOkText
    if (flagState === "flagged") return C.warningText
    return C.textMuted
  }

  export function flagButtonLabel(flagState: MessageFlagState): string {
    if (flagState === "done") return "Mark unflagged"
    if (flagState === "flagged") return "Mark done"
    return "Flag message"
  }

  export function messageAttachmentLabels(message: MailMessage): string[] {
    const attachmentCount = message.attachments.length
    return [
      message.hasAttachment || attachmentCount > 0 ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : undefined,
      message.hasSignatureAttachment ? "Signature" : undefined,
      message.hasPublicKeyAttachment ? "Public key" : undefined,
    ].filter((label): label is string => label !== undefined)
  }

  export function messageAttachmentDisplayParts(message: MailMessage): readonly EmailAttachmentPart[] {
    return message.attachments
  }

  export function attachmentKey(attachment: EmailAttachmentPart, index: number): string {
    return [attachment.blobId, attachment.partId, attachment.name, String(index)].filter((part): part is string => part !== undefined).join(":")
  }

  export function attachmentMetaText(attachment: EmailAttachmentPart): string {
    return [attachment.type, formatByteSize(attachment.size), attachment.disposition === "inline" ? "inline" : undefined]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(" · ")
  }

  export function attachmentActionKey(messageKey: string, attachment: EmailAttachmentPart, index: number): string {
    return `${messageKey}:attachment:${attachmentKey(attachment, index)}`
  }

  export function formatByteSize(size: number | undefined): string | undefined {
    if (size === undefined || !Number.isFinite(size) || size < 0) return undefined
    if (size < 1024) return `${size} B`
    let value = size
    let unit = "B"
    for (const nextUnit of ["KB", "MB", "GB", "TB"] as const) {
      value /= 1024
      unit = nextUnit
      if (value < 1024) break
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
  }

  export function messageTime(message: MailMessage): number {
    return Date.parse(message.receivedAt ?? message.sentAt ?? "") || 0
  }

  export function formatMessageDate(value: string | undefined): string {
    if (value === undefined) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  }

  export function folderTitle(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): string {
    if (folderId === "unified:inbox") return "Unified Inbox"
    if (folderId === "unified:sent") return "All Sent"
    if (folderId === "unified:drafts") return "All Drafts"
    const mailboxFolder = parseMailboxFolderId(folderId)
    if (mailboxFolder !== undefined) {
      const account = accounts.find((item) => item.id === mailboxFolder.accountId)
      const mailbox = mailByAccount[mailboxFolder.accountId]?.mailboxes.find((item) => item.id === mailboxFolder.mailboxId)
      return account === undefined ? mailbox?.name ?? "Folder" : `${account.email} - ${mailbox?.name ?? "Folder"}`
    }
    const roleFolder = parseAccountRoleFolderId(accounts, folderId)
    const folderLabel = MailModel.ACCOUNT_FOLDERS.find((item) => item.id === roleFolder?.role)?.label ?? "Folder"
    return roleFolder === undefined ? folderLabel : `${roleFolder.account.email} - ${folderLabel}`
  }
}
