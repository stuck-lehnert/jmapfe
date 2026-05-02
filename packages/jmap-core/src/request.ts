import { standardCapabilityRegistry, type CapabilityRegistry } from "./capabilities.ts"
import { JmapTransportError } from "./errors.ts"
import type { Capability, JmapRequest, JmapResponse, JsonObject, JsonValue, MethodCall, ResultReference } from "./types.ts"
import type { JmapTransport } from "./transport.ts"
import type { JmapSession } from "./types.ts"

export interface RequestLimits {
  readonly maxCallsInRequest?: number
  readonly maxSizeRequest?: number
  readonly maxObjectsInGet?: number
  readonly maxObjectsInSet?: number
}

export interface JmapClientOptions {
  readonly session: JmapSession
  readonly transport: JmapTransport
  readonly registry?: CapabilityRegistry
  readonly limits?: RequestLimits
  readonly maxRetries?: number
  readonly retryDelayMs?: number
  readonly onStateMismatch?: (response: JmapResponse) => Promise<void> | void
}

export interface JmapRequestInput {
  readonly using: readonly Capability[]
  readonly calls: readonly MethodCall[]
  readonly createdIds?: Record<string, string>
}

let callIdCounter = 0

export function nextCallId(prefix = "c"): string {
  callIdCounter += 1
  return `${prefix}${callIdCounter}`
}

export function methodCall<Name extends string, Args extends JsonObject>(
  name: Name,
  args: Args,
  callId = nextCallId(),
): MethodCall<Name, Args> {
  return [name, args, callId]
}

export function resultReference(resultOf: string, name: string, path: string): ResultReference {
  return { resultOf, name, path }
}

export function withResultReference<Args extends JsonObject>(
  args: Args,
  property: string,
  reference: ResultReference,
): Args & JsonObject {
  return { ...args, [`#${property}`]: reference as unknown as JsonObject }
}

export function buildJmapRequest(input: JmapRequestInput): JmapRequest {
  const methodCalls = [...input.calls]
  const callIds = new Set<string>()
  for (const call of methodCalls) {
    if (!call[2]) throw new Error("JMAP method call id must be non-empty")
    if (callIds.has(call[2])) throw new Error(`Duplicate JMAP method call id: ${call[2]}`)
    callIds.add(call[2])
  }

  const using = unique(input.using)
  const request: JmapRequest = { using, methodCalls }
  if (input.createdIds !== undefined) return { ...request, createdIds: { ...input.createdIds } }
  return request
}

export function chunkJmapRequest(request: JmapRequest, limits: RequestLimits = {}): JmapRequest[] {
  const maxCalls = limits.maxCallsInRequest ?? Number.POSITIVE_INFINITY
  const maxSize = limits.maxSizeRequest ?? Number.POSITIVE_INFINITY
  if (request.methodCalls.length <= maxCalls && estimateJsonByteLength(request) <= maxSize) return [request]

  const chunks: JmapRequest[] = []
  let current: MethodCall[] = []
  let currentIds = new Set<string>()
  const previousIds = new Set<string>()

  for (const call of request.methodCalls) {
    const candidate = { ...request, methodCalls: [...current, call] }
    const candidateTooLarge = candidate.methodCalls.length > maxCalls || estimateJsonByteLength(candidate) > maxSize
    const refs = collectResultReferenceIds(call[1])
    const dependsOnCurrent = refs.some((id) => currentIds.has(id))
    const dependsOnPrevious = refs.some((id) => previousIds.has(id))

    if (dependsOnPrevious) {
      throw new Error(`Cannot chunk JMAP result reference to previous request: ${call[2]}`)
    }

    if (candidateTooLarge && current.length > 0 && !dependsOnCurrent) {
      chunks.push(copyRequestWithCalls(request, current))
      for (const id of currentIds) previousIds.add(id)
      current = []
      currentIds = new Set<string>()
    }

    const single = { ...request, methodCalls: [...current, call] }
    if ((single.methodCalls.length > maxCalls || estimateJsonByteLength(single) > maxSize) && current.length > 0) {
      throw new Error(`Cannot chunk dependent JMAP calls without breaking result references: ${call[2]}`)
    }

    current.push(call)
    currentIds.add(call[2])
  }

  if (current.length > 0) chunks.push(copyRequestWithCalls(request, current))
  return chunks
}

