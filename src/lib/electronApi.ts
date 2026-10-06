import { diskToWire, snapshotToWire, vaultFormatOf, wireToDisk } from './noteIo';

export type RendererElectronApi = Window['electronAPI'];

interface Reply { success: boolean; data?: unknown; error?: string }

const wrapped = new WeakMap<object, RendererElectronApi>();

/**
 * The API the preload exposes, with the three calls that carry a note's text (read a note, read a history
 * snapshot, save a note) converting between the app's HTML and the vault's on-disk format. For an HTML vault
 * (every vault until it is migrated) they are the preload's own functions, called with the same arguments.
 */
function withNoteFormat(api: RendererElectronApi): RendererElectronApi {
  const cached = wrapped.get(api);
  if (cached) return cached;

  // Looked up on `api` at call time, not copied: the preload object (and the mocks that stand in for it
  // in tests) may have members replaced after this wrapper was made.
  const readConverted = (name: 'readNote' | 'readNoteSnapshot', syncDirIndex: number, toWire: typeof diskToWire) =>
    async (...args: unknown[]): Promise<Reply> => {
      const res = await (api[name] as unknown as (...a: unknown[]) => Promise<Reply>)(...args);
      if (!res.success || typeof res.data !== 'string') return res;
      const format = await vaultFormatOf(api, args[syncDirIndex] as string | undefined);
      return format === 'markdown' ? { ...res, data: toWire(res.data, format) } : res;
    };

  const overrides: Record<string, unknown> = {
    readNote: readConverted('readNote', 1, diskToWire),
    readNoteSnapshot: readConverted('readNoteSnapshot', 2, snapshotToWire),
    saveNote: async (fileName: string, content: string, syncDir?: string) => {
      const format = await vaultFormatOf(api, syncDir);
      return api.saveNote(fileName, format === 'markdown' ? wireToDisk(content, format) : content, syncDir);
    },
  };
  // The target is an empty object, not `api`: the preload's object is frozen by contextBridge, and a Proxy
  // may not report a different value for a frozen property of its target.
  const wrapper = new Proxy({} as RendererElectronApi, {
    get: (_target, prop) => (typeof prop === 'string' && prop in overrides ? overrides[prop] : Reflect.get(api, prop)),
    has: (_target, prop) => prop in api || (typeof prop === 'string' && prop in overrides),
  });
  wrapped.set(api, wrapper);
  return wrapper;
}

export function getElectronApi(): RendererElectronApi | null {
  if (typeof window === 'undefined') return null;
  const api = window.electronAPI ?? null;
  return api ? withNoteFormat(api) : null;
}
