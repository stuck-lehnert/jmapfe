# jmapfe

JMAP mail client for people who want modern mail without a cloud middleman.

jmapfe is a free/open-source project building a cross-platform JMAP client from one TypeScript codebase. Target platforms are web, Android, Linux desktop, Windows desktop, and macOS desktop. Desktop uses a local Tauri bridge so the app can talk directly to JMAP servers without browser CORS limits.

## Why

Email clients are often locked to IMAP-era assumptions or hosted services. JMAP gives mail, contacts, calendars, blobs, quotas, rules, sharing, and push a typed JSON protocol. jmapfe aims to make that usable for normal people while keeping power-user control.

Core goals:

- No mandatory central service.
- Direct connection to user-owned JMAP accounts.
- Typed protocol code, not stringly-typed request blobs.
- Secure credential storage per platform.
- Offline-ready local storage and sync.
- Full JMAP surface over time: mail first, contacts/calendars next.
- Accessible, fast, compact UI.

## Status

Early, active, usable foundation. Expect rough edges.

Current codebase includes:

- Expo + React Native Web app shell.
- Tauri desktop shell and local JMAP HTTP bridge.
- Account setup with JMAP discovery and credential verification.
- Typed JMAP core request/session/transport helpers.
- Mail folder/message UI, message actions, attachment open/download paths.
- SQLite store/sync package foundations.
- Test fixtures for protocol and sync work.
- Linux AppImage packaging fixes for Expo asset paths and WebKitGTK runtime behavior.

## Web Limitation

Browser builds can only connect to JMAP servers that allow the app origin with CORS. This is a browser security rule. Desktop and native builds avoid that limit through platform networking/local bridge code.

## Repo Layout

```txt
apps/
  web/                 Expo / React Native Web app
  desktop-tauri/       Tauri desktop shell and Rust bridge

packages/
  app-core/            account setup and shared app models
  jmap-core/           RFC 8620 core helpers
  jmap-mail/           mail protocol package foundation
  jmap-contacts/       contacts package foundation
  jmap-calendar/       calendar package foundation
  jmap-extensions/     common JMAP extensions
  store/               SQLite schema/repository foundation
  sync/                sync engine foundation
  ui/                  shared UI package foundation
  platform/            platform adapter foundation
  mime/                MIME package foundation
  openpgp/             OpenPGP package foundation
  test-fixtures/       fake transports and test data
```

`PROJECT.md` is long-form product/spec direction. Treat specs as source of truth for protocol work.

## Quick Start

Requirements:

- Node.js compatible with npm 10.
- Rust toolchain for Tauri desktop work.
- Platform dependencies for Tauri on Linux if building desktop bundles.

Install:

```sh
npm install
```

Run web dev server:

```sh
npm run dev:web
```

Run desktop dev shell:

```sh
npm run dev:native
```

Check code:

```sh
npm run typecheck
npm test
```

Build web assets:

```sh
npm run build:web
```

Build Linux desktop bundle:

```sh
npm run build:linux
```

## Help Wanted

Good first areas:

- Provider testing: Fastmail, Stalwart, Cyrus, Apache James, other JMAP servers.
- UI accessibility, keyboard flow, screen reader labels.
- Mail UX polish: search, threading, message states, attachments.
- Local store and offline sync hardening.
- Contacts and calendar package implementation from specs.
- PGP/MIME parsing, verification, signing, encryption.
- Android build/dev workflow.
- Documentation, screenshots, install guides.
- Tests for protocol edge cases and error handling.

## Project Values

- User accounts stay user-controlled.
- Secrets never go into logs, localStorage, fixtures, or commits.
- Protocol errors should be visible and recoverable.
- Small, reviewable changes beat giant rewrites.
- Specs win over guesses.
- FOSS collaboration should be welcoming and direct.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). Bug reports, provider reports, docs, tests, and small focused PRs are all useful.

## License

jmapfe is licensed under the MIT License. See [`LICENSE`](LICENSE).
