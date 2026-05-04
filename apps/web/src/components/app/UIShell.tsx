import type { ConfiguredAccount } from "@jmapfe/app-core"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { MailModel } from "../../backend"
import { DIVIDER_WIDTH, MAX_FOLDER_PANE_WIDTH, MIN_FOLDER_PANE_WIDTH, MIN_MESSAGE_PANE_WIDTH } from "../../layoutConstants"
import { styles } from "../../styles"
import type { AppearanceMode } from "../../theme"
import { PaneDivider } from "../layout"
import { FolderPane, MailWorkspace, MobileFolderDrawer } from "../mail"
import { Settings } from "./Settings"
import { Toolbar } from "./Toolbar"
import { VaultUnlock } from "./VaultUnlock"

type AccountMailState = MailModel.AccountMailState
type AppView = "mail" | "settings"
type ComposeDraft = MailModel.ComposeDraft
type ComposeMode = MailModel.ComposeMode
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type SearchState = MailModel.SearchState

export interface UIShellLoadingState {
  readonly moreFolder: string | undefined
  readonly messageKey: string | undefined
  readonly inlineImageKey: string | undefined
  readonly attachmentKey: string | undefined
  readonly flagMessageKeys: Record<string, true>
}

export interface UIShellMailErrors {
  readonly messageBody: string | undefined
  readonly inlineImage: string | undefined
  readonly attachment: string | undefined
}

