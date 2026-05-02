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
  parseJmapSession,
  resolveJmapSrvOverHttps,
  type AuthProvider,
  type JmapSession,
  type JsonObject,
  type JmapResponse,
  type SrvRecord,
} from "@jmapfe/jmap-core"
import { invoke } from "@tauri-apps/api/core"
import { createElement, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native"

const ACCOUNTS_STORAGE_KEY = "jmapfe.accounts.v1"
const MAIL_CACHE_STORAGE_KEY = "jmapfe.mail-cache.v1"
const FALLBACK_VAULT_STORAGE_KEY = "jmapfe.vault.fallback.v1"
const FALLBACK_VAULT_SALT_BYTES = 16
const FALLBACK_VAULT_IV_BYTES = 12
const FALLBACK_VAULT_KDF_ITERATIONS = 250_000
const DEFAULT_FOLDER_PANE_WIDTH = 168
const MIN_FOLDER_PANE_WIDTH = 120
const MAX_FOLDER_PANE_WIDTH = 280
const MIN_MESSAGE_PANE_WIDTH = 220
const DIVIDER_WIDTH = 7
const EMAIL_PAGE_SIZE = 50
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

type AppView = "mail" | "settings"
type SetupStep = "identity" | "server" | "auth" | "review"
type SyncStatus = "idle" | "syncing" | "ready" | "error"

const MAILBOX_ROLES = ["inbox", "sent", "drafts", "archive", "trash"] as const
const EMAIL_PREVIEW_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "receivedAt",
  "sentAt",
  "subject",
  "preview",
  "from",
  "to",
  "cc",
  "bcc",
  "hasAttachment",
  "bodyValues",
  "textBody",
  "htmlBody",
] as const

interface FolderNode {
  readonly id: string
  readonly label: string
  readonly count?: number
}

interface MailboxSummary {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly parentId?: string
  readonly sortOrder?: number
  readonly totalEmails?: number
  readonly unreadEmails?: number
}

interface MailMessage {
  readonly id: string
  readonly key: string
  readonly accountId: string
  readonly accountName: string
  readonly mailboxIds: readonly string[]
  readonly subject: string
  readonly from: string
  readonly to: readonly string[]
  readonly receivedAt?: string
  readonly sentAt?: string
  readonly preview: string
  readonly bodyText: string
  readonly hasAttachment: boolean
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
  readonly loadedCount: number
  readonly totalEmails?: number
}

interface LoadedMessageBatch {
  readonly accountId: string
  readonly messages: readonly MailMessage[]
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

const AUTH_OPTIONS: readonly { readonly value: AccountAuthKind; readonly label: string; readonly help: string }[] = [
  { value: "bearer", label: "API token", help: "Best for providers such as Fastmail app passwords or API tokens." },
  { value: "basic", label: "Password", help: "Only use when the server requires Basic Auth." },
]

export default function App() {
  const [accounts, setAccounts] = useState<ConfiguredAccount[]>(() => loadAccounts())
  const [view, setView] = useState<AppView>("mail")
  const [selectedFolder, setSelectedFolder] = useState("unified:inbox")
  const [selectedMessageKey, setSelectedMessageKey] = useState<string | undefined>()
  const [accountAuth, setAccountAuth] = useState<Record<string, AuthProvider>>({})
  const [mailByAccount, setMailByAccount] = useState<Record<string, AccountMailState>>(() => loadMailCache())
  const [loadingMoreFolder, setLoadingMoreFolder] = useState<string | undefined>()
  const [vaultMode, setVaultMode] = useState<"checking" | "os" | "locked" | "fallback">("checking")
  const [masterPassword, setMasterPassword] = useState("")
  const [vaultError, setVaultError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => saveAccounts(accounts), [accounts])
  useEffect(() => saveMailCache(mailByAccount), [mailByAccount])
  useEffect(() => {
    setMailByAccount((current) => pruneMailCache(current, accounts))
  }, [accounts])
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
      const mail = await fetchAccountMail(account, auth)
      setMailByAccount((current) => ({ ...current, [account.id]: mail }))
      setSelectedMessageKey((current) => current ?? mail.messages[0]?.key)
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
      const batches = await Promise.all(targets.map(async (target) => {
        const auth = accountAuth[target.account.id]
        if (auth === undefined) throw new Error("Sign in again to fetch more messages.")
        return {
          accountId: target.account.id,
          messages: await fetchMoreMailboxMessages(target.account, auth, target.mailboxId, target.loadedCount, mailByAccount[target.account.id]?.messages ?? []),
        } satisfies LoadedMessageBatch
      }))
      setMailByAccount((current) => mergeLoadedMessageBatches(current, batches))
    } catch (error) {
      setNotice(connectivityErrorMessage(error))
    } finally {
      setLoadingMoreFolder((current) => current === folderId ? undefined : current)
    }
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

