export {};

declare global {
  interface Window {
    electronAPI: {
      ping: () => Promise<string>;
      getNotesList: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
      readNote: (fileName: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveNote: (fileName: string, content: string) => Promise<{ success: boolean; error?: string }>;
      deleteNote: (fileName: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}