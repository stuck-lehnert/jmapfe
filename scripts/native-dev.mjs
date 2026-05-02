import { spawnSync } from "node:child_process"

const platforms = {
  linux: "linux",
  win32: "windows",
  darwin: "macos",
}

const platform = platforms[process.platform]
if (platform === undefined) {
  console.error(`Unsupported native dev platform: ${process.platform}`)
  process.exit(1)
}

console.log(`Starting native desktop dev for ${platform}`)
runNpm(["--workspace", "@jmapfe/desktop-tauri", "run", "dev", "--", ...process.argv.slice(2)])

function runNpm(args) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = spawnSync(command, args, { stdio: "inherit" })
  process.exit(result.status ?? 1)
}
