package com.jmapfe.contacts

import android.accounts.Account
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.ContentResolver
import android.content.Context
import android.content.SyncResult
import android.os.Bundle
import android.provider.ContactsContract

class JmapContactSyncAdapter(context: Context, autoInitialize: Boolean) :
  AbstractThreadedSyncAdapter(context, autoInitialize) {
  override fun onPerformSync(
    account: Account,
    extras: Bundle,
    authority: String,
    provider: ContentProviderClient,
    syncResult: SyncResult
  ) {
    if (authority != ContactsContract.AUTHORITY) return
    ContentResolver.setIsSyncable(account, ContactsContract.AUTHORITY, 1)
    // JS bridge fills pull/push algorithm. This native adapter owns Contacts Provider writes only.
  }
}
