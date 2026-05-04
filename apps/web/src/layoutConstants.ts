import type { CSSProperties } from "react"
import { Theme } from "./theme"

const C = Theme.colors

export const DEFAULT_FOLDER_PANE_WIDTH = 168
export const MIN_FOLDER_PANE_WIDTH = 120
export const MAX_FOLDER_PANE_WIDTH = 280
export const MIN_MESSAGE_PANE_WIDTH = 220
export const DIVIDER_WIDTH = 7
export const MOBILE_BREAKPOINT = 760

export const folderPaneResizeStyle: CSSProperties = {
  backgroundColor: C.surfaceInset,
  boxSizing: "border-box",
  display: "flex",
  flex: "0 0 auto",
  flexDirection: "column",
  maxWidth: MAX_FOLDER_PANE_WIDTH,
  minWidth: MIN_FOLDER_PANE_WIDTH,
  overflow: "auto",
  resize: "horizontal",
  width: DEFAULT_FOLDER_PANE_WIDTH,
}

export const threadPaneResizeStyle: CSSProperties = {
  backgroundColor: C.surface,
  boxSizing: "border-box",
  display: "flex",
  flex: "0 0 auto",
  flexDirection: "column",
  maxWidth: `calc(100% - ${MIN_MESSAGE_PANE_WIDTH + DIVIDER_WIDTH}px)`,
  minWidth: MIN_MESSAGE_PANE_WIDTH,
  overflow: "auto",
  resize: "horizontal",
  width: "50%",
}

export const paneDividerStyle: CSSProperties = {
  backgroundColor: C.divider,
  cursor: "col-resize",
  flex: `0 0 ${DIVIDER_WIDTH}px`,
  height: "100%",
  touchAction: "none",
  userSelect: "none",
  width: DIVIDER_WIDTH,
}

export const htmlPreviewFrameStyle: CSSProperties = {
  border: "0",
  display: "block",
  overflow: "hidden",
  width: "100%",
}

export const contextMenuBackdropWebStyle: CSSProperties = {
  bottom: 0,
  left: 0,
  position: "absolute",
  right: 0,
  top: 0,
}
