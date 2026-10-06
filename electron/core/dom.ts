import type { DomEnv } from '../../shared/markdown/html';

let env: DomEnv | null = null;

/** A DOM for parsing HTML in the main process, made once and only when something needs it (jsdom is slow to load). */
export async function dom(): Promise<DomEnv> {
  if (!env) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    env = { document: window.document, DOMParser: window.DOMParser as unknown as typeof DOMParser };
  }
  return env;
}
