import {buildPrompt} from './context.mjs';
import {estimateInput} from './tokens.mjs';
import {UserError} from './auth.mjs';
export function validateAuto(input){
  if(!input || ![4000,8000,16000].includes(input.budget) || !Array.isArray(input.candidates)||input.candidates.length>12 || !Array.isArray(input.history)||input.history.length>1000)throw new UserError('Auto 문맥 정보가 올바르지 않습니다.');
  for(const key of ['question','selection','fileName'])if(typeof input[key]!=='string')throw new UserError('질문과 문서 정보가 필요합니다.');
  if(!input.question.trim() || !Number.isInteger(input.startPage)||!Number.isInteger(input.endPage)||input.startPage<1||input.endPage<input.startPage)throw new UserError('선택 페이지가 올바르지 않습니다.');
  const seen=new Set();
  for(const page of input.candidates){if(!Number.isInteger(page.number)||page.number<1||seen.has(page.number)||typeof page.text!=='string'||page.text.length>14000)throw new UserError('후보 페이지가 올바르지 않습니다.');seen.add(page.number);}
  for(const entry of input.history)for(const key of ['question','selection','pageLabel','answer'])if(typeof entry[key]!=='string')throw new UserError('이전 대화가 올바르지 않습니다.');
  return input;
}
export function fitContext(input,numbers,direct){
  const make=pages=>buildPrompt({...input,pages});
  const size=pages=>estimateInput(make(pages).text,direct).tokens;
  if(size([])>input.budget)throw new UserError('질문·선택 문장·이전 대화만으로 Auto 예산을 넘었습니다. 이전 대화 포함량을 줄이거나 예산을 늘리세요.');
  const pages=[],omitted=[],clipped=[];
  // Original selected text is always present; selected pages have first priority.
  const pinned=input.candidates.filter(p=>p.number>=input.startPage && p.number<=input.endPage).map(p=>p.number);
  for(const number of [...new Set([...pinned,...numbers])]){
    const page=input.candidates.find(p=>p.number===number);if(!page)continue;
    if(size([...pages,page])<=input.budget){pages.push(page);continue;}
    let low=0,high=page.text.length;
    const excerpt=n=>({number,text:page.text.slice(0,n)+'\n[토큰 예산으로 이 페이지의 나머지 내용 생략]'});
    while(low<high){const mid=Math.ceil((low+high)/2);if(size([...pages,excerpt(mid)])<=input.budget)low=mid;else high=mid-1;}
    if(low>=300 && size([...pages,excerpt(low)])<=input.budget){pages.push(excerpt(low));clipped.push(number);}else omitted.push(number);
  }
  pages.sort((a,b)=>a.number-b.number);
  // Sorting changes boundary text slightly; never claim a budget that was exceeded.
  while(estimateInput(make(pages).text,direct).tokens>input.budget && pages.length)omitted.push(pages.pop().number);
  const final=make(pages);
  return {prompt:final.text,pageLabel:final.pageLabel,pages:pages.map(p=>p.number),estimate:estimateInput(final.text,direct),clipped,omitted};
}
