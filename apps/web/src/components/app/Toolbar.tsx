import { ScrollView, Text, View } from "react-native"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { Ui } from "../primitives"

const { Button, MaterialActionIcon } = Ui
const C = Theme.colors

export function Toolbar({ view, mobile, showFoldersButton, onOpenFolders, onOpenMail, onWrite, onGetMessages, onOpenSettings }: {
  readonly view: "mail" | "settings"
  readonly mobile?: boolean
  readonly showFoldersButton?: boolean
  readonly onOpenFolders?: () => void
  readonly onOpenMail: () => void
  readonly onWrite: () => void
  readonly onGetMessages: () => void
  readonly onOpenSettings: () => void
}) {
  const actions = (
    <>
      <Button kind={view === "mail" ? "filled" : "hollow"} leading={<MaterialActionIcon name="sync" size={14} color={view === "mail" ? C.accentContrast : C.icon} />} label="Get Messages" onPress={onGetMessages} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind="hollow" leading={<MaterialActionIcon name="edit" size={14} color={C.icon} />} label="Write" onPress={onWrite} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind="hollow" leading={<MaterialActionIcon name="contacts" size={14} color={C.icon} />} label="Address Book" onPress={onOpenMail} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind={view === "settings" ? "filled" : "hollow"} leading={<MaterialActionIcon name="settings" size={14} color={view === "settings" ? C.accentContrast : C.icon} />} label="Settings" onPress={onOpenSettings} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
    </>
  )
  return (
    <View style={[styles.toolbar, mobile === true && styles.toolbarMobile]}>
      <View style={styles.toolbarTitleRow}>
        {showFoldersButton === true && onOpenFolders !== undefined ? <Button kind="hollow" leading={<MaterialActionIcon name="menu" size={18} color={C.icon} />} accessibilityLabel="Open folders" onPress={onOpenFolders} style={styles.toolbarIconControl} /> : null}
        <Text style={[styles.toolbarTitle, mobile === true && styles.toolbarTitleMobile]}>jmapfe Mail</Text>
      </View>
      {mobile === true ? <ScrollView horizontal style={styles.toolbarActionsScroller} contentContainerStyle={styles.toolbarActionsMobile} showsHorizontalScrollIndicator={false}>{actions}</ScrollView> : <View style={styles.toolbarActions}>{actions}</View>}
    </View>
  )
}
