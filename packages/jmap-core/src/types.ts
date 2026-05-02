export type AccountId = string
export type Capability = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export interface JmapAccount {
  readonly name: string
  readonly isPersonal: boolean
  readonly isReadOnly: boolean
  readonly accountCapabilities: Record<Capability, JsonObject>
}

export interface JmapSession {
  readonly capabilities: Record<Capability, JsonObject>
  readonly accounts: Record<AccountId, JmapAccount>
  readonly primaryAccounts: Record<Capability, AccountId | null>
  readonly username: string
  readonly apiUrl: string
  readonly downloadUrl: string
  readonly uploadUrl: string
  readonly eventSourceUrl?: string
  readonly state: string
}

export type MethodCall<Name extends string = string, Args extends JsonObject = JsonObject> = readonly [
  Name,
  Args,
  string,
]

export type MethodResponse<Name extends string = string, Args extends JsonObject = JsonObject> = readonly [
  Name,
  Args,
  string,
]

export interface ResultReference {
  readonly resultOf: string
  readonly name: string
  readonly path: string
}

export interface JmapRequest {
  readonly using: Capability[]
  readonly methodCalls: MethodCall[]
  readonly createdIds?: Record<string, string>
}

export interface JmapResponse {
  readonly methodResponses: MethodResponse[]
  readonly sessionState: string
  readonly createdIds?: Record<string, string>
}

export interface JmapErrorObject extends JsonObject {
  readonly type: string
  readonly description?: string
}

export interface BlobUploadResponse extends JsonObject {
  readonly accountId: string
  readonly blobId: string
  readonly type: string
  readonly size: number
}

export type BlobLike = Blob | ArrayBuffer | Uint8Array

export interface StateChange extends JsonObject {
  readonly changed: Record<AccountId, Record<string, string>>
}

export interface JmapSocket {
  send(req: JmapRequest): Promise<JmapResponse>
  close(): void | Promise<void>
}
