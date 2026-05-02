const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")
const exclusionList = require("metro-config/src/defaults/exclusionList")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Keep local workspace packages visible, but never watch Rust build output.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
}
config.resolver.blockList = exclusionList([
  pathRegex(path.resolve(workspaceRoot, "apps/desktop-tauri/src-tauri/target")),
  pathRegex(path.resolve(workspaceRoot, "apps/web/dist")),
])

module.exports = config

function pathRegex(filePath) {
  return new RegExp(`${escapeForRegex(filePath)}(?:/|\\\\).*`)
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
