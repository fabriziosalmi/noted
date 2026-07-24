import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../test/test-utils';
import { EditorToolbar } from './EditorToolbar';

const mockEditor = {
  isActive: vi.fn().mockReturnValue(false),
  chain: vi.fn().mockImplementation(() => {
    const chainObj = {
      focus: () => chainObj,
      toggleHeading: () => chainObj,
      toggleBold: () => chainObj,
      toggleItalic: () => chainObj,
      toggleStrike: () => chainObj,
      toggleCode: () => chainObj,
      toggleBulletList: () => chainObj,
      toggleOrderedList: () => chainObj,
      toggleBlockquote: () => chainObj,
      insertTable: () => chainObj,
      run: vi.fn(),
    };
    return chainObj;
  }),
  state: {
    doc: {
      content: {
        size: 0,
      },
    },
    selection: {
      from: 0,
      to: 0,
    },
  },
  commands: {
    setTextSelection: vi.fn(),
    scrollIntoView: vi.fn(),
    focus: vi.fn(),
  },
} as any;

describe('EditorToolbar', () => {
  const defaultProps = {
    editor: mockEditor,
    showToolbar: true,
    showAiBar: false,
    findOpen: false,
    onCloseFind: vi.fn(),
    onOpenFind: vi.fn(),
    onToggleAiBar: vi.fn(),
    shareSlot: <div data-testid="share-slot">Share Menu</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders formatting buttons when showToolbar is true', () => {
    render(<EditorToolbar {...defaultProps} />);
    
    // Check headings, bold, italic, strikethrough, code, table, lists, blockquote
    expect(screen.getByRole('button', { name: 'Heading 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold (⌘B)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Italic (⌘I)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inline code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert table' })).toBeInTheDocument();

    // Check new bullet list, numbered list, blockquote buttons
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blockquote' })).toBeInTheDocument();
  });

  it('renders AI action buttons when showAiBar is true', () => {
    render(<EditorToolbar {...defaultProps} showToolbar={false} showAiBar={true} />);
    
    // AiActionsBar contains continue, expand, refine etc. Labels live in the
    // accessible name (aria-label / portal tooltip), not as visible text.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refine' })).toBeInTheDocument();
  });

  it('places shareSlot in Row 1 when showToolbar is true and showAiBar is false', () => {
    const { container } = render(<EditorToolbar {...defaultProps} showToolbar={true} showAiBar={false} />);
    
    const shareSlot = screen.getByTestId('share-slot');
    expect(shareSlot).toBeInTheDocument();
    
    // Since showAiBar is false, Row 2 is not rendered.
    // Let's verify that Row 2 container is absent.
    const aiBarContainer = container.querySelector('.border-t');
    expect(aiBarContainer).toBeNull();
  });

  it('keeps shareSlot in Row 1 when the AI bar opens (no row-1 height jump)', () => {
    const { container } = render(
      <EditorToolbar {...defaultProps} showToolbar={true} showAiBar={true} />
    );

    const shareSlot = screen.getByTestId('share-slot');
    expect(shareSlot).toBeInTheDocument();

    // Row 2 (border-t) renders for the AI actions but must NOT host the share
    // menu — it stays in row 1 so opening the AI bar never resizes row 1.
    const row2 = container.querySelector('.border-t');
    expect(row2).toBeInTheDocument();
    expect(row2?.contains(shareSlot)).toBe(false);
  });

  it('hosts shareSlot in Row 2 only when the formatting bar is hidden', () => {
    const { container } = render(
      <EditorToolbar {...defaultProps} showToolbar={false} showAiBar={true} />
    );

    const shareSlot = screen.getByTestId('share-slot');
    expect(shareSlot).toBeInTheDocument();
    // No row 1, so the AI row carries the share menu.
    const aiRow = container.querySelector('.justify-between');
    expect(aiRow?.contains(shareSlot)).toBe(true);
  });

  it('focuses search input when opened', () => {
    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const input = screen.getByPlaceholderText('Find in document...');
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('runs find and updates selection and highlights matches count', async () => {
    mockEditor.state.doc = {
      content: { size: 20 },
      nodesBetween: (from: number, to: number, cb: any) => {
        cb({ isText: true, text: 'hello world hello' }, 0);
      }
    } as any;


    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const input = screen.getByPlaceholderText('Find in document...');

    fireEvent.change(input, { target: { value: 'hello' } });

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith({ from: 0, to: 5 });
    expect(mockEditor.commands.scrollIntoView).toHaveBeenCalled();

    const nextBtn = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(nextBtn);
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith({ from: 12, to: 17 });

    const prevBtn = screen.getByRole('button', { name: 'Previous' });
    fireEvent.click(prevBtn);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('handles Enter, Shift+Enter, and Escape keydowns in input', () => {
    mockEditor.state.doc = {
      content: { size: 20 },
      nodesBetween: (from: number, to: number, cb: any) => {
        cb({ isText: true, text: 'hello world hello' }, 0);
      }
    } as any;


    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const input = screen.getByPlaceholderText('Find in document...');

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(screen.getByText('1/2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('2/2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(screen.getByText('1/2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(defaultProps.onCloseFind).toHaveBeenCalled();
    expect(mockEditor.commands.focus).toHaveBeenCalled();
  });

  it('shows noResults text when query matches nothing', () => {
    mockEditor.state.doc = {
      content: { size: 20 },
      nodesBetween: (from: number, to: number, cb: any) => {
        cb({ isText: true, text: 'hello world hello' }, 0);
      }
    } as any;


    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const input = screen.getByPlaceholderText('Find in document...');

    fireEvent.change(input, { target: { value: 'nonexistent' } });
    expect(screen.getByText('0 results')).toBeInTheDocument();
  });

  it('handles empty query', () => {
    mockEditor.state.doc = {
      content: { size: 20 },
      nodesBetween: (from: number, to: number, cb: any) => {
        cb({ isText: true, text: 'hello world hello' }, 0);
      }
    } as any;


    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const input = screen.getByPlaceholderText('Find in document...');

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText('0 results')).toBeNull();
  });

  it('supports close button click', () => {

    render(<EditorToolbar {...defaultProps} findOpen={true} />);
    const closeBtn = screen.getByRole('button', { name: 'Close find' });
    fireEvent.click(closeBtn);
    expect(defaultProps.onCloseFind).toHaveBeenCalled();
  });

  it('calls editor commands when formatting buttons are clicked', () => {

    render(<EditorToolbar {...defaultProps} showToolbar={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Heading 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bold (⌘B)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Italic (⌘I)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Strikethrough' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inline code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blockquote' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  it('calls onToggleAiBar when Sparkles button is clicked', () => {
    const onToggleAiBar = vi.fn();

    render(
      <EditorToolbar
        {...defaultProps}
        showToolbar={true}
        onToggleAiBar={onToggleAiBar}
      />
    );

    const sparklesBtn = screen.getByRole('button', { name: 'Show AI bar (Continue, Expand, Refine…)' });
    expect(sparklesBtn).toBeInTheDocument();
    fireEvent.click(sparklesBtn);
    expect(onToggleAiBar).toHaveBeenCalledTimes(1);
  });
});
