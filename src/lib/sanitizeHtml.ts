import { stripUnsafeHtml } from '../../shared/security/htmlPolicy';

// Renderer alias of the shared cross-runtime sanitization policy.
export function sanitizeHtml(html: string): string {
  return stripUnsafeHtml(html);
}
