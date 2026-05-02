import assert from "node:assert/strict"
import test from "node:test"
import { applyMigrations, createSqlStoreRepositories, type SqlDatabase } from "@jmapfe/store"

class RecordingDb implements SqlDatabase {
  readonly statements: { readonly sql: string; readonly params: readonly unknown[] }[] = []
  rows: readonly Record<string, unknown>[] = []

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.statements.push({ sql, params })
  }

  async query<T>(): Promise<readonly T[]> {
    return this.rows as readonly T[]
  }

  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    return fn()
  }
}

test("applyMigrations creates migration table and records version", async () => {
  const db = new RecordingDb()

  await applyMigrations(db, [{ version: 1, name: "one", statements: ["CREATE TABLE one(id TEXT)"] }])

  assert.match(db.statements[0]?.sql ?? "", /schema_migrations/)
  assert.equal(db.statements.at(-1)?.params[0], 1)
  assert.equal(db.statements.at(-1)?.params[1], "one")
})

test("SQL repositories map accounts and pending mutations", async () => {
  const db = new RecordingDb()
  const repos = createSqlStoreRepositories(db)

  await repos.accounts.upsert({
    id: "acc1",
    serverId: "srv1",
    username: "user@example.com",
    sessionUrl: "https://example.com/.well-known/jmap",
    capabilitiesJson: "{}",
    state: "s1",
  })
  db.rows = [
    {
      id: "m1",
      account_id: "acc1",
      datatype: "Email",
      op: "markRead",
      status: "pending",
      retries: 0,
      created_at: "2026-05-02T00:00:00Z",
    },
  ]

  const mutation = await repos.localMutations.nextPending("acc1")

  assert.match(db.statements[0]?.sql ?? "", /INSERT INTO accounts/)
  assert.equal(mutation?.id, "m1")
  assert.equal(mutation?.status, "pending")
})

test("mail repository preserves raw email JSON", async () => {
  const db = new RecordingDb()
  const repos = createSqlStoreRepositories(db)

  await repos.mail.upsertEmails("acc1", [
    {
      id: "e1",
      threadId: "t1",
      mailboxIds: { inbox: true },
      keywords: { "$seen": true },
      subject: "Subject",
      preview: "Preview",
      receivedAt: "2026-05-02T00:00:00Z",
      hasAttachment: true,
      unknownServerField: { kept: true },
    },
  ])

  const params = db.statements[0]?.params ?? []
  const rawJson = params.at(-1)
  assert.equal(params[1], "e1")
  assert.equal(params[18], 1)
  assert.equal(typeof rawJson, "string")
  assert.equal(JSON.parse(rawJson as string).unknownServerField.kept, true)
})
