package com.jmapfe.contacts

import android.content.ContentProviderOperation
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.RawContacts

object JmapContactsContractMapper {
  const val ACCOUNT_TYPE = "com.yourapp.jmap"

  fun newRawContact(accountName: String, contactCardId: String): ContentProviderOperation {
    return ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)
      .withValue(RawContacts.ACCOUNT_NAME, accountName)
      .withValue(RawContacts.ACCOUNT_TYPE, ACCOUNT_TYPE)
      .withValue(RawContacts.SOURCE_ID, contactCardId)
      .withValue(RawContacts.SYNC1, contactCardId)
      .build()
  }

  fun emailData(rawContactBackReference: Int, email: String): ContentProviderOperation {
    return ContentProviderOperation.newInsert(android.provider.ContactsContract.Data.CONTENT_URI)
      .withValueBackReference(android.provider.ContactsContract.Data.RAW_CONTACT_ID, rawContactBackReference)
      .withValue(android.provider.ContactsContract.Data.MIMETYPE, Email.CONTENT_ITEM_TYPE)
      .withValue(Email.ADDRESS, email)
      .withValue(Email.TYPE, Email.TYPE_OTHER)
      .build()
  }
}
