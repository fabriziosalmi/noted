import { ipcMain, safeStorage } from 'electron';
import { logEvent } from '../structured-log';

// Only the asynchronous safeStorage API is used here. Electron 45 deprecates
// isEncryptionAvailable/encryptString/decryptString and Electron 46 removes them.
// decryptStringAsync accepts the bytes encryptString produced, so a value
// encrypted by the synchronous API still decrypts.

let encryptedApiKey: Buffer | null = null;
let encryptedGhToken: Buffer | null = null;

// Cache the warning state so we print it exactly once per process — on Linux
// without a secret service (libsecret), Electron's safeStorage silently falls
// back to in-memory plaintext. The renderer can query `safe-storage-status`
// to surface this in the UI.
let safeStorageWarned = false;
async function checkSafeStorageOnce(): Promise<void> {
  if (safeStorageWarned) return;
  safeStorageWarned = true;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    logEvent('warn', 'safe_storage_encryption_unavailable', {
      platform: process.platform,
      message:
        'OS encryption unavailable; tokens remain in-memory only. On Linux install libsecret/gnome-keyring.',
    });
  }
}

/** Encrypts with the OS key store, or keeps UTF-8 bytes when no key store is available. */
export async function encryptSecret(plaintext: string): Promise<Buffer> {
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    return safeStorage.encryptStringAsync(plaintext);
  }
  return Buffer.from(plaintext, 'utf-8');
}

/**
 * Reverses encryptSecret (and the bytes the old synchronous encryptString produced).
 * `reEncrypted` is set when Electron reports that the key rotated, so the caller can
 * replace what it holds.
 */
export async function decryptSecret(stored: Buffer): Promise<{ plaintext: string; reEncrypted?: Buffer }> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    return { plaintext: stored.toString('utf-8') };
  }
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(stored);
  if (!shouldReEncrypt) return { plaintext: result };
  return { plaintext: result, reEncrypted: await safeStorage.encryptStringAsync(result) };
}

export function registerSecretsHandlers(): void {
  ipcMain.handle('store-api-key', async (_, plaintext: string) => {
    try {
      if (typeof plaintext !== 'string') throw new Error('API key must be a string');
      await checkSafeStorageOnce();
      encryptedApiKey = await encryptSecret(plaintext);
      return { success: true };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-api-key', async () => {
    try {
      if (!encryptedApiKey) return { success: true, data: '' };
      const { plaintext, reEncrypted } = await decryptSecret(encryptedApiKey);
      if (reEncrypted) encryptedApiKey = reEncrypted;
      return { success: true, data: plaintext };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('safe-storage-status', async () => {
    return { encrypted: await safeStorage.isAsyncEncryptionAvailable() };
  });

  ipcMain.handle('git-store-token', async (_, plaintext: string) => {
    try {
      await checkSafeStorageOnce();
      encryptedGhToken = await encryptSecret(plaintext);
      return { success: true };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('git-get-token', async () => {
    try {
      if (!encryptedGhToken) return { success: true, data: '' };
      const { plaintext, reEncrypted } = await decryptSecret(encryptedGhToken);
      if (reEncrypted) encryptedGhToken = reEncrypted;
      return { success: true, data: plaintext };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });
}
