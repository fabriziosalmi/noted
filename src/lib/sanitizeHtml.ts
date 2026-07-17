import { stripUnsafeHtml } from '../../shared/security/htmlPolicy.browser';

// Renderer alias of the shared cross-runtime sanitization policy.
export function sanitizeHtml(html: string): string {
  return stripUnsafeHtml(html);
}
