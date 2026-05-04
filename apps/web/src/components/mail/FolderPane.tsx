import type { ConfiguredAccount } from "@jmapfe/app-core"
import { createElement, type DragEvent as ReactDragEvent } from "react"
import { Platform, Pressable, ScrollView, Text, View } from "react-native"
import { MailModel } from "../../backend"
import { folderPaneResizeStyle } from "../../layoutConstants"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { ResizablePane } from "../layout"
import { Ui } from "../primitives"
import { MailUi } from "./mailUi"

type AccountMailState = MailModel.AccountMailState
type MaterialIconName = Ui.MaterialIconName

const { Button, MaterialActionIcon } = Ui
const C = Theme.colors

export function FolderPane({ accounts, mailByAccount, selectedFolder, draggedMessageKey, onSelectFolder, onDropMessageToFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly draggedMessageKey: string | undefined
  readonly onSelectFolder: (folderId: string) => void
  readonly onDropMessageToFolder: (messageKey: string, folderId: string) => void
}) {
  return (
    <ResizablePane style={folderPaneResizeStyle} fallbackStyle={styles.folderPaneFallback}>
      <FolderPaneContent accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} draggedMessageKey={draggedMessageKey} onSelectFolder={onSelectFolder} onDropMessageToFolder={onDropMessageToFolder} />
    </ResizablePane>
  )
}

export function MobileFolderDrawer({ accounts, mailByAccount, selectedFolder, draggedMessageKey, onSelectFolder, onDropMessageToFolder, onClose }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly draggedMessageKey: string | undefined
  readonly onSelectFolder: (folderId: string) => void
  readonly onDropMessageToFolder: (messageKey: string, folderId: string) => void
  readonly onClose: () => void
}) {
  return (
    <View style={styles.folderDrawerBackdrop}>
      <Pressable accessibilityLabel="Close folders" style={[styles.clickable, styles.folderDrawerScrim]} onPress={onClose} />
      <View style={styles.folderDrawerPanel}>
        <View style={styles.folderDrawerHeader}>
          <Text style={styles.paneHeader}>Folders</Text>
          <Button kind="hollow" leading={<MaterialActionIcon name="close" size={11} color={C.icon} />} label="Close" onPress={onClose} style={styles.compactButton} textStyle={styles.compactButtonText} />
        </View>
        <FolderPaneContent accounts={accounts} mailByAccount={mailByAccount} selectedFolder={selectedFolder} draggedMessageKey={draggedMessageKey} onSelectFolder={onSelectFolder} onDropMessageToFolder={onDropMessageToFolder} hideHeader />
      </View>
    </View>
  )
}

function FolderPaneContent({ accounts, mailByAccount, selectedFolder, draggedMessageKey, hideHeader, onSelectFolder, onDropMessageToFolder }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly mailByAccount: Record<string, AccountMailState>
  readonly selectedFolder: string
  readonly draggedMessageKey: string | undefined
  readonly hideHeader?: boolean
  readonly onSelectFolder: (folderId: string) => void
  readonly onDropMessageToFolder: (messageKey: string, folderId: string) => void
}) {
  return (
    <ScrollView style={styles.folderPaneScroll} contentContainerStyle={styles.folderPaneContent}>
      {hideHeader === true ? null : <Text style={styles.paneHeader}>Folders</Text>}
      <FolderButton icon="inbox" label="Unified Inbox" count={MailUi.countMessagesForFolder(accounts, mailByAccount, "unified:inbox")} active={selectedFolder === "unified:inbox"} onPress={() => onSelectFolder("unified:inbox")} />
      <FolderButton icon="send" label="All Sent" count={MailUi.countMessagesForFolder(accounts, mailByAccount, "unified:sent")} active={selectedFolder === "unified:sent"} onPress={() => onSelectFolder("unified:sent")} />
      <FolderButton icon="drafts" label="All Drafts" count={MailUi.countMessagesForFolder(accounts, mailByAccount, "unified:drafts")} active={selectedFolder === "unified:drafts"} onPress={() => onSelectFolder("unified:drafts")} />

      <Text style={styles.sectionHeader}>Accounts</Text>
      {accounts.map((account) => (
        <View key={account.id} style={styles.accountTree}>
          <View style={styles.accountTreeHeader}>
            <Text numberOfLines={1} style={styles.accountTreeName}>{account.email}</Text>
            <Text numberOfLines={1} style={styles.accountTreeServer}>{account.serverKey}</Text>
            <Text numberOfLines={1} style={mailByAccount[account.id]?.status === "error" ? styles.accountTreeError : styles.accountTreeStatus}>{MailUi.accountFolderStatusText(mailByAccount[account.id])}</Text>
          </View>
          {MailUi.accountFolders(account, mailByAccount[account.id]).map((folder) => {
            const id = folder.folderId
            const dropEnabled = MailUi.canDropMessageOnFolder(mailByAccount, draggedMessageKey, id)
            return <FolderButton key={id} icon={folder.icon} label={folder.label} count={folder.count} level={folder.level} badges={folder.badges} active={selectedFolder === id} dropEnabled={dropEnabled} onPress={() => onSelectFolder(id)} onDropMessage={(messageKey) => onDropMessageToFolder(messageKey, id)} />
          })}
        </View>
      ))}
    </ScrollView>
  )
}

function FolderButton({ icon, label, count, level = 0, badges = [], active, dropEnabled, onPress, onDropMessage }: { readonly icon: MaterialIconName; readonly label: string; readonly count?: number | undefined; readonly level?: number | undefined; readonly badges?: readonly string[] | undefined; readonly active: boolean; readonly dropEnabled?: boolean; readonly onPress: () => void; readonly onDropMessage?: (messageKey: string) => void }) {
  const button = (
    <Button kind="ghost" onPress={onPress} style={[styles.folderButton, level > 0 && { paddingLeft: 6 + level * 12 }, active && styles.folderButtonActive, dropEnabled === true && styles.folderButtonDropTarget]}>
      <MaterialActionIcon name={icon} size={16} color={active ? C.accentActive : C.textMuted} />
      <View style={styles.folderLabelGroup}>
        <Text numberOfLines={1} style={[styles.folderButtonText, active && styles.folderButtonTextActive]}>{label}</Text>
        {badges.length === 0 ? null : <Text numberOfLines={1} style={[styles.folderBadgeText, active && styles.folderButtonTextActive]}>{badges.join(" · ")}</Text>}
      </View>
      {count === undefined ? null : <Text style={[styles.folderCount, active && styles.folderButtonTextActive]}>{count}</Text>}
    </Button>
  )
  if (Platform.OS !== "web" || dropEnabled !== true || onDropMessage === undefined) return button
  return createElement("div", {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      const messageKey = event.dataTransfer.getData("application/x-jmapfe-message-key") || event.dataTransfer.getData("text/plain")
      if (messageKey.length > 0) onDropMessage(messageKey)
    },
  }, button)
}
