// Pure, runtime-agnostic HTML sanitization policy shared across the renderer
// (browser DOMPurify), Electron main, and the MCP server (jsdom DOMPurify).
//
// This module imports NOTHING at runtime, so both Vite (browser) and esbuild
// (node) can bundle it safely. The concrete DOMPurify instance is injected by
// the thin runtime entries htmlPolicy.browser.ts / htmlPolicy.node.ts, so the
// policy can never drift between processes — there is one source of truth for
// the tag allowlist and the attribute hook, right here.

export interface SanitizeAttributeHookEvent {
  attrName: string;
  attrValue: string;
}

export interface DOMPurifyLike {
  addHook(
    hook: 'uponSanitizeAttribute',
    cb: (node: { removeAttribute(name: string): void }, data: SanitizeAttributeHookEvent) => void,
  ): void;
  sanitize(dirty: string, config: object): string;
}

// Single source of truth for the tag allowlist / blocklist.
export const SANITIZE_CONFIG = {
  ADD_TAGS: ['body', 'html', 'head', 'meta', 'link'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'applet'],
} as const;

// Neutralize obfuscated javascript/vbscript/data:text/html protocols on
// url-bearing attributes. Registered once per DOMPurify instance.
export function configureDOMPurify(purify: DOMPurifyLike): void {
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'href' || data.attrName === 'src' || data.attrName === 'action') {
      // Strip control chars, whitespace, null bytes and unicode replacement chars before matching.
      // eslint-disable-next-line no-control-regex
      const normalized = data.attrValue.replace(/[\x00-\x20\x7F\s\uFFFD]/g, '').toLowerCase();
      if (
        normalized.includes('javascript:') ||
        normalized.includes('vbscript:') ||
        normalized.includes('data:text/html')
      ) {
        // Remove the attribute entirely to prevent execution.
        node.removeAttribute(data.attrName);
      }
    }
  });
}

// Bind a stripUnsafeHtml() to an injected, configured DOMPurify instance.
export function makeStripUnsafeHtml(purify: DOMPurifyLike): (html: string) => string {
  configureDOMPurify(purify);
  return (html: string): string => {
    if (typeof html !== 'string') return '';
    return purify.sanitize(html, SANITIZE_CONFIG);
  };
}
