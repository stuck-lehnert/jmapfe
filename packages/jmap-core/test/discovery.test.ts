import assert from "node:assert/strict"
import test from "node:test"
import {
  discoveryCandidates,
  discoverJmapSession,
  discoverJmapSessionWithUrl,
  orderSrvRecords,
  resolveJmapSrvOverHttps,
  srvRecordsToSessionUrls,
} from "@jmapfe/jmap-core"
import { FakeJmapTransport, fakeAuth } from "@jmapfe/test-fixtures"

test("discoveryCandidates prefer explicit sessionUrl", async () => {
  assert.deepEqual(
    await discoveryCandidates({ sessionUrl: "https://mail.example/jmap/session", auth: fakeAuth }),
    ["https://mail.example/jmap/session"],
  )
})

test("discoveryCandidates include SRV then well-known", async () => {
  const candidates = await discoveryCandidates({
    email: "user@example.com",
    auth: fakeAuth,
    resolveSrv: async () => [{ target: "jmap.example.com.", port: 8443, priority: 10 }],
  })

  assert.deepEqual(candidates, ["https://jmap.example.com:8443/.well-known/jmap", "https://example.com/.well-known/jmap"])
})

test("discoveryCandidates honors SRV priority before weight", async () => {
  const candidates = await discoveryCandidates({
    email: "user@example.com",
    auth: fakeAuth,
    resolveSrv: async () => [
      { target: "backup.example.com.", port: 443, priority: 10, weight: 100 },
      { target: "primary.example.com.", port: 443, priority: 0, weight: 1 },
    ],
    random: () => 0.99,
  })

  assert.deepEqual(candidates.slice(0, 2), [
    "https://primary.example.com/.well-known/jmap",
    "https://backup.example.com/.well-known/jmap",
  ])
})

test("orderSrvRecords uses weight within same priority", () => {
  const ordered = orderSrvRecords(
    [
      { target: "a.example.com.", port: 443, priority: 0, weight: 80 },
      { target: "b.example.com.", port: 443, priority: 0, weight: 20 },
    ],
    () => 0.95,
  )

  assert.equal(ordered[0]?.target, "b.example.com.")
})

test("srvRecordsToSessionUrls includes non-default ports", () => {
  assert.deepEqual(
    srvRecordsToSessionUrls([{ target: "jmap.example.com.", port: 8443, priority: 0, weight: 1 }]),
    ["https://jmap.example.com:8443/.well-known/jmap"],
  )
})

test("resolveJmapSrvOverHttps parses DNS JSON SRV answers", async () => {
  const records = await resolveJmapSrvOverHttps("_jmap._tcp", "example.com", {
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://cloudflare-dns.com/dns-query?name=_jmap._tcp.example.com&type=SRV")
      return new Response(JSON.stringify({ Status: 0, Answer: [{ data: "0 1 443 jmap.example.com." }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  })

  assert.deepEqual(records, [{ priority: 0, weight: 1, port: 443, target: "jmap.example.com." }])
})

test("resolveJmapSrvOverHttps can bypass HTTP caches", async () => {
  await resolveJmapSrvOverHttps("_jmap._tcp", "example.com", {
    bypassCache: true,
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url))
      assert.equal(parsed.searchParams.get("name"), "_jmap._tcp.example.com")
      assert.equal(parsed.searchParams.get("type"), "SRV")
      assert.ok(parsed.searchParams.get("_")?.length)
      assert.equal(init?.cache, "no-store")
      assert.equal((init?.headers as Record<string, string>)?.["cache-control"], "no-cache")
      return new Response(JSON.stringify({ Status: 0, Answer: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  })
})

test("discoverJmapSession uses transport authenticated GET", async () => {
  const transport = new FakeJmapTransport()
  const session = await discoverJmapSession({
    sessionUrl: "https://example.com/.well-known/jmap",
    auth: fakeAuth,
    transport,
  })

  assert.equal(session.username, "tester@example.com")
  assert.deepEqual(transport.sessionUrls, ["https://example.com/.well-known/jmap"])
})

test("discoverJmapSessionWithUrl returns winning session URL", async () => {
  const transport = new FakeJmapTransport()
  const result = await discoverJmapSessionWithUrl({
    email: "user@example.com",
    auth: fakeAuth,
    transport,
    resolveSrv: async () => [{ target: "jmap.example.com.", port: 443, priority: 0, weight: 1 }],
  })

  assert.equal(result.session.username, "tester@example.com")
  assert.equal(result.sessionUrl, "https://jmap.example.com/.well-known/jmap")
})
