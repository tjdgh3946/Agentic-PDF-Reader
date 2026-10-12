import {App} from '@modelcontextprotocol/ext-apps';
import {linkQuestion} from '../link-question.mjs';
const app=new App({name:'Paper Reader Link',version:'0.2.0'},{});
const $=id=>document.getElementById(id);
let selection=null,busy=false,connected=false,sentId='';
function status(text){$('status').textContent=text;}
function controls(){
  $('send').disabled=!connected || busy || !selection || !$('question').value.trim() || sentId===selection.selectionId;
  $('refresh').disabled=!connected || busy;
}
function update(result){
  if(result.isError){status(result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n') || '요청에 실패했습니다.');return;}
  if(!Object.hasOwn(result.structuredContent || {},'selection'))return;
  const next=result.structuredContent.selection;
  const changed=next?.selectionId!==selection?.selectionId;
  selection=next;
  $('empty').hidden=!!selection;$('passage').hidden=!selection;
  if(selection){
    $('document').textContent=selection.fileName+' · p. '+selection.pages.join(', ');
    $('quote').textContent=selection.quote;
    if(changed)$('question').value=selection.question;
    $('save').disabled=!selection.allowSave;
    if(changed)$('save').checked=selection.allowSave;
    $('context').textContent=selection.pdfAvailable?'PDF 전체 검색 허용 · 질문에는 본문을 미리 붙이지 않습니다.':selection.context;
    $('context-size').textContent=selection.pdfAvailable?'PDF 전체 · 검색·이미지 도구로 읽기':'공유 문맥 · '+selection.context.length.toLocaleString()+'자';
    status(selection.saved?'PDF 주석 저장 완료 · 새 답변은 앱에서 문장을 다시 공유하세요.':sentId===selection.selectionId?'질문을 보냈습니다. 이 대화에서 후속 질문을 이어가세요.':'질문을 보내면 현재 ChatGPT 대화에서 답변합니다.');
  }else status('Paper Reader에서 문장을 선택하고 Link로 보내세요.');
  controls();
}
app.ontoolresult=update;
app.onhostcontextchanged=context=>{if(context.theme)document.documentElement.dataset.theme=context.theme;};
$('question').oninput=controls;
$('refresh').onclick=async()=>{
  busy=true;controls();status('선택 문장을 확인하고 있습니다…');
  try{update(await app.callServerTool({name:'get_selection',arguments:{}}));}
  catch{status('문장을 불러오지 못했습니다. Paper Reader와 터널 연결을 확인하세요.');}
  finally{busy=false;controls();}
};
$('form').onsubmit=async event=>{
  event.preventDefault();if($('send').disabled)return;
  const current=selection,question=$('question').value.trim(),save=$('save').checked&&current.allowSave;
  busy=true;controls();status('ChatGPT 대화에 질문을 보내고 있습니다…');
  try{
    // Revalidate the exact snapshot. A new selection must never redirect this answer.
    const check=await app.callServerTool({name:'get_selection',arguments:{selectionId:current.selectionId}});
    if(check.isError)throw new Error(check.content?.[0]?.text || '공유가 만료되었습니다.');
    const prompt=linkQuestion(current,question,save);
    const result=await app.sendMessage({role:'user',content:[{type:'text',text:prompt}]});
    if(result?.isError)throw new Error('ChatGPT가 메시지를 받지 못했습니다.');
    sentId=current.selectionId;status('질문을 보냈습니다. 이어지는 대화와 답변은 ChatGPT에서 확인하세요.');
  }catch(error){status((error.message || '전송을 확인하지 못했습니다.')+' 전송 전후 대화를 확인한 뒤 다시 시도하세요.');}
  finally{busy=false;controls();}
};
try{
  await app.connect();connected=true;
  const theme=app.getHostContext()?.theme;if(theme)document.documentElement.dataset.theme=theme;
  controls();if(!selection)await $('refresh').onclick();
}catch{status('ChatGPT의 Paper Reader Link 플러그인에서 이 카드를 열어 주세요.');}
