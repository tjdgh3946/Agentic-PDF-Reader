import {setTimeout as delay} from 'node:timers/promises';
import {isChatGPTPage} from './web-panel-policy.mjs';

// Runs only in the embedded ChatGPT page. No credentials or response text leave it.
export function composerAction(action,text,requestId){
  const visible=element=>{
    if(!element || !element.getClientRects().length)return false;
    const style=typeof getComputedStyle==='function'?getComputedStyle(element):null;
    return !style || (style.visibility!=='hidden' && style.visibility!=='collapse' && style.opacity!=='0');
  };
  // Chromium's contenteditable blocks can add blank lines to innerText.
  const normalize=value=>value.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b\ufeff]/g,'').replace(/\n+/g,'\n').trim();
  // ChatGPT keeps selected plugins as non-editable inline mentions. Their
  // labels are configuration, not a draft. Only omit explicit app mentions;
  // ordinary text (including a typed plugin name) must still block overwrites.
  // Sent bubbles keep the app:// marker but omit contenteditable="false".
  const appMention='[data-prompt-link-href^="app://"]';
  const contentText=element=>{
    if(!element)return '';
    if(!element.querySelector?.(appMention))return element.innerText || '';
    const copy=element.cloneNode(true);
    for(const mention of copy.querySelectorAll(appMention))mention.remove();
    // Detached innerText loses rendered block boundaries. Recreate those
    // boundaries in the copy without changing the live editor or its chips.
    for(const br of copy.querySelectorAll('br'))br.replaceWith('\n');
    for(const block of copy.querySelectorAll('p,div,li'))block.append('\n');
    return copy.textContent || '';
  };
  const editors=document.querySelectorAll('#prompt-textarea,#prompt-textarea [contenteditable="true"],#mobile-composer-prompt,textarea[data-mobile-composer-prompt],textarea[name="prompt"],[contenteditable="true"][role="textbox"]');
  const editor=[...editors].find(element=>visible(element) && (element.isContentEditable || element.tagName==='TEXTAREA') && !element.disabled && !element.readOnly && element.getAttribute('aria-readonly')!=='true');
  const editable=!!editor;
  const draft=editable?normalize(editor.tagName==='TEXTAREA'?editor.value:contentText(editor)):'';
  const form=editor?.form || editor?.closest?.('form');
  const stopped=[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="응답 중지"],button[aria-label="생성 중단하기"]')].some(visible) || [...document.querySelectorAll('button[data-composer-submit]')].some(button=>visible(button) && button.getAttribute('data-stop-label') && button.getAttribute('aria-label')===button.getAttribute('data-stop-label')) || !!form && [...form.querySelectorAll('button')].some(button=>visible(button) && /(?:^Stop\b|중지|중단)/i.test(button.getAttribute('aria-label')||''));
  const messages=[...document.querySelectorAll('[data-message-author-role="user"],[data-user-message-bubble]')];
  const last=messages.at(-1);
  // Desktop bubbles also contain "더 보기" controls. Compare the actual message
  // content, not the surrounding bubble's labels and action buttons.
  const message=last?.querySelector?.('.whitespace-pre-wrap') || last;
  const messageText=contentText(message);
  const sent=!!last && (normalize(messageText)===normalize(text) || (text.includes('선택 ID: '+requestId) && messageText.includes('선택 ID: '+requestId)));
  // Current desktop ChatGPT uses a ProseMirror editor and a localized form
  // submit button without the legacy id/data-testid. Keep the lookup in that form.
  const scope=form || document;
  const selector='button[data-composer-submit],button[data-testid="send-button"],button#composer-submit-button,button[aria-label="Send prompt"],button[aria-label="Send message"],button[aria-label="Send"],button[aria-label="프롬프트 전송"],button[aria-label="메시지 보내기"],button[aria-label="보내기"]';
  const buttons=[...scope.querySelectorAll(selector+(form?',button[type="submit"],input[type="submit"]':''))].filter(visible);
  const button=buttons.find(button=>!button.disabled && button.getAttribute('aria-disabled')!=='true');
  const submitReason=!editable?'composer_missing':stopped?'streaming':draft!==normalize(text)?'input_changed':!buttons.length?'button_missing':!button?'button_disabled':null;
  if(action==='inspect')return {editable,hasDraft:!!draft,stopped,sent,submitReason};
  if(action==='focus'){
    if(!editable || draft || stopped)return false;
    editor.focus();
    if(editor.isContentEditable && document.createRange && document.getSelection){
      const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
      const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
    }
    return document.activeElement===editor;
  }
  if(action==='submit'){
    if(submitReason)return false;
    button.click();return true;
  }
  return false;
}