export function expandObjectLimitCalls(request: JmapRequest, limits: RequestLimits = {}): JmapRequest {
  const referencedCallIds = collectReferencedCallIds(request.methodCalls)
  const methodCalls = request.methodCalls.flatMap((call) => splitObjectLimitCall(call, limits, referencedCallIds))
  return copyRequestWithCalls(request, methodCalls)
}

export function isSafeIdempotentCall(call: MethodCall): boolean {
  const name = call[0]
  return (
    name.endsWith("/get") ||
    name.endsWith("/changes") ||
    name.endsWith("/query") ||
    name.endsWith("/queryChanges") ||
    name === "SearchSnippet/get" ||
    name === "Principal/getAvailability"
  )
}

export function hasStateMismatch(response: JmapResponse): boolean {
  return response.methodResponses.some(([name, args]) => name === "error" && args.type === "stateMismatch")
}

export class JmapClient {
  private readonly session: JmapSession
  private readonly transport: JmapTransport
  private readonly registry: CapabilityRegistry
  private readonly limits: RequestLimits
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly onStateMismatch?: (response: JmapResponse) => Promise<void> | void

  constructor(options: JmapClientOptions) {
    this.session = options.session
    this.transport = options.transport
    this.registry = options.registry ?? standardCapabilityRegistry
    this.limits = sessionLimits(options.session, options.limits)
    this.maxRetries = options.maxRetries ?? 1
    this.retryDelayMs = options.retryDelayMs ?? 50
    if (options.onStateMismatch !== undefined) this.onStateMismatch = options.onStateMismatch
  }

  async request(input: JmapRequestInput): Promise<JmapResponse> {
    const using = this.registry.negotiate(this.session, input.using)
    const request = expandObjectLimitCalls(buildJmapRequest({ ...input, using }), this.limits)
    const chunks = chunkJmapRequest(request, this.limits)
    const responses: JmapResponse[] = []
    let createdIds: Record<string, string> = { ...(request.createdIds ?? {}) }

    for (const chunk of chunks) {
      const response = await this.sendWithRetry({ ...chunk, createdIds })
      if (response.createdIds !== undefined) createdIds = { ...createdIds, ...response.createdIds }
      responses.push(response)

      if (hasStateMismatch(response) && this.onStateMismatch !== undefined) {
        await this.onStateMismatch(response)
      }
    }

    return mergeResponses(responses, createdIds)
  }

  async call<Name extends string, Args extends JsonObject>(
    using: readonly Capability[],
    name: Name,
    args: Args,
    callId?: string,
  ): Promise<JmapResponse> {
    return this.request({ using, calls: [methodCall(name, args, callId)] })
  }

  private async sendWithRetry(request: JmapRequest): Promise<JmapResponse> {
    const retryable = request.methodCalls.every(isSafeIdempotentCall)
    let attempt = 0
    while (true) {
      try {
        return await this.transport.api(request)
      } catch (error) {
        attempt += 1
        const transportError = error instanceof JmapTransportError ? error : undefined
        const canRetry = retryable && attempt <= this.maxRetries && (transportError?.retryable ?? true)
        if (!canRetry) throw error
        await delay(this.retryDelayMs * attempt)
      }
    }
  }
}

function splitObjectLimitCall(
  call: MethodCall,
  limits: RequestLimits,
  referencedCallIds: ReadonlySet<string>,
): MethodCall[] {
  if (call[0].endsWith("/get")) return splitGetCall(call, limits.maxObjectsInGet, referencedCallIds)
  if (call[0].endsWith("/set")) return splitSetCall(call, limits.maxObjectsInSet, referencedCallIds)
  return [call]
}

function splitGetCall(call: MethodCall, maxObjects: number | undefined, referencedCallIds: ReadonlySet<string>): MethodCall[] {
  if (maxObjects === undefined || maxObjects < 1) return [call]
  const ids = call[1].ids
  if (!Array.isArray(ids) || ids.length <= maxObjects) return [call]
  if (referencedCallIds.has(call[2])) throw new Error(`Cannot split referenced JMAP get call: ${call[2]}`)

  return chunk(ids, maxObjects).map((chunkedIds, index) => [
    call[0],
    { ...call[1], ids: chunkedIds },
    `${call[2]}.${index + 1}`,
  ] as MethodCall)
}

