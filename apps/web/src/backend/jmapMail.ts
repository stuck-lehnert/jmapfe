import type { ConfiguredAccount } from "@jmapfe/app-core"
import {
  CAP_MAIL,
  CAP_SUBMISSION,
  FetchJmapTransport,
  JmapClient,
  JmapTransportError,
  discoverJmapSessionWithUrl,
  methodCall,
  resultReference,
  resolveJmapSrvOverHttps,
  withResultReference,
  type AuthProvider,
  type BlobLike,
  type JmapResponse,
  type JmapSession,
  type JsonObject,
  type SrvRecord,
} from "@jmapfe/jmap-core"
import { AttachmentBackend } from "./attachments"
import { EmailHtml } from "./emailHtml"
import { MailModel } from "./mailModel"
import { MailState } from "./mailState"
import { RuntimeBackend } from "./runtime"

type AccountMailState = MailModel.AccountMailState
type ComposeDraft = MailModel.ComposeDraft
type EmailAttachmentPart = MailModel.EmailAttachmentPart
type EmailQueryResult = MailModel.EmailQueryResult
type FolderLoadTarget = MailModel.FolderLoadTarget
type InlineImageLoadResult = MailModel.InlineImageLoadResult
type InlineImagePart = MailModel.InlineImagePart
type JmapMailAccountTarget = MailModel.JmapMailAccountTarget
type LoadedMailTargetBatch = MailModel.LoadedMailTargetBatch
type MailMessage = MailModel.MailMessage
type MailboxRights = MailModel.MailboxRights
type MailboxSummary = MailModel.MailboxSummary
type MessageBody = MailModel.MessageBody
type MessageFlagState = MailModel.MessageFlagState

const EMAIL_PAGE_SIZE = MailModel.EMAIL_PAGE_SIZE
const EMAIL_METADATA_PROPERTIES = MailModel.EMAIL_METADATA_PROPERTIES
const EMAIL_BODY_PROPERTIES = MailModel.EMAIL_BODY_PROPERTIES
const EMAIL_BODY_PART_PROPERTIES = MailModel.EMAIL_BODY_PART_PROPERTIES

export namespace JmapMail {
  export interface MailClientContext {
    readonly client: JmapClient
    readonly session: JmapSession
    readonly transport: FetchJmapTransport
    readonly primaryMailAccountId: string
  }

  interface SendIdentity {
    readonly id: string
    readonly name?: string
    readonly email: string
  }

  export async function fetchAccountMail(account: ConfiguredAccount, auth: AuthProvider): Promise<AccountMailState> {
    const { client, session, primaryMailAccountId } = await createMailClient(account, auth)
    const mailTargets = mailAccountTargets(session, primaryMailAccountId)
    const states = await Promise.all(mailTargets.map((target) => fetchMailTargetBatch(client, account, target)))

    return {
      status: "ready",
      mailboxes: states.flatMap((state) => state.mailboxes),
      messages: states.flatMap((state) => state.messages).sort((left, right) => MailState.messageTime(right) - MailState.messageTime(left)),
      syncedAt: new Date().toISOString(),
    }
  }

  export async function fetchMailTargetBatch(client: JmapClient, account: ConfiguredAccount, target: JmapMailAccountTarget): Promise<LoadedMailTargetBatch> {
    const mailboxArgs = responseArgs(await client.call([CAP_MAIL], "Mailbox/get", { accountId: target.id, ids: null }, `ui-mailbox-get-${target.id}`))
    const mailboxes = addJmapAccountRoot(target, jsonObjectArray(mailboxArgs.list).flatMap((mailbox) => toMailboxSummary(mailbox, target)))
    const { messages } = await queryAndFetchEmailMessages(client, account, target.id, { limit: EMAIL_PAGE_SIZE }, `ui-email-${target.id}`)
    return { mailboxes, messages }
  }