export function createWebSender({getContents,isAttached,wait=delay,attempts=30}){
  let sending=false;
  const sentIds=new Map();
  return async({text,requestId})=>{
    if(typeof text!=='string' || !text.trim() || text.length>200000 || typeof requestId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId))throw new Error('전송할 질문을 다시 준비하세요.');
    if(sentIds.has(requestId)){
      if(sentIds.get(requestId)==='sent')return {sent:true,duplicate:true};
      throw new Error('전송 결과를 확인하지 못했습니다. 오른쪽 대화를 확인한 뒤 새 질문으로 다시 준비하세요.');
    }
    if(sending)throw new Error('질문을 전송 중입니다. 완료될 때까지 기다려 주세요.');
    const contents=getContents();
    if(!contents || contents.isDestroyed() || !isAttached() || !isChatGPTPage(contents.getURL()) || contents.isLoading())throw new Error('오른쪽 ChatGPT 웹을 열고 로그인과 페이지 로딩을 완료하세요.');
    sending=true;
    const url=contents.getURL();
    const inspect=action=>contents.executeJavaScript(`(${composerAction.toString()})(${JSON.stringify(action)},${JSON.stringify(text)},${JSON.stringify(requestId)})`);
    const unchanged=()=>!contents.isDestroyed() && isAttached() && contents.getURL()===url && !contents.isLoading();
    try{
      const state=await inspect('inspect');
      if(state.sent){sentIds.set(requestId,'sent');return {sent:true,duplicate:true};}
      if(state.stopped)throw new Error('ChatGPT가 답변 중입니다. 답변이 끝난 뒤 보내세요.');
      if(!state.editable)throw new Error('ChatGPT 입력창을 찾지 못했습니다. 로그인 상태를 확인하거나 질문을 복사해 직접 보내세요.');
      if(state.hasDraft)throw new Error('오른쪽 ChatGPT 입력창에 작성 중인 내용이 있습니다. 먼저 전송하거나 비워 주세요.');
      if(!unchanged() || !await inspect('focus'))throw new Error('ChatGPT 입력창 상태가 변경되었습니다. 질문을 다시 준비하세요.');
      if(!unchanged())throw new Error('ChatGPT 대화가 변경되었습니다. 질문을 다시 준비하세요.');
      contents.focus();await contents.insertText(text);
      let submitted=false;
      for(let attempt=0;attempt<attempts;attempt++){
        if(!unchanged())throw new Error('ChatGPT 대화가 변경되었습니다. 입력된 질문을 확인해 직접 전송하세요.');
        sentIds.set(requestId,'unknown');
        if(sentIds.size>100)sentIds.delete(sentIds.keys().next().value);
        if(await inspect('submit')){submitted=true;break;}
        sentIds.delete(requestId);
        await wait(100);
      }
      if(!submitted){
        const current=await inspect('inspect');
        if(current.sent){sentIds.set(requestId,'sent');return {sent:true};}
        const reasons={
          button_missing:'질문은 입력됐지만 ChatGPT 전송 버튼을 찾지 못했습니다. 오른쪽의 보내기 버튼으로 직접 전송하세요.',
          button_disabled:'질문은 입력됐지만 ChatGPT 전송 버튼이 비활성화되어 있습니다. 오른쪽 화면의 로딩·안내를 확인한 뒤 직접 전송하세요.',
          input_changed:'오른쪽 ChatGPT 입력 내용이 준비한 질문과 달라 자동 전송을 중단했습니다. 내용을 확인해 직접 전송하세요.',
          streaming:'ChatGPT가 답변 중이라 자동 전송을 중단했습니다. 답변이 끝난 뒤 오른쪽에서 전송하세요.',
          composer_missing:'질문 입력 후 ChatGPT 입력창이 변경되었습니다. 오른쪽 화면을 확인해 직접 전송하세요.'
        };
        throw new Error(reasons[current.submitReason] || '질문을 입력했지만 자동 전송을 완료하지 못했습니다. 오른쪽 입력창에서 확인해 직접 전송하세요.');
      }
      // A click may have sent the message even if the page stops responding. Never retry it.
      for(let attempt=0;attempt<attempts;attempt++){
        if(contents.isDestroyed() || !isChatGPTPage(contents.getURL()))break;
        if((await inspect('inspect')).sent){sentIds.set(requestId,'sent');return {sent:true};}
        await wait(100);
      }
      throw new Error('전송 버튼을 눌렀지만 결과를 확인하지 못했습니다. 중복 전송을 피하려면 오른쪽 대화를 먼저 확인하세요.');
    }finally{sending=false;}
  };
}
