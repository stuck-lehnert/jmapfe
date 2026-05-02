import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const appDir = join(process.cwd(), "apps", "web")
const gradleTasks = process.argv.slice(2)
const tasks = gradleTasks.length === 0 ? ["assembleRelease", "bundleRelease"] : gradleTasks

run(process.platform === "win32" ? "npx.cmd" : "npx", ["expo", "prebuild", "--platform", "android", "--no-install"], appDir)

const androidDir = join(appDir, "android")
const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
const gradleWrapper = join(androidDir, process.platform === "win32" ? gradle : "gradlew")
if (!existsSync(gradleWrapper)) {
  console.error("Android Gradle wrapper missing after Expo prebuild")
  process.exit(1)
}
if (process.platform !== "win32") chmodSync(gradleWrapper, 0o755)

if (needsReleaseSigning(tasks)) configureReleaseSigning(androidDir)

run(gradle, tasks, androidDir)

function needsReleaseSigning(tasks) {
  return tasks.some((task) => task.toLowerCase().includes("release"))
}

function configureReleaseSigning(androidDir) {
  const appAndroidDir = join(androidDir, "app")
  const keystoreName = "jmapfe-release.jks"
  const keystorePath = join(appAndroidDir, keystoreName)
  const providedKeystore = optionalEnv("ANDROID_KEYSTORE_BASE64")
  if (providedKeystore !== undefined && optionalEnv("ANDROID_KEYSTORE_PASSWORD") === undefined) {
    throw new Error("ANDROID_KEYSTORE_PASSWORD is required when ANDROID_KEYSTORE_BASE64 is provided")
  }
  const storePassword = optionalEnv("ANDROID_KEYSTORE_PASSWORD") ?? generatedPassword()
  const keyAlias = optionalEnv("ANDROID_KEY_ALIAS") ?? "jmapfe"
  const keyPassword = optionalEnv("ANDROID_KEY_PASSWORD") ?? storePassword

  if (providedKeystore === undefined) {
    run("keytool", [
      "-genkeypair",
      "-v",
      "-keystore",
      keystorePath,
      "-storepass",
      storePassword,
      "-alias",
      keyAlias,
      "-keypass",
      keyPassword,
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-dname",
      "CN=jmapfe, OU=CI, O=jmapfe, L=CI, ST=CI, C=US",
    ], androidDir)
  } else {
    writeFileSync(keystorePath, Buffer.from(providedKeystore, "base64"))
  }

  patchReleaseSigning(join(appAndroidDir, "build.gradle"), {
    keyAlias,
    keyPassword,
    storeFile: keystoreName,
    storePassword,
  })
}

function patchReleaseSigning(buildGradlePath, signing) {
  let contents = readFileSync(buildGradlePath, "utf8")
  if (!contents.includes("signingConfigs.release")) {
    const buildTypesMatch = contents.match(/\n(\s*)buildTypes\s*\{/)
    if (buildTypesMatch === null) throw new Error("Could not find Android buildTypes block for release signing")
    const indent = buildTypesMatch[1]
    const signingBlock = `
${indent}signingConfigs {
${indent}    release {
${indent}        storeFile file(${gradleString(signing.storeFile)})
${indent}        storePassword ${gradleString(signing.storePassword)}
${indent}        keyAlias ${gradleString(signing.keyAlias)}
${indent}        keyPassword ${gradleString(signing.keyPassword)}
${indent}    }
${indent}}
`
    contents = contents.replace(/\n\s*buildTypes\s*\{/, () => `${signingBlock}${buildTypesMatch[0]}`)
  }

  contents = contents.replace(/(release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, "$1signingConfig signingConfigs.release")
  if (!contents.includes("signingConfig signingConfigs.release")) {
    contents = contents.replace(/(release\s*\{\s*\n)/, "$1            signingConfig signingConfigs.release\n")
  }
  writeFileSync(buildGradlePath, contents)
}

function generatedPassword() {
  return randomBytes(24).toString("base64url")
}

function optionalEnv(name) {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

function gradleString(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
