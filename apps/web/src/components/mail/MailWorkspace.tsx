import type { ConfiguredAccount } from "@jmapfe/app-core"
import { useState } from "react"
import { Text, TextInput, View } from "react-native"
import { MailModel } from "../../backend"
import { MIN_MESSAGE_PANE_WIDTH, threadPaneResizeStyle } from "../../layoutConstants"
import { styles } from "../../styles"
import { PaneDivider, ResizablePane } from "../layout"
import { Ui } from "../primitives"
import { EmptyThreadList } from "./EmptyThreadList"
import { MessageContextMenu } from "./MessageContextMenu"
import { MessageList } from "./MessageList"
import { MessagePreview } from "./MessagePreview"
import { SearchStatusLine } from "./SearchStatusLine"
import { MailUi } from "./mailUi"

type AccountMailState = MailModel.AccountMailState
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type MessageContextMenuState = MailModel.MessageContextMenuState
type SearchState = MailModel.SearchState

const { Button } = Ui

export function MailWorkspace({ accounts, selectedFolder, mailByAccount, selectedMessageKey, mobile, loadingMoreFolder, loadingMessageKey, loadingInlineImageKey, loadingAttachmentKey, loadingFlagMessageKeys, messageBodyError, inlineImageError, attachmentError, searchDraft, searchState, remoteImageProxyBase, onSearchDraftChange, onSearch, onClearSearch, onSelectMessage, onCloseMessage, onToggleMessageFlag, onMarkMessageReadState, onDeleteMessage, onStartMessageDrag, onEndMessageDrag, onLoadInlineImages, onOpenAttachment, onDownloadAttachment, onDownloadAllAttachments, onLoadMoreFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedMessageKey: string | undefined
  readonly mobile: boolean
  readonly loadingMoreFolder: string | undefined
  readonly loadingMessageKey: string | undefined
  readonly loadingInlineImageKey: string | undefined
  readonly loadingAttachmentKey: string | undefined
  readonly loadingFlagMessageKeys: Record<string, true>
  readonly messageBodyError: string | undefined
  readonly inlineImageError: string | undefined
  readonly attachmentError: string | undefined
  readonly searchDraft: string
  readonly searchState: SearchState
  readonly remoteImageProxyBase: string | undefined
  readonly onSearchDraftChange: (value: string) => void
  readonly onSearch: () => void
  readonly onClearSearch: () => void
  readonly onSelectMessage: (key: string) => void
  readonly onCloseMessage: () => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onMarkMessageReadState: (key: string, read: boolean) => void
  readonly onDeleteMessage: (key: string) => void
  readonly onStartMessageDrag: (key: string) => void
  readonly onEndMessageDrag: () => void
  readonly onLoadInlineImages: (key: string) => void
  readonly onOpenAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
  readonly onLoadMoreFolder: (folderId: string) => void
}) {
  const title = MailUi.folderTitle(accounts, mailByAccount, selectedFolder)
  const searchActive = searchState.status !== "idle" && searchState.folderId === selectedFolder
  const messages = searchActive ? MailUi.messagesForKeys(mailByAccount, searchState.messageKeys) : MailUi.messagesForFolder(accounts, mailByAccount, selectedFolder)
  const selectedMessage = messages.find((message) => message.key === selectedMessageKey)
  const [contextMenu, setContextMenu] = useState<MessageContextMenuState | undefined>()
  const contextMenuMessage = contextMenu === undefined ? undefined : messages.find((message) => message.key === contextMenu.messageKey)
  const syncMessage = MailUi.mailStatusText(accounts, mailByAccount)
  const canLoadMore = !searchActive && MailUi.canLoadMoreFolder(accounts, mailByAccount, selectedFolder)
  const loadingMore = loadingMoreFolder === selectedFolder
  const threadPane = (
    <>
      <View style={styles.threadHeader}>
        <Text style={styles.threadTitle}>{title}</Text>
        {syncMessage.length === 0 ? null : <Text style={styles.threadSubtle}>{syncMessage}</Text>}
        <View style={[styles.searchRow, mobile && styles.searchRowMobile]}>
          <TextInput value={searchDraft} placeholder="Search this folder on server" placeholderTextColor="#718096" onChangeText={onSearchDraftChange} onSubmitEditing={onSearch} autoCapitalize="none" returnKeyType="search" style={styles.searchInput} />
          <Button kind="hollow" label="Search" loading={searchState.status === "searching"} disabled={searchState.status === "searching"} onPress={onSearch} />
          {searchActive ? <Button kind="ghost" label="Clear" onPress={onClearSearch} /> : null}
        </View>
        {searchActive ? <SearchStatusLine searchState={searchState} loadedCount={messages.length} /> : null}
      </View>
      {messages.length === 0
        ? <EmptyThreadList accounts={accounts} selectedFolder={selectedFolder} searchActive={searchActive} canLoadMore={canLoadMore} loadingMore={loadingMore} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />
        : <MessageList accounts={accounts} messages={messages} selectedMessageKey={selectedMessageKey} loadingFlagMessageKeys={loadingFlagMessageKeys} canLoadMore={canLoadMore} loadingMore={loadingMore} onSelectMessage={onSelectMessage} onOpenMessageContextMenu={(messageKey, x, y) => setContextMenu({ messageKey, x, y })} onToggleMessageFlag={onToggleMessageFlag} onStartMessageDrag={onStartMessageDrag} onEndMessageDrag={onEndMessageDrag} onLoadMore={() => onLoadMoreFolder(selectedFolder)} />}
    </>
  )
  const preview = <MessagePreview message={selectedMessage} loading={selectedMessageKey !== undefined && loadingMessageKey === selectedMessageKey} loadingInlineImages={selectedMessageKey !== undefined && loadingInlineImageKey === selectedMessageKey} loadingAttachmentKey={loadingAttachmentKey} loadingFlagMessageKeys={loadingFlagMessageKeys} error={messageBodyError} inlineImageError={inlineImageError} attachmentError={attachmentError} remoteImageProxyBase={remoteImageProxyBase} mobile={mobile} {...(mobile ? { onBack: onCloseMessage } : {})} onToggleMessageFlag={onToggleMessageFlag} onLoadInlineImages={onLoadInlineImages} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} onDownloadAllAttachments={onDownloadAllAttachments} />
  const menu = <MessageContextMenu state={contextMenu} message={contextMenuMessage} onClose={() => setContextMenu(undefined)} onToggleMessageFlag={onToggleMessageFlag} onMarkMessageReadState={onMarkMessageReadState} onDeleteMessage={onDeleteMessage} />
  if (mobile && selectedMessage !== undefined) return <View style={styles.mailWorkspaceMobile}>{preview}{menu}</View>
  return (
    <View style={[styles.mailWorkspace, mobile && styles.mailWorkspaceMobile]}>
      {mobile ? <View style={styles.threadPaneMobile}>{threadPane}</View> : <ResizablePane style={threadPaneResizeStyle} fallbackStyle={styles.threadPaneFallback}>{threadPane}</ResizablePane>}
      {mobile ? null : <PaneDivider minWidth={MIN_MESSAGE_PANE_WIDTH} minTrailingWidth={MIN_MESSAGE_PANE_WIDTH} />}
      {mobile ? null : preview}
      {menu}
    </View>
  )
}