export function UIShell({
  view,
  mobile,
  notice,
  accounts,
  mailByAccount,
  selectedFolder,
  selectedMessageKey,
  folderDrawerOpen,
  draggedMessageKey,
  loading,
  mailErrors,
  searchDraft,
  searchState,
  remoteImageProxyBase,
  appearanceMode,
  composeDraft,
  composeSending,
  composeError,
  settingsAccountSetup,
  vaultUnlock,
  onOpenFolders,
  onOpenMail,
  onWrite,
  onGetMessages,
  onOpenSettings,
  onSelectFolder,
  onDropMessageToFolder,
  onCloseFolderDrawer,
  onRemoteImageProxyChange,
  onAppearanceModeChange,
  onDeleteAccount,
  onSearchDraftChange,
  onSearch,
  onClearSearch,
  onComposeDraftChange,
  onCloseCompose,
  onSendCompose,
  onComposeFromMessage,
  onSelectMessage,
  onCloseMessage,
  onToggleMessageFlag,
  onMarkMessageReadState,
  onDeleteMessage,
  onStartMessageDrag,
  onEndMessageDrag,
  onLoadInlineImages,
  onOpenAttachment,
  onDownloadAttachment,
  onDownloadAllAttachments,
  onLoadMoreFolder,
}: {
  readonly view: AppView
  readonly mobile: boolean
  readonly notice: string | undefined
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly selectedMessageKey: string | undefined
  readonly folderDrawerOpen: boolean
  readonly draggedMessageKey: string | undefined
  readonly loading: UIShellLoadingState
  readonly mailErrors: UIShellMailErrors
  readonly searchDraft: string
  readonly searchState: SearchState
  readonly remoteImageProxyBase: string | undefined
  readonly appearanceMode: AppearanceMode
  readonly composeDraft: ComposeDraft | undefined
  readonly composeSending: boolean
  readonly composeError: string | undefined
  readonly settingsAccountSetup: ReactNode
  readonly vaultUnlock: { readonly masterPassword: string; readonly error: string | undefined; readonly onChange: (value: string) => void; readonly onUnlock: () => void } | undefined
  readonly onOpenFolders: () => void
  readonly onOpenMail: () => void
  readonly onWrite: () => void
  readonly onGetMessages: () => void
  readonly onOpenSettings: () => void
  readonly onSelectFolder: (folderId: string) => void
  readonly onDropMessageToFolder: (messageKey: string, folderId: string) => void
  readonly onCloseFolderDrawer: () => void
  readonly onRemoteImageProxyChange: (value: string | undefined) => void
  readonly onAppearanceModeChange: (value: AppearanceMode) => void
  readonly onDeleteAccount: (accountId: string) => void
  readonly onSearchDraftChange: (value: string) => void
  readonly onSearch: () => void
  readonly onClearSearch: () => void
  readonly onComposeDraftChange: (updates: Partial<ComposeDraft>) => void
  readonly onCloseCompose: () => void
  readonly onSendCompose: () => void
  readonly onComposeFromMessage: (messageKey: string, mode: Exclude<ComposeMode, "new">) => void
  readonly onSelectMessage: (messageKey: string) => void
  readonly onCloseMessage: () => void
  readonly onToggleMessageFlag: (messageKey: string) => void
  readonly onMarkMessageReadState: (messageKey: string, read: boolean) => void
  readonly onDeleteMessage: (messageKey: string) => void
  readonly onStartMessageDrag: (messageKey: string) => void
  readonly onEndMessageDrag: () => void
  readonly onLoadInlineImages: (messageKey: string) => void
  readonly onOpenAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
  readonly onLoadMoreFolder: (folderId: string) => void
}) {
  return (
    <View style={styles.shell}>
      <Toolbar view={view} mobile={mobile} showFoldersButton={mobile} onOpenFolders={onOpenFolders} onOpenMail={onOpenMail} onWrite={onWrite} onGetMessages={onGetMessages} onOpenSettings={onOpenSettings} />
      {notice === undefined ? null : <Text style={styles.notice}>{notice}</Text>}
      {vaultUnlock === undefined ? null : <VaultUnlock masterPassword={vaultUnlock.masterPassword} error={vaultUnlock.error} onChange={vaultUnlock.onChange} onUnlock={vaultUnlock.onUnlock} />}
      <View style={styles.workspace}>
        {mobile ? null : <FolderPane accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} draggedMessageKey={draggedMessageKey} onSelectFolder={onSelectFolder} onDropMessageToFolder={onDropMessageToFolder} />}
        {mobile ? null : <PaneDivider minWidth={MIN_FOLDER_PANE_WIDTH} maxWidth={MAX_FOLDER_PANE_WIDTH} minTrailingWidth={view === "mail" ? MIN_MESSAGE_PANE_WIDTH * 2 + DIVIDER_WIDTH : MIN_MESSAGE_PANE_WIDTH} />}
        {view === "settings" ? (
          <Settings accounts={accounts} remoteImageProxyBase={remoteImageProxyBase} appearanceMode={appearanceMode} accountSetup={settingsAccountSetup} onRemoteImageProxyChange={onRemoteImageProxyChange} onAppearanceModeChange={onAppearanceModeChange} onDeleteAccount={onDeleteAccount} />
        ) : (
          <MailWorkspace accounts={accounts} selectedFolder={selectedFolder} mailByAccount={mailByAccount} selectedMessageKey={selectedMessageKey} mobile={mobile} loadingMoreFolder={loading.moreFolder} loadingMessageKey={loading.messageKey} loadingInlineImageKey={loading.inlineImageKey} loadingAttachmentKey={loading.attachmentKey} loadingFlagMessageKeys={loading.flagMessageKeys} messageBodyError={mailErrors.messageBody} inlineImageError={mailErrors.inlineImage} attachmentError={mailErrors.attachment} searchDraft={searchDraft} searchState={searchState} remoteImageProxyBase={remoteImageProxyBase} composeDraft={composeDraft} composeSending={composeSending} composeError={composeError} onComposeDraftChange={onComposeDraftChange} onCloseCompose={onCloseCompose} onSendCompose={onSendCompose} onComposeFromMessage={onComposeFromMessage} onSearchDraftChange={onSearchDraftChange} onSearch={onSearch} onClearSearch={onClearSearch} onSelectMessage={onSelectMessage} onCloseMessage={onCloseMessage} onToggleMessageFlag={onToggleMessageFlag} onMarkMessageReadState={onMarkMessageReadState} onDeleteMessage={onDeleteMessage} onStartMessageDrag={onStartMessageDrag} onEndMessageDrag={onEndMessageDrag} onLoadInlineImages={onLoadInlineImages} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} onDownloadAllAttachments={onDownloadAllAttachments} onLoadMoreFolder={onLoadMoreFolder} />
        )}
      </View>
      {mobile && folderDrawerOpen ? <MobileFolderDrawer accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} draggedMessageKey={draggedMessageKey} onSelectFolder={onSelectFolder} onDropMessageToFolder={onDropMessageToFolder} onClose={onCloseFolderDrawer} /> : null}
    </View>
  )
}
