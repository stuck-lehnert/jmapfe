import {
  EMPTY_ACCOUNT_SETUP_DRAFT,
  accountLoginUsername,
  configuredAccountServerLabel,
  createConfiguredAccount,
  parseConfiguredAccounts,
  removeConfiguredAccount,
  serializeConfiguredAccounts,
  type AccountAuthKind,
  type AccountSetupDraft,
  type ConfiguredAccount,
} from "@jmapfe/app-core"
import {
  CAP_MAIL,
  FetchJmapTransport,
  JmapClient,
  JmapDiscoveryError,
  JmapTransportError,
  discoveryCandidates,
  discoverJmapSessionWithUrl,
  methodCall,
  parseJmapSession,
  resultReference,
  resolveJmapSrvOverHttps,
  withResultReference,
  type AuthProvider,
  type BlobLike,
  type JmapSession,
  type JsonObject,
  type JmapResponse,
  type SrvRecord,
} from "@jmapfe/jmap-core"
import { MaterialIcons } from "@expo/vector-icons"
import { invoke } from "@tauri-apps/api/core"
import { createElement, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent, type ViewStyle } from "react-native"

const ACCOUNTS_STORAGE_KEY = "jmapfe.accounts.v1"
const MAIL_CACHE_STORAGE_KEY = "jmapfe.mail-cache.v1"
const REMOTE_IMAGE_PROXY_STORAGE_KEY = "jmapfe.remote-image-proxy.v1"
const FALLBACK_VAULT_STORAGE_KEY = "jmapfe.vault.fallback.v1"
const FALLBACK_VAULT_SALT_BYTES = 16
const FALLBACK_VAULT_IV_BYTES = 12
const FALLBACK_VAULT_KDF_ITERATIONS = 250_000
const DEFAULT_FOLDER_PANE_WIDTH = 168
const MIN_FOLDER_PANE_WIDTH = 120
const MAX_FOLDER_PANE_WIDTH = 280
const MIN_MESSAGE_PANE_WIDTH = 220
const DIVIDER_WIDTH = 7
const MOBILE_BREAKPOINT = 760
const EMAIL_PAGE_SIZE = 50
const MESSAGE_REVEAL_CHUNK_SIZE = 8
const MESSAGE_REVEAL_DELAY_MS = 35
const DISCOVERY_ONLY_AUTH: AuthProvider = { kind: "bearer", token: "" }

const folderPaneResizeStyle: CSSProperties = {
  backgroundColor: "#eef3f9",
  boxSizing: "border-box",
  display: "flex",
  flex: "0 0 auto",
  flexDirection: "column",
  maxWidth: MAX_FOLDER_PANE_WIDTH,
  minWidth: MIN_FOLDER_PANE_WIDTH,
  overflow: "auto",
  resize: "horizontal",
  width: DEFAULT_FOLDER_PANE_WIDTH,
}

const threadPaneResizeStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  boxSizing: "border-box",
  display: "flex",
  flex: "0 0 auto",
  flexDirection: "column",
  maxWidth: `calc(100% - ${MIN_MESSAGE_PANE_WIDTH + DIVIDER_WIDTH}px)`,
  minWidth: MIN_MESSAGE_PANE_WIDTH,
  overflow: "auto",
  resize: "horizontal",
  width: "50%",
}

const paneDividerStyle: CSSProperties = {
  backgroundColor: "#c8d3df",
  cursor: "col-resize",
  flex: `0 0 ${DIVIDER_WIDTH}px`,
  height: "100%",
  touchAction: "none",
  userSelect: "none",
  width: DIVIDER_WIDTH,
}

const htmlPreviewFrameStyle: CSSProperties = {
  border: "0",
  display: "block",
  overflow: "hidden",
  width: "100%",
}

const attachmentPreviewObjectStyle: CSSProperties = {
  border: "0",
  display: "block",
  height: "100%",
  width: "100%",
}

const attachmentPreviewImageStyle: CSSProperties = {
  display: "block",
  maxHeight: "100%",
  maxWidth: "100%",
  objectFit: "contain",
}

type AppView = "mail" | "settings"
type SetupStep = "identity" | "server" | "auth" | "review"
type SyncStatus = "idle" | "syncing" | "ready" | "error"
type RemoteContentMode = "blocked" | "direct" | "proxy"
type SearchStatus = "idle" | "searching" | "ready" | "error"
type MessageFlagState = "unflagged" | "flagged" | "done"
type MaterialIconName = keyof typeof MaterialIcons.glyphMap

const MAILBOX_ROLES = ["inbox", "sent", "drafts", "archive", "trash"] as const
const EMAIL_METADATA_PROPERTIES = [
  "id",
  "mailboxIds",
  "receivedAt",
  "sentAt",
  "subject",
  "keywords",
  "from",
  "to",
  "hasAttachment",
  "attachments",
] as const
const EMAIL_BODY_PROPERTIES = [
  "id",
  "bodyValues",
  "textBody",
  "htmlBody",
  "attachments",
] as const
const EMAIL_BODY_PART_PROPERTIES = [
  "partId",
  "type",
  "charset",
  "name",
  "size",
  "disposition",
  "blobId",
  "cid",
] as const

interface FolderNode {
  readonly id: string
  readonly label: string
  readonly count?: number
}

interface MailboxSummary {
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

interface MailboxRights {
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

interface MailMessage {
  readonly id: string
  readonly key: string
  readonly accountId: string
  readonly accountName: string
  readonly jmapAccountId?: string
  readonly mailboxIds: readonly string[]
  readonly subject: string
  readonly flagState: MessageFlagState
  readonly from: string
  readonly to: readonly string[]
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

interface InlineImagePart {
  readonly cid: string
  readonly blobId: string
  readonly name: string
  readonly type: string
}

interface EmailAttachmentPart {
  readonly name: string
  readonly type: string
  readonly partId?: string
  readonly blobId?: string
  readonly size?: number
  readonly disposition?: string
  readonly cid?: string
}

interface AccountMailState {
  readonly status: SyncStatus
  readonly mailboxes: readonly MailboxSummary[]
  readonly messages: readonly MailMessage[]
  readonly syncedAt?: string
  readonly error?: string
}

interface FolderLoadTarget {
  readonly account: ConfiguredAccount
  readonly mailboxId: string
  readonly jmapAccountId?: string
  readonly jmapMailboxId: string
  readonly loadedCount: number
  readonly totalEmails?: number
}

interface JmapMailAccountTarget {
  readonly id: string
  readonly name: string
  readonly isPrimary: boolean
  readonly isPersonal: boolean
  readonly isReadOnly: boolean
}

interface LoadedMessageBatch {
  readonly accountId: string
  readonly messages: readonly MailMessage[]
  readonly total?: number
}

interface LoadedMailTargetBatch {
  readonly mailboxes: readonly MailboxSummary[]
  readonly messages: readonly MailMessage[]
}

interface SearchState {
  readonly status: SearchStatus
  readonly folderId?: string
  readonly query: string
  readonly messageKeys: readonly string[]
  readonly total?: number
  readonly error?: string
}

interface EmailQueryResult {
  readonly ids: readonly string[]
  readonly total?: number
}

interface MessageBody {
  readonly bodyText: string
  readonly bodyHtml?: string
  readonly inlineImages: readonly InlineImagePart[]
  readonly attachments: readonly EmailAttachmentPart[]
}

type InlineImageLoadResult =
  | { readonly cid: string; readonly dataUrl: string }
  | { readonly cid: string; readonly name: string; readonly error: string }

interface AttachmentPreviewState {
  readonly messageKey: string
  readonly name: string
  readonly type: string
  readonly objectUrl: string
}

interface AttachmentBlobData {
  readonly name: string
  readonly type: string
  readonly bytes: Uint8Array
}

interface ZipEntryData {
  readonly name: string
  readonly bytes: Uint8Array
}

interface SaveFileTarget {
  write(blob: Blob): Promise<void>
}

interface BrowserSaveFileHandle {
  createWritable(): Promise<BrowserWritableFileStream>
}

interface BrowserWritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

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

const ACCOUNT_FOLDERS: readonly FolderNode[] = [
  { id: "inbox", label: "Inbox" },
  { id: "drafts", label: "Drafts" },
  { id: "sent", label: "Sent" },
  { id: "archive", label: "Archive" },
  { id: "trash", label: "Trash" },
]
const EMPTY_SEARCH_STATE: SearchState = { status: "idle", query: "", messageKeys: [] }

const AUTH_OPTIONS: readonly { readonly value: AccountAuthKind; readonly label: string; readonly help: string }[] = [
  { value: "bearer", label: "API token", help: "Best for providers such as Fastmail app passwords or API tokens." },
  { value: "basic", label: "Password", help: "Only use when the server requires Basic Auth." },
]

export default function App() {
  const { width } = useWindowDimensions()
  const isMobile = width < MOBILE_BREAKPOINT
  const [accounts, setAccounts] = useState<ConfiguredAccount[]>(() => loadAccounts())
  const [view, setView] = useState<AppView>("mail")
  const [selectedFolder, setSelectedFolder] = useState("unified:inbox")
  const [selectedMessageKey, setSelectedMessageKey] = useState<string | undefined>()
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false)
  const [accountAuth, setAccountAuth] = useState<Record<string, AuthProvider>>({})
  const [mailByAccount, setMailByAccount] = useState<Record<string, AccountMailState>>(() => loadMailCache())
  const [loadingMoreFolder, setLoadingMoreFolder] = useState<string | undefined>()
  const [loadingMessageKey, setLoadingMessageKey] = useState<string | undefined>()
  const [loadingInlineImageKey, setLoadingInlineImageKey] = useState<string | undefined>()
  const [loadingAttachmentKey, setLoadingAttachmentKey] = useState<string | undefined>()
  const [loadingFlagMessageKey, setLoadingFlagMessageKey] = useState<string | undefined>()
  const [messageBodyErrors, setMessageBodyErrors] = useState<Record<string, string>>({})
  const [inlineImageErrors, setInlineImageErrors] = useState<Record<string, string>>({})
  const [attachmentErrors, setAttachmentErrors] = useState<Record<string, string>>({})
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | undefined>()
  const [searchDraft, setSearchDraft] = useState("")
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE)
  const [remoteImageProxyBase, setRemoteImageProxyBase] = useState<string | undefined>(() => loadRemoteImageProxyBase())
  const [vaultMode, setVaultMode] = useState<"checking" | "os" | "locked" | "fallback">("checking")
  const [masterPassword, setMasterPassword] = useState("")
  const [vaultError, setVaultError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => saveAccounts(accounts), [accounts])
  useEffect(() => saveMailCache(mailByAccount), [mailByAccount])
  useEffect(() => () => revokeAttachmentPreview(attachmentPreview), [attachmentPreview])
  useEffect(() => {
    if (attachmentPreview !== undefined && selectedMessageKey !== attachmentPreview.messageKey) setAttachmentPreview(undefined)
  }, [attachmentPreview, selectedMessageKey])
  useEffect(() => {
    setMailByAccount((current) => pruneMailCache(current, accounts))
  }, [accounts])
  useEffect(() => {
    if (!isMobile) setFolderDrawerOpen(false)
  }, [isMobile])
  useEffect(() => {
    if (accounts.length === 0) {
      setVaultMode("os")
      return
    }
    if (!isTauriRuntime() && Object.keys(loadFallbackVault()).length === 0) {
      setVaultMode("fallback")
      return
    }
    void loadSavedAuth(accounts, undefined)
      .then(({ auth, mode }) => {
        setAccountAuth(auth)
        setVaultMode(mode)
      })
      .catch(() => setVaultMode(Object.keys(loadFallbackVault()).length > 0 ? "locked" : "fallback"))
  }, [accounts])

  async function revealMailTargetBatch(accountId: string, batch: LoadedMailTargetBatch): Promise<void> {
    const chunks = messageChunks(batch.messages)
    if (chunks.length === 0) {
      setMailByAccount((current) => mergeMailTargetBatch(current, accountId, batch))
      return
    }
    for (const [index, messages] of chunks.entries()) {
      setMailByAccount((current) => mergeMailTargetBatch(current, accountId, { mailboxes: index === 0 ? batch.mailboxes : [], messages }))
      if (index < chunks.length - 1) await waitForMessageReveal()
    }
  }

  async function revealLoadedMessageBatch(batch: LoadedMessageBatch): Promise<void> {
    const chunks = messageChunks(batch.messages)
    for (const [index, messages] of chunks.entries()) {
      setMailByAccount((current) => mergeLoadedMessageBatches(current, [{ ...batch, messages }]))
      if (index < chunks.length - 1) await waitForMessageReveal()
    }
  }

  async function revealSearchBatch(folderId: string, query: string, batch: LoadedMessageBatch): Promise<void> {
    const chunks = messageChunks(batch.messages)
    for (const [index, messages] of chunks.entries()) {
      const chunk = { ...batch, messages }
      setMailByAccount((current) => mergeLoadedMessageBatches(current, [chunk]))
      setSearchState((current) => appendSearchBatch(current, folderId, query, chunk))
      if (index < chunks.length - 1) await waitForMessageReveal()
    }
  }

  const syncAccountMail = async (account: ConfiguredAccount, authOverride?: AuthProvider): Promise<void> => {
    const auth = authOverride ?? accountAuth[account.id]
    if (auth === undefined) {
      setMailByAccount((current) => ({
        ...current,
        [account.id]: { ...(current[account.id] ?? emptyAccountMailState()), status: "error", error: "Sign in again to fetch messages." },
      }))
      return
    }

    setMailByAccount((current) => {
      const existing = current[account.id] ?? emptyAccountMailState()
      return { ...current, [account.id]: { status: "syncing", mailboxes: existing.mailboxes, messages: existing.messages, ...(existing.syncedAt === undefined ? {} : { syncedAt: existing.syncedAt }) } }
    })

    try {
      const { client, session, primaryMailAccountId } = await createMailClient(account, auth)
      const mailTargets = mailAccountTargets(session, primaryMailAccountId)
      const batches: LoadedMailTargetBatch[] = []
      const failures: string[] = []
      await Promise.all(mailTargets.map(async (target) => {
        try {
          const batch = await fetchMailTargetBatch(client, account, target)
          batches.push(batch)
          await revealMailTargetBatch(account.id, batch)
        } catch (error) {
          failures.push(connectivityErrorMessage(error))
        }
      }))
      const next = {
        status: "ready",
        mailboxes: batches.flatMap((batch) => batch.mailboxes),
        messages: batches.flatMap((batch) => batch.messages).sort((left, right) => messageTime(right) - messageTime(left)),
        syncedAt: new Date().toISOString(),
      } satisfies AccountMailState
      setMailByAccount((current) => {
        const merged = batches.length === 0 && mailTargets.length > 0 ? current[account.id] ?? emptyAccountMailState() : mergeFetchedMailState(current[account.id], next)
        return {
          ...current,
          [account.id]: failures.length === 0 ? merged : { ...merged, status: "error", error: loadFailuresMessage("mail target", failures) },
        }
      })
    } catch (error) {
      setMailByAccount((current) => ({
        ...current,
        [account.id]: { ...(current[account.id] ?? emptyAccountMailState()), status: "error", error: connectivityErrorMessage(error) },
      }))
    }
  }

  const syncAllMail = () => {
    setView("mail")
    if (accounts.length === 0) return
    void Promise.all(accounts.map((account) => syncAccountMail(account)))
  }

  const loadMoreFolder = async (folderId: string): Promise<void> => {
    if (loadingMoreFolder !== undefined) return
    const targets = folderLoadTargets(accounts, mailByAccount, folderId).filter(folderTargetHasMore)
    if (targets.length === 0) return

    setLoadingMoreFolder(folderId)
    try {
      const failures: string[] = []
      await Promise.all(targets.map(async (target) => {
        try {
          const auth = accountAuth[target.account.id]
          if (auth === undefined) throw new Error("Sign in again to fetch more messages.")
          const batch = {
            accountId: target.account.id,
            messages: await fetchMoreMailboxMessages(target.account, auth, target, mailByAccount[target.account.id]?.messages ?? []),
          } satisfies LoadedMessageBatch
          await revealLoadedMessageBatch(batch)
        } catch (error) {
          failures.push(connectivityErrorMessage(error))
        }
      }))
      if (failures.length > 0) setNotice(loadFailuresMessage("message batch", failures))
    } catch (error) {
      setNotice(connectivityErrorMessage(error))
    } finally {
      setLoadingMoreFolder((current) => current === folderId ? undefined : current)
    }
  }

  const selectMessage = (messageKey: string) => {
    setSelectedMessageKey(messageKey)
    void loadMessageBody(messageKey)
  }

