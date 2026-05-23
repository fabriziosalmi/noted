// Shared renderer-side HTML sanitizer used before dangerouslySetInnerHTML.
// Mirrors the stricter backend sanitizer to reduce frontend/backend drift.
export function sanitizeHtml(html: string): string {
  let decoded = html;
  let lastDecoded: string;

  for (let i = 0; i < 3; i++) {
    lastDecoded = decoded;
    decoded = decoded
      .replace(/&amp;?/gi, '&')
      .replace(/&quot;?/gi, '"')
      .replace(/&apos;?/gi, "'")
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#([0-9]+);?/gi, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&Tab;?/gi, '\t')
      .replace(/&NewLine;?/gi, '\n')
      .replace(/&colon;?/gi, ':');
    if (decoded === lastDecoded) break;
  }

  let clean = decoded
    .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/<iframe\b[\s\S]*?(?:<\/iframe>|$)/gi, '')
    .replace(/<object\b[\s\S]*?(?:<\/object>|$)/gi, '')
    .replace(/<embed\b[\s\S]*?(?:<\/embed>|$)/gi, '')
    .replace(/<applet\b[\s\S]*?(?:<\/applet>|$)/gi, '')
    .replace(/<meta\b[\s\S]*?(?:<\/meta>|$)/gi, '')
    .replace(/<link\b[\s\S]*?(?:<\/link>|$)/gi, '');

  clean = clean
    .replace(/<\/?(?:script|iframe|object|embed|applet|meta|link)\b[^>]*(?:>|$)/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|applet|meta|link)\b/gi, '');

  clean = clean.replace(/(?:[\s/]+)\bon[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  /* eslint-disable no-control-regex */
  const jsRx = /j[\s\x00-\x20]*a[\s\x00-\x20]*v[\s\x00-\x20]*a[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t[\s\x00-\x20]*:/gi;
  const vbRx = /v[\s\x00-\x20]*b[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t[\s\x00-\x20]*:/gi;
  /* eslint-enable no-control-regex */

  return clean.replace(jsRx, '').replace(vbRx, '');
}