  if (accounts.length === 0) return <FirstRunSetup onAccountVerified={addFirstAccount} />

  return (
    <View style={styles.shell}>
      <Toolbar view={view} onOpenMail={() => setView("mail")} onGetMessages={syncAllMail} onOpenSettings={() => setView("settings")} />
      {notice === undefined ? null : <Text style={styles.notice}>{notice}</Text>}
      {vaultMode === "locked" ? <VaultUnlock masterPassword={masterPassword} error={vaultError} onChange={setMasterPassword} onUnlock={() => { void unlockFallbackVault() }} /> : null}
      <View style={styles.workspace}>
        <FolderPane accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} onSelectFolder={(folderId) => { setSelectedFolder(folderId); setView("mail") }} />
        <PaneDivider minWidth={MIN_FOLDER_PANE_WIDTH} maxWidth={MAX_FOLDER_PANE_WIDTH} minTrailingWidth={view === "mail" ? MIN_MESSAGE_PANE_WIDTH * 2 + DIVIDER_WIDTH : MIN_MESSAGE_PANE_WIDTH} />
        {view === "settings" ? (
          <Settings accounts={accounts} onAccountVerified={addSettingsAccount} onDeleteAccount={deleteAccount} />
        ) : (
          <MailWorkspace accounts={accounts} selectedFolder={selectedFolder} mailByAccount={mailByAccount} selectedMessageKey={selectedMessageKey} loadingMoreFolder={loadingMoreFolder} onSelectMessage={setSelectedMessageKey} onLoadMoreFolder={(folderId) => { void loadMoreFolder(folderId) }} />
        )}
      </View>
    </View>
  )
}

function FirstRunSetup({ onAccountVerified }: { readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void }) {
  return (
    <View style={styles.firstRunShell}>
      <View style={styles.firstRunBrand}>
        <Text style={styles.brandMark}>jmapfe</Text>
        <Text style={styles.brandTitle}>Set up your mail account</Text>
        <Text style={styles.brandCopy}>
          This works like Thunderbird: enter your identity, let the app find your mail server, then verify credentials before
          anything is added locally.
        </Text>
      </View>
      <AccountSetupFlow mode="first-run" onAccountVerified={onAccountVerified} />
    </View>
  )
}

function Toolbar({ view, onOpenMail, onGetMessages, onOpenSettings }: {
  readonly view: AppView
  readonly onOpenMail: () => void
  readonly onGetMessages: () => void
  readonly onOpenSettings: () => void
}) {
  return (
    <View style={styles.toolbar}>
      <Text style={styles.toolbarTitle}>jmapfe Mail</Text>
      <View style={styles.toolbarActions}>
        <ToolbarButton label="Get Messages" onPress={onGetMessages} active={view === "mail"} />
        <ToolbarButton label="Write" onPress={onOpenMail} />
        <ToolbarButton label="Address Book" onPress={onOpenMail} />
        <ToolbarButton label="Settings" onPress={onOpenSettings} active={view === "settings"} />
      </View>
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
      <ScrollView style={styles.folderPaneScroll} contentContainerStyle={styles.folderPaneContent}>
        <Text style={styles.paneHeader}>Folders</Text>
        <FolderButton label="Unified Inbox" count={countMessagesForFolder(accounts, mailByAccount, "unified:inbox")} active={selectedFolder === "unified:inbox"} onPress={() => onSelectFolder("unified:inbox")} />
        <FolderButton label="All Sent" count={countMessagesForFolder(accounts, mailByAccount, "unified:sent")} active={selectedFolder === "unified:sent"} onPress={() => onSelectFolder("unified:sent")} />
        <FolderButton label="All Drafts" count={countMessagesForFolder(accounts, mailByAccount, "unified:drafts")} active={selectedFolder === "unified:drafts"} onPress={() => onSelectFolder("unified:drafts")} />

        <Text style={styles.sectionHeader}>Accounts</Text>
        {accounts.map((account) => (
          <View key={account.id} style={styles.accountTree}>
            <View style={styles.accountTreeHeader}>
              <Text numberOfLines={1} style={styles.accountTreeName}>{account.displayName}</Text>
              <Text numberOfLines={1} style={styles.accountTreeServer}>{account.serverKey}</Text>
              <Text numberOfLines={1} style={accountFolderStatusStyle(mailByAccount[account.id])}>{accountFolderStatusText(mailByAccount[account.id])}</Text>
            </View>
            {accountFolders(account, mailByAccount[account.id]).map((folder) => {
              const id = folder.folderId
              return <FolderButton key={id} label={folder.label} count={folder.count} level={folder.level} active={selectedFolder === id} onPress={() => onSelectFolder(id)} />
            })}
          </View>
        ))}
      </ScrollView>
    </ResizablePane>
  )
}

