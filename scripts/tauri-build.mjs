import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const requested = process.argv[2]
const extraArgs = process.argv.slice(3)

const targets = {
  linux: "x86_64-unknown-linux-gnu",
  windows: "x86_64-pc-windows-msvc",
  macos: "universal-apple-darwin",
}

const target = targets[requested]
if (target === undefined) {
  console.error(`Usage: node scripts/tauri-build.mjs ${Object.keys(targets).join("|")}`)
  process.exit(1)
}

const tauriArgs = ["--target", target, ...extraArgs]
if (process.env.TAURI_SKIP_FRONTEND_BUILD === "true") {
  const skipConfigPath = join(mkdtempSync(join(tmpdir(), "jmapfe-tauri-")), "skip-frontend.json")
  writeFileSync(skipConfigPath, JSON.stringify({ build: { beforeBuildCommand: null } }))
  tauriArgs.push("--config", skipConfigPath)
}

runNpm(["--workspace", "@jmapfe/desktop-tauri", "run", "build", "--", ...tauriArgs], requested === "linux" ? { NO_STRIP: process.env.NO_STRIP ?? "true" } : {})

function runNpm(args, env = {}) {
  const npmExecPath = process.env.npm_execpath
  const command = npmExecPath === undefined ? process.platform === "win32" ? "npm.cmd" : "npm" : process.execPath
  const commandArgs = npmExecPath === undefined ? args : [npmExecPath, ...args]
  const childEnv = { ...process.env, ...env }
  if (childEnv.CI !== undefined && childEnv.CI !== "true" && childEnv.CI !== "false") childEnv.CI = "true"
  const result = spawnSync(command, commandArgs, { env: childEnv, stdio: "inherit" })
  if (result.error !== undefined) {
    console.error(result.error.message)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}
