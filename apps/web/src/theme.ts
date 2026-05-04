export type AppearanceMode = "system" | "light" | "dark"

export namespace Theme {
  export const APPEARANCE_MODES: readonly AppearanceMode[] = ["system", "light", "dark"]

  export const colors = {
    accent: cssVar("accent"),
    accentActive: cssVar("accent-active"),
    accentBorder: cssVar("accent-border"),
    accentContrast: cssVar("accent-contrast"),
    accentHover: cssVar("accent-hover"),
    accentSoft: cssVar("accent-soft"),
    authActiveText: cssVar("auth-active-text"),
    avatarBg: cssVar("avatar-bg"),
    border: cssVar("border"),
    borderSoft: cssVar("border-soft"),
    borderStrong: cssVar("border-strong"),
    dangerBg: cssVar("danger-bg"),
    dangerBorder: cssVar("danger-border"),
    dangerText: cssVar("danger-text"),
    divider: cssVar("divider"),
    doneBg: cssVar("done-bg"),
    doneBgActive: cssVar("done-bg-active"),
    dropBg: cssVar("drop-bg"),
    dropBorder: cssVar("drop-border"),
    flaggedBg: cssVar("flagged-bg"),
    flaggedBgActive: cssVar("flagged-bg-active"),
    icon: cssVar("icon"),
    inputBg: cssVar("input-bg"),
    noticeBg: cssVar("notice-bg"),
    noticeBorder: cssVar("notice-border"),
    noticeText: cssVar("notice-text"),
    placeholder: cssVar("placeholder"),
    readerBg: cssVar("reader-bg"),
    scrim: cssVar("scrim"),
    setupBg: cssVar("setup-bg"),
    shadow: cssVar("shadow"),
    shellBg: cssVar("shell-bg"),
    statusOkBg: cssVar("status-ok-bg"),
    statusOkText: cssVar("status-ok-text"),
    surface: cssVar("surface"),
    surfaceAlt: cssVar("surface-alt"),
    surfaceInset: cssVar("surface-inset"),
    text: cssVar("text"),
    textMuted: cssVar("text-muted"),
    textSoft: cssVar("text-soft"),
    textStrong: cssVar("text-strong"),
    toolbarBg: cssVar("toolbar-bg"),
    toolbarBorder: cssVar("toolbar-border"),
    toolbarText: cssVar("toolbar-text"),
    warningBg: cssVar("warning-bg"),
    warningBorder: cssVar("warning-border"),
    warningText: cssVar("warning-text"),
  } as const

  export function isAppearanceMode(value: unknown): value is AppearanceMode {
    return typeof value === "string" && APPEARANCE_MODES.includes(value as AppearanceMode)
  }

  export function applyAppearanceMode(mode: AppearanceMode): void {
    const document = globalThis.document
    if (document === undefined) return
    ensureThemeStyle(document)
    const root = document.documentElement
    if (mode === "system") {
      root.removeAttribute("data-jmapfe-theme")
      root.style.colorScheme = "light dark"
    } else {
      root.setAttribute("data-jmapfe-theme", mode)
      root.style.colorScheme = mode
    }
  }

  export function emailPreviewCss(): string {
    return `:root{color-scheme:light dark;${LIGHT_VARS}}@media (prefers-color-scheme: dark){:root{${DARK_VARS}}}`
  }
}

function cssVar(name: string): string {
  return `var(--jf-${name})`
}

function ensureThemeStyle(document: Document): void {
  if (document.getElementById("jmapfe-theme-vars") !== null) return
  const style = document.createElement("style")
  style.id = "jmapfe-theme-vars"
  style.textContent = THEME_CSS
  document.head.prepend(style)
}

