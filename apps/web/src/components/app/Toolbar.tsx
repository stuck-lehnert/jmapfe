import { ScrollView, Text, View } from "react-native"
import { styles } from "../../styles"
import { Ui } from "../primitives"

const { Button, MaterialActionIcon } = Ui

export function Toolbar({ view, mobile, showFoldersButton, onOpenFolders, onOpenMail, onGetMessages, onOpenSettings }: {
  readonly view: "mail" | "settings"
  readonly mobile?: boolean
  readonly showFoldersButton?: boolean
  readonly onOpenFolders?: () => void
  readonly onOpenMail: () => void
  readonly onGetMessages: () => void
  readonly onOpenSettings: () => void
}) {
  const actions = (
    <>
      <Button kind={view === "mail" ? "filled" : "hollow"} leading={<MaterialActionIcon name="sync" size={14} color={view === "mail" ? "#ffffff" : "#24364e"} />} label="Get Messages" onPress={onGetMessages} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind="hollow" leading={<MaterialActionIcon name="edit" size={14} color="#24364e" />} label="Write" onPress={onOpenMail} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind="hollow" leading={<MaterialActionIcon name="contacts" size={14} color="#24364e" />} label="Address Book" onPress={onOpenMail} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
      <Button kind={view === "settings" ? "filled" : "hollow"} leading={<MaterialActionIcon name="settings" size={14} color={view === "settings" ? "#ffffff" : "#24364e"} />} label="Settings" onPress={onOpenSettings} style={styles.toolbarActionControl} textStyle={styles.toolbarActionText} />
    </>
  )
  return (
    <View style={[styles.toolbar, mobile === true && styles.toolbarMobile]}>
      <View style={styles.toolbarTitleRow}>
        {showFoldersButton === true && onOpenFolders !== undefined ? <Button kind="hollow" leading={<MaterialActionIcon name="menu" size={18} color="#24364e" />} accessibilityLabel="Open folders" onPress={onOpenFolders} style={styles.toolbarIconControl} /> : null}
        <Text style={[styles.toolbarTitle, mobile === true && styles.toolbarTitleMobile]}>jmapfe Mail</Text>
      </View>
      {mobile === true ? <ScrollView horizontal style={styles.toolbarActionsScroller} contentContainerStyle={styles.toolbarActionsMobile} showsHorizontalScrollIndicator={false}>{actions}</ScrollView> : <View style={styles.toolbarActions}>{actions}</View>}
    </View>
  )
}
