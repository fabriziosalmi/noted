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

## The board

The two buttons at the top of a view switch between the **table** and the **board**. A board has a column for each value of a
property (set with **Group by** in the view's settings, or chosen when the board is first opened), and a card for each note;
a card shows the note's name and, small, the columns you picked. Click a card to open the note.

**Moving a card changes the property in the note**: drag it to another column, or use the menu on the card (it shows when you
hover or focus the card, so it works from the keyboard too). Dropping on **No value** removes the property. The cards of a
column follow the view's sort and filters.

- A column exists for every value the notes have, the most used first. The columns you keep come first, in your order: **Keep
  this column** (the pin) keeps one, the arrows move it, **Add column** makes one for a value no note has yet, and an empty
  kept column can be removed. Moving a card keeps all the columns that were showing, so a column you emptied does not vanish.
- A property that holds a **list** (like tags) puts a note in every column it has, so its cards cannot be moved there; change
  them from the table.
- The same safety as the table applies: only that property is rewritten, and a note changed elsewhere is not overwritten.

## Editing in the table

A cell is the property in the note's file, so changing a cell changes the note. Double-click a cell, or move to it and press
**Enter**, to edit it: **Enter** (or clicking away) keeps the change, **Esc** drops it. A checkbox toggles with one click.
What you type is read for the property's type: a number field takes a number, a list takes comma-separated items, and an
empty cell removes the property from the note.

Only the one property is rewritten, in the note's own text: its comments, quoting style, order and spacing, and everything
else in the file, stay exactly as they were. A property that was quoted stays quoted; a list written `[a, b]` stays on
one line and one written as a dash list stays that way. The version before each change is kept in the note's history.

If the note was changed somewhere else since you last looked (by a sync, another program, or by hand), the cell is not
written: it shows the value the file has now, and says so. Notes whose properties the app cannot edit faithfully (broken
YAML, a property with an anchor or a nested mapping) are left alone and the change is refused with a message.

The note's name and modified date are not editable here.

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
