import { configuredAccountServerLabel, type ConfiguredAccount } from "@jmapfe/app-core"
import { useEffect, useState, type ReactNode } from "react"
import { ScrollView, Text, TextInput, View } from "react-native"
import { styles } from "../../styles"
import { Theme, type AppearanceMode } from "../../theme"
import { Ui } from "../primitives"

const { Button } = Ui

export function Settings({ accounts, remoteImageProxyBase, appearanceMode, accountSetup, onRemoteImageProxyChange, onAppearanceModeChange, onDeleteAccount }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly remoteImageProxyBase: string | undefined
  readonly appearanceMode: AppearanceMode
  readonly accountSetup: ReactNode
  readonly onRemoteImageProxyChange: (value: string | undefined) => void
  readonly onAppearanceModeChange: (value: AppearanceMode) => void
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
          {accountSetup}
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Configured Accounts</Text>
          {accounts.map((account) => (
            <View key={account.id} style={styles.manageAccountRow}>
              <AccountSummary account={account} />
              <Button kind="hollow" label="Remove" onPress={() => onDeleteAccount(account.id)} />
            </View>
          ))}
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Appearance</Text>
          <Text style={styles.flowCopy}>System follows `prefers-color-scheme`. Light and dark override it locally.</Text>
          <View style={styles.themeModeRow}>
            {Theme.APPEARANCE_MODES.map((mode) => <Button key={mode} kind={appearanceMode === mode ? "filled" : "hollow"} label={appearanceModeLabel(mode)} onPress={() => onAppearanceModeChange(mode)} style={styles.themeModeButton} />)}
          </View>
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Remote Content Proxy</Text>
          <Text style={styles.flowCopy}>Leave blank to load remote images directly only after you press Load. Add an HTTPS proxy endpoint to enable extra proxy load option. Use {"{url}"} as placeholder, or accept url query parameter.</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Proxy URL</Text>
            <TextInput value={remoteImageProxyDraft} placeholder="https://proxy.example/image?url={url}" placeholderTextColor={Theme.colors.placeholder} onChangeText={setRemoteImageProxyDraft} autoCapitalize="none" style={styles.input} />
          </View>
          <View style={styles.flowButtons}>
            <Button kind="hollow" label="Clear" disabled={remoteImageProxyDraft.trim().length === 0 && remoteImageProxyBase === undefined} onPress={clearRemoteImageProxy} />
            <Button kind="filled" label="Save" onPress={saveRemoteImageProxy} />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

function appearanceModeLabel(mode: AppearanceMode): string {
  if (mode === "system") return "System"
  if (mode === "dark") return "Dark"
  return "Light"
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
