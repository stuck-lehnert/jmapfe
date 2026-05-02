import {
  CAP_CORE,
  CAP_MAIL,
  type AuthProvider,
  type BlobLike,
  type BlobUploadResponse,
  type JmapRequest,
  type JmapResponse,
  type JmapSession,
  type JmapTransport,
  type JsonObject,
  type MethodCall,
  type MethodResponse,
} from "@jmapfe/jmap-core"

export interface FakeMethodOverride {
  readonly name: string
  readonly args: JsonObject
}

export type FakeMethodResult = JsonObject | FakeMethodOverride
export type FakeMethodHandler = (args: JsonObject, call: MethodCall, request: JmapRequest) => FakeMethodResult

export class FakeJmapTransport implements JmapTransport {
  readonly requests: JmapRequest[] = []
  readonly sessionUrls: string[] = []
  private readonly handlers = new Map<string, FakeMethodHandler>()
  private readonly blobs = new Map<string, BlobLike>()
  private apiFailuresRemaining = 0

  constructor(readonly session: JmapSession = fakeSession()) {}

  failNextApiCalls(count: number): void {
    this.apiFailuresRemaining = count
  }

  on(methodName: string, handler: FakeMethodHandler): void {
    this.handlers.set(methodName, handler)
  }

  async getSession(url: string, _auth: AuthProvider): Promise<JmapSession> {
    this.sessionUrls.push(url)
    return this.session
  }

  async api(req: JmapRequest): Promise<JmapResponse> {
    this.requests.push(req)
    if (this.apiFailuresRemaining > 0) {
      this.apiFailuresRemaining -= 1
      throw new Error("fake transient transport failure")
    }

    const methodResponses: MethodResponse[] = req.methodCalls.map((call) => {
      const handler = this.handlers.get(call[0])
      if (handler === undefined) return ["error", { type: "methodNotFound", description: call[0] }, call[2]]
      const result = handler(call[1], call, req)
      if (isFakeMethodOverride(result)) return [result.name, result.args, call[2]]
      return [call[0], result, call[2]]
    })

    return { methodResponses, sessionState: this.session.state, createdIds: {} }
  }

  async upload(accountId: string, file: BlobLike): Promise<BlobUploadResponse> {
    const blobId = `blob-${this.blobs.size + 1}`
    this.blobs.set(`${accountId}:${blobId}`, file)
    return { accountId, blobId, type: "application/octet-stream", size: blobSize(file) }
  }

  async download(accountId: string, blobId: string): Promise<BlobLike> {
    const blob = this.blobs.get(`${accountId}:${blobId}`)
    if (blob === undefined) throw new Error(`Fake blob not found: ${blobId}`)
    return blob
  }
}

export function fakeMethodError(type: string, description?: string): FakeMethodOverride {
  return { name: "error", args: cleanUndefined({ type, description }) }
}

export interface FakeMailbox extends JsonObject {
  readonly id: string
  readonly name: string
  readonly parentId?: string | null
  readonly role?: string | null
  readonly sortOrder?: number
  readonly totalEmails?: number
  readonly unreadEmails?: number
  readonly totalThreads?: number
  readonly unreadThreads?: number
}

export interface FakeEmail extends JsonObject {
  readonly id: string
  readonly threadId: string
  readonly mailboxIds: Record<string, boolean>
  readonly keywords: Record<string, boolean>
  readonly subject: string
  readonly preview: string
  readonly receivedAt: string
  readonly size: number
}

export interface FakeIdentity extends JsonObject {
  readonly id: string
  readonly name: string
  readonly email: string
}

type FakeDatatype = "Mailbox" | "Email" | "Thread" | "Identity"

interface ChangeEntry {
  readonly state: string
  readonly created: readonly string[]
  readonly updated: readonly string[]
  readonly destroyed: readonly string[]
}

