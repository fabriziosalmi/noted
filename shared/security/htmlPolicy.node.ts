// Node runtime entry for the shared HTML sanitization policy.
// Creates a DOMPurify instance backed by a jsdom window. Used by Electron main
// (via ipc-utils) and the MCP server — never reached by the renderer bundle.
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { makeStripUnsafeHtml, type DOMPurifyLike } from './htmlPolicy.js';

const factory = createDOMPurify as unknown as (window: unknown) => DOMPurifyLike;
const purify = factory(new JSDOM('').window);

export const stripUnsafeHtml = makeStripUnsafeHtml(purify);
