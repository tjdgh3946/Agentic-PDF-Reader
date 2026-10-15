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

test('renders legacy Link formulas without modifying source or ordinary prose/code',()=>{
  const source='## 왜 속도가 달라지는가?\n\n오차 (e^{-lambda_i t}), (|g_t|_{p_{mathrm{in}}}=0.5e^{-lambda_2 t}), (Theta^{(4)}(x_0,x)), (0.5e^{-alambda_2t}), (n=infty).';
  const html=markdownHtml(source);
  assert.equal((html.match(/class="katex"/g)||[]).length,5);
  assert.match(html,/\\lambda/);assert.match(html,/\\mathrm\{in\}/);assert.match(html,/\\Theta/);
  assert.match(source,/e\^\{-lambda_i t\}/);
  const plain=markdownHtml('일반 문장 (for example), (PDF p. 8), (ChatGPT), (a), ` (e^{-lambda_i t}) `\n\n```text\n(e^{-lambda_i t})\n```');
  assert.doesNotMatch(plain,/class="katex"/);assert.match(plain,/\(for example\)/);assert.match(plain,/<code>\(e\^\{-lambda_i t\}\)<\/code>/);
});
