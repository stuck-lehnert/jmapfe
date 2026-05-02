import { CAP_CORE, type Capability, type JmapClient, type JsonObject, type MethodResponse } from "@jmapfe/jmap-core"

export interface SyncTypeStore<T extends JsonObject> {
  getState(accountId: string, datatype: string): Promise<string | undefined>
  initialSync(input: SyncTypeInput<T>): Promise<SyncTypeResult>
  fullResync(input: SyncTypeInput<T>): Promise<SyncTypeResult>
  upsert(accountId: string, datatype: string, objects: readonly T[]): Promise<void>
  destroy(accountId: string, datatype: string, ids: readonly string[]): Promise<void>
  setState(accountId: string, datatype: string, state: string): Promise<void>
  transaction<Tx>(fn: () => Promise<Tx> | Tx): Promise<Tx>
}

export interface SyncTypeInput<T extends JsonObject> {
  readonly accountId: string
  readonly datatype: string
  readonly using: readonly Capability[]
  readonly client: JmapClient
  readonly store: SyncTypeStore<T>
  readonly batchSize?: number
}

export interface SyncTypeResult {
  readonly datatype: string
  readonly created: number
  readonly updated: number
  readonly destroyed: number
  readonly state: string
  readonly fullResync: boolean
}

export async function syncType<T extends JsonObject>(input: SyncTypeInput<T>): Promise<SyncTypeResult> {
  const state = await input.store.getState(input.accountId, input.datatype)
  if (state === undefined) return input.store.initialSync(input)

  const changesResponse = await input.client.call(input.using, `${input.datatype}/changes`, {
    accountId: input.accountId,
    sinceState: state,
  })
  const changes = firstResponse(changesResponse.methodResponses)
  if (changes.name === "error" && changes.args.type === "cannotCalculateChanges") return input.store.fullResync(input)
  if (changes.name === "error") throw new Error(`JMAP ${input.datatype}/changes failed: ${String(changes.args.type)}`)

  const created = stringArray(changes.args.created)
  const updated = stringArray(changes.args.updated)
  const destroyed = stringArray(changes.args.destroyed)
  const newState = stringValue(changes.args.newState, "newState")
  const changedIds = [...created, ...updated]
  const objects: T[] = []

  for (const ids of chunk(changedIds, input.batchSize ?? 500)) {
    const getResponse = await input.client.call(input.using, `${input.datatype}/get`, {
      accountId: input.accountId,
      ids,
    })
    const get = firstResponse(getResponse.methodResponses)
    if (get.name === "error") throw new Error(`JMAP ${input.datatype}/get failed: ${String(get.args.type)}`)
    objects.push(...(arrayValue(get.args.list, "list") as T[]))
  }

  await input.store.transaction(async () => {
    await input.store.upsert(input.accountId, input.datatype, objects)
    await input.store.destroy(input.accountId, input.datatype, destroyed)
    await input.store.setState(input.accountId, input.datatype, newState)
  })

  return {
    datatype: input.datatype,
    created: created.length,
    updated: updated.length,
    destroyed: destroyed.length,
    state: newState,
    fullResync: false,
  }
}

export const DEFAULT_SYNC_USING = [CAP_CORE] as const

export interface OfflineMutation {
  readonly id: string
  readonly accountId: string
  readonly datatype: string
  readonly op: string
  readonly objectId?: string
  readonly patch: JsonObject
  readonly ifInState?: string
}

interface ParsedResponse {
  readonly name: string
  readonly args: JsonObject
  readonly callId: string
}

function firstResponse(responses: readonly MethodResponse[]): ParsedResponse {
  const first = responses[0]
  if (first === undefined) throw new Error("JMAP response missing method response")
  return { name: first[0], args: first[1], callId: first[2] }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be string`)
  return value
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be array`)
  return value
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}
