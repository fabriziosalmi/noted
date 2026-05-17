export {};

interface NoteFileBase {
  name: string;
  path: string;
  stats: { mtimeMs: number; ctimeMs: number; size: number };
}

interface NotesTree {
  rootNotes: NoteFileBase[];
  folders: { name: string; notes: NoteFileBase[] }[];
}

declare global {
  interface Window {
    electronAPI: {
      getNotesList: (syncDir?: string) => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
      readNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveNote: (fileName: string, content: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      deleteNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      selectSyncFolder: () => Promise<{ success: boolean; data?: string }>;
      exportPdf: (htmlContent: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      renameNote: (oldName: string, newName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      exportMarkdown: (content: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      storeApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      getApiKey: () => Promise<{ success: boolean; data?: string; error?: string }>;
      llmFetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>;
      getNoteHistory: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: { name: string; ts: string }[]; error?: string }>;
      readNoteSnapshot: (fileName: string, snapshotName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveCapture: (text: string) => Promise<{ success: boolean; fileName?: string; error?: string }>;
      closeCapture: () => Promise<void>;
      onRefreshNotes: (cb: () => void) => void;
      getNativeTheme: () => Promise<{ isDark: boolean }>;
      onNativeThemeUpdated?: (cb: (theme: 'dark' | 'light') => void) => void;
      exportHtml: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      exportDocx: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      importVault: (targetDir?: string) => Promise<{ success: boolean; data?: number; error?: string }>;
      getICloudPath: () => Promise<{ success: boolean; data?: string; error?: string }>;
      getNotesTree: (syncDir?: string) => Promise<{ success: boolean; data?: NotesTree; error?: string }>;
      createFolder: (name: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      renameFolder: (oldName: string, newName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      deleteFolder: (name: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      moveNote: (fileName: string, toFolder: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      setNoteTitle: (noteName: string) => Promise<void>;
    };
  }
}