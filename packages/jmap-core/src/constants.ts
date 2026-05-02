export const CAP_CORE = "urn:ietf:params:jmap:core" as const
export const CAP_MAIL = "urn:ietf:params:jmap:mail" as const
export const CAP_SUBMISSION = "urn:ietf:params:jmap:submission" as const
export const CAP_VACATION = "urn:ietf:params:jmap:vacationresponse" as const
export const CAP_CONTACTS = "urn:ietf:params:jmap:contacts" as const
export const CAP_CALENDARS = "urn:ietf:params:jmap:calendars" as const
export const CAP_AVAILABILITY = "urn:ietf:params:jmap:principals:availability" as const
export const CAP_BLOB = "urn:ietf:params:jmap:blob" as const
export const CAP_QUOTA = "urn:ietf:params:jmap:quota" as const
export const CAP_SIEVE = "urn:ietf:params:jmap:sieve" as const
export const CAP_PRINCIPALS = "urn:ietf:params:jmap:principals" as const
export const CAP_PRINCIPALS_OWNER = "urn:ietf:params:jmap:principals:owner" as const
export const CAP_WEBPUSH_VAPID = "urn:ietf:params:jmap:webpush-vapid" as const
export const CAP_MDN = "urn:ietf:params:jmap:mdn" as const
export const CAP_SMIME_VERIFY = "urn:ietf:params:jmap:smimeverify" as const
export const CAP_WEBSOCKET = "urn:ietf:params:jmap:websocket" as const

export const CALENDAR_SPEC_VERSION = "draft-ietf-jmap-calendars-26" as const

export const STANDARD_CAPABILITIES = [
  CAP_CORE,
  CAP_MAIL,
  CAP_SUBMISSION,
  CAP_VACATION,
  CAP_CONTACTS,
  CAP_CALENDARS,
  CAP_AVAILABILITY,
  CAP_BLOB,
  CAP_QUOTA,
  CAP_SIEVE,
  CAP_PRINCIPALS,
  CAP_PRINCIPALS_OWNER,
  CAP_WEBPUSH_VAPID,
  CAP_MDN,
  CAP_SMIME_VERIFY,
  CAP_WEBSOCKET,
] as const

export type StandardCapability = (typeof STANDARD_CAPABILITIES)[number]

const STANDARD_CAPABILITY_SET = new Set<string>(STANDARD_CAPABILITIES)

export function isStandardCapability(capability: string): capability is StandardCapability {
  return STANDARD_CAPABILITY_SET.has(capability)
}
