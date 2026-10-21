// Real Chromium regression check for ChatGPT's retained inline plugin mentions.
// Run: npx electron scripts/web-send-dom-check.mjs
import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {imageRecoveryQuestion} from '../link-question.mjs';
import {composerAction,createWebSender} from '../web-panel-send.mjs';

async function check(){
await app.whenReady();
const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
const contents=window.webContents;
const mention='<span contenteditable="false" data-prompt-link-href="app://paper-reader-link" app-mention-name="paper-reader-link">Paper Reader Link</span>';
try{
  await contents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><form><div contenteditable="true" role="textbox"><p>${mention} </p></div><button type="submit">Send</button></form><section id="messages"></section><script>
    const editor=document.querySelector('[role="textbox"]');
    document.querySelector('form').onsubmit=event=>{
      event.preventDefault();
      const bubble=document.createElement('div');bubble.dataset.messageAuthorRole='user';
      const body=document.createElement('div');body.className='whitespace-pre-wrap';body.innerHTML=editor.innerHTML;
      for(const chip of body.querySelectorAll('[data-prompt-link-href]'))chip.removeAttribute('contenteditable');
      bubble.append(body);document.querySelector('#messages').append(bubble);
      editor.innerHTML=${JSON.stringify('<p>'+mention+' </p>')};
    };
  </script>`));
  const inspect=(action,text='',id='test')=>contents.executeJavaScript(`(${composerAction.toString()})(${JSON.stringify(action)},${JSON.stringify(text)},${JSON.stringify(id)})`,true);
  assert.equal((await inspect('inspect')).hasDraft,false,'A plugin chip alone must not block sending');
  const send=createWebSender({getContents:()=>({
    getURL:()=> 'https://chatgpt.com/c/local-fixture',isDestroyed:()=>contents.isDestroyed(),isLoading:()=>false,
    focus:()=>{},insertText:text=>contents.executeJavaScript(`document.execCommand('insertText',false,${JSON.stringify(text)})`,true),executeJavaScript:script=>contents.executeJavaScript(script,true)
  }),isAttached:()=>true,wait:async()=>{},attempts:2});
  for(const [index,text] of ['첫 질문: Figure 1을 설명하세요.\n두 번째 줄입니다.','후속 질문: Paper Reader Link라는 이름도 본문에 있습니다.'].entries()){
    assert.equal((await send({text,requestId:'plugin-question-'+index})).sent,true);
    assert.equal((await inspect('inspect')).hasDraft,false,'The retained plugin after a response is not a draft');
    assert.equal(await contents.executeJavaScript('document.querySelectorAll("form [data-prompt-link-href]").length'),1,'Sending must preserve the selected plugin');
  }
  assert.equal(await contents.executeJavaScript('document.querySelectorAll("[data-message-author-role=user]").length'),2);
  const messages=await contents.executeJavaScript('[...document.querySelectorAll("[data-message-author-role=user]")].map(e=>e.innerText)');
  assert.ok(messages[1].includes('후속 질문'),'The second question must not overwrite the plugin chip');
  await contents.executeJavaScript(`document.querySelector('[role="textbox"]').innerHTML=${JSON.stringify('<p>'+mention+' 작성 중인 실제 질문</p>')}`);
  assert.equal((await inspect('inspect')).hasDraft,true);
  await assert.rejects(send({text:'Overwrite attempt',requestId:'real-draft'}),/작성 중/);
  await contents.executeJavaScript(`document.querySelector('[role="textbox"]').innerHTML='<p>Paper Reader Link</p>'`);
  assert.equal((await inspect('inspect')).hasDraft,true,'A typed plugin name is ordinary draft text');
  await contents.executeJavaScript(`document.querySelector('[role="textbox"]').innerHTML='<p><span contenteditable="false">Unsent attachment or quotation</span></p>'`);
  assert.equal((await inspect('inspect')).hasDraft,true,'Other non-editable content must not be discarded');
  await assert.rejects(send({text:'이미지 재확인',requestId:'blocked-recovery'}),/작성 중/);
  await contents.executeJavaScript(`document.querySelector('[role="textbox"]').innerHTML=${JSON.stringify('<p>'+mention+' </p>')}`);
  const selection={selectionId:'11111111-1111-4111-8111-111111111111',fileName:'ntk.pdf',pages:[9],pdfAvailable:true,question:'Figure 3(c)를 읽어주세요.',quote:'',allowSave:false};
  const question=imageRecoveryQuestion(selection);
  assert.equal((await send({text:question,requestId:'same-chat-image-recovery'})).sent,true);
  assert.equal((await send({text:question,requestId:'same-chat-image-recovery'})).duplicate,true);
  assert.equal(await contents.executeJavaScript('document.querySelectorAll("[data-message-author-role=user]").length'),3);
  assert.equal(await contents.executeJavaScript('document.querySelectorAll("form [data-prompt-link-href]").length'),1);
  assert.ok((await contents.executeJavaScript('document.querySelector("#messages").innerText')).includes('content_items'));
  await contents.executeJavaScript('document.querySelector("form button").disabled=true');
  const retry={text:'전송 버튼 복구 후 같은 질문을 보내세요.',requestId:'retry-owned-draft'};
  await assert.rejects(send(retry),/비활성화/);
  assert.equal((await inspect('inspect',retry.text,retry.requestId)).draftMatches,true);
  await contents.executeJavaScript('document.querySelector("form button").disabled=false');
  assert.equal((await send(retry)).sent,true);
  assert.equal((await send(retry)).duplicate,true);
  assert.equal(await contents.executeJavaScript('document.querySelectorAll("[data-message-author-role=user]").length'),4);
  console.log(JSON.stringify({result:'pass',consecutiveSends:4,pluginPreserved:true,multilineAcknowledged:true,realDraftProtected:true,recoveryAttachmentProtected:true,sameConversationRecovery:true,recoveryDuplicateSuppressed:true,disabledButtonRecovery:true,ownedDraftNotReinserted:true}));
}catch(error){console.error(error);process.exitCode=1;}
finally{window.destroy();app.quit();}
}
check().catch(error=>{console.error(error);process.exitCode=1;app.quit();});
