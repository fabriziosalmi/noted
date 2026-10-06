# Tasks

Every `- [ ]` and `- [x]` item in your notes is a task, and the **Tasks** page (at the top of the Views section in the sidebar)
lists them all in one place: the open ones, soonest due first.

```markdown
- [ ] write the draft 📅 2026-10-10 #work
- [x] outline
- [ ] review due:: 2026-10-20
```

A task has a due date when it carries one the way the Tasks and Dataview plugins write it: `📅 2026-10-10`, `due:: 2026-10-10` or
`[due:: 2026-10-10]` (a date that does not exist, such as 30 February, is not a date). Tasks inside fenced code and in the
frontmatter are ignored, and nested items are listed too.

## The page

- **Status**: open (the default), done, or all.
- **Due**: any date, overdue (open tasks due before today), today, the next 7 days, or no date.
- **Folder** (at any depth), **Tag**, and a text search. A tag counts when the task has it or when its note has it; a tag written in
  one task does not make the note's other tasks carry it.
- The list follows the notes: save a note, tick a task in another, change a file outside the app, and the page updates.

Tick the box and the task is ticked **in its note**: that one character changes and the rest of the file stays as it was; the
version before is kept in the note's history. If the note was edited since the page listed it so that the line is not that task
any more, nothing is changed and you are told. The note's name opens the note.

Tasks are read from **Markdown notes**; in an older HTML vault the page says so (convert the vault in
Settings → Editor → Note format).

## For agents

The MCP server has `list_tasks` with the same filters (`status`, `folder`, `tag`, `due_from`, `due_to`, `overdue`, `no_due`,
`text`, `limit`); each task comes back with its note and line, which is what `edit_note` needs to change it. See the
[MCP server reference](/reference/mcp-server).
