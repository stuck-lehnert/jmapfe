import { removeConfiguredAccount, type ConfiguredAccount } from "@jmapfe/app-core"
import { type AuthProvider, type BlobLike } from "@jmapfe/jmap-core"
import { useEffect, useRef, useState } from "react"
import { ScrollView, View, useWindowDimensions } from "react-native"
import { AppStorage, AttachmentBackend, Binary, JmapMail, MailModel, MailState, RuntimeBackend, VaultBackend } from "./backend"
import { AccountSetupFlow, MailUi, UIShell } from "./components"
import { MOBILE_BREAKPOINT } from "./layoutConstants"
import { styles } from "./styles"

const EMAIL_PAGE_SIZE = MailModel.EMAIL_PAGE_SIZE
type AppView = "mail" | "settings"
type MailMessage = MailModel.MailMessage
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type AccountMailState = MailModel.AccountMailState
type LoadedMessageBatch = MailModel.LoadedMessageBatch
type LoadedMailTargetBatch = MailModel.LoadedMailTargetBatch
type SearchState = MailModel.SearchState
type InlineImageLoadResult = MailModel.InlineImageLoadResult
type VaultMode = "checking" | "os" | "locked" | "fallback"

interface NavigationState {
  readonly view: AppView
  readonly selectedFolder: string
  readonly selectedMessageKey: string | undefined
  readonly folderDrawerOpen: boolean
  readonly draggedMessageKey: string | undefined
}

interface LoadingState {
  readonly moreFolder: string | undefined
  readonly messageKey: string | undefined
  readonly inlineImageKey: string | undefined
  readonly attachmentKey: string | undefined
  readonly flagMessageKeys: Record<string, true>
}

interface MailErrorState {
  readonly messageBody: Record<string, string>
  readonly inlineImage: Record<string, string>
  readonly attachment: Record<string, string>
}

interface SearchUiState {
  readonly draft: string
  readonly state: SearchState
}

interface VaultUiState {
  readonly mode: VaultMode
  readonly masterPassword: string
  readonly error: string | undefined
}

const EMPTY_SEARCH_STATE = MailModel.EMPTY_SEARCH_STATE

