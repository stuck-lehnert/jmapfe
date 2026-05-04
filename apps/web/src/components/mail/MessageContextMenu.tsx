import { createElement, type MouseEvent as ReactMouseEvent } from "react"
import { Platform, Pressable, View, useWindowDimensions } from "react-native"
import { MailModel } from "../../backend"
import { contextMenuBackdropWebStyle } from "../../layoutConstants"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { Ui } from "../primitives"
import { MailUi } from "./mailUi"

type MailMessage = MailModel.MailMessage
type MessageContextMenuState = MailModel.MessageContextMenuState
type MaterialIconName = Ui.MaterialIconName

const { Button, MaterialActionIcon } = Ui
const C = Theme.colors

export function MessageContextMenu({ state, message, onClose, onToggleMessageFlag, onMarkMessageReadState, onDeleteMessage }: {
  readonly state: MessageContextMenuState | undefined
  readonly message: MailMessage | undefined
  readonly onClose: () => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onMarkMessageReadState: (key: string, read: boolean) => void
  readonly onDeleteMessage: (key: string) => void
}) {
  const { width, height } = useWindowDimensions()
  if (state === undefined || message === undefined) return null
  const left = clamp(state.x, 8, Math.max(8, width - 218))
  const top = clamp(state.y, 8, Math.max(8, height - 170))
  return (
    <View style={[styles.contextMenuLayer, Platform.OS === "web" && styles.contextMenuLayerWeb]}>
      <ContextMenuBackdrop onClose={onClose} />
      <View style={[styles.contextMenu, { left, top }]}>
        <ContextMenuItem icon={message.read ? "mail" : "drafts"} label={message.read ? "Mark unread" : "Mark read"} onPress={() => { onMarkMessageReadState(message.key, !message.read); onClose() }} />
        <ContextMenuItem icon={MailUi.flagIconName(message.flagState)} label={MailUi.flagButtonLabel(message.flagState)} onPress={() => { onToggleMessageFlag(message.key); onClose() }} />
        <ContextMenuItem icon="delete" label="Delete" destructive onPress={() => { onDeleteMessage(message.key); onClose() }} />
      </View>
    </View>
  )
}

function ContextMenuBackdrop({ onClose }: { readonly onClose: () => void }) {
  if (Platform.OS === "web") {
    return createElement("div", {
      onClick: onClose,
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault()
        onClose()
      },
      style: contextMenuBackdropWebStyle,
    })
  }
  return <Pressable accessibilityLabel="Close message menu" style={styles.contextMenuBackdrop} onPress={onClose} />
}

function ContextMenuItem({ icon, label, destructive, onPress }: { readonly icon: MaterialIconName; readonly label: string; readonly destructive?: boolean; readonly onPress: () => void }) {
  const color = destructive === true ? C.dangerText : C.textStrong
  return <Button kind="ghost" leading={<MaterialActionIcon name={icon} size={16} color={color} />} label={label} onPress={onPress} stopPropagation style={styles.contextMenuItem} textStyle={[styles.contextMenuText, destructive === true && styles.contextMenuTextDestructive]} />
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
