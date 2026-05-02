package com.jmapfe.contacts

import android.app.Service
import android.content.Intent
import android.os.IBinder

class JmapContactSyncService : Service() {
  private lateinit var syncAdapter: JmapContactSyncAdapter

  override fun onCreate() {
    syncAdapter = JmapContactSyncAdapter(this, true)
  }

  override fun onBind(intent: Intent?): IBinder = syncAdapter.syncAdapterBinder
}
