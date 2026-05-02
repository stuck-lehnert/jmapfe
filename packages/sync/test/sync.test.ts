import assert from "node:assert/strict"
import test from "node:test"
import { CAP_MAIL, JmapClient, type JsonObject } from "@jmapfe/jmap-core"
import { syncType, type SyncTypeStore } from "@jmapfe/sync"
import { FakeJmapTransport } from "@jmapfe/test-fixtures"

class MemorySyncStore implements SyncTypeStore<JsonObject> {
  state = "s0"
  objects: JsonObject[] = []
  destroyed: string[] = []

  async getState(): Promise<string | undefined> {
    return this.state
  }

  async initialSync(): Promise<never> {
    throw new Error("initial sync not expected")
  }

  async fullResync(): Promise<never> {
    throw new Error("full resync not expected")
  }

  async upsert(_accountId: string, _datatype: string, objects: readonly JsonObject[]): Promise<void> {
    this.objects.push(...objects)
  }

  async destroy(_accountId: string, _datatype: string, ids: readonly string[]): Promise<void> {
    this.destroyed.push(...ids)
  }

  async setState(_accountId: string, _datatype: string, state: string): Promise<void> {
    this.state = state
  }

  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    return fn()
  }
}

test("syncType applies remote changes inside transaction then advances state", async () => {
  const transport = new FakeJmapTransport()
  transport.on("Mailbox/changes", () => ({ created: ["inbox"], updated: ["archive"], destroyed: ["old"], newState: "s1" }))
  transport.on("Mailbox/get", () => ({ list: [{ id: "inbox" }, { id: "archive" }], notFound: [], state: "s1" }))
  const client = new JmapClient({ session: transport.session, transport })
  const store = new MemorySyncStore()

  const result = await syncType({ accountId: "acc1", datatype: "Mailbox", using: [CAP_MAIL], client, store })

  assert.equal(result.state, "s1")
  assert.equal(store.objects.length, 2)
  assert.deepEqual(store.destroyed, ["old"])
  assert.equal(store.state, "s1")
})
