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
      renameNote: (oldName: string, newName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      exportMarkdown: (content: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      storeApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      getApiKey: () => Promise<{ success: boolean; data?: string; error?: string }>;
      llmFetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>;
    };
  }
}