import assert from "node:assert/strict"
import test from "node:test"
import { JmapClient, type JsonObject } from "@jmapfe/jmap-core"
import { initialMailReadSync, type EmailWindow, type MailReadStore } from "@jmapfe/jmap-mail"
import { FakeJmapServer } from "@jmapfe/test-fixtures"

class MemoryMailReadStore implements MailReadStore {
  readonly mailboxes: JsonObject[] = []
  readonly identities: JsonObject[] = []
  readonly emails: JsonObject[] = []
  readonly threads: JsonObject[] = []
  readonly states = new Map<string, string>()
  window?: EmailWindow

  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    return fn()
  }

  async upsertMailboxes(_accountId: string, mailboxes: readonly JsonObject[]): Promise<void> {
    this.mailboxes.push(...mailboxes)
  }

  async upsertIdentities(_accountId: string, identities: readonly JsonObject[]): Promise<void> {
    this.identities.push(...identities)
  }

  async upsertEmails(_accountId: string, emails: readonly JsonObject[]): Promise<void> {
    this.emails.push(...emails)
  }

  async upsertThreads(_accountId: string, threads: readonly JsonObject[]): Promise<void> {
    this.threads.push(...threads)
  }

  async setSyncState(_accountId: string, datatype: string, state: string): Promise<void> {
    this.states.set(datatype, state)
  }

  async saveEmailWindow(_accountId: string, input: EmailWindow): Promise<void> {
    this.window = input
  }
}

test("initialMailReadSync pulls mailboxes, identities, recent email metadata, threads", async () => {
  const server = new FakeJmapServer()
  server.seedMailbox({ id: "inbox", name: "Inbox", role: "inbox" })
  server.seedMailbox({ id: "archive", name: "Archive", role: "archive" })
  server.seedEmail({
    id: "e1",
    threadId: "t1",
    mailboxIds: { inbox: true },
    keywords: { "$seen": false },
    subject: "Hello",
    preview: "World",
    receivedAt: "2026-05-02T07:00:00Z",
    size: 42,
  })
  const client = new JmapClient({ session: server.session, transport: server.transport })
  const store = new MemoryMailReadStore()

  const result = await initialMailReadSync({ client, session: server.session, store, limit: 10 })

  assert.equal(result.accountId, "acc1")
  assert.equal(result.mailboxCount, 2)
  assert.equal(result.identityCount, 1)
  assert.equal(result.emailCount, 1)
  assert.equal(result.threadCount, 1)
  assert.equal(result.mailboxId, "inbox")
  assert.equal(store.emails[0]?.id, "e1")
  assert.deepEqual(store.window?.ids, ["e1"])
  assert.equal(store.states.get("Mailbox"), "Mailbox-0")
  assert.equal(store.states.get("Email"), "Email-0")
})
