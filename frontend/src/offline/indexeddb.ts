const DB_NAME = 'mes-db';

export async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('pending', { keyPath: 'id' });
      db.createObjectStore('cache', { keyPath: 'key' });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store: string, value: any) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
}

export async function getAll(store: string): Promise<any[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll();

  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
  });
}

export async function remove(store: string, id: string) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
}