function MailWorkspace({ accounts, selectedFolder, mailByAccount, selectedMessageKey, loadingMoreFolder, onSelectMessage, onLoadMoreFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedMessageKey: string | undefined
  readonly loadingMoreFolder: string | undefined
  readonly onSelectMessage: (key: string) => void
  readonly onLoadMoreFolder: (folderId: string) => void
}) {
  const title = folderTitle(accounts, mailByAccount, selectedFolder)
  const messages = messagesForFolder(accounts, mailByAccount, selectedFolder)
  const selectedMessage = messages.find((message) => message.key === selectedMessageKey)
  const syncMessage = mailStatusText(accounts, mailByAccount)
  const canLoadMore = canLoadMoreFolder(accounts, mailByAccount, selectedFolder)
  const loadingMore = loadingMoreFolder === selectedFolder
  return (
    <View style={styles.mailWorkspace}>
      <ResizablePane style={threadPaneResizeStyle} fallbackStyle={styles.threadPaneFallback}>
        <View style={styles.threadHeader}>
          <Text style={styles.threadTitle}>{title}</Text>
          <Text style={styles.threadSubtle}>{syncMessage}</Text>
        </View>
        {messages.length === 0
          ? <EmptyThreadList accounts={accounts} selectedFolder={selectedFolder} canLoadMore={canLoadMore} loadingMore={loadingMore} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />
          : <MessageList messages={messages} selectedMessageKey={selectedMessageKey} canLoadMore={canLoadMore} loadingMore={loadingMore} onSelectMessage={onSelectMessage} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />}
      </ResizablePane>
      <PaneDivider minWidth={MIN_MESSAGE_PANE_WIDTH} minTrailingWidth={MIN_MESSAGE_PANE_WIDTH} />
      <MessagePreview message={selectedMessage} />
    </View>
  )
}

