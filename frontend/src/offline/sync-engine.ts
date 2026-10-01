// Compatibility entrypoint for the old prototype. Keep one queue/identity/retry
// owner; the obsolete Dexie-style offlineDb no longer exists.
export { syncPendingActions } from './sync';
