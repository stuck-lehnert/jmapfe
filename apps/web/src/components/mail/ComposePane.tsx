import type { ConfiguredAccount } from "@jmapfe/app-core"
import { ScrollView, Text, TextInput, View } from "react-native"
import { MailModel } from "../../backend"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { Ui } from "../primitives"

type ComposeDraft = MailModel.ComposeDraft
type ComposeMode = MailModel.ComposeMode

const { Button, MaterialActionIcon } = Ui
const C = Theme.colors

export function ComposePane({ accounts, draft, sending, error, mobile, onChange, onClose, onSend }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly draft: ComposeDraft
  readonly sending: boolean
  readonly error: string | undefined
  readonly mobile: boolean
  readonly onChange: (updates: Partial<ComposeDraft>) => void
  readonly onClose: () => void
  readonly onSend: () => void
}) {
  const account = accounts.find((item) => item.id === draft.accountId) ?? accounts[0]
  return (
    <ScrollView style={[styles.composePane, mobile && styles.composePaneMobile]} contentContainerStyle={styles.composeContent}>
      <View style={styles.composeHeader}>
        <View style={styles.composeTitleGroup}>
          <Text style={styles.composeKicker}>{composeModeLabel(draft.mode)}</Text>
          <Text style={styles.composeTitle}>{draft.subject.trim() || "New message"}</Text>
          {account === undefined ? <Text style={styles.errorText}>No configured account can send mail.</Text> : <Text style={styles.composeMeta}>From {account.displayName} &lt;{account.email}&gt;</Text>}
        </View>
        <Button kind="hollow" leading={<MaterialActionIcon name="close" size={18} color={C.icon} />} accessibilityLabel="Discard compose" disabled={sending} onPress={onClose} style={styles.toolbarIconControl} />
      </View>

      {accounts.length <= 1 ? null : (
        <View style={styles.composeAccountList}>
          {accounts.map((item) => (
            <Button key={item.id} kind={item.id === draft.accountId ? "filled" : "hollow"} label={item.email} disabled={sending} onPress={() => onChange({ accountId: item.id })} style={styles.composeAccountButton} textStyle={styles.compactButtonText} />
          ))}
        </View>
      )}

      <View style={styles.composeFields}>
        <ComposeField label="To" value={draft.to} placeholder="person@example.com" editable={!sending} onChangeText={(to) => onChange({ to })} />
        <ComposeField label="Cc" value={draft.cc} placeholder="Optional" editable={!sending} onChangeText={(cc) => onChange({ cc })} />
        <ComposeField label="Bcc" value={draft.bcc} placeholder="Optional" editable={!sending} onChangeText={(bcc) => onChange({ bcc })} />
        <ComposeField label="Subject" value={draft.subject} placeholder="Subject" editable={!sending} onChangeText={(subject) => onChange({ subject })} />
        <View style={styles.composeField}>
          <Text style={styles.fieldLabel}>Message</Text>
          <TextInput value={draft.body} placeholder="Write mail..." placeholderTextColor={C.placeholder} editable={!sending} onChangeText={(body) => onChange({ body })} multiline textAlignVertical="top" style={[styles.input, styles.composeBodyInput]} />
        </View>
      </View>

      {error === undefined ? null : <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.composeActions}>
        <Button kind="ghost" label="Discard" disabled={sending} onPress={onClose} />
        <Button kind="filled" leading={<MaterialActionIcon name="send" size={15} color={C.accentContrast} />} label="Send" loading={sending} disabled={account === undefined} onPress={onSend} />
      </View>
    </ScrollView>
  )
}

function ComposeField({ label, value, placeholder, editable, onChangeText }: { readonly label: string; readonly value: string; readonly placeholder: string; readonly editable: boolean; readonly onChangeText: (value: string) => void }) {
  return (
    <View style={styles.composeField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor={C.placeholder} editable={editable} onChangeText={onChangeText} autoCapitalize="none" style={[styles.input, styles.composeInput]} />
    </View>
  )
}

function composeModeLabel(mode: ComposeMode): string {
  if (mode === "reply") return "Reply"
  if (mode === "reply-all") return "Reply all"
  if (mode === "forward") return "Forward"
  return "Write"
}
