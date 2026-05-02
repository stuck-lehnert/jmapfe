import { authHeaders, type AuthProvider } from "./auth.ts"
import { JmapTransportError } from "./errors.ts"
import { parseJmapResponse, parseJmapSession } from "./session.ts"
import type {
  BlobLike,
  BlobUploadResponse,
  JmapRequest,
  JmapResponse,
  JmapSession,
  JmapSocket,
  StateChange,
} from "./types.ts"

export interface JmapTransport {
  getSession(url: string, auth: AuthProvider): Promise<JmapSession>
  api(req: JmapRequest): Promise<JmapResponse>
  upload(accountId: string, file: BlobLike): Promise<BlobUploadResponse>
  download(accountId: string, blobId: string, name: string, type: string): Promise<BlobLike>
  eventSource?(types: string[]): AsyncIterable<StateChange>
  websocket?(): JmapSocket
}

export interface FetchJmapTransportOptions {
  readonly auth: AuthProvider
  readonly session?: JmapSession
  readonly fetchImpl?: typeof fetch
}

export class FetchJmapTransport implements JmapTransport {
  private readonly auth: AuthProvider
  private readonly fetchImpl: typeof fetch
  private session?: JmapSession

  constructor(options: FetchJmapTransportOptions) {
    this.auth = options.auth
    this.fetchImpl = options.fetchImpl ?? fetch
    if (options.session !== undefined) this.session = options.session
  }

  async getSession(url: string, auth: AuthProvider = this.auth): Promise<JmapSession> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: await authHeaders(auth),
      redirect: "follow",
    })
    const json = await parseJsonResponse(response, "JMAP session discovery failed")
    const session = parseJmapSession(json)
    this.session = session
    return session
  }

  async api(req: JmapRequest): Promise<JmapResponse> {
    const session = this.requireSession()
    const response = await this.fetchImpl(session.apiUrl, {
      method: "POST",
      headers: {
        ...(await authHeaders(this.auth)),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(req),
      redirect: "follow",
    })
    const json = await parseJsonResponse(response, "JMAP API request failed")
    return parseJmapResponse(json)
  }

  async upload(accountId: string, file: BlobLike): Promise<BlobUploadResponse> {
    const session = this.requireSession()
    const response = await this.fetchImpl(expandUrlTemplate(session.uploadUrl, { accountId }), {
      method: "POST",
      headers: await authHeaders(this.auth),
      body: toBodyInit(file),
      redirect: "follow",
    })
    return (await parseJsonResponse(response, "JMAP upload failed")) as BlobUploadResponse
  }

  async download(accountId: string, blobId: string, name: string, type: string): Promise<BlobLike> {
    const session = this.requireSession()
    const response = await this.fetchImpl(
      expandUrlTemplate(session.downloadUrl, { accountId, blobId, name, type }),
      {
        method: "GET",
        headers: await authHeaders(this.auth),
        redirect: "follow",
      },
    )
    if (!response.ok) throw httpError(response, "JMAP download failed")
    return response.arrayBuffer()
  }

  private requireSession(): JmapSession {
    if (this.session === undefined) throw new Error("JMAP session not discovered")
    return this.session
  }
}

export function expandUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing URL template value: ${key}`)
    return encodeURIComponent(value)
  })
}

async function parseJsonResponse(response: Response, message: string): Promise<unknown> {
  if (!response.ok) throw httpError(response, message)
  return response.json() as Promise<unknown>
}

function httpError(response: Response, message: string): JmapTransportError {
  return new JmapTransportError(`${message}: HTTP ${response.status}`, {
    status: response.status,
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
  })
}

function toBodyInit(file: BlobLike): BodyInit {
  if (file instanceof Blob) return file
  if (file instanceof ArrayBuffer) return file
  return file.slice().buffer as ArrayBuffer
}
