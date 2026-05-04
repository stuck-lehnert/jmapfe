import type { ConfiguredAccount } from "@jmapfe/app-core"
import { createElement, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react"
import { Platform, Pressable, ScrollView, Text, View } from "react-native"
import { MailModel } from "../../backend"
import { styles } from "../../styles"
import { Ui } from "../primitives"
import { FlagButton } from "./FlagButton"
import { MailUi } from "./mailUi"

type MailMessage = MailModel.MailMessage

const { Button } = Ui

export function MessageList({ accounts, messages, selectedMessageKey, loadingFlagMessageKeys, canLoadMore, loadingMore, onSelectMessage, onOpenMessageContextMenu, onToggleMessageFlag, onStartMessageDrag, onEndMessageDrag, onLoadMore }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly messages: readonly MailMessage[]
  readonly selectedMessageKey: string | undefined
  readonly loadingFlagMessageKeys: Record<string, true>
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onSelectMessage: (key: string) => void
  readonly onOpenMessageContextMenu: (key: string, x: number, y: number) => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onStartMessageDrag: (key: string) => void
  readonly onEndMessageDrag: () => void
  readonly onLoadMore: () => void
}) {
  const openContextMenu = (message: MailMessage, x: number, y: number) => {
    onOpenMessageContextMenu(message.key, x, y)
  }
  return (
    <View style={styles.messageListShell}>
      <ScrollView style={styles.messageList}>
        {messages.map((message) => {
          const attachmentLabels = MailUi.messageAttachmentLabels(message)
          const row = (
            <Pressable onLongPress={(event) => { onSelectMessage(message.key); openContextMenu(message, event.nativeEvent.pageX, event.nativeEvent.pageY) }} onPress={() => onSelectMessage(message.key)} style={[styles.clickable, styles.messageRow, message.flagState === "flagged" && styles.messageRowFlagged, message.flagState === "done" && styles.messageRowDone, selectedMessageKey === message.key && styles.messageRowActive, selectedMessageKey === message.key && message.flagState === "flagged" && styles.messageRowFlaggedActive, selectedMessageKey === message.key && message.flagState === "done" && styles.messageRowDoneActive]}>
              <View style={styles.messageRowTop}>
                <View style={styles.messageSenderGroup}>
                  {message.read ? null : <View style={styles.unreadMarker} />}
                  <Text numberOfLines={1} style={[styles.messageSender, message.read && styles.messageSenderRead]}>{message.from || MailUi.accountEmailForMessage(accounts, message)}</Text>
                </View>
                <View style={styles.messageRowActions}>
                  <Text style={styles.messageDate}>{MailUi.formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
                  <FlagButton flagState={message.flagState} loading={loadingFlagMessageKeys[message.key] === true} onPress={() => onToggleMessageFlag(message.key)} />
                </View>
              </View>
              <Text numberOfLines={1} style={[styles.messageSubject, message.read && styles.messageSubjectRead]}>{message.subject || "(no subject)"}</Text>
              <Text numberOfLines={1} style={styles.messageMetaText}>To {message.to.length === 0 ? "Undisclosed recipients" : message.to.join(", ")}</Text>
              {attachmentLabels.length === 0 ? null : <Text style={styles.attachmentText}>{attachmentLabels.join(" · ")}</Text>}
            </Pressable>
          )
          if (Platform.OS !== "web") return <View key={message.key}>{row}</View>
          return createElement("div", {
            key: message.key,
            draggable: true,
            onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
              event.preventDefault()
              event.stopPropagation()
              onSelectMessage(message.key)
              openContextMenu(message, event.clientX, event.clientY)
            },
            onDragStart: (event: ReactDragEvent<HTMLElement>) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("application/x-jmapfe-message-key", message.key)
              event.dataTransfer.setData("text/plain", message.key)
              onStartMessageDrag(message.key)
            },
            onDragEnd: onEndMessageDrag,
            style: { cursor: "grab" },
          }, row)
        })}
        {canLoadMore ? <View style={styles.loadMoreArea}><Button kind="hollow" label="Load more" loading={loadingMore} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
      </ScrollView>
    </View>
  )
}
