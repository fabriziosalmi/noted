import { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { ACCESS_LEVELS, DEFAULT_POLICY, normalizePolicyPath, type Access, type McpPolicy } from '../../shared/vault/mcpPolicy';

const LABEL: Record<Access, TranslationKey> = { hidden: 'mcpAccessHidden', 'read-only': 'mcpAccessReadOnly', staged: 'mcpAccessStaged', 'read-write': 'mcpAccessReadWrite' };
const control = 'px-2 py-1 text-xs border border-gray-300/40 dark:border-gray-600/40 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';

/**
 * What assistants connected through MCP may reach: an access for the vault as a whole and one per folder (the most specific
 * wins). It edits `.noted/mcp-policy.yaml`, the file the MCP server enforces on every request, so a change applies at once.
 */
export function AgentAccessSettings() {
  const { t } = useI18n();
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const folders = useStore(s => s.noteFolders);
  const [policy, setPolicy] = useState<McpPolicy>(DEFAULT_POLICY);
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [access, setAccess] = useState<Access>('hidden');

  useEffect(() => {
    let current = true;
    void getElectronApi()?.getMcpPolicy?.(syncDir).then(res => {
      if (!current || !res.success || !res.data) return;
      if (res.data.error) setProblem(res.data.error);
      else { setProblem(null); setPolicy(res.data.policy ?? DEFAULT_POLICY); }
    }).catch(() => undefined);
    return () => { current = false; };
  }, [syncDir]);

  const save = useCallback(async (next: McpPolicy) => {
    setFailed(null);
    const res = await getElectronApi()?.setMcpPolicy?.(next, syncDir).catch(() => null);
    if (res?.success && res.data) { setPolicy(res.data.policy); setProblem(null); } else setFailed(res?.error ?? 'failed');
  }, [syncDir]);

  const rules = Object.entries(policy.folders).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const addRule = () => {
    const key = normalizePolicyPath(folder.trim());
    if (!key) return;
    setFolder('');
    void save({ ...policy, folders: { ...policy.folders, [key]: access } });
  };

  return (
    <div className="pt-2 border-t border-gray-200/40 dark:border-gray-700/40 space-y-2" data-testid="agent-access">
      <div className="flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('mcpAccessTitle')}</p>
      </div>
      <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">{t('mcpAccessHelp')}</p>

      {problem && (
        <div role="alert" className="rounded border border-red-300/60 bg-red-50/60 dark:bg-red-950/20 p-2 text-[11px] text-red-700 dark:text-red-300 space-y-1.5">
          <p>{t('mcpAccessInvalid').replace('{error}', problem)}</p>
          <button type="button" onClick={() => { void save(DEFAULT_POLICY); }} className="underline">{t('mcpAccessReset')}</button>
        </div>
      )}
      {failed && <p role="alert" className="text-[11px] text-red-600">{t('mcpAccessSaveFailed').replace('{error}', failed)}</p>}

      {!problem && (
        <>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="agent-access-default" className="text-xs text-gray-700 dark:text-gray-200">{t('mcpAccessDefault')}</label>
            <select id="agent-access-default" value={policy.default} onChange={e => { void save({ ...policy, default: e.target.value as Access }); }} className={control}>
              {ACCESS_LEVELS.map(level => <option key={level} value={level}>{t(LABEL[level])}</option>)}
            </select>
          </div>

          <ul className="space-y-1">
            {rules.map(([name, level]) => (
              <li key={name} data-rule={name} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-xs font-mono text-gray-700 dark:text-gray-200">{name}/</span>
                <select
                  aria-label={name}
                  value={level}
                  onChange={e => { void save({ ...policy, folders: { ...policy.folders, [name]: e.target.value as Access } }); }}
                  className={control}
                >
                  {ACCESS_LEVELS.map(l => <option key={l} value={l}>{t(LABEL[l])}</option>)}
                </select>
                <button
                  type="button"
                  aria-label={t('mcpAccessRemove').replace('{name}', name)}
                  onClick={() => { const rest = { ...policy.folders }; delete rest[name]; void save({ ...policy, folders: rest }); }}
                  className="p-1 text-gray-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>

          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); addRule(); }}>
            <input aria-label={t('mcpAccessFolder')} list="agent-access-folders" value={folder} onChange={e => setFolder(e.target.value)} placeholder={t('mcpAccessFolder')} className={`${control} flex-1 min-w-0`} />
            <datalist id="agent-access-folders">{folders.map(f => <option key={f.name} value={f.name} />)}</datalist>
            <select aria-label={t('mcpAccessTitle')} value={access} onChange={e => setAccess(e.target.value as Access)} className={control}>
              {ACCESS_LEVELS.map(l => <option key={l} value={l}>{t(LABEL[l])}</option>)}
            </select>
            <button type="submit" aria-label={t('mcpAccessAdd')} title={t('mcpAccessAdd')} className="p-1 rounded text-[var(--accent)] hover:bg-[var(--accent-light)]"><Plus size={14} /></button>
          </form>
        </>
      )}
    </div>
  );
}
