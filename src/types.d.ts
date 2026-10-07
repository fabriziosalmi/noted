export {};

import type { GitSyncState, GitConflictResolution } from './lib/gitSyncTypes';
import type { View } from '../shared/views/model';
import type { FieldValue } from '../shared/vault/fields';
import type { ImportSummary } from '../shared/import/report';
import type { JournalEntry } from '../shared/vault/journalTypes';
import type { PendingChange } from '../shared/vault/pending';
import type { McpPolicy } from '../shared/vault/mcpPolicy';
import type { NoteTask, TaskFilter } from '../shared/tasks/query';
import type { EmbeddingModelRef, EmbeddingStatus, RagChunk, IpcResult } from '../shared/search/embeddingTypes';
import type { LintReport } from '../shared/lint/vaultLint';
import type { VaultIndexSnapshot, VaultIndexDelta, VaultIndexNote } from './lib/vaultIndexTypes';

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
      wipeAllNotes: (syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      selectSyncFolder: () => Promise<{ success: boolean; data?: string }>;
      exportPdf: (htmlContent: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      printNote: (htmlContent: string, title?: string) => Promise<{ success: boolean; error?: string }>;
      renameNote: (oldName: string, newName: string, syncDir?: string, opts?: LinkUpdateOptions) => Promise<{ success: boolean; links?: LinkUpdateResult; error?: string }>;
      exportMarkdown: (content: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      storeApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      getApiKey: () => Promise<{ success: boolean; data?: string; error?: string }>;
      llmFetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>;
      /** Starts a streamed request; resolves once the provider has answered (ok), the text then arrives through onLlmStream. */
      llmStreamStart: (id: string, url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text?: string }>;
      llmStreamAbort: (id: string) => void;
      embeddingsStatus: (model: EmbeddingModelRef, syncDir?: string) => Promise<IpcResult<EmbeddingStatus>>;
      embeddingsPending: (model: EmbeddingModelRef, limit: number, syncDir?: string) => Promise<IpcResult<{ items: { hash: string; text: string }[]; remaining: number; status: EmbeddingStatus }>>;
      embeddingsPut: (model: EmbeddingModelRef, entries: { hash: string; vector: Float32Array }[], syncDir?: string) => Promise<IpcResult<number>>;
      embeddingsClear: (model: EmbeddingModelRef, syncDir?: string) => Promise<IpcResult<boolean>>;
      ragSearch: (query: string, vector: Float32Array | null, topK: number, model: EmbeddingModelRef, syncDir?: string, pool?: number) => Promise<IpcResult<{ chunks: RagChunk[]; mode: 'hybrid' | 'lexical' }>>;
      onLlmStream: (cb: (id: string, event: { text?: string; end?: boolean; error?: string }) => void) => () => void;
      getNoteHistory: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: { name: string; ts: string }[]; error?: string }>;
      readNoteSnapshot: (fileName: string, snapshotName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveCapture: (text: string, target?: string) => Promise<{ success: boolean; fileName?: string; error?: string }>;
      closeCapture: () => Promise<void>;
      onRefreshNotes: (cb: () => void) => () => void;
      getNativeTheme: () => Promise<{ isDark: boolean }>;
      onNativeThemeUpdated?: (cb: (theme: 'dark' | 'light') => void) => () => void;
      onMenuCommand?: (cb: (cmd: string) => void) => () => void;
      onFlushBeforeQuit?: (cb: () => void) => () => void;
      notifyFlushed?: () => void;
      setActiveVaultDir?: (dir: string | null) => void;
      setLlmHosts?: (hosts: string[]) => void;
      onNoteChangedExternally?: (cb: (fileName: string) => void) => () => void;
      exportHtml: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      exportDocx: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      importVault: (targetDir?: string) => Promise<{ success: boolean; data?: number; error?: string }>;
      getICloudPath: () => Promise<{ success: boolean; data?: string; error?: string }>;
      detectCloudProviders: () => Promise<{ success: boolean; data?: { id: string; name: string; basePath: string; notedPath: string; available: boolean }[]; error?: string }>;
      activateCloudProvider: (notedPath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      copyVaultToFolder: (args: { destDir?: string; syncDir?: string }) => Promise<{ success: boolean; canceled?: boolean; data?: { copied: number; destDir: string }; error?: string }>;
      shareNoteMacOS: (args: { content: string; title: string }) => Promise<{ success: boolean; fallback?: boolean; error?: string }>;
      getNotesTree: (syncDir?: string) => Promise<{ success: boolean; data?: NotesTree; error?: string }>;
      createFolder: (name: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      renameFolder: (oldName: string, newName: string, syncDir?: string, opts?: LinkUpdateOptions) => Promise<{ success: boolean; links?: LinkUpdateResult; error?: string }>;
      deleteFolder: (name: string, syncDir?: string, opts?: LinkUpdateOptions) => Promise<{ success: boolean; data?: { moved: number; renamed: string[] }; links?: LinkUpdateResult; error?: string }>;
      moveNote: (fileName: string, toFolder: string, syncDir?: string, opts?: LinkUpdateOptions) => Promise<{ success: boolean; data?: string; links?: LinkUpdateResult; error?: string }>;
      previewLinkRewrite: (renames: { from: string; to: string }[], syncDir?: string) => Promise<{ success: boolean; data?: { notes: number; links: number }; error?: string }>;
      setNoteProperty: (name: string, key: string, value: FieldValue | undefined, expect: { value: FieldValue | undefined } | undefined, syncDir?: string) => Promise<{ success: boolean; data?: { changed: boolean; fields: Record<string, FieldValue> }; error?: string; conflict?: boolean; fields?: Record<string, FieldValue> }>;
      getMcpPolicy: (syncDir?: string) => Promise<{ success: boolean; data?: { policy?: McpPolicy; present?: boolean; error?: string }; error?: string }>;
      setMcpPolicy: (policy: McpPolicy, syncDir?: string) => Promise<{ success: boolean; data?: { policy: McpPolicy }; error?: string }>;
      listPendingChanges: (syncDir?: string) => Promise<{ success: boolean; data?: PendingChange[]; error?: string }>;
      ingestFetch: (url: string) => Promise<{ success: boolean; data?: { url: string; title: string; text: string; truncated: boolean }; error?: string; code?: string }>;
      vaultLint: (opts: { staleDays?: number }, syncDir?: string) => Promise<{ success: boolean; data?: LintReport; error?: string }>;
      settlePendingChange: (id: string, approve: boolean, syncDir?: string, content?: string) => Promise<{ success: boolean; error?: string; conflict?: boolean }>;
      journalList: (syncDir?: string) => Promise<{ success: boolean; data?: { entries: JournalEntry[]; total: number; reverted: string[]; chain: { ok: true; entries: number } | { ok: false; at: number; reason: string } }; error?: string }>;
      journalDiff: (id: string, syncDir?: string) => Promise<{ success: boolean; data?: { before: string; after: string; kept: boolean }; error?: string }>;
      journalRevert: (ids: string[], syncDir?: string) => Promise<{ success: boolean; data?: { id: string; ok: boolean; conflict?: boolean; error?: string }[]; error?: string }>;
      listTasks: (filter: TaskFilter, syncDir?: string) => Promise<{ success: boolean; data?: { tasks: NoteTask[]; total: number; format: 'markdown' | 'html' }; error?: string }>;
      toggleTask: (name: string, line: number, text: string, done: boolean, syncDir?: string) => Promise<{ success: boolean; data?: { changed: boolean }; error?: string }>;
      loadViews: (syncDir?: string) => Promise<{ success: boolean; data?: View[]; error?: string }>;
      saveViews: (views: View[], syncDir?: string) => Promise<{ success: boolean; data?: View[]; error?: string }>;
      previewHeadingRewrite: (change: HeadingChange, syncDir?: string) => Promise<{ success: boolean; data?: { notes: number; links: number }; error?: string }>;
      rewriteHeadingLinks: (change: HeadingChange, syncDir?: string) => Promise<{ success: boolean; data?: LinkUpdateResult; error?: string }>;
      rewriteLinks: (renames: { from: string; to: string }[], syncDir?: string) => Promise<{ success: boolean; data?: LinkUpdateResult; error?: string }>;
      setNoteTitle: (noteName: string) => Promise<void>;
      safeStorageStatus: () => Promise<{ encrypted: boolean }>;
      getMcpServerPath: () => Promise<{ path: string; exists: boolean }>;
      getMcpSseToken: () => Promise<string>;
      revealInFinder: (fsPath: string) => Promise<{ success: boolean }>;
      gitStoreToken: (token: string) => Promise<{ success: boolean; error?: string }>;
      gitGetToken: () => Promise<{ success: boolean; data?: string; error?: string }>;
      // Git ops
      gitStatus: (syncDir?: string) => Promise<GitResult<GitStatusData>>;
      gitInit: (syncDir?: string) => Promise<GitResult>;
      gitCommitNote: (noteName: string, message?: string, syncDir?: string) => Promise<GitResult<{ hash: string }>>;
      gitCommitAll: (message: string, syncDir?: string) => Promise<GitResult<{ hash: string }>>;
      gitFileDiff: (noteName: string, syncDir?: string) => Promise<GitResult<GitFileDiff>>;
      gitStage: (files: string[], syncDir?: string) => Promise<GitResult>;
      gitUnstage: (files: string[], syncDir?: string) => Promise<GitResult>;
      gitCommitStaged: (message: string, syncDir?: string) => Promise<GitResult<{ hash: string }>>;
      gitPreparePrBranch: (noteName: string, commitMessage?: string, syncDir?: string) => Promise<GitResult<{ branch: string; hash: string }>>;
      gitPushBranch: (branch: string, remoteUrl: string, syncDir?: string) => Promise<GitResult>;
      gitLog: (noteName?: string, syncDir?: string) => Promise<GitResult<GitLogEntry[]>>;
      gitCreatePr: (params: { remoteUrl: string; token: string; branch: string; base: string; title: string; body: string }) => Promise<GitResult<PrData>>;
      migrationPlan: (direction: 'to-markdown' | 'to-html', syncDir?: string) => Promise<{ success: boolean; data?: MigrationReport; error?: string }>;
      migrationApply: (opts: { allowLossy?: boolean }, syncDir?: string) => Promise<MigrationOutcome>;
      migrationRevert: (syncDir?: string) => Promise<MigrationOutcome>;
      onMigrationProgress: (cb: (p: MigrationProgress) => void) => () => void;
      onVaultFormatChanged: (cb: () => void) => () => void;
      setLanguage: (language: string) => Promise<{ success: boolean }>;
      unlinkedMentions: (noteName: string, syncDir?: string) => Promise<{ success: boolean; data?: { items: UnlinkedMention[] }; error?: string }>;
      linkMention: (source: string, target: string, syncDir?: string) => Promise<{ success: boolean; data?: { remaining: number }; error?: string }>;
      getVaultFormat: (
        syncDir?: string,
      ) => Promise<{ success: boolean; data?: 'html' | 'markdown'; shared?: boolean; error?: string }>;
      setVaultConfig: (config: { trashRetentionDays?: number }, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      saveAttachment: (bytes: Uint8Array, folder?: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      scanEmbeddedImages: (syncDir?: string) => Promise<{ success: boolean; data?: EmbeddedImagesReport; error?: string }>;
      migrateEmbeddedImages: (folder?: string, syncDir?: string) => Promise<{ success: boolean; data?: EmbeddedImagesOutcome; error?: string }>;
      listOrphanAttachments: (noteName: string, folder?: string, syncDir?: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
      deleteAttachments: (rels: string[], folder?: string, syncDir?: string) => Promise<{ success: boolean; data?: { deleted: string[]; skipped: string[] }; error?: string }>;
      inlineVaultImages: (content: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      ragCandidates: (query: string, limit: number, syncDir?: string) => Promise<{ success: boolean; data?: { candidates: { name: string; title: string; text: string; score: number }[]; truncated: boolean; indexed: number }; error?: string }>;
      getVaultIndexSnapshot: (syncDir?: string) => Promise<VaultIndexSnapshot>;
      getVaultIndexNote: (name: string, syncDir?: string) => Promise<{ success: boolean; data?: VaultIndexNote; error?: string }>;
      onVaultIndexDelta: (cb: (delta: VaultIndexDelta) => void) => () => void;
      gitSyncNow: (syncDir?: string) => Promise<GitSyncState>;
      gitSyncState: (syncDir?: string) => Promise<GitSyncState>;
      gitSyncResolve: (resolutions: GitConflictResolution[], syncDir?: string) => Promise<GitResult<GitSyncState>>;
      onGitSyncState: (cb: (state: GitSyncState) => void) => () => void;
      gitSaveAsGist: (params: { fileName: string; content: string; isPublic: boolean; token: string }) => Promise<GitResult<string>>;
      searchNotesFulltext: (query: string, syncDir?: string) => Promise<{ success: boolean; data?: { relPath: string; title: string; snippet: string; score: number; terms: string[] }[]; truncated?: boolean; error?: string }>;
      setupClaudeMcp: () => Promise<{ success: boolean; error?: string }>;
      importEnex: (targetDir?: string, attachmentsFolder?: string) =>
        Promise<{ success: boolean; data?: number; summary?: ImportSummary; error?: string }>;
      importAppleNotes: (targetDir?: string) => Promise<{ success: boolean; data?: number; error?: string }>;
      updateMcpSseConfig: (config: { enabled: boolean; port: number; syncDir?: string; legacySse?: boolean }) => Promise<{ success: boolean; error?: string }>;
      getAppVersion: () => Promise<string>;
    };
  }
}

interface GitResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface GitStatusData {
  initialized: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  stagedFiles: string[];
  modifiedFiles: string[];
  files: GitFileChange[];
}

export interface GitFileChange {
  path: string;
  state: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
  unstaged: boolean;
}

/** A changed note's two versions as Markdown (empty text on the side that does not exist). */
export interface GitFileDiff {
  before: string;
  after: string;
  state: GitFileChange['state'];
  isNew: boolean;
  isDeleted: boolean;
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

interface PrData {
  url: string;
  number: number;
  title: string;
}

/** Ask the main process to also rewrite [[links]] that point at what is being renamed or moved. */
interface LinkUpdateOptions {
  updateLinks?: boolean;
}

/** Headings of a note that were renamed: where they were, and what they are now. */
export interface HeadingChange {
  note: string;
  oldHeadings: string[];
  renames: { index: number; to: string }[];
}

interface LinkUpdateResult {
  notes: number;
  links: number;
  failed: number;
}

/** The plan of a conversion between note formats (electron/migration.ts). */
export interface UnlinkedMention {
  name: string;
  count: number;
  snippet: { before: string; match: string; after: string };
}

export interface MigrationReport {
  direction: 'to-markdown' | 'to-html';
  total: number;
  convert: number;
  skip: number;
  verdicts: { exact: number; raw: number; formatting: number; lossy: number };
  failed: number;
  notes: { name: string; verdict?: 'exact' | 'raw' | 'formatting' | 'lossy'; findings: string[]; error?: string }[];
  truncated: boolean;
}

export interface MigrationProgress {
  phase: 'scan' | 'convert' | 'backup' | 'write' | 'finish';
  done: number;
  total: number;
  name?: string;
}

export type MigrationOutcome =
  | { ok: true; report: MigrationReport; backup: string; converted: number }
  | { ok: false; reason: string; report?: MigrationReport };

interface EmbeddedImagesReport {
  notes: { name: string; images: number; bytes: number }[];
  images: number;
  distinct: number;
  bytes: number;
}

interface EmbeddedImagesOutcome {
  notes: number;
  images: number;
  bytes: number;
  failed: { name: string; error: string }[];
}
