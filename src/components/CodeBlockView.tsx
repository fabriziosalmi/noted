import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function CodeBlockView({ node }: NodeViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const lang = node.attrs.language as string | null;

  return (
    <NodeViewWrapper className="relative group">
      <pre>
        {lang && (
          <span className="absolute top-2 left-3 text-xs text-gray-400 dark:text-gray-500 font-mono select-none opacity-0 group-hover:opacity-100 transition-opacity">
            {lang}
          </span>
        )}
        <button
          onClick={handleCopy}
          title={t('copyCode')}
          className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-gray-200/60 dark:bg-gray-700/60 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
