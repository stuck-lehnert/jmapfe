import assert from "node:assert/strict"
import test from "node:test"
import {
  CAP_CONTACTS,
  CAP_CORE,
  CAP_MAIL,
  JmapClient,
  buildJmapRequest,
  chunkJmapRequest,
  connectJmap,
  expandObjectLimitCalls,
  methodCall,
  resultReference,
  withResultReference,
} from "@jmapfe/jmap-core"
import { FakeJmapTransport, fakeAuth, fakeSession } from "@jmapfe/test-fixtures"

test("buildJmapRequest preserves ordered calls and unique using", () => {
  const request = buildJmapRequest({
    using: [CAP_CORE, CAP_MAIL, CAP_MAIL],
    calls: [methodCall("Mailbox/get", { accountId: "acc1" }, "a"), methodCall("Email/query", { accountId: "acc1" }, "b")],
  })

  assert.deepEqual(request.using, [CAP_CORE, CAP_MAIL])
  assert.deepEqual(
    request.methodCalls.map((call) => call[2]),
    ["a", "b"],
  )
})

test("buildJmapRequest rejects duplicate call ids", () => {
  assert.throws(
    () =>
      buildJmapRequest({
        using: [CAP_CORE],
        calls: [methodCall("Mailbox/get", {}, "dup"), methodCall("Email/get", {}, "dup")],
      }),
    /Duplicate JMAP method call id/,
  )
})

test("chunkJmapRequest splits independent calls by maxCallsInRequest", () => {
  const request = buildJmapRequest({
    using: [CAP_CORE],
    calls: [
      methodCall("Mailbox/get", {}, "a"),
      methodCall("Email/query", {}, "b"),
      methodCall("Thread/get", {}, "c"),
    ],
  })

  const chunks = chunkJmapRequest(request, { maxCallsInRequest: 2 })

  assert.equal(chunks.length, 2)
  assert.deepEqual(
    chunks.map((chunk) => chunk.methodCalls.map((call) => call[2])),
    [["a", "b"], ["c"]],
  )
})

test("chunkJmapRequest refuses to split result references", () => {
  const emailGet = methodCall(
    "Email/get",
    withResultReference({ accountId: "acc1" }, "ids", resultReference("q", "Email/query", "/ids")),
    "g",
  )
  const request = buildJmapRequest({
    using: [CAP_CORE, CAP_MAIL],
    calls: [methodCall("Email/query", { accountId: "acc1" }, "q"), emailGet],
  })

  assert.throws(() => chunkJmapRequest(request, { maxCallsInRequest: 1 }), /Cannot chunk dependent JMAP calls/)
})

test("JmapClient negotiates capabilities, chunks calls, retries safe requests", async () => {
  const transport = new FakeJmapTransport(fakeSession())
  transport.failNextApiCalls(1)
  transport.on("Mailbox/get", () => ({ list: [], notFound: [], state: "m1" }))
  transport.on("Email/query", () => ({ ids: [], queryState: "q1" }))

  const client = new JmapClient({ session: transport.session, transport, maxRetries: 1, retryDelayMs: 1 })
  const response = await client.request({
    using: [CAP_MAIL, CAP_CONTACTS],
    calls: [methodCall("Mailbox/get", { accountId: "acc1" }, "m"), methodCall("Email/query", { accountId: "acc1" }, "q")],
  })

  assert.equal(response.methodResponses.length, 2)
  assert.equal(transport.requests.length, 2)
  assert.deepEqual(transport.requests.at(-1)?.using, [CAP_CORE, CAP_MAIL])
})

test("expandObjectLimitCalls splits oversized get ids", () => {
  const request = buildJmapRequest({
    using: [CAP_CORE],
    calls: [methodCall("Email/get", { accountId: "acc1", ids: ["a", "b", "c"] }, "get")],
  })

  const expanded = expandObjectLimitCalls(request, { maxObjectsInGet: 2 })

  assert.deepEqual(
    expanded.methodCalls.map((call) => [call[2], call[1].ids]),
    [
      ["get.1", ["a", "b"]],
      ["get.2", ["c"]],
    ],
  )
})

test("expandObjectLimitCalls refuses oversized set with ifInState", () => {
  const request = buildJmapRequest({
    using: [CAP_CORE],
    calls: [methodCall("Email/set", { accountId: "acc1", ifInState: "s1", destroy: ["a", "b"] }, "set")],
  })

  assert.throws(() => expandObjectLimitCalls(request, { maxObjectsInSet: 1 }), /Cannot safely split JMAP set call/)
})

test("connectJmap discovers session and returns ready client", async () => {
  const transport = new FakeJmapTransport()
  transport.on("Mailbox/get", () => ({ list: [], notFound: [], state: "m1" }))
  const connected = await connectJmap({ sessionUrl: "https://example.com/.well-known/jmap", auth: fakeAuth, transport })

  const response = await connected.client.call([CAP_MAIL], "Mailbox/get", { accountId: "acc1" })

  assert.equal(connected.session.username, "tester@example.com")
  assert.equal(response.methodResponses[0]?.[0], "Mailbox/get")
  assert.deepEqual(transport.sessionUrls, ["https://example.com/.well-known/jmap"])
})