const LIGHT_VARS = `
  --jf-accent: #0b63ce;
  --jf-accent-active: #074a91;
  --jf-accent-border: #7aa7e8;
  --jf-accent-contrast: #ffffff;
  --jf-accent-hover: #084f9d;
  --jf-accent-soft: #e7f1ff;
  --jf-auth-active-text: #255f9f;
  --jf-avatar-bg: #dbeafe;
  --jf-border: #cbd7e3;
  --jf-border-soft: #e2e8f0;
  --jf-border-strong: #94a3b8;
  --jf-danger-bg: #fff1f2;
  --jf-danger-border: #fecdd3;
  --jf-danger-text: #9f1239;
  --jf-divider: #c8d3df;
  --jf-done-bg: #f0fdf4;
  --jf-done-bg-active: #dcfce7;
  --jf-drop-bg: #e0f2fe;
  --jf-drop-border: #38bdf8;
  --jf-flagged-bg: #fffbeb;
  --jf-flagged-bg-active: #fef3c7;
  --jf-icon: #24364e;
  --jf-input-bg: #ffffff;
  --jf-notice-bg: #dff0ff;
  --jf-notice-border: #9fc9ef;
  --jf-notice-text: #174d7c;
  --jf-placeholder: #718096;
  --jf-reader-bg: #f8fafc;
  --jf-scrim: rgba(15, 23, 42, 0.34);
  --jf-setup-bg: #eaf1f8;
  --jf-shadow: #0f172a;
  --jf-shell-bg: #e9eef5;
  --jf-status-ok-bg: #dcfce7;
  --jf-status-ok-text: #166534;
  --jf-surface: #ffffff;
  --jf-surface-alt: #fbfdff;
  --jf-surface-inset: #e6edf6;
  --jf-text: #24364e;
  --jf-text-muted: #64748b;
  --jf-text-soft: #4b5f77;
  --jf-text-strong: #172033;
  --jf-toolbar-bg: #101b2d;
  --jf-toolbar-border: #22324a;
  --jf-toolbar-text: #f8fbff;
  --jf-warning-bg: #fff7ed;
  --jf-warning-border: #fed7aa;
  --jf-warning-text: #7c2d12;
`

const DARK_VARS = `
  --jf-accent: #5ba7ff;
  --jf-accent-active: #9dccff;
  --jf-accent-border: #2f6faa;
  --jf-accent-contrast: #06111f;
  --jf-accent-hover: #87bdff;
  --jf-accent-soft: #102946;
  --jf-auth-active-text: #9dccff;
  --jf-avatar-bg: #12345a;
  --jf-border: #2d4058;
  --jf-border-soft: #24364c;
  --jf-border-strong: #53677f;
  --jf-danger-bg: #34131d;
  --jf-danger-border: #7f1d1d;
  --jf-danger-text: #fda4af;
  --jf-divider: #24364c;
  --jf-done-bg: #0f2a1c;
  --jf-done-bg-active: #143724;
  --jf-drop-bg: #0d3147;
  --jf-drop-border: #38bdf8;
  --jf-flagged-bg: #2e2410;
  --jf-flagged-bg-active: #3b2d12;
  --jf-icon: #d4e4f7;
  --jf-input-bg: #0f1a2a;
  --jf-notice-bg: #0e2b47;
  --jf-notice-border: #24577f;
  --jf-notice-text: #bae6fd;
  --jf-placeholder: #7d8da3;
  --jf-reader-bg: #0d1420;
  --jf-scrim: rgba(0, 0, 0, 0.58);
  --jf-setup-bg: #0b1320;
  --jf-shadow: #000000;
  --jf-shell-bg: #0b1320;
  --jf-status-ok-bg: #0f2a1c;
  --jf-status-ok-text: #86efac;
  --jf-surface: #111c2b;
  --jf-surface-alt: #162235;
  --jf-surface-inset: #0f1a2a;
  --jf-text: #d7e4f4;
  --jf-text-muted: #9aa9bb;
  --jf-text-soft: #b7c6d9;
  --jf-text-strong: #f3f7fb;
  --jf-toolbar-bg: #07101d;
  --jf-toolbar-border: #1f334b;
  --jf-toolbar-text: #f3f7fb;
  --jf-warning-bg: #301f12;
  --jf-warning-border: #8a4b1c;
  --jf-warning-text: #fed7aa;
`

const THEME_CSS = `
:root {
  color-scheme: light dark;
${LIGHT_VARS}}

@media (prefers-color-scheme: dark) {
  :root:not([data-jmapfe-theme="light"]) {
${DARK_VARS}  }
}

:root[data-jmapfe-theme="dark"] {
${DARK_VARS}}

:root[data-jmapfe-theme="light"] {
${LIGHT_VARS}}

html, body, #root {
  background: var(--jf-shell-bg);
}
`
