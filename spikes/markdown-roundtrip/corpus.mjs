// Golden corpus for ADR 0001. Each snippet is Markdown as a person (or Obsidian) would write
// it, in the canonical style we want on disk: `-` bullets, `1.` ordered lists, ATX headings,
// `**bold**` / `*italic*`, fenced code, no trailing spaces, one blank line between blocks.
// `golden` is what a lossless pipeline must give back, byte for byte.
//
// `ext: true` marks Obsidian-style extensions that no CommonMark/GFM parser knows: they are
// the constructs the product decision depends on.

export const CORPUS = [
  // ── Inline basics ────────────────────────────────────────────────────────
  { id: 'para-1', cat: 'inline', md: 'A plain paragraph with some words.' },
  { id: 'para-2', cat: 'inline', md: 'First paragraph.\n\nSecond paragraph.' },
  { id: 'emphasis', cat: 'inline', md: 'Some *italic*, some **bold**, and some ***both***.' },
  { id: 'strike', cat: 'inline', md: 'This is ~~gone~~ now.' },
  { id: 'code-inline', cat: 'inline', md: 'Run `npm test` before pushing.' },
  { id: 'code-inline-tick', cat: 'inline', md: 'Use ``a `tick` inside`` code.' },
  { id: 'link', cat: 'inline', md: 'See [the docs](https://example.com/docs) for more.' },
  { id: 'link-title', cat: 'inline', md: 'A [titled link](https://example.com "Example site").' },
  { id: 'autolink', cat: 'inline', md: 'Visit <https://example.com> today.' },
  { id: 'image', cat: 'inline', md: '![A diagram](attachments/0123456789abcdef0123456789abcdef.png)' },
  { id: 'image-title', cat: 'inline', md: '![Alt text](img/a.png "Caption")' },
  { id: 'hard-break', cat: 'inline', md: 'Line one\\\nLine two' },
  { id: 'escape', cat: 'inline', md: 'Not a list: 1986\\. A good year, and \\*not italic\\*.' },
  { id: 'entities', cat: 'inline', md: 'Fish &amp; chips &copy; 2026' },
  { id: 'unicode', cat: 'inline', md: 'Caffè, 日本語, emoji 🚀 and ligatures: ﬁ.' },
  { id: 'long-line', cat: 'inline', md: 'This is one very long line that a naive serializer might be tempted to reflow at eighty columns, but it must stay exactly as the author wrote it, on a single line, forever.' },
  { id: 'inline-html', cat: 'inline', md: 'Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.' },

  // ── Block basics ─────────────────────────────────────────────────────────
  { id: 'headings', cat: 'block', md: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6' },
  { id: 'quote', cat: 'block', md: '> A quote\n> over two lines.' },
  { id: 'quote-nested', cat: 'block', md: '> Outer\n>\n> > Inner' },
  { id: 'rule', cat: 'block', md: 'Above\n\n---\n\nBelow' },
  { id: 'code-fence', cat: 'block', md: '```js\nconst a = 1;\nconsole.log(a);\n```' },
  { id: 'code-fence-nolang', cat: 'block', md: '```\nplain text\n```' },
  { id: 'code-fence-md', cat: 'block', md: '````md\n```js\nnested fence\n```\n````' },
  { id: 'code-indented', cat: 'block', md: 'Before\n\n    indented code\n    block\n\nAfter' },
  { id: 'html-block', cat: 'block', md: '<div class="note">\n  <p>Raw HTML block</p>\n</div>' },
  { id: 'details', cat: 'block', md: '<details>\n<summary>More</summary>\n\nHidden *text*.\n\n</details>' },
  { id: 'footnote', cat: 'block', md: 'A claim.[^1]\n\n[^1]: The source.' },
  { id: 'ref-link', cat: 'block', md: 'See [the spec][cm].\n\n[cm]: https://spec.commonmark.org/ "CommonMark"' },

  // ── Lists ────────────────────────────────────────────────────────────────
  { id: 'list-bullets', cat: 'list', md: '- one\n- two\n- three' },
  { id: 'list-ordered', cat: 'list', md: '1. one\n2. two\n3. three' },
  { id: 'list-ordered-start', cat: 'list', md: '3. three\n4. four' },
  { id: 'list-nested', cat: 'list', md: '- a\n  - b\n    - c\n- d' },
  { id: 'list-mixed', cat: 'list', md: '1. first\n   - sub bullet\n   - another\n2. second' },
  { id: 'list-loose', cat: 'list', md: '- one\n\n- two\n\n- three' },
  { id: 'list-code', cat: 'list', md: '- step\n\n  ```sh\n  make build\n  ```\n\n- next' },
  { id: 'tasks', cat: 'list', md: '- [ ] todo\n- [x] done\n- [ ] later' },
  { id: 'tasks-nested', cat: 'list', md: '- [ ] parent\n  - [x] child\n  - [ ] other child' },

  // ── GFM tables ───────────────────────────────────────────────────────────
  { id: 'table', cat: 'table', md: '| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 12 |' },
  { id: 'table-align', cat: 'table', md: '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |' },
  { id: 'table-inline', cat: 'table', md: '| Item | Note |\n| --- | --- |\n| **bold** | `code` and [link](https://x.io) |' },
  { id: 'table-pipe', cat: 'table', md: '| Expr | Meaning |\n| --- | --- |\n| a \\| b | either |' },

  // ── Obsidian-style extensions (the product-defining ones) ────────────────
  { id: 'wikilink', cat: 'ext', ext: true, md: 'Linked to [[Project plan]] here.' },
  { id: 'wikilink-alias', cat: 'ext', ext: true, md: 'See [[Project plan|the plan]] for details.' },
  { id: 'wikilink-heading', cat: 'ext', ext: true, md: 'Jump to [[Project plan#Milestones]].' },
  { id: 'wikilink-block', cat: 'ext', ext: true, md: 'As noted in [[Meeting#^decision-1]].' },
  { id: 'wikilink-path', cat: 'ext', ext: true, md: 'In [[Projects/Alpha/Plan]] we say so.' },
  { id: 'wikilink-in-list', cat: 'ext', ext: true, md: '- [[One]]\n- [[Two|second]]\n- plain' },
  { id: 'wikilink-in-code', cat: 'ext', ext: true, md: 'Literal `[[not a link]]` stays code.' },
  { id: 'embed-note', cat: 'ext', ext: true, md: '![[Reusable snippet]]' },
  { id: 'embed-image', cat: 'ext', ext: true, md: '![[diagram.png|400]]' },
  { id: 'highlight', cat: 'ext', ext: true, md: 'Some ==highlighted text== in a line.' },
  { id: 'math-inline', cat: 'ext', ext: true, md: 'Euler: $e^{i\\pi} + 1 = 0$ is neat.' },
  { id: 'math-block', cat: 'ext', ext: true, md: '$$\n\\int_0^1 x^2\\,dx = \\tfrac{1}{3}\n$$' },
  { id: 'callout', cat: 'ext', ext: true, md: '> [!note]\n> A callout body.' },
  { id: 'callout-title', cat: 'ext', ext: true, md: '> [!warning] Careful\n> Body of the warning\n> on two lines.' },
  { id: 'callout-fold', cat: 'ext', ext: true, md: '> [!tip]- Folded by default\n> Hidden until opened.' },
  { id: 'tag-inline', cat: 'ext', ext: true, md: 'Filed under #project/alpha and #idea.' },
  { id: 'comment', cat: 'ext', ext: true, md: 'Visible %%hidden comment%% visible.' },

  // ── Frontmatter and document-level ───────────────────────────────────────
  { id: 'frontmatter', cat: 'doc', md: '---\ntitle: Plan\ntags: [a, b]\nstatus: draft\n---\n\n# Plan\n\nBody.' },
  { id: 'frontmatter-odd', cat: 'doc', md: '---\n# a comment the user wrote\nkey:   spaced   value\nlist:\n  - x\n  - y\nunknown_key: "keep me"\n---\n\nText.' },
  { id: 'empty', cat: 'doc', md: '' },
  { id: 'only-title', cat: 'doc', md: '# Just a title' },
  { id: 'trailing-nl', cat: 'doc', md: 'Ends with one newline.\n', normalizeTrailingNewline: true },
];