  const loadMessageBody = async (messageKey: string): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || message.bodyLoaded === true) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setMessageBodyErrors((current) => ({ ...current, [messageKey]: "Sign in again to fetch message contents." }))
      return
    }

    setLoadingMessageKey(messageKey)
    setMessageBodyErrors((current) => omitKey(current, messageKey))
    try {
      const { client, primaryMailAccountId } = await createMailClient(account, auth)
      const body = await fetchEmailMessageBody(client, message.jmapAccountId ?? primaryMailAccountId, message.id)
      setMailByAccount((current) => mergeMessageBody(current, message.accountId, messageKey, body))
    } catch (error) {
      setMessageBodyErrors((current) => ({ ...current, [messageKey]: connectivityErrorMessage(error) }))
    } finally {
      setLoadingMessageKey((current) => current === messageKey ? undefined : current)
    }
  }

  const loadInlineImages = async (messageKey: string): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    const inlineImages = message === undefined ? [] : inlineImagesToLoad(message)
    if (message === undefined || message.bodyLoaded !== true || inlineImages.length === 0) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setInlineImageErrors((current) => ({ ...current, [messageKey]: "Sign in again to fetch inline images." }))
      return
    }

    setLoadingInlineImageKey(messageKey)
    setInlineImageErrors((current) => omitKey(current, messageKey))
    try {
      const { transport, primaryMailAccountId } = await createMailClient(account, auth)
      const jmapAccountId = message.jmapAccountId ?? primaryMailAccountId
      const results: InlineImageLoadResult[] = []
      for (const image of inlineImages) results.push(await loadInlineImageData(transport, jmapAccountId, image))
      const images = results.flatMap((result) => "dataUrl" in result ? [[result.cid, result.dataUrl] as const] : [])
      if (images.length > 0) setMailByAccount((current) => mergeInlineImageData(current, message.accountId, messageKey, Object.fromEntries(images)))
      const failures = results.filter((result): result is Extract<InlineImageLoadResult, { readonly error: string }> => "error" in result)
      if (failures.length > 0) setInlineImageErrors((current) => ({ ...current, [messageKey]: inlineImageLoadErrorMessage(failures) }))
    } catch (error) {
      setInlineImageErrors((current) => ({ ...current, [messageKey]: connectivityErrorMessage(error) }))
    } finally {
      setLoadingInlineImageKey((current) => current === messageKey ? undefined : current)
    }
  }

  const loadAttachmentBlob = async (message: MailMessage, attachment: EmailAttachmentPart): Promise<BlobLike> => {
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) throw new Error("Sign in again to fetch attachments.")
    const { transport, primaryMailAccountId } = await createMailClient(account, auth)
    return downloadAttachmentBlob(transport, message.jmapAccountId ?? primaryMailAccountId, attachment)
  }

  const previewAttachment = async (messageKey: string, attachment: EmailAttachmentPart, index: number): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const actionKey = attachmentActionKey(messageKey, attachment, index)
    setLoadingAttachmentKey(actionKey)
    setAttachmentErrors((current) => omitKey(current, messageKey))
    try {
      if (!canPreviewAttachment(attachment)) throw new Error("Preview is available for images and PDFs only.")
      const blob = await loadAttachmentBlob(message, attachment)
      const objectUrl = blobLikeToObjectUrl(blob, attachment.type)
      setAttachmentPreview({ messageKey, name: attachment.name, type: attachment.type, objectUrl })
    } catch (error) {
      setAttachmentErrors((current) => ({ ...current, [messageKey]: connectivityErrorMessage(error) }))
    } finally {
      setLoadingAttachmentKey((current) => current === actionKey ? undefined : current)
    }
  }

  const downloadAttachment = async (messageKey: string, attachment: EmailAttachmentPart, index: number): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const actionKey = attachmentActionKey(messageKey, attachment, index)
    setLoadingAttachmentKey(actionKey)
    setAttachmentErrors((current) => omitKey(current, messageKey))
    try {
      const saveTarget = await promptSaveFile(attachment.name, attachment.type)
      const blob = await loadAttachmentBlob(message, attachment)
      await saveTarget.write(blobLikeToBlob(blob, attachment.type))
    } catch (error) {
      if (isSaveFileCancelled(error)) return
      setAttachmentErrors((current) => ({ ...current, [messageKey]: connectivityErrorMessage(error) }))
    } finally {
      setLoadingAttachmentKey((current) => current === actionKey ? undefined : current)
    }
  }

  const downloadAllAttachments = async (messageKey: string): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || message.attachments.length === 0) return
    const actionKey = `${messageKey}:attachments:all`
    setLoadingAttachmentKey(actionKey)
    setAttachmentErrors((current) => omitKey(current, messageKey))
    try {
      const saveTarget = await promptSaveFile(`${safeBaseFileName(message.subject || "attachments")}.zip`, "application/zip")
      const entries: ZipEntryData[] = []
      const usedNames = new Set<string>()
      const failures: string[] = []
      for (const attachment of message.attachments) {
        try {
          const blob = await loadAttachmentBlob(message, attachment)
          entries.push({ name: uniqueZipEntryName(attachment.name, usedNames), bytes: await blobLikeToBytes(blob) })
        } catch (error) {
          failures.push(`${attachment.name}: ${connectivityErrorMessage(error)}`)
        }
      }
      if (entries.length === 0) throw new Error(failures[0] ?? "No attachments could be downloaded.")
      await saveTarget.write(new Blob([bufferSource(createZip(entries))], { type: "application/zip" }))
      if (failures.length > 0) setAttachmentErrors((current) => ({ ...current, [messageKey]: `${failures.length} attachment${failures.length === 1 ? "" : "s"} skipped. ${failures[0]}` }))
    } catch (error) {
      if (isSaveFileCancelled(error)) return
      setAttachmentErrors((current) => ({ ...current, [messageKey]: connectivityErrorMessage(error) }))
    } finally {
      setLoadingAttachmentKey((current) => current === actionKey ? undefined : current)
    }
  }

  const toggleMessageFlag = async (messageKey: string): Promise<void> => {
    const message = findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || loadingFlagMessageKey !== undefined) return
    const nextFlagState = nextMessageFlagState(message.flagState)
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setNotice("Sign in again to update message flags.")
      return
    }

    setLoadingFlagMessageKey(messageKey)
    setMailByAccount((current) => updateMessageFlagState(current, message.accountId, messageKey, nextFlagState))
    try {
      const { client, primaryMailAccountId } = await createMailClient(account, auth)
      await setRemoteMessageFlagState(client, message.jmapAccountId ?? primaryMailAccountId, message.id, nextFlagState)
    } catch (error) {
      setMailByAccount((current) => updateMessageFlagState(current, message.accountId, messageKey, message.flagState))
      setNotice(connectivityErrorMessage(error))
    } finally {
      setLoadingFlagMessageKey((current) => current === messageKey ? undefined : current)
    }
  }

  const runSearch = async (query: string): Promise<void> => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length === 0) {
      setSearchState(EMPTY_SEARCH_STATE)
      return
    }

    const folderId = selectedFolder
    const localMessages = localSearchMessages(accounts, mailByAccount, folderId, trimmedQuery)
    const targets = folderLoadTargets(accounts, mailByAccount, folderId)

    setSelectedMessageKey(undefined)
    setSearchState({ status: targets.length === 0 ? "ready" : "searching", folderId, query: trimmedQuery, messageKeys: localMessages.map((message) => message.key) })
    if (targets.length === 0) return
    try {
      const clientByAccount = new Map<string, Promise<Awaited<ReturnType<typeof createMailClient>>>>()
      const batches: LoadedMessageBatch[] = []
      const failures: string[] = []
      await Promise.all(targets.map(async (target) => {
        try {
          const auth = accountAuth[target.account.id]
          if (auth === undefined) throw new Error("Sign in again to search messages.")
          let clientPromise = clientByAccount.get(target.account.id)
          if (clientPromise === undefined) {
            clientPromise = createMailClient(target.account, auth)
            clientByAccount.set(target.account.id, clientPromise)
          }
          const { client, primaryMailAccountId } = await clientPromise
          const result = await searchMailboxMessagesWithClient(client, target.account, target.jmapAccountId ?? primaryMailAccountId, target, trimmedQuery)
          const batch = { accountId: target.account.id, messages: result.messages, ...(result.total === undefined ? {} : { total: result.total }) } satisfies LoadedMessageBatch
          batches.push(batch)
          await revealSearchBatch(folderId, trimmedQuery, batch)
        } catch (error) {
          failures.push(connectivityErrorMessage(error))
        }
      }))
      const messages = uniqueMessages([...localMessages, ...batches.flatMap((batch) => batch.messages)]).sort((left, right) => messageTime(right) - messageTime(left))
      const total = sumKnownMailboxCounts(batches.map((batch) => batch.total))
      setSearchState((current) => finishSearchState(current, folderId, trimmedQuery, messages.map((message) => message.key), total, failures))
    } catch (error) {
      setSearchState({ status: "error", folderId, query: trimmedQuery, messageKeys: [], error: connectivityErrorMessage(error) })
    }
  }

  const clearSearch = () => {
    setSearchDraft("")
    setSearchState(EMPTY_SEARCH_STATE)
  }

  const unlockFallbackVault = async () => {
    setVaultError(undefined)
    try {
      const result = await loadSavedAuth(accounts, masterPassword)
      setAccountAuth(result.auth)
      setVaultMode(result.mode)
      setMasterPassword("")
      if (Object.keys(result.auth).length > 0) setNotice("Saved credentials unlocked.")
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "Could not unlock saved credentials.")
    }
  }

  const addFirstAccount = (account: ConfiguredAccount, auth: AuthProvider) => {
    setAccounts((current) => [...current, account])
    setAccountAuth((current) => ({ ...current, [account.id]: auth }))
    setSelectedFolder("unified:inbox")
    setView("mail")
    setNotice("Account verified and added. Unified Inbox is selected.")
    void storeAccountAuth(account, auth, vaultMode === "fallback" ? masterPassword : undefined)
      .then((mode) => setVaultMode(mode))
      .catch((error) => setNotice(error instanceof Error ? error.message : "Could not save credentials."))
    void syncAccountMail(account, auth)
  }

  const addSettingsAccount = (account: ConfiguredAccount, auth: AuthProvider) => {
    setAccounts((current) => [...current, account])
    setAccountAuth((current) => ({ ...current, [account.id]: auth }))
    setView("settings")
    setNotice("Account verified and added. It now appears in the folder pane.")
    void storeAccountAuth(account, auth, vaultMode === "fallback" ? masterPassword : undefined)
      .then((mode) => setVaultMode(mode))
      .catch((error) => setNotice(error instanceof Error ? error.message : "Could not save credentials."))
    void syncAccountMail(account, auth)
  }

  const deleteAccount = (accountId: string) => {
    setAccounts((current) => removeConfiguredAccount(current, accountId))
    setAccountAuth((current) => omitKey(current, accountId))
    setMailByAccount((current) => omitKey(current, accountId))
    void deleteAccountAuth(accountId, vaultMode === "fallback" ? masterPassword : undefined)
    setSelectedMessageKey((current) => current?.startsWith(`${accountId}:`) ? undefined : current)
    setSelectedFolder("unified:inbox")
    setNotice("Account removed from local configuration.")
  }

  const updateRemoteImageProxyBase = (value: string | undefined) => {
    const nextValue = value?.trim()
    const normalizedValue = nextValue === undefined || nextValue.length === 0 ? undefined : nextValue
    if (normalizedValue !== undefined && !isHttpsUrl(normalizedValue)) {
      setNotice("Remote content proxy must use HTTPS.")
      return
    }
    saveRemoteImageProxyBase(normalizedValue)
    setRemoteImageProxyBase(normalizedValue)
    setNotice(normalizedValue === undefined ? "Remote content proxy cleared." : "Remote content proxy saved.")
  }

  const selectFolder = (folderId: string) => {
    setSelectedFolder(folderId)
    setSelectedMessageKey(undefined)
    setSearchDraft("")
    setSearchState(EMPTY_SEARCH_STATE)
    setView("mail")
    if (isMobile) setFolderDrawerOpen(false)
  }

  if (accounts.length === 0) return <FirstRunSetup onAccountVerified={addFirstAccount} />

  return (
    <View style={styles.shell}>
      <Toolbar view={view} mobile={isMobile} showFoldersButton={isMobile} onOpenFolders={() => setFolderDrawerOpen(true)} onOpenMail={() => setView("mail")} onGetMessages={syncAllMail} onOpenSettings={() => setView("settings")} />
      {notice === undefined ? null : <Text style={styles.notice}>{notice}</Text>}
      {vaultMode === "locked" ? <VaultUnlock masterPassword={masterPassword} error={vaultError} onChange={setMasterPassword} onUnlock={() => { void unlockFallbackVault() }} /> : null}
      <View style={styles.workspace}>
        {isMobile ? null : <FolderPane accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} onSelectFolder={selectFolder} />}
        {isMobile ? null : <PaneDivider minWidth={MIN_FOLDER_PANE_WIDTH} maxWidth={MAX_FOLDER_PANE_WIDTH} minTrailingWidth={view === "mail" ? MIN_MESSAGE_PANE_WIDTH * 2 + DIVIDER_WIDTH : MIN_MESSAGE_PANE_WIDTH} />}
        {view === "settings" ? (
          <Settings accounts={accounts} remoteImageProxyBase={remoteImageProxyBase} onRemoteImageProxyChange={updateRemoteImageProxyBase} onAccountVerified={addSettingsAccount} onDeleteAccount={deleteAccount} />
        ) : (
          <MailWorkspace accounts={accounts} selectedFolder={selectedFolder} mailByAccount={mailByAccount} selectedMessageKey={selectedMessageKey} mobile={isMobile} loadingMoreFolder={loadingMoreFolder} loadingMessageKey={loadingMessageKey} loadingInlineImageKey={loadingInlineImageKey} loadingAttachmentKey={loadingAttachmentKey} loadingFlagMessageKey={loadingFlagMessageKey} messageBodyError={selectedMessageKey === undefined ? undefined : messageBodyErrors[selectedMessageKey]} inlineImageError={selectedMessageKey === undefined ? undefined : inlineImageErrors[selectedMessageKey]} attachmentError={selectedMessageKey === undefined ? undefined : attachmentErrors[selectedMessageKey]} attachmentPreview={attachmentPreview?.messageKey === selectedMessageKey ? attachmentPreview : undefined} searchDraft={searchDraft} searchState={searchState} remoteImageProxyBase={remoteImageProxyBase} onSearchDraftChange={setSearchDraft} onSearch={() => { void runSearch(searchDraft) }} onClearSearch={clearSearch} onSelectMessage={selectMessage} onCloseMessage={() => setSelectedMessageKey(undefined)} onToggleMessageFlag={(messageKey) => { void toggleMessageFlag(messageKey) }} onLoadInlineImages={(messageKey) => { void loadInlineImages(messageKey) }} onPreviewAttachment={(messageKey, attachment, index) => { void previewAttachment(messageKey, attachment, index) }} onDownloadAttachment={(messageKey, attachment, index) => { void downloadAttachment(messageKey, attachment, index) }} onDownloadAllAttachments={(messageKey) => { void downloadAllAttachments(messageKey) }} onCloseAttachmentPreview={() => setAttachmentPreview(undefined)} onLoadMoreFolder={(folderId) => { void loadMoreFolder(folderId) }} />
        )}
      </View>
      {isMobile && folderDrawerOpen ? <MobileFolderDrawer accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} onSelectFolder={selectFolder} onClose={() => setFolderDrawerOpen(false)} /> : null}
    </View>
  )
}

function FirstRunSetup({ onAccountVerified }: { readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void }) {
  const { width } = useWindowDimensions()
  const mobile = width < MOBILE_BREAKPOINT
  const content = (
    <>
      <View style={[styles.firstRunBrand, mobile && styles.firstRunBrandMobile]}>
        <Text style={styles.brandMark}>jmapfe</Text>
        <Text style={[styles.brandTitle, mobile && styles.brandTitleMobile]}>Set up your mail account</Text>
        <Text style={[styles.brandCopy, mobile && styles.brandCopyMobile]}>
          This works like Thunderbird: enter your identity, let the app find your mail server, then verify credentials before
          anything is added locally.
        </Text>
      </View>
      <AccountSetupFlow mode="first-run" onAccountVerified={onAccountVerified} />
    </>
  )
  if (mobile) return <ScrollView style={styles.firstRunScroll} contentContainerStyle={[styles.firstRunShell, styles.firstRunShellMobile]}>{content}</ScrollView>
  return <View style={styles.firstRunShell}>{content}</View>
}

function Toolbar({ view, mobile, showFoldersButton, onOpenFolders, onOpenMail, onGetMessages, onOpenSettings }: {
  readonly view: AppView
  readonly mobile?: boolean
  readonly showFoldersButton?: boolean
  readonly onOpenFolders?: () => void
  readonly onOpenMail: () => void
  readonly onGetMessages: () => void
  readonly onOpenSettings: () => void
}) {
  const actions = (
    <>
      <ToolbarButton icon="sync" label="Get Messages" onPress={onGetMessages} active={view === "mail"} />
      <ToolbarButton icon="edit" label="Write" onPress={onOpenMail} />
      <ToolbarButton icon="contacts" label="Address Book" onPress={onOpenMail} />
      <ToolbarButton icon="settings" label="Settings" onPress={onOpenSettings} active={view === "settings"} />
    </>
  )
  return (
    <View style={[styles.toolbar, mobile === true && styles.toolbarMobile]}>
      <View style={styles.toolbarTitleRow}>
        {showFoldersButton === true && onOpenFolders !== undefined ? <ToolbarIconButton icon="menu" accessibilityLabel="Open folders" onPress={onOpenFolders} /> : null}
        <Text style={[styles.toolbarTitle, mobile === true && styles.toolbarTitleMobile]}>jmapfe Mail</Text>
      </View>
      {mobile === true ? <ScrollView horizontal style={styles.toolbarActionsScroller} contentContainerStyle={styles.toolbarActionsMobile} showsHorizontalScrollIndicator={false}>{actions}</ScrollView> : <View style={styles.toolbarActions}>{actions}</View>}
    </View>
  )
}

function VaultUnlock({ masterPassword, error, onChange, onUnlock }: {
  readonly masterPassword: string
  readonly error: string | undefined
  readonly onChange: (value: string) => void
  readonly onUnlock: () => void
}) {
  return (
    <View style={styles.vaultUnlock}>
      <Text style={styles.vaultUnlockText}>Enter master password to unlock saved credentials.</Text>
      <TextInput value={masterPassword} placeholder="Master password" placeholderTextColor="#718096" secureTextEntry onChangeText={onChange} autoCapitalize="none" style={styles.vaultUnlockInput} />
      <PrimaryButton label="Unlock" disabled={masterPassword.length === 0} onPress={onUnlock} />
      {error === undefined ? null : <Text style={styles.vaultUnlockError}>{error}</Text>}
    </View>
  )
}

function FolderPane({ accounts, mailByAccount, selectedFolder, onSelectFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly onSelectFolder: (folderId: string) => void
}) {
  return (
    <ResizablePane style={folderPaneResizeStyle} fallbackStyle={styles.folderPaneFallback}>
      <FolderPaneContent accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} onSelectFolder={onSelectFolder} />
    </ResizablePane>
  )
}

function MobileFolderDrawer({ accounts, mailByAccount, selectedFolder, onSelectFolder, onClose }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly onSelectFolder: (folderId: string) => void
  readonly onClose: () => void
}) {
  return (
    <View style={styles.folderDrawerBackdrop}>
      <Pressable accessibilityLabel="Close folders" style={[styles.clickable, styles.folderDrawerScrim]} onPress={onClose} />
      <View style={styles.folderDrawerPanel}>
        <View style={styles.folderDrawerHeader}>
          <Text style={styles.paneHeader}>Folders</Text>
          <TinyButton icon="close" label="Close" onPress={onClose} />
        </View>
        <FolderPaneContent accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} onSelectFolder={onSelectFolder} hideHeader />
      </View>
    </View>
  )
}

