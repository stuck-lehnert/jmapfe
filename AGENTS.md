# AGENTS.md

Scope: repo root.

## Mode

- Human docs (`README.md`, `CONTRIBUTING.md`, user-facing guides): normal concise prose.
- Non-human docs (`AGENTS.md`, agent memory, scratch specs, hidden notes): **caveman ultra** to save tokens.
- Caveman ultra: abbrev ok, no filler/articles, fragments ok, arrows ok, technical exact. Pattern: `thing action reason. next.`
- Do not use caveman in code, commit msgs, PR titles, security warnings needing clarity.

## Product

- jmapfe = FOSS JMAP client. Goal: mail first, contacts/calendar later, no cloud middleman.
- Platforms: Expo/RN Web, Android, Tauri desktop Linux/Windows/macOS.
- Browser web hits CORS wall. Desktop/native avoid via platform networking/local bridge.
- `PROJECT.md` = long spec/product source. Read before protocol work.

## Repo

- `apps/web`: Expo + RN Web app.
- `apps/desktop-tauri`: Tauri shell + Rust cmds/bridge.
- `packages/app-core`: account setup/shared app models.
- `packages/jmap-core`: RFC8620 core/session/request/transport.
- `packages/jmap-mail`, `jmap-contacts`, `jmap-calendar`, `jmap-extensions`: protocol pkgs.
- `packages/store`, `sync`, `platform`, `mime`, `openpgp`, `ui`, `test-fixtures`: foundations.

## Commands

- Install: `npm install`.
- Web dev: `npm run dev:web`.
- Desktop dev: `npm run dev:native`.
- Typecheck: `npm run typecheck`.
- Tests: `npm test`.
- Web build: `npm run build:web`.
- Desktop Rust check: `cargo check --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml`.
- Linux bundle: `npm run build:linux`.

## Build/Packaging Memory

- Tauri config: `beforeBuildCommand = npm --workspace @jmapfe/web run web`; `frontendDist = ../../web/dist`.
- `apps/web/package.json` web script runs Expo export + `scripts/patch-expo-web-dist.mjs`.
- Patch script makes asset refs relative, adds parser-created `<style id="react-native-stylesheet"></style>`, asserts no abs `/_expo`/`/assets` refs.
- Do not remove static RNW stylesheet tag. AppImage/WebKit can give runtime-created style null `.sheet` -> no styles.
- Linux release pins WebKitGTK/JSC `2.44.0-2`; Ubuntu `2.50.4` AppImage hit EGL abort.
- Test Linux/AppImage in podman Ubuntu 24.04 when possible.
- Local AppImage often needs `APPIMAGE_EXTRACT_AND_RUN=1` if FUSE unavailable.

## UI Memory

- Preserve compact, square, no-radius visual language.
- Use Material icons from `@expo/vector-icons`.
- Shared button primitive: `Ui.Button` with `kind: "filled" | "hollow" | "ghost"`, `loading`, `disabled`, `leading`, `trailing`.
- Loading button auto-disabled, spinner shown.
- Do not re-add custom button variants.
- Use custom HTML/RNW context menus, not native Tauri menu. Native menu previously failed perms (`menu.new not allowed`).
- Right-click/long-press selects message before menu.
- Context menu overlay workspace-level; closes on outside left/right click, incl preview/iframe.
- Message drag -> folders. Block invalid/read-only/same-folder drops.
- First-run page = account setup only. No welcome/brand copy.

## Protocol/Privacy

- Specs first. RFC8620/8621 core/mail. Contacts/calendar/ext per `PROJECT.md`.
- TS everywhere. No untyped protocol blobs. Capability constants, typed models.
- Never log/store secrets in localStorage/tests/docs: tokens, auth headers, cookies, passphrases, private keys, real mail.
- Redact `Authorization` and credential material in errors/logs.
- Remote content must be user-controlled; avoid auto-loading remote images.

## Work Style

- Small correct changes > broad rewrites.
- Preserve behavior during refactor.
- Do not invent backwards compat unless persisted data/external users/explicit need.
- Dirty worktree possible. Do not revert user changes. Ask if conflict.
- Do not commit unless user asks.
- Manual edits via `apply_patch`.
