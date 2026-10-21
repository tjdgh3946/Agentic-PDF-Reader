import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';
import {WINDOW_OPTIONS,HISTORY_OPTIONS} from './context.mjs';

export async function createSettings(file) {
  let current={mode:'manual',pdfWindow:'near1',historyTurns:3,linkSaveAnswer:false};
  if(file) {
    try {
      const saved=JSON.parse(await readFile(file,'utf8'));
      if(['manual','plan'].includes(saved?.mode)) current.mode=saved.mode;
      if(['link','clipboard'].includes(saved?.manualDelivery))current.manualDelivery=saved.manualDelivery;
      if(WINDOW_OPTIONS.includes(saved?.pdfWindow))current.pdfWindow=saved.pdfWindow;
      if([4000,8000,16000].includes(saved?.autoBudget))current.autoBudget=saved.autoBudget;
      if(HISTORY_OPTIONS.includes(saved?.historyTurns))current.historyTurns=saved.historyTurns;
      if(Number.isInteger(saved?.panelWidth) && saved.panelWidth>=360 && saved.panelWidth<=1200)current.panelWidth=saved.panelWidth;
      for(const key of ['pdfSearch','linkAllowSave','linkSaveAnswer'])if(typeof saved?.[key]==='boolean')current[key]=saved[key];
    } catch(error) {
      if(error.code!=='ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  let saving=Promise.resolve();
  return {
    get:()=>({...current}),
    set(input) {
      if(!input || (input.mode!==undefined && !['manual','plan'].includes(input.mode)) || (input.mode===undefined && input.panelWidth===undefined && input.pdfSearch===undefined && input.linkAllowSave===undefined && input.linkSaveAnswer===undefined)) throw new UserError('질문 모드를 선택하세요.');
      for(const key of ['pdfSearch','linkAllowSave','linkSaveAnswer'])if(input[key]!==undefined&&typeof input[key]!=='boolean')throw new UserError('PDF 공유 설정을 확인하세요.');
      if(input.panelWidth!==undefined && (!Number.isInteger(input.panelWidth) || input.panelWidth<360 || input.panelWidth>1200))throw new UserError('대화 너비는 360~1200 사이여야 합니다.');
      if(input.pdfWindow!==undefined && !WINDOW_OPTIONS.includes(input.pdfWindow))throw new UserError('PDF 문맥 범위를 선택하세요.');
      if(input.historyTurns!==undefined && !HISTORY_OPTIONS.includes(input.historyTurns))throw new UserError('이전 대화 범위를 선택하세요.');
      if(input.autoBudget!==undefined && ![4000,8000,16000].includes(input.autoBudget))throw new UserError('Auto 토큰 예산을 선택하세요.');
      if(input.manualDelivery!==undefined && !['link','clipboard'].includes(input.manualDelivery))throw new UserError('ChatGPT 전달 방식을 선택하세요.');
      const operation=saving.then(async()=>{
        const next={...current,...(input.mode!==undefined?{mode:input.mode}:{}),...(input.panelWidth!==undefined?{panelWidth:input.panelWidth}:{}),...(input.autoBudget!==undefined?{autoBudget:input.autoBudget}:{}),...(input.pdfWindow!==undefined?{pdfWindow:input.pdfWindow}:{}),...(input.historyTurns!==undefined?{historyTurns:input.historyTurns}:{})};
        if(input.manualDelivery!==undefined)next.manualDelivery=input.manualDelivery;
        for(const key of ['pdfSearch','linkAllowSave','linkSaveAnswer'])if(input[key]!==undefined)next[key]=input[key];
        if(file) {
          await mkdir(path.dirname(file),{recursive:true});
          await writeFile(file+'.tmp',JSON.stringify(next,null,2)+'\n','utf8');
          await rename(file+'.tmp',file);
        }
        current=next;
        return {...current};
      });
      saving=operation.catch(()=>{});
      return operation;
    }
  };
}