function MessageList({ messages, selectedMessageKey, canLoadMore, loadingMore, onSelectMessage, onLoadMore }: {
  readonly messages: readonly MailMessage[]
  readonly selectedMessageKey: string | undefined
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onSelectMessage: (key: string) => void
  readonly onLoadMore: () => void
}) {
  return (
    <ScrollView style={styles.messageList}>
      {messages.map((message) => (
        <Pressable key={message.key} onPress={() => onSelectMessage(message.key)} style={[styles.messageRow, selectedMessageKey === message.key && styles.messageRowActive]}>
          <View style={styles.messageRowTop}>
            <Text numberOfLines={1} style={styles.messageSender}>{message.from || message.accountName}</Text>
            <Text style={styles.messageDate}>{formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.messageSubject}>{message.subject || "(no subject)"}</Text>
          <Text numberOfLines={2} style={styles.messagePreviewText}>{message.preview || message.bodyText}</Text>
          {message.hasAttachment ? <Text style={styles.attachmentText}>Attachment</Text> : null}
        </Pressable>
      ))}
      {canLoadMore ? <View style={styles.loadMoreArea}><SecondaryButton label={loadingMore ? "Loading..." : "Load more"} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
    </ScrollView>
  )
}

function MessagePreview({ message }: { readonly message: MailMessage | undefined }) {
  if (message === undefined) {
    return (
      <View style={styles.readerPane}>
        <Text style={styles.readerTitle}>No message selected</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.readerPane} contentContainerStyle={styles.readerContent}>
      <Text style={styles.readerTitle}>{message.subject || "(no subject)"}</Text>
      <Text style={styles.readerMeta}>From {message.from || "Unknown sender"}</Text>
      <Text style={styles.readerMeta}>To {message.to.length === 0 ? "Undisclosed recipients" : message.to.join(", ")}</Text>
      <Text style={styles.readerMeta}>{formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
      <Text style={styles.readerBody}>{message.bodyText || message.preview || "No preview text available."}</Text>
    </ScrollView>
  )
}

interface PaneFolder {
  readonly folderId: string
  readonly label: string
  readonly count?: number | undefined
  readonly level?: number | undefined
}

function accountFolders(account: ConfiguredAccount, mail: AccountMailState | undefined): PaneFolder[] {
  if (mail?.mailboxes.length) {
    return flattenMailboxTree(mail.mailboxes).map(({ mailbox, level }) => ({
        folderId: mailboxFolderId(account.id, mailbox.id),
        label: mailbox.name,
        count: mailbox.totalEmails ?? countMessagesInMailbox(mail.messages, mailbox.id),
        level,
      }))
  }

  return ACCOUNT_FOLDERS.map((folder) => ({
    folderId: `${account.id}:${folder.id}`,
    label: folder.label,
    count: mail === undefined ? undefined : countMessagesForRole(mail, folder.id),
    level: 0,
  }))
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
  const { client, mailAccountId } = await createMailClient(account, auth)
  const mailboxArgs = responseArgs(await client.call([CAP_MAIL], "Mailbox/get", { accountId: mailAccountId, ids: null }, "ui-mailbox-get"))
  const mailboxes = jsonObjectArray(mailboxArgs.list).flatMap(toMailboxSummary)
  const emailIds = unique(await queryEmailIds(client, mailAccountId, { limit: EMAIL_PAGE_SIZE }))
  if (emailIds.length === 0) {
    return { status: "ready", mailboxes, messages: [], syncedAt: new Date().toISOString() }
  }

  const messages = await fetchEmailMessages(client, account, mailAccountId, emailIds)
  return { status: "ready", mailboxes, messages, syncedAt: new Date().toISOString() }
}

async function fetchMoreMailboxMessages(account: ConfiguredAccount, auth: AuthProvider, mailboxId: string, loadedCount: number, existingMessages: readonly MailMessage[]): Promise<MailMessage[]> {
  const { client, mailAccountId } = await createMailClient(account, auth)
  const emailIds = unique(await queryEmailIds(client, mailAccountId, { mailboxId, limit: loadedCount + EMAIL_PAGE_SIZE }))
  const existingIds = new Set(existingMessages.filter((message) => message.mailboxIds.includes(mailboxId)).map((message) => message.id))
  const missingIds = emailIds.filter((id) => !existingIds.has(id))
  return missingIds.length === 0 ? [] : fetchEmailMessages(client, account, mailAccountId, missingIds)
}

async function createMailClient(account: ConfiguredAccount, auth: AuthProvider): Promise<{ readonly client: JmapClient; readonly mailAccountId: string }> {
  const sessionUrl = accountSessionUrl(account)
  const sessionTransport = new FetchJmapTransport({ auth, fetchImpl: jmapFetch })
  const sessionResult = await discoverJmapSessionWithUrl({
    email: account.email,
    ...(sessionUrl === undefined ? { resolveSrv: resolveJmapSrvFresh } : { sessionUrl }),
    auth,
    transport: sessionTransport,
  })
  const session = sessionResult.session
  const mailAccountId = account.primaryMailAccountId ?? session.primaryAccounts[CAP_MAIL] ?? firstMailAccountId(session)
  if (mailAccountId === undefined || mailAccountId === null) throw new Error("No mail account found on server.")

  return {
    mailAccountId,
    client: new JmapClient({
    session,
    transport: new FetchJmapTransport({ auth, session, fetchImpl: jmapFetch }),
    }),
  }
}

async function fetchEmailMessages(client: JmapClient, account: ConfiguredAccount, mailAccountId: string, emailIds: readonly string[]): Promise<MailMessage[]> {
  const emailArgs = responseArgs(await client.call([CAP_MAIL], "Email/get", {
    accountId: mailAccountId,
    ids: [...emailIds],
    properties: [...EMAIL_PREVIEW_PROPERTIES],
    bodyProperties: ["partId", "type", "charset", "name", "size"],
    fetchTextBodyValues: true,
    fetchHTMLBodyValues: true,
    maxBodyValueBytes: 200_000,
  }, "ui-email-get"))
  const messages = jsonObjectArray(emailArgs.list)
    .map((email) => toMailMessage(account, email))
    .sort((left, right) => messageTime(right) - messageTime(left))
  return messages
}

async function queryEmailIds(client: JmapClient, accountId: string, options: { readonly mailboxId?: string; readonly limit?: number } = {}): Promise<string[]> {
  const args = cleanUndefined({
    accountId,
    filter: options.mailboxId === undefined ? undefined : { inMailbox: options.mailboxId },
    sort: [{ property: "receivedAt", isAscending: false }],
    position: 0,
    limit: options.limit ?? EMAIL_PAGE_SIZE,
  })
  const response = responseArgs(await client.call([CAP_MAIL], "Email/query", args, `ui-email-query-${options.mailboxId ?? "all"}`))
  return stringArray(response.ids)
}

function toMailboxSummary(input: JsonObject): MailboxSummary[] {
  const id = stringValue(input.id)
  if (id === undefined) return []
  const role = stringValue(input.role)
  const parentId = stringValue(input.parentId)
  const sortOrder = numberValue(input.sortOrder)
  const totalEmails = numberValue(input.totalEmails)
  const unreadEmails = numberValue(input.unreadEmails)
  return [{
    id,
    name: stringValue(input.name) ?? id,
    ...(role === undefined ? {} : { role }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(totalEmails === undefined ? {} : { totalEmails }),
    ...(unreadEmails === undefined ? {} : { unreadEmails }),
  }]
}

function toMailMessage(account: ConfiguredAccount, email: JsonObject): MailMessage {
  const id = stringValue(email.id) ?? `${account.id}:unknown`
  const to = addressList(email.to)
  const bodyText = textBodyValue(email)
  return {
    id,
    key: `${account.id}:${id}`,
    accountId: account.id,
    accountName: account.displayName,
    mailboxIds: mailboxIdList(email.mailboxIds),
    subject: stringValue(email.subject) ?? "",
    from: addressList(email.from)[0] ?? "",
    to,
    ...(stringValue(email.receivedAt) === undefined ? {} : { receivedAt: stringValue(email.receivedAt) as string }),
    ...(stringValue(email.sentAt) === undefined ? {} : { sentAt: stringValue(email.sentAt) as string }),
    preview: stringValue(email.preview) ?? "",
    bodyText,
    hasAttachment: email.hasAttachment === true,
  }
}

function textBodyValue(email: JsonObject): string {
  const bodyValues = jsonRecord(email.bodyValues)
  const textValue = bodyValueForParts(bodyValues, email.textBody)
  if (textValue.length > 0) return textValue
  return stripHtml(bodyValueForParts(bodyValues, email.htmlBody))
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
    return (mailByAccount[mailboxFolder.accountId]?.messages ?? [])
      .filter((message) => message.mailboxIds.includes(mailboxFolder.mailboxId))
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
    return [{
      account,
      mailboxId: mailboxFolder.mailboxId,
      loadedCount: countMessagesInMailbox(mail.messages, mailboxFolder.mailboxId),
      ...(mailbox?.totalEmails === undefined ? {} : { totalEmails: mailbox.totalEmails }),
    }]
  }

  const roleFolder = parseAccountRoleFolderId(accounts, folderId)
  const [unifiedScope, unifiedRole] = folderId.startsWith("unified:") ? folderId.split(":") : []
  const role = roleFolder?.role ?? unifiedRole
  if (role === undefined) return []
  const scopedAccounts = unifiedScope === "unified" ? accounts : roleFolder === undefined ? [] : [roleFolder.account]
  return scopedAccounts.flatMap((account) => {
    const mail = mailByAccount[account.id]
    if (mail === undefined) return []
    return mailboxesForRole(mail.mailboxes, role).map((mailbox) => ({
      account,
      mailboxId: mailbox.id,
      loadedCount: countMessagesInMailbox(mail.messages, mailbox.id),
      ...(mailbox.totalEmails === undefined ? {} : { totalEmails: mailbox.totalEmails }),
    }))
  })
}

function folderTargetHasMore(target: FolderLoadTarget): boolean {
  return target.totalEmails === undefined ? target.loadedCount >= EMAIL_PAGE_SIZE : target.loadedCount < target.totalEmails
}

function mergeLoadedMessageBatches(mailByAccount: Record<string, AccountMailState>, batches: readonly LoadedMessageBatch[]): Record<string, AccountMailState> {
  return batches.reduce((current, batch) => {
    if (batch.messages.length === 0) return current
    const state = current[batch.accountId] ?? emptyAccountMailState()
    const byKey = new Map(state.messages.map((message) => [message.key, message]))
    for (const message of batch.messages) byKey.set(message.key, message)
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
  return `${count} messages loaded.`
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

function jsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
}

function jsonRecord(value: unknown): Record<string, JsonObject> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1])))
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

