const DB_NAME = "notable-meta";
const DB_VERSION = 2;
const KV_STORE = "kv";
const CONTENT_STORE = "content";

export interface MetaMutation<T> {
  vault: unknown;
  queue: unknown[];
  contentPuts?: Array<{ key: string; content: string }>;
  contentDeletes?: string[];
  result: T;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        db.createObjectStore(CONTENT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  const db = await openVaultDB();
  try {
    return await requestValue<T | undefined>(
      db.transaction(KV_STORE).objectStore(KV_STORE).get(key),
    );
  } finally {
    db.close();
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  const db = await openVaultDB();
  try {
    const transaction = db.transaction(KV_STORE, "readwrite");
    transaction.objectStore(KV_STORE).put(value, key);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getStagedContent(key: string): Promise<string | undefined> {
  const db = await openVaultDB();
  try {
    return await requestValue<string | undefined>(
      db.transaction(CONTENT_STORE).objectStore(CONTENT_STORE).get(key),
    );
  } finally {
    db.close();
  }
}

export async function putStagedContent(
  key: string,
  content: string,
): Promise<void> {
  const db = await openVaultDB();
  try {
    const transaction = db.transaction(CONTENT_STORE, "readwrite");
    transaction.objectStore(CONTENT_STORE).put(content, key);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteStagedContent(key: string): Promise<void> {
  const db = await openVaultDB();
  try {
    const transaction = db.transaction(CONTENT_STORE, "readwrite");
    transaction.objectStore(CONTENT_STORE).delete(key);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function mutateMeta<T>(
  mutate: (vault: unknown, queue: unknown[]) => MetaMutation<T>,
): Promise<T> {
  const db = await openVaultDB();
  try {
    const transaction = db.transaction(
      [KV_STORE, CONTENT_STORE],
      "readwrite",
    );
    const kv = transaction.objectStore(KV_STORE);
    const content = transaction.objectStore(CONTENT_STORE);
    const vaultRequest = kv.get("vault");
    const queueRequest = kv.get("queue");

    const result = await new Promise<T>((resolve, reject) => {
      let vaultReady = false;
      let queueReady = false;

      const commit = () => {
        if (!vaultReady || !queueReady) return;
        try {
          const change = mutate(
            vaultRequest.result,
            (queueRequest.result as unknown[] | undefined) ?? [],
          );
          kv.put(change.vault, "vault");
          kv.put(change.queue, "queue");
          for (const item of change.contentPuts ?? []) {
            content.put(item.content, item.key);
          }
          for (const key of change.contentDeletes ?? []) {
            content.delete(key);
          }
          resolve(change.result);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };

      vaultRequest.onsuccess = () => {
        vaultReady = true;
        commit();
      };
      queueRequest.onsuccess = () => {
        queueReady = true;
        commit();
      };
      vaultRequest.onerror = queueRequest.onerror = () => {
        reject(vaultRequest.error ?? queueRequest.error);
      };
    });

    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}