export class FakeJmapServer {
  readonly transport: FakeJmapTransport
  private readonly mailboxes = new Map<string, FakeMailbox>()
  private readonly emails = new Map<string, FakeEmail>()
  private readonly identities = new Map<string, FakeIdentity>()
  private readonly histories = new Map<FakeDatatype, ChangeEntry[]>()
  private readonly counters = new Map<FakeDatatype, number>()

  constructor(readonly session: JmapSession = fakeSession()) {
    this.transport = new FakeJmapTransport(session)
    for (const datatype of ["Mailbox", "Email", "Thread", "Identity"] as const) {
      this.histories.set(datatype, [{ state: `${datatype}-0`, created: [], updated: [], destroyed: [] }])
      this.counters.set(datatype, 0)
    }
    this.seedIdentity({ id: "identity1", name: session.username, email: session.username })
    this.registerHandlers()
  }

  seedMailbox(mailbox: FakeMailbox): void {
    this.mailboxes.set(mailbox.id, mailbox)
  }

  addMailbox(mailbox: FakeMailbox): void {
    this.mailboxes.set(mailbox.id, mailbox)
    this.recordChange("Mailbox", { created: [mailbox.id] })
  }

  updateMailbox(mailbox: FakeMailbox): void {
    this.mailboxes.set(mailbox.id, mailbox)
    this.recordChange("Mailbox", { updated: [mailbox.id] })
  }

  destroyMailbox(id: string): void {
    this.mailboxes.delete(id)
    this.recordChange("Mailbox", { destroyed: [id] })
  }

  seedEmail(email: FakeEmail): void {
    this.emails.set(email.id, email)
  }

  addEmail(email: FakeEmail): void {
    this.emails.set(email.id, email)
    this.recordChange("Email", { created: [email.id] })
    this.recordChange("Thread", { created: [email.threadId] })
  }

  seedIdentity(identity: FakeIdentity): void {
    this.identities.set(identity.id, identity)
  }

  private registerHandlers(): void {
    this.transport.on("Mailbox/get", (args) => this.getObjects("Mailbox", this.mailboxes, args))
    this.transport.on("Mailbox/changes", (args) => this.changes("Mailbox", args))
    this.transport.on("Identity/get", (args) => this.getObjects("Identity", this.identities, args))
    this.transport.on("Identity/changes", (args) => this.changes("Identity", args))
    this.transport.on("Email/get", (args) => this.getObjects("Email", this.emails, args))
    this.transport.on("Email/changes", (args) => this.changes("Email", args))
    this.transport.on("Email/query", (args) => this.emailQuery(args))
    this.transport.on("Thread/get", (args) => this.threadGet(args))
    this.transport.on("Thread/changes", (args) => this.changes("Thread", args))
  }

  private getObjects(datatype: FakeDatatype, objects: ReadonlyMap<string, JsonObject>, args: JsonObject): JsonObject {
    const ids = idsFromArgs(args)
    const selectedIds = ids ?? [...objects.keys()]
    const list: JsonObject[] = []
    const notFound: string[] = []

    for (const id of selectedIds) {
      const object = objects.get(id)
      if (object === undefined) notFound.push(id)
      else list.push(object)
    }

    return { accountId: this.accountId, state: this.state(datatype), list, notFound }
  }

  private changes(datatype: FakeDatatype, args: JsonObject): JsonObject | FakeMethodOverride {
    const sinceState = typeof args.sinceState === "string" ? args.sinceState : undefined
    if (sinceState === undefined) return fakeMethodError("invalidArguments", "sinceState required")
    const history = this.histories.get(datatype) ?? []
    const index = history.findIndex((entry) => entry.state === sinceState)
    if (index < 0) return fakeMethodError("cannotCalculateChanges")
    const entries = history.slice(index + 1)
    return {
      accountId: this.accountId,
      oldState: sinceState,
      newState: this.state(datatype),
      hasMoreChanges: false,
      created: unique(entries.flatMap((entry) => entry.created)),
      updated: unique(entries.flatMap((entry) => entry.updated)),
      destroyed: unique(entries.flatMap((entry) => entry.destroyed)),
    }
  }

