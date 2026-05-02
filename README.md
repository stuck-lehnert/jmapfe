# jmapfe - JMAP for everyone

Implementation follows `PROJECT.md` as sole spec.

Current foundation:

- npm workspace monorepo under `apps/` and `packages/`.
- Expo/RN Web shell in `apps/web`.
- Tauri desktop bridge shell in `apps/desktop-tauri`.
- Typed JMAP core: capabilities, auth, discovery, session parsing, request building, transport.
- Method modules for mail, contacts, calendar, extensions.
- SQLite migration baseline for local cache.
- Generic sync engine and fake JMAP transport tests.

Useful commands:

```sh
npm run typecheck
npm test
```
