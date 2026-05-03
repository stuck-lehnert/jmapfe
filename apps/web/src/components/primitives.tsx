import { MaterialIcons } from "@expo/vector-icons"
import { ActivityIndicator, Pressable, StyleSheet, Text, type GestureResponderEvent, type ViewStyle } from "react-native"

export namespace Ui {
  export type MaterialIconName = keyof typeof MaterialIcons.glyphMap

  export function IconButton({ icon, accessibilityLabel, disabled, onPress }: { readonly icon: MaterialIconName; readonly accessibilityLabel: string; readonly disabled?: boolean; readonly onPress: () => void }) {
    return (
      <Pressable accessibilityLabel={accessibilityLabel} onPress={(event: GestureResponderEvent) => { event.stopPropagation(); if (disabled !== true) onPress() }} style={[styles.clickable, styles.iconButton, disabled && styles.buttonDisabled]}>
        <MaterialActionIcon name={icon} size={17} color="#24364e" />
      </Pressable>
    )
  }

  export function TinyButton({ icon, label, loading, disabled, onPress }: { readonly icon?: MaterialIconName; readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
    return (
      <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.tinyButton, disabled && styles.buttonDisabled]}>
        {loading === true ? <Spinner /> : icon === undefined ? null : <MaterialActionIcon name={icon} size={11} color="#24364e" />}
        <Text style={styles.tinyButtonText}>{label}</Text>
      </Pressable>
    )
  }

  export function PrimaryButton({ label, loading, disabled, onPress }: { readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
    return (
      <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.primaryButton, disabled && styles.buttonDisabled]}>
        {loading === true ? <Spinner color="#ffffff" /> : null}
        <Text style={styles.primaryButtonText}>{label}</Text>
      </Pressable>
    )
  }

  export function SecondaryButton({ label, loading, disabled, onPress }: { readonly label: string; readonly loading?: boolean; readonly disabled?: boolean; readonly onPress: () => void }) {
    return (
      <Pressable onPress={disabled ? undefined : onPress} style={[styles.clickable, styles.secondaryButton, disabled && styles.buttonDisabled]}>
        {loading === true ? <Spinner /> : null}
        <Text style={styles.secondaryButtonText}>{label}</Text>
      </Pressable>
    )
  }

  export function ToolbarButton({ icon, label, active, onPress }: { readonly icon: MaterialIconName; readonly label: string; readonly active?: boolean; readonly onPress: () => void }) {
    const color = active === true ? "#0b4f9c" : "#25364d"
    return (
      <Pressable onPress={onPress} style={[styles.clickable, styles.toolbarButton, active && styles.toolbarButtonActive]}>
        <MaterialActionIcon name={icon} size={14} color={color} />
        <Text style={[styles.toolbarButtonText, active && styles.toolbarButtonTextActive]}>{label}</Text>
      </Pressable>
    )
  }

  export function ToolbarIconButton({ icon, accessibilityLabel, onPress }: { readonly icon: MaterialIconName; readonly accessibilityLabel: string; readonly onPress: () => void }) {
    return (
      <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={[styles.clickable, styles.toolbarIconButton]}>
        <MaterialActionIcon name={icon} size={18} color="#25364d" />
      </Pressable>
    )
  }

  export function Spinner({ color = "#24364e" }: { readonly color?: string }) {
    return <ActivityIndicator size="small" color={color} />
  }

  export function MaterialActionIcon({ name, size, color }: { readonly name: MaterialIconName; readonly size: number; readonly color: string }) {
    return <MaterialIcons name={name} size={size} color={color} />
  }
}

const styles = StyleSheet.create({
  clickable: { cursor: "pointer" } as unknown as ViewStyle,
  toolbarButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#c5d2e0", borderWidth: 1, flexDirection: "row", flexShrink: 0, gap: 4, justifyContent: "center", paddingHorizontal: 8, paddingVertical: 5 },
  toolbarButtonActive: { backgroundColor: "#dbeafe", borderColor: "#7aa7e8" },
  toolbarButtonText: { alignSelf: "center", color: "#25364d", fontSize: 11, fontWeight: "700", includeFontPadding: false, lineHeight: 11, paddingTop: 1, textAlign: "center", textAlignVertical: "center" } as unknown as ViewStyle,
  toolbarButtonTextActive: { color: "#0b4f9c" },
  toolbarIconButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#c5d2e0", borderWidth: 1, flexShrink: 0, height: 30, justifyContent: "center", width: 30 },
  iconButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  tinyButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 6, paddingVertical: 3 },
  tinyButtonText: { color: "#24364e", fontSize: 10, fontWeight: "800" },
  primaryButton: { alignItems: "center", backgroundColor: "#0b63ce", flexDirection: "row", gap: 5, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 6 },
  primaryButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  secondaryButton: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#b7c5d4", borderWidth: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 6 },
  secondaryButtonText: { color: "#24364e", fontSize: 12, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  buttonDisabled: { cursor: "default", opacity: 0.55 } as unknown as ViewStyle,
})
