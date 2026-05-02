import assert from "node:assert/strict"
import test from "node:test"
import {
  createConfiguredAccount,
  parseConfiguredAccounts,
  removeConfiguredAccount,
  serializeConfiguredAccounts,
  upsertConfiguredAccount,
  validateAccountSetupDraft,
} from "@jmapfe/app-core"

test("validateAccountSetupDraft requires usable account identity", () => {
  const result = validateAccountSetupDraft({ displayName: "", email: "bad", authKind: "bearer" })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})

test("createConfiguredAccount derives server from email and never stores secret", () => {
  const account = createConfiguredAccount(
    { displayName: "Me", email: "User@Example.com", authKind: "bearer", secret: "token" },
    { now: "2026-05-02T00:00:00Z", secretRef: "vault:account" },
  )

  assert.equal(account.email, "user@example.com")
  assert.equal(account.serverKey, "example.com")
  assert.equal(account.status, "ready")
  assert.equal("secret" in account, false)
})

test("createConfiguredAccount preserves manual login username", () => {
  const account = createConfiguredAccount(
    { displayName: "Me", email: "me@example.com", username: "login@example.net", authKind: "basic", secret: "password" },
    { now: "2026-05-02T00:00:00Z" },
  )

  assert.equal(account.username, "login@example.net")
})

test("createConfiguredAccount can persist verified session metadata", () => {
  const account = createConfiguredAccount(
    { displayName: "Me", email: "me@example.com", authKind: "bearer", secret: "token" },
    {
      id: "a1",
      now: "2026-05-02T00:00:00Z",
      status: "ready",
      verifiedAt: "2026-05-02T00:01:00Z",
      sessionUrl: "https://example.com/.well-known/jmap",
      capabilities: ["urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:core"],
      primaryMailAccountId: "acc1",
    },
  )

  assert.equal(account.status, "ready")
  assert.equal(account.sessionUrl, "https://example.com/.well-known/jmap")
  assert.deepEqual(account.capabilities, ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"])
})

test("configured account serialization preserves metadata only", () => {
  const account = createConfiguredAccount(
    { displayName: "Work", email: "work@example.net", authKind: "bearer", sessionUrl: "https://jmap.example.net/session" },
    { id: "a1", now: "2026-05-02T00:00:00Z" },
  )

  const serialized = serializeConfiguredAccounts([account])
  const parsed = parseConfiguredAccounts(serialized)

  assert.equal(parsed[0]?.id, "a1")
  assert.equal(serialized.includes("token"), false)
})

test("account collection helpers support multiple accounts", () => {
  const first = createConfiguredAccount({ displayName: "One", email: "one@example.com", authKind: "bearer" }, { id: "one", now: "2026-05-02T00:00:00Z" })
  const second = createConfiguredAccount({ displayName: "Two", email: "two@example.org", authKind: "bearer" }, { id: "two", now: "2026-05-02T00:00:00Z" })

  const added = upsertConfiguredAccount(upsertConfiguredAccount([], first), second)
  const removed = removeConfiguredAccount(added, "one")

  assert.deepEqual(added.map((account) => account.id), ["one", "two"])
  assert.deepEqual(removed.map((account) => account.id), ["two"])
})
