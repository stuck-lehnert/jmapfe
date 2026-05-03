import { createElement, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { Platform, View, type ViewStyle } from "react-native"
import { DIVIDER_WIDTH, MIN_MESSAGE_PANE_WIDTH, paneDividerStyle } from "../layoutConstants"
import { styles } from "../styles"

export function PaneDivider({ minWidth = MIN_MESSAGE_PANE_WIDTH, maxWidth, minTrailingWidth = MIN_MESSAGE_PANE_WIDTH }: {
  readonly minWidth?: number
  readonly maxWidth?: number
  readonly minTrailingWidth?: number
}) {
  if (Platform.OS === "web") {
    return createElement("div", {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => startPaneResize(
        event,
        maxWidth === undefined ? { minWidth, minTrailingWidth } : { minWidth, maxWidth, minTrailingWidth },
      ),
      style: paneDividerStyle,
    })
  }
  return <View style={styles.dragDivider} />
}

function startPaneResize(
  event: ReactPointerEvent<HTMLDivElement>,
  options: { readonly minWidth: number; readonly maxWidth?: number; readonly minTrailingWidth: number },
): void {
  event.preventDefault()
  const divider = event.currentTarget
  const pane = divider.previousElementSibling as HTMLElement | null
  const container = divider.parentElement as HTMLElement | null
  if (pane === null || container === null) return

  const startX = event.clientX
  const startWidth = pane.getBoundingClientRect().width
  const previousUserSelect = document.body.style.userSelect
  const previousCursor = document.body.style.cursor
  document.body.style.userSelect = "none"
  document.body.style.cursor = "col-resize"

  const resize = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault()
    const containerWidth = container.getBoundingClientRect().width
    const computedMaxWidth = Math.max(options.minWidth, containerWidth - options.minTrailingWidth - DIVIDER_WIDTH)
    const maxWidth = options.maxWidth === undefined ? computedMaxWidth : Math.min(options.maxWidth, computedMaxWidth)
    const nextWidth = clamp(startWidth + moveEvent.clientX - startX, options.minWidth, maxWidth)
    pane.style.flexBasis = `${nextWidth}px`
    pane.style.width = `${nextWidth}px`
  }

  const stop = () => {
    document.body.style.userSelect = previousUserSelect
    document.body.style.cursor = previousCursor
    globalThis.removeEventListener("pointermove", resize)
    globalThis.removeEventListener("pointerup", stop)
    globalThis.removeEventListener("pointercancel", stop)
  }

  globalThis.addEventListener("pointermove", resize)
  globalThis.addEventListener("pointerup", stop, { once: true })
  globalThis.addEventListener("pointercancel", stop, { once: true })
}

export function ResizablePane({ style, fallbackStyle, children }: {
  readonly style: CSSProperties
  readonly fallbackStyle: ViewStyle
  readonly children: ReactNode
}) {
  if (Platform.OS === "web") return createElement("div", { style }, children)
  return <View style={fallbackStyle}>{children}</View>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
