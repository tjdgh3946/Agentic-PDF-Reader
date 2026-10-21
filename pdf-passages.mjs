import {UserError} from './auth.mjs';

export const CONTEXT_LIMITS={readCharacters:1600,maxReadCharacters:4000,searchHits:3,maxSearchHits:5,searchExcerptCharacters:220,queryCharacters:4000};
export function buildPassages(pages,breaks=[]){
  const passages=[];
  pages.forEach((text,index)=>{
    const boundaries=new Set([0,text.length,...(breaks[index]||[]).filter(n=>Number.isInteger(n)&&n>0&&n<text.length)]);
    for(const match of text.matchAll(/\n\s*\n/g))boundaries.add(match.index+match[0].length);
    const sorted=[...boundaries].sort((a,b)=>a-b),blocks=[];let number=0;
    for(let i=1;i<sorted.length;i++){
      let start=sorted[i-1],end=sorted[i];while(start<end&&/\s/.test(text[start]))start++;while(end>start&&/\s/.test(text[end-1]))end--;
      if(end<=start)continue;
      const value=text.slice(start,end),previous=blocks.at(-1),heading=/^(?:(?:Theorem|Lemma|Proposition|Corollary|Proof|Figure)\b|\d+(?:\.\d+)*\s+[A-Z])/i.test(value);
      // PDF.js may emit an equation's subscripts/superscripts as separate
      // lines. Rejoin small math fragments only when layout data is present.
      const mathFragment=value.length<110&&/[∫Θ⊗λ∂σθ∞‖→=<>]|^[\s\d.,()[\]{}+−-]+$/.test(value)||value.length<55&&/[〈〉·]/.test(value);
      if(breaks[index]?.length&&previous&&!heading&&mathFragment&&end-previous.start<=1200){previous.end=end;previous.text=text.slice(previous.start,end);}
      else blocks.push({start,end,text:value});
    }
    for(const block of blocks)passages.push({passageId:`p${index+1}.${++number}`,page:index+1,...block});
  });
  return passages;
}
const integer=(n,fallback,max,label)=>{n??=fallback;if(!Number.isSafeInteger(n)||n<1||n>max)throw new UserError(`${label}: 1~${max} 범위로 지정하세요.`);return n;};
// Offsets address the exact extracted UTF-16 source, with surrogate-safe cuts.
const cut=(text,n)=>n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n])?n-1:n;
export function createPassageReader(snapshotId,pages,breaks){
  const passages=buildPassages(pages,breaks),positions=new Map(passages.map((p,i)=>[p.passageId,i])),prefix=snapshotId.slice(0,16);
  const cursor=(index,offset,direction)=>index>=0&&index<passages.length?`${prefix}:${passages[index].passageId}:${offset}:${direction}`:null;
  function locate(id){const index=positions.get(id);if(index===undefined)throw new UserError('문단 ID를 찾지 못했습니다. search_pdf로 다시 검색하세요.');return index;}
  function read(args={},expanding=false){
    const maxCharacters=integer(args.maxCharacters,CONTEXT_LIMITS.readCharacters,CONTEXT_LIMITS.maxReadCharacters,'본문 길이');
    if(maxCharacters<128)throw new UserError('본문 길이는 128자 이상으로 지정하세요.');
    let index,offset=0,direction='after',indices;
    if(expanding){
      const parts=typeof args.cursor==='string'?args.cursor.split(':'):[];
      if(parts.length!==4||parts[0]!==prefix||!/^\d+$/.test(parts[2])||!['before','after'].includes(parts[3]))throw new UserError('확장 커서가 이 PDF 고정본과 일치하지 않습니다. 다시 검색·읽기 하세요.');
      index=locate(parts[1]);offset=Number(parts[2]);direction=parts[3];
      if(!Number.isSafeInteger(offset)||offset<0||offset>passages[index].text.length||cut(passages[index].text,offset)!==offset)throw new UserError('확장 커서의 본문 위치가 올바르지 않습니다.');
      if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>180)throw new UserError('추가 문맥이 필요한 이유를 180자 이내로 적으세요.');
      if(direction==='after'&&offset===passages[index].text.length){index++;offset=0;}
      if(direction==='before'&&offset===0){index--;offset=index>=0?passages[index].text.length:0;}
      if(index<0||index>=passages.length)throw new UserError('이 방향에는 더 읽을 본문이 없습니다.');
      indices=[index];
    }else{
      if(Boolean(args.passageId)===Boolean(args.pages))throw new UserError('passageId 또는 pages 중 하나만 지정하세요.');
      if(args.passageId)indices=[locate(args.passageId)];
      else{
        if(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>3||args.pages.some(p=>!Number.isInteger(p)||p<1||p>pages.length))throw new UserError('유효한 PDF 페이지를 한 번에 최대 3개 지정하세요.');
        indices=[...new Set(args.pages)].map(page=>passages.findIndex(p=>p.page===page)).filter(i=>i>=0);
      }
    }
    const output=[];let remaining=maxCharacters;
    for(const i of indices){
      if(!remaining)break;
      const passage=passages[i],source=passage.text;
      const desired=Math.max(0,offset-remaining),safeStart=cut(source,desired);
      const from=direction==='before'?(safeStart<desired?desired+1:desired):offset;
      const end=direction==='before'?offset:cut(source,Math.min(source.length,offset+remaining));
      const text=source.slice(from,end);if(!text.length)continue;
      output.push({page:passage.page,passageId:passage.passageId,start:passage.start+from,end:passage.start+end,text,paragraphComplete:from===0&&end===source.length,continuesBefore:from>0,continuesAfter:end<source.length,
        before:from>0||i>0?cursor(i,from,'before'):null,
        after:end<source.length?cursor(i,end,'after'):i+1<passages.length?cursor(i,end,'after'):null});
      remaining-=text.length;offset=0;
    }
    const emptyPages=!expanding&&args.pages?args.pages.filter(page=>!passages.some(p=>p.page===page)):[];
    return {pages:output,...(emptyPages.length?{emptyPages,advice:'스캔 페이지는 render_pdf_page로 확인하세요.'}:{}),characters:output.reduce((n,p)=>n+p.text.length,0),maxCharacters,omittedRequestedPages:!expanding&&args.pages?args.pages.filter(page=>!emptyPages.includes(page)&&!output.some(p=>p.page===page)):[],readingUnit:'heuristic-paragraph'};
  }
  return {passages,read:args=>read(args),expand:args=>read(args,true)};
}
