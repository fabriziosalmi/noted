# Views

A **view** is a saved table over the properties of your notes. Every row is a note; a view is only a saved
question (which notes, which properties, in what order). There is no separate database: the properties are the YAML
block at the top of each note, and the view is kept in one small file in your vault.

```yaml
---
status: open
votes: 3
due: 2026-10-09
tags: [q4, ops]
done: true
---
```

## Making a view

In the sidebar, under the search box, the **Views** section lists your views. Press **+** to make one (it asks for a
name) and it opens in place of the note. Hover a view to **rename**, **duplicate** or **delete** it; deleting a view never
touches a note. The arrow at the top of the view takes you back to the note you had open.

The gear at the top right of a view opens its settings:

- **Source**: all notes, the notes under a folder (at any depth), or the notes with a tag.
- **Columns**: pick the properties to show. With none picked, the properties most notes have are shown. The note's name is
  always the first column, and opens the note.

Click a column header to sort by it: ascending, then descending, then not at all. Numbers sort by size, text without
caring about case (`item 9` comes before `item 10`), and notes with no value for the property always come last.

## Filtering and sorting

The funnel button opens **Filter & sort**; the number on it counts the filters and sort keys in use.

Each **filter** is a property, a test and a value. The tests offered depend on the property's type: *is*, *is not*,
*contains* for text; *is greater than*, *is at most*… for numbers; *is before*, *is after* for dates; *has* for lists;
*is checked* for checkboxes; and *is empty* for any. A choice property offers its values to pick from. All filters have
to pass for a note to show.

- A filter with no value yet hides nothing, so adding one never empties the view; it starts to filter when you fill it in.
- A note that does not have the property fails a positive test (*is*, *contains*, *is greater than*) and passes a negative
  one (*is not*, *does not contain*, *does not have*). An unchecked box and no box at all are the same thing.
- Dates compare as the day (`2026-10-09`), unless you give a time too.

**Sort** can have several keys: the next one settles ties in the one before. Clicking a column header sets the first key.

## What the app knows about a property

Noted works out each property's type from what the notes say, because there is no schema to declare:

| Type | When |
| --- | --- |
| Number | every value is a number |
| Date | every value looks like `2026-10-09` (a real day), optionally with a time |
| Checkbox | every value is `true` or `false` |
| List | a list in the YAML (`[a, b]`); a single word among lists counts as a list of one |
| Choice | a few different words (up to 5, or up to 20 when most repeat) |
| Text | anything else, including a property where notes disagree (numbers in some, words in others) |

An empty `key:` does not decide the type. A property that only some notes have is simply empty in the others.

## Where views are stored

In `.noted-views.json` at the top of the vault: plain, stably ordered JSON, so it is a small diff in Git and travels with
your notes when you sync. It is read defensively: if it is edited by hand or damaged, the views that are readable are
used and the rest are ignored; the file is never replaced until you change a view. A vault with no views has no file.
