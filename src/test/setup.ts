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

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock electronAPI
window.electronAPI = {
  getNotesList: vi.fn().mockResolvedValue({ success: true, data: [] }),
  saveNote: vi.fn().mockResolvedValue({ success: true }),
  readNote: vi.fn().mockResolvedValue({ success: true, data: 'Test content' }),
  deleteNote: vi.fn().mockResolvedValue({ success: true }),
};