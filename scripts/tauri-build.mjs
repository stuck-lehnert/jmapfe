import { spawnSync } from "node:child_process"

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

runNpm(["--workspace", "@jmapfe/desktop-tauri", "run", "build", "--", "--target", target, ...extraArgs], requested === "linux" ? { NO_STRIP: process.env.NO_STRIP ?? "true" } : {})

function runNpm(args, env = {}) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = spawnSync(command, args, { env: { ...process.env, ...env }, stdio: "inherit" })
  process.exit(result.status ?? 1)
}
