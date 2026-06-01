/**
 * Offline queue using IndexedDB for persistent storage of pending changes.
 * Syncs with server when connection is restored.
 */

export class OfflineQueue {
  constructor(dbName = 'nd-dashboard', version = 1) {
    this.dbName = dbName
    this.version = version
    this.db = null
    this.syncCallbacks = []
    this.isSyncing = false
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('pending_changes')) {
          const store = db.createObjectStore('pending_changes', { keyPath: 'id' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('status', 'status', { unique: false })
        }
      }
    })
  }

  /**
   * Add a pending change to the queue
   */
  async add(change) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readwrite')
      const store = tx.objectStore('pending_changes')
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      const entry = {
        id,
        ...change,
        status: 'pending',
        addedAt: Date.now(),
      }

      const req = store.add(entry)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(entry)
    })
  }

  /**
   * Get all pending changes
   */
  async getPending() {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readonly')
      const store = tx.objectStore('pending_changes')
      const index = store.index('status')
      const req = index.getAll('pending')

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result)
    })
  }

  /**
   * Mark a change as synced
   */
  async markSynced(id) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readwrite')
      const store = tx.objectStore('pending_changes')
      const req = store.get(id)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const entry = req.result
        if (entry) {
          entry.status = 'synced'
          entry.syncedAt = Date.now()
          const updateReq = store.put(entry)
          updateReq.onerror = () => reject(updateReq.error)
          updateReq.onsuccess = () => resolve(entry)
        } else {
          resolve(null)
        }
      }
    })
  }

  /**
   * Mark a change as failed
   */
  async markFailed(id, error) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readwrite')
      const store = tx.objectStore('pending_changes')
      const req = store.get(id)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const entry = req.result
        if (entry) {
          entry.status = 'failed'
          entry.error = String(error)
          entry.failedAt = Date.now()
          const updateReq = store.put(entry)
          updateReq.onerror = () => reject(updateReq.error)
          updateReq.onsuccess = () => resolve(entry)
        } else {
          resolve(null)
        }
      }
    })
  }

  /**
   * Delete a change from the queue
   */
  async delete(id) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readwrite')
      const store = tx.objectStore('pending_changes')
      const req = store.delete(id)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  }

  /**
   * Clear all pending changes
   */
  async clear() {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readwrite')
      const store = tx.objectStore('pending_changes')
      const req = store.clear()

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  }

  /**
   * Register a callback to be called when sync is needed
   */
  onSync(callback) {
    this.syncCallbacks.push(callback)
  }

  /**
   * Sync pending changes with server
   */
  async sync(apiClient) {
    if (this.isSyncing) return
    this.isSyncing = true

    try {
      const pending = await this.getPending()
      if (pending.length === 0) return

      console.log(`[offline-queue] syncing ${pending.length} changes`)

      for (const entry of pending) {
        try {
          // Call registered callback (e.g., apiClient.putConfig)
          for (const callback of this.syncCallbacks) {
            const result = await callback(entry)
            if (result && result.ok) {
              await this.markSynced(entry.id)
            } else {
              await this.markFailed(entry.id, result?.error || 'sync failed')
            }
          }
        } catch (err) {
          await this.markFailed(entry.id, err)
        }
      }

      console.log('[offline-queue] sync complete')
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending_changes'], 'readonly')
      const store = tx.objectStore('pending_changes')

      const pending = store.index('status').count('pending')
      const synced = store.index('status').count('synced')
      const failed = store.index('status').count('failed')

      let pendingCount = 0
      let syncedCount = 0
      let failedCount = 0

      pending.onsuccess = () => {
        pendingCount = pending.result
      }

      synced.onsuccess = () => {
        syncedCount = synced.result
      }

      failed.onsuccess = () => {
        failedCount = failed.result
      }

      failed.oncomplete = () => {
        resolve({
          pending: pendingCount,
          synced: syncedCount,
          failed: failedCount,
          total: pendingCount + syncedCount + failedCount,
        })
      }

      failed.onerror = () => reject(failed.error)
    })
  }
}

// Export singleton
export const offlineQueue = new OfflineQueue()
