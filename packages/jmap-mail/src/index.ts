import {
  CAP_MAIL,
  CAP_SUBMISSION,
  CAP_VACATION,
  methodCall,
  type JmapClient,
  type JmapSession,
  type JsonObject,
  type MethodCall,
  type MethodResponse,
} from "@jmapfe/jmap-core"

export const MAIL_CAPABILITIES = [CAP_MAIL, CAP_SUBMISSION, CAP_VACATION] as const

export const MAIL_METHODS = [
  "Mailbox/get",
  "Mailbox/changes",
  "Mailbox/query",
  "Mailbox/queryChanges",
  "Mailbox/set",
  "Thread/get",
  "Thread/changes",
  "Email/get",
  "Email/changes",
  "Email/query",
  "Email/queryChanges",
  "Email/set",
  "Email/copy",
  "Email/import",
  "Email/parse",
  "SearchSnippet/get",
  "Identity/get",
  "Identity/changes",
  "Identity/set",
  "EmailSubmission/get",
  "EmailSubmission/changes",
  "EmailSubmission/query",
  "EmailSubmission/queryChanges",
  "EmailSubmission/set",
  "VacationResponse/get",
  "VacationResponse/set",
] as const

export type MailMethodName = (typeof MAIL_METHODS)[number]

export interface IdsGetArgs {
  readonly accountId: string
  readonly ids?: readonly string[] | null
  readonly properties?: readonly string[]
}

export interface ChangesArgs {
  readonly accountId: string
  readonly sinceState: string
  readonly maxChanges?: number
}

export interface QueryArgs {
  readonly accountId: string
  readonly filter?: unknown
  readonly sort?: readonly unknown[]
  readonly position?: number
  readonly anchor?: string
  readonly anchorOffset?: number
  readonly limit?: number
  readonly calculateTotal?: boolean
}

export interface QueryChangesArgs extends QueryArgs {
  readonly sinceQueryState: string
  readonly maxChanges?: number
  readonly upToId?: string
}

export interface SetArgs<T = unknown> {
  readonly accountId: string
  readonly ifInState?: string
  readonly create?: Record<string, T>
  readonly update?: Record<string, T>
  readonly destroy?: readonly string[]
}

export function mailMethod<Name extends MailMethodName>(name: Name, args: object, callId?: string): MethodCall<Name> {
  return methodCall(name, args as JsonObject, callId)
}

export const Mailbox = {
  get: (args: IdsGetArgs, callId?: string) => mailMethod("Mailbox/get", args, callId),
  changes: (args: ChangesArgs, callId?: string) => mailMethod("Mailbox/changes", args, callId),
  query: (args: QueryArgs, callId?: string) => mailMethod("Mailbox/query", args, callId),
  queryChanges: (args: QueryChangesArgs, callId?: string) => mailMethod("Mailbox/queryChanges", args, callId),
  set: (args: SetArgs, callId?: string) => mailMethod("Mailbox/set", args, callId),
}

export const Thread = {
  get: (args: IdsGetArgs, callId?: string) => mailMethod("Thread/get", args, callId),
  changes: (args: ChangesArgs, callId?: string) => mailMethod("Thread/changes", args, callId),
}

export const Email = {
  get: (args: IdsGetArgs, callId?: string) => mailMethod("Email/get", args, callId),
  changes: (args: ChangesArgs, callId?: string) => mailMethod("Email/changes", args, callId),
  query: (args: QueryArgs, callId?: string) => mailMethod("Email/query", args, callId),
  queryChanges: (args: QueryChangesArgs, callId?: string) => mailMethod("Email/queryChanges", args, callId),
  set: (args: SetArgs, callId?: string) => mailMethod("Email/set", args, callId),
  copy: (args: object, callId?: string) => mailMethod("Email/copy", args, callId),
  import: (args: object, callId?: string) => mailMethod("Email/import", args, callId),
  parse: (args: object, callId?: string) => mailMethod("Email/parse", args, callId),
}

export const SearchSnippet = {
  get: (args: object, callId?: string) => mailMethod("SearchSnippet/get", args, callId),
}

export const Identity = {
  get: (args: IdsGetArgs, callId?: string) => mailMethod("Identity/get", args, callId),
  changes: (args: ChangesArgs, callId?: string) => mailMethod("Identity/changes", args, callId),
  set: (args: SetArgs, callId?: string) => mailMethod("Identity/set", args, callId),
}

export const EmailSubmission = {
  get: (args: IdsGetArgs, callId?: string) => mailMethod("EmailSubmission/get", args, callId),
  changes: (args: ChangesArgs, callId?: string) => mailMethod("EmailSubmission/changes", args, callId),
  query: (args: QueryArgs, callId?: string) => mailMethod("EmailSubmission/query", args, callId),
  queryChanges: (args: QueryChangesArgs, callId?: string) => mailMethod("EmailSubmission/queryChanges", args, callId),
  set: (args: SetArgs, callId?: string) => mailMethod("EmailSubmission/set", args, callId),
}

export const VacationResponse = {
  get: (args: { readonly accountId: string }, callId?: string) => mailMethod("VacationResponse/get", args, callId),
  set: (args: object, callId?: string) => mailMethod("VacationResponse/set", args, callId),
}

export const EMAIL_METADATA_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "size",
  "receivedAt",
  "sentAt",
  "subject",
  "preview",
  "from",
  "to",
  "cc",
  "bcc",
  "replyTo",
  "messageId",
  "inReplyTo",
  "references",
  "hasAttachment",
] as const