  export async function fetchMoreMailboxMessages(account: ConfiguredAccount, auth: AuthProvider, target: FolderLoadTarget, existingMessages: readonly MailMessage[]): Promise<MailMessage[]> {
    const { client, primaryMailAccountId } = await createMailClient(account, auth)
    const jmapAccountId = target.jmapAccountId ?? primaryMailAccountId
    const emailIds = unique((await queryEmail(client, jmapAccountId, { mailboxId: target.jmapMailboxId, limit: target.loadedCount + EMAIL_PAGE_SIZE })).ids)
    const existingIds = new Set(existingMessages
      .filter((message) => (message.jmapAccountId ?? primaryMailAccountId) === jmapAccountId && message.mailboxIds.includes(target.mailboxId))
      .map((message) => message.id))
    const missingIds = emailIds.filter((id) => !existingIds.has(id))
    return missingIds.length === 0 ? [] : fetchEmailMessages(client, account, jmapAccountId, missingIds)
  }

  export async function createMailClient(account: ConfiguredAccount, auth: AuthProvider): Promise<MailClientContext> {
    const sessionUrl = accountSessionUrl(account)
    const sessionTransport = new FetchJmapTransport({ auth, fetchImpl: RuntimeBackend.jmapFetch })
    const sessionResult = await discoverJmapSessionWithUrl({
      email: account.email,
      ...(sessionUrl === undefined ? { resolveSrv: resolveJmapSrvFresh } : { sessionUrl }),
      auth,
      transport: sessionTransport,
    })
    const session = sessionResult.session
    const primaryMailAccountId = account.primaryMailAccountId ?? session.primaryAccounts[CAP_MAIL] ?? firstMailAccountId(session)
    if (primaryMailAccountId === undefined || primaryMailAccountId === null) throw new Error("No mail account found on server.")

    const transport = new FetchJmapTransport({ auth, session, fetchImpl: RuntimeBackend.jmapFetch })
    return {
      primaryMailAccountId,
      session,
      transport,
      client: new JmapClient({
        session,
        transport,
      }),
    }
  }

  export async function sendComposeDraft(account: ConfiguredAccount, auth: AuthProvider, draft: ComposeDraft): Promise<void> {
    const { client, session, primaryMailAccountId } = await createMailClient(account, auth)
    const mailAccountId = draft.jmapAccountId ?? primaryMailAccountId
    if (session.capabilities[CAP_SUBMISSION] === undefined || session.accounts[mailAccountId]?.accountCapabilities[CAP_SUBMISSION] === undefined) {
      throw new Error("Server does not advertise JMAP submission for this account.")
    }

    const [identity, mailboxes] = await Promise.all([
      fetchSendIdentity(client, mailAccountId, account.email),
      fetchServerMailboxes(client, mailAccountId),
    ])
    const draftsMailboxId = mailboxServerIdByRole(mailboxes, "drafts")
    const sentMailboxId = mailboxServerIdByRole(mailboxes, "sent")
    if (draftsMailboxId === undefined) throw new Error("Server did not advertise a Drafts mailbox.")

    const recipients = {
      to: parseComposeAddressList(draft.to, "To"),
      cc: parseComposeAddressList(draft.cc, "Cc"),
      bcc: parseComposeAddressList(draft.bcc, "Bcc"),
    }
    if (recipients.to.length + recipients.cc.length + recipients.bcc.length === 0) throw new Error("Add at least one recipient before sending.")

    const emailCreateId = "draft"
    const submissionCreateId = "submission"
    const emailSetCallId = "ui-compose-email-set"
    const submissionSetCallId = "ui-compose-submission-set"
    const response = await client.request({
      using: [CAP_MAIL, CAP_SUBMISSION],
      calls: [
        methodCall("Email/set", {
          accountId: mailAccountId,
          create: {
            [emailCreateId]: composeEmailCreateObject(account, identity, draft, draftsMailboxId, recipients),
          },
        }, emailSetCallId),
        methodCall("EmailSubmission/set", {
          accountId: mailAccountId,
          create: {
            [submissionCreateId]: {
              emailId: `#${emailCreateId}`,
              identityId: identity.id,
            },
          },
          onSuccessUpdateEmail: {
            [submissionCreateId]: sentMailboxId === undefined ? {
              "keywords/$draft": null,
            } : {
              "keywords/$draft": null,
              [`mailboxIds/${jmapPatchPathSegment(draftsMailboxId)}`]: null,
              [`mailboxIds/${jmapPatchPathSegment(sentMailboxId)}`]: true,
            },
          },
        }, submissionSetCallId),
      ],
    })

    throwIfSetCreateRejected(responseArgsByCallId(response, emailSetCallId), emailCreateId, "Server rejected draft creation.")
    throwIfSetCreateRejected(responseArgsByCallId(response, submissionSetCallId), submissionCreateId, "Server rejected email submission.")
  }

