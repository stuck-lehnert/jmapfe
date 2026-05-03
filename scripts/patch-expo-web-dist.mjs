import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const distDir = process.argv[2] ?? "dist"
const reactNativeStylesheetTag = '    <style id="react-native-stylesheet"></style>\n'

for (const filePath of walk(distDir)) {
  if (!filePath.endsWith(".html")) continue
  patchHtmlFile(filePath)
}

for (const filePath of walk(distDir)) {
  if (!filePath.endsWith(".js")) continue
  patchFile(filePath, [
    [/(["'])\/assets\//g, "$1./assets/"],
  ])
}

assertNoAbsoluteAssetRefs(distDir)

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry)
    if (statSync(entryPath).isDirectory()) {
      yield* walk(entryPath)
    } else {
      yield entryPath
    }
  }
}

function patchFile(filePath, replacements) {
  let content = readFileSync(filePath, "utf8")
  const original = content
  for (const [pattern, replacement] of replacements) content = content.replace(pattern, replacement)
  if (content !== original) writeFileSync(filePath, content)
}

function patchHtmlFile(filePath) {
  let content = readFileSync(filePath, "utf8")
  const original = content
  content = content.replace(/((?:src|href)=")\//g, "$1./")
  if (!content.includes('id="react-native-stylesheet"')) {
    // Tauri/WebKit can expose null .sheet for runtime-created style tags; parser-created tag keeps RNW CSS insertion working.
    content = content.replace(/\s*<\/head>/, `\n${reactNativeStylesheetTag}  </head>`)
  }
  if (content !== original) writeFileSync(filePath, content)
}

function assertNoAbsoluteAssetRefs(dir) {
  const offenders = []
  for (const filePath of walk(dir)) {
    if (!filePath.endsWith(".html") && !filePath.endsWith(".js")) continue
    const content = readFileSync(filePath, "utf8")
    if (/(?:src|href)="\//.test(content) || /["']\/(?:_expo|assets)\//.test(content)) offenders.push(filePath)
  }
  if (offenders.length > 0) {
    console.error(`Expo web dist still contains absolute asset references:\n${offenders.join("\n")}`)
    process.exit(1)
  }
}
