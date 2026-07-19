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
- the first few modified files,
- a refresh button.

If the vault is not a repository yet, the panel offers to **initialize** one.

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

## Sharing a single note as a Gist

To share one note without committing to a repository, use **Save as Gist** in the
[Share menu](/guide/export-and-capture#sharing-and-export) — it creates a public
or private GitHub gist and copies the URL. This also uses your GitHub token.

## Next steps

- **[Export &amp; capture](/guide/export-and-capture)** — get notes out of Noted,
  and into it quickly.
