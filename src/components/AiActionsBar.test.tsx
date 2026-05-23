import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AiActionsBar } from './AiActionsBar';
import { askLLM, AbortedError } from '../lib/llm';
import { useStore } from '../store/useStore';

vi.mock('../lib/llm', () => ({
  askLLM: vi.fn(),
  AbortedError: class AbortedError extends Error {},
  describeLlmError: (err: any) => err.message || String(err),
}));

const mockEditor = {
  state: {
    selection: { from: 0, to: 0 },
    doc: {
      textBetween: vi.fn(),
    },
  },
  getText: vi.fn(),
  chain: vi.fn(),
  commands: {
    setContent: vi.fn(),
    focus: vi.fn(),
    insertContent: vi.fn(),
  },
} as any;

describe('AiActionsBar', () => {
  const defaultProps = {
    editor: mockEditor,
    onError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        piiMasking: false,
      },
    });

    // Reset mock editor methods
    mockEditor.state.selection = { from: 0, to: 0 };
    mockEditor.getText.mockReturnValue('Hello, this is a note.');
    mockEditor.state.doc.textBetween.mockReturnValue('');
    mockEditor.chain.mockImplementation(() => {
      const chainObj = {
        focus: () => chainObj,
        deleteSelection: () => chainObj,
        insertContent: vi.fn().mockReturnValue(chainObj),
        run: vi.fn(),
      };
      return chainObj;
    });
    mockEditor.commands.setContent.mockClear();
    mockEditor.commands.focus.mockClear();
    mockEditor.commands.insertContent.mockClear();
  });

  it('renders all AI action and analysis buttons', () => {
    render(<AiActionsBar {...defaultProps} />);
    
    // AI buttons in ACTIONS and CLINICAL_ACTIONS
    expect(screen.getByLabelText('Continue')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand')).toBeInTheDocument();
    expect(screen.getByLabelText('Shorten')).toBeInTheDocument();
    expect(screen.getByLabelText('Refine')).toBeInTheDocument();

    expect(screen.getByLabelText('Summarize')).toBeInTheDocument();
    expect(screen.getByLabelText('Review')).toBeInTheDocument();
    expect(screen.getByLabelText("Devil's Advocate")).toBeInTheDocument();
    expect(screen.getByLabelText('Q&A')).toBeInTheDocument();
  });

  it('shows error if editor text is empty', async () => {
    mockEditor.getText.mockReturnValue('');
    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    expect(defaultProps.onError).toHaveBeenCalledWith(
      'Scrivi qualcosa nella nota prima di usare le azioni AI.'
    );
    expect(askLLM).not.toHaveBeenCalled();
  });

  it('runs action without selection (mode: append) and inserts result', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('Continued text.');
    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(askLLM).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello, this is a note.' }),
        ]),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(mockEditor.commands.insertContent).toHaveBeenCalledWith(
        '<hr><p>Continued text.</p>'
      );
    });
  });

  it('runs action with selection (mode: replace) and updates selection', async () => {
    mockEditor.state.selection = { from: 5, to: 10 };
    mockEditor.state.doc.textBetween.mockReturnValue('selected text');
    vi.mocked(askLLM).mockResolvedValueOnce('Replacement text.');

    // mock chain's insertContent to capture calls
    const mockInsertContent = vi.fn();
    mockEditor.chain.mockImplementation(() => {
      const chainObj = {
        focus: () => chainObj,
        deleteSelection: () => chainObj,
        insertContent: mockInsertContent,
        run: vi.fn(),
      };
      return chainObj;
    });

    render(<AiActionsBar {...defaultProps} />);

    // 'Expand' has mode 'replace'
    const expandBtn = screen.getByLabelText('Expand');
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(askLLM).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'selected text' }),
        ]),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(mockInsertContent).toHaveBeenCalledWith('<p>Replacement text.</p>');
    });
  });

  it('masks PII when piiMasking is enabled', async () => {
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        piiMasking: true,
      },
    });

    mockEditor.getText.mockReturnValue('Contact me at john.doe@example.com or 123-456-7890.');
    vi.mocked(askLLM).mockResolvedValueOnce('Response text.');

    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(askLLM).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Contact me at [EMAIL_1] or [PHONE_1].',
          }),
        ]),
        expect.any(Object)
      );
    });
  });

  it('supports replacing complete content if mode is replace and no selection', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('Complete new content.');
    render(<AiActionsBar {...defaultProps} />);

    // 'Expand' has mode 'replace'
    const expandBtn = screen.getByLabelText('Expand');
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(mockEditor.commands.setContent).toHaveBeenCalledWith(
        '<p>Complete new content.</p>'
      );
    });
  });

  it('appends with custom heading for analysis actions', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('Summary content.');
    render(<AiActionsBar {...defaultProps} />);

    // 'Summarize' has mode 'append' and heading '## Summary'
    const summarizeBtn = screen.getByLabelText('Summarize');
    fireEvent.click(summarizeBtn);

    await waitFor(() => {
      expect(mockEditor.commands.insertContent).toHaveBeenCalledWith(
        '<hr><h2>Summary</h2><p>Summary content.</p>'
      );
    });
  });

  it('aborts previous request when a new one starts', async () => {
    const promise1 = new Promise(() => undefined);
    vi.mocked(askLLM).mockImplementationOnce(() => promise1 as any);

    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    const firstCallSignal = vi.mocked(askLLM).mock.calls[0][1].signal;
    expect(firstCallSignal.aborted).toBe(false);

    const expandBtn = screen.getByLabelText('Expand');
    
    // Trigger onClick directly via React internal props key to bypass disabled state
    const propKey = Object.keys(expandBtn).find(
      (k) => k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers')
    );
    if (propKey) {
      act(() => {
        (expandBtn as any)[propKey].onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
      });
    } else {
      expandBtn.removeAttribute('disabled');
      act(() => {
        (expandBtn as any).disabled = false;
        fireEvent.click(expandBtn);
      });
    }

    expect(askLLM).toHaveBeenCalledTimes(2);
    expect(firstCallSignal.aborted).toBe(true);
  });

  it('aborts request on unmount', async () => {
    const promise1 = new Promise(() => undefined);
    vi.mocked(askLLM).mockImplementationOnce(() => promise1 as any);

    const { unmount } = render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    const signal = vi.mocked(askLLM).mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('ignores AbortedError silently', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new AbortedError('Aborted'));
    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(askLLM).toHaveBeenCalled();
    });
    
    expect(defaultProps.onError).not.toHaveBeenCalled();
  });

  it('surfaces general errors to onError', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new Error('LLM down'));
    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(defaultProps.onError).toHaveBeenCalledWith('LLM down');
    });
  });

  it('renders "sel" tag when hasSelection is true', () => {
    mockEditor.state.selection = { from: 5, to: 10 };
    render(<AiActionsBar {...defaultProps} />);
    expect(screen.getByText('sel')).toBeInTheDocument();
  });

  it('converts markdown blocks to HTML via mdToHtml parser', async () => {
    const complexMarkdown = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

> This is a blockquote with **bold** and *italic* and _italic2_ and \`code\` and [link](http://test.com)

| H1 | H2 |
|---|---|
| A1 | A2 |

- Bullet 1
- Bullet 2

1. Number 1
2. Number 2

\`\`\`javascript
const x = 1;
\`\`\`

---

This is a paragraph
with a newline.
`;

    vi.mocked(askLLM).mockResolvedValueOnce(complexMarkdown);
    render(<AiActionsBar {...defaultProps} />);

    const continueBtn = screen.getByLabelText('Continue');
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(mockEditor.commands.insertContent).toHaveBeenCalledWith(
        expect.stringContaining('<h1>Heading 1</h1>')
      );
    });

    const calls = mockEditor.commands.insertContent.mock.calls;
    const finalHtml = calls[0][0];

    expect(finalHtml).toContain('<h1>Heading 1</h1>');
    expect(finalHtml).toContain('<h2>Heading 2</h2>');
    expect(finalHtml).toContain('<h3>Heading 3</h3>');
    expect(finalHtml).toContain('<h4>Heading 4</h4>');
    expect(finalHtml).toContain('<h5>Heading 5</h5>');
    expect(finalHtml).toContain('<h6>Heading 6</h6>');
    expect(finalHtml).toContain('<blockquote><p>This is a blockquote with <strong>bold</strong> and <em>italic</em> and <em>italic2</em> and <code>code</code> and <a href="http://test.com">link</a></p></blockquote>');
    expect(finalHtml).toContain('<table><tr><th>H1</th><th>H2</th></tr><tr><td>A1</td><td>A2</td></tr></table>');
    expect(finalHtml).toContain('<ul><li>Bullet 1</li><li>Bullet 2</li></ul>');
    expect(finalHtml).toContain('<ol><li>Number 1</li><li>Number 2</li></ol>');
    expect(finalHtml).toContain('<pre><code>const x = 1;\n</code></pre>');
    expect(finalHtml).toContain('<hr>');
    expect(finalHtml).toContain('<p>This is a paragraph<br>with a newline.</p>');
  });
});
