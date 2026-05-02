import {
  CALENDAR_SPEC_VERSION,
  CAP_AVAILABILITY,
  CAP_CALENDARS,
  methodCall,
  type JsonObject,
  type MethodCall,
} from "@jmapfe/jmap-core"

export const CALENDAR_CAPABILITIES = [CAP_CALENDARS, CAP_AVAILABILITY] as const
export { CALENDAR_SPEC_VERSION }

export const CALENDAR_METHODS = [
  "Principal/getAvailability",
  "Principal/query",
  "ParticipantIdentity/get",
  "ParticipantIdentity/changes",
  "ParticipantIdentity/set",
  "Calendar/get",
  "Calendar/changes",
  "Calendar/set",
  "CalendarEvent/get",
  "CalendarEvent/changes",
  "CalendarEvent/set",
  "CalendarEvent/copy",
  "CalendarEvent/query",
  "CalendarEvent/queryChanges",
  "CalendarEvent/parse",
] as const

export type CalendarMethodName = (typeof CALENDAR_METHODS)[number]

export function calendarMethod<Name extends CalendarMethodName>(
  name: Name,
  args: object,
  callId?: string,
): MethodCall<Name> {
  return methodCall(name, args as JsonObject, callId)
}

export const Principal = {
  getAvailability: (args: object, callId?: string) => calendarMethod("Principal/getAvailability", args, callId),
  query: (args: object, callId?: string) => calendarMethod("Principal/query", args, callId),
}

export const ParticipantIdentity = {
  get: (args: object, callId?: string) => calendarMethod("ParticipantIdentity/get", args, callId),
  changes: (args: object, callId?: string) => calendarMethod("ParticipantIdentity/changes", args, callId),
  set: (args: object, callId?: string) => calendarMethod("ParticipantIdentity/set", args, callId),
}

export const Calendar = {
  get: (args: object, callId?: string) => calendarMethod("Calendar/get", args, callId),
  changes: (args: object, callId?: string) => calendarMethod("Calendar/changes", args, callId),
  set: (args: object, callId?: string) => calendarMethod("Calendar/set", args, callId),
}

export const CalendarEvent = {
  get: (args: object, callId?: string) => calendarMethod("CalendarEvent/get", args, callId),
  changes: (args: object, callId?: string) => calendarMethod("CalendarEvent/changes", args, callId),
  set: (args: object, callId?: string) => calendarMethod("CalendarEvent/set", args, callId),
  copy: (args: object, callId?: string) => calendarMethod("CalendarEvent/copy", args, callId),
  query: (args: object, callId?: string) => calendarMethod("CalendarEvent/query", args, callId),
  queryChanges: (args: object, callId?: string) => calendarMethod("CalendarEvent/queryChanges", args, callId),
  parse: (args: object, callId?: string) => calendarMethod("CalendarEvent/parse", args, callId),
}

export interface RecurrenceWindow {
  readonly startsAfter: string
  readonly endsBefore: string
}

export interface CalendarEventInstance {
  readonly eventId: string
  readonly recurrenceId?: string
  readonly startUtc: string
  readonly endUtc: string
  readonly timezone: string
}
