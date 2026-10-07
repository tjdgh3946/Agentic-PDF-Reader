import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownHtml } from '../markdown-renderer.mjs';

test('renders question and answer Markdown with tables and math', () => {
  const html = markdownHtml('# 제목\n\n- **핵심**\n- `code`\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\\(x^2\\)\n\n\\[a+b\\]');
  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<li><strong>핵심<\/strong><\/li>/);
  assert.match(html, /<li><code>code<\/code><\/li>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
});

test('does not execute raw HTML or load remote Markdown images', () => {
  const html = markdownHtml('<img src=x onerror=alert(1)>\n\n![remote](https://example.com/image.png)\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)');
  assert.doesNotMatch(html, /<img\b|href="javascript:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /remote/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
