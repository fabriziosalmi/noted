import path from 'node:path';
import { FullTextSearchReadModel } from '../fulltext-index';
import { VaultIndex } from '../vault-index';
import { validateFileName } from '../ipc-utils';
import { getActiveVaultDir, getTargetDir } from './paths';
import { getMainWindow } from './windows';

export const fullTextSearchIndex = new FullTextSearchReadModel();

// Links, tags, headings and frontmatter keys for the whole vault, kept current
// incrementally. The renderer gets a snapshot (vault-index-snapshot) and then
// deltas for the vault it has open.
export const vaultIndex = new VaultIndex({
  validateFileName: (name) => validateFileName(name),
  onDelta: (dir, delta) => {
    if (dir !== path.resolve(getTargetDir(getActiveVaultDir() || undefined))) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('vault-index-delta', delta);
  },
});
