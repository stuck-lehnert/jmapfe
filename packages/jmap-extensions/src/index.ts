import {
  CAP_BLOB,
  CAP_MDN,
  CAP_PRINCIPALS,
  CAP_PRINCIPALS_OWNER,
  CAP_QUOTA,
  CAP_SIEVE,
  CAP_SMIME_VERIFY,
  CAP_WEBPUSH_VAPID,
  CAP_WEBSOCKET,
  methodCall,
  type Capability,
  type JsonObject,
  type MethodCall,
} from "@jmapfe/jmap-core"

export const EXTENSION_CAPABILITIES = [
  CAP_MDN,
  CAP_SMIME_VERIFY,
  CAP_BLOB,
  CAP_QUOTA,
  CAP_SIEVE,
  CAP_PRINCIPALS,
  CAP_PRINCIPALS_OWNER,
  CAP_WEBPUSH_VAPID,
  CAP_WEBSOCKET,
] as const

export interface JmapExtensionModule {
  readonly capability: Capability
  readonly methods: readonly string[]
  readonly displayName: string
}

export const EXTENSION_MODULES: readonly JmapExtensionModule[] = [
  { capability: CAP_MDN, displayName: "Message Disposition Notifications", methods: ["MDN/get", "MDN/set"] },
  { capability: CAP_SMIME_VERIFY, displayName: "S/MIME Verify", methods: ["Email/get"] },
  { capability: CAP_BLOB, displayName: "Blob", methods: ["Blob/get", "Blob/copy", "Blob/lookup"] },
  { capability: CAP_QUOTA, displayName: "Quota", methods: ["Quota/get", "Quota/changes"] },
  { capability: CAP_SIEVE, displayName: "Sieve", methods: ["SieveScript/get", "SieveScript/set"] },
  { capability: CAP_PRINCIPALS, displayName: "Principals", methods: ["Principal/get", "Principal/query"] },
  { capability: CAP_PRINCIPALS_OWNER, displayName: "Principal Owner", methods: ["Principal/get"] },
  { capability: CAP_WEBPUSH_VAPID, displayName: "WebPush VAPID", methods: ["PushSubscription/set"] },
  { capability: CAP_WEBSOCKET, displayName: "JMAP WebSocket", methods: [] },
]

export function extensionMethod(name: string, args: object, callId?: string): MethodCall {
  return methodCall(name, args as JsonObject, callId)
}
