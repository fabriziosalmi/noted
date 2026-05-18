# Noted — Mobile Companion Plan

## Goal
iOS (and eventually Android) companion to the Noted desktop app.
Read, write, and sync notes on the go. Offline-first. No cloud lock-in.

---

## Architecture Decision: Native vs Cross-platform

| Option | Pros | Cons |
|--------|------|------|
| **React Native + Expo** | Shared logic with desktop (TypeScript, Zustand), fast dev, single codebase for iOS+Android | Bridge overhead, limited native editor control |
| **SwiftUI (iOS only)** | Best native feel, best Markdown/editor performance, OS integration (Share extension, Shortcuts, Widgets) | iOS-only, separate codebase, slower iteration |
| **Tauri Mobile (v2)** | Closest to current stack (Rust + WebView), same renderer as desktop | WebView on mobile is painful for editing |
| **1Writer / Working Copy integration** | Zero dev, instant | No custom AI, no PII masking, limited |

**Recommendation**: React Native + Expo for v1 (speed to market), migrate hot paths to Swift later.

---

## Sync Strategy

### Option A — Direct iCloud / Google Drive sync (current desktop approach)
- Mobile app reads/writes the same folder desktop uses
- iCloud Drive on iOS: `FileManager.default.url(forUbiquityContainerIdentifier:)`
- Google Drive: GDrive iOS SDK
- **Pro**: zero infrastructure, works today with desktop
- **Con**: requires same provider on both devices

### Option B — Noted Sync Server (future)
- Self-hosted (Docker) or managed service
- CRDTs (Automerge / Yjs) for conflict-free multi-device editing
- E2E encrypted (user key)
- **Pro**: works offline, any device, conflict-free
- **Con**: requires server dev and infrastructure

**Plan**: Ship Option A first (iCloud/GDrive), build Option B as premium feature.

---

## Phase 1 — Reader + Simple Editor (3 months)

- [ ] Expo project bootstrapped (`noted-mobile/`)
- [ ] Shared types package (`noted-shared/`) — NoteFile, sync primitives
- [ ] iCloud Drive file access (iOS Files API)
- [ ] Note list with folder support
- [ ] Markdown viewer (react-native-markdown-display)
- [ ] Basic editor (TextInput + toolbar: B, I, H1, H2, code)
- [ ] Daily note shortcut
- [ ] Search (filename + full-text via grep)
- [ ] Dark mode / accent color sync from desktop settings (shared JSON file in vault)

## Phase 2 — AI on Mobile (2 months)

- [ ] Same LLM provider config as desktop (read from shared settings.json in vault)
- [ ] AI Chat panel (full RAG if network available)
- [ ] Slash commands (local inference via Core ML / MLX if possible)
- [ ] PII masking (same piiMasker.ts — shared package)

## Phase 3 — Platform Integration (2 months)

- [ ] Share Extension: capture from Safari/Mail directly into Noted
- [ ] Today Widget: quick capture, daily note preview
- [ ] Siri Shortcut: "Add to Noted"
- [ ] Apple Watch: dictate a thought, saves to quick-capture inbox
- [ ] Lock Screen widget: word count / last opened note

## Phase 4 — Noted Sync Server (ongoing)

- [ ] Yjs CRDT document model per note
- [ ] WebSocket sync server (Node.js / Go)
- [ ] Docker Compose: `docker run fabriziosalmi/noted-sync`
- [ ] E2E encryption (libsodium secretbox, user passphrase → key)
- [ ] Conflict resolution UI (diff view on merge)

---

## 3rd-party sync compatibility

Notes are plain `.md` files — any of these work without code:
- **1Writer** (iOS) — iCloud folder sync, full Markdown editor
- **Working Copy** (iOS) — Git-based, works with our Git integration
- **iA Writer** — iCloud sync, excellent editor, no AI
- **Obsidian Mobile** — same folder, full compatibility since we use standard .md + wikilinks

---

## File structure

```
noted-mobile/
├── app/                    # Expo Router pages
│   ├── (tabs)/
│   │   ├── index.tsx       # Note list
│   │   ├── daily.tsx       # Daily note
│   │   └── search.tsx      # Search
│   └── note/[name].tsx     # Editor
├── components/
│   ├── NoteEditor.tsx      # Mobile editor
│   ├── AiChat.tsx          # Reused from desktop (adapted)
│   └── Toolbar.tsx
├── lib/                    # Symlink or copy from desktop src/lib/
│   ├── piiMasker.ts        # Identical to desktop
│   ├── textMetrics.ts      # Identical
│   └── i18n.ts             # Shared
└── sync/
    ├── icloud.ts
    ├── gdrive.ts
    └── noted-server.ts     # Future
```

---

## Launch criteria (App Store v1.0)

- [ ] Read/write notes from iCloud vault
- [ ] Folder + search support
- [ ] Basic AI (same API keys as desktop, read from shared config)
- [ ] Daily note
- [ ] Share Extension
- [ ] iOS 17+ (iPhone + iPad)
- [ ] Privacy manifest (no tracking, local-only unless AI API configured)