function EmptyThreadList({ accounts, selectedFolder, canLoadMore, loadingMore, onLoadMore }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
}) {
  const selectedAccount = accounts.find((account) => selectedFolder.startsWith(`${account.id}:`))
  return (
    <View style={styles.emptyThreads}>
      <Text style={styles.emptyTitle}>No synced mail yet</Text>
      <Text style={styles.emptyCopy}>
        {selectedAccount === undefined
          ? "Unified Inbox is ready to merge incoming mail from all accounts."
          : `${selectedAccount.displayName} is configured. Its folders will fill after mailbox sync is wired.`}
      </Text>
      {canLoadMore ? <View style={styles.loadMoreArea}><SecondaryButton label={loadingMore ? "Loading..." : "Load messages"} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
    </View>
  )
}

function Settings({ accounts, onAccountVerified, onDeleteAccount }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void
  readonly onDeleteAccount: (accountId: string) => void
}) {
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
              <Pressable key={option.value} onPress={() => update({ authKind: option.value })} style={[styles.authOption, draft.authKind === option.value && styles.authOptionActive]}>
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
          <PrimaryButton label={navigationBusy ? "Checking..." : "Continue"} disabled={navigationBusy} onPress={() => { void next() }} />
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
      <View style={styles.avatar}><Text style={styles.avatarText}>{account.displayName.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.accountSummaryText}>
        <Text style={styles.accountName}>{account.displayName}</Text>
        <Text style={styles.accountMeta}>{account.email}</Text>
        <Text style={styles.accountMeta}>{configuredAccountServerLabel(account)}</Text>
      </View>
      <Text style={styles.statusPill}>{account.status}</Text>
    </View>
  )
}

