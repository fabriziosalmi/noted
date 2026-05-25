import { useState } from 'react';
import type { AppPanelsApi } from './contracts';

type RightTab = 'ai' | 'agent' | 'analytics' | 'graph';

export function useAppPanels(): AppPanelsApi {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('ai');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGitOpen, setIsGitOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  return {
    leftOpen,
    rightOpen,
    rightTab,
    isSettingsOpen,
    isShortcutsOpen,
    isAdvisorOpen,
    isTemplatesOpen,
    isHistoryOpen,
    isGitOpen,
    findOpen,
    quickOpenOpen,
    globalSearchOpen,

    setRightTab,
    setFindOpen,

    toggleLeftOpen: () => setLeftOpen(v => !v),
    toggleRightOpen: () => setRightOpen(v => !v),
    toggleShortcuts: () => setIsShortcutsOpen(v => !v),
    toggleQuickOpen: () => setQuickOpenOpen(v => !v),
    toggleFind: () => setFindOpen(v => !v),
    toggleGlobalSearch: () => setGlobalSearchOpen(v => !v),
    toggleTemplates: () => setIsTemplatesOpen(v => !v),
    toggleAdvisor: () => setIsAdvisorOpen(v => !v),
    toggleGit: () => setIsGitOpen(v => !v),

    openSettings: () => setIsSettingsOpen(true),
    closeSettings: () => setIsSettingsOpen(false),
    openShortcuts: () => setIsShortcutsOpen(true),
    closeShortcuts: () => setIsShortcutsOpen(false),
    openAdvisor: () => setIsAdvisorOpen(true),
    closeAdvisor: () => setIsAdvisorOpen(false),
    openTemplates: () => setIsTemplatesOpen(true),
    closeTemplates: () => setIsTemplatesOpen(false),
    openHistory: () => setIsHistoryOpen(true),
    closeHistory: () => setIsHistoryOpen(false),
    closeGit: () => setIsGitOpen(false),
    closeQuickOpen: () => setQuickOpenOpen(false),
    closeGlobalSearch: () => setGlobalSearchOpen(false),
  };
}
