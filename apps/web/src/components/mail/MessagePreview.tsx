import { createElement, useEffect, useRef, useState } from "react"
import { Platform, ScrollView, Text, View } from "react-native"
import { EmailHtml, MailModel } from "../../backend"
import { htmlPreviewFrameStyle } from "../../layoutConstants"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { Ui } from "../primitives"
import { FlagButton } from "./FlagButton"
import { MailUi } from "./mailUi"

type EmailAttachmentPart = MailModel.EmailAttachmentPart
type ComposeMode = MailModel.ComposeMode
type MailMessage = MailModel.MailMessage
type RemoteContentMode = MailModel.RemoteContentMode

const { Button, MaterialActionIcon, Spinner } = Ui
const C = Theme.colors

export function MessagePreview({ message, loading, loadingInlineImages, loadingAttachmentKey, loadingFlagMessageKeys, error, inlineImageError, attachmentError, remoteImageProxyBase, mobile, onBack, onComposeFromMessage, onToggleMessageFlag, onLoadInlineImages, onOpenAttachment, onDownloadAttachment, onDownloadAllAttachments }: {
  readonly message: MailMessage | undefined
  readonly loading: boolean
  readonly loadingInlineImages: boolean
  readonly loadingAttachmentKey: string | undefined
  readonly loadingFlagMessageKeys: Record<string, true>
  readonly error: string | undefined
  readonly inlineImageError: string | undefined
  readonly attachmentError: string | undefined
  readonly remoteImageProxyBase: string | undefined
  readonly mobile?: boolean
  readonly onBack?: () => void
  readonly onComposeFromMessage: (mode: Exclude<ComposeMode, "new">) => void
  readonly onToggleMessageFlag: (key: string) => void
  readonly onLoadInlineImages: (key: string) => void
  readonly onOpenAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
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
  const htmlPreview = EmailHtml.previewForMessage(message, remoteContentMode, remoteImageProxyBase)
  const plainBodyText = EmailHtml.plainBodyTextForMessage(message)
  const attachments = MailUi.messageAttachmentDisplayParts(message)
  const canLoadInlineImages = (message.inlineImages?.length ?? 0) > 0
  return (
    <>
      <ScrollView style={[styles.readerPane, mobile === true && styles.readerPaneMobile]} contentContainerStyle={styles.readerContent}>
        <View style={[styles.readerTitleRow, mobile === true && styles.readerTitleRowMobile]}>
          {onBack === undefined ? null : <Button kind="hollow" leading={<MaterialActionIcon name="arrow-back" size={18} color={C.icon} />} accessibilityLabel="Back to message list" onPress={onBack} style={styles.toolbarIconControl} />}
          <Text style={[styles.readerTitle, mobile === true && styles.readerTitleMobile]}>{message.subject || "(no subject)"}</Text>
          <FlagButton flagState={message.flagState} loading={loadingFlagMessageKeys[message.key] === true} onPress={() => onToggleMessageFlag(message.key)} />
        </View>
        <Text style={styles.readerMeta}>From {message.from || "Unknown sender"}</Text>
        <Text style={styles.readerMeta}>To {message.to.length === 0 ? "Undisclosed recipients" : message.to.join(", ")}</Text>
        <Text style={styles.readerMeta}>{MailUi.formatMessageDate(message.receivedAt ?? message.sentAt)}</Text>
        <View style={styles.readerActionRow}>
          <Button kind="filled" leading={<MaterialActionIcon name="reply" size={14} color={C.accentContrast} />} label="Reply" onPress={() => onComposeFromMessage("reply")} style={styles.readerActionButton} textStyle={styles.compactButtonText} />
          <Button kind="hollow" leading={<MaterialActionIcon name="reply-all" size={14} color={C.icon} />} label="Reply all" onPress={() => onComposeFromMessage("reply-all")} style={styles.readerActionButton} textStyle={styles.compactButtonText} />
          <Button kind="hollow" leading={<MaterialActionIcon name="forward" size={14} color={C.icon} />} label="Forward" onPress={() => onComposeFromMessage("forward")} style={styles.readerActionButton} textStyle={styles.compactButtonText} />
        </View>
        <AttachmentList messageKey={message.key} attachments={attachments} loadingAttachmentKey={loadingAttachmentKey} onOpenAttachment={onOpenAttachment} onDownloadAttachment={onDownloadAttachment} onDownloadAllAttachments={onDownloadAllAttachments} />
        {attachmentError === undefined ? null : <Text style={styles.errorText}>{attachmentError}</Text>}
        {loading && message.bodyLoaded !== true ? (
          <View style={styles.readerLoading}><Spinner /></View>
        ) : error !== undefined ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : message.bodyLoaded !== true ? (
          <Text style={styles.readerBody}>Click a message to load contents.</Text>
        ) : htmlPreview === undefined ? (
          <Text style={styles.readerBody}>{plainBodyText || "No message body available."}</Text>
        ) : (
          <View style={styles.htmlPreviewBlock}>
            {htmlPreview.blockedInlineImages === 0 ? null : (
              <View style={styles.inlineContentNotice}>
                <Text style={styles.inlineContentText}>{htmlPreview.blockedInlineImages} inline image{htmlPreview.blockedInlineImages === 1 ? "" : "s"} blocked until loaded from this message.</Text>
                {canLoadInlineImages ? <Button kind="hollow" label="Load inline images" loading={loadingInlineImages} disabled={loadingInlineImages} onPress={() => onLoadInlineImages(message.key)} /> : <Text style={styles.inlineContentText}>Server did not provide matching inline image parts.</Text>}
                {inlineImageError === undefined ? null : <Text style={styles.errorText}>{inlineImageError}</Text>}
              </View>
            )}
            {htmlPreview.blockedRemoteUrls === 0 || remoteContentMode !== "blocked" ? null : (
              <View style={styles.remoteContentNotice}>
                <Text style={styles.remoteContentText}>{htmlPreview.blockedRemoteUrls} remote item{htmlPreview.blockedRemoteUrls === 1 ? "" : "s"} blocked to protect your IP address.</Text>
                <Button kind="hollow" label="Load" onPress={() => setRemoteContentModes((current) => ({ ...current, [message.key]: "direct" }))} />
                {remoteImageProxyBase === undefined ? null : <Button kind="hollow" label="Load via configured proxy" onPress={() => setRemoteContentModes((current) => ({ ...current, [message.key]: "proxy" }))} />}
              </View>
            )}
            <HtmlPreview html={htmlPreview.html} />
          </View>
        )}
      </ScrollView>
    </>
  )
}

function AttachmentList({ messageKey, attachments, loadingAttachmentKey, onOpenAttachment, onDownloadAttachment, onDownloadAllAttachments }: {
  readonly messageKey: string
  readonly attachments: readonly EmailAttachmentPart[]
  readonly loadingAttachmentKey: string | undefined
  readonly onOpenAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAttachment: (messageKey: string, attachment: EmailAttachmentPart, index: number) => void
  readonly onDownloadAllAttachments: (messageKey: string) => void
}) {
  if (attachments.length === 0) return null
  const allActionKey = `${messageKey}:attachments:all`
  return (
    <View style={styles.attachmentList}>
      <View style={styles.attachmentListHeader}>
        <Text style={styles.attachmentListTitle}>{attachments.length} Attachment{attachments.length === 1 ? "" : "s"}</Text>
        {attachments.length > 1 ? <Button kind="hollow" leading={<MaterialActionIcon name="archive" size={11} color={C.icon} />} label="Download zip" loading={loadingAttachmentKey === allActionKey} disabled={loadingAttachmentKey !== undefined} onPress={() => onDownloadAllAttachments(messageKey)} style={styles.compactButton} textStyle={styles.compactButtonText} /> : null}
      </View>
      <View style={styles.attachmentGrid}>
        {attachments.map((attachment, index) => {
          const actionKey = MailUi.attachmentActionKey(messageKey, attachment, index)
          const loading = loadingAttachmentKey === actionKey
          return (
            <Button key={MailUi.attachmentKey(attachment, index)} kind="hollow" accessibilityLabel={`Open ${attachment.name}`} disabled={loadingAttachmentKey !== undefined} onPress={() => onOpenAttachment(messageKey, attachment, index)} style={styles.attachmentItem}>
              <View style={styles.attachmentFileText}>
                <Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text>
                <Text numberOfLines={1} style={styles.attachmentMeta}>{MailUi.attachmentMetaText(attachment)}</Text>
              </View>
              <View style={styles.attachmentActions}>
                {loading ? <Spinner /> : null}
                <Button kind="hollow" leading={<MaterialActionIcon name="file-download" size={17} color={C.icon} />} accessibilityLabel={`Download ${attachment.name}`} disabled={loadingAttachmentKey !== undefined} onPress={() => onDownloadAttachment(messageKey, attachment, index)} stopPropagation style={styles.squareIconButton} />
              </View>
            </Button>
          )
        })}
      </View>
    </View>
  )
}

function HtmlPreview({ html }: { readonly html: string }) {
  const [height, setHeight] = useState(1)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    if (Platform.OS !== "web") return
    setHeight(1)
    const frame = frameRef.current
    if (frame === null) return
    let observer: ResizeObserver | undefined
    let cancelled = false
    const resize = () => {
      if (!cancelled) resizeHtmlPreviewFrame(frame, setHeight)
    }
    const watchFrame = () => {
      resize()
      const document = frame.contentDocument
      if (document === null || typeof ResizeObserver === "undefined") return
      observer?.disconnect()
      observer = new ResizeObserver(resize)
      observer.observe(document.documentElement)
      observer.observe(document.body)
    }
    frame.addEventListener("load", watchFrame)
    watchFrame()
    const timeout = globalThis.setTimeout(resize, 50)
    return () => {
      cancelled = true
      frame.removeEventListener("load", watchFrame)
      observer?.disconnect()
      globalThis.clearTimeout(timeout)
    }
  }, [html])
  if (Platform.OS !== "web") return <Text style={styles.readerBody}>{EmailHtml.stripHtml(html)}</Text>
  return createElement("iframe", {
    ref: frameRef,
    referrerPolicy: "no-referrer",
    sandbox: "allow-same-origin",
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