function FolderPaneContent({ accounts, mailByAccount, selectedFolder, hideHeader, onSelectFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly hideHeader?: boolean
  readonly onSelectFolder: (folderId: string) => void
}) {
  return (
    <ScrollView style={styles.folderPaneScroll} contentContainerStyle={styles.folderPaneContent}>
      {hideHeader === true ? null : <Text style={styles.paneHeader}>Folders</Text>}
      <FolderButton label="Unified Inbox" count={countMessagesForFolder(accounts, mailByAccount, "unified:inbox")} active={selectedFolder === "unified:inbox"} onPress={() => onSelectFolder("unified:inbox")} />
      <FolderButton label="All Sent" count={countMessagesForFolder(accounts, mailByAccount, "unified:sent")} active={selectedFolder === "unified:sent"} onPress={() => onSelectFolder("unified:sent")} />
      <FolderButton label="All Drafts" count={countMessagesForFolder(accounts, mailByAccount, "unified:drafts")} active={selectedFolder === "unified:drafts"} onPress={() => onSelectFolder("unified:drafts")} />

      <Text style={styles.sectionHeader}>Accounts</Text>
      {accounts.map((account) => (
        <View key={account.id} style={styles.accountTree}>
          <View style={styles.accountTreeHeader}>
            <Text numberOfLines={1} style={styles.accountTreeName}>{account.email}</Text>
            <Text numberOfLines={1} style={styles.accountTreeServer}>{account.serverKey}</Text>
            <Text numberOfLines={1} style={accountFolderStatusStyle(mailByAccount[account.id])}>{accountFolderStatusText(mailByAccount[account.id])}</Text>
          </View>
          {accountFolders(account, mailByAccount[account.id]).map((folder) => {
            const id = folder.folderId
            return <FolderButton key={id} label={folder.label} count={folder.count} level={folder.level} badges={folder.badges} active={selectedFolder === id} onPress={() => onSelectFolder(id)} />
          })}
        </View>
      ))}
    </ScrollView>
  )
}

function MailWorkspace({ accounts, selectedFolder, mailByAccount, selectedMessageKey, mobile, loadingMoreFolder, loadingMessageKey, loadingInlineImageKey, loadingAttachmentKey, loadingFlagMessageKey, messageBodyError, inlineImageError, attachmentError, attachmentPreview, searchDraft, searchState, remoteImageProxyBase, onSearchDraftChange, onSearch, onClearSearch, onSelectMessage, onCloseMessage, onToggleMessageFlag, onLoadInlineImages, onPreviewAttachment, onDownloadAttachment, onDownloadAllAttachments, onCloseAttachmentPreview, onLoadMoreFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedMessageKey: string | undefined
  readonly mobile: boolean
  readonly loadingMoreFolder: string | undefined
  readonly loadingMessageKey: string | undefined
  readonly loadingInlineImageKey: string | undefined
  readonly loadingAttachmentKey: string | undefined
  readonly loadingFlagMessageKey: string | undefined
  readonly messageBodyError: string | undefined
  readonly inlineImageError: string | undefined
  readonly attachmentError: string | undefined
  readonly attachmentPreview: AttachmentPreviewState | undefined
  readonly searchDraft: string
  readonly searchState: SearchState
  readonly remoteImageProxyBase: string | undefined
  readonly onSearchDraftChange: (value: string) => void
  readonly onSearch: () => void
  readonly onClearSearch: () => void
  readonly onSelectMessage: (key: string) => void
  readonly onCloseMessage: () => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onLoadInlineImages: (key: string) => void
  readonly onPreviewAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
  readonly onCloseAttachmentPreview: () => void
  readonly onLoadMoreFolder: (folderId: string) => void
}) {
  const title = folderTitle(accounts, mailByAccount, selectedFolder)
  const searchActive = searchState.status !== "idle" && searchState.folderId === selectedFolder
  const messages = searchActive ? messagesForKeys(mailByAccount, searchState.messageKeys) : messagesForFolder(accounts, mailByAccount, selectedFolder)
  const selectedMessage = messages.find((message) => message.key === selectedMessageKey)
  const syncMessage = mailStatusText(accounts, mailByAccount)
  const canLoadMore = !searchActive && canLoadMoreFolder(accounts, mailByAccount, selectedFolder)
  const loadingMore = loadingMoreFolder === selectedFolder
  const threadPane = (
    <>
      <View style={styles.threadHeader}>
        <Text style={styles.threadTitle}>{title}</Text>
        {syncMessage.length === 0 ? null : <Text style={styles.threadSubtle}>{syncMessage}</Text>}
        <View style={[styles.searchRow, mobile && styles.searchRowMobile]}>
          <TextInput value={searchDraft} placeholder="Search this folder on server" placeholderTextColor="#718096" onChangeText={onSearchDraftChange} onSubmitEditing={onSearch} autoCapitalize="none" returnKeyType="search" style={styles.searchInput} />
          <SecondaryButton label="Search" loading={searchState.status === "searching"} disabled={searchState.status === "searching"} onPress={onSearch} />
          {searchActive ? <SecondaryButton label="Clear" onPress={onClearSearch} /> : null}
        </View>
        {searchActive ? <SearchStatusLine searchState={searchState} loadedCount={messages.length} /> : null}
      </View>
      {messages.length === 0
        ? <EmptyThreadList accounts={accounts} selectedFolder={selectedFolder} searchActive={searchActive} canLoadMore={canLoadMore} loadingMore={loadingMore} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />
        : <MessageList accounts={accounts} messages={messages} selectedMessageKey={selectedMessageKey} loadingFlagMessageKey={loadingFlagMessageKey} canLoadMore={canLoadMore} loadingMore={loadingMore} onSelectMessage={onSelectMessage} onToggleMessageFlag={onToggleMessageFlag} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />}
    </>
  )
  const preview = <MessagePreview message={selectedMessage} loading={selectedMessageKey !== undefined && loadingMessageKey === selectedMessageKey} loadingInlineImages={selectedMessageKey !== undefined && loadingInlineImageKey === selectedMessageKey} loadingAttachmentKey={loadingAttachmentKey} loadingFlagMessageKey={loadingFlagMessageKey} error={messageBodyError} inlineImageError={inlineImageError} attachmentError={attachmentError} attachmentPreview={attachmentPreview} remoteImageProxyBase={remoteImageProxyBase} mobile={mobile} {...(mobile ? { onBack: onCloseMessage } : {})} onToggleMessageFlag={onToggleMessageFlag} onLoadInlineImages={onLoadInlineImages} onPreviewAttachment={onPreviewAttachment} onDownloadAttachment={onDownloadAttachment} onDownloadAllAttachments={onDownloadAllAttachments} onCloseAttachmentPreview={onCloseAttachmentPreview} />
  if (mobile && selectedMessage !== undefined) return <View style={styles.mailWorkspaceMobile}>{preview}</View>
  return (
    <View style={[styles.mailWorkspace, mobile && styles.mailWorkspaceMobile]}>
      {mobile ? <View style={styles.threadPaneMobile}>{threadPane}</View> : <ResizablePane style={threadPaneResizeStyle} fallbackStyle={styles.threadPaneFallback}>{threadPane}</ResizablePane>}
      {mobile ? null : <PaneDivider minWidth={MIN_MESSAGE_PANE_WIDTH} minTrailingWidth={MIN_MESSAGE_PANE_WIDTH} />}
      {mobile ? null : preview}
    </View>
  )
}

