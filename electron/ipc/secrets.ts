import { ipcMain, safeStorage } from 'electron';
import { logEvent } from '../structured-log';

let encryptedApiKey: Buffer | null = null;
let encryptedGhToken: Buffer | null = null;

// Cache the warning state so we print it exactly once per process — on Linux
// without a secret service (libsecret), Electron's safeStorage silently falls
// back to in-memory plaintext. The renderer can query `safe-storage-status`
// to surface this in the UI.
let safeStorageWarned = false;
function checkSafeStorageOnce() {
  if (safeStorageWarned) return;
  safeStorageWarned = true;
  if (!safeStorage.isEncryptionAvailable()) {
    logEvent('warn', 'safe_storage_encryption_unavailable', {
      platform: process.platform,
      message:
        'OS encryption unavailable; tokens remain in-memory only. On Linux install libsecret/gnome-keyring.',
    });
  }
}

export function registerSecretsHandlers(): void {
  ipcMain.handle('store-api-key', (_, plaintext: string) => {
    try {
      if (typeof plaintext !== 'string') throw new Error('API key must be a string');
      checkSafeStorageOnce();
      if (safeStorage.isEncryptionAvailable()) {
        encryptedApiKey = safeStorage.encryptString(plaintext);
      } else {
        encryptedApiKey = Buffer.from(plaintext, 'utf-8');
      }
      return { success: true };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-api-key', () => {
    try {
      if (!encryptedApiKey) return { success: true, data: '' };
      const plaintext = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(encryptedApiKey)
        : encryptedApiKey.toString('utf-8');
      return { success: true, data: plaintext };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('safe-storage-status', () => {
    return { encrypted: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle('git-store-token', (_, plaintext: string) => {
    try {
      checkSafeStorageOnce();
      if (safeStorage.isEncryptionAvailable()) {
        encryptedGhToken = safeStorage.encryptString(plaintext);
      } else {
        encryptedGhToken = Buffer.from(plaintext, 'utf-8');
      }
      return { success: true };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('git-get-token', () => {
    try {
      if (!encryptedGhToken) return { success: true, data: '' };
      const plaintext = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(encryptedGhToken)
        : encryptedGhToken.toString('utf-8');
      return { success: true, data: plaintext };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });
}
