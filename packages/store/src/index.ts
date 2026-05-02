export interface SqlDatabase {
  execute(sql: string, params?: readonly unknown[]): Promise<void>
  query?<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>
  transaction<T>(fn: () => Promise<T> | T): Promise<T>
}

export interface Migration {
  readonly version: number
  readonly name: string
  readonly statements: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_jmap_cache",
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        session_url TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        state TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_states (
        account_id TEXT NOT NULL,
        datatype TEXT NOT NULL,
        state TEXT NOT NULL,
        last_full_sync_at TEXT,
        last_ok_at TEXT,
        PRIMARY KEY (account_id, datatype)
      )`,
      `CREATE TABLE IF NOT EXISTS mailboxes (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        role TEXT,
        sort_order INTEGER,
        total_emails INTEGER,
        unread_emails INTEGER,
        total_threads INTEGER,
        unread_threads INTEGER,
        rights_json TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS threads (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        email_ids_json TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS emails (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        thread_id TEXT,
        mailbox_ids_json TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        size INTEGER,
        received_at TEXT,
        sent_at TEXT,
        subject TEXT,
        preview TEXT,
        from_json TEXT,
        to_json TEXT,
        cc_json TEXT,
        bcc_json TEXT,
        reply_to_json TEXT,
        message_id_json TEXT,
        in_reply_to_json TEXT,
        references_json TEXT,
        has_attachment INTEGER NOT NULL DEFAULT 0,
        body_blob_ref TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS email_bodies (
        account_id TEXT NOT NULL,
        email_id TEXT NOT NULL,
        body_values_json TEXT,
        text_body TEXT,
        html_body TEXT,
        sanitized_html TEXT,
        structure_json TEXT,
        pgp_state_json TEXT,
        PRIMARY KEY (account_id, email_id)
      )`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(
        email_id UNINDEXED,
        subject,
        from_text,
        to_text,
        body_text
      )`,
      `CREATE TABLE IF NOT EXISTS blobs (
        account_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        type TEXT,
        name TEXT,
        size INTEGER,
        sha256 TEXT,
        local_path TEXT,
        encrypted INTEGER NOT NULL DEFAULT 0,
        last_access_at TEXT,
        PRIMARY KEY (account_id, blob_id)
      )`,
      `CREATE TABLE IF NOT EXISTS identities (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS submissions (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        email_id TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS vacation_responses (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS address_books (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS contact_cards (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        address_book_ids_json TEXT NOT NULL,
        display_name TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS contact_fts USING fts5(
        contact_card_id UNINDEXED,
        display_name,
        email_text,
        phone_text,
        org_text
      )`,
      `CREATE TABLE IF NOT EXISTS calendars (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT,
        color TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS calendar_events (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        calendar_ids_json TEXT NOT NULL,
        start_utc TEXT,
        end_utc TEXT,
        timezone TEXT,
        recurrence_json TEXT,
        participants_json TEXT,
        alerts_json TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS calendar_event_instances (
        account_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        recurrence_id TEXT NOT NULL DEFAULT '',
        start_utc TEXT NOT NULL,
        end_utc TEXT NOT NULL,
        timezone TEXT NOT NULL,
        PRIMARY KEY (account_id, event_id, recurrence_id)
      )`,
      `CREATE TABLE IF NOT EXISTS participant_identities (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS calendar_notifications (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        event_id TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS pgp_keys (
        fingerprint TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        armored_public TEXT NOT NULL,
        user_ids_json TEXT NOT NULL,
        created_at TEXT,
        expires_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0,
        algorithm TEXT,
        raw_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS pgp_identities (
        email TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        PRIMARY KEY (email, fingerprint)
      )`,
      `CREATE TABLE IF NOT EXISTS pgp_trust (
        email TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        trust_level TEXT NOT NULL,
        source TEXT NOT NULL,
        verified_at TEXT,
        PRIMARY KEY (email, fingerprint)
      )`,
      `CREATE TABLE IF NOT EXISTS pgp_private_key_refs (
        fingerprint TEXT PRIMARY KEY,
        encrypted_private_blob_id TEXT,
        vault_ref TEXT,
        has_passphrase INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS local_mutations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        datatype TEXT NOT NULL,
        op TEXT NOT NULL,
        object_id TEXT,
        patch_json TEXT,
        create_id TEXT,
        if_in_state TEXT,
        status TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS android_contact_links (
        account_id TEXT NOT NULL,
        contact_card_id TEXT NOT NULL,
        raw_contact_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        last_hash TEXT NOT NULL,
        PRIMARY KEY (account_id, contact_card_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_emails_account_received ON emails(account_id, received_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_calendar_instances_window ON calendar_event_instances(account_id, start_utc, end_utc)`,
      `CREATE INDEX IF NOT EXISTS idx_mutations_account_status ON local_mutations(account_id, status, created_at)`,
    ],
  },
]

export async function applyMigrations(db: SqlDatabase, migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
  await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)")
  for (const migration of migrations) {
    await db.transaction(async () => {
      for (const statement of migration.statements) await db.execute(statement)
      await db.execute("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (?, ?)", [
        migration.version,
        migration.name,
      ])
    })
  }
}