function MessageList({ accounts, messages, selectedMessageKey, loadingFlagMessageKey, canLoadMore, loadingMore, onSelectMessage, onToggleMessageFlag, onLoadMore }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly messages: readonly MailMessage[]
  readonly selectedMessageKey: string | undefined
  readonly loadingFlagMessageKey: string | undefined
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onSelectMessage: (key: string) => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onLoadMore: () => void
}) {
  return (
    <ScrollView style={styles.messageList}>
      {messages.map((message) => (
        <Pressable key={message.key} onPress={() => onSelectMessage(message.key)} style={[styles.clickable, styles.messageRow, message.flagState === "flagged" && styles.messageRowFlagged, message.flagState === "done" && styles.messageRowDone, selectedMessageKey === message.key && styles.messageRowActive]}>
          <View style={styles.messageRowTop}>
            <Text numberOfLines={1} style={styles.messageSender}>{message.from || accountEmailForMessage(accounts, message)}</Text>
            <View style={styles.messageRowActions}>
              <Text style={styles.messageDate}>{formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
              <FlagButton flagState={message.flagState} loading={loadingFlagMessageKey === message.key} onPress={() => onToggleMessageFlag(message.key)} />
            </View>
          </View>
          <Text numberOfLines={1} style={styles.messageSubject}>{message.subject || "(no subject)"}</Text>
          <Text numberOfLines={1} style={styles.messageMetaText}>To {message.to.length === 0 ? "Undisclosed recipients" : message.to.join(", ")}</Text>
          {messageAttachmentLabels(message).length === 0 ? null : <Text style={styles.attachmentText}>{messageAttachmentLabels(message).join(" · ")}</Text>}
        </Pressable>
      ))}
      {canLoadMore ? <View style={styles.loadMoreArea}><SecondaryButton label="Load more" loading={loadingMore} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
    </ScrollView>
  )
}

function SearchStatusLine({ searchState, loadedCount }: { readonly searchState: SearchState; readonly loadedCount: number }) {
  const text = searchStatusText(searchState, loadedCount)
  if (searchState.status === "searching") {
    return (
      <View style={styles.statusInline}>
        <Spinner />
        {text.length === 0 ? null : <Text style={styles.threadSubtle}>{text}</Text>}
      </View>
    )
  }
  return <Text style={searchState.status === "error" ? styles.statusError : styles.threadSubtle}>{text}</Text>
}

function FlagButton({ flagState, loading, onPress }: { readonly flagState: MessageFlagState; readonly loading: boolean; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={flagButtonLabel(flagState)} onPress={(event: GestureResponderEvent) => { event.stopPropagation(); if (!loading) onPress() }} style={[styles.clickable, styles.flagButton, flagState !== "unflagged" && styles.flagButtonActive, loading && styles.buttonDisabled]}>
      {loading ? <Spinner /> : <MaterialActionIcon name={flagIconName(flagState)} size={18} color={flagIconColor(flagState)} />}
    </Pressable>
  )
}

function MessagePreview({ message, loading, loadingInlineImages, loadingAttachmentKey, loadingFlagMessageKey, error, inlineImageError, attachmentError, attachmentPreview, remoteImageProxyBase, mobile, onBack, onToggleMessageFlag, onLoadInlineImages, onPreviewAttachment, onDownloadAttachment, onDownloadAllAttachments, onCloseAttachmentPreview }: {
  readonly message: MailMessage | undefined
  readonly loading: boolean
  readonly loadingInlineImages: boolean
  readonly loadingAttachmentKey: string | undefined
  readonly loadingFlagMessageKey: string | undefined
  readonly error: string | undefined
  readonly inlineImageError: string | undefined
  readonly attachmentError: string | undefined
  readonly attachmentPreview: AttachmentPreviewState | undefined
  readonly remoteImageProxyBase: string | undefined
  readonly mobile?: boolean
  readonly onBack?: () => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onLoadInlineImages: (key: string) => void
  readonly onPreviewAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
  readonly onCloseAttachmentPreview: () => void
}) {
  const [remoteContentModes, setRemoteContentModes] = useState<Record<string, RemoteContentMode>>({})
  if (message === undefined) {
    return (
      <View style={styles.readerPane}>
        <Text style={styles.readerTitle}>No message selected</Text>
      </View>
    )
  }

  const requestedRemoteContentMode = remoteContentModes[message.key] ?? "blocked"
  const remoteContentMode = requestedRemoteContentMode === "proxy" && remoteImageProxyBase === undefined ? "blocked" : requestedRemoteContentMode
  const htmlPreview = htmlPreviewForMessage(message, remoteContentMode, remoteImageProxyBase)
  const attachments = messageAttachmentDisplayParts(message)
  const canLoadInlineImages = (message.inlineImages?.length ?? 0) > 0
  return (
    <>
      <ScrollView style={[styles.readerPane, mobile === true && styles.readerPaneMobile]} contentContainerStyle={styles.readerContent}>
        <View style={[styles.readerTitleRow, mobile === true && styles.readerTitleRowMobile]}>
          {onBack === undefined ? null : <ToolbarIconButton icon="arrow-back" accessibilityLabel="Back to message list" onPress={onBack} />}
          <Text style={[styles.readerTitle, mobile === true && styles.readerTitleMobile]}>{message.subject || "(no subject)"}</Text>
          <FlagButton flagState={message.flagState} loading={loadingFlagMessageKey === message.key} onPress={() => onToggleMessageFlag(message.key)} />
        </View>
        <Text style={styles.readerMeta}>From {message.from || "Unknown sender"}</Text>
        <Text style={styles.readerMeta}>To {message.to.length === 0 ? "Undisclosed recipients" : message.to.join(", ")}</Text>
        <Text style={styles.readerMeta}>{formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
        <AttachmentList messageKey={message.key} attachments={attachments} loadingAttachmentKey={loadingAttachmentKey} onPreviewAttachment={onPreviewAttachment} onDownloadAttachment={onDownloadAttachment} onDownloadAllAttachments={onDownloadAllAttachments} />
        {attachmentError === undefined ? null : <Text style={styles.errorText}>{attachmentError}</Text>}
        {loading && message.bodyLoaded !== true ? (
          <View style={styles.readerLoading}><Spinner /></View>
        ) : error !== undefined ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : message.bodyLoaded !== true ? (
          <Text style={styles.readerBody}>Click a message to load contents.</Text>
        ) : htmlPreview === undefined ? (
          <Text style={styles.readerBody}>{message.bodyText || "No message body available."}</Text>
        ) : (
          <View style={styles.htmlPreviewBlock}>
            {htmlPreview.blockedInlineImages === 0 ? null : (
              <View style={styles.inlineContentNotice}>
                <Text style={styles.inlineContentText}>{htmlPreview.blockedInlineImages} inline image{htmlPreview.blockedInlineImages === 1 ? "" : "s"} blocked until loaded from this message.</Text>
                {canLoadInlineImages ? <SecondaryButton label="Load inline images" loading={loadingInlineImages} disabled={loadingInlineImages} onPress={() => onLoadInlineImages(message.key)} /> : <Text style={styles.inlineContentText}>Server did not provide matching inline image parts.</Text>}
                {inlineImageError === undefined ? null : <Text style={styles.errorText}>{inlineImageError}</Text>}
              </View>
            )}
            {htmlPreview.blockedRemoteUrls === 0 || remoteContentMode !== "blocked" ? null : (
              <View style={styles.remoteContentNotice}>
                <Text style={styles.remoteContentText}>{htmlPreview.blockedRemoteUrls} remote item{htmlPreview.blockedRemoteUrls === 1 ? "" : "s"} blocked to protect your IP address.</Text>
                <SecondaryButton label="Load" onPress={() => setRemoteContentModes((current) => ({ ...current, [message.key]: "direct" }))} />
                {remoteImageProxyBase === undefined ? null : <SecondaryButton label="Load via configured proxy" onPress={() => setRemoteContentModes((current) => ({ ...current, [message.key]: "proxy" }))} />}
              </View>
            )}
            <HtmlPreview html={htmlPreview.html} />
          </View>
        )}
      </ScrollView>
      <AttachmentPreviewModal preview={attachmentPreview} onClose={onCloseAttachmentPreview} />
    </>
  )
}

function AttachmentList({ messageKey, attachments, loadingAttachmentKey, onPreviewAttachment, onDownloadAttachment, onDownloadAllAttachments }: {
  readonly messageKey: string
  readonly attachments: readonly EmailAttachmentPart[]
  readonly loadingAttachmentKey: string | undefined
  readonly onPreviewAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
}) {
  if (attachments.length === 0) return null
  const allActionKey = `${messageKey}:attachments:all`
  return (
    <View style={styles.attachmentList}>
      <View style={styles.attachmentListHeader}>
        <Text style={styles.attachmentListTitle}>{attachments.length} Attachment{attachments.length === 1 ? "" : "s"}</Text>
        {attachments.length > 1 ? <TinyButton icon="archive" label="Download zip" loading={loadingAttachmentKey === allActionKey} disabled={loadingAttachmentKey !== undefined} onPress={() => onDownloadAllAttachments(messageKey)} /> : null}
      </View>
      <View style={styles.attachmentGrid}>
        {attachments.map((attachment, index) => {
          const actionKey = attachmentActionKey(messageKey, attachment, index)
          const loading = loadingAttachmentKey === actionKey
          const previewable = canPreviewAttachment(attachment)
          return (
            <Pressable key={attachmentKey(attachment, index)} onPress={previewable && loadingAttachmentKey === undefined ? () => onPreviewAttachment(messageKey, attachment, index) : undefined} style={[styles.attachmentItem, previewable && styles.clickable]}>
              <View style={styles.attachmentFileText}>
                <Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text>
                <Text numberOfLines={1} style={styles.attachmentMeta}>{attachmentMetaText(attachment)}</Text>
              </View>
              <View style={styles.attachmentActions}>
                {loading ? <Spinner /> : null}
                <IconButton icon="file-download" accessibilityLabel={`Download ${attachment.name}`} disabled={loadingAttachmentKey !== undefined} onPress={() => onDownloadAttachment(messageKey, attachment, index)} />
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function AttachmentPreviewModal({ preview, onClose }: { readonly preview: AttachmentPreviewState | undefined; readonly onClose: () => void }) {
  if (preview === undefined) return null
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={[styles.clickable, styles.modalScrim]} onPress={onClose} />
      <View style={styles.attachmentModal}>
        <View style={styles.attachmentPreviewHeader}>
          <Text numberOfLines={1} style={styles.attachmentPreviewTitle}>{preview.name}</Text>
          <TinyButton icon="close" label="Close" onPress={onClose} />
        </View>
        {attachmentIsImage(preview) ? (
          <View style={styles.attachmentPreviewBody}>{createElement("img", { alt: preview.name, src: preview.objectUrl, style: attachmentPreviewImageStyle })}</View>
        ) : attachmentIsPdf(preview) ? (
          <View style={styles.attachmentPreviewBody}>
            {createElement("object", { data: preview.objectUrl, type: "application/pdf", style: attachmentPreviewObjectStyle, title: preview.name }, createElement("a", { href: preview.objectUrl, download: preview.name }, "Open PDF"))}
          </View>
        ) : (
          <Text style={styles.readerCopy}>No built-in preview for this attachment type.</Text>
        )}
      </View>
    </View>
  )
}

function IconButton({ icon, accessibilityLabel, disabled, onPress }: { readonly icon: MaterialIconName; readonly accessibilityLabel: string; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={(event: GestureResponderEvent) => { event.stopPropagation(); if (disabled !== true) onPress() }} style={[styles.clickable, styles.iconButton, disabled && styles.buttonDisabled]}>
      <MaterialActionIcon name={icon} size={17} color="#24364e" />
    </Pressable>
  )
}

function TinyButton({ icon, label, loading, disabled, onPress }: { readonly icon?: MaterialIconName; readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.tinyButton, disabled && styles.buttonDisabled]}>
      {loading === true ? <Spinner /> : icon === undefined ? null : <MaterialActionIcon name={icon} size={11} color="#24364e" />}
      <Text style={styles.tinyButtonText}>{label}</Text>
    </Pressable>
  )
}

function Spinner({ color = "#24364e" }: { readonly color?: string }) {
  return <ActivityIndicator size="small" color={color} />
}

function MaterialActionIcon({ name, size, color }: { readonly name: MaterialIconName; readonly size: number; readonly color: string }) {
  return <MaterialIcons name={name} size={size} color={color} />
}

function HtmlPreview({ html }: { readonly html: string }) {
  const [height, setHeight] = useState(1)
  useEffect(() => setHeight(1), [html])
  if (Platform.OS !== "web") return <Text style={styles.readerBody}>{stripHtml(html)}</Text>
  return createElement("iframe", {
    onLoad: (event) => {
      const frame = event.currentTarget as HTMLIFrameElement
      resizeHtmlPreviewFrame(frame, setHeight)
      globalThis.setTimeout(() => resizeHtmlPreviewFrame(frame, setHeight), 50)
    },
    referrerPolicy: "no-referrer",
    sandbox: "",
    scrolling: "no",
    srcDoc: html,
    style: { ...htmlPreviewFrameStyle, height },
    title: "Message HTML preview",
  })
}

function resizeHtmlPreviewFrame(frame: HTMLIFrameElement, setHeight: (height: number) => void): void {
  const document = frame.contentDocument
  if (document === null) return
  const nextHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1)
  setHeight(nextHeight)
}

function htmlPreviewForMessage(message: MailMessage, remoteContentMode: RemoteContentMode, remoteImageProxyBase: string | undefined): { readonly html: string; readonly blockedRemoteUrls: number; readonly blockedInlineImages: number } | undefined {
  if (message.bodyHtml === undefined || message.bodyHtml.trim().length === 0) return undefined
  const sanitized = sanitizeEmailHtml(message.bodyHtml, remoteContentMode, remoteImageProxyBase, message.inlineImageDataByCid ?? {})
  return {
    html: htmlPreviewDocument(sanitized.html, remoteContentMode, remoteImageProxyBase),
    blockedRemoteUrls: sanitized.blockedRemoteUrls,
    blockedInlineImages: sanitized.blockedInlineImages,
  }
}

function sanitizeEmailHtml(html: string, remoteContentMode: RemoteContentMode, proxyBase: string | undefined, inlineImageDataByCid: Record<string, string>): { readonly html: string; readonly blockedRemoteUrls: number; readonly blockedInlineImages: number } {
  if (typeof DOMParser === "undefined") return { html: `<pre>${escapeHtml(stripHtml(html))}</pre>`, blockedRemoteUrls: 0, blockedInlineImages: 0 }
  const document = new DOMParser().parseFromString(html, "text/html")
  const blockedRemoteUrls = new Set<string>()
  const blockedInlineImageCids = new Set<string>()
  const loadRemoteImagesDirectly = remoteContentMode === "direct"
  const loadRemoteImagesViaProxy = remoteContentMode === "proxy" && proxyBase !== undefined

  for (const element of [...document.querySelectorAll("script, style, link, iframe, object, embed, form, input, button, video, audio, source, track, svg")]) {
    element.remove()
  }

  for (const element of [...document.body.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()

      if (name.startsWith("on") || name === "style" || name === "srcset" || name === "ping" || name === "action" || name === "formaction" || name === "poster" || name === "background") {
        for (const url of remoteUrlsInValue(value)) blockedRemoteUrls.add(url)
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === "href" || name === "xlink:href") {
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === "src") {
        const remoteUrl = remoteHttpUrl(value)
        const cid = cidUrl(value)
        if (cid !== undefined) {
          const inlineImageData = inlineImageDataByCid[cid]
          if (element.tagName.toLowerCase() === "img" && inlineImageData !== undefined) {
            element.setAttribute(attribute.name, inlineImageData)
            element.setAttribute("referrerpolicy", "no-referrer")
          } else {
            blockedInlineImageCids.add(cid)
            element.removeAttribute(attribute.name)
            if (element.tagName.toLowerCase() === "img" && !element.hasAttribute("alt")) element.setAttribute("alt", "[inline image blocked]")
          }
          continue
        }

        if (remoteUrl === undefined) {
          if (!isSafeInlineUrl(value)) element.removeAttribute(attribute.name)
          continue
        }

        blockedRemoteUrls.add(remoteUrl)
        if (element.tagName.toLowerCase() === "img" && loadRemoteImagesDirectly) {
          element.setAttribute(attribute.name, remoteUrl)
          element.setAttribute("referrerpolicy", "no-referrer")
        } else if (element.tagName.toLowerCase() === "img" && loadRemoteImagesViaProxy) {
          element.setAttribute(attribute.name, proxiedRemoteUrl(remoteUrl, proxyBase))
          element.setAttribute("referrerpolicy", "no-referrer")
        } else {
          element.removeAttribute(attribute.name)
          if (element.tagName.toLowerCase() === "img" && !element.hasAttribute("alt")) element.setAttribute("alt", "[remote image blocked]")
        }
      }
    }
  }

  return { html: document.body.innerHTML, blockedRemoteUrls: blockedRemoteUrls.size, blockedInlineImages: blockedInlineImageCids.size }
}

function htmlPreviewDocument(bodyHtml: string, remoteContentMode: RemoteContentMode, proxyBase: string | undefined): string {
  const proxyOrigin = remoteContentMode === "proxy" && proxyBase !== undefined ? safeOrigin(proxyBase) : undefined
  const imageSrc = remoteContentMode === "direct" ? "data: blob: https: http:" : proxyOrigin === undefined ? "data: blob:" : `data: blob: ${proxyOrigin}`
  const csp = `default-src 'none'; img-src ${imageSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}"><style>html,body{max-height:none;overflow-y:visible}body{box-sizing:border-box;color:#172033;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;max-width:100%;overflow-x:auto;padding:0}img{height:auto;max-width:100%}table{max-width:100%;border-collapse:collapse}a{color:#0b4f9c;text-decoration:none}</style></head><body>${bodyHtml}</body></html>`
}

function loadRemoteImageProxyBase(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem(REMOTE_IMAGE_PROXY_STORAGE_KEY)?.trim()
    return value === undefined || value.length === 0 || !isHttpsUrl(value) ? undefined : value
  } catch {
    return undefined
  }
}

function saveRemoteImageProxyBase(value: string | undefined): void {
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

function proxiedRemoteUrl(remoteUrl: string, proxyBase: string): string {
  if (proxyBase.includes("{url}")) return proxyBase.replaceAll("{url}", encodeURIComponent(remoteUrl))
  const url = new URL(proxyBase)
  url.searchParams.set("url", remoteUrl)
  return url.toString()
}

function remoteHttpUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  return undefined
}

function remoteUrlsInValue(value: string): string[] {
  return [...value.matchAll(/(?:https?:)?\/\/[^\s"'<>),]+/gi)].map((match) => match[0].startsWith("//") ? `https:${match[0]}` : match[0])
}

function cidUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith("cid:")) return undefined
  return normalizeCid(trimmed.slice(4))
}

function inlineImageCidsInHtml(html: string): Set<string> {
  const cids = new Set<string>()
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html")
    for (const element of [...document.body.querySelectorAll("[src]")]) {
      const cid = cidUrl(element.getAttribute("src") ?? "")
      if (cid !== undefined) cids.add(cid)
    }
  }
  for (const match of html.matchAll(/\bcid:([^"'\s<>]+)/gi)) cids.add(normalizeCid(match[1] ?? ""))
  return cids
}

function normalizeCid(value: string): string {
  const trimmed = safeDecodeURIComponent(value.trim()).replace(/^<|>$/g, "")
  return trimmed.toLowerCase()
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isSafeInlineUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("data:image/") || trimmed.startsWith("blob:")
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;")
}

interface PaneFolder {
  readonly folderId: string
  readonly label: string
  readonly count?: number | undefined
  readonly level?: number | undefined
  readonly badges?: readonly string[] | undefined
}

function accountFolders(account: ConfiguredAccount, mail: AccountMailState | undefined): PaneFolder[] {
  if (mail?.mailboxes.length) {
    return flattenMailboxTree(mail.mailboxes).map(({ mailbox, level }) => ({
        folderId: mailboxFolderId(account.id, mailbox.id),
        label: mailbox.name,
        count: mailbox.totalEmails ?? countMessagesForMailbox(mail, mailbox),
        level,
        badges: mailboxBadges(mailbox),
      }))
  }

  return []
}

function mailboxBadges(mailbox: MailboxSummary): string[] {
  return [
    mailbox.isSynthetic === true && mailbox.jmapAccountIsPersonal === false ? "shared" : undefined,
    mailbox.jmapAccountIsReadOnly === true || mailbox.myRights?.mayAddItems === false ? "read-only" : undefined,
    mailbox.isSubscribed === false ? "unsubscribed" : undefined,
    mailbox.myRights?.mayReadItems === false ? "no access" : undefined,
  ].filter((badge): badge is string => badge !== undefined)
}

function accountEmailForMessage(accounts: readonly ConfiguredAccount[], message: MailMessage): string {
  return accounts.find((account) => account.id === message.accountId)?.email ?? message.accountName
}

function flattenMailboxTree(mailboxes: readonly MailboxSummary[]): { readonly mailbox: MailboxSummary; readonly level: number }[] {
  const byParent = new Map<string | undefined, MailboxSummary[]>()
  for (const mailbox of mailboxes) {
    const parent = mailbox.parentId
    byParent.set(parent, [...(byParent.get(parent) ?? []), mailbox])
  }
  for (const [parent, children] of byParent) {
    byParent.set(parent, sortMailboxes(children))
  }

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

function sortMailboxes(mailboxes: readonly MailboxSummary[]): MailboxSummary[] {
  return [...mailboxes].sort((left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name))
}

function accountFolderStatusText(mail: AccountMailState | undefined): string {
  if (mail === undefined || mail.status === "idle") return "Not fetched"
  if (mail.status === "syncing") return "Fetching..."
  if (mail.status === "error") return mail.error ?? "Fetch failed"
  return `${mail.messages.length} messages, ${mail.mailboxes.length} folders`
}

function accountFolderStatusStyle(mail: AccountMailState | undefined) {
  return mail?.status === "error" ? styles.accountTreeError : styles.accountTreeStatus
}

function countMessagesForFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): number {
  return messagesForFolder(accounts, mailByAccount, folderId).length
}

function countMessagesForRole(mail: AccountMailState, role: string): number {
  return mail.messages.filter((message) => messageInRole(message, mail.mailboxes, role)).length
}

function countMessagesInMailbox(messages: readonly MailMessage[], mailboxId: string): number {
  return messages.filter((message) => message.mailboxIds.includes(mailboxId)).length
}

function countMessagesForMailbox(mail: AccountMailState, mailbox: MailboxSummary): number {
  const mailboxIds = mailbox.isSynthetic === true ? mailboxAndDescendantIds(mail.mailboxes, mailbox.id) : [mailbox.id]
  return mail.messages.filter((message) => message.mailboxIds.some((mailboxId) => mailboxIds.includes(mailboxId))).length
}

function mailboxAndDescendantIds(mailboxes: readonly MailboxSummary[], mailboxId: string): string[] {
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

function mailboxFolderId(accountId: string, mailboxId: string): string {
  return `${accountId}:mailbox:${encodeURIComponent(mailboxId)}`
}

function parseMailboxFolderId(folderId: string): { readonly accountId: string; readonly mailboxId: string } | undefined {
  const marker = ":mailbox:"
  const markerIndex = folderId.lastIndexOf(marker)
  if (markerIndex < 0) return undefined
  const accountId = folderId.slice(0, markerIndex)
  const encodedMailboxId = folderId.slice(markerIndex + marker.length)
  if (accountId.length === 0 || encodedMailboxId.length === 0) return undefined
  return { accountId, mailboxId: decodeURIComponent(encodedMailboxId) }
}

function parseAccountRoleFolderId(accounts: readonly ConfiguredAccount[], folderId: string): { readonly account: ConfiguredAccount; readonly role: string } | undefined {
  for (const account of accounts) {
    for (const folder of ACCOUNT_FOLDERS) {
      if (folderId === `${account.id}:${folder.id}`) return { account, role: folder.id }
    }
  }
  return undefined
}

async function fetchAccountMail(account: ConfiguredAccount, auth: AuthProvider): Promise<AccountMailState> {
  const { client, session, primaryMailAccountId } = await createMailClient(account, auth)
  const mailTargets = mailAccountTargets(session, primaryMailAccountId)
  const states = await Promise.all(mailTargets.map((target) => fetchMailTargetBatch(client, account, target)))

  return {
    status: "ready",
    mailboxes: states.flatMap((state) => state.mailboxes),
    messages: states.flatMap((state) => state.messages).sort((left, right) => messageTime(right) - messageTime(left)),
    syncedAt: new Date().toISOString(),
  }
}

async function fetchMailTargetBatch(client: JmapClient, account: ConfiguredAccount, target: JmapMailAccountTarget): Promise<LoadedMailTargetBatch> {
  const mailboxArgs = responseArgs(await client.call([CAP_MAIL], "Mailbox/get", { accountId: target.id, ids: null }, `ui-mailbox-get-${target.id}`))
  const mailboxes = addJmapAccountRoot(target, jsonObjectArray(mailboxArgs.list).flatMap((mailbox) => toMailboxSummary(mailbox, target)))
  const { messages } = await queryAndFetchEmailMessages(client, account, target.id, { limit: EMAIL_PAGE_SIZE }, `ui-email-${target.id}`)
  return { mailboxes, messages }
}

async function fetchMoreMailboxMessages(account: ConfiguredAccount, auth: AuthProvider, target: FolderLoadTarget, existingMessages: readonly MailMessage[]): Promise<MailMessage[]> {
  const { client, primaryMailAccountId } = await createMailClient(account, auth)
  const jmapAccountId = target.jmapAccountId ?? primaryMailAccountId
  const emailIds = unique((await queryEmail(client, jmapAccountId, { mailboxId: target.jmapMailboxId, limit: target.loadedCount + EMAIL_PAGE_SIZE })).ids)
  const existingIds = new Set(existingMessages
    .filter((message) => (message.jmapAccountId ?? primaryMailAccountId) === jmapAccountId && message.mailboxIds.includes(target.mailboxId))
    .map((message) => message.id))
  const missingIds = emailIds.filter((id) => !existingIds.has(id))
  return missingIds.length === 0 ? [] : fetchEmailMessages(client, account, jmapAccountId, missingIds)
}

async function createMailClient(account: ConfiguredAccount, auth: AuthProvider): Promise<{ readonly client: JmapClient; readonly session: JmapSession; readonly transport: FetchJmapTransport; readonly primaryMailAccountId: string }> {
  const sessionUrl = accountSessionUrl(account)
  const sessionTransport = new FetchJmapTransport({ auth, fetchImpl: jmapFetch })
  const sessionResult = await discoverJmapSessionWithUrl({
    email: account.email,
    ...(sessionUrl === undefined ? { resolveSrv: resolveJmapSrvFresh } : { sessionUrl }),
    auth,
    transport: sessionTransport,
  })
  const session = sessionResult.session
  const primaryMailAccountId = account.primaryMailAccountId ?? session.primaryAccounts[CAP_MAIL] ?? firstMailAccountId(session)
  if (primaryMailAccountId === undefined || primaryMailAccountId === null) throw new Error("No mail account found on server.")

  const transport = new FetchJmapTransport({ auth, session, fetchImpl: jmapFetch })
  return {
    primaryMailAccountId,
    session,
    transport,
    client: new JmapClient({
    session,
    transport,
    }),
  }
}

async function fetchEmailMessages(client: JmapClient, account: ConfiguredAccount, mailAccountId: string, emailIds: readonly string[]): Promise<MailMessage[]> {
  const emailArgs = responseArgs(await client.call([CAP_MAIL], "Email/get", {
    accountId: mailAccountId,
    ids: [...emailIds],
    properties: [...EMAIL_METADATA_PROPERTIES],
    bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
  }, "ui-email-get"))
  const messages = jsonObjectArray(emailArgs.list)
    .map((email) => toMailMessageMetadata(account, mailAccountId, email))
    .sort((left, right) => messageTime(right) - messageTime(left))
  return messages
}

async function fetchEmailMessageBody(client: JmapClient, mailAccountId: string, emailId: string): Promise<MessageBody> {
  const emailArgs = responseArgs(await client.call([CAP_MAIL], "Email/get", {
    accountId: mailAccountId,
    ids: [emailId],
    properties: [...EMAIL_BODY_PROPERTIES],
    bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
    fetchTextBodyValues: true,
    fetchHTMLBodyValues: true,
    maxBodyValueBytes: 200_000,
  }, "ui-email-body-get"))
  const email = jsonObjectArray(emailArgs.list)[0]
  if (email === undefined) throw new Error("Message body was not returned by server.")
  const bodyText = textBodyValue(email)
  const bodyHtml = htmlBodyValue(email)
  const attachments = emailAttachmentParts(email)
  const inlineImages = inlineImageParts(attachments)
  return {
    bodyText,
    ...(bodyHtml.length === 0 ? {} : { bodyHtml }),
    inlineImages,
    attachments,
  }
}

async function searchMailboxMessages(account: ConfiguredAccount, auth: AuthProvider, target: FolderLoadTarget, searchText: string): Promise<{ readonly messages: readonly MailMessage[]; readonly total?: number }> {
  const { client, primaryMailAccountId } = await createMailClient(account, auth)
  const jmapAccountId = target.jmapAccountId ?? primaryMailAccountId
  return searchMailboxMessagesWithClient(client, account, jmapAccountId, target, searchText)
}

async function searchMailboxMessagesWithClient(client: JmapClient, account: ConfiguredAccount, jmapAccountId: string, target: FolderLoadTarget, searchText: string): Promise<{ readonly messages: readonly MailMessage[]; readonly total?: number }> {
  return queryAndFetchEmailMessages(client, account, jmapAccountId, { mailboxId: target.jmapMailboxId, searchText, limit: EMAIL_PAGE_SIZE }, `ui-search-${target.jmapMailboxId}`)
}

async function queryAndFetchEmailMessages(client: JmapClient, account: ConfiguredAccount, accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean }, callIdPrefix: string): Promise<{ readonly messages: readonly MailMessage[]; readonly total?: number }> {
  const queryCallId = `${callIdPrefix}-query`
  const getCallId = `${callIdPrefix}-get`
  const response = await client.request({
    using: [CAP_MAIL],
    calls: [
      methodCall("Email/query", queryEmailArgs(accountId, options), queryCallId),
      methodCall("Email/get", withResultReference({
        accountId,
        properties: [...EMAIL_METADATA_PROPERTIES],
        bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
      }, "ids", resultReference(queryCallId, "Email/query", "/ids")), getCallId),
    ],
  })
  const query = responseArgsByCallId(response, queryCallId)
  const emailGet = responseArgsByCallId(response, getCallId)
  const total = numberValue(query.total)
  const messages = jsonObjectArray(emailGet.list)
    .map((email) => toMailMessageMetadata(account, accountId, email))
    .sort((left, right) => messageTime(right) - messageTime(left))
  return { messages, ...(total === undefined ? {} : { total }) }
}

async function queryEmail(client: JmapClient, accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean } = {}): Promise<EmailQueryResult> {
  const response = responseArgs(await client.call([CAP_MAIL], "Email/query", queryEmailArgs(accountId, options), `ui-email-query-${options.mailboxId ?? "all"}`))
  const total = numberValue(response.total)
  return {
    ids: stringArray(response.ids),
    ...(total === undefined ? {} : { total }),
  }
}

function queryEmailArgs(accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean } = {}): JsonObject {
  return cleanUndefined({
    accountId,
    filter: emailQueryFilter(options),
    sort: [{ property: "receivedAt", isAscending: false }],
    position: 0,
    limit: options.limit ?? EMAIL_PAGE_SIZE,
    calculateTotal: options.calculateTotal,
  })
}

function emailQueryFilter(options: { readonly mailboxId?: string; readonly searchText?: string }): JsonObject | undefined {
  const conditions: JsonObject[] = []
  if (options.mailboxId !== undefined) conditions.push({ inMailbox: options.mailboxId })
  const searchText = options.searchText?.trim()
  if (searchText !== undefined && searchText.length > 0) conditions.push({ text: searchText })
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { operator: "AND", conditions }
}

function mailAccountTargets(session: JmapSession, primaryMailAccountId: string): JmapMailAccountTarget[] {
  return Object.entries(session.accounts)
    .filter(([, account]) => account.accountCapabilities[CAP_MAIL] !== undefined)
    .map(([id, account]) => ({ id, name: account.name || id, isPrimary: id === primaryMailAccountId, isPersonal: account.isPersonal, isReadOnly: account.isReadOnly }))
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name))
}

function addJmapAccountRoot(target: JmapMailAccountTarget, mailboxes: readonly MailboxSummary[]): MailboxSummary[] {
  if (target.isPrimary || mailboxes.length === 0 || mailboxes.some((mailbox) => mailbox.parentId === undefined && mailbox.name === target.name)) return [...mailboxes]
  const rootId = jmapAccountRootMailboxId(target.id)
  const rootedMailboxes = mailboxes.map((mailbox) => mailbox.parentId === undefined ? { ...mailbox, parentId: rootId } : mailbox)
  const totalEmails = sumKnownMailboxCounts(rootedMailboxes.map((mailbox) => mailbox.totalEmails))
  return [{
    id: rootId,
    jmapAccountId: target.id,
    jmapAccountName: target.name,
    jmapAccountIsPersonal: target.isPersonal,
    jmapAccountIsReadOnly: target.isReadOnly,
    name: target.name,
    sortOrder: Number.MAX_SAFE_INTEGER - 1,
    ...(totalEmails === undefined ? {} : { totalEmails }),
    isSynthetic: true,
  }, ...rootedMailboxes]
}

function sumKnownMailboxCounts(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined)
  return known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0)
}

function namespaceJmapMailboxId(jmapAccountId: string, mailboxId: string): string {
  return `${encodeURIComponent(jmapAccountId)}:${encodeURIComponent(mailboxId)}`
}

function jmapAccountRootMailboxId(jmapAccountId: string): string {
  return `jmap-account:${encodeURIComponent(jmapAccountId)}`
}

function toMailboxSummary(input: JsonObject, target: JmapMailAccountTarget): MailboxSummary[] {
  const id = stringValue(input.id)
  if (id === undefined) return []
  const role = stringValue(input.role)
  const parentId = stringValue(input.parentId)
  const sortOrder = numberValue(input.sortOrder)
  const totalEmails = numberValue(input.totalEmails)
  const unreadEmails = numberValue(input.unreadEmails)
  const isSubscribed = booleanValue(input.isSubscribed)
  const myRights = parseMailboxRights(input.myRights)
  return [{
    id: namespaceJmapMailboxId(target.id, id),
    serverId: id,
    jmapAccountId: target.id,
    jmapAccountName: target.name,
    jmapAccountIsPersonal: target.isPersonal,
    jmapAccountIsReadOnly: target.isReadOnly,
    name: stringValue(input.name) ?? id,
    ...(role === undefined ? {} : { role }),
    ...(parentId === undefined || parentId.length === 0 ? {} : { parentId: namespaceJmapMailboxId(target.id, parentId) }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(totalEmails === undefined ? {} : { totalEmails }),
    ...(unreadEmails === undefined ? {} : { unreadEmails }),
    ...(isSubscribed === undefined ? {} : { isSubscribed }),
    ...(myRights === undefined ? {} : { myRights }),
  }]
}

function parseMailboxRights(value: unknown): MailboxRights | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const rights = value as Record<string, unknown>
  return cleanUndefined({
    mayReadItems: booleanValue(rights.mayReadItems),
    mayAddItems: booleanValue(rights.mayAddItems),
    mayRemoveItems: booleanValue(rights.mayRemoveItems),
    maySetSeen: booleanValue(rights.maySetSeen),
    maySetKeywords: booleanValue(rights.maySetKeywords),
    mayCreateChild: booleanValue(rights.mayCreateChild),
    mayRename: booleanValue(rights.mayRename),
    mayDelete: booleanValue(rights.mayDelete),
    maySubmit: booleanValue(rights.maySubmit),
    mayShare: booleanValue(rights.mayShare),
  }) as unknown as MailboxRights
}

function toMailMessageMetadata(account: ConfiguredAccount, jmapAccountId: string, email: JsonObject): MailMessage {
  const id = stringValue(email.id) ?? `${account.id}:unknown`
  const to = addressList(email.to)
  const attachments = emailAttachmentParts(email)
  return {
    id,
    key: `${account.id}:${encodeURIComponent(jmapAccountId)}:${id}`,
    accountId: account.id,
    accountName: account.email,
    jmapAccountId,
    mailboxIds: mailboxIdList(email.mailboxIds).map((mailboxId) => namespaceJmapMailboxId(jmapAccountId, mailboxId)),
    subject: stringValue(email.subject) ?? "",
    flagState: messageFlagState(keywordRecord(email.keywords)),
    from: addressList(email.from)[0] ?? "",
    to,
    ...(stringValue(email.receivedAt) === undefined ? {} : { receivedAt: stringValue(email.receivedAt) as string }),
    ...(stringValue(email.sentAt) === undefined ? {} : { sentAt: stringValue(email.sentAt) as string }),
    attachments,
    hasAttachment: email.hasAttachment === true || attachments.length > 0,
    hasSignatureAttachment: attachments.some(isSignatureAttachment),
    hasPublicKeyAttachment: attachments.some(isPublicKeyAttachment),
  }
}

function textBodyValue(email: JsonObject): string {
  const bodyValues = jsonRecord(email.bodyValues)
  const textValue = bodyValueForParts(bodyValues, email.textBody)
  if (textValue.length > 0) return textValue
  return stripHtml(bodyValueForParts(bodyValues, email.htmlBody))
}

function htmlBodyValue(email: JsonObject): string {
  return bodyValueForParts(jsonRecord(email.bodyValues), email.htmlBody)
}

function bodyValueForParts(bodyValues: Record<string, JsonObject>, parts: unknown): string {
  const bodyParts = Array.isArray(parts) ? parts : []
  return bodyParts
    .map((part) => typeof part === "object" && part !== null && !Array.isArray(part) ? stringValue((part as JsonObject).partId) : undefined)
    .flatMap((partId) => {
      const bodyValue = partId === undefined ? undefined : bodyValues[partId]
      if (typeof bodyValue !== "object" || bodyValue === null || Array.isArray(bodyValue)) return []
      const value = stringValue((bodyValue as JsonObject).value)
      return value === undefined ? [] : [value]
    })
    .join("\n\n")
    .trim()
}

function emailAttachments(email: JsonObject): JsonObject[] {
  return jsonObjectArray(email.attachments)
}

function emailAttachmentParts(email: JsonObject): EmailAttachmentPart[] {
  return emailAttachments(email).map((part) => {
    const type = stringValue(part.type) ?? "application/octet-stream"
    const name = stringValue(part.name) ?? defaultAttachmentName(type)
    const partId = stringValue(part.partId)
    const blobId = stringValue(part.blobId)
    const size = numberValue(part.size)
    const disposition = stringValue(part.disposition)
    const cid = stringValue(part.cid)
    return {
      name,
      type,
      ...(partId === undefined ? {} : { partId }),
      ...(blobId === undefined ? {} : { blobId }),
      ...(size === undefined ? {} : { size }),
      ...(disposition === undefined ? {} : { disposition }),
      ...(cid === undefined ? {} : { cid: normalizeCid(cid) }),
    }
  })
}

function inlineImageParts(attachments: readonly EmailAttachmentPart[]): InlineImagePart[] {
  return attachments.flatMap((part) => {
    const cid = part.cid
    const blobId = part.blobId
    const type = part.type
    if (cid === undefined || blobId === undefined || !type.toLowerCase().startsWith("image/")) return []
    return [{
      cid,
      blobId,
      name: part.name,
      type,
    }]
  })
}

function defaultAttachmentName(type: string): string {
  if (type.toLowerCase().startsWith("image/")) return "image"
  return "attachment"
}

function isSignatureAttachment(attachment: { readonly type?: unknown; readonly name?: unknown }): boolean {
  const type = stringValue(attachment.type)?.toLowerCase() ?? ""
  const name = stringValue(attachment.name)?.toLowerCase() ?? ""
  return type.includes("pgp-signature")
    || type.includes("pkcs7-signature")
    || name.endsWith(".sig")
    || name.endsWith(".p7s")
    || name === "signature.asc"
}

function isPublicKeyAttachment(attachment: { readonly type?: unknown; readonly name?: unknown }): boolean {
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

function messageFlagState(keywords: Record<string, unknown>): MessageFlagState {
  if (keywords.done === true) return "done"
  if (keywords.$flagged === true) return "flagged"
  return "unflagged"
}

function nextMessageFlagState(flagState: MessageFlagState): MessageFlagState {
  if (flagState === "unflagged") return "flagged"
  if (flagState === "flagged") return "done"
  return "unflagged"
}

function flagIconName(flagState: MessageFlagState): MaterialIconName {
  if (flagState === "done") return "check-circle"
  if (flagState === "flagged") return "flag"
  return "outlined-flag"
}

function flagIconColor(flagState: MessageFlagState): string {
  if (flagState === "done") return "#166534"
  if (flagState === "flagged") return "#c2410c"
  return "#64748b"
}

function flagButtonLabel(flagState: MessageFlagState): string {
  if (flagState === "done") return "Mark unflagged"
  if (flagState === "flagged") return "Mark done"
  return "Flag message"
}

async function setRemoteMessageFlagState(client: JmapClient, accountId: string, messageId: string, flagState: MessageFlagState): Promise<void> {
  const args = responseArgs(await client.call([CAP_MAIL], "Email/set", {
    accountId,
    update: {
      [messageId]: flagStatePatch(flagState),
    },
  }, "ui-email-flag-set"))
  if (keywordRecord(args.notUpdated)[messageId] !== undefined) throw new Error("Server rejected message flag update.")
}

function flagStatePatch(flagState: MessageFlagState): JsonObject {
  return {
    "keywords/$flagged": flagState === "flagged" ? true : null,
    "keywords/done": flagState === "done" ? true : null,
  }
}

function messageAttachmentLabels(message: MailMessage): string[] {
  const attachmentCount = message.attachments.length
  return [
    message.hasAttachment || attachmentCount > 0 ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : undefined,
    message.hasSignatureAttachment ? "Signature" : undefined,
    message.hasPublicKeyAttachment ? "Public key" : undefined,
  ].filter((label): label is string => label !== undefined)
}

function messageAttachmentDisplayParts(message: MailMessage): readonly EmailAttachmentPart[] {
  return message.attachments
}

function attachmentKey(attachment: EmailAttachmentPart, index: number): string {
  return [attachment.blobId, attachment.partId, attachment.name, String(index)].filter((part): part is string => part !== undefined).join(":")
}

function attachmentMetaText(attachment: EmailAttachmentPart): string {
  return [attachment.type, formatByteSize(attachment.size), attachment.disposition === "inline" ? "inline" : undefined]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ")
}

function attachmentActionKey(messageKey: string, attachment: EmailAttachmentPart, index: number): string {
  return `${messageKey}:attachment:${attachmentKey(attachment, index)}`
}

function canPreviewAttachment(attachment: EmailAttachmentPart): boolean {
  return attachmentIsImage(attachment) || attachmentIsPdf(attachment)
}

function attachmentIsImage(attachment: { readonly type: string }): boolean {
  return attachment.type.toLowerCase().startsWith("image/")
}

function attachmentIsPdf(attachment: { readonly type: string; readonly name?: string }): boolean {
  return attachment.type.toLowerCase() === "application/pdf" || attachment.name?.toLowerCase().endsWith(".pdf") === true
}

async function downloadAttachmentBlob(transport: FetchJmapTransport, accountId: string, attachment: EmailAttachmentPart): Promise<BlobLike> {
  if (attachment.blobId === undefined) throw new Error("Attachment has no blob id.")
  try {
    return await transport.download(accountId, attachment.blobId, attachment.name, attachment.type)
  } catch (error) {
    if (!shouldRetryDownloadAsOctetStream(error, attachment.type)) throw error
    return transport.download(accountId, attachment.blobId, attachment.name, "application/octet-stream")
  }
}

function blobLikeToObjectUrl(blob: BlobLike, type: string): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Attachment preview is only available in a browser.")
  return URL.createObjectURL(blobLikeToBlob(blob, type))
}

function revokeAttachmentPreview(preview: AttachmentPreviewState | undefined): void {
  if (preview === undefined || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return
  URL.revokeObjectURL(preview.objectUrl)
}

async function promptSaveFile(name: string, type: string): Promise<SaveFileTarget> {
  const safeName = safeAttachmentFileName(name)
  if (isTauriRuntime()) {
    return {
      write: async (blob) => {
        const saved = await invoke<boolean>("save_file", {
          req: {
            suggestedName: safeName,
            bytesBase64: base64Bytes(new Uint8Array(await blob.arrayBuffer())),
          },
        })
        if (!saved) throw new SaveFileCancelledError()
      },
    }
  }
  const picker = (globalThis as unknown as { readonly showSaveFilePicker?: (options: { readonly suggestedName: string; readonly types?: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[] }) => Promise<BrowserSaveFileHandle> }).showSaveFilePicker
  if (typeof picker === "function") {
    const types = saveFilePickerTypes(safeName, type)
    const handle = await picker({ suggestedName: safeName, ...(types === undefined ? {} : { types }) })
    return {
      write: async (blob) => {
        const writable = await handle.createWritable()
        try {
          await writable.write(blob)
        } finally {
          await writable.close()
        }
      },
    }
  }
  return { write: async (blob) => downloadBytesOrBlob(blob, safeName) }
}

function saveFilePickerTypes(name: string, type: string): readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[] | undefined {
  if (type.length === 0 || type === "application/octet-stream") return undefined
  const extension = fileExtension(name)
  return [{ description: type, accept: { [type]: extension === undefined ? [] : [extension] } }]
}

function fileExtension(name: string): string | undefined {
  const index = name.lastIndexOf(".")
  if (index < 0 || index === name.length - 1) return undefined
  return name.slice(index).toLowerCase()
}

function isSaveFileCancelled(error: unknown): boolean {
  return error instanceof SaveFileCancelledError || (error instanceof DOMException && error.name === "AbortError")
}

class SaveFileCancelledError extends Error {
  constructor() {
    super("Save cancelled")
    this.name = "AbortError"
  }
}

function downloadBytesOrBlob(blob: Blob, name: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Attachment download is only available in a browser.")
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = name
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

function safeAttachmentFileName(name: string): string {
  const cleaned = safeBaseFileName(name)
  return cleaned.length === 0 ? "attachment" : cleaned
}

function safeBaseFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160)
}

function uniqueZipEntryName(name: string, usedNames: Set<string>): string {
  const safeName = safeAttachmentFileName(name)
  if (!usedNames.has(safeName)) {
    usedNames.add(safeName)
    return safeName
  }
  const dot = safeName.lastIndexOf(".")
  const base = dot <= 0 ? safeName : safeName.slice(0, dot)
  const ext = dot <= 0 ? "" : safeName.slice(dot)
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})${ext}`
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
  }
}

function formatByteSize(size: number | undefined): string | undefined {
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

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()
}

function messagesForFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): MailMessage[] {
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

function localSearchMessages(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string, query: string): MailMessage[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0)
  if (terms.length === 0) return []
  return messagesForFolder(accounts, mailByAccount, folderId).filter((message) => {
    const text = localMessageSearchText(message)
    return terms.every((term) => text.includes(term))
  })
}

function localMessageSearchText(message: MailMessage): string {
  return [
    message.subject,
    message.from,
    ...message.to,
    message.bodyText,
    message.bodyHtml === undefined ? undefined : stripHtml(message.bodyHtml),
    message.flagState === "unflagged" ? undefined : message.flagState,
    ...message.attachments.flatMap((attachment) => [attachment.name, attachment.type]),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n")
    .toLowerCase()
}

function messagesForKeys(mailByAccount: Record<string, AccountMailState>, messageKeys: readonly string[]): MailMessage[] {
  return messageKeys.flatMap((key) => {
    const message = findMessageByKey(mailByAccount, key)
    return message === undefined ? [] : [message]
  })
}

function findMessageByKey(mailByAccount: Record<string, AccountMailState>, messageKey: string): MailMessage | undefined {
  for (const state of Object.values(mailByAccount)) {
    const message = state.messages.find((item) => item.key === messageKey)
    if (message !== undefined) return message
  }
  return undefined
}

function canLoadMoreFolder(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): boolean {
  return folderLoadTargets(accounts, mailByAccount, folderId).some(folderTargetHasMore)
}

function folderLoadTargets(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): FolderLoadTarget[] {
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

function folderLoadTargetForMailbox(account: ConfiguredAccount, mail: AccountMailState, mailboxId: string): FolderLoadTarget[] {
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

function folderTargetHasMore(target: FolderLoadTarget): boolean {
  return target.totalEmails === undefined ? target.loadedCount >= EMAIL_PAGE_SIZE : target.loadedCount < target.totalEmails
}

function mergeLoadedMessageBatches(mailByAccount: Record<string, AccountMailState>, batches: readonly LoadedMessageBatch[]): Record<string, AccountMailState> {
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

function mergeMailTargetBatch(mailByAccount: Record<string, AccountMailState>, accountId: string, batch: LoadedMailTargetBatch): Record<string, AccountMailState> {
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

function mergeFetchedMailState(existing: AccountMailState | undefined, next: AccountMailState): AccountMailState {
  const byKey = new Map(existing?.messages.map((message) => [message.key, message]) ?? [])
  return {
    ...next,
    messages: next.messages.map((message) => mergeMessageMetadata(byKey.get(message.key), message)),
  }
}

function mergeMessageMetadata(existing: MailMessage | undefined, metadata: MailMessage): MailMessage {
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

function mergeMessageBody(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, body: MessageBody): Record<string, AccountMailState> {
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

function mergeInlineImageData(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, inlineImageDataByCid: Record<string, string>): Record<string, AccountMailState> {
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

function updateMessageFlagState(mailByAccount: Record<string, AccountMailState>, accountId: string, messageKey: string, flagState: MessageFlagState): Record<string, AccountMailState> {
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

function inlineImagesToLoad(message: MailMessage): InlineImagePart[] {
  const loaded = message.inlineImageDataByCid ?? {}
  const referencedCids = message.bodyHtml === undefined ? undefined : inlineImageCidsInHtml(message.bodyHtml)
  return (message.inlineImages ?? []).filter((image) => loaded[image.cid] === undefined && (referencedCids === undefined || referencedCids.has(image.cid)))
}

async function loadInlineImageData(transport: FetchJmapTransport, accountId: string, image: InlineImagePart): Promise<InlineImageLoadResult> {
  try {
    const blob = await downloadInlineImageBlob(transport, accountId, image)
    return { cid: image.cid, dataUrl: await blobLikeToDataUrl(blob, image.type) }
  } catch (error) {
    return { cid: image.cid, name: image.name, error: connectivityErrorMessage(error) }
  }
}

async function downloadInlineImageBlob(transport: FetchJmapTransport, accountId: string, image: InlineImagePart): Promise<BlobLike> {
  try {
    return await transport.download(accountId, image.blobId, image.name, image.type)
  } catch (error) {
    if (!shouldRetryDownloadAsOctetStream(error, image.type)) throw error
    return transport.download(accountId, image.blobId, image.name, "application/octet-stream")
  }
}

function shouldRetryDownloadAsOctetStream(error: unknown, type: string): boolean {
  return type.toLowerCase() !== "application/octet-stream" && error instanceof JmapTransportError && error.status === 400
}

function inlineImageLoadErrorMessage(failures: readonly Extract<InlineImageLoadResult, { readonly error: string }>[]): string {
  const first = failures[0]
  const sampleNames = failures.slice(0, 2).map((failure) => failure.name).join(", ")
  const sample = sampleNames.length === 0 ? "" : ` (${sampleNames}${failures.length > 2 ? ", ..." : ""})`
  return `${failures.length} inline image${failures.length === 1 ? "" : "s"} could not be loaded${sample}${first === undefined ? "." : `: ${first.error}`}`
}

function stripMessageContent(message: MailMessage): MailMessage {
  const { bodyText: _bodyText, bodyHtml: _bodyHtml, bodyLoaded: _bodyLoaded, inlineImages: _inlineImages, inlineImageDataByCid: _inlineImageDataByCid, preview: _preview, ...metadata } = message as MailMessage & { readonly preview?: string }
  return metadata
}

function uniqueMessages(messages: readonly MailMessage[]): MailMessage[] {
  const byKey = new Map<string, MailMessage>()
  for (const message of messages) if (!byKey.has(message.key)) byKey.set(message.key, message)
  return [...byKey.values()]
}

function messageChunks(messages: readonly MailMessage[]): MailMessage[][] {
  const chunks: MailMessage[][] = []
  for (let index = 0; index < messages.length; index += MESSAGE_REVEAL_CHUNK_SIZE) {
    chunks.push([...messages.slice(index, index + MESSAGE_REVEAL_CHUNK_SIZE)])
  }
  return chunks
}

function waitForMessageReveal(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MESSAGE_REVEAL_DELAY_MS))
}

async function blobLikeToDataUrl(blob: BlobLike, type: string): Promise<string> {
  const bytes = await blobLikeToBytes(blob)
  return `data:${type};base64,${base64Bytes(bytes)}`
}

async function blobLikeToBytes(blob: BlobLike): Promise<Uint8Array> {
  return blob instanceof Blob
    ? new Uint8Array(await blob.arrayBuffer())
    : blob instanceof ArrayBuffer
      ? new Uint8Array(blob)
      : blob
}

function blobLikeToBlob(blob: BlobLike, type: string): Blob {
  if (blob instanceof Blob) return blob.type === type ? blob : new Blob([blob], { type })
  if (blob instanceof ArrayBuffer) return new Blob([blob], { type })
  return new Blob([bufferSource(blob)], { type })
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function createZip(entries: readonly ZipEntryData[]): Uint8Array {
  const encoder = new TextEncoder()
  const now = dosDateTime(new Date())
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const localHeader = zipLocalHeader(nameBytes, entry.bytes.length, crc, now)
    localParts.push(localHeader, entry.bytes)
    centralParts.push(zipCentralDirectoryHeader(nameBytes, entry.bytes.length, crc, now, offset))
    offset += localHeader.length + entry.bytes.length
  }

  const centralDirectoryOffset = offset
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0)
  return concatBytes([...localParts, ...centralParts, zipEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset)])
}

function zipLocalHeader(nameBytes: Uint8Array, size: number, crc: number, now: { readonly time: number; readonly date: number }): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, now.time, true)
  view.setUint16(12, now.date, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint16(26, nameBytes.length, true)
  header.set(nameBytes, 30)
  return header
}

function zipCentralDirectoryHeader(nameBytes: Uint8Array, size: number, crc: number, now: { readonly time: number; readonly date: number }, localHeaderOffset: number): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, now.time, true)
  view.setUint16(14, now.date, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, size, true)
  view.setUint32(24, size, true)
  view.setUint16(28, nameBytes.length, true)
  view.setUint32(42, localHeaderOffset, true)
  header.set(nameBytes, 46)
  return header
}

function zipEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
  const header = new Uint8Array(22)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, entryCount, true)
  view.setUint16(10, entryCount, true)
  view.setUint32(12, centralDirectorySize, true)
  view.setUint32(16, centralDirectoryOffset, true)
  return header
}

function dosDateTime(date: Date): { readonly time: number; readonly date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE: readonly number[] = Array.from({ length: 256 }, (_value, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function messageInRole(message: MailMessage, mailboxes: readonly MailboxSummary[], role: string): boolean {
  const matchingIds = mailboxesForRole(mailboxes, role).map((mailbox) => mailbox.id)
  return matchingIds.length === 0 ? role === "inbox" : message.mailboxIds.some((mailboxId) => matchingIds.includes(mailboxId))
}

function mailboxesForRole(mailboxes: readonly MailboxSummary[], role: string): MailboxSummary[] {
  return mailboxes.filter((mailbox) => mailbox.role === role || mailbox.name.toLowerCase() === role)
}

function mailStatusText(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>): string {
  const states = accounts.map((account) => mailByAccount[account.id]).filter((state): state is AccountMailState => state !== undefined)
  if (states.some((state) => state.status === "syncing")) return "Fetching messages..."
  const error = states.find((state) => state.status === "error")?.error
  if (error !== undefined) return error
  const count = states.reduce((sum, state) => sum + state.messages.length, 0)
  if (count === 0) return "Click Get Messages to fetch mail."
  return ""
}

function searchStatusText(searchState: SearchState, loadedCount: number): string {
  if (searchState.status === "searching") return loadedCount === 0 ? `Server search for "${searchState.query}"` : `${loadedCount} result${loadedCount === 1 ? "" : "s"} loaded for "${searchState.query}"`
  if (searchState.status === "error") return searchState.error ?? "Search failed."
  if (searchState.status === "ready") {
    if (searchState.total !== undefined && searchState.total > loadedCount) return `${loadedCount} of ${searchState.total} search results loaded for "${searchState.query}".`
    return `${loadedCount} search result${loadedCount === 1 ? "" : "s"} for "${searchState.query}".`
  }
  return ""
}

function appendSearchBatch(searchState: SearchState, folderId: string, query: string, batch: LoadedMessageBatch): SearchState {
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

function finishSearchState(searchState: SearchState, folderId: string, query: string, messageKeys: readonly string[], total: number | undefined, failures: readonly string[]): SearchState {
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

function loadFailuresMessage(label: string, failures: readonly string[]): string {
  const first = failures[0]
  if (first === undefined) return "Load failed."
  return `${failures.length} ${label}${failures.length === 1 ? "" : "s"} failed. ${first}`
}

function emptyAccountMailState(): AccountMailState {
  return { status: "idle", mailboxes: [], messages: [] }
}

function accountSessionUrl(account: ConfiguredAccount): string | undefined {
  if (account.sessionUrl !== undefined) return account.sessionUrl
  if (isHttpsUrl(account.serverKey)) return account.serverKey
  const domain = domainFromEmailAddress(account.email)
  return domain === undefined ? undefined : wellKnownSessionUrl(domain)
}

function firstMailAccountId(session: JmapSession): string | undefined {
  return Object.entries(session.accounts).find(([, account]) => account.accountCapabilities[CAP_MAIL] !== undefined)?.[0]
}

function responseArgs(response: JmapResponse): JsonObject {
  const first = response.methodResponses[0]
  if (first === undefined) throw new Error("JMAP response missing method response.")
  if (first[0] === "error") throw new Error(`JMAP method failed: ${String(first[1].type ?? "unknown")}`)
  return first[1]
}

function responseArgsByCallId(response: JmapResponse, callId: string): JsonObject {
  const method = response.methodResponses.find(([, , id]) => id === callId)
  if (method === undefined) throw new Error(`JMAP response missing method response: ${callId}`)
  if (method[0] === "error") throw new Error(`JMAP method failed: ${String(method[1].type ?? "unknown")}`)
  return method[1]
}

function jsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
}

function jsonRecord(value: unknown): Record<string, JsonObject> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1])))
}

function keywordRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function cleanUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function mailboxIdList(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([id, enabled]) => enabled === true ? [id] : [])
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return []
    const address = item as JsonObject
    const name = stringValue(address.name)
    const email = stringValue(address.email)
    if (name !== undefined && email !== undefined) return [`${name} <${email}>`]
    if (email !== undefined) return [email]
    return name === undefined ? [] : [name]
  })
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function messageTime(message: MailMessage): number {
  return Date.parse(message.receivedAt ?? message.sentAt ?? "") || 0
}

function formatMessageDate(value: string | undefined): string {
  if (value === undefined) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

async function loadSavedAuth(accounts: readonly ConfiguredAccount[], masterPassword: string | undefined): Promise<{ readonly auth: Record<string, AuthProvider>; readonly mode: "os" | "fallback" }> {
  const authEntries = await Promise.all(accounts.map(async (account) => {
    const stored = await loadStoredAuthSecret(account.id, masterPassword)
    return stored === undefined ? undefined : [account.id, authFromStoredSecret(stored)] as const
  }))
  const auth = Object.fromEntries(authEntries.filter((entry): entry is readonly [string, AuthProvider] => entry !== undefined))
  const mode = isTauriRuntime() && masterPassword === undefined ? "os" : "fallback"
  return { auth, mode }
}

async function storeAccountAuth(account: ConfiguredAccount, auth: AuthProvider, masterPassword: string | undefined): Promise<"os" | "fallback"> {
  const stored = storedSecretFromAuth(account, auth)
  const serialized = JSON.stringify(stored)
  if (isTauriRuntime()) {
    try {
      await invoke("vault_set", { req: { key: vaultKey(account.id), secret: serialized } })
      return "os"
    } catch {
      // Fall through to manual fallback below.
    }
  }
  const existingVault = Object.keys(loadFallbackVault()).length > 0
  const promptText = existingVault ? "OS keyring unavailable. Enter master password to save credentials." : "OS keyring unavailable. Choose a master password to encrypt saved credentials."
  const password = masterPassword ?? prompt(promptText)?.trim()
  if (password === undefined || password.length === 0) throw new Error("Credentials are only kept until app closes because no master password was set.")
  await putFallbackVaultSecret(account.id, serialized, password)
  return "fallback"
}

async function deleteAccountAuth(accountId: string, masterPassword: string | undefined): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke("vault_delete", { req: { key: vaultKey(accountId) } })
      return
    } catch {
      // Also attempt fallback removal.
    }
  }
  if (masterPassword !== undefined && masterPassword.length > 0) await deleteFallbackVaultSecret(accountId, masterPassword)
}

async function loadStoredAuthSecret(accountId: string, masterPassword: string | undefined): Promise<StoredAuthSecret | undefined> {
  if (isTauriRuntime() && masterPassword === undefined) {
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
  const salt = randomBytes(FALLBACK_VAULT_SALT_BYTES)
  const iv = randomBytes(FALLBACK_VAULT_IV_BYTES)
  const key = await deriveFallbackVaultKey(masterPassword, salt)
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, new TextEncoder().encode(secret))
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

async function decryptFallbackVaultRecord(record: FallbackVaultRecord, masterPassword: string): Promise<string> {
  const key = await deriveFallbackVaultKey(masterPassword, base64ToBytes(record.salt))
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferSource(base64ToBytes(record.iv)) }, key, bufferSource(base64ToBytes(record.ciphertext)))
  return new TextDecoder().decode(plaintext)
}

async function deriveFallbackVaultKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(masterPassword), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations: FALLBACK_VAULT_KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function PaneDivider({ minWidth = MIN_MESSAGE_PANE_WIDTH, maxWidth, minTrailingWidth = MIN_MESSAGE_PANE_WIDTH }: {
  readonly minWidth?: number
  readonly maxWidth?: number
  readonly minTrailingWidth?: number
}) {
  if (Platform.OS === "web") {
    return createElement("div", {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => startPaneResize(
        event,
        maxWidth === undefined ? { minWidth, minTrailingWidth } : { minWidth, maxWidth, minTrailingWidth },
      ),
      style: paneDividerStyle,
    })
  }
  return <View style={styles.dragDivider} />
}

function startPaneResize(
  event: ReactPointerEvent<HTMLDivElement>,
  options: { readonly minWidth: number; readonly maxWidth?: number; readonly minTrailingWidth: number },
): void {
  event.preventDefault()
  const divider = event.currentTarget
  const pane = divider.previousElementSibling as HTMLElement | null
  const container = divider.parentElement as HTMLElement | null
  if (pane === null || container === null) return

  const startX = event.clientX
  const startWidth = pane.getBoundingClientRect().width
  const previousUserSelect = document.body.style.userSelect
  const previousCursor = document.body.style.cursor
  document.body.style.userSelect = "none"
  document.body.style.cursor = "col-resize"

  const resize = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault()
    const containerWidth = container.getBoundingClientRect().width
    const computedMaxWidth = Math.max(options.minWidth, containerWidth - options.minTrailingWidth - DIVIDER_WIDTH)
    const maxWidth = options.maxWidth === undefined ? computedMaxWidth : Math.min(options.maxWidth, computedMaxWidth)
    const nextWidth = clamp(startWidth + moveEvent.clientX - startX, options.minWidth, maxWidth)
    pane.style.flexBasis = `${nextWidth}px`
    pane.style.width = `${nextWidth}px`
  }

  const stop = () => {
    document.body.style.userSelect = previousUserSelect
    document.body.style.cursor = previousCursor
    globalThis.removeEventListener("pointermove", resize)
    globalThis.removeEventListener("pointerup", stop)
    globalThis.removeEventListener("pointercancel", stop)
  }

  globalThis.addEventListener("pointermove", resize)
  globalThis.addEventListener("pointerup", stop, { once: true })
  globalThis.addEventListener("pointercancel", stop, { once: true })
}

function ResizablePane({ style, fallbackStyle, children }: {
  readonly style: CSSProperties
  readonly fallbackStyle: ViewStyle
  readonly children: ReactNode
}) {
  if (Platform.OS === "web") return createElement("div", { style }, children)
  return <View style={fallbackStyle}>{children}</View>
}

function EmptyThreadList({ accounts, selectedFolder, searchActive, canLoadMore, loadingMore, onLoadMore }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly searchActive: boolean
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
}) {
  const selectedAccount = accounts.find((account) => selectedFolder.startsWith(`${account.id}:`))
  return (
    <View style={styles.emptyThreads}>
      <Text style={styles.emptyTitle}>{searchActive ? "No search results" : "No synced mail yet"}</Text>
      <Text style={styles.emptyCopy}>
        {searchActive
          ? "Server-side search found no messages in this folder."
          : selectedAccount === undefined
          ? "Unified Inbox is ready to merge incoming mail from all accounts."
          : `${selectedAccount.email} is configured. Its folders will fill after mailbox sync is wired.`}
      </Text>
      {canLoadMore ? <View style={styles.loadMoreArea}><SecondaryButton label="Load messages" loading={loadingMore} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
    </View>
  )
}

function Settings({ accounts, remoteImageProxyBase, onRemoteImageProxyChange, onAccountVerified, onDeleteAccount }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly remoteImageProxyBase: string | undefined
  readonly onRemoteImageProxyChange: (value: string | undefined) => void
  readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void
  readonly onDeleteAccount: (accountId: string) => void
}) {
  const [remoteImageProxyDraft, setRemoteImageProxyDraft] = useState(remoteImageProxyBase ?? "")
  useEffect(() => setRemoteImageProxyDraft(remoteImageProxyBase ?? ""), [remoteImageProxyBase])
  const saveRemoteImageProxy = () => onRemoteImageProxyChange(remoteImageProxyDraft)
  const clearRemoteImageProxy = () => {
    setRemoteImageProxyDraft("")
    onRemoteImageProxyChange(undefined)
  }

  return (
    <ScrollView style={styles.settingsPane} contentContainerStyle={styles.settingsContent}>
      <Text style={styles.settingsTitle}>Account Settings</Text>
      <Text style={styles.settingsCopy}>
        Add another mail account here. Each account can use its own server and settings.
      </Text>
      <View style={styles.settingsColumns}>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Add Mail Account</Text>
          <AccountSetupFlow mode="settings" onAccountVerified={onAccountVerified} />
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Configured Accounts</Text>
          {accounts.map((account) => (
            <View key={account.id} style={styles.manageAccountRow}>
              <AccountSummary account={account} />
              <SecondaryButton label="Remove" onPress={() => onDeleteAccount(account.id)} />
            </View>
          ))}
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Remote Content Proxy</Text>
          <Text style={styles.flowCopy}>Leave blank to load remote images directly only after you press Load. Add an HTTPS proxy endpoint to enable the extra proxy load option. Use {"{url}"} as a placeholder, or accept a url query parameter.</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Proxy URL</Text>
            <TextInput value={remoteImageProxyDraft} placeholder="https://proxy.example/image?url={url}" placeholderTextColor="#718096" onChangeText={setRemoteImageProxyDraft} autoCapitalize="none" style={styles.input} />
          </View>
          <View style={styles.flowButtons}>
            <SecondaryButton label="Clear" disabled={remoteImageProxyDraft.trim().length === 0 && remoteImageProxyBase === undefined} onPress={clearRemoteImageProxy} />
            <PrimaryButton label="Save" onPress={saveRemoteImageProxy} />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

function AccountSetupFlow({ mode, onAccountVerified }: {
  readonly mode: "first-run" | "settings"
  readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void
}) {
  const [draft, setDraft] = useState<AccountSetupDraft>(EMPTY_ACCOUNT_SETUP_DRAFT)
  const [step, setStep] = useState<SetupStep>("identity")
  const [error, setError] = useState<string | undefined>()
  const [detectedSessionUrls, setDetectedSessionUrls] = useState<readonly string[]>([])
  const [serverStatus, setServerStatus] = useState<"idle" | "checking" | "srv" | "fallback" | "error">("idle")
  const [credentialStatus, setCredentialStatus] = useState<"idle" | "checking" | "ok" | "error">("idle")
  const [verifiedSession, setVerifiedSession] = useState<JmapSession | undefined>()
  const [verifiedSessionUrl, setVerifiedSessionUrl] = useState<string | undefined>()
  const manualUrl = manualSessionUrl(draft)
  const effectiveServerStatus = manualUrl === undefined ? serverStatus : isHttpsUrl(manualUrl) ? "fallback" : "error"
  const navigationBusy = serverStatus === "checking" || credentialStatus === "checking"

  const update = (patch: Partial<AccountSetupDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setError(undefined)
    setCredentialStatus("idle")
    setVerifiedSession(undefined)
    setVerifiedSessionUrl(undefined)
    if (patch.email !== undefined) {
      setDetectedSessionUrls([])
      setServerStatus("idle")
    }
    if (patch.sessionUrl !== undefined) {
      const manual = patch.sessionUrl.trim()
      if (manual.length > 0) {
        setServerStatus(isHttpsUrl(manual) ? "fallback" : "error")
      } else {
        setServerStatus(detectedSessionUrls.length === 0 ? "idle" : detectedSessionUrls[0] === wellKnownSessionUrl(domainFromEmailAddress(draft.email) ?? "") ? "fallback" : "srv")
      }
    }
  }

  const goToStep = (nextStep: SetupStep) => {
    setError(undefined)
    if (credentialStatus === "error") setCredentialStatus("idle")
    setStep(nextStep)
  }

  const next = async () => {
    if (step === "identity") {
      const identityError = setupStepError(step, draft, effectiveServerStatus)
      if (identityError !== undefined) {
        setError(identityError)
        return
      }
      const ok = await runServerDiscovery(draft)
      if (!ok) return
      goToStep("server")
      return
    }

    if (step === "auth") {
      const stepError = authStepError(draft)
      if (stepError !== undefined) {
        setError(stepError)
        return
      }
      setError(undefined)
      setCredentialStatus("checking")
      setVerifiedSession(undefined)
      setVerifiedSessionUrl(undefined)
      try {
        const { session, sessionUrl } = await verifyCredentials(draft)
        setVerifiedSession(session)
        setVerifiedSessionUrl(sessionUrl)
        setCredentialStatus("ok")
        goToStep("review")
      } catch (err) {
        setCredentialStatus("error")
        setError(credentialErrorMessage(err))
      }
      return
    }

    if (step === "server") {
      const stepError = setupStepError(step, draft, effectiveServerStatus)
      if (stepError !== undefined) {
        setError(stepError)
        return
      }
      setError(undefined)
      setServerStatus("checking")
      try {
        const sessionUrl = await validateServerEndpoint(draft)
        setDraft((current) => ({ ...current, sessionUrl }))
        setServerStatus(detectedSessionUrls.some((url) => url === sessionUrl && url !== wellKnownSessionUrl(domainFromEmailAddress(draft.email) ?? "")) ? "srv" : "fallback")
        goToStep("auth")
      } catch (err) {
        setServerStatus("error")
        setError(serverEndpointErrorMessage(err))
      }
      return
    }

    const stepError = setupStepError(step, draft, effectiveServerStatus)
    if (stepError !== undefined) {
      setError(stepError)
      return
    }
    goToStep(nextSetupStep(step))
  }

  const runServerDiscovery = async (accountDraft: AccountSetupDraft): Promise<boolean> => {
    const domain = domainFromEmailAddress(accountDraft.email)
    if (domain === undefined) {
      setError("Enter a valid email address first.")
      return false
    }
    setServerStatus("checking")
    setDetectedSessionUrls([])
    try {
      const urls = await discoveryCandidates({
        email: accountDraft.email,
        auth: DISCOVERY_ONLY_AUTH,
        resolveSrv: resolveJmapSrvFresh,
      })
      setDetectedSessionUrls(urls)
      const firstUrl = urls[0]
      if (firstUrl !== undefined) setDraft((current) => ({ ...current, sessionUrl: firstUrl }))
      const fallbackUrl = wellKnownSessionUrl(domain)
      const hasSrvCandidate = urls.some((url) => url !== fallbackUrl)
      setServerStatus(hasSrvCandidate ? "srv" : "fallback")
      setError(undefined)
      return true
    } catch (err) {
      setServerStatus("error")
      setError(connectivityErrorMessage(err))
      return false
    }
  }
  const back = () => goToStep(previousSetupStep(step))

  const addVerifiedAccount = () => {
    if (verifiedSession === undefined || verifiedSessionUrl === undefined) {
      setError("Credentials must be verified before adding the account.")
      setStep("auth")
      return
    }
    const account = createConfiguredAccount(draft, {
      status: "ready",
      verifiedAt: new Date().toISOString(),
      sessionUrl: verifiedSessionUrl,
      capabilities: Object.keys(verifiedSession.capabilities),
      ...(verifiedSession.primaryAccounts[CAP_MAIL] === undefined || verifiedSession.primaryAccounts[CAP_MAIL] === null
        ? {}
        : { primaryMailAccountId: verifiedSession.primaryAccounts[CAP_MAIL] }),
    })
    onAccountVerified(account, authFromDraft(draft))
    setDraft(EMPTY_ACCOUNT_SETUP_DRAFT)
    setStep("identity")
    setCredentialStatus("idle")
    setVerifiedSession(undefined)
    setVerifiedSessionUrl(undefined)
  }

  return (
    <View style={styles.setupFlow}>
      <SetupStepper step={step} />
      {step === "identity" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>{mode === "first-run" ? "Who are you?" : "Account identity"}</Text>
          <Text style={styles.flowCopy}>This name appears in the account list and compose identity picker.</Text>
          <Field label="Your name" value={draft.displayName} placeholder="Ada Lovelace" onChangeText={(displayName) => update({ displayName })} />
          <Field label="Email address" value={draft.email} placeholder="ada@example.com" onChangeText={(email) => update({ email })} />
        </View>
      ) : null}

      {step === "server" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Find mail server</Text>
          <Text style={styles.flowCopy}>We filled this in from your email address. Change it only if your provider gave you a specific address.</Text>
          <Field label="Server address" value={draft.sessionUrl ?? ""} placeholder="Optional: https://mail.example/.well-known/jmap" onChangeText={(sessionUrl) => update({ sessionUrl })} />
        </View>
      ) : null}

      {step === "auth" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Sign in</Text>
          <Text style={styles.flowCopy}>The setup check uses this secret once. It is not written to browser storage.</Text>
          <View style={styles.authOptions}>
            {AUTH_OPTIONS.map((option) => (
              <Pressable key={option.value} onPress={() => update({ authKind: option.value })} style={[styles.clickable, styles.authOption, draft.authKind === option.value && styles.authOptionActive]}>
                <Text style={[styles.authOptionText, draft.authKind === option.value && styles.authOptionTextActive]}>{option.label}</Text>
                <Text style={[styles.authOptionHelp, draft.authKind === option.value && styles.authOptionHelpActive]}>{option.help}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Username" value={accountLoginUsername(draft)} placeholder="Usually your full email address" onChangeText={(username) => update({ username })} />
          <Field label={draft.authKind === "basic" ? "Password" : "API token"} value={draft.secret ?? ""} placeholder="Required for connectivity check" secure onChangeText={(secret) => update({ secret })} />
          <Text style={credentialStatusStyle(credentialStatus)}>{credentialStatusText(credentialStatus, verifiedSession)}</Text>
        </View>
      ) : null}

      {step === "review" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Confirm account</Text>
          <Text style={styles.flowCopy}>Connectivity and credentials are already verified. Confirm to add this account to your folder pane.</Text>
          <ReviewRow label="Name" value={draft.displayName || "Missing"} />
          <ReviewRow label="Email" value={draft.email || "Missing"} />
          <ReviewRow label="Username" value={accountLoginUsername(draft) || "Missing"} />
          <ReviewRow label="Server" value={verifiedSessionUrl ?? draft.sessionUrl?.trim() ?? detectedSessionUrls[0] ?? "Automatic setup"} />
          <ReviewRow label="Auth" value={draft.authKind === "basic" ? "Basic" : "API token"} />
          {verifiedSession === undefined ? null : <Text style={styles.successText}>Connected as {verifiedSession.username}. Mail capability found.</Text>}
        </View>
      ) : null}

      {error === undefined ? null : <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.flowButtons}>
        {step === "identity" ? null : <SecondaryButton label="Back" onPress={back} />}
        {step === "review" ? (
          <PrimaryButton label="Add account" disabled={verifiedSession === undefined} onPress={addVerifiedAccount} />
        ) : (
          <PrimaryButton label="Continue" loading={navigationBusy} disabled={navigationBusy} onPress={() => { void next() }} />
        )}
      </View>
    </View>
  )
}

function Field({ label, value, placeholder, secure, onChangeText }: {
  readonly label: string
  readonly value: string
  readonly placeholder: string
  readonly secure?: boolean
  readonly onChangeText: (value: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor="#718096" secureTextEntry={secure} onChangeText={onChangeText} autoCapitalize="none" style={styles.input} />
    </View>
  )
}

function SetupStepper({ step }: { readonly step: SetupStep }) {
  const steps: readonly SetupStep[] = ["identity", "server", "auth", "review"]
  return (
    <View style={styles.stepper}>
      {steps.map((item, index) => (
        <View key={item} style={[styles.stepPill, step === item && styles.stepPillActive]}>
          <Text style={[styles.stepText, step === item && styles.stepTextActive]}>{index + 1}. {stepLabel(item)}</Text>
        </View>
      ))}
    </View>
  )
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  )
}

function AccountSummary({ account }: { readonly account: ConfiguredAccount }) {
  return (
    <View style={styles.accountSummary}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{account.email.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.accountSummaryText}>
        <Text style={styles.accountName}>{account.email}</Text>
        <Text style={styles.accountMeta}>{configuredAccountServerLabel(account)}</Text>
      </View>
      <Text style={styles.statusPill}>{account.status}</Text>
    </View>
  )
}

function FolderButton({ label, count, level = 0, badges = [], active, onPress }: { readonly label: string; readonly count?: number | undefined; readonly level?: number | undefined; readonly badges?: readonly string[] | undefined; readonly active: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.clickable, styles.folderButton, level > 0 && { paddingLeft: 6 + level * 12 }, active && styles.folderButtonActive]}>
      <View style={styles.folderLabelGroup}>
        <Text numberOfLines={1} style={[styles.folderButtonText, active && styles.folderButtonTextActive]}>{label}</Text>
        {badges.length === 0 ? null : <Text numberOfLines={1} style={[styles.folderBadgeText, active && styles.folderButtonTextActive]}>{badges.join(" · ")}</Text>}
      </View>
      {count === undefined ? null : <Text style={[styles.folderCount, active && styles.folderButtonTextActive]}>{count}</Text>}
    </Pressable>
  )
}

function ToolbarButton({ icon, label, active, onPress }: { readonly icon: MaterialIconName; readonly label: string; readonly active?: boolean; readonly onPress: () => void }) {
  const color = active === true ? "#0b4f9c" : "#25364d"
  return (
    <Pressable onPress={onPress} style={[styles.clickable, styles.toolbarButton, active && styles.toolbarButtonActive]}>
      <MaterialActionIcon name={icon} size={14} color={color} />
      <Text style={[styles.toolbarButtonText, active && styles.toolbarButtonTextActive]}>{label}</Text>
    </Pressable>
  )
}

function ToolbarIconButton({ icon, accessibilityLabel, onPress }: { readonly icon: MaterialIconName; readonly accessibilityLabel: string; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={[styles.clickable, styles.toolbarIconButton]}>
      <MaterialActionIcon name={icon} size={18} color="#25364d" />
    </Pressable>
  )
}

function PrimaryButton({ label, loading, disabled, onPress }: { readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.primaryButton, disabled && styles.buttonDisabled]}>
      {loading === true ? <Spinner color="#ffffff" /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({ label, loading, disabled, onPress }: { readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.secondaryButton, disabled && styles.buttonDisabled]}>
      {loading === true ? <Spinner /> : null}
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function nextSetupStep(step: SetupStep): SetupStep {
  if (step === "identity") return "server"
  if (step === "server") return "auth"
  return "review"
}

function previousSetupStep(step: SetupStep): SetupStep {
  if (step === "review") return "auth"
  if (step === "auth") return "server"
  return "identity"
}

function stepLabel(step: SetupStep): string {
  if (step === "identity") return "Identity"
  if (step === "server") return "Server"
  if (step === "auth") return "Sign in"
  return "Verify"
}

function setupStepError(
  step: SetupStep,
  draft: AccountSetupDraft,
  serverStatus: "idle" | "checking" | "srv" | "fallback" | "error",
): string | undefined {
  if (step === "identity") {
    if (draft.displayName.trim().length === 0) return "Enter your name before continuing."
    if (!isLikelyEmail(draft.email)) return "Enter a valid email address before continuing."
  }
  if (step === "server") {
    if (serverStatus === "checking") return "Server check is still running."
    if (serverStatus === "error") return "Use an HTTPS server address or leave it blank."
    if (serverStatus === "idle") return "Enter a valid email address first."
  }
  return undefined
}

function authStepError(draft: AccountSetupDraft): string | undefined {
  if (accountLoginUsername(draft).length === 0) return "Enter your username before continuing."
  const secret = draft.secret?.trim()
  if (secret === undefined || secret.length === 0) return draft.authKind === "basic" ? "Enter your password before continuing." : "Enter your API token before continuing."
  return undefined
}

async function verifyCredentials(draft: AccountSetupDraft): Promise<{ readonly session: JmapSession; readonly sessionUrl: string }> {
  const auth = authFromDraft(draft)
  const manual = manualSessionUrl(draft)
  const result = await discoverJmapSessionWithUrl({
    email: draft.email,
    ...(manual === undefined ? {} : { sessionUrl: manual }),
    auth,
    transport: new FetchJmapTransport({ auth, fetchImpl: jmapFetch }),
    ...(manual === undefined ? { resolveSrv: resolveJmapSrvFresh } : {}),
  })
  const discovered = result.session
  if (discovered.capabilities[CAP_MAIL] === undefined) {
    throw new Error("Server signed in, but mail is not available.")
  }
  return { session: discovered, sessionUrl: result.sessionUrl }
}

async function validateServerEndpoint(draft: AccountSetupDraft): Promise<string> {
  const sessionUrl = manualSessionUrl(draft)
  if (sessionUrl === undefined) throw new Error("Enter a server address first.")
  if (!isHttpsUrl(sessionUrl)) throw new Error("Use an HTTPS server address.")

  const response = await jmapFetch(sessionUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "follow",
  })

  if (response.status === 401 || response.status === 403) return sessionUrl
  if (!response.ok) throw new Error(`Server address returned HTTP ${response.status}.`)

  const body = await response.json() as unknown
  let session: JmapSession
  try {
    session = parseJmapSession(body)
  } catch {
    throw new Error("Server address did not return a valid mail setup response.")
  }
  if (session.capabilities[CAP_MAIL] === undefined) throw new Error("Server is reachable, but mail is not available.")
  return sessionUrl
}

function authFromDraft(draft: AccountSetupDraft): AuthProvider {
  const secret = draft.secret?.trim()
  if (secret === undefined || secret.length === 0) throw new Error("A token or password is required before checking connectivity.")
  const username = accountLoginUsername(draft)
  if (username.length === 0) throw new Error("A username is required before checking connectivity.")
  if (draft.authKind === "basic") return { kind: "basic", username, password: secret, warnUser: true }
  if (draft.authKind === "bearer") return { kind: "bearer", token: secret, username }
  throw new Error("This authentication flow is not implemented yet.")
}

async function jmapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const bridgeResponse = await tauriBridgeFetch(input, init)
  return bridgeResponse ?? fetch(input, init)
}

interface TauriBridgeHttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
  readonly bodyBase64?: string
}

async function tauriBridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
  if (!isTauriRuntime()) return undefined
  const response = await invoke<TauriBridgeHttpResponse>("jmap_http", {
    req: {
      url: requestUrl(input),
      method: init?.method ?? "GET",
      headers: headersToRecord(init?.headers),
      body: await requestBodyText(init?.body),
    },
  })
  const body = response.bodyBase64 === undefined ? response.body : bufferSource(base64ToBytes(response.bodyBase64))
  return new Response(body, { status: response.status, headers: response.headers })
}

function isTauriRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & { readonly __TAURI_INTERNALS__?: unknown; readonly __TAURI__?: unknown }
  return runtime.__TAURI_INTERNALS__ !== undefined || runtime.__TAURI__ !== undefined
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  if (headers === undefined) return record
  if (headers instanceof Headers) {
    headers.forEach((value, name) => { record[name] = value })
    return record
  }
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) record[name] = value
    return record
  }
  return { ...headers }
}

async function requestBodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === undefined || body === null) return undefined
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  throw new Error("Desktop bridge only supports text request bodies.")
}

function manualSessionUrl(draft: AccountSetupDraft): string | undefined {
  const manual = draft.sessionUrl?.trim()
  return manual === undefined || manual.length === 0 ? undefined : manual
}

function domainFromEmailAddress(email: string): string | undefined {
  if (!isLikelyEmail(email)) return undefined
  return email.trim().toLowerCase().split("@").at(1)
}

function wellKnownSessionUrl(domain: string): string {
  return `https://${domain}/.well-known/jmap`
}

