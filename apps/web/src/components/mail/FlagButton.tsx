import { MailModel } from "../../backend"
import { styles } from "../../styles"
import { Ui } from "../primitives"
import { MailUi } from "./mailUi"

const { Button, MaterialActionIcon } = Ui

export function FlagButton({ flagState, loading, onPress }: { readonly flagState: MailModel.MessageFlagState; readonly loading: boolean; readonly onPress: () => void }) {
  return <Button kind="ghost" accessibilityLabel={MailUi.flagButtonLabel(flagState)} leading={<MaterialActionIcon name={MailUi.flagIconName(flagState)} size={18} color={MailUi.flagIconColor(flagState)} />} loading={loading} onPress={onPress} stopPropagation style={styles.flagButton} />
}
