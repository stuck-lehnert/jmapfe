import type { ConfiguredAccount } from "@jmapfe/app-core"
import { Text, View } from "react-native"
import { styles } from "../../styles"
import { Ui } from "../primitives"

const { Button } = Ui

export function EmptyThreadList({ accounts, selectedFolder, searchActive, canLoadMore, loadingMore, onLoadMore }: {
  readonly accounts: readonly ConfiguredAccount[]
  readonly selectedFolder: string
  readonly searchActive: boolean
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
}) {
  const selectedAccount = accounts.find((account) => selectedFolder.startsWith(`${account.id}:`))
  return (
    <View style={styles.emptyThreads}>
      <Text style={styles.emptyTitle}>{searchActive ? "No search results" : "No synced mail yet"}</Text>
      <Text style={styles.emptyCopy}>
        {searchActive
          ? "Server-side search found no messages in this folder."
          : selectedAccount === undefined
          ? "Unified Inbox is ready to merge incoming mail from all accounts."
          : `${selectedAccount.email} is configured. Its folders will fill after mailbox sync is wired.`}
      </Text>
      {canLoadMore ? <View style={styles.loadMoreArea}><Button kind="hollow" label="Load messages" loading={loadingMore} disabled={loadingMore} onPress={onLoadMore} /></View> : null}
    </View>
  )
}