  export async function fetchEmailMessageBody(client: JmapClient, mailAccountId: string, emailId: string): Promise<MessageBody> {
    const emailArgs = responseArgs(await client.call([CAP_MAIL], "Email/get", {
      accountId: mailAccountId,
      ids: [emailId],
      properties: [...EMAIL_BODY_PROPERTIES],
      bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
      maxBodyValueBytes: 200_000,
    }, "ui-email-body-get"))
    const email = jsonObjectArray(emailArgs.list)[0]
    if (email === undefined) throw new Error("Message body was not returned by server.")
    const bodyText = textBodyValue(email)
    const bodyHtml = htmlBodyValue(email)
    const attachments = emailAttachmentParts(email)
    const inlineImages = inlineImageParts(attachments)
    return {
      bodyText,
      ...(bodyHtml.length === 0 ? {} : { bodyHtml }),
      inlineImages,
      attachments,
    }
  }

  export async function searchMailboxMessagesWithClient(client: JmapClient, account: ConfiguredAccount, jmapAccountId: string, target: FolderLoadTarget, searchText: string): Promise<{ readonly messages: readonly MailMessage[]; readonly total?: number }> {
    return queryAndFetchEmailMessages(client, account, jmapAccountId, { mailboxId: target.jmapMailboxId, searchText, limit: EMAIL_PAGE_SIZE }, `ui-search-${target.jmapMailboxId}`)
  }