function FolderButton({ label, count, level = 0, active, onPress }: { readonly label: string; readonly count?: number | undefined; readonly level?: number | undefined; readonly active: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.folderButton, level > 0 && { paddingLeft: 8 + level * 12 }, active && styles.folderButtonActive]}>
      <Text numberOfLines={1} style={[styles.folderButtonText, active && styles.folderButtonTextActive]}>{label}</Text>
      {count === undefined ? null : <Text style={[styles.folderCount, active && styles.folderButtonTextActive]}>{count}</Text>}
    </Pressable>
  )
}

function ToolbarButton({ label, active, onPress }: { readonly label: string; readonly active?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toolbarButton, active && styles.toolbarButtonActive]}>
      <Text style={[styles.toolbarButtonText, active && styles.toolbarButtonTextActive]}>{label}</Text>
    </Pressable>
  )
}

function PrimaryButton({ label, disabled, onPress }: { readonly label: string; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.primaryButton, disabled && styles.buttonDisabled]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({ label, disabled, onPress }: { readonly label: string; readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.secondaryButton, disabled && styles.buttonDisabled]}>
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
  return new Response(response.body, { status: response.status, headers: response.headers })
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
    return account === undefined ? mailbox?.name ?? "Folder" : `${account.displayName} - ${mailbox?.name ?? "Folder"}`
  }
  const roleFolder = parseAccountRoleFolderId(accounts, folderId)
  const folderLabel = ACCOUNT_FOLDERS.find((item) => item.id === roleFolder?.role)?.label ?? "Folder"
  return roleFolder === undefined ? folderLabel : `${roleFolder.account.displayName} - ${folderLabel}`
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
        messages: state.messages,
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
  const messages = Array.isArray(input.messages) ? input.messages.filter(isMailMessage) : []
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
    && (mailbox.role === undefined || typeof mailbox.role === "string")
    && (mailbox.parentId === undefined || typeof mailbox.parentId === "string")
    && (mailbox.sortOrder === undefined || typeof mailbox.sortOrder === "number")
    && (mailbox.totalEmails === undefined || typeof mailbox.totalEmails === "number")
    && (mailbox.unreadEmails === undefined || typeof mailbox.unreadEmails === "number")
}

