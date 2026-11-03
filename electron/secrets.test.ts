// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The secrets handlers keep the API key and the GitHub token encrypted in memory with
// Electron's safeStorage. Electron 45 deprecates the synchronous safeStorage methods and
// Electron 46 removes them: these tests run against a safeStorage whose synchronous
// methods throw, the way they will once removed, and whose async methods read the bytes
// the synchronous encryptString wrote (Electron documents that guarantee).

type Handler = (...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const logEvent = vi.fn();

const PREFIX = Buffer.from('v10');
const KEY = 0x5a;
const seal = (s: string) => Buffer.concat([PREFIX, Buffer.from(Buffer.from(s, 'utf-8').map((b) => b ^ KEY))]);
const open = (buf: Buffer) => {
  if (!buf.subarray(0, 3).equals(PREFIX)) throw new Error('not encrypted by safeStorage');
  return Buffer.from(buf.subarray(3).map((b) => b ^ KEY)).toString('utf-8');
};

const fake = {
  available: true,
  syncRemoved: true,
  rotateOnNextDecrypt: false,
  decrypted: [] as Buffer[],
  isEncryptionAvailable() { if (fake.syncRemoved) throw new Error('isEncryptionAvailable removed'); return fake.available; },
  encryptString(s: string) { if (fake.syncRemoved) throw new Error('encryptString removed'); return seal(s); },
  decryptString(b: Buffer) { if (fake.syncRemoved) throw new Error('decryptString removed'); return open(b); },
  isAsyncEncryptionAvailable: vi.fn(async () => fake.available),
  encryptStringAsync: vi.fn(async (s: string) => seal(s)),
  decryptStringAsync: vi.fn(async (b: Buffer) => {
    fake.decrypted.push(Buffer.from(b));
    const shouldReEncrypt = fake.rotateOnNextDecrypt;
    fake.rotateOnNextDecrypt = false;
    return { result: open(b), shouldReEncrypt };
  }),
};

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  safeStorage: fake,
}));
vi.mock('./structured-log', () => ({ logEvent }));

async function load() {
  vi.resetModules();
  handlers.clear();
  const mod = await import('./ipc/secrets');
  mod.registerSecretsHandlers();
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { mod, call };
}

beforeEach(() => {
  fake.available = true;
  fake.syncRemoved = true;
  fake.rotateOnNextDecrypt = false;
  fake.decrypted = [];
  logEvent.mockClear();
  fake.encryptStringAsync.mockClear();
  fake.decryptStringAsync.mockClear();
});

describe('secrets IPC on the asynchronous safeStorage API', () => {
  it('stores and returns the API key without calling a synchronous safeStorage method', async () => {
    const { call } = await load();
    expect(await call('store-api-key', 'sk-test-123')).toEqual({ success: true });
    expect(await call('get-api-key')).toEqual({ success: true, data: 'sk-test-123' });
    expect(fake.encryptStringAsync).toHaveBeenCalledWith('sk-test-123');
    expect(open(fake.decrypted[0])).toBe('sk-test-123');
  });

  it('stores and returns the GitHub token the same way', async () => {
    const { call } = await load();
    expect(await call('git-store-token', 'ghp_example')).toEqual({ success: true });
    expect(await call('git-get-token')).toEqual({ success: true, data: 'ghp_example' });
  });

  it('keeps the IPC answers: empty before a store, an error for a non-string key, the status flag', async () => {
    const { call } = await load();
    expect(await call('get-api-key')).toEqual({ success: true, data: '' });
    expect(await call('git-get-token')).toEqual({ success: true, data: '' });
    expect(await call('store-api-key', 42)).toEqual({ success: false, error: 'API key must be a string' });
    expect(await call('safe-storage-status')).toEqual({ encrypted: true });
  });

  it('decrypts a value that the old synchronous encryptString produced', async () => {
    const { mod } = await load();
    fake.syncRemoved = false;
    const legacy = fake.encryptString('sk-encrypted-by-old-code');
    fake.syncRemoved = true;
    expect(await mod.decryptSecret(legacy)).toEqual({ plaintext: 'sk-encrypted-by-old-code' });
    expect(fake.decrypted[0].equals(legacy)).toBe(true);
  });

  it('writes the same bytes the old synchronous encryptString wrote', async () => {
    const { mod } = await load();
    const fresh = await mod.encryptSecret('same-format');
    fake.syncRemoved = false;
    expect(fresh.equals(fake.encryptString('same-format'))).toBe(true);
    expect(fake.decryptString(fresh)).toBe('same-format');
  });

  it('replaces the stored value when Electron asks for re-encryption', async () => {
    const { call } = await load();
    await call('store-api-key', 'rotate-me');
    fake.rotateOnNextDecrypt = true;
    expect(await call('get-api-key')).toEqual({ success: true, data: 'rotate-me' });
    expect(fake.encryptStringAsync).toHaveBeenCalledTimes(2);
    expect(await call('get-api-key')).toEqual({ success: true, data: 'rotate-me' });
    // The second read decrypts the re-encrypted bytes, not the ones stored first.
    const reEncrypted = await fake.encryptStringAsync.mock.results[1].value;
    expect(fake.decryptStringAsync.mock.calls[1][0]).toBe(reEncrypted);
    expect(fake.decryptStringAsync.mock.calls[1][0]).not.toBe(await fake.encryptStringAsync.mock.results[0].value);
  });

  it('keeps UTF-8 bytes in memory and warns once when no OS key store is available', async () => {
    fake.available = false;
    const { mod, call } = await load();
    expect(await call('store-api-key', 'plain-key')).toEqual({ success: true });
    expect(await call('git-store-token', 'plain-token')).toEqual({ success: true });
    expect(await call('get-api-key')).toEqual({ success: true, data: 'plain-key' });
    expect(await call('git-get-token')).toEqual({ success: true, data: 'plain-token' });
    expect(await call('safe-storage-status')).toEqual({ encrypted: false });
    expect((await mod.encryptSecret('x')).equals(Buffer.from('x', 'utf-8'))).toBe(true);
    expect(fake.encryptStringAsync).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][1]).toBe('safe_storage_encryption_unavailable');
  });

  it('returns the error when decryption fails', async () => {
    const { call } = await load();
    await call('store-api-key', 'k');
    fake.decryptStringAsync.mockRejectedValueOnce(new Error('keychain locked'));
    expect(await call('get-api-key')).toEqual({ success: false, error: 'keychain locked' });
  });
});