  export function mailAccountTargets(session: JmapSession, primaryMailAccountId: string): JmapMailAccountTarget[] {
    return Object.entries(session.accounts)
      .filter(([, account]) => account.accountCapabilities[CAP_MAIL] !== undefined)
      .map(([id, account]) => ({ id, name: account.name || id, isPrimary: id === primaryMailAccountId, isPersonal: account.isPersonal, isReadOnly: account.isReadOnly }))
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name))
  }

  export async function setRemoteMessageFlagState(client: JmapClient, accountId: string, messageId: string, flagState: MessageFlagState): Promise<void> {
    const args = responseArgs(await client.call([CAP_MAIL], "Email/set", {
      accountId,
      update: {
        [messageId]: flagStatePatch(flagState),
      },
    }, "ui-email-flag-set"))
    if (keywordRecord(args.notUpdated)[messageId] !== undefined) throw new Error("Server rejected message flag update.")
  }

  export async function setRemoteMessageReadState(client: JmapClient, accountId: string, messageId: string, read: boolean): Promise<void> {
    const args = responseArgs(await client.call([CAP_MAIL], "Email/set", {
      accountId,
      update: {
        [messageId]: { "keywords/$seen": read ? true : null },
      },
    }, "ui-email-read-set"))
    if (keywordRecord(args.notUpdated)[messageId] !== undefined) throw new Error("Server rejected message read update.")
  }

  export async function setRemoteMessageMailboxIds(client: JmapClient, accountId: string, messageId: string, currentMailboxIds: readonly string[], destinationMailboxId: string): Promise<void> {
    const args = responseArgs(await client.call([CAP_MAIL], "Email/set", {
      accountId,
      update: {
        [messageId]: mailboxIdsPatch(accountId, currentMailboxIds, destinationMailboxId),
      },
    }, "ui-email-mailbox-set"))
    if (keywordRecord(args.notUpdated)[messageId] !== undefined) throw new Error("Server rejected message move.")
  }

  export async function loadInlineImageData(transport: FetchJmapTransport, accountId: string, image: InlineImagePart): Promise<InlineImageLoadResult> {
    try {
      const blob = await downloadInlineImageBlob(transport, accountId, image)
      return { cid: image.cid, dataUrl: await blobLikeToDataUrl(blob, image.type) }
    } catch (error) {
      return { cid: image.cid, name: image.name, error: connectivityErrorMessage(error) }
    }
  }

  export function inlineImageLoadErrorMessage(failures: readonly Extract<InlineImageLoadResult, { readonly error: string }>[]): string {
    const first = failures[0]
    const sampleNames = failures.slice(0, 2).map((failure) => failure.name).join(", ")
    const sample = sampleNames.length === 0 ? "" : ` (${sampleNames}${failures.length > 2 ? ", ..." : ""})`
    return `${failures.length} inline image${failures.length === 1 ? "" : "s"} could not be loaded${sample}${first === undefined ? "." : `: ${first.error}`}`
  }

  export function connectivityErrorMessage(error: unknown): string {
    if (error instanceof TypeError) return "Could not reach the server. If browser setup keeps failing, try the desktop app."
    return error instanceof Error ? error.message : "Connectivity check failed."
  }

  async function fetchSendIdentity(client: JmapClient, accountId: string, accountEmail: string): Promise<SendIdentity> {
    const args = responseArgs(await client.call([CAP_SUBMISSION], "Identity/get", {
      accountId,
      ids: null,
      properties: ["id", "name", "email"],
    }, "ui-compose-identity-get"))
    const identities = jsonObjectArray(args.list).flatMap(toSendIdentity)
    const preferredEmail = accountEmail.trim().toLowerCase()
    const identity = identities.find((item) => item.email.trim().toLowerCase() === preferredEmail) ?? identities[0]
    if (identity === undefined) throw new Error("Server did not advertise a send identity.")
    return identity
  }

  function toSendIdentity(input: JsonObject): SendIdentity[] {
    const id = stringValue(input.id)
    const email = stringValue(input.email)
    if (id === undefined || email === undefined) return []
    const name = stringValue(input.name)
    return [{ id, email, ...(name === undefined ? {} : { name }) }]
  }

  async function fetchServerMailboxes(client: JmapClient, accountId: string): Promise<JsonObject[]> {
    const args = responseArgs(await client.call([CAP_MAIL], "Mailbox/get", { accountId, ids: null, properties: ["id", "name", "role"] }, "ui-compose-mailbox-get"))
    return jsonObjectArray(args.list)
  }

  function mailboxServerIdByRole(mailboxes: readonly JsonObject[], role: string): string | undefined {
    const byRole = mailboxes.find((mailbox) => stringValue(mailbox.role) === role)
    if (byRole !== undefined) return stringValue(byRole.id)
    const byName = mailboxes.find((mailbox) => stringValue(mailbox.name)?.toLowerCase() === role)
    return byName === undefined ? undefined : stringValue(byName.id)
  }

  function composeEmailCreateObject(account: ConfiguredAccount, identity: SendIdentity, draft: ComposeDraft, draftsMailboxId: string, recipients: { readonly to: readonly JsonObject[]; readonly cc: readonly JsonObject[]; readonly bcc: readonly JsonObject[] }): JsonObject {
    return cleanUndefined({
      mailboxIds: { [draftsMailboxId]: true },
      keywords: { "$draft": true },
      from: [composeAddress(identity.name ?? account.displayName, identity.email)],
      to: [...recipients.to],
      cc: recipients.cc.length === 0 ? undefined : [...recipients.cc],
      bcc: recipients.bcc.length === 0 ? undefined : [...recipients.bcc],
      subject: draft.subject.trim(),
      textBody: [{ partId: "body", type: "text/plain", charset: "utf-8" }],
      bodyValues: { body: { value: draft.body } },
      ...composeThreadHeaders(draft),
    })
  }

  function composeThreadHeaders(draft: ComposeDraft): JsonObject {
    if ((draft.mode !== "reply" && draft.mode !== "reply-all") || draft.sourceMessageId === undefined) return {}
    return {
      inReplyTo: [draft.sourceMessageId],
      references: unique([...(draft.sourceReferences ?? []), draft.sourceMessageId]),
    }
  }

  function parseComposeAddressList(value: string, field: string): JsonObject[] {
    return value
      .split(/[\n;,]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => parseComposeAddress(part, field))
  }

  function parseComposeAddress(value: string, field: string): JsonObject {
    const angle = /^(.*?)<([^<>]+)>$/.exec(value)
    const email = (angle?.[2] ?? value).trim().replace(/^mailto:/i, "")
    const name = angle === null ? "" : unquoteDisplayName(angle[1] ?? "")
    if (!isLikelyEmail(email)) throw new Error(`${field} contains invalid email address: ${value}`)
    return composeAddress(name, email)
  }

  function composeAddress(name: string, email: string): JsonObject {
    return { name: name.trim(), email: email.trim() }
  }

  function unquoteDisplayName(value: string): string {
    const trimmed = value.trim()
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).trim()
    return trimmed
  }

  function throwIfSetCreateRejected(args: JsonObject, createId: string, fallback: string): void {
    const created = keywordRecord(args.created)
    const rejected = keywordRecord(args.notCreated)[createId]
    if (rejected !== undefined) throw new Error(jmapSetErrorMessage(rejected, fallback))
    if (created[createId] === undefined) throw new Error(fallback)
  }

  function jmapSetErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== "object" || error === null || Array.isArray(error)) return fallback
    const detail = error as Record<string, unknown>
    const type = typeof detail.type === "string" ? detail.type : undefined
    const description = typeof detail.description === "string" ? detail.description : undefined
    if (description !== undefined) return `${fallback} ${description}`
    if (type !== undefined) return `${fallback} ${type}`
    return fallback
  }

  async function fetchEmailMessages(client: JmapClient, account: ConfiguredAccount, mailAccountId: string, emailIds: readonly string[]): Promise<MailMessage[]> {
    const emailArgs = responseArgs(await client.call([CAP_MAIL], "Email/get", {
      accountId: mailAccountId,
      ids: [...emailIds],
      properties: [...EMAIL_METADATA_PROPERTIES],
      bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
    }, "ui-email-get"))
    return jsonObjectArray(emailArgs.list)
      .map((email) => toMailMessageMetadata(account, mailAccountId, email))
      .sort((left, right) => MailState.messageTime(right) - MailState.messageTime(left))
  }

  // Combines Email/query + Email/get via result references to avoid a second network round trip.
  async function queryAndFetchEmailMessages(client: JmapClient, account: ConfiguredAccount, accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean }, callIdPrefix: string): Promise<{ readonly messages: readonly MailMessage[]; readonly total?: number }> {
    const queryCallId = `${callIdPrefix}-query`
    const getCallId = `${callIdPrefix}-get`
    const response = await client.request({
      using: [CAP_MAIL],
      calls: [
        methodCall("Email/query", queryEmailArgs(accountId, options), queryCallId),
        methodCall("Email/get", withResultReference({
          accountId,
          properties: [...EMAIL_METADATA_PROPERTIES],
          bodyProperties: [...EMAIL_BODY_PART_PROPERTIES],
        }, "ids", resultReference(queryCallId, "Email/query", "/ids")), getCallId),
      ],
    })
    const query = responseArgsByCallId(response, queryCallId)
    const emailGet = responseArgsByCallId(response, getCallId)
    const total = numberValue(query.total)
    const messages = jsonObjectArray(emailGet.list)
      .map((email) => toMailMessageMetadata(account, accountId, email))
      .sort((left, right) => MailState.messageTime(right) - MailState.messageTime(left))
    return { messages, ...(total === undefined ? {} : { total }) }
  }

  async function queryEmail(client: JmapClient, accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean } = {}): Promise<EmailQueryResult> {
    const response = responseArgs(await client.call([CAP_MAIL], "Email/query", queryEmailArgs(accountId, options), `ui-email-query-${options.mailboxId ?? "all"}`))
    const total = numberValue(response.total)
    return {
      ids: stringArray(response.ids),
      ...(total === undefined ? {} : { total }),
    }
  }

  function queryEmailArgs(accountId: string, options: { readonly mailboxId?: string; readonly searchText?: string; readonly limit?: number; readonly calculateTotal?: boolean } = {}): JsonObject {
    return cleanUndefined({
      accountId,
      filter: emailQueryFilter(options),
      sort: [{ property: "receivedAt", isAscending: false }],
      position: 0,
      limit: options.limit ?? EMAIL_PAGE_SIZE,
      calculateTotal: options.calculateTotal,
    })
  }

  function emailQueryFilter(options: { readonly mailboxId?: string; readonly searchText?: string }): JsonObject | undefined {
    const conditions: JsonObject[] = []
    if (options.mailboxId !== undefined) conditions.push({ inMailbox: options.mailboxId })
    const searchText = options.searchText?.trim()
    if (searchText !== undefined && searchText.length > 0) conditions.push({ text: searchText })
    if (conditions.length === 0) return undefined
    if (conditions.length === 1) return conditions[0]
    return { operator: "AND", conditions }
  }

  function addJmapAccountRoot(target: JmapMailAccountTarget, mailboxes: readonly MailboxSummary[]): MailboxSummary[] {
    if (target.isPrimary || mailboxes.length === 0 || mailboxes.some((mailbox) => mailbox.parentId === undefined && mailbox.name === target.name)) return [...mailboxes]
    const rootId = jmapAccountRootMailboxId(target.id)
    const rootedMailboxes = mailboxes.map((mailbox) => mailbox.parentId === undefined ? { ...mailbox, parentId: rootId } : mailbox)
    const totalEmails = MailState.sumKnownMailboxCounts(rootedMailboxes.map((mailbox) => mailbox.totalEmails))
    return [{
      id: rootId,
      jmapAccountId: target.id,
      jmapAccountName: target.name,
      jmapAccountIsPersonal: target.isPersonal,
      jmapAccountIsReadOnly: target.isReadOnly,
      name: target.name,
      sortOrder: Number.MAX_SAFE_INTEGER - 1,
      ...(totalEmails === undefined ? {} : { totalEmails }),
      isSynthetic: true,
    }, ...rootedMailboxes]
  }

  function namespaceJmapMailboxId(jmapAccountId: string, mailboxId: string): string {
    return `${encodeURIComponent(jmapAccountId)}:${encodeURIComponent(mailboxId)}`
  }

  function jmapAccountRootMailboxId(jmapAccountId: string): string {
    return `jmap-account:${encodeURIComponent(jmapAccountId)}`
  }

  function toMailboxSummary(input: JsonObject, target: JmapMailAccountTarget): MailboxSummary[] {
    const id = stringValue(input.id)
    if (id === undefined) return []
    const role = stringValue(input.role)
    const parentId = stringValue(input.parentId)
    const sortOrder = numberValue(input.sortOrder)
    const totalEmails = numberValue(input.totalEmails)
    const unreadEmails = numberValue(input.unreadEmails)
    const isSubscribed = booleanValue(input.isSubscribed)
    const myRights = parseMailboxRights(input.myRights)
    return [{
      id: namespaceJmapMailboxId(target.id, id),
      serverId: id,
      jmapAccountId: target.id,
      jmapAccountName: target.name,
      jmapAccountIsPersonal: target.isPersonal,
      jmapAccountIsReadOnly: target.isReadOnly,
      name: stringValue(input.name) ?? id,
      ...(role === undefined ? {} : { role }),
      ...(parentId === undefined || parentId.length === 0 ? {} : { parentId: namespaceJmapMailboxId(target.id, parentId) }),
      ...(sortOrder === undefined ? {} : { sortOrder }),
      ...(totalEmails === undefined ? {} : { totalEmails }),
      ...(unreadEmails === undefined ? {} : { unreadEmails }),
      ...(isSubscribed === undefined ? {} : { isSubscribed }),
      ...(myRights === undefined ? {} : { myRights }),
    }]
  }

  function parseMailboxRights(value: unknown): MailboxRights | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const rights = value as Record<string, unknown>
    return cleanUndefined({
      mayReadItems: booleanValue(rights.mayReadItems),
      mayAddItems: booleanValue(rights.mayAddItems),
      mayRemoveItems: booleanValue(rights.mayRemoveItems),
      maySetSeen: booleanValue(rights.maySetSeen),
      maySetKeywords: booleanValue(rights.maySetKeywords),
      mayCreateChild: booleanValue(rights.mayCreateChild),
      mayRename: booleanValue(rights.mayRename),
      mayDelete: booleanValue(rights.mayDelete),
      maySubmit: booleanValue(rights.maySubmit),
      mayShare: booleanValue(rights.mayShare),
    }) as unknown as MailboxRights
  }

  function toMailMessageMetadata(account: ConfiguredAccount, jmapAccountId: string, email: JsonObject): MailMessage {
    const id = stringValue(email.id) ?? `${account.id}:unknown`
    const to = addressList(email.to)
    const cc = addressList(email.cc)
    const replyTo = addressList(email.replyTo)
    const attachments = emailAttachmentParts(email)
    const keywords = keywordRecord(email.keywords)
    return {
      id,
      key: `${account.id}:${encodeURIComponent(jmapAccountId)}:${id}`,
      accountId: account.id,
      accountName: account.email,
      jmapAccountId,
      mailboxIds: mailboxIdList(email.mailboxIds).map((mailboxId) => namespaceJmapMailboxId(jmapAccountId, mailboxId)),
      subject: stringValue(email.subject) ?? "",
      read: messageReadState(keywords),
      flagState: messageFlagState(keywords),
      from: addressList(email.from)[0] ?? "",
      to,
      cc,
      replyTo,
      messageId: stringArray(email.messageId),
      references: stringArray(email.references),
      ...(stringValue(email.receivedAt) === undefined ? {} : { receivedAt: stringValue(email.receivedAt) as string }),
      ...(stringValue(email.sentAt) === undefined ? {} : { sentAt: stringValue(email.sentAt) as string }),
      attachments,
      hasAttachment: email.hasAttachment === true || attachments.length > 0,
      hasSignatureAttachment: attachments.some(MailState.isSignatureAttachment),
      hasPublicKeyAttachment: attachments.some(MailState.isPublicKeyAttachment),
    }
  }

  function textBodyValue(email: JsonObject): string {
    const bodyValues = jsonRecord(email.bodyValues)
    const textValue = bodyValueForParts(bodyValues, email.textBody)
    if (textValue.length > 0) return textValue
    return EmailHtml.stripHtml(bodyValueForParts(bodyValues, email.htmlBody))
  }

  function htmlBodyValue(email: JsonObject): string {
    return bodyValueForParts(jsonRecord(email.bodyValues), email.htmlBody)
  }

  function bodyValueForParts(bodyValues: Record<string, JsonObject>, parts: unknown): string {
    const bodyParts = Array.isArray(parts) ? parts : []
    return bodyParts
      .map((part) => typeof part === "object" && part !== null && !Array.isArray(part) ? stringValue((part as JsonObject).partId) : undefined)
      .flatMap((partId) => {
        const bodyValue = partId === undefined ? undefined : bodyValues[partId]
        if (typeof bodyValue !== "object" || bodyValue === null || Array.isArray(bodyValue)) return []
        const value = stringValue((bodyValue as JsonObject).value)
        return value === undefined ? [] : [value]
      })
      .join("\n\n")
      .trim()
  }

  function emailAttachments(email: JsonObject): JsonObject[] {
    return jsonObjectArray(email.attachments)
  }

  function emailAttachmentParts(email: JsonObject): EmailAttachmentPart[] {
    return emailAttachments(email).map((part) => {
      const type = stringValue(part.type) ?? "application/octet-stream"
      const name = stringValue(part.name) ?? defaultAttachmentName(type)
      const partId = stringValue(part.partId)
      const blobId = stringValue(part.blobId)
      const size = numberValue(part.size)
      const disposition = stringValue(part.disposition)
      const cid = stringValue(part.cid)
      return {
        name,
        type,
        ...(partId === undefined ? {} : { partId }),
        ...(blobId === undefined ? {} : { blobId }),
        ...(size === undefined ? {} : { size }),
        ...(disposition === undefined ? {} : { disposition }),
        ...(cid === undefined ? {} : { cid: EmailHtml.normalizeCid(cid) }),
      }
    })
  }

  function inlineImageParts(attachments: readonly EmailAttachmentPart[]): InlineImagePart[] {
    return attachments.flatMap((part) => {
      const cid = part.cid
      const blobId = part.blobId
      const type = part.type
      if (cid === undefined || blobId === undefined || !type.toLowerCase().startsWith("image/")) return []
      return [{
        cid,
        blobId,
        name: part.name,
        type,
      }]
    })
  }

  function defaultAttachmentName(type: string): string {
    if (type.toLowerCase().startsWith("image/")) return "image"
    return "attachment"
  }

  function messageFlagState(keywords: Record<string, unknown>): MessageFlagState {
    if (keywords.done === true) return "done"
    if (keywords.$flagged === true) return "flagged"
    return "unflagged"
  }

  function messageReadState(keywords: Record<string, unknown>): boolean {
    return keywords.$seen === true
  }

  function mailboxIdsPatch(jmapAccountId: string, currentMailboxIds: readonly string[], destinationMailboxId: string): JsonObject {
    const patch: JsonObject = {}
    for (const mailboxId of currentMailboxIds) {
      const serverId = mailboxServerIdFromNamespaced(mailboxId, jmapAccountId)
      if (serverId !== undefined && serverId !== destinationMailboxId) patch[`mailboxIds/${jmapPatchPathSegment(serverId)}`] = null
    }
    patch[`mailboxIds/${jmapPatchPathSegment(destinationMailboxId)}`] = true
    return patch
  }

  function mailboxServerIdFromNamespaced(mailboxId: string, jmapAccountId: string): string | undefined {
    const prefix = `${encodeURIComponent(jmapAccountId)}:`
    if (!mailboxId.startsWith(prefix)) return undefined
    return decodeURIComponent(mailboxId.slice(prefix.length))
  }

  function jmapPatchPathSegment(value: string): string {
    return value.replace(/~/g, "~0").replace(/\//g, "~1")
  }

  function flagStatePatch(flagState: MessageFlagState): JsonObject {
    return {
      "keywords/$flagged": flagState === "flagged" ? true : null,
      "keywords/done": flagState === "done" ? true : null,
    }
  }

  async function downloadInlineImageBlob(transport: FetchJmapTransport, accountId: string, image: InlineImagePart): Promise<BlobLike> {
    try {
      return await transport.download(accountId, image.blobId, image.name, image.type)
    } catch (error) {
      if (!shouldRetryDownloadAsOctetStream(error, image.type)) throw error
      return transport.download(accountId, image.blobId, image.name, "application/octet-stream")
    }
  }

  function shouldRetryDownloadAsOctetStream(error: unknown, type: string): boolean {
    return type.toLowerCase() !== "application/octet-stream" && error instanceof JmapTransportError && error.status === 400
  }

  async function blobLikeToDataUrl(blob: BlobLike, type: string): Promise<string> {
    const bytes = await AttachmentBackend.blobLikeToBytes(blob)
    return `data:${type};base64,${AttachmentBackend.base64Bytes(bytes)}`
  }

  function accountSessionUrl(account: ConfiguredAccount): string | undefined {
    if (account.sessionUrl !== undefined) return account.sessionUrl
    if (isHttpsUrl(account.serverKey)) return account.serverKey
    const domain = domainFromEmailAddress(account.email)
    return domain === undefined ? undefined : wellKnownSessionUrl(domain)
  }

  function firstMailAccountId(session: JmapSession): string | undefined {
    return Object.entries(session.accounts).find(([, account]) => account.accountCapabilities[CAP_MAIL] !== undefined)?.[0]
  }

  function responseArgs(response: JmapResponse): JsonObject {
    const first = response.methodResponses[0]
    if (first === undefined) throw new Error("JMAP response missing method response.")
    if (first[0] === "error") throw new Error(`JMAP method failed: ${String(first[1].type ?? "unknown")}`)
    return first[1]
  }

  function responseArgsByCallId(response: JmapResponse, callId: string): JsonObject {
    const method = response.methodResponses.find(([, , id]) => id === callId)
    if (method === undefined) throw new Error(`JMAP response missing method response: ${callId}`)
    if (method[0] === "error") throw new Error(`JMAP method failed: ${String(method[1].type ?? "unknown")}`)
    return method[1]
  }

  function jsonObjectArray(value: unknown): JsonObject[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
  }

  function jsonRecord(value: unknown): Record<string, JsonObject> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1])))
  }

  function keywordRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  }

  function cleanUndefined(value: JsonObject): JsonObject {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
  }

  function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
  }

  function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
  }

  function mailboxIdList(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return []
    return Object.entries(value).flatMap(([id, enabled]) => enabled === true ? [id] : [])
  }

  function addressList(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return []
      const address = item as JsonObject
      const name = stringValue(address.name)
      const email = stringValue(address.email)
      if (name !== undefined && email !== undefined) return [`${name} <${email}>`]
      if (email !== undefined) return [email]
      return name === undefined ? [] : [name]
    })
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
  }

  function numberValue(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined
  }

  function booleanValue(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
  }

  function domainFromEmailAddress(email: string): string | undefined {
    if (!isLikelyEmail(email)) return undefined
    return email.trim().toLowerCase().split("@").at(1)
  }

  function wellKnownSessionUrl(domain: string): string {
    return `https://${domain}/.well-known/jmap`
  }

  async function resolveJmapSrvFresh(service: "_jmap._tcp", domain: string): Promise<SrvRecord[]> {
    return resolveJmapSrvOverHttps(service, domain, { bypassCache: true })
  }

  function isLikelyEmail(value: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
  }

  function isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === "https:"
    } catch {
      return false
    }
  }
}