  private emailQuery(args: JsonObject): JsonObject {
    const filter = typeof args.filter === "object" && args.filter !== null && !Array.isArray(args.filter) ? args.filter as JsonObject : {}
    const inMailbox = typeof filter.inMailbox === "string" ? filter.inMailbox : undefined
    const limit = typeof args.limit === "number" ? args.limit : 50
    const position = typeof args.position === "number" ? args.position : 0
    const ids = [...this.emails.values()]
      .filter((email) => inMailbox === undefined || email.mailboxIds[inMailbox] === true)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map((email) => email.id)
    return {
      accountId: this.accountId,
      queryState: `EmailQuery-${this.state("Email")}`,
      canCalculateChanges: true,
      position,
      ids: ids.slice(position, position + limit),
      total: ids.length,
    }
  }

  private threadGet(args: JsonObject): JsonObject {
    const ids = idsFromArgs(args) ?? unique([...this.emails.values()].map((email) => email.threadId))
    const list = ids.map((id) => ({ id, emailIds: [...this.emails.values()].filter((email) => email.threadId === id).map((email) => email.id) }))
    return { accountId: this.accountId, state: this.state("Thread"), list, notFound: [] }
  }

  private recordChange(
    datatype: FakeDatatype,
    change: { readonly created?: readonly string[]; readonly updated?: readonly string[]; readonly destroyed?: readonly string[] },
  ): void {
    const next = (this.counters.get(datatype) ?? 0) + 1
    this.counters.set(datatype, next)
    this.histories.get(datatype)?.push({
      state: `${datatype}-${next}`,
      created: change.created ?? [],
      updated: change.updated ?? [],
      destroyed: change.destroyed ?? [],
    })
  }

  private state(datatype: FakeDatatype): string {
    return `${datatype}-${this.counters.get(datatype) ?? 0}`
  }

  private get accountId(): string {
    return this.session.primaryAccounts[CAP_MAIL] ?? "acc1"
  }
}

export function fakeSession(overrides: Partial<JmapSession> = {}): JmapSession {
  const session: JmapSession = {
    capabilities: {
      [CAP_CORE]: {
        maxCallsInRequest: 4,
        maxSizeRequest: 100_000,
        maxObjectsInGet: 500,
        maxObjectsInSet: 500,
      },
      [CAP_MAIL]: {},
    },
    accounts: {
      acc1: {
        name: "Test Account",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: {
          [CAP_CORE]: {},
          [CAP_MAIL]: {},
        },
      },
    },
    primaryAccounts: {
      [CAP_CORE]: "acc1",
      [CAP_MAIL]: "acc1",
    },
    username: "tester@example.com",
    apiUrl: "https://example.com/jmap/api/",
    downloadUrl: "https://example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
    uploadUrl: "https://example.com/jmap/upload/{accountId}/",
    eventSourceUrl: "https://example.com/jmap/eventsource/",
    state: "s1",
  }
  return { ...session, ...overrides }
}

export const fakeAuth = { kind: "bearer", token: "test-token" } as const

function blobSize(blob: BlobLike): number {
  if (blob instanceof Blob) return blob.size
  if (blob instanceof ArrayBuffer) return blob.byteLength
  return blob.byteLength
}

function idsFromArgs(args: JsonObject): string[] | undefined {
  if (args.ids === null || args.ids === undefined) return undefined
  if (!Array.isArray(args.ids)) return []
  return args.ids.filter((id): id is string => typeof id === "string")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function isFakeMethodOverride(result: FakeMethodResult): result is FakeMethodOverride {
  return "name" in result && typeof result.name === "string" && "args" in result
}

function cleanUndefined(input: Record<string, string | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as JsonObject
}
