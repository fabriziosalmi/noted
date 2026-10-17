import type { Editor } from '@tiptap/react';

type Prompt = (opts: { title: string; placeholder?: string; defaultValue?: string; confirmLabel?: string }) => Promise<string | null>;

/**
 * Links the selection (or edits the link the caret is in) after asking for the address with the in-app prompt. An
 * empty address removes the link. Used by the toolbar button and by ⌘K with text selected.
 */
export async function promptForLink(editor: Editor, prompt: Prompt, t: (key: 'linkPromptTitle' | 'linkApply') => string): Promise<void> {
  const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
  const url = await prompt({ title: t('linkPromptTitle'), placeholder: 'https://example.com', defaultValue: prev, confirmLabel: t('linkApply') });
  if (url === null) return; // cancelled
  const href = url.trim();
  if (!href) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}
