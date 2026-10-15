import MarkdownIt from 'markdown-it';
import { katex } from '@mdit/plugin-katex';
import { renderToString } from 'katex';

// Model output and saved questions are untrusted text. Keep raw HTML disabled and
// let the math plugin render only with KaTeX's non-trusting defaults.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })
  .use(katex, { delimiters: 'all', throwOnError: false, trust: false });

// Older Link notes sometimes contain plain (e^{-lambda_i t}) after the model
// omitted TeX delimiters/backslashes. Recover only recognisable math at render
// time. The saved source, exports, prose parentheses and code stay untouched.
const legacyCommands=['alpha','beta','gamma','delta','theta','lambda','mu','sigma','phi','omega','Gamma','Delta','Theta','Lambda','Sigma','Phi','Omega','infty','mathrm','sqrt'];
function legacyFormula(source){
  if(!/[_^=]|\b(?:gamma|theta|lambda|Theta|infty)\b/.test(source)||source.length>500)return null;
  if(!/^[A-Za-z0-9_{}^=+\-*/.,\s|()]+$/.test(source))return null;
  const words=source.replace(/mathrm\{[A-Za-z ]+\}/g,'mathrm').match(/[A-Za-z]+/g)||[];
  if(words.some(word=>word.length>1&&!legacyCommands.includes(word)&&!legacyCommands.some(command=>word.length===command.length+1&&word.endsWith(command))))return null;
  return source.replace(/[A-Za-z]+/g,(word,offset)=>{
    // Text inside \mathrm{...} must remain text.
    const before=source.slice(0,offset);if(/mathrm\{[^}]*$/.test(before))return word;
    if(legacyCommands.includes(word))return '\\'+word;
    const command=legacyCommands.find(name=>word.length===name.length+1&&word.endsWith(name));
    return command?word[0]+'\\'+command:word;
  });
}
// Make '(' an inline boundary so the following math rule sees formulas inside
// a paragraph. These are MarkdownIt's normal text boundaries plus '('.
markdown.inline.ruler.at('text',(state,silent)=>{
  let end=state.pos;while(end<state.posMax&&!/[\n!#$%&(*+\-:<=>@\[\\\]^_`{}~]/.test(state.src[end]))end++;
  if(end===state.pos)return false;if(!silent)state.pending+=state.src.slice(state.pos,end);state.pos=end;return true;
});
markdown.inline.ruler.before('text','legacy_math',(state,silent)=>{
  const start=state.pos;if(state.src[start]!=='(')return false;
  let end=start+1,depth=1;
  for(;end<state.posMax&&end-start<=502;end++){
    const char=state.src[end];if(char==='\n')return false;
    if(char==='(')depth++;else if(char===')'&&!--depth)break;
  }
  if(depth)return false;
  const formula=legacyFormula(state.src.slice(start+1,end));if(!formula)return false;
  if(!silent){const token=state.push('legacy_math','',0);token.content=formula;}
  state.pos=end+1;return true;
});
markdown.renderer.rules.legacy_math=(tokens,index)=>renderToString(tokens[index].content,{throwOnError:false,trust:false,strict:false});

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
