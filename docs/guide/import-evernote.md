# Import from Evernote

Noted reads the export files Evernote makes (`.enex`) and turns each note into a Markdown note in your vault, with its
pictures and files, its tags and dates, and a report of anything that did not come across whole. Nothing is sent
anywhere: the file is read on your computer.

## Make the export

In Evernote, select a notebook (or some notes) and use **File → Export**, format **ENEX**. One file per notebook is the
usual way; you can pick several files at once.

## Import it

**Settings → Import → Import from Evernote**, then choose the `.enex` file or files.

Each file becomes a folder named after it: `Travel.enex` gives `Evernote/Travel/`, and each note is a note in it, named
after its title. A title that cannot be a file name (`/`, `:`, `?` and the like) is cleaned, and two notes with the same title keep
both (`Plan.md`, `Plan_1.md`). Notes that are already in your vault are never overwritten: importing the same file twice
gives you the notes twice, not changed ones.

## What comes across

| In Evernote | In Noted |
| --- | --- |
| Title | The file name |
| Created and updated dates | `created` and `modified` properties |
| Tags | a `tags` property |
| Source address, author | `source` and `author` properties |
| Text, headings, lists, tables, links | The same, as Markdown |
| Check boxes | A task list (`- [ ]`, `- [x]`) |
| Images | Stored once each in your attachments folder and shown in the note |
| Other files (PDF, audio, documents) | Stored in the attachments folder and linked by name, up to 100 MB each |

## What does not

- **Encrypted text** is not read (Evernote keeps it behind a passphrase). The note says where it was.
- **Styling Noted does not have**: colours, fonts and sizes are dropped; the words are kept.
- **A file you can only link**: a PDF or an audio recording is in your vault, next to your images, but Noted does not show
  it inside the note.
- **Anything over the size limits** (images over 25 MB, files over 100 MB) is left out and listed.
- Evernote's notebook stacks, reminders, saved searches and shared-note history are not part of an `.enex` file.

## The report

When the import ends, the dialog says how many notes were imported and how many have content that did not come across,
and a note `reports/Evernote import <date>.md` lists, note by note: content that did not come across, things that were
not imported, and where only styling was simplified. The `reports/` folder is left out of
[vault health](/guide/vault-health) checks.

A file that is not an Evernote export, or is cut short, is reported and skipped; the other files are still imported.
Big exports are fine: the file is read one note at a time (a 130 MB export of three thousand notes took about half a minute
on a recent laptop, and the process stayed near 500 MB at its peak, test harness included).
