export {};

declare global {
  interface Window {
    electronAPI: {
      getNotesList: (syncDir?: string) => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
      readNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveNote: (fileName: string, content: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      deleteNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      selectSyncFolder: () => Promise<{ success: boolean; data?: string }>;
      exportPdf: (htmlContent: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    };
  }
}