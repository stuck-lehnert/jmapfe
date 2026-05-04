import { MaterialIcons } from "@expo/vector-icons"
import { useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native"

export namespace Ui {
  export type MaterialIconName = keyof typeof MaterialIcons.glyphMap
  export type ButtonKind = "filled" | "hollow" | "ghost"

  export interface ButtonProps {
    readonly kind: ButtonKind
    readonly label?: string
    readonly children?: ReactNode
    readonly leading?: ReactNode
    readonly trailing?: ReactNode
    readonly loading?: boolean
    readonly disabled?: boolean
    readonly accessibilityLabel?: string
    readonly onPress?: () => void
    readonly onClick?: () => void
    readonly stopPropagation?: boolean
    readonly style?: StyleProp<ViewStyle>
    readonly textStyle?: StyleProp<TextStyle>
  }

  export function Button({ kind, label, children, leading, trailing, loading, disabled, accessibilityLabel, onPress, onClick, stopPropagation, style, textStyle }: ButtonProps) {
    const [hovered, setHovered] = useState(false)
    const [pressed, setPressed] = useState(false)
    const unavailable = loading === true || disabled === true
    const action = onPress ?? onClick
    const spinnerColor = kind === "filled" ? "#ffffff" : "#24364e"
    const content = children ?? (label === undefined ? null : <Text style={[styles.buttonText, buttonTextStyle(kind), textStyle, unavailable && styles.buttonTextDisabled]}>{label}</Text>)
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => { setHovered(false); setPressed(false) }}
        onPress={(event: GestureResponderEvent) => {
          if (stopPropagation === true) event.stopPropagation()
          if (unavailable !== true) action?.()
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.button, buttonStyle(kind), style, !unavailable && hovered && buttonHoverStyle(kind), !unavailable && pressed && styles.buttonPressed, unavailable && styles.buttonDisabled]}
      >
        {leading === undefined ? null : <View style={styles.buttonSlot}>{leading}</View>}
        {loading === true ? <Spinner color={spinnerColor} /> : null}
        {content}
        {trailing === undefined ? null : <View style={styles.buttonTrailingSlot}>{trailing}</View>}
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
  button: { alignItems: "center", borderWidth: 1, cursor: "pointer", flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 6 } as unknown as ViewStyle,
  buttonFilled: { backgroundColor: "#0b63ce", borderColor: "#0b63ce" },
  buttonFilledHover: { backgroundColor: "#084f9d", borderColor: "#084f9d" },
  buttonGhost: { backgroundColor: "transparent", borderColor: "transparent" },
  buttonGhostHover: { backgroundColor: "#e7f1ff", borderColor: "#e7f1ff" },
  buttonHollow: { backgroundColor: "#ffffff", borderColor: "#b7c5d4" },
  buttonHollowHover: { backgroundColor: "#eef6ff", borderColor: "#7aa7e8" },
  buttonPressed: { transform: [{ translateY: 1 }] },
  buttonDisabled: { cursor: "default", opacity: 0.55 } as unknown as ViewStyle,
  buttonSlot: { alignItems: "center", justifyContent: "center" },
  buttonTrailingSlot: { alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  buttonText: { fontSize: 12, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  buttonTextFilled: { color: "#ffffff" },
  buttonTextGhost: { color: "#24364e" },
  buttonTextHollow: { color: "#24364e" },
  buttonTextDisabled: { color: "#64748b" },
})

function buttonStyle(kind: Ui.ButtonKind): ViewStyle {
  if (kind === "filled") return styles.buttonFilled
  if (kind === "ghost") return styles.buttonGhost
  return styles.buttonHollow
}

function buttonHoverStyle(kind: Ui.ButtonKind): ViewStyle {
  if (kind === "filled") return styles.buttonFilledHover
  if (kind === "ghost") return styles.buttonGhostHover
  return styles.buttonHollowHover
}

function buttonTextStyle(kind: Ui.ButtonKind): TextStyle {
  if (kind === "filled") return styles.buttonTextFilled
  if (kind === "ghost") return styles.buttonTextGhost
  return styles.buttonTextHollow
}