function isMailMessage(value: unknown): value is MailMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const message = value as Partial<MailMessage>
  return typeof message.id === "string" &&
    typeof message.key === "string" &&
    typeof message.accountId === "string" &&
    typeof message.accountName === "string" &&
    Array.isArray(message.mailboxIds) && message.mailboxIds.every((mailboxId) => typeof mailboxId === "string") &&
    typeof message.subject === "string" &&
    typeof message.from === "string" &&
    Array.isArray(message.to) && message.to.every((address) => typeof address === "string") &&
    (message.receivedAt === undefined || typeof message.receivedAt === "string") &&
    (message.sentAt === undefined || typeof message.sentAt === "string") &&
    typeof message.preview === "string" &&
    typeof message.bodyText === "string" &&
    typeof message.hasAttachment === "boolean"
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#f2f4f8" },
  toolbar: { minHeight: 58, backgroundColor: "#f8fbff", borderBottomColor: "#c8d3df", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  toolbarTitle: { color: "#1d2d44", fontSize: 19, fontWeight: "800" },
  toolbarActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  toolbarButton: { borderColor: "#c5d2e0", borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#ffffff" },
  toolbarButtonActive: { backgroundColor: "#dbeafe", borderColor: "#7aa7e8" },
  toolbarButtonText: { color: "#25364d", fontWeight: "700" },
  toolbarButtonTextActive: { color: "#0b4f9c" },
  notice: { backgroundColor: "#e7f3ff", borderBottomColor: "#b6d7f4", borderBottomWidth: 1, color: "#174d7c", paddingHorizontal: 14, paddingVertical: 8 },
  vaultUnlock: { alignItems: "center", backgroundColor: "#fff7ed", borderBottomColor: "#fed7aa", borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  vaultUnlockText: { color: "#7c2d12", fontWeight: "800" },
  vaultUnlockInput: { backgroundColor: "#ffffff", borderColor: "#fdba74", borderRadius: 6, borderWidth: 1, color: "#111827", minWidth: 220, paddingHorizontal: 10, paddingVertical: 8 },
  vaultUnlockError: { color: "#9f1239", fontWeight: "800" },
  workspace: { flex: 1, flexDirection: "row", minHeight: 0 },
  folderPaneFallback: { backgroundColor: "#eef3f9", flexBasis: DEFAULT_FOLDER_PANE_WIDTH, flexGrow: 0, flexShrink: 0, maxWidth: MAX_FOLDER_PANE_WIDTH, minWidth: MIN_FOLDER_PANE_WIDTH, overflow: "hidden", width: DEFAULT_FOLDER_PANE_WIDTH },
  folderPaneScroll: { flex: 1, minWidth: 0 },
  dragDivider: { backgroundColor: "#c8d3df", flexShrink: 0, width: DIVIDER_WIDTH },
  folderPaneContent: { padding: 8, gap: 3 },
  paneHeader: { color: "#344963", fontSize: 13, fontWeight: "800", marginBottom: 8, textTransform: "uppercase" },
  sectionHeader: { color: "#64748b", fontSize: 12, fontWeight: "800", marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  folderButton: { borderRadius: 6, flexDirection: "row", gap: 6, justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 7 },
  folderButtonActive: { backgroundColor: "#cfe5ff" },
  folderButtonText: { color: "#24364e", flex: 1, fontSize: 14, fontWeight: "600", minWidth: 0 },
  folderButtonTextActive: { color: "#074a91" },
  folderCount: { color: "#64748b", flexShrink: 0, fontWeight: "800" },
  accountTree: { marginTop: 8 },
  accountTreeHeader: { paddingHorizontal: 8, paddingVertical: 7 },
  accountTreeName: { color: "#1f2f45", fontWeight: "800" },
  accountTreeServer: { color: "#64748b", fontSize: 12, marginTop: 2 },
  accountTreeStatus: { color: "#64748b", fontSize: 11, marginTop: 3 },
  accountTreeError: { color: "#9f1239", fontSize: 11, fontWeight: "800", marginTop: 3 },
  mailWorkspace: { flex: 1, flexDirection: "row", minWidth: 0 },
  threadPaneFallback: { backgroundColor: "#ffffff", flexBasis: "50%", flexGrow: 0, flexShrink: 0, minWidth: MIN_MESSAGE_PANE_WIDTH, overflow: "hidden", width: "50%" },
  threadHeader: { borderBottomColor: "#d5dde7", borderBottomWidth: 1, padding: 14 },
  threadTitle: { color: "#172033", fontSize: 20, fontWeight: "800" },
  threadSubtle: { color: "#64748b", marginTop: 5 },
  messageList: { flex: 1, backgroundColor: "#ffffff" },
  messageRow: { borderBottomColor: "#e2e8f0", borderBottomWidth: 1, gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  messageRowActive: { backgroundColor: "#dbeafe" },
  messageRowTop: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  messageSender: { color: "#172033", flex: 1, fontWeight: "800", minWidth: 0 },
  messageDate: { color: "#64748b", flexShrink: 0, fontSize: 11 },
  messageSubject: { color: "#24364e", fontWeight: "800" },
  messagePreviewText: { color: "#64748b", lineHeight: 18 },
  attachmentText: { color: "#0b4f9c", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  loadMoreArea: { alignItems: "center", borderTopColor: "#e2e8f0", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 14 },
  emptyThreads: { padding: 22 },
  emptyTitle: { color: "#1f2f45", fontSize: 18, fontWeight: "800" },
  emptyCopy: { color: "#64748b", lineHeight: 22, marginTop: 8 },
  readerPane: { backgroundColor: "#fbfcfe", flex: 1, minWidth: MIN_MESSAGE_PANE_WIDTH, padding: 28 },
  readerContent: { paddingBottom: 40 },
  readerTitle: { color: "#172033", fontSize: 24, fontWeight: "800" },
  readerMeta: { color: "#64748b", marginTop: 8 },
  readerBody: { color: "#172033", fontSize: 15, lineHeight: 23, marginTop: 24, whiteSpace: "pre-wrap" } as unknown as ViewStyle,
  readerCopy: { color: "#4b5f77", lineHeight: 24, marginTop: 12, maxWidth: 720 },
  settingsPane: { flex: 1, backgroundColor: "#f7f9fc" },
  settingsContent: { padding: 22, gap: 18 },
  settingsTitle: { color: "#172033", fontSize: 28, fontWeight: "800" },
  settingsCopy: { color: "#4b5f77", lineHeight: 23, maxWidth: 860 },
  settingsColumns: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  settingsCard: { backgroundColor: "#ffffff", borderColor: "#d5dde7", borderRadius: 10, borderWidth: 1, flexBasis: 430, flexGrow: 1, padding: 18 },
  cardTitle: { color: "#172033", fontSize: 19, fontWeight: "800", marginBottom: 14 },
  firstRunShell: { flex: 1, backgroundColor: "#eaf1f8", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 32, padding: 28 },
  firstRunBrand: { maxWidth: 520 },
  brandMark: { color: "#0b63ce", fontSize: 22, fontWeight: "900", marginBottom: 18 },
  brandTitle: { color: "#132238", fontSize: 42, fontWeight: "900", lineHeight: 48, marginBottom: 18 },
  brandCopy: { color: "#40566f", fontSize: 17, lineHeight: 27 },
  setupFlow: { backgroundColor: "#ffffff", borderColor: "#cbd7e3", borderRadius: 12, borderWidth: 1, maxWidth: 620, padding: 18, width: "100%", gap: 16 },
  stepper: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepPill: { backgroundColor: "#edf2f7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
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
  input: { backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderRadius: 6, borderWidth: 1, color: "#111827", fontSize: 16, paddingHorizontal: 11, paddingVertical: 10 },
  authOptions: { gap: 10 },
  authOption: { borderColor: "#cbd7e3", borderRadius: 8, borderWidth: 1, padding: 12 },
  authOptionActive: { backgroundColor: "#e7f1ff", borderColor: "#7aa7e8" },
  authOptionText: { color: "#172033", fontWeight: "800" },
  authOptionTextActive: { color: "#0b4f9c" },
  authOptionHelp: { color: "#64748b", marginTop: 5 },
  authOptionHelpActive: { color: "#255f9f" },
  reviewRow: { borderTopColor: "#e2e8f0", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9 },
  reviewLabel: { color: "#64748b", fontWeight: "800" },
  reviewValue: { color: "#172033", flex: 1, textAlign: "right" },
  successText: { color: "#17693a", fontWeight: "800" },
  errorText: { backgroundColor: "#fff1f2", borderColor: "#fecdd3", borderRadius: 6, borderWidth: 1, color: "#9f1239", padding: 10 },
  flowButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  primaryButton: { backgroundColor: "#0b63ce", borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  buttonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: "#ffffff", fontWeight: "800" },
  secondaryButton: { backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderRadius: 6, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: "#24364e", fontWeight: "800" },
  manageAccountRow: { borderTopColor: "#e2e8f0", borderTopWidth: 1, gap: 10, paddingVertical: 12 },
  accountSummary: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: { alignItems: "center", backgroundColor: "#dbeafe", borderRadius: 999, height: 38, justifyContent: "center", width: 38 },
  avatarText: { color: "#0b4f9c", fontWeight: "900" },
  accountSummaryText: { flex: 1 },
  accountName: { color: "#172033", fontWeight: "800" },
  accountMeta: { color: "#64748b", fontSize: 12, marginTop: 2 },
  statusPill: { backgroundColor: "#dcfce7", borderRadius: 999, color: "#166534", fontSize: 12, fontWeight: "800", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
})
