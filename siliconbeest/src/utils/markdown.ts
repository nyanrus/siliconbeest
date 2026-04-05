import { marked } from 'marked';

// Configure marked for safe rendering — no HTML passthrough
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown to sanitized HTML.
 * Strips raw HTML tags to prevent script injection.
 */
export function renderMarkdown(input: string): string {
  if (!input) return '';
  // Strip any raw HTML tags before parsing to prevent XSS
  const stripped = input.replace(/<[^>]*>/g, '');
  return marked.parse(stripped) as string;
}