function splitSetCall(call: MethodCall, maxObjects: number | undefined, referencedCallIds: ReadonlySet<string>): MethodCall[] {
  if (maxObjects === undefined || maxObjects < 1) return [call]
  const args = call[1]
  const create = objectEntries(args.create)
  const update = objectEntries(args.update)
  const destroy = stringArray(args.destroy).map((id) => [id, id] as const)
  const total = create.length + update.length + destroy.length
  if (total <= maxObjects) return [call]
  if (referencedCallIds.has(call[2])) throw new Error(`Cannot split referenced JMAP set call: ${call[2]}`)
  if (typeof args.ifInState === "string") throw new Error(`Cannot safely split JMAP set call with ifInState: ${call[2]}`)

  const splitCalls: MethodCall[] = []
  let index = 0
  for (const createChunk of chunk(create, maxObjects)) {
    index += 1
    splitCalls.push([call[0], cleanUndefined({ ...args, create: Object.fromEntries(createChunk) as JsonObject, update: undefined, destroy: undefined }), `${call[2]}.${index}`])
  }
  for (const updateChunk of chunk(update, maxObjects)) {
    index += 1
    splitCalls.push([call[0], cleanUndefined({ ...args, create: undefined, update: Object.fromEntries(updateChunk) as JsonObject, destroy: undefined }), `${call[2]}.${index}`])
  }
  for (const destroyChunk of chunk(destroy, maxObjects)) {
    index += 1
    splitCalls.push([call[0], cleanUndefined({ ...args, create: undefined, update: undefined, destroy: destroyChunk.map(([id]) => id) }), `${call[2]}.${index}`])
  }
  return splitCalls
}

function sessionLimits(session: JmapSession, override: RequestLimits = {}): RequestLimits {
  const core = session.capabilities["urn:ietf:params:jmap:core"] ?? {}
  const limits: RequestLimits = {}
  assignLimit(limits, "maxCallsInRequest", numberOrUndefined(core.maxCallsInRequest))
  assignLimit(limits, "maxSizeRequest", numberOrUndefined(core.maxSizeRequest))
  assignLimit(limits, "maxObjectsInGet", numberOrUndefined(core.maxObjectsInGet))
  assignLimit(limits, "maxObjectsInSet", numberOrUndefined(core.maxObjectsInSet))
  assignLimit(limits, "maxCallsInRequest", override.maxCallsInRequest)
  assignLimit(limits, "maxSizeRequest", override.maxSizeRequest)
  assignLimit(limits, "maxObjectsInGet", override.maxObjectsInGet)
  assignLimit(limits, "maxObjectsInSet", override.maxObjectsInSet)
  return limits
}

function mergeResponses(responses: readonly JmapResponse[], createdIds: Record<string, string>): JmapResponse {
  if (responses.length === 0) return { methodResponses: [], sessionState: "", createdIds }
  return {
    methodResponses: responses.flatMap((response) => response.methodResponses),
    sessionState: responses.at(-1)?.sessionState ?? "",
    createdIds,
  }
}

function collectResultReferenceIds(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap(collectResultReferenceIds)
  if (typeof input !== "object" || input === null) return []
  if (isResultReference(input)) return [input.resultOf]
  return Object.values(input).flatMap(collectResultReferenceIds)
}

function collectReferencedCallIds(calls: readonly MethodCall[]): Set<string> {
  return new Set(calls.flatMap((call) => collectResultReferenceIds(call[1])))
}

function isResultReference(input: object): input is ResultReference {
  const value = input as Record<string, unknown>
  return typeof value.resultOf === "string" && typeof value.name === "string" && typeof value.path === "string"
}

function copyRequestWithCalls(request: JmapRequest, methodCalls: MethodCall[]): JmapRequest {
  const copy: JmapRequest = { using: request.using, methodCalls }
  if (request.createdIds !== undefined) return { ...copy, createdIds: request.createdIds }
  return copy
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function objectEntries(value: unknown): [string, JsonValue | undefined][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.entries(value as JsonObject)
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function cleanUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Exclude<typeof entry[1], undefined>] => entry[1] !== undefined)) as JsonObject
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function assignLimit(target: RequestLimits, key: keyof RequestLimits, value: number | undefined): void {
  if (value !== undefined) Object.assign(target, { [key]: value })
}

function estimateJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