export interface LocalMutation {
  readonly id: string
  readonly accountId: string
  readonly datatype: string
  readonly op: string
  readonly objectId?: string
  readonly patchJson?: string
  readonly createId?: string
  readonly ifInState?: string
  readonly status: "pending" | "running" | "failed" | "done" | "conflict"
  readonly retries: number
  readonly lastError?: string
  readonly createdAt: string
}

export interface AccountRecord {
  readonly id: string
  readonly serverId: string
  readonly username: string
  readonly displayName?: string
  readonly sessionUrl: string
  readonly capabilitiesJson: string
  readonly state: string
}

export interface SyncStateRecord {
  readonly accountId: string
  readonly datatype: string
  readonly state: string
  readonly lastFullSyncAt?: string
  readonly lastOkAt?: string
}

export interface AccountRepository {
  get(id: string): Promise<AccountRecord | undefined>
  upsert(account: AccountRecord): Promise<void>
  remove(id: string): Promise<void>
}

export interface SyncStateRepository {
  get(accountId: string, datatype: string): Promise<SyncStateRecord | undefined>
  set(input: SyncStateRecord): Promise<void>
}

export interface LocalMutationRepository {
  enqueue(mutation: LocalMutation): Promise<void>
  nextPending(accountId: string): Promise<LocalMutation | undefined>
  markRunning(id: string): Promise<void>
  markDone(id: string): Promise<void>
  markFailed(id: string, reason: string): Promise<void>
  markConflict(id: string, reason: string): Promise<void>
}

export interface MailRepository {
  upsertMailboxes(accountId: string, mailboxes: readonly unknown[]): Promise<void>
  upsertIdentities(accountId: string, identities: readonly unknown[]): Promise<void>
  upsertEmails(accountId: string, emails: readonly unknown[]): Promise<void>
  upsertThreads(accountId: string, threads: readonly unknown[]): Promise<void>
}

export interface StoreRepositories {
  readonly accounts: AccountRepository
  readonly syncStates: SyncStateRepository
  readonly localMutations: LocalMutationRepository
  readonly mail: MailRepository
}

export function createSqlStoreRepositories(db: SqlDatabase): StoreRepositories {
  return {
    accounts: createAccountRepository(db),
    syncStates: createSyncStateRepository(db),
    localMutations: createLocalMutationRepository(db),
    mail: createMailRepository(db),
  }
}

function createAccountRepository(db: SqlDatabase): AccountRepository {
  return {
    async get(id) {
      const rows = await requireQuery<Record<string, unknown>>(db)(
        "SELECT id, server_id, username, display_name, session_url, capabilities_json, state FROM accounts WHERE id = ?",
        [id],
      )
      const row = rows[0]
      if (row === undefined) return undefined
      return cleanUndefined({
        id: stringValue(row.id),
        serverId: stringValue(row.server_id),
        username: stringValue(row.username),
        displayName: optionalString(row.display_name),
        sessionUrl: stringValue(row.session_url),
        capabilitiesJson: stringValue(row.capabilities_json),
        state: stringValue(row.state),
      }) as AccountRecord
    },
    async upsert(account) {
      await db.execute(
        `INSERT INTO accounts(id, server_id, username, display_name, session_url, capabilities_json, state)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           server_id = excluded.server_id,
           username = excluded.username,
           display_name = excluded.display_name,
           session_url = excluded.session_url,
           capabilities_json = excluded.capabilities_json,
           state = excluded.state`,
        [account.id, account.serverId, account.username, account.displayName ?? null, account.sessionUrl, account.capabilitiesJson, account.state],
      )
    },
    async remove(id) {
      await db.execute("DELETE FROM accounts WHERE id = ?", [id])
    },
  }
}

