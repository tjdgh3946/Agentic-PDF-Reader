import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebSender,composerAction} from '../web-panel-send.mjs';
import {linkQuestion} from '../link-question.mjs';

function fixture(options={}){
  let url='https://chatgpt.com/c/existing-conversation',submitted=0,inserted=0;
  const contents={getURL:()=>url,isDestroyed:()=>false,isLoading:()=>false,focus(){},
    async insertText(){inserted++;if(options.navigateAfterInput)url='https://auth.openai.com/login';},
    async executeJavaScript(script){
      const action=script.match(/\)\("(inspect|focus|submit)",/)[1];
      if(action==='focus')return true;
      if(action==='submit'){if(options.noSubmit)return false;submitted++;if(options.submitError)throw new Error('Navigation interrupted the result');return true;}
      return {editable:true,hasDraft:false,stopped:false,sent:submitted>0&&!options.noAck,...options.state};
    }};
  return {send:createWebSender({getContents:()=>contents,isAttached:()=>true,wait:async()=>{},attempts:2}),get inserted(){return inserted;},get submitted(){return submitted;},get url(){return url;}};
}
const input={text:'Translate the shared passage.',requestId:'selection-1'};

test('current ChatGPT textarea, submit control and user bubble work with a hidden legacy editor',()=>{
  const previous=globalThis.document;
  const element=(tag,attributes={},visible=true)=>({tagName:tag,getClientRects:()=>visible?[{}]:[],getAttribute:name=>attributes[name]??null});
  const hidden={...element('DIV',{},false),isContentEditable:true};
  const textarea={...element('TEXTAREA'),value:'',focus(){document.activeElement=this;}};
  let clicked=0,message=null;
  const attributes={'aria-label':'메시지 보내기','data-stop-label':'생성 중단하기'};
  const button={...element('BUTTON',attributes),click(){clicked++;message={innerText:textarea.value};textarea.value='';}};
  globalThis.document={activeElement:null,querySelectorAll(selector){
    if(selector.includes('#mobile-composer-prompt'))return [hidden,textarea];
    if(selector.includes('[data-user-message-bubble]'))return message?[message]:[];
    if(selector.startsWith('button[data-testid="stop-button"]'))return [];
    if(selector.includes('button[data-composer-submit]'))return [button];
    return [];
  }};
  try{
    assert.equal(composerAction('inspect',input.text,input.requestId).editable,true);
    assert.equal(composerAction('focus',input.text,input.requestId),true);
    assert.equal(document.activeElement,textarea);
    textarea.value='Existing draft';assert.equal(composerAction('inspect',input.text,input.requestId).hasDraft,true);
    assert.equal(composerAction('focus',input.text,input.requestId),false);
    textarea.value=input.text;attributes['aria-label']='생성 중단하기';
    assert.equal(composerAction('inspect',input.text,input.requestId).stopped,true);
    assert.equal(composerAction('submit',input.text,input.requestId),false);assert.equal(clicked,0);
    attributes['aria-label']='메시지 보내기';assert.equal(composerAction('submit',input.text,input.requestId),true);
    assert.equal(composerAction('inspect',input.text,input.requestId).sent,true);assert.equal(clicked,1);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('uses the enabled send button belonging to the editor instead of a disabled duplicate',()=>{
  const previous=globalThis.document;let clicked=0;
  const visible={getClientRects:()=>[{}],getAttribute:()=>null};
  const duplicate={...visible,disabled:true,click(){throw new Error('Wrong send button');}};
  const send={...visible,disabled:false,click(){clicked++;}};
  const form={querySelectorAll:()=>[send]};
  const editor={...visible,tagName:'TEXTAREA',value:input.text,closest:()=>form};
  globalThis.document={querySelectorAll(selector){
    if(selector.includes('#mobile-composer-prompt'))return [editor];
    if(selector.includes('[data-user-message-bubble]')||selector.startsWith('button[data-testid="stop-button"]'))return [];
    if(selector==='button[data-composer-submit]')return [];
    return [duplicate,send];
  }};
  try{assert.equal(composerAction('submit',input.text,input.requestId),true);assert.equal(clicked,1);}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('contenteditable nonbreaking spaces are equivalent to the spaces inserted by Electron',()=>{
  const previous=globalThis.document;let clicked=0;
  const text='Neural  tangent kernel\n한글 질문';
  const element={getClientRects:()=>[{}],getAttribute:()=>null};
  const editor={...element,tagName:'DIV',isContentEditable:true,innerText:'Neural\u00a0\u00a0tangent kernel\n한글 질문'};
  const button={...element,click(){clicked++;}};
  globalThis.document={querySelectorAll(selector){
    if(selector.includes('#mobile-composer-prompt'))return [editor];
    if(selector.includes('[data-user-message-bubble]')||selector.startsWith('button[data-testid="stop-button"]'))return [];
    if(selector==='button[data-composer-submit]')return [];
    return [button];
  }};
  try{assert.equal(composerAction('submit',text,input.requestId),true);assert.equal(clicked,1);assert.equal(editor.innerText,'Neural\u00a0\u00a0tangent kernel\n한글 질문');}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('current localized form submit works without a legacy button id or data-testid',()=>{
  const previous=globalThis.document;let clicked=0;
  const element={getClientRects:()=>[{}],getAttribute:()=>null};
  const button={...element,getAttribute:name=>name==='aria-label'?'보내기':name==='type'?'submit':null,click(){clicked++;}};
  const form={querySelectorAll:selector=>selector.includes('button[type="submit"]')?[button]:[]};
  const editor={...element,tagName:'DIV',isContentEditable:true,innerText:input.text,closest:()=>form};
  globalThis.document={querySelectorAll:selector=>selector.includes('#mobile-composer-prompt')?[editor]:[]};
  try{assert.equal(composerAction('inspect',input.text,input.requestId).submitReason,null);assert.equal(composerAction('submit',input.text,input.requestId),true);assert.equal(clicked,1);editor.innerText='A changed question';assert.equal(composerAction('submit',input.text,input.requestId),false);assert.equal(clicked,1);}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('failed readiness reports whether the button is missing, disabled, or the input changed',async()=>{
  for(const [submitReason,message] of [['button_missing',/버튼을 찾지/],['button_disabled',/비활성화/],['input_changed',/입력 내용/]]){
    const f=fixture({noSubmit:true,state:{submitReason}});await assert.rejects(f.send(input),message);assert.equal(f.inserted,1);assert.equal(f.submitted,0);
  }
});
test('acknowledges desktop message content without the surrounding 더 보기 controls',()=>{
  const previous=globalThis.document;
  const bubble={innerText:input.text+'\n…\n더 보기',querySelector:()=>({innerText:input.text})};
  globalThis.document={querySelectorAll:selector=>selector.includes('[data-user-message-bubble]')?[bubble]:[]};
  try{assert.equal(composerAction('inspect',input.text,input.requestId).sent,true);assert.equal(composerAction('inspect','A different message',input.requestId).sent,false);}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('localized stop controls in the composer protect the draft while a response streams',()=>{
  const previous=globalThis.document;let focused=false;
  const element={getClientRects:()=>[{}],getAttribute:()=>null};
  const stop={...element,getAttribute:name=>name==='aria-label'?'중지':null};
  const form={querySelectorAll:selector=>selector==='button'?[stop]:[]};
  const editor={...element,tagName:'DIV',isContentEditable:true,innerText:'',closest:()=>form,focus(){focused=true;}};
  globalThis.document={querySelectorAll:selector=>selector.includes('#mobile-composer-prompt')?[editor]:[]};
  try{assert.equal(composerAction('inspect',input.text,input.requestId).stopped,true);assert.equal(composerAction('focus',input.text,input.requestId),false);assert.equal(focused,false);}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('desktop send keeps the conversation and makes repeated requests idempotent',async()=>{
  const f=fixture();assert.equal((await f.send(input)).sent,true);
  assert.equal((await f.send(input)).duplicate,true);
  assert.equal(f.inserted,1);assert.equal(f.submitted,1);assert.equal(f.url,'https://chatgpt.com/c/existing-conversation');
});
test('drafts, streaming responses and missing composers block sending without editing',async()=>{
  for(const state of [{hasDraft:true},{stopped:true},{editable:false}]){
    const f=fixture({state});await assert.rejects(f.send(input));assert.equal(f.inserted,0);assert.equal(f.submitted,0);
  }
});
test('a navigation during input prevents submission to a different page',async()=>{
  const f=fixture({navigateAfterInput:true});await assert.rejects(f.send(input),/대화가 변경/);assert.equal(f.submitted,0);
});
test('an uncertain submission is never automatically retried',async()=>{
  for(const options of [{noAck:true},{submitError:true}]){
    const f=fixture(options);await assert.rejects(f.send(input));await assert.rejects(f.send(input));assert.equal(f.submitted,1);assert.equal(f.inserted,1);
  }
});
test('invalid IPC questions never reach the web page',async()=>{
  const f=fixture();for(const bad of [{text:''},{requestId:'../../file'},{text:'a'.repeat(200001)}])await assert.rejects(f.send({...input,...bad}));assert.equal(f.inserted,0);
});
test('desktop and card questions preserve the exact selection and save permission',()=>{
  const selection={selectionId:'selection-1',fileName:'paper.pdf',pages:[7],question:'번역해줘',quote:'Source passage',context:'Context',allowSave:true};
  assert.match(linkQuestion(selection),/선택 ID: selection-1/);assert.match(linkQuestion(selection),/save_annotation/);
  assert.match(linkQuestion({...selection,allowSave:false}),/PDF에 저장하지 마세요/);
  assert.ok(linkQuestion(selection).includes(JSON.stringify({quote:selection.quote,context:selection.context})));
});
