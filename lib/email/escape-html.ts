// Braces are escaped as well: Brevo evaluates {{ }} and {% %} in the HTML it is sent.
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '{': '&#123;',
  '}': '&#125;',
};

/** Makes a value show as text in an email's HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'{}]/g, (character) => ENTITIES[character]);
}
