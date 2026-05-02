package com.jmapfe.contacts

import android.app.Service
import android.content.Intent
import android.os.IBinder

class JmapAccountAuthenticatorService : Service() {
  private lateinit var authenticator: JmapAccountAuthenticator

  override fun onCreate() {
    authenticator = JmapAccountAuthenticator(this)
  }

  override fun onBind(intent: Intent?): IBinder? = authenticator.iBinder
}
