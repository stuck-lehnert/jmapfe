package com.jmapfe.contacts

import android.accounts.AbstractAccountAuthenticator
import android.accounts.Account
import android.accounts.AccountAuthenticatorResponse
import android.content.Context
import android.os.Bundle

class JmapAccountAuthenticator(context: Context) : AbstractAccountAuthenticator(context) {
  override fun editProperties(response: AccountAuthenticatorResponse?, accountType: String?): Bundle {
    return Bundle()
  }

  override fun addAccount(
    response: AccountAuthenticatorResponse?,
    accountType: String?,
    authTokenType: String?,
    requiredFeatures: Array<out String>?,
    options: Bundle?
  ): Bundle {
    return Bundle()
  }

  override fun confirmCredentials(
    response: AccountAuthenticatorResponse?,
    account: Account?,
    options: Bundle?
  ): Bundle {
    return Bundle().apply { putBoolean(KEY_BOOLEAN_RESULT, false) }
  }

  override fun getAuthToken(
    response: AccountAuthenticatorResponse?,
    account: Account?,
    authTokenType: String?,
    options: Bundle?
  ): Bundle {
    return Bundle()
  }

  override fun getAuthTokenLabel(authTokenType: String?): String = "JMAP"

  override fun updateCredentials(
    response: AccountAuthenticatorResponse?,
    account: Account?,
    authTokenType: String?,
    options: Bundle?
  ): Bundle {
    return Bundle()
  }

  override fun hasFeatures(
    response: AccountAuthenticatorResponse?,
    account: Account?,
    features: Array<out String>?
  ): Bundle {
    return Bundle().apply { putBoolean(KEY_BOOLEAN_RESULT, false) }
  }
}
