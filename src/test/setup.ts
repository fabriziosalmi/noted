import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock localStorage for Zustand persist middleware
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem: function (key: string) {
      return store[key] || null;
    },
    setItem: function (key: string, value: string) {
      store[key] = value.toString();
    },
    removeItem: function (key: string) {
      delete store[key];
    },
    clear: function () {
      store = {};
    }
  };
})();

// These globals only exist in jsdom; skip when running in node environment (e.g. ipc-utils tests)
if (typeof window !== 'undefined') {
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock electronAPI
window.electronAPI = {
  getNotesList: vi.fn().mockResolvedValue({ success: true, data: [] }),
  saveNote: vi.fn().mockResolvedValue({ success: true }),
  readNote: vi.fn().mockResolvedValue({ success: true, data: 'Test content' }),
  deleteNote: vi.fn().mockResolvedValue({ success: true }),
  selectSyncFolder: vi.fn().mockResolvedValue({ success: true, data: '/mock/path' }),
  exportPdf: vi.fn().mockResolvedValue({ success: true, data: '/mock/path/Nota.pdf' }),
  renameNote: vi.fn().mockResolvedValue({ success: true }),
  exportMarkdown: vi.fn().mockResolvedValue({ success: true, data: '/mock/path/Nota.md' }),
  storeApiKey: vi.fn().mockResolvedValue({ success: true }),
  getApiKey: vi.fn().mockResolvedValue({ success: true, data: '' }),
  llmFetch: vi.fn().mockImplementation(async (url: string, options: { method: string; headers: Record<string, string>; body: string }) => { const res = await globalThis.fetch(url, options); const text = await res.text(); return { ok: res.ok, status: res.status, text }; }),
  getNoteHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
  readNoteSnapshot: vi.fn().mockResolvedValue({ success: true, data: '' }),
  saveCapture: vi.fn().mockResolvedValue({ success: true }),
  closeCapture: vi.fn().mockResolvedValue(undefined),
  onRefreshNotes: vi.fn(),
  getNativeTheme: vi.fn().mockResolvedValue({ isDark: false }),
  onNativeThemeUpdated: vi.fn(),
  exportHtml: vi.fn().mockResolvedValue({ success: true }),
  exportDocx: vi.fn().mockResolvedValue({ success: true }),
  importVault: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getICloudPath: vi.fn().mockResolvedValue({ success: true, data: '/mock/icloud' }),
  getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }),
  createFolder: vi.fn().mockResolvedValue({ success: true }),
  renameFolder: vi.fn().mockResolvedValue({ success: true }),
  deleteFolder: vi.fn().mockResolvedValue({ success: true }),
  moveNote: vi.fn().mockResolvedValue({ success: true, data: 'moved.md' }),
};
} // end if (typeof window !== 'undefined')