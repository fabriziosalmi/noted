# Notes from a source

**File → Note from a web page or text…** (or the button above the note list) turns a
web page, or text you paste, into a short note in `sources/`: a summary, the key
points, where it came from, and the notes of yours that it is near. You read it
before anything is written.

## How it goes

1. Give it a **web address**, or paste **text** (and, if you like, a title).
2. For an address, Noted fetches the page and keeps its readable part: the article,
   without menus, footers, scripts and advertisements. Your model then writes a
   title, a short summary and a few key points, in the language of the source.
3. Noted looks in your vault for notes the source is near (by words, and by meaning
   if [embeddings](/guide/ai#retrieval-rag) are on) and suggests links to them.
4. You see the summary, can change the title, and **keep or drop each suggested
   link** (the same review as for an AI rewrite). **Create note** writes it and
   opens it.

The note looks like this:

```markdown
---
type: source
source: https://example.com/post
source_hash: sha256:9f2c…
retrieved_at: 2026-10-07T10:00:00.000Z
model: lmstudio/qwen3
---
# How teams plan a quarter

## Summary

Teams write the plan down, review risks and name an owner for each goal.

## Key points

- Write the plan
- Review the risks

## Related

- [[Planning]]: Goals

## Source

<https://example.com/post>
```

`source_hash` is the hash of the text that was read, so you can tell later whether a
page has changed since; `model` says what wrote the summary. They are ordinary
properties, so a [view](/guide/views) can list your sources by date or model. The
full text of the page is **not** stored in the note, only its summary.

## Only with a model on this computer

The dialog has **Only with a model on this computer**: with it on, nothing is
fetched or sent unless the model is Ollama, LM Studio, or a gateway at an address on
your own network (`localhost`, `.local`, or a private address such as `192.168.…`).
With a cloud model it stops and says so. The setting is remembered.

[PII masking](/guide/ai#pii-masking) applies as to any request: with a cloud model, personal data
in the text is masked before it is sent.

## What it will not fetch

Noted fetches the page itself, and a web address is something a page can lie about,
so it refuses what leads into your machine or your network: `localhost`, private and
link-local addresses (including the cloud-metadata address), addresses that merely
wrap one of those, and anything that redirects there. The check is made on the
address actually connected to, at every redirect. It also refuses addresses with a
user name or password, pages over 5 MB, pages that take more than 20 seconds, and
anything that is not a web page or plain text. Cookies and logins are not sent, so a
page behind a login is not readable: paste its text instead.

## Limits

- **PDFs are not read yet** (a PDF address says so). Reading them needs a PDF
  library that is also what the PDF viewer ([#92](https://github.com/fabriziosalmi/noted/issues/92)) will need; they will
  come together.
- The model is shown the first 12,000 characters of a long source, cut at a
  paragraph, and the note says when that happened. Pages are kept up to 200,000
  characters.
- Pages built entirely by scripts have no text to read, since nothing in the page is
  run.
- The summary is a model's: read it before you create the note, and check it against
  the source if it matters.