function createSyncStateRepository(db: SqlDatabase): SyncStateRepository {
  return {
    async get(accountId, datatype) {
      const rows = await requireQuery<Record<string, unknown>>(db)(
        "SELECT account_id, datatype, state, last_full_sync_at, last_ok_at FROM sync_states WHERE account_id = ? AND datatype = ?",
        [accountId, datatype],
      )
      const row = rows[0]
      if (row === undefined) return undefined
      return cleanUndefined({
        accountId: stringValue(row.account_id),
        datatype: stringValue(row.datatype),
        state: stringValue(row.state),
        lastFullSyncAt: optionalString(row.last_full_sync_at),
        lastOkAt: optionalString(row.last_ok_at),
      }) as SyncStateRecord
    },
    async set(input) {
      await db.execute(
        `INSERT INTO sync_states(account_id, datatype, state, last_full_sync_at, last_ok_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, datatype) DO UPDATE SET
           state = excluded.state,
           last_full_sync_at = excluded.last_full_sync_at,
           last_ok_at = excluded.last_ok_at`,
        [input.accountId, input.datatype, input.state, input.lastFullSyncAt ?? null, input.lastOkAt ?? null],
      )
    },
  }
}

function createLocalMutationRepository(db: SqlDatabase): LocalMutationRepository {
  return {
    async enqueue(mutation) {
      await db.execute(
        `INSERT INTO local_mutations(
          id, account_id, datatype, op, object_id, patch_json, create_id, if_in_state, status, retries, last_error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mutation.id,
          mutation.accountId,
          mutation.datatype,
          mutation.op,
          mutation.objectId ?? null,
          mutation.patchJson ?? null,
          mutation.createId ?? null,
          mutation.ifInState ?? null,
          mutation.status,
          mutation.retries,
          mutation.lastError ?? null,
          mutation.createdAt,
        ],
      )
    },
    async nextPending(accountId) {
      const rows = await requireQuery<Record<string, unknown>>(db)(
        `SELECT id, account_id, datatype, op, object_id, patch_json, create_id, if_in_state, status, retries, last_error, created_at
         FROM local_mutations WHERE account_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1`,
        [accountId],
      )
      const row = rows[0]
      return row === undefined ? undefined : rowToMutation(row)
    },
    async markRunning(id) {
      await db.execute("UPDATE local_mutations SET status = 'running' WHERE id = ?", [id])
    },
    async markDone(id) {
      await db.execute("UPDATE local_mutations SET status = 'done', last_error = NULL WHERE id = ?", [id])
    },
    async markFailed(id, reason) {
      await db.execute("UPDATE local_mutations SET status = 'failed', retries = retries + 1, last_error = ? WHERE id = ?", [reason, id])
    },
    async markConflict(id, reason) {
      await db.execute("UPDATE local_mutations SET status = 'conflict', last_error = ? WHERE id = ?", [reason, id])
    },
  }
}

function createMailRepository(db: SqlDatabase): MailRepository {
  return {
    async upsertMailboxes(accountId, mailboxes) {
      for (const mailbox of mailboxes) {
        const object = jsonObject(mailbox)
        const id = optionalString(object.id)
        if (id === undefined) continue
        await db.execute(
          `INSERT INTO mailboxes(
            account_id, id, name, parent_id, role, sort_order, total_emails, unread_emails,
            total_threads, unread_threads, rights_json, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
            name = excluded.name,
            parent_id = excluded.parent_id,
            role = excluded.role,
            sort_order = excluded.sort_order,
            total_emails = excluded.total_emails,
            unread_emails = excluded.unread_emails,
            total_threads = excluded.total_threads,
            unread_threads = excluded.unread_threads,
            rights_json = excluded.rights_json,
            raw_json = excluded.raw_json`,
          [
            accountId,
            id,
            optionalString(object.name) ?? "",
            optionalString(object.parentId) ?? null,
            optionalString(object.role) ?? null,
            optionalNumber(object.sortOrder) ?? null,
            optionalNumber(object.totalEmails) ?? null,
            optionalNumber(object.unreadEmails) ?? null,
            optionalNumber(object.totalThreads) ?? null,
            optionalNumber(object.unreadThreads) ?? null,
            jsonString(object.rights ?? null),
            jsonString(object),
          ],
        )
      }
    },
    async upsertIdentities(accountId, identities) {
      for (const identity of identities) {
        const object = jsonObject(identity)
        const id = optionalString(object.id)
        if (id === undefined) continue
        await db.execute(
          `INSERT INTO identities(account_id, id, raw_json) VALUES (?, ?, ?)
           ON CONFLICT(account_id, id) DO UPDATE SET raw_json = excluded.raw_json`,
          [accountId, id, jsonString(object)],
        )
      }
    },
    async upsertEmails(accountId, emails) {
      for (const email of emails) {
        const object = jsonObject(email)
        const id = optionalString(object.id)
        if (id === undefined) continue
        await db.execute(
          `INSERT INTO emails(
            account_id, id, thread_id, mailbox_ids_json, keywords_json, size, received_at, sent_at,
            subject, preview, from_json, to_json, cc_json, bcc_json, reply_to_json,
            message_id_json, in_reply_to_json, references_json, has_attachment, body_blob_ref, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
            thread_id = excluded.thread_id,
            mailbox_ids_json = excluded.mailbox_ids_json,
            keywords_json = excluded.keywords_json,
            size = excluded.size,
            received_at = excluded.received_at,
            sent_at = excluded.sent_at,
            subject = excluded.subject,
            preview = excluded.preview,
            from_json = excluded.from_json,
            to_json = excluded.to_json,
            cc_json = excluded.cc_json,
            bcc_json = excluded.bcc_json,
            reply_to_json = excluded.reply_to_json,
            message_id_json = excluded.message_id_json,
            in_reply_to_json = excluded.in_reply_to_json,
            references_json = excluded.references_json,
            has_attachment = excluded.has_attachment,
            body_blob_ref = excluded.body_blob_ref,
            raw_json = excluded.raw_json`,
          [
            accountId,
            id,
            optionalString(object.threadId) ?? null,
            jsonString(object.mailboxIds ?? {}),
            jsonString(object.keywords ?? {}),
            optionalNumber(object.size) ?? null,
            optionalString(object.receivedAt) ?? null,
            optionalString(object.sentAt) ?? null,
            optionalString(object.subject) ?? null,
            optionalString(object.preview) ?? null,
            jsonOrNull(object.from),
            jsonOrNull(object.to),
            jsonOrNull(object.cc),
            jsonOrNull(object.bcc),
            jsonOrNull(object.replyTo),
            jsonOrNull(object.messageId),
            jsonOrNull(object.inReplyTo),
            jsonOrNull(object.references),
            object.hasAttachment === true ? 1 : 0,
            optionalString(object.bodyBlobRef) ?? null,
            jsonString(object),
          ],
        )
      }
    },
    async upsertThreads(accountId, threads) {
      for (const thread of threads) {
        const object = jsonObject(thread)
        const id = optionalString(object.id)
        if (id === undefined) continue
        await db.execute(
          `INSERT INTO threads(account_id, id, email_ids_json, raw_json) VALUES (?, ?, ?, ?)
           ON CONFLICT(account_id, id) DO UPDATE SET
             email_ids_json = excluded.email_ids_json,
             raw_json = excluded.raw_json`,
          [accountId, id, jsonString(object.emailIds ?? []), jsonString(object)],
        )
      }
    },
  }
}

export interface BlobCachePolicy {
  readonly maxBytes: number
  readonly encrypt: boolean
  readonly evictBy: "lru"
}

function requireQuery<T>(db: SqlDatabase): (sql: string, params?: readonly unknown[]) => Promise<readonly T[]> {
  if (db.query === undefined) throw new Error("SQL database query method required")
  return db.query.bind(db) as (sql: string, params?: readonly unknown[]) => Promise<readonly T[]>
}

function rowToMutation(row: Record<string, unknown>): LocalMutation {
  return cleanUndefined({
    id: stringValue(row.id),
    accountId: stringValue(row.account_id),
    datatype: stringValue(row.datatype),
    op: stringValue(row.op),
    objectId: optionalString(row.object_id),
    patchJson: optionalString(row.patch_json),
    createId: optionalString(row.create_id),
    ifInState: optionalString(row.if_in_state),
    status: mutationStatus(row.status),
    retries: optionalNumber(row.retries) ?? 0,
    lastError: optionalString(row.last_error),
    createdAt: stringValue(row.created_at),
  }) as LocalMutation
}

function mutationStatus(value: unknown): LocalMutation["status"] {
  if (value === "pending" || value === "running" || value === "failed" || value === "done" || value === "conflict") return value
  throw new Error(`Invalid local mutation status: ${String(value)}`)
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string database value")
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function jsonString(value: unknown): string {
  return JSON.stringify(value)
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : jsonString(value)
}

function cleanUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
