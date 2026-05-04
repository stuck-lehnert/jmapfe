# Contributing to jmapfe

Thanks for helping build a modern FOSS JMAP client.

This project is early. Small, focused contributions are easiest to review and most likely to land.

## Ways to Help

- Report JMAP provider behavior and setup problems.
- Add tests for protocol edge cases.
- Improve account setup, mail reading, search, attachments, and accessibility.
- Implement spec-backed JMAP features in packages.
- Improve desktop, Android, and web build docs.
- Review UX and security-sensitive flows.

## Before You Start

- Check existing issues or open a short proposal for bigger changes.
- Keep PRs narrow. One behavior change per PR when possible.
- Prefer minimal, typed changes over broad rewrites.
- Read `PROJECT.md` before protocol work.

## Development Setup

Install dependencies:

```sh
npm install
```

Run web dev:

```sh
npm run dev:web
```

Run desktop dev:

```sh
npm run dev:native
```

Run checks:

```sh
npm run typecheck
npm test
```

Build web export:

```sh
npm run build:web
```

## Pull Request Checklist

- Explain user-facing change and why it matters.
- Mention tested commands.
- Add or update tests when behavior changes.
- Update docs when setup, commands, platform behavior, or user flows change.
- Keep generated output out of commits unless explicitly required.
- Do not commit secrets, tokens, private keys, `.env` files, real mail data, or provider credentials.

## Commit Style

Use concise conventional-style subjects when possible:

```txt
fix: handle missing mailbox role
feat: add attachment download action
refactor: split mail state helpers
docs: add provider setup notes
```

Keep subject short. Add body only when motivation is not obvious.

## Protocol Work

Specs win. Do not infer protocol behavior from one provider unless guarded by tests and documented as provider-specific.

Useful specs are listed in `PROJECT.md`. Important ones:

- RFC 8620: JMAP Core.
- RFC 8621: JMAP Mail.
- RFC 9610 / RFC 9553 / RFC 9555: contacts and JSContact.
- JMAP Calendars draft: calendar support, behind draft version guard.
- Common JMAP extensions: Blob, Quota, Sieve, MDN, WebSocket, WebPush, Principals.

Protocol code should:

- Use typed models.
- Keep capability constants centralized.
- Redact auth headers and secrets in errors/logs.
- Preserve method order and result-reference behavior.
- Test both success and method-level errors.

## UI Work

- Preserve compact layout unless changing UX intentionally.
- Use shared primitives/components instead of one-off button variants.
- Keep custom HTML/context menus unless maintainers decide otherwise.
- Check desktop and mobile widths.
- Use accessible labels for icon-only controls.

## Security and Privacy

- Treat email bodies, attachments, auth headers, tokens, and keys as sensitive.
- Do not paste real credentials or private mail into issues or tests.
- Do not log `Authorization`, cookies, private keys, passphrases, or raw encrypted key material.
- Prefer clear user consent for remote content loading.
- Report security issues privately if repository enables a security contact; otherwise open a minimal public issue without exploit details and ask maintainers for a private channel.

## Provider Reports

Useful provider reports include:

- Provider/server name and version if known.
- Platform: web, desktop, Android.
- Auth type: token, OAuth, Basic.
- Discovery path: manual URL, SRV, `/.well-known/jmap`.
- Error message with secrets redacted.
- Whether CORS blocked web use.

## License Note

jmapfe is licensed under the MIT License. By contributing, you agree that your contribution is provided under the same license.
