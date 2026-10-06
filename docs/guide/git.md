# Git integration

Because your vault is just a folder of files, it can be a Git repository. Noted
surfaces the essentials — status, commit, push, and GitHub pull requests —
without leaving the app.

## Enabling Git

Turn it on in **Settings → Integrations → Enable Git**, then provide:

- **Remote URL** — a GitHub HTTPS or SSH remote.
- **GitHub token** — a personal access token, stored with the macOS Keychain
  (via `safeStorage`).
- **Default base branch** — the branch pull requests target (default `main`).
- **Auto-commit** — optionally commit each note as you save it.

Once enabled, a Git badge appears in the title bar. It polls status every 30
seconds and shows a dot when the working tree is dirty.

## The Git panel

Open the panel from the badge to see:

- whether the vault is a repository,
- the current branch,
- a clean/dirty indicator and how many commits you are ahead (`↑N`),
- the **changed notes**, each with its state (modified, new, deleted),
- a refresh button.

If the vault is not a repository yet, the panel offers to **initialize** one.

## Comparing and staging notes

Under **Changed notes**, click a note to compare it with the version in your last commit. The
comparison is shown as Markdown text, so a change reads as the words that changed: the changed
lines are shown with two lines of context, and inside a rewritten line the words that differ are
highlighted. A new note is shown as all added, a deleted one as all removed. Notes stored as HTML
(vaults not yet converted) are shown as Markdown too, so the comparison is about the text and not
the markup.

Each note has **Stage** and **Unstage**. **Commit staged (n)** then commits exactly the staged notes
(with your message, or one made from their names) and leaves every other change as it was.
A note changed again after it was staged shows both buttons; the commit holds the staged version.

## Committing

Commit the active note with an optional message; the success toast shows the
short commit hash. With **auto-commit** enabled, Noted commits after each save
automatically.

## Opening a pull request

Noted can open a GitHub pull request for the current note:

1. It prepares a per-note branch.
2. It pushes the branch to your remote.
3. It creates a pull request via the GitHub API against your default base branch.

The PR title is prefilled from the note name, and you can edit the title and
body. This requires a configured remote and a stored GitHub token. On success,
Noted shows the pull-request URL.

::: info Tokens never leak into errors
Any error returned from Git is scrubbed of tokens and authorization headers
before it reaches the UI, so credentials never appear in a message or log.
:::

## Automatic sync

Besides committing by hand, Noted can keep your notes folder in step with a
remote on its own. Open the **Git panel → Sync** and pick a mode:

- **Every few minutes** — a sync every N minutes (1–120).
- **When I stop typing** — a sync N seconds (10–600) after your last edit.

Either way Noted also syncs shortly after launch and when you come back to the
window, so edits made on another device show up when you return. Sync is **off
by default**, and only runs for a branch that already has an upstream (for
example after `git push -u origin main`); the panel tells you when there is none.
**Sync now** runs one cycle on demand.

Each cycle commits your changes, fetches, merges and pushes. It follows a few
firm rules:

- **It never force-pushes.** If the remote moved while pushing, it fetches,
  merges again and retries once, then reports an error until the next cycle.
- **It never writes conflict markers into your notes.** A diverged history is
  merged off to the side, and only a finished merge reaches your folder.
- **It does not sync** the `.noted_history` snapshots, half-written temporary
  files or OS litter such as `.DS_Store`.
- **It never asks for a password.** If your credentials need typing, the sync
  fails with an error instead of waiting; set up a credential helper or an SSH
  key as you would for any unattended Git use.
- A purely incoming update never pushes, so a read-only remote works for
  pulling.

### When both sides changed the same note

Sync **pauses** and the title-bar Git badge turns amber with the number of notes
involved. Nothing has been overwritten. While paused, your own edits keep being
committed locally, but nothing is pulled or pushed. Open **Git → Resolve
conflicts…** to see each note with the version from this device on the left and
the remote's on the right:

- Parts only one side changed are merged automatically.
- For each part both sides changed, choose **Use yours**, **Use theirs** or
  **Keep both**, or **Edit the result by hand**.
- A note deleted on one side and edited on the other, and files that cannot be
  shown as text, are decided as a whole: keep one version, or delete the note.

**Apply and sync** is enabled once everything is decided. If the remote changed
again while you were deciding, nothing is applied, and you are shown the latest
version to review.

### Notes that change while they are open

If a sync (or any other program) changes the note you have open, Noted reloads it
when you have nothing unsaved. If you were in the middle of typing, your text is
kept and the other version is saved next to it as `<note> (other version).md`, so
neither is lost.

## Sharing a single note as a Gist

To share one note without committing to a repository, use **Save as Gist** in the
[Share menu](/guide/export-and-capture#sharing-and-export) — it creates a public
or private GitHub gist and copies the URL. This also uses your GitHub token.

## Next steps

- **[Export &amp; capture](/guide/export-and-capture)** — get notes out of Noted,
  and into it quickly.
