import MarkdownIt from 'markdown-it';
import { katex } from '@mdit/plugin-katex';

// Model output and saved questions are untrusted text. Keep raw HTML disabled and
// let the math plugin render only with KaTeX's non-trusting defaults.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })
  .use(katex, { delimiters: 'all', throwOnError: false, trust: false });

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, index, options);
};

// Do not load remote images from a model response or a saved question.
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);

export function markdownHtml(source) {
  return markdown.render(String(source || ''));
}

export function renderMarkdown(element, source) {
  element.innerHTML = markdownHtml(source);
}
