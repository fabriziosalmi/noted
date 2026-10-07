# Vault health

**Vault health** (in the sidebar, under Tasks) checks the whole vault and lists
what is worth looking at: links that lead nowhere, notes nothing leads to, notes
that say the same thing, notes nobody has touched for a long time. It reads what
Noted already knows about your notes; it changes nothing until you press a fix, and
**no AI model takes part in any check**: the same vault gives the same list.

## What it looks for

| Finding | What it means | Fixes |
|---|---|---|
| **Broken links** | A `[[link]]` names a note that does not exist. If an existing note is a likely match (a typo, or the same name apart from case and accents) it is offered. | **Use *Note*** points every link to the missing name at that note; **Create the note** makes it (with its folders). |
| **Links to a missing heading** | The note exists, but has no such heading (`[[Plan#Risks]]`). | Open the note to correct the link or add the heading. |
| **Isolated notes** | Nothing links to them and they link to nothing. Daily notes (`2026-10-07…`) and notes in `Archive/` are left out. | Open. |
| **Identical notes** | The same text (case and spacing aside). | **Keep the oldest, trash the others**, after asking. |
| **Near duplicates** | Notes that share nearly all their text: 80% of the runs of four words, so a few words changed in a long note. Boilerplate that a template puts in dozens of notes does not count. | Open both. |
| **Notes with the same name** | Two notes called `Notes` in different folders: a link to the bare name can mean either. | Open. |
| **Not touched for a long time** | Not edited for a year (change it at the top of the page: 90 days to 2 years). | **Archive** moves it to `Archive/` (links are updated), where it is not reported again. |
| **Empty notes** | No text. | **Move to the trash**, after asking. |
| **Long notes without a summary** | 200 words or more and no `summary`, `description`, `abstract` or `tldr` property. | **Suggest a summary** (below). |

Trashing sends the note to the system trash, so it can be taken back from there.

## The one thing a model does

**Suggest a summary** asks your configured model for one or two sentences about the
note (the text of the note is sent, masked first if [PII masking](/guide/ai#pii-masking)
is on and the model is a cloud one). The answer appears in a box that you can edit;
**Save as summary** writes it into the note's `summary` property, nothing else.
Without a model the button says so.

## Saving the report as a note

**Save as a note** writes `reports/Vault health YYYY-MM-DD.md`: the findings,
grouped, each note a link you can click. A name that does not exist is written as
plain text, not as a link. The fixes are on the page, not in the note. Running it
again on the same day replaces that day's note.

The report does not disturb the next check: notes under `reports/` are not checked
(they are not stale, nor duplicates of the last report, nor broken links), and the
links in them do not make the notes they list look connected.

## Limits

- Blocks (`[[Note#^id]]`) are not checked, only headings.
- A note too large to be read is listed at the bottom and not checked.
- Near duplicates need notes of at least 20 words, and a note that is a partial copy
  of another (the same paragraphs inside a longer note) is not found: the measure
  is the share of runs of words in common, not containment.
- It is a snapshot of the indexes at that moment; **Check again** takes a new one.
