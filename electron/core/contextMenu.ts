import { Menu, clipboard, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import { tr } from './language';

/** What the menu can do; passed in, so the menu itself can be built and checked without a window. */
export interface ContextMenuActions {
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  openLink: (url: string) => void;
  copyLink: (url: string) => void;
}

type Params = Pick<ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions' | 'isEditable' | 'selectionText' | 'editFlags' | 'linkURL'>;

const MAX_SUGGESTIONS = 5;
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
 * The right-click menu for what is under the pointer: spelling suggestions for a misspelled word (and adding it to
 * the dictionary), a web link's actions, and the edit actions the target allows. Empty when there is nothing to offer.
 */
export function contextMenuTemplate(params: Params, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const section = (more: MenuItemConstructorOptions[]) => {
    if (!more.length) return;
    if (items.length) items.push({ type: 'separator' });
    items.push(...more);
  };

  const word = params.misspelledWord;
  if (word) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
    section([
      ...(suggestions.length
        ? suggestions.map(s => ({ label: s, click: () => actions.replaceMisspelling(s) }))
        : [{ label: tr('ctxNoSuggestions'), enabled: false }]),
      { label: tr('ctxAddToDictionary'), click: () => actions.addToDictionary(word) },
    ]);
  }

  if (params.linkURL && isWebLink(params.linkURL)) {
    const url = params.linkURL;
    section([
      { label: tr('ctxOpenLink'), click: () => actions.openLink(url) },
      { label: tr('ctxCopyLink'), click: () => actions.copyLink(url) },
    ]);
  }

  const flags = params.editFlags;
  if (params.isEditable) {
    section([
      { role: 'cut', label: tr('ctxCut'), enabled: flags.canCut },
      { role: 'copy', label: tr('ctxCopy'), enabled: flags.canCopy },
      { role: 'paste', label: tr('ctxPaste'), enabled: flags.canPaste },
      { role: 'pasteAndMatchStyle', label: tr('ctxPastePlain'), enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: tr('ctxSelectAll'), enabled: flags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    section([{ role: 'copy', label: tr('ctxCopy'), enabled: flags.canCopy }]);
  }
  return items;
}

/** Gives a window the right-click menu. Before, right-click did nothing anywhere in the app. */
export function attachContextMenu(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params, {
      replaceMisspelling: word => wc.replaceMisspelling(word),
      addToDictionary: word => { wc.session.addWordToSpellCheckerDictionary(word); },
      openLink: url => { void shell.openExternal(url); },
      copyLink: url => clipboard.writeText(url),
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
}
