package com.jmapfe.contacts

class JmapContactsSyncWorker {
  fun shouldTouch(accountType: String): Boolean = accountType == JmapContactsContractMapper.ACCOUNT_TYPE
}
