export const JMAP_ERROR_TYPES = [
  "accountNotFound",
  "accountNotSupportedByMethod",
  "accountReadOnly",
  "anchorNotFound",
  "cannotCalculateChanges",
  "forbidden",
  "fromAccountNotFound",
  "invalidArguments",
  "invalidResultReference",
  "methodNotFound",
  "notFound",
  "overQuota",
  "requestTooLarge",
  "stateMismatch",
  "willDestroy",
  "mailboxHasChild",
  "mailboxHasEmail",
  "blobNotFound",
  "tooManyKeywords",
  "tooManyMailboxes",
  "invalidEmail",
  "tooManyRecipients",
  "noRecipients",
  "invalidRecipients",
  "forbiddenMailFrom",
  "forbiddenFrom",
  "forbiddenToSend",
  "calendarHasEvent",
  "noSupportedScheduleMethods",
  "cannotCalculateOccurrences",
  "addressBookHasContents",
] as const

export type JmapErrorType = (typeof JMAP_ERROR_TYPES)[number]

const JMAP_ERROR_SET = new Set<string>(JMAP_ERROR_TYPES)

export function isKnownJmapErrorType(type: string): type is JmapErrorType {
  return JMAP_ERROR_SET.has(type)
}

export class JmapMethodError extends Error {
  readonly type: string
  readonly description?: string

  constructor(type: string, description?: string) {
    super(description ? `${type}: ${description}` : type)
    this.name = "JmapMethodError"
    this.type = type
    if (description !== undefined) this.description = description
  }
}

export class JmapTransportError extends Error {
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message)
    this.name = "JmapTransportError"
    if (options.status !== undefined) this.status = options.status
    this.retryable = options.retryable ?? true
  }
}
