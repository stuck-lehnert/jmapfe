import { Pressable, type GestureResponderEvent } from "react-native"
import { MailModel } from "../../backend"
import { styles } from "../../styles"
import { Ui } from "../primitives"
import { MailUi } from "./mailUi"

const { MaterialActionIcon, Spinner } = Ui

export function FlagButton({ flagState, loading, onPress }: { readonly flagState: MailModel.MessageFlagState; readonly loading: boolean; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={MailUi.flagButtonLabel(flagState)} onPress={(event: GestureResponderEvent) => { event.stopPropagation(); if (!loading) onPress() }} style={[styles.clickable, styles.flagButton, loading && styles.buttonDisabled]}>
      {loading ? <Spinner /> : <MaterialActionIcon name={MailUi.flagIconName(flagState)} size={18} color={MailUi.flagIconColor(flagState)} />}
    </Pressable>
  )
}
