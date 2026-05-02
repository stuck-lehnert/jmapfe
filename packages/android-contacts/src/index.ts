export const ANDROID_JMAP_ACCOUNT_TYPE = "com.yourapp.jmap" as const
export const ANDROID_CONTACTS_AUTHORITY = "com.android.contacts" as const

export const ANDROID_SYNC_COLUMNS = {
  SYNC1: "JMAP ContactCard id",
  SYNC2: "remote hash / version",
  SYNC3: "addressBookIds hash",
  SYNC4: "last sync marker",
} as const

export const JSCONTACT_ANDROID_FIELD_MAP = {
  name: "StructuredName",
  nicknames: "Nickname",
  emails: "Email",
  phones: "Phone",
  addresses: "StructuredPostal",
  organizations: "Organization",
  anniversaries: "Event",
  notes: "Note",
  links: "Website",
  photos: "Photo",
  relations: "Relation",
} as const

export interface AndroidContactSyncSettings {
  readonly accountName: string
  readonly enabled: boolean
  readonly periodic: boolean
}
