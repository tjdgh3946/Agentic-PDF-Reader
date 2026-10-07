import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieveCandidates,queryKind,selectorPrompt,parseSelection} from '../auto-context.mjs';
import {fitContext,validateAuto} from '../auto-budget.mjs';
import {createAppServer} from '../server.mjs';
import {createSettings} from '../settings.mjs';
const input=()=>({fileName:'test.pdf',question:'How is watermark robustness evaluated?',selection:'watermark',startPage:1,endPage:1,history:[],budget:4000,candidates:[{number:1,text:'Abstract watermarking method'},{number:7,text:'Evaluation robustness benchmark results'}]});
test('Auto retrieves distant relevant pages and distinguishes local versus broad queries',()=>{
  const pages=Array.from({length:30},(_,i)=>({number:i+1,text:i===25?'watermark robustness ablation evaluation':'unrelated background'}));
  assert.ok(retrieveCandidates(pages,'robustness ablation','watermark',1,1).candidates.some(p=>p.number===26));
  assert.equal(queryKind('선택 문장을 번역해 주세요'),'translation');
  assert.equal(queryKind('논문 전체를 요약해 줘'),'broad');
  assert.equal(retrieveCandidates(pages,'문장을 쉽게 설명','quote',1,1).needsAgent,false);
});
test('Agent can select only known pages; selector sees bounded excerpts, not full PDF',()=>{
  const data=input();data.candidates[0].text='x'.repeat(14000);
  assert.ok(selectorPrompt(data).length<5000);
  assert.deepEqual(parseSelection('{"pages":[7,1],"reason":"근거"}',data.candidates).numbers,[7,1]);
  assert.throws(()=>parseSelection('{"pages":[999],"reason":"injection"}',data.candidates));
  assert.throws(()=>parseSelection('{"pages":["7"],"reason":"wrong"}',data.candidates));
});
test('Budget includes history, never duplicates page, and marks truncated/omitted pages',()=>{
  const data=input();data.candidates[0].text='한국어 논문의 상세 근거. '.repeat(900);
  const result=fitContext(validateAuto(data),[1,7,1],true);
  assert.ok(result.estimate.tokens<=4000);assert.equal(new Set(result.pages).size,result.pages.length);
  assert.ok(result.clipped.length || result.omitted.length);assert.match(result.prompt,/생략/);
  data.history=[{question:'q',selection:'s',pageLabel:'p1',answer:'많은 이전 대화 내용 '.repeat(5000)}];
  assert.throws(()=>fitContext(data,[1],true),/이전 대화/);
});
test('Local Auto never calls model; explicit agent selection is gated by mode and validated',async t=>{
  let origin,calls=0;const settings=await createSettings();
  const auth={activeRequests:new Set(),async inference(model,prompt){calls++;assert.ok(prompt.includes('문맥 선택 작업'));return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"pages":[7],"reason":"평가 결과가 있는 페이지"}'})+'\n\ndata: {"type":"response.completed"}\n\n');}};
  const server=createAppServer(auth,{settings,getOrigin:()=>origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(r=>server.close(r)));
  const post=body=>fetch(origin+'/api/auto-context',{method:'POST',headers:{Origin:origin,'X-Paper-Reader':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  const local=await(await post(input())).json();assert.equal(local.source,'local');assert.equal(calls,0);
  assert.equal((await post({...input(),model:'mock',useAgent:true})).status,409);assert.equal(calls,0);
  await settings.set({mode:'plan'});const agent=await(await post({...input(),model:'mock',useAgent:true})).json();assert.equal(agent.source,'agent');assert.deepEqual(agent.pages,[1,7]);assert.equal(calls,1);
  assert.equal((await fetch(origin+'/auto-budget.mjs')).status,404);
});
