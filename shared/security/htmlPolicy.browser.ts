// Browser runtime entry for the shared HTML sanitization policy.
// dompurify's browser build is bound to the global window — no jsdom here, so
// this is safe to bundle into the Vite renderer.
import DOMPurify from 'dompurify';
import { makeStripUnsafeHtml, type DOMPurifyLike } from './htmlPolicy';

export const stripUnsafeHtml = makeStripUnsafeHtml(DOMPurify as unknown as DOMPurifyLike);
