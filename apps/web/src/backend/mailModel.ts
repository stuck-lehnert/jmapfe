import type { ConfiguredAccount } from "@jmapfe/app-core"

export namespace MailModel {
  export type SyncStatus = "idle" | "syncing" | "ready" | "error"
  export type RemoteContentMode = "blocked" | "direct" | "proxy"
  export type SearchStatus = "idle" | "searching" | "ready" | "error"
  export type MessageFlagState = "unflagged" | "flagged" | "done"
  export type ComposeMode = "new" | "reply" | "reply-all" | "forward"

  export interface FolderNode {
    readonly id: string
    readonly label: string
    readonly count?: number
  }

  export interface MailboxSummary {
    readonly id: string
    readonly serverId?: string
    readonly jmapAccountId?: string
    readonly jmapAccountName?: string
    readonly jmapAccountIsPersonal?: boolean
    readonly jmapAccountIsReadOnly?: boolean
    readonly name: string
    readonly role?: string
    readonly parentId?: string
    readonly sortOrder?: number
    readonly totalEmails?: number
    readonly unreadEmails?: number
    readonly isSubscribed?: boolean
    readonly myRights?: MailboxRights
    readonly isSynthetic?: boolean
  }

  export interface MailboxRights {
    readonly mayReadItems?: boolean
    readonly mayAddItems?: boolean
    readonly mayRemoveItems?: boolean
    readonly maySetSeen?: boolean
    readonly maySetKeywords?: boolean
    readonly mayCreateChild?: boolean
    readonly mayRename?: boolean
    readonly mayDelete?: boolean
    readonly maySubmit?: boolean
    readonly mayShare?: boolean
  }

  export interface MailMessage {
    readonly id: string
    readonly key: string
    readonly accountId: string
    readonly accountName: string
    readonly jmapAccountId?: string
    readonly mailboxIds: readonly string[]
    readonly subject: string
    readonly read: boolean
    readonly flagState: MessageFlagState
    readonly from: string
    readonly to: readonly string[]
    readonly cc?: readonly string[]
    readonly replyTo?: readonly string[]
    readonly messageId?: readonly string[]
    readonly references?: readonly string[]
    readonly receivedAt?: string
    readonly sentAt?: string
    readonly bodyText?: string
    readonly bodyHtml?: string
    readonly bodyLoaded?: boolean
    readonly inlineImages?: readonly InlineImagePart[]
    readonly inlineImageDataByCid?: Record<string, string>
    readonly attachments: readonly EmailAttachmentPart[]
    readonly hasAttachment: boolean
    readonly hasSignatureAttachment?: boolean
    readonly hasPublicKeyAttachment?: boolean
  }

  export interface InlineImagePart {
    readonly cid: string
    readonly blobId: string
    readonly name: string
    readonly type: string
  }

  export interface EmailAttachmentPart {
    readonly name: string
    readonly type: string
    readonly partId?: string
    readonly blobId?: string
    readonly size?: number
    readonly disposition?: string
    readonly cid?: string
  }

  export interface AccountMailState {
    readonly status: SyncStatus
    readonly mailboxes: readonly MailboxSummary[]
    readonly messages: readonly MailMessage[]
    readonly syncedAt?: string
    readonly error?: string
  }

  export interface ComposeDraft {
    readonly accountId: string
    readonly jmapAccountId?: string
    readonly mode: ComposeMode
    readonly to: string
    readonly cc: string
    readonly bcc: string
    readonly subject: string
    readonly body: string
    readonly sourceMessageKey?: string
    readonly sourceMessageId?: string
    readonly sourceReferences?: readonly string[]
  }

  export interface FolderLoadTarget {
    readonly account: ConfiguredAccount
    readonly mailboxId: string
    readonly jmapAccountId?: string
    readonly jmapMailboxId: string
    readonly loadedCount: number
    readonly totalEmails?: number
  }

  export interface JmapMailAccountTarget {
    readonly id: string
    readonly name: string
    readonly isPrimary: boolean
    readonly isPersonal: boolean
    readonly isReadOnly: boolean
  }

  export interface LoadedMessageBatch {
    readonly accountId: string
    readonly messages: readonly MailMessage[]
    readonly total?: number
  }

  export interface LoadedMailTargetBatch {
    readonly mailboxes: readonly MailboxSummary[]
    readonly messages: readonly MailMessage[]
  }

  export interface SearchState {
    readonly status: SearchStatus
    readonly folderId?: string
    readonly query: string
    readonly messageKeys: readonly string[]
    readonly total?: number
    readonly error?: string
  }

  export interface MessageContextMenuState {
    readonly messageKey: string
    readonly x: number
    readonly y: number
  }

  export interface EmailQueryResult {
    readonly ids: readonly string[]
    readonly total?: number
  }

  export interface MessageBody {
    readonly bodyText: string
    readonly bodyHtml?: string
    readonly inlineImages: readonly InlineImagePart[]
    readonly attachments: readonly EmailAttachmentPart[]
  }

  export type InlineImageLoadResult =
    | { readonly cid: string; readonly dataUrl: string }
    | { readonly cid: string; readonly name: string; readonly error: string }

  export const EMAIL_METADATA_PROPERTIES = [
    "id",
    "mailboxIds",
    "receivedAt",
    "sentAt",
    "subject",
    "keywords",
    "from",
    "to",
    "cc",
    "replyTo",
    "messageId",
    "references",
    "hasAttachment",
    "attachments",
  ] as const

  export const EMAIL_BODY_PROPERTIES = [
    "id",
    "bodyValues",
    "textBody",
    "htmlBody",
    "attachments",
  ] as const

  export const EMAIL_BODY_PART_PROPERTIES = [
    "partId",
    "type",
    "charset",
    "name",
    "size",
    "disposition",
    "blobId",
    "cid",
  ] as const

  export const ACCOUNT_FOLDERS: readonly FolderNode[] = [
    { id: "inbox", label: "Inbox" },
    { id: "drafts", label: "Drafts" },
    { id: "sent", label: "Sent" },
    { id: "archive", label: "Archive" },
    { id: "trash", label: "Trash" },
  ]

  export const EMPTY_SEARCH_STATE: SearchState = { status: "idle", query: "", messageKeys: [] }
  export const EMAIL_PAGE_SIZE = 50
}