export default function App() {
  const { width } = useWindowDimensions()
  const isMobile = width < MOBILE_BREAKPOINT
  const [accounts, setAccounts] = useState<ConfiguredAccount[]>(() => AppStorage.loadAccounts())
  const [navigation, setNavigation] = useState<NavigationState>({ view: "mail", selectedFolder: "unified:inbox", selectedMessageKey: undefined, folderDrawerOpen: false, draggedMessageKey: undefined })
  const [accountAuth, setAccountAuth] = useState<Record<string, AuthProvider>>({})
  const [mailByAccount, setMailByAccount] = useState<Record<string, AccountMailState>>(() => AppStorage.loadMailCache())
  const [loading, setLoading] = useState<LoadingState>({ moreFolder: undefined, messageKey: undefined, inlineImageKey: undefined, attachmentKey: undefined, flagMessageKeys: {} })
  const loadingFlagMessageKeysRef = useRef<Record<string, true>>({})
  const [mailErrors, setMailErrors] = useState<MailErrorState>({ messageBody: {}, inlineImage: {}, attachment: {} })
  const [search, setSearch] = useState<SearchUiState>({ draft: "", state: EMPTY_SEARCH_STATE })
  const [remoteImageProxyBase, setRemoteImageProxyBase] = useState<string | undefined>(() => AppStorage.loadRemoteImageProxyBase())
  const [vault, setVault] = useState<VaultUiState>({ mode: "checking", masterPassword: "", error: undefined })
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => AppStorage.saveAccounts(accounts), [accounts])
  useEffect(() => AppStorage.saveMailCache(mailByAccount), [mailByAccount])
  useEffect(() => {
    setMailByAccount((current) => AppStorage.pruneMailCache(current, accounts))
  }, [accounts])
  useEffect(() => {
    if (!isMobile) setNavigation((current) => ({ ...current, folderDrawerOpen: false }))
  }, [isMobile])
  useEffect(() => {
    if (accounts.length === 0) {
      setVault((current) => ({ ...current, mode: "os" }))
      return
    }
    if (!RuntimeBackend.isTauriRuntime() && !VaultBackend.hasFallbackVault()) {
      setVault((current) => ({ ...current, mode: "fallback" }))
      return
    }
    void VaultBackend.loadSavedAuth(accounts, undefined)
      .then(({ auth, mode }) => {
        setAccountAuth(auth)
        setVault((current) => ({ ...current, mode }))
      })
      .catch(() => setVault((current) => ({ ...current, mode: VaultBackend.hasFallbackVault() ? "locked" : "fallback" })))
  }, [accounts])

  // Reveal large mail loads in small chunks so first rows render before full sync finishes.
  async function revealMailTargetBatch(accountId: string, batch: LoadedMailTargetBatch): Promise<void> {
    const chunks = MailState.messageChunks(batch.messages)
    if (chunks.length === 0) {
      setMailByAccount((current) => MailState.mergeMailTargetBatch(current, accountId, batch))
      return
    }
    for (const [index, messages] of chunks.entries()) {
      setMailByAccount((current) => MailState.mergeMailTargetBatch(current, accountId, { mailboxes: index === 0 ? batch.mailboxes : [], messages }))
      if (index < chunks.length - 1) await MailState.waitForMessageReveal()
    }
  }

  async function revealLoadedMessageBatch(batch: LoadedMessageBatch): Promise<void> {
    const chunks = MailState.messageChunks(batch.messages)
    for (const [index, messages] of chunks.entries()) {
      setMailByAccount((current) => MailState.mergeLoadedMessageBatches(current, [{ ...batch, messages }]))
      if (index < chunks.length - 1) await MailState.waitForMessageReveal()
    }
  }

  // Search results update both cache and active search view progressively.
  async function revealSearchBatch(folderId: string, query: string, batch: LoadedMessageBatch): Promise<void> {
    const chunks = MailState.messageChunks(batch.messages)
    for (const [index, messages] of chunks.entries()) {
      const chunk = { ...batch, messages }
      setMailByAccount((current) => MailState.mergeLoadedMessageBatches(current, [chunk]))
      setSearch((current) => ({ ...current, state: MailUi.appendSearchBatch(current.state, folderId, query, chunk) }))
      if (index < chunks.length - 1) await MailState.waitForMessageReveal()
    }
  }

  const syncAccountMail = async (account: ConfiguredAccount, authOverride?: AuthProvider): Promise<void> => {
    const auth = authOverride ?? accountAuth[account.id]
    if (auth === undefined) {
      setMailByAccount((current) => ({
        ...current,
        [account.id]: { ...(current[account.id] ?? MailUi.emptyAccountMailState()), status: "error", error: "Sign in again to fetch messages." },
      }))
      return
    }

    setMailByAccount((current) => {
      const existing = current[account.id] ?? MailUi.emptyAccountMailState()
      return { ...current, [account.id]: { status: "syncing", mailboxes: existing.mailboxes, messages: existing.messages, ...(existing.syncedAt === undefined ? {} : { syncedAt: existing.syncedAt }) } }
    })

    try {
      const { client, session, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      const mailTargets = JmapMail.mailAccountTargets(session, primaryMailAccountId)
      const batches: LoadedMailTargetBatch[] = []
      const failures: string[] = []
      await Promise.all(mailTargets.map(async (target) => {
        try {
          const batch = await JmapMail.fetchMailTargetBatch(client, account, target)
          batches.push(batch)
          await revealMailTargetBatch(account.id, batch)
        } catch (error) {
          failures.push(JmapMail.connectivityErrorMessage(error))
        }
      }))
      const next = {
        status: "ready",
        mailboxes: batches.flatMap((batch) => batch.mailboxes),
        messages: batches.flatMap((batch) => batch.messages).sort((left, right) => MailUi.messageTime(right) - MailUi.messageTime(left)),
        syncedAt: new Date().toISOString(),
      } satisfies AccountMailState
      setMailByAccount((current) => {
        const merged = batches.length === 0 && mailTargets.length > 0 ? current[account.id] ?? MailState.emptyAccountMailState() : MailState.mergeFetchedMailState(current[account.id], next)
        return {
          ...current,
          [account.id]: failures.length === 0 ? merged : { ...merged, status: "error", error: MailState.loadFailuresMessage("mail target", failures) },
        }
      })
    } catch (error) {
      setMailByAccount((current) => ({
        ...current,
        [account.id]: { ...(current[account.id] ?? MailUi.emptyAccountMailState()), status: "error", error: JmapMail.connectivityErrorMessage(error) },
      }))
    }
  }

  const syncAllMail = () => {
    setNavigation((current) => ({ ...current, view: "mail" }))
    if (accounts.length === 0) return
    void Promise.all(accounts.map((account) => syncAccountMail(account)))
  }

  const loadMoreFolder = async (folderId: string): Promise<void> => {
    if (loading.moreFolder !== undefined) return
    const targets = MailUi.folderLoadTargets(accounts, mailByAccount, folderId).filter(MailUi.folderTargetHasMore)
    if (targets.length === 0) return

    setLoading((current) => ({ ...current, moreFolder: folderId }))
    try {
      const failures: string[] = []
      await Promise.all(targets.map(async (target) => {
        try {
          const auth = accountAuth[target.account.id]
          if (auth === undefined) throw new Error("Sign in again to fetch more messages.")
          const batch = {
            accountId: target.account.id,
            messages: await JmapMail.fetchMoreMailboxMessages(target.account, auth, target, mailByAccount[target.account.id]?.messages ?? []),
          } satisfies LoadedMessageBatch
          await revealLoadedMessageBatch(batch)
        } catch (error) {
          failures.push(JmapMail.connectivityErrorMessage(error))
        }
      }))
      if (failures.length > 0) setNotice(MailState.loadFailuresMessage("message batch", failures))
    } catch (error) {
      setNotice(JmapMail.connectivityErrorMessage(error))
    } finally {
      setLoading((current) => ({ ...current, moreFolder: current.moreFolder === folderId ? undefined : current.moreFolder }))
    }
  }

  const selectMessage = (messageKey: string) => {
    setNavigation((current) => ({ ...current, selectedMessageKey: messageKey }))
    void loadMessageBody(messageKey)
  }

  const loadMessageBody = async (messageKey: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || message.bodyLoaded === true) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setMailErrors((current) => ({ ...current, messageBody: { ...current.messageBody, [messageKey]: "Sign in again to fetch message contents." } }))
      return
    }

    setLoading((current) => ({ ...current, messageKey }))
    setMailErrors((current) => ({ ...current, messageBody: omitKey(current.messageBody, messageKey) }))
    try {
      const { client, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      const body = await JmapMail.fetchEmailMessageBody(client, message.jmapAccountId ?? primaryMailAccountId, message.id)
      setMailByAccount((current) => MailState.mergeMessageBody(current, message.accountId, messageKey, body))
    } catch (error) {
      setMailErrors((current) => ({ ...current, messageBody: { ...current.messageBody, [messageKey]: JmapMail.connectivityErrorMessage(error) } }))
    } finally {
      setLoading((current) => ({ ...current, messageKey: current.messageKey === messageKey ? undefined : current.messageKey }))
    }
  }

  const loadInlineImages = async (messageKey: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    const inlineImages = message === undefined ? [] : MailState.inlineImagesToLoad(message)
    if (message === undefined || message.bodyLoaded !== true || inlineImages.length === 0) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setMailErrors((current) => ({ ...current, inlineImage: { ...current.inlineImage, [messageKey]: "Sign in again to fetch inline images." } }))
      return
    }

    setLoading((current) => ({ ...current, inlineImageKey: messageKey }))
    setMailErrors((current) => ({ ...current, inlineImage: omitKey(current.inlineImage, messageKey) }))
    try {
      const { transport, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      const jmapAccountId = message.jmapAccountId ?? primaryMailAccountId
      const results: InlineImageLoadResult[] = []
      for (const image of inlineImages) results.push(await JmapMail.loadInlineImageData(transport, jmapAccountId, image))
      const images = results.flatMap((result) => "dataUrl" in result ? [[result.cid, result.dataUrl] as const] : [])
      if (images.length > 0) setMailByAccount((current) => MailState.mergeInlineImageData(current, message.accountId, messageKey, Object.fromEntries(images)))
      const failures = results.filter((result): result is Extract<InlineImageLoadResult, { readonly error: string }> => "error" in result)
      if (failures.length > 0) setMailErrors((current) => ({ ...current, inlineImage: { ...current.inlineImage, [messageKey]: JmapMail.inlineImageLoadErrorMessage(failures) } }))
    } catch (error) {
      setMailErrors((current) => ({ ...current, inlineImage: { ...current.inlineImage, [messageKey]: JmapMail.connectivityErrorMessage(error) } }))
    } finally {
      setLoading((current) => ({ ...current, inlineImageKey: current.inlineImageKey === messageKey ? undefined : current.inlineImageKey }))
    }
  }

  const loadAttachmentBlob = async (message: MailMessage, attachment: EmailAttachmentPart): Promise<BlobLike> => {
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) throw new Error("Sign in again to fetch attachments.")
    const { transport, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
    return AttachmentBackend.downloadBlob(transport, message.jmapAccountId ?? primaryMailAccountId, attachment)
  }

  const openAttachment = async (messageKey: string, attachment: EmailAttachmentPart, index: number): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const actionKey = MailUi.attachmentActionKey(messageKey, attachment, index)
    setLoading((current) => ({ ...current, attachmentKey: actionKey }))
    setMailErrors((current) => ({ ...current, attachment: omitKey(current.attachment, messageKey) }))
    try {
      const blob = await loadAttachmentBlob(message, attachment)
      await AttachmentBackend.openBlob(attachment.name, attachment.type, blob)
    } catch (error) {
      setMailErrors((current) => ({ ...current, attachment: { ...current.attachment, [messageKey]: JmapMail.connectivityErrorMessage(error) } }))
    } finally {
      setLoading((current) => ({ ...current, attachmentKey: current.attachmentKey === actionKey ? undefined : current.attachmentKey }))
    }
  }

  const downloadAttachment = async (messageKey: string, attachment: EmailAttachmentPart, index: number): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const actionKey = MailUi.attachmentActionKey(messageKey, attachment, index)
    setLoading((current) => ({ ...current, attachmentKey: actionKey }))
    setMailErrors((current) => ({ ...current, attachment: omitKey(current.attachment, messageKey) }))
    try {
      const saveTarget = await AttachmentBackend.promptSaveFile(attachment.name, attachment.type)
      const blob = await loadAttachmentBlob(message, attachment)
      await saveTarget.write(AttachmentBackend.blobLikeToBlob(blob, attachment.type))
    } catch (error) {
      if (AttachmentBackend.isSaveFileCancelled(error)) return
      setMailErrors((current) => ({ ...current, attachment: { ...current.attachment, [messageKey]: JmapMail.connectivityErrorMessage(error) } }))
    } finally {
      setLoading((current) => ({ ...current, attachmentKey: current.attachmentKey === actionKey ? undefined : current.attachmentKey }))
    }
  }

  const downloadAllAttachments = async (messageKey: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || message.attachments.length === 0) return
    const actionKey = `${messageKey}:attachments:all`
    setLoading((current) => ({ ...current, attachmentKey: actionKey }))
    setMailErrors((current) => ({ ...current, attachment: omitKey(current.attachment, messageKey) }))
    try {
      const saveTarget = await AttachmentBackend.promptSaveFile(`${AttachmentBackend.safeBaseFileName(message.subject || "attachments")}.zip`, "application/zip")
      const entries: AttachmentBackend.ZipEntryData[] = []
      const usedNames = new Set<string>()
      const failures: string[] = []
      for (const attachment of message.attachments) {
        try {
          const blob = await loadAttachmentBlob(message, attachment)
          entries.push({ name: AttachmentBackend.uniqueZipEntryName(attachment.name, usedNames), bytes: await AttachmentBackend.blobLikeToBytes(blob) })
        } catch (error) {
          failures.push(`${attachment.name}: ${JmapMail.connectivityErrorMessage(error)}`)
        }
      }
      if (entries.length === 0) throw new Error(failures[0] ?? "No attachments could be downloaded.")
      await saveTarget.write(new Blob([Binary.bufferSource(AttachmentBackend.createZip(entries))], { type: "application/zip" }))
      if (failures.length > 0) setMailErrors((current) => ({ ...current, attachment: { ...current.attachment, [messageKey]: `${failures.length} attachment${failures.length === 1 ? "" : "s"} skipped. ${failures[0]}` } }))
    } catch (error) {
      if (AttachmentBackend.isSaveFileCancelled(error)) return
      setMailErrors((current) => ({ ...current, attachment: { ...current.attachment, [messageKey]: JmapMail.connectivityErrorMessage(error) } }))
    } finally {
      setLoading((current) => ({ ...current, attachmentKey: current.attachmentKey === actionKey ? undefined : current.attachmentKey }))
    }
  }

  const toggleMessageFlag = async (messageKey: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || loadingFlagMessageKeysRef.current[messageKey] === true) return
    const nextFlagState = MailState.nextMessageFlagState(message.flagState)
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setNotice("Sign in again to update message flags.")
      return
    }

    const nextLoadingFlagMessageKeys = { ...loadingFlagMessageKeysRef.current, [messageKey]: true as true }
    loadingFlagMessageKeysRef.current = nextLoadingFlagMessageKeys
    setLoading((current) => ({ ...current, flagMessageKeys: nextLoadingFlagMessageKeys }))
    setMailByAccount((current) => MailState.updateMessageFlagState(current, message.accountId, messageKey, nextFlagState))
    try {
      const { client, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      await JmapMail.setRemoteMessageFlagState(client, message.jmapAccountId ?? primaryMailAccountId, message.id, nextFlagState)
    } catch (error) {
      setMailByAccount((current) => MailState.updateMessageFlagState(current, message.accountId, messageKey, message.flagState))
      setNotice(JmapMail.connectivityErrorMessage(error))
    } finally {
      const nextLoadingFlagMessageKeys = omitKey(loadingFlagMessageKeysRef.current, messageKey)
      loadingFlagMessageKeysRef.current = nextLoadingFlagMessageKeys
      setLoading((current) => ({ ...current, flagMessageKeys: nextLoadingFlagMessageKeys }))
    }
  }

  const markMessageReadState = async (messageKey: string, read: boolean): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined || message.read === read) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    if (account === undefined || auth === undefined) {
      setNotice("Sign in again to update message read state.")
      return
    }
    if (!MailState.canSetMessageReadState(mailByAccount[message.accountId], message)) {
      setNotice("Message read state is read-only for this folder.")
      return
    }

    setMailByAccount((current) => MailState.updateMessageReadState(current, message.accountId, messageKey, read))
    try {
      const { client, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      await JmapMail.setRemoteMessageReadState(client, message.jmapAccountId ?? primaryMailAccountId, message.id, read)
    } catch (error) {
      setMailByAccount((current) => MailState.updateMessageReadState(current, message.accountId, messageKey, message.read))
      setNotice(JmapMail.connectivityErrorMessage(error))
    }
  }

  const deleteMessage = async (messageKey: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const trash = MailUi.findMailboxByRole(mailByAccount[message.accountId], message.jmapAccountId, "trash")
    if (trash === undefined) {
      setNotice("Trash folder was not advertised by server.")
      return
    }
    await moveMessageToMailbox(messageKey, trash.id)
  }

  const moveMessageToFolder = async (messageKey: string, folderId: string): Promise<void> => {
    const folder = MailUi.parseMailboxFolderId(folderId)
    if (folder === undefined) return
    await moveMessageToMailbox(messageKey, folder.mailboxId)
  }

  // Optimistic mailbox move. Local state changes first; server rejection rolls it back.
  const moveMessageToMailbox = async (messageKey: string, mailboxId: string): Promise<void> => {
    const message = MailUi.findMessageByKey(mailByAccount, messageKey)
    if (message === undefined) return
    const account = accounts.find((item) => item.id === message.accountId)
    const auth = accountAuth[message.accountId]
    const destination = mailByAccount[message.accountId]?.mailboxes.find((mailbox) => mailbox.id === mailboxId)
    if (account === undefined || auth === undefined) {
      setNotice("Sign in again to move messages.")
      return
    }
    if (destination === undefined || destination.serverId === undefined || destination.isSynthetic === true) return
    if (destination.jmapAccountId !== undefined && destination.jmapAccountId !== message.jmapAccountId) {
      setNotice("Moving messages between mail accounts is not supported yet.")
      return
    }
    if (destination.myRights?.mayAddItems === false || destination.jmapAccountIsReadOnly === true) {
      setNotice("Destination folder is read-only.")
      return
    }
    if (message.mailboxIds.length === 1 && message.mailboxIds[0] === destination.id) return

    const nextMailboxIds = [destination.id]
    setMailByAccount((current) => MailState.updateMessageMailboxIds(current, message.accountId, messageKey, nextMailboxIds))
    try {
      const { client, primaryMailAccountId } = await JmapMail.createMailClient(account, auth)
      const jmapAccountId = message.jmapAccountId ?? primaryMailAccountId
      await JmapMail.setRemoteMessageMailboxIds(client, jmapAccountId, message.id, message.mailboxIds, destination.serverId)
    } catch (error) {
      setMailByAccount((current) => MailState.updateMessageMailboxIds(current, message.accountId, messageKey, message.mailboxIds))
      setNotice(JmapMail.connectivityErrorMessage(error))
    }
  }

  const runSearch = async (query: string): Promise<void> => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length === 0) {
      setSearch((current) => ({ ...current, state: EMPTY_SEARCH_STATE }))
      return
    }

    const folderId = navigation.selectedFolder
    const localMessages = MailUi.localSearchMessages(accounts, mailByAccount, folderId, trimmedQuery)
    const targets = MailUi.folderLoadTargets(accounts, mailByAccount, folderId)

    setNavigation((current) => ({ ...current, selectedMessageKey: undefined }))
    setSearch((current) => ({ ...current, state: { status: targets.length === 0 ? "ready" : "searching", folderId, query: trimmedQuery, messageKeys: localMessages.map((message) => message.key) } }))
    if (targets.length === 0) return
    try {
      const clientByAccount = new Map<string, Promise<Awaited<ReturnType<typeof JmapMail.createMailClient>>>>()
      const batches: LoadedMessageBatch[] = []
      const failures: string[] = []
      await Promise.all(targets.map(async (target) => {
        try {
          const auth = accountAuth[target.account.id]
          if (auth === undefined) throw new Error("Sign in again to search messages.")
          let clientPromise = clientByAccount.get(target.account.id)
          if (clientPromise === undefined) {
            clientPromise = JmapMail.createMailClient(target.account, auth)
            clientByAccount.set(target.account.id, clientPromise)
          }
          const { client, primaryMailAccountId } = await clientPromise
          const result = await JmapMail.searchMailboxMessagesWithClient(client, target.account, target.jmapAccountId ?? primaryMailAccountId, target, trimmedQuery)
          const batch = { accountId: target.account.id, messages: result.messages, ...(result.total === undefined ? {} : { total: result.total }) } satisfies LoadedMessageBatch
          batches.push(batch)
          await revealSearchBatch(folderId, trimmedQuery, batch)
        } catch (error) {
          failures.push(JmapMail.connectivityErrorMessage(error))
        }
      }))
      const messages = MailState.uniqueMessages([...localMessages, ...batches.flatMap((batch) => batch.messages)]).sort((left, right) => MailState.messageTime(right) - MailState.messageTime(left))
      const total = MailState.sumKnownMailboxCounts(batches.map((batch) => batch.total))
      setSearch((current) => ({ ...current, state: MailUi.finishSearchState(current.state, folderId, trimmedQuery, messages.map((message) => message.key), total, failures, MailState.loadFailuresMessage) }))
    } catch (error) {
      setSearch((current) => ({ ...current, state: { status: "error", folderId, query: trimmedQuery, messageKeys: [], error: JmapMail.connectivityErrorMessage(error) } }))
    }
  }

  const clearSearch = () => {
    setSearch({ draft: "", state: EMPTY_SEARCH_STATE })
  }

  const unlockFallbackVault = async () => {
    setVault((current) => ({ ...current, error: undefined }))
    try {
      const result = await VaultBackend.loadSavedAuth(accounts, vault.masterPassword)
      setAccountAuth(result.auth)
      setVault((current) => ({ ...current, mode: result.mode, masterPassword: "" }))
      if (Object.keys(result.auth).length > 0) setNotice("Saved credentials unlocked.")
    } catch (error) {
      setVault((current) => ({ ...current, error: error instanceof Error ? error.message : "Could not unlock saved credentials." }))
    }
  }

  const addFirstAccount = (account: ConfiguredAccount, auth: AuthProvider) => {
    setAccounts((current) => [...current, account])
    setAccountAuth((current) => ({ ...current, [account.id]: auth }))
    setNavigation((current) => ({ ...current, selectedFolder: "unified:inbox", view: "mail" }))
    showNotice("Account verified and added. Unified Inbox is selected.", 10_000)
    void VaultBackend.storeAccountAuth(account, auth, vault.mode === "fallback" ? vault.masterPassword : undefined)
      .then((mode) => setVault((current) => ({ ...current, mode })))
      .catch((error) => setNotice(error instanceof Error ? error.message : "Could not save credentials."))
    void syncAccountMail(account, auth)
  }

  const addSettingsAccount = (account: ConfiguredAccount, auth: AuthProvider) => {
    setAccounts((current) => [...current, account])
    setAccountAuth((current) => ({ ...current, [account.id]: auth }))
    setNavigation((current) => ({ ...current, view: "settings" }))
    setNotice("Account verified and added. It now appears in the folder pane.")
    void VaultBackend.storeAccountAuth(account, auth, vault.mode === "fallback" ? vault.masterPassword : undefined)
      .then((mode) => setVault((current) => ({ ...current, mode })))
      .catch((error) => setNotice(error instanceof Error ? error.message : "Could not save credentials."))
    void syncAccountMail(account, auth)
  }

  const deleteAccount = (accountId: string) => {
    setAccounts((current) => removeConfiguredAccount(current, accountId))
    setAccountAuth((current) => omitKey(current, accountId))
    setMailByAccount((current) => omitKey(current, accountId))
    void VaultBackend.deleteAccountAuth(accountId, vault.mode === "fallback" ? vault.masterPassword : undefined)
    setNavigation((current) => ({ ...current, selectedMessageKey: current.selectedMessageKey?.startsWith(`${accountId}:`) ? undefined : current.selectedMessageKey, selectedFolder: "unified:inbox" }))
    setNotice("Account removed from local configuration.")
  }

  const updateRemoteImageProxyBase = (value: string | undefined) => {
    const nextValue = value?.trim()
    const normalizedValue = nextValue === undefined || nextValue.length === 0 ? undefined : nextValue
    if (normalizedValue !== undefined && !isHttpsUrl(normalizedValue)) {
      setNotice("Remote content proxy must use HTTPS.")
      return
    }
    AppStorage.saveRemoteImageProxyBase(normalizedValue)
    setRemoteImageProxyBase(normalizedValue)
    setNotice(normalizedValue === undefined ? "Remote content proxy cleared." : "Remote content proxy saved.")
  }

  const selectFolder = (folderId: string) => {
    setNavigation((current) => ({ ...current, selectedFolder: folderId, selectedMessageKey: undefined, view: "mail", folderDrawerOpen: isMobile ? false : current.folderDrawerOpen }))
    setSearch({ draft: "", state: EMPTY_SEARCH_STATE })
  }

  const showNotice = (message: string, autoDismissMs?: number) => {
    setNotice(message)
    if (autoDismissMs !== undefined) {
      globalThis.setTimeout(() => setNotice((current) => current === message ? undefined : current), autoDismissMs)
    }
  }

  if (accounts.length === 0) return <FirstRunSetup onAccountVerified={addFirstAccount} />

  return (
    <UIShell
      view={navigation.view}
      mobile={isMobile}
      notice={notice}
      accounts={accounts}
      mailByAccount={mailByAccount}
      selectedFolder={navigation.selectedFolder}
      selectedMessageKey={navigation.selectedMessageKey}
      folderDrawerOpen={navigation.folderDrawerOpen}
      draggedMessageKey={navigation.draggedMessageKey}
      loading={loading}
      mailErrors={{ messageBody: navigation.selectedMessageKey === undefined ? undefined : mailErrors.messageBody[navigation.selectedMessageKey], inlineImage: navigation.selectedMessageKey === undefined ? undefined : mailErrors.inlineImage[navigation.selectedMessageKey], attachment: navigation.selectedMessageKey === undefined ? undefined : mailErrors.attachment[navigation.selectedMessageKey] }}
      searchDraft={search.draft}
      searchState={search.state}
      remoteImageProxyBase={remoteImageProxyBase}
      settingsAccountSetup={<AccountSetupFlow mode="settings" fetchImpl={RuntimeBackend.jmapFetch} onAccountVerified={addSettingsAccount} />}
      vaultUnlock={vault.mode === "locked" ? { masterPassword: vault.masterPassword, error: vault.error, onChange: (masterPassword) => setVault((current) => ({ ...current, masterPassword })), onUnlock: () => { void unlockFallbackVault() } } : undefined}
      onOpenFolders={() => setNavigation((current) => ({ ...current, folderDrawerOpen: true }))}
      onOpenMail={() => setNavigation((current) => ({ ...current, view: "mail" }))}
      onGetMessages={syncAllMail}
      onOpenSettings={() => setNavigation((current) => ({ ...current, view: "settings" }))}
      onSelectFolder={selectFolder}
      onDropMessageToFolder={(messageKey, folderId) => { setNavigation((current) => ({ ...current, draggedMessageKey: undefined })); void moveMessageToFolder(messageKey, folderId) }}
      onCloseFolderDrawer={() => setNavigation((current) => ({ ...current, folderDrawerOpen: false }))}
      onRemoteImageProxyChange={updateRemoteImageProxyBase}
      onDeleteAccount={deleteAccount}
      onSearchDraftChange={(draft) => setSearch((current) => ({ ...current, draft }))}
      onSearch={() => { void runSearch(search.draft) }}
      onClearSearch={clearSearch}
      onSelectMessage={selectMessage}
      onCloseMessage={() => setNavigation((current) => ({ ...current, selectedMessageKey: undefined }))}
      onToggleMessageFlag={(messageKey) => { void toggleMessageFlag(messageKey) }}
      onMarkMessageReadState={(messageKey, read) => { void markMessageReadState(messageKey, read) }}
      onDeleteMessage={(messageKey) => { void deleteMessage(messageKey) }}
      onStartMessageDrag={(draggedMessageKey) => setNavigation((current) => ({ ...current, draggedMessageKey }))}
      onEndMessageDrag={() => setNavigation((current) => ({ ...current, draggedMessageKey: undefined }))}
      onLoadInlineImages={(messageKey) => { void loadInlineImages(messageKey) }}
      onOpenAttachment={(messageKey, attachment, index) => { void openAttachment(messageKey, attachment, index) }}
      onDownloadAttachment={(messageKey, attachment, index) => { void downloadAttachment(messageKey, attachment, index) }}
      onDownloadAllAttachments={(messageKey) => { void downloadAllAttachments(messageKey) }}
      onLoadMoreFolder={(folderId) => { void loadMoreFolder(folderId) }}
    />
  )
}

function FirstRunSetup({ onAccountVerified }: { readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void }) {
  const { width } = useWindowDimensions()
  const mobile = width < MOBILE_BREAKPOINT
  const content = <AccountSetupFlow mode="first-run" fetchImpl={RuntimeBackend.jmapFetch} onAccountVerified={onAccountVerified} />
  if (mobile) return <ScrollView style={styles.firstRunScroll} contentContainerStyle={[styles.firstRunShell, styles.firstRunShellMobile]}>{content}</ScrollView>
  return <View style={styles.firstRunShell}>{content}</View>
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}
