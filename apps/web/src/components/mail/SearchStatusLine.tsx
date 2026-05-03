import { Text, View } from "react-native"
import { MailModel } from "../../backend"
import { styles } from "../../styles"
import { Ui } from "../primitives"
import { MailUi } from "./mailUi"

const { Spinner } = Ui

export function SearchStatusLine({ searchState, loadedCount }: { readonly searchState: MailModel.SearchState; readonly loadedCount: number }) {
  const text = MailUi.searchStatusText(searchState, loadedCount)
  if (searchState.status === "searching") {
    return (
      <View style={styles.statusInline}>
        <Spinner />
        {text.length === 0 ? null : <Text style={styles.threadSubtle}>{text}</Text>}
      </View>
    )
  }
  return <Text style={searchState.status === "error" ? styles.statusError : styles.threadSubtle}>{text}</Text>
}
