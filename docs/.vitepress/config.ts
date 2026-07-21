import { defineConfig } from 'vitepress'

// Deployed to GitHub Pages as a project site at https://fabriziosalmi.github.io/noted/,
// so every absolute asset path is served under `/noted/`.
export default defineConfig({
  title: 'Noted',
  description:
    'A local-first macOS note-taking app with Markdown, wikilinks, full-text search, multi-provider AI, Git integration, and a built-in MCP server.',
  base: '/noted/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    // Everything this site loads is first-party. 'unsafe-inline' is required
    // because VitePress emits an inline appearance script and inline styles.
    // Applied to the built site only: `vitepress dev` serves HMR over a
    // websocket, which a strict connect-src would block as soon as the dev
    // server is not same-origin (--host, or a custom server.hmr.port).
    ...(process.env.NODE_ENV === 'production'
      ? [
          [
            'meta',
            {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
                "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                "font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
            },
          ] as [string, Record<string, string>],
        ]
      : []),
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/noted/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#6366F1' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Noted — local-first macOS notes' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Markdown notes with wikilinks, full-text search, multi-provider AI, Git, and an MCP server. Local-first: no account, no telemetry.',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Noted',

    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/settings', activeMatch: '/reference/' },
      { text: 'Contributing', link: '/contributing/architecture', activeMatch: '/contributing/' },
      { text: 'Download', link: '/guide/installation' },
      { text: 'Releases', link: 'https://github.com/fabriziosalmi/noted/releases' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'First run', link: '/guide/first-run' },
          ],
        },
        {
          text: 'Using Noted',
          items: [
            { text: 'The editor', link: '/guide/editor' },
            { text: 'Organizing notes', link: '/guide/organizing-notes' },
            { text: 'Search', link: '/guide/search' },
            { text: 'AI assistant', link: '/guide/ai' },
            { text: 'Git integration', link: '/guide/git' },
            { text: 'Export & capture', link: '/guide/export-and-capture' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Settings', link: '/reference/settings' },
            { text: 'Keyboard shortcuts', link: '/reference/keyboard-shortcuts' },
            { text: 'MCP server', link: '/reference/mcp-server' },
            { text: 'Agent workflows', link: '/reference/agent-workflows' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Architecture', link: '/contributing/architecture' },
            { text: 'Security', link: '/contributing/security' },
            { text: 'Building & releasing', link: '/contributing/building' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/fabriziosalmi/noted' }],

    footer: {
      message: 
        'Local-first. No account. No telemetry. · <a href="https://fabriziosalmi.github.io/privacy">Privacy &amp; legal</a>',
      copyright: 'MIT Licensed · Copyright © Fabrizio Salmi',
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },

    outline: {
      level: [2, 3],
      label: 'On this page',
    },

    editLink: {
      pattern: 'https://github.com/fabriziosalmi/noted/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    lineNumbers: false,
  },
})
