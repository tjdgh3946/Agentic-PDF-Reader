import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export async function readInstallationChoice(file){
  if(!file)return null;
  try{
    const text=await readFile(file,'utf8'),mode=text.match(/^mode=(now|later)\s*$/m)?.[1],version=text.match(/^version=([\d.]+)\s*$/m)?.[1];
    return mode&&version?{mode,version}:null;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function createOnboarding(file){
  let current={version:1,decision:'pending',installationVersion:null};
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.version===1&&['pending','deferred','complete'].includes(saved.decision))current={...current,...saved};}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  let writing=Promise.resolve();
  const save=next=>{
    const operation=writing.then(async()=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(next)+'\n',{mode:0o600});await rename(file+'.tmp',file);current=next;return {...current};});
    writing=operation.catch(()=>{});return operation;
  };
  return {
    state:()=>({...current}),
    async startup({commandChoice,installationChoice}={}){
      const choice=['now','later'].includes(commandChoice)?commandChoice:installationChoice?.version!==current.installationVersion?installationChoice?.mode:null;
      if(choice)await save({...current,decision:choice==='now'?'pending':'deferred',installationVersion:installationChoice?.version||current.installationVersion});
      return {showSetup:current.decision==='pending',showChoices:!choice&&current.decision==='pending'};
    },
    async decide(choice){
      if(!['now','later','done'].includes(choice))throw Error('설정 선택을 확인하세요.');
      return save({...current,decision:{now:'pending',later:'deferred',done:'complete'}[choice]});
    },
    flush:()=>writing
  };
}
