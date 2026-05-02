import { CAP_CONTACTS, methodCall, type JsonObject, type MethodCall } from "@jmapfe/jmap-core"

export const CONTACTS_CAPABILITIES = [CAP_CONTACTS] as const

export const CONTACTS_METHODS = [
  "AddressBook/get",
  "AddressBook/changes",
  "AddressBook/set",
  "ContactCard/get",
  "ContactCard/changes",
  "ContactCard/query",
  "ContactCard/queryChanges",
  "ContactCard/set",
  "ContactCard/copy",
] as const

export type ContactsMethodName = (typeof CONTACTS_METHODS)[number]

export interface ContactCardPatch {
  readonly [property: string]: unknown
}

export interface ContactCardSetArgs {
  readonly accountId: string
  readonly ifInState?: string
  readonly create?: Record<string, unknown>
  readonly update?: Record<string, ContactCardPatch>
  readonly destroy?: readonly string[]
}

export function contactsMethod<Name extends ContactsMethodName>(
  name: Name,
  args: object,
  callId?: string,
): MethodCall<Name> {
  return methodCall(name, args as JsonObject, callId)
}

export const AddressBook = {
  get: (args: object, callId?: string) => contactsMethod("AddressBook/get", args, callId),
  changes: (args: object, callId?: string) => contactsMethod("AddressBook/changes", args, callId),
  set: (args: object, callId?: string) => contactsMethod("AddressBook/set", args, callId),
}

export const ContactCard = {
  get: (args: object, callId?: string) => contactsMethod("ContactCard/get", args, callId),
  changes: (args: object, callId?: string) => contactsMethod("ContactCard/changes", args, callId),
  query: (args: object, callId?: string) => contactsMethod("ContactCard/query", args, callId),
  queryChanges: (args: object, callId?: string) => contactsMethod("ContactCard/queryChanges", args, callId),
  set: (args: ContactCardSetArgs, callId?: string) => contactsMethod("ContactCard/set", args, callId),
  copy: (args: object, callId?: string) => contactsMethod("ContactCard/copy", args, callId),
}

export interface JSContactCard {
  readonly uid?: string
  readonly name?: unknown
  readonly emails?: Record<string, unknown>
  readonly phones?: Record<string, unknown>
  readonly addresses?: Record<string, unknown>
  readonly photos?: Record<string, unknown>
  readonly [extension: string]: unknown
}
