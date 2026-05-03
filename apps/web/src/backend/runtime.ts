import { invoke, isTauri as tauriRuntimeAvailable } from "@tauri-apps/api/core"
import { Binary } from "./binary"

export namespace RuntimeBackend {
  export async function jmapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const bridgeResponse = await tauriBridgeFetch(input, init)
    return bridgeResponse ?? fetch(input, init)
  }

  export function isTauriRuntime(): boolean {
    if (tauriRuntimeAvailable()) return true
    const runtime = globalThis as typeof globalThis & { readonly __TAURI_INTERNALS__?: unknown; readonly __TAURI__?: unknown; readonly isTauri?: unknown }
    return runtime.__TAURI_INTERNALS__ !== undefined || runtime.__TAURI__ !== undefined || runtime.isTauri === true
  }

  interface TauriBridgeHttpResponse {
    readonly status: number
    readonly headers: Record<string, string>
    readonly body: string
    readonly bodyBase64?: string
  }

  async function tauriBridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
    if (!isTauriRuntime()) return undefined
    const response = await invoke<TauriBridgeHttpResponse>("jmap_http", {
      req: {
        url: requestUrl(input),
        method: init?.method ?? "GET",
        headers: headersToRecord(init?.headers),
        body: await requestBodyText(init?.body),
      },
    })
    const body = response.bodyBase64 === undefined ? response.body : Binary.bufferSource(Binary.base64ToBytes(response.bodyBase64))
    return new Response(body, { status: response.status, headers: response.headers })
  }

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input
    if (input instanceof URL) return input.toString()
    return input.url
  }

  function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
    const record: Record<string, string> = {}
    if (headers === undefined) return record
    if (headers instanceof Headers) {
      headers.forEach((value, name) => { record[name] = value })
      return record
    }
    if (Array.isArray(headers)) {
      for (const [name, value] of headers) record[name] = value
      return record
    }
    return { ...headers }
  }

  async function requestBodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
    if (body === undefined || body === null) return undefined
    if (typeof body === "string") return body
    if (body instanceof URLSearchParams) return body.toString()
    throw new Error("Desktop bridge only supports text request bodies.")
  }
}
