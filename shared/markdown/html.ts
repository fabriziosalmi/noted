// Document <-> HTML, for the stretches of the app that still speak HTML (the editor is fed and read as
// HTML; ADR 0001's migration keeps that wire format and changes only what is on disk). Both directions go
// through the same schema as the Markdown codec, so a note read from Markdown shows the editor exactly the
// document the file describes. The DOM is passed in: the renderer has one, the tests use jsdom.
import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode, type Schema } from '@tiptap/pm/model';

export interface DomEnv {
  document: Document;
  DOMParser: typeof DOMParser;
}

export function docToHtml(doc: PMNode, env: Pick<DomEnv, 'document'>): string {
  const fragment = DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content, { document: env.document });
  const holder = env.document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
}

export function htmlToDoc(html: string, schema: Schema, env: Pick<DomEnv, 'DOMParser'>): PMNode {
  const body = new env.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  // Whitespace is content in a Markdown note ("a  b", and a line break inside a paragraph): keep it.
  return PMDOMParser.fromSchema(schema).parse(body, { preserveWhitespace: 'full' });
}
