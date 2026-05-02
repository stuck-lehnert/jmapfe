export interface StatusRow {
  readonly label: string
  readonly value: string
  readonly severity: "ok" | "warn" | "blocked"
}

export function createStartupRows(): readonly StatusRow[] {
  return [
    { label: "CORS", value: "Web requires server allowlist", severity: "warn" },
    { label: "Transport", value: "Desktop uses local bridge", severity: "ok" },
    { label: "Cache", value: "SQLite schema defined", severity: "ok" },
    { label: "Crypto", value: "OpenPGP must not overclaim trust", severity: "warn" },
  ]
}
