import { ScrollView, Text, View } from "react-native"
import { styles } from "../../styles"
import { Ui } from "../primitives"

const { ToolbarButton, ToolbarIconButton } = Ui

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
      <ToolbarButton icon="sync" label="Get Messages" onPress={onGetMessages} active={view === "mail"} />
      <ToolbarButton icon="edit" label="Write" onPress={onOpenMail} />
      <ToolbarButton icon="contacts" label="Address Book" onPress={onOpenMail} />
      <ToolbarButton icon="settings" label="Settings" onPress={onOpenSettings} active={view === "settings"} />
    </>
  )
  return (
    <View style={[styles.toolbar, mobile === true && styles.toolbarMobile]}>
      <View style={styles.toolbarTitleRow}>
        {showFoldersButton === true && onOpenFolders !== undefined ? <ToolbarIconButton icon="menu" accessibilityLabel="Open folders" onPress={onOpenFolders} /> : null}
        <Text style={[styles.toolbarTitle, mobile === true && styles.toolbarTitleMobile]}>jmapfe Mail</Text>
      </View>
      {mobile === true ? <ScrollView horizontal style={styles.toolbarActionsScroller} contentContainerStyle={styles.toolbarActionsMobile} showsHorizontalScrollIndicator={false}>{actions}</ScrollView> : <View style={styles.toolbarActions}>{actions}</View>}
    </View>
  )
}
