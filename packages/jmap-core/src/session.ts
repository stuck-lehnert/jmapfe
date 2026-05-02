import type { JmapAccount, JmapSession, JsonObject } from "./types.ts"

export function parseJmapSession(input: unknown): JmapSession {
  const value = object(input, "session")
  const session: JmapSession = {
    capabilities: recordOfObjects(value.capabilities, "capabilities"),
    accounts: parseAccounts(value.accounts),
    primaryAccounts: parsePrimaryAccounts(value.primaryAccounts),
    username: string(value.username, "username"),
    apiUrl: string(value.apiUrl, "apiUrl"),
    downloadUrl: string(value.downloadUrl, "downloadUrl"),
    uploadUrl: string(value.uploadUrl, "uploadUrl"),
    state: string(value.state, "state"),
  }

  if (value.eventSourceUrl !== undefined) {
    return { ...session, eventSourceUrl: string(value.eventSourceUrl, "eventSourceUrl") }
  }

  return session
}

export function parseJmapResponse(input: unknown) {
  const value = object(input, "response")
  const methodResponsesValue = value.methodResponses
  if (!Array.isArray(methodResponsesValue)) throw new Error("JMAP response methodResponses must be array")

  return {
    methodResponses: methodResponsesValue.map(parseMethodResponse),
    sessionState: string(value.sessionState, "sessionState"),
    ...(value.createdIds === undefined ? {} : { createdIds: recordOfStrings(value.createdIds, "createdIds") }),
  }
}

function parseMethodResponse(input: unknown) {
  if (!Array.isArray(input) || input.length !== 3) throw new Error("JMAP method response must be tuple")
  const [name, args, callId] = input
  return [string(name, "methodResponse.name"), object(args, "methodResponse.args"), string(callId, "methodResponse.callId")] as const
}

function parseAccounts(input: unknown): Record<string, JmapAccount> {
  const raw = object(input, "accounts")
  return Object.fromEntries(
    Object.entries(raw).map(([id, accountValue]) => {
      const account = object(accountValue, `accounts.${id}`)
      return [
        id,
        {
          name: string(account.name, `accounts.${id}.name`),
          isPersonal: boolean(account.isPersonal, `accounts.${id}.isPersonal`),
          isReadOnly: boolean(account.isReadOnly, `accounts.${id}.isReadOnly`),
          accountCapabilities: recordOfObjects(account.accountCapabilities, `accounts.${id}.accountCapabilities`),
        },
      ]
    }),
  )
}

function parsePrimaryAccounts(input: unknown): Record<string, string | null> {
  const raw = object(input, "primaryAccounts")
  return Object.fromEntries(
    Object.entries(raw).map(([capability, accountId]) => {
      if (accountId !== null && typeof accountId !== "string") {
        throw new Error(`primaryAccounts.${capability} must be string or null`)
      }
      return [capability, accountId]
    }),
  )
}

function recordOfObjects(input: unknown, label: string): Record<string, JsonObject> {
  const raw = object(input, label)
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, object(value, `${label}.${key}`)]))
}

function recordOfStrings(input: unknown, label: string): Record<string, string> {
  const raw = object(input, label)
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, string(value, `${label}.${key}`)]),
  )
}

function object(input: unknown, label: string): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`${label} must be object`)
  return input as JsonObject
}

function string(input: unknown, label: string): string {
  if (typeof input !== "string") throw new Error(`${label} must be string`)
  return input
}

function boolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") throw new Error(`${label} must be boolean`)
  return input
}