export interface MailReadStore {
  transaction<T>(fn: () => Promise<T> | T): Promise<T>
  upsertMailboxes(accountId: string, mailboxes: readonly JsonObject[]): Promise<void>
  upsertIdentities(accountId: string, identities: readonly JsonObject[]): Promise<void>
  upsertEmails(accountId: string, emails: readonly JsonObject[]): Promise<void>
  upsertThreads(accountId: string, threads: readonly JsonObject[]): Promise<void>
  setSyncState(accountId: string, datatype: string, state: string): Promise<void>
  saveEmailWindow?(accountId: string, input: EmailWindow): Promise<void>
}

export interface EmailWindow {
  readonly mailboxId?: string
  readonly position: number
  readonly ids: readonly string[]
  readonly queryState: string
  readonly total?: number
}

export interface InitialMailReadSyncInput {
  readonly client: JmapClient
  readonly session: JmapSession
  readonly store: MailReadStore
  readonly accountId?: string
  readonly mailboxRole?: string
  readonly limit?: number
}

export interface InitialMailReadSyncResult {
  readonly accountId: string
  readonly mailboxCount: number
  readonly identityCount: number
  readonly emailCount: number
  readonly threadCount: number
  readonly mailboxId?: string
}

export async function initialMailReadSync(input: InitialMailReadSyncInput): Promise<InitialMailReadSyncResult> {
  const accountId = input.accountId ?? primaryMailAccountId(input.session)
  const using = [CAP_MAIL, CAP_SUBMISSION]

  const mailbox = responseArgs(await input.client.call(using, "Mailbox/get", { accountId, ids: null }, "mailbox-get"))
  const mailboxes = jsonObjectArray(mailbox.list)
  const mailboxId = pickMailboxId(mailboxes, input.mailboxRole ?? "inbox")
  const identity = responseArgs(await input.client.call(using, "Identity/get", { accountId, ids: null }, "identity-get"))
  const identities = jsonObjectArray(identity.list)
  const emailQueryArgs = cleanUndefined({
    accountId,
    filter: mailboxId === undefined ? undefined : { inMailbox: mailboxId },
    sort: [{ property: "receivedAt", isAscending: false }],
    position: 0,
    limit: input.limit ?? 50,
    calculateTotal: true,
  })
  const emailQuery = responseArgs(await input.client.call(using, "Email/query", emailQueryArgs, "email-query"))
  const emailIds = stringArray(emailQuery.ids)
  const emailGet = responseArgs(
    await input.client.call(
      using,
      "Email/get",
      { accountId, ids: emailIds, properties: [...EMAIL_METADATA_PROPERTIES] },
      "email-get",
    ),
  )
  const emails = jsonObjectArray(emailGet.list)
  const threadIds = unique(emails.map((email) => email.threadId).filter((threadId): threadId is string => typeof threadId === "string"))
  const threadGet = responseArgs(await input.client.call(using, "Thread/get", { accountId, ids: threadIds }, "thread-get"))
  const threads = jsonObjectArray(threadGet.list)

  await input.store.transaction(async () => {
    await input.store.upsertMailboxes(accountId, mailboxes)
    await input.store.upsertIdentities(accountId, identities)
    await input.store.upsertEmails(accountId, emails)
    await input.store.upsertThreads(accountId, threads)
    await setStateIfPresent(input.store, accountId, "Mailbox", mailbox.state)
    await setStateIfPresent(input.store, accountId, "Identity", identity.state)
    await setStateIfPresent(input.store, accountId, "Email", emailGet.state)
    await setStateIfPresent(input.store, accountId, "Thread", threadGet.state)
    if (typeof emailQuery.queryState === "string") {
      await input.store.saveEmailWindow?.(accountId, {
        ...(mailboxId === undefined ? {} : { mailboxId }),
        position: numberValue(emailQuery.position) ?? 0,
        ids: emailIds,
        queryState: emailQuery.queryState,
        ...(typeof emailQuery.total === "number" ? { total: emailQuery.total } : {}),
      })
    }
  })

  return {
    accountId,
    mailboxCount: mailboxes.length,
    identityCount: identities.length,
    emailCount: emails.length,
    threadCount: threads.length,
    ...(mailboxId === undefined ? {} : { mailboxId }),
  }
}

function primaryMailAccountId(session: JmapSession): string {
  const accountId = session.primaryAccounts[CAP_MAIL]
  if (accountId === undefined || accountId === null) throw new Error("Session has no primary mail account")
  return accountId
}

function responseArgs(response: { readonly methodResponses: readonly MethodResponse[] }): JsonObject {
  const first = response.methodResponses[0]
  if (first === undefined) throw new Error("JMAP response missing method response")
  if (first[0] === "error") throw new Error(`JMAP method failed: ${String(first[1].type)}`)
  return first[1]
}

function pickMailboxId(mailboxes: readonly JsonObject[], role: string): string | undefined {
  const byRole = mailboxes.find((mailbox) => mailbox.role === role)
  if (typeof byRole?.id === "string") return byRole.id
  const byName = mailboxes.find((mailbox) => typeof mailbox.name === "string" && mailbox.name.toLowerCase() === role)
  return typeof byName?.id === "string" ? byName.id : undefined
}

function jsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function cleanUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
}

async function setStateIfPresent(store: MailReadStore, accountId: string, datatype: string, state: unknown): Promise<void> {
  if (typeof state === "string") await store.setSyncState(accountId, datatype, state)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}
