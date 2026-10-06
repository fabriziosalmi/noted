/** Fill `{name}` placeholders in a translated template. A placeholder with no value is left as it is, so a gap is visible. */
export function fillTemplate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
