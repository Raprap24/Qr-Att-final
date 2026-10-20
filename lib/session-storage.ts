import { Platform } from 'react-native';

export type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const PROBE_KEY = '__qr_att_storage_probe__';
const CHUNK_SIZE = 1800;
const CHUNKS_SUFFIX = '.chunks';
const CHUNK_SUFFIX = '.chunk.';

let backendPromise: Promise<SessionStorage> | null = null;

export const sessionStorage: SessionStorage = {
  getItem: async (key) => (await getBackend()).getItem(key),
  setItem: async (key, value) => (await getBackend()).setItem(key, value),
  removeItem: async (key) => (await getBackend()).removeItem(key),
};

function getBackend(): Promise<SessionStorage> {
  if (!backendPromise) {
    backendPromise = createBackend();
  }
  return backendPromise;
}

async function createBackend(): Promise<SessionStorage> {
  if (Platform.OS === 'web') {
    return createWebStorage();
  }

  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.getItemAsync(PROBE_KEY);
    return createSecureStoreStorage(SecureStore);
  } catch {
    // SecureStore is not linked into this build; keep the app usable
    // with an in-memory session until the dev client is rebuilt.
  }

  return createMemoryStorage();
}

function createWebStorage(): SessionStorage {
  try {
    const web = (globalThis as any).localStorage;
    if (web) {
      return {
        getItem: async (key) => web.getItem(key),
        setItem: async (key, value) => {
          web.setItem(key, value);
        },
        removeItem: async (key) => {
          web.removeItem(key);
        },
      };
    }
  } catch {
    // fall through to memory storage
  }

  return createMemoryStorage();
}

function createSecureStoreStorage(
  SecureStore: typeof import('expo-secure-store')
): SessionStorage {
  const indexKey = (key: string) => `${key}${CHUNKS_SUFFIX}`;
  const chunkKey = (key: string, index: number) => `${key}${CHUNK_SUFFIX}${index}`;

  const clear = async (key: string) => {
    const rawCount = await SecureStore.getItemAsync(indexKey(key));
    await SecureStore.deleteItemAsync(key);

    const count = rawCount ? Number(rawCount) : 0;
    if (Number.isInteger(count) && count > 0) {
      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          SecureStore.deleteItemAsync(chunkKey(key, index))
        )
      );
    }

    await SecureStore.deleteItemAsync(indexKey(key));
  };

  return {
    async getItem(key) {
      const rawCount = await SecureStore.getItemAsync(indexKey(key));
      if (!rawCount) {
        return SecureStore.getItemAsync(key);
      }

      const count = Number(rawCount);
      if (!Number.isInteger(count) || count <= 0) {
        return null;
      }

      const chunks = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          SecureStore.getItemAsync(chunkKey(key, index))
        )
      );

      if (chunks.some((chunk) => chunk === null)) {
        return null;
      }

      return chunks.join('');
    },

    async setItem(key, value) {
      await clear(key);

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      const count = Math.ceil(value.length / CHUNK_SIZE);
      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          SecureStore.setItemAsync(
            chunkKey(key, index),
            value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
          )
        )
      );
      await SecureStore.setItemAsync(indexKey(key), String(count));
    },

    removeItem: clear,
  };
}

function createMemoryStorage(): SessionStorage {
  const values = new Map<string, string>();

  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}