async function resolveJmapSrvFresh(service: "_jmap._tcp", domain: string): Promise<SrvRecord[]> {
  return resolveJmapSrvOverHttps(service, domain, { bypassCache: true })
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

function credentialStatusText(status: "idle" | "checking" | "ok" | "error", session: JmapSession | undefined): string {
  if (status === "checking") return "Checking credentials and server..."
  if (status === "ok") return `Credentials verified${session === undefined ? "." : ` for ${session.username}.`}`
  if (status === "error") return "Credential check failed."
  return "Click Continue to check credentials."
}

function credentialStatusStyle(status: "idle" | "checking" | "ok" | "error") {
  if (status === "ok") return styles.statusOk
  if (status === "error") return styles.statusError
  return styles.statusNeutral
}

function serverEndpointErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach this server address."
  return error instanceof Error ? error.message : "Server check failed."
}

function credentialErrorMessage(error: unknown): string {
  const cause = errorCause(error)
  if (cause instanceof JmapTransportError && (cause.status === 401 || cause.status === 403)) {
    return "Username or secret was rejected."
  }
  if (error instanceof JmapTransportError && (error.status === 401 || error.status === 403)) {
    return "Username or secret was rejected."
  }
  if (cause instanceof TypeError) return connectivityErrorMessage(cause)
  if (error instanceof JmapDiscoveryError) return "Could not sign in at the configured server."
  return connectivityErrorMessage(error)
}

function connectivityErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not reach the server. If browser setup keeps failing, try the desktop app."
  }
  return error instanceof Error ? error.message : "Connectivity check failed."
}

function errorCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? (error as { readonly cause?: unknown }).cause : undefined
}

function folderTitle(accounts: readonly ConfiguredAccount[], mailByAccount: Record<string, AccountMailState>, folderId: string): string {
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
  const folderLabel = ACCOUNT_FOLDERS.find((item) => item.id === roleFolder?.role)?.label ?? "Folder"
  return roleFolder === undefined ? folderLabel : `${roleFolder.account.email} - ${folderLabel}`
}

function loadAccounts(): ConfiguredAccount[] {
  try {
    return parseConfiguredAccounts(globalThis.localStorage?.getItem(ACCOUNTS_STORAGE_KEY))
  } catch {
    return []
  }
}

function saveAccounts(accounts: readonly ConfiguredAccount[]): void {
  try {
    globalThis.localStorage?.setItem(ACCOUNTS_STORAGE_KEY, serializeConfiguredAccounts(accounts))
  } catch {
    // Native vault/store wiring will replace browser storage.
  }
}

function loadMailCache(): Record<string, AccountMailState> {
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

function saveMailCache(mailByAccount: Record<string, AccountMailState>): void {
  try {
    const cache = Object.fromEntries(Object.entries(mailByAccount).flatMap(([accountId, state]) => {
      if (state.mailboxes.length === 0 && state.messages.length === 0) return []
      return [[accountId, {
        status: "ready",
        mailboxes: state.mailboxes,
        messages: state.messages.map(stripMessageContent),
        ...(state.syncedAt === undefined ? {} : { syncedAt: state.syncedAt }),
      } satisfies AccountMailState]]
    }))
    globalThis.localStorage?.setItem(MAIL_CACHE_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Durable SQLite cache replaces localStorage later.
  }
}

function pruneMailCache(mailByAccount: Record<string, AccountMailState>, accounts: readonly ConfiguredAccount[]): Record<string, AccountMailState> {
  const accountIds = new Set(accounts.map((account) => account.id))
  return Object.fromEntries(Object.entries(mailByAccount).filter(([accountId]) => accountIds.has(accountId)))
}

function parseCachedMailState(value: unknown): AccountMailState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const input = value as Partial<AccountMailState>
  const mailboxes = Array.isArray(input.mailboxes) ? input.mailboxes.filter(isMailboxSummary) : []
  const messages = Array.isArray(input.messages) ? input.messages.flatMap(parseCachedMailMessage).map(stripMessageContent) : []
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
  const normalized = { ...input, attachments, flagState }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

const styles = StyleSheet.create({
  clickable: { cursor: "pointer" } as unknown as ViewStyle,
  shell: { flex: 1, backgroundColor: "#f2f4f8" },
  toolbar: { minHeight: 58, backgroundColor: "#f8fbff", borderBottomColor: "#c8d3df", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  toolbarMobile: { alignItems: "stretch", flexDirection: "column", gap: 6, minHeight: 0, paddingHorizontal: 10, paddingVertical: 8 },
  toolbarTitleRow: { alignItems: "center", flexDirection: "row", gap: 8, minWidth: 0 },
  toolbarTitle: { color: "#1d2d44", fontSize: 19, fontWeight: "800" },
  toolbarTitleMobile: { flex: 1, fontSize: 17, minWidth: 0 },
  toolbarActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  toolbarActionsScroller: { width: "100%" },
  toolbarActionsMobile: { flexDirection: "row", flexWrap: "nowrap", gap: 8, justifyContent: "flex-start", paddingRight: 10 },
  toolbarButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#c5d2e0", borderWidth: 1, flexDirection: "row", flexShrink: 0, gap: 4, justifyContent: "center", paddingHorizontal: 8, paddingVertical: 5 },
  toolbarButtonActive: { backgroundColor: "#dbeafe", borderColor: "#7aa7e8" },
  toolbarButtonText: { color: "#25364d", fontSize: 11, fontWeight: "700", lineHeight: 14, textAlign: "center" },
  toolbarButtonTextActive: { color: "#0b4f9c" },
  toolbarIconButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#c5d2e0", borderWidth: 1, flexShrink: 0, height: 30, justifyContent: "center", width: 30 },
  notice: { backgroundColor: "#e7f3ff", borderBottomColor: "#b6d7f4", borderBottomWidth: 1, color: "#174d7c", paddingHorizontal: 14, paddingVertical: 8 },
  vaultUnlock: { alignItems: "center", backgroundColor: "#fff7ed", borderBottomColor: "#fed7aa", borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  vaultUnlockText: { color: "#7c2d12", fontWeight: "800" },
  vaultUnlockInput: { backgroundColor: "#ffffff", borderColor: "#fdba74", borderWidth: 1, color: "#111827", minWidth: 220, paddingHorizontal: 10, paddingVertical: 8 },
  vaultUnlockError: { color: "#9f1239", fontWeight: "800" },
  workspace: { flex: 1, flexDirection: "row", minHeight: 0 },
  folderPaneFallback: { backgroundColor: "#eef3f9", flexBasis: DEFAULT_FOLDER_PANE_WIDTH, flexGrow: 0, flexShrink: 0, maxWidth: MAX_FOLDER_PANE_WIDTH, minWidth: MIN_FOLDER_PANE_WIDTH, overflow: "hidden", width: DEFAULT_FOLDER_PANE_WIDTH },
  folderPaneScroll: { flex: 1, minWidth: 0 },
  folderDrawerBackdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 900 },
  folderDrawerScrim: { backgroundColor: "rgba(15, 23, 42, 0.34)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 } as unknown as ViewStyle,
  folderDrawerPanel: { backgroundColor: "#eef3f9", borderRightColor: "#c8d3df", borderRightWidth: 1, bottom: 0, left: 0, maxWidth: 360, position: "absolute", top: 0, width: "86%" } as unknown as ViewStyle,
  folderDrawerHeader: { alignItems: "center", borderBottomColor: "#c8d3df", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  dragDivider: { backgroundColor: "#c8d3df", flexShrink: 0, width: DIVIDER_WIDTH },
  folderPaneContent: { padding: 8, gap: 3 },
  paneHeader: { color: "#344963", fontSize: 13, fontWeight: "800", marginBottom: 8, textTransform: "uppercase" },
  sectionHeader: { color: "#64748b", fontSize: 12, fontWeight: "800", marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  folderButton: { flexDirection: "row", gap: 6, justifyContent: "space-between", paddingHorizontal: 6, paddingVertical: 5 },
  folderButtonActive: { backgroundColor: "#cfe5ff" },
  folderLabelGroup: { flex: 1, minWidth: 0 },
  folderButtonText: { color: "#24364e", flex: 1, fontSize: 14, fontWeight: "600", minWidth: 0 },
  folderButtonTextActive: { color: "#074a91" },
  folderBadgeText: { color: "#64748b", fontSize: 10, fontWeight: "800", marginTop: 2, textTransform: "uppercase" },
  folderCount: { color: "#64748b", flexShrink: 0, fontWeight: "800" },
  accountTree: { marginTop: 8 },
  accountTreeHeader: { paddingHorizontal: 8, paddingVertical: 7 },
  accountTreeName: { color: "#1f2f45", fontWeight: "800" },
  accountTreeServer: { color: "#64748b", fontSize: 12, marginTop: 2 },
  accountTreeStatus: { color: "#64748b", fontSize: 11, marginTop: 3 },
  accountTreeError: { color: "#9f1239", fontSize: 11, fontWeight: "800", marginTop: 3 },
  mailWorkspace: { flex: 1, flexDirection: "row", minWidth: 0 },
  mailWorkspaceMobile: { flex: 1, flexDirection: "column", minWidth: 0 },
  threadPaneFallback: { backgroundColor: "#ffffff", flexBasis: "50%", flexGrow: 0, flexShrink: 0, minWidth: MIN_MESSAGE_PANE_WIDTH, overflow: "hidden", width: "50%" },
  threadPaneMobile: { backgroundColor: "#ffffff", flex: 1, minWidth: 0 },
  threadHeader: { borderBottomColor: "#d5dde7", borderBottomWidth: 1, padding: 14 },
  threadTitle: { color: "#172033", fontSize: 20, fontWeight: "800" },
  threadSubtle: { color: "#64748b", marginTop: 5 },
  statusInline: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 5 },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 },
  searchRowMobile: { alignItems: "stretch", flexWrap: "wrap" },
  searchInput: { backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, color: "#111827", flex: 1, fontSize: 14, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8 },
  messageList: { flex: 1, backgroundColor: "#ffffff" },
  messageRow: { borderBottomColor: "#e2e8f0", borderBottomWidth: 1, gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  messageRowFlagged: { backgroundColor: "#fffbeb" },
  messageRowDone: { backgroundColor: "#f0fdf4" },
  messageRowActive: { backgroundColor: "#dbeafe" },
  messageRowTop: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  messageSender: { color: "#172033", flex: 1, fontWeight: "800", minWidth: 0 },
  messageRowActions: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 6 },
  messageDate: { color: "#64748b", flexShrink: 0, fontSize: 11 },
  flagButton: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  flagButtonActive: { backgroundColor: "#fff7ed" },
  messageSubject: { color: "#24364e", fontWeight: "800" },
  messageMetaText: { color: "#64748b", fontSize: 12 },
  messagePreviewText: { color: "#64748b", lineHeight: 18 },
  attachmentText: { color: "#0b4f9c", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  attachmentList: { backgroundColor: "#f8fbff", borderColor: "#d8e2ee", borderWidth: 1, gap: 8, marginTop: 10, padding: 8 },
  attachmentListHeader: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  attachmentListTitle: { color: "#24364e", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  attachmentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  attachmentItem: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#cbd7e3", borderWidth: 1, flexBasis: 210, flexDirection: "row", flexGrow: 1, gap: 8, justifyContent: "space-between", minWidth: 0, paddingHorizontal: 7, paddingVertical: 5 },
  attachmentFileText: { flex: 1, minWidth: 0 },
  attachmentName: { color: "#172033", fontSize: 13, fontWeight: "800" },
  attachmentMeta: { color: "#64748b", fontSize: 11, marginTop: 2 },
  attachmentActions: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 5 },
  attachmentLoadingText: { color: "#64748b", fontSize: 11, fontWeight: "800" },
  modalBackdrop: { alignItems: "stretch", backgroundColor: "rgba(15, 23, 42, 0.58)", bottom: 0, justifyContent: "stretch", left: 0, padding: 0, position: "fixed", right: 0, top: 0, zIndex: 1000 } as unknown as ViewStyle,
  modalScrim: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 } as unknown as ViewStyle,
  attachmentModal: { backgroundColor: "#ffffff", bottom: 0, left: 0, overflow: "hidden", position: "fixed", right: 0, top: 0, zIndex: 1001 } as unknown as ViewStyle,
  attachmentPreviewHeader: { alignItems: "center", borderBottomColor: "#e2e8f0", borderBottomWidth: 1, flexDirection: "row", gap: 8, justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8 },
  attachmentPreviewTitle: { color: "#172033", flex: 1, fontWeight: "800", minWidth: 0 },
  attachmentPreviewBody: { alignItems: "center", backgroundColor: "#f8fafc", flex: 1, justifyContent: "center", minHeight: 0, padding: 10 },
  iconButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  tinyButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 6, paddingVertical: 3 },
  tinyButtonText: { color: "#24364e", fontSize: 10, fontWeight: "800" },
  loadMoreArea: { alignItems: "center", borderTopColor: "#e2e8f0", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 14 },
  emptyThreads: { padding: 22 },
  emptyTitle: { color: "#1f2f45", fontSize: 18, fontWeight: "800" },
  emptyCopy: { color: "#64748b", lineHeight: 22, marginTop: 8 },
  readerPane: { backgroundColor: "#fbfcfe", flex: 1, minWidth: MIN_MESSAGE_PANE_WIDTH, padding: 28 },
  readerPaneMobile: { minWidth: 0, overflow: "hidden", padding: 14 },
  readerContent: { paddingBottom: 40 },
  readerTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  readerTitleRowMobile: { flexWrap: "nowrap" },
  readerTitle: { color: "#172033", flex: 1, fontSize: 24, fontWeight: "800", minWidth: 0 },
  readerTitleMobile: { flexBasis: 0, overflowWrap: "anywhere", wordBreak: "break-word" } as unknown as ViewStyle,
  readerMeta: { color: "#64748b", marginTop: 8 },
  readerBody: { color: "#172033", fontSize: 15, lineHeight: 23, marginTop: 24, maxWidth: "100%", overflowX: "auto", whiteSpace: "pre-wrap" } as unknown as ViewStyle,
  readerLoading: { alignItems: "flex-start", marginTop: 24 },
  htmlPreviewBlock: { marginTop: 24, maxWidth: "100%", overflowX: "auto", overflowY: "visible" } as unknown as ViewStyle,
  inlineContentNotice: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", borderWidth: 1, gap: 10, marginBottom: 12, padding: 12 },
  inlineContentText: { color: "#1e3a8a", fontWeight: "800", lineHeight: 20 },
  remoteContentNotice: { backgroundColor: "#fff7ed", borderColor: "#fed7aa", borderWidth: 1, gap: 10, marginBottom: 12, padding: 12 },
  remoteContentText: { color: "#7c2d12", fontWeight: "800", lineHeight: 20 },
  readerCopy: { color: "#4b5f77", lineHeight: 24, marginTop: 12, maxWidth: 720 },
  settingsPane: { flex: 1, backgroundColor: "#f7f9fc" },
  settingsContent: { padding: 22, gap: 18 },
  settingsTitle: { color: "#172033", fontSize: 28, fontWeight: "800" },
  settingsCopy: { color: "#4b5f77", lineHeight: 23, maxWidth: 860 },
  settingsColumns: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  settingsCard: { backgroundColor: "#ffffff", borderColor: "#d5dde7", borderWidth: 1, flexBasis: 430, flexGrow: 1, padding: 18 },
  cardTitle: { color: "#172033", fontSize: 19, fontWeight: "800", marginBottom: 14 },
  firstRunScroll: { flex: 1, backgroundColor: "#eaf1f8" },
  firstRunShell: { flex: 1, backgroundColor: "#eaf1f8", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 32, padding: 28 },
  firstRunShellMobile: { alignItems: "stretch", flexDirection: "column", flexGrow: 1, gap: 18, justifyContent: "flex-start", padding: 16 },
  firstRunBrand: { maxWidth: 520 },
  firstRunBrandMobile: { width: "100%" },
  brandMark: { color: "#0b63ce", fontSize: 22, fontWeight: "900", marginBottom: 18 },
  brandTitle: { color: "#132238", fontSize: 42, fontWeight: "900", lineHeight: 48, marginBottom: 18 },
  brandTitleMobile: { fontSize: 30, lineHeight: 35, marginBottom: 12 },
  brandCopy: { color: "#40566f", fontSize: 17, lineHeight: 27 },
  brandCopyMobile: { fontSize: 15, lineHeight: 23 },
  setupFlow: { backgroundColor: "#ffffff", borderColor: "#cbd7e3", borderWidth: 1, maxWidth: 620, padding: 18, width: "100%", gap: 16 },
  stepper: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepPill: { backgroundColor: "#edf2f7", paddingHorizontal: 8, paddingVertical: 4 },
  stepPillActive: { backgroundColor: "#0b63ce" },
  stepText: { color: "#53677f", fontSize: 12, fontWeight: "800" },
  stepTextActive: { color: "#ffffff" },
  formBlock: { gap: 13 },
  flowTitle: { color: "#172033", fontSize: 21, fontWeight: "800" },
  flowCopy: { color: "#4b5f77", lineHeight: 22 },
  statusNeutral: { color: "#4b5f77", fontWeight: "700" },
  statusOk: { color: "#17693a", fontWeight: "800" },
  statusError: { color: "#9f1239", fontWeight: "800" },
  field: { gap: 6 },
  fieldLabel: { color: "#24364e", fontWeight: "800" },
  input: { backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, color: "#111827", fontSize: 16, paddingHorizontal: 11, paddingVertical: 10 },
  authOptions: { gap: 10 },
  authOption: { borderColor: "#cbd7e3", borderWidth: 1, padding: 9 },
  authOptionActive: { backgroundColor: "#e7f1ff", borderColor: "#7aa7e8" },
  authOptionText: { color: "#172033", fontWeight: "800" },
  authOptionTextActive: { color: "#0b4f9c" },
  authOptionHelp: { color: "#64748b", marginTop: 5 },
  authOptionHelpActive: { color: "#255f9f" },
  reviewRow: { borderTopColor: "#e2e8f0", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9 },
  reviewLabel: { color: "#64748b", fontWeight: "800" },
  reviewValue: { color: "#172033", flex: 1, textAlign: "right" },
  successText: { color: "#17693a", fontWeight: "800" },
  errorText: { backgroundColor: "#fff1f2", borderColor: "#fecdd3", borderWidth: 1, color: "#9f1239", padding: 10 },
  flowButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  primaryButton: { alignItems: "center", backgroundColor: "#0b63ce", flexDirection: "row", gap: 5, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 6 },
  buttonDisabled: { cursor: "default", opacity: 0.55 } as unknown as ViewStyle,
  primaryButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  secondaryButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 6 },
  secondaryButtonText: { color: "#24364e", fontSize: 12, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  manageAccountRow: { borderTopColor: "#e2e8f0", borderTopWidth: 1, gap: 10, paddingVertical: 12 },
  accountSummary: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: { alignItems: "center", backgroundColor: "#dbeafe", height: 38, justifyContent: "center", width: 38 },
  avatarText: { color: "#0b4f9c", fontWeight: "900" },
  accountSummaryText: { flex: 1 },
  accountName: { color: "#172033", fontWeight: "800" },
  accountMeta: { color: "#64748b", fontSize: 12, marginTop: 2 },
  statusPill: { backgroundColor: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
})
