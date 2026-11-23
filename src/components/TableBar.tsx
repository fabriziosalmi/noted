import type { Editor } from '@tiptap/core';

interface TableBarProps {
  editor: Editor | null;
}

const btn = 'text-xs px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';

export function TableBar({ editor }: TableBarProps) {
  if (!editor || !editor.isActive('table')) return null;

  const actions = [
    { label: 'Add row', run: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Delete row', run: () => editor.chain().focus().deleteRow().run() },
    { label: 'Add column', run: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Delete column', run: () => editor.chain().focus().deleteColumn().run() },
    { label: 'Delete table', run: () => editor.chain().focus().deleteTable().run() },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Table actions"
      data-testid="table-bar"
      className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700"
    >
      {actions.map(a => (
        <button key={a.label} type="button" onClick={a.run} className={btn}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
