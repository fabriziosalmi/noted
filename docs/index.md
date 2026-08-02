---
layout: home
title: Noted — local-first notes

hero:
  name: "Noted"
  text: "Notes that stay on your machine"
  tagline: "A local-first Markdown notebook with wikilinks, full-text search, multi-provider AI, Git, and a built-in MCP server. No account, no telemetry."
  image:
    src: /logo.svg
    alt: Noted app icon
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Download
      link: /guide/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/fabriziosalmi/noted

features:
  - icon:
      src: /icons/local.svg
      alt: Local files
    title: Your files, your folder
    details: Every note is a real Markdown file on disk. Read, back up, grep, and version them with any tool. No database, no lock-in.
  - icon:
      src: /icons/editor.svg
      alt: Editor
    title: A rich, quiet editor
    details: Headings, tables, code with syntax highlighting, math, and images — written in a modern editor, saved as portable Markdown.
  - icon:
      src: /icons/links.svg
      alt: Links
    title: Links and backlinks
    details: Connect notes with [[wikilinks]], see everything that links back, and group related notes into projects.
  - icon:
      src: /icons/search.svg
      alt: Search
    title: Instant search
    details: A fast note switcher and full-text search across the whole vault, backed by a BM25 index that updates as you write.
  - icon:
      src: /icons/ai.svg
      alt: AI
    title: AI, your way
    details: Inline completions, slash commands, and chat — with OpenAI, Anthropic, Gemini, OpenRouter, or a local LM Studio or Ollama model.
  - icon:
      src: /icons/privacy.svg
      alt: Privacy
    title: Private by default
    details: No account, no telemetry. API keys live in the Keychain, and personal data is masked before it ever reaches a cloud model.
  - icon:
      src: /icons/git.svg
      alt: Git
    title: Git built in
    details: Commit, push, and open GitHub pull requests without leaving your notes.
  - icon:
      src: /icons/export.svg
      alt: Export
    title: Export anywhere
    details: Send notes out as HTML, Markdown, PDF, or DOCX — plus a global Quick Capture window and daily notes.
  - icon:
      src: /icons/mcp.svg
      alt: MCP
    title: Automate with MCP
    details: A built-in Model Context Protocol server lets compatible AI clients read, search, and write your notes.
---

<div style="max-width: 960px; margin: 4rem auto 0; padding: 0 24px;">

## A look inside

The editor stays out of the way — headings, task lists, code, math, and inline
[[wikilinks]] that connect your notes as you write.

<img src="/media/screenshot-editor.png" width="1440" height="900" loading="lazy" decoding="async"
     alt="The Noted editor showing a note with a task list, headings, and a wikilink."
     style="width: 100%; height: auto; border-radius: 12px;" />

<video controls muted playsinline preload="metadata" width="1440" height="900" poster="/media/screenshot-editor.png" style="width: 100%; height: auto; border-radius: 12px; margin-top: 2rem;">
  <source src="/media/demo.mp4" type="video/mp4">
  Your browser does not support the video tag —
  <a href="/media/demo.mp4">download the demo</a> instead.
</video>

</div>

