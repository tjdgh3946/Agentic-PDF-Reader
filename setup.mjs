const $=id=>document.getElementById(id),bridge=window.paperDesktop;
let showingLogin=false,busy=false,polling=false;
const status=message=>$('setup-status').textContent=message;
const fail=error=>status(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));
const setupURLs={tunnels:'https://platform.openai.com/settings/organization/tunnels',keys:'https://platform.openai.com/api-keys',plugins:'https://chatgpt.com/plugins',tunnelDocs:'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels',pluginDocs:'https://developers.openai.com/api/docs/guides/custom-mcp-server'};
const external=kind=>bridge?.setupExternal?bridge.setupExternal(kind).catch(fail):window.open(setupURLs[kind],'_blank','noopener,noreferrer');
async function refresh({preserveInput=false}={}){
  const value=await bridge.setupState();
  if(!preserveInput)$('tunnel-id').value=value.link.tunnelId||'';$('start-saved').hidden=!value.link.hasSavedKey;
  $('stop-saved').hidden=!value.link.running;$('stop-saved').disabled=busy||value.link.busy;
  $('runtime-key').required=!value.link.hasSavedKey;
  $('key-hint').textContent=value.link.hasSavedKey?'암호화된 키가 있습니다. 같은 터널을 사용하면 키 입력을 비워두세요.':'키는 Windows 계정 기준으로 암호화해 이 PC에 저장합니다.';
  $('link-status').textContent=value.link.message+(value.link.health==='auth_required'?' · 터널 인증 실패: 조직·키 권한을 확인하세요.':value.link.health==='reconnecting'?' · 네트워크 자동 재연결 중':value.link.health==='unreachable'?' · 터널 상태 확인 실패':value.link.health==='waiting'?' · 연결 준비 또는 복구 중':value.link.health==='ready'?' · 로컬 준비 확인됨 (ChatGPT 도구 호출 성공 여부는 별도)':'');
  return value;
}
async function choose(choice){await bridge.setupChoice(choice);if(choice==='now'){$('choices').hidden=true;$('connection').hidden=false;}}
for(const id of ['defer','later'])$(id).onclick=()=>choose('later').catch(fail);
$('now').onclick=()=>choose('now').catch(fail);$('done').onclick=()=>choose('done').catch(fail);
async function layout(){
  if(!bridge)return;const r=$('setup-chatgpt').getBoundingClientRect();
  await bridge.setWebPanel({visible:showingLogin&&!$('setup-guide').open,x:r.x,y:r.y,width:r.width,height:r.height});
}
$('login').onclick=async()=>{showingLogin=true;await layout();await bridge.webCommand('focus');};
window.addEventListener('resize',()=>layout().catch(fail));document.querySelector('.setup-copy').addEventListener('scroll',()=>layout().catch(fail));
for(const id of ['tunnels','plugins'])$(id).onclick=()=>external(id);
for(const button of document.querySelectorAll('[data-guide]'))button.onclick=async()=>{
  const dialog=$('setup-guide');
  if(!dialog.open)dialog.showModal();
  await layout().catch(fail);
  const step=$('guide-'+button.dataset.guide);step.scrollIntoView({block:'start'});step.focus({preventScroll:true});
};
$('guide-close').onclick=()=>$('setup-guide').close();
$('setup-guide').addEventListener('close',()=>layout().catch(fail));
for(const button of document.querySelectorAll('[data-external]'))button.onclick=()=>external(button.dataset.external);
async function operate(action){
  if(busy)return;busy=true;status('연결 설정을 처리하고 있습니다. 새 설정은 연결 확인 후 저장됩니다. 잠시 기다려 주세요.');for(const id of ['save-link','start-saved','stop-saved','runtime-key','tunnel-id','done','defer','login'])$(id).disabled=true;
  try{await action();await refresh();}catch(error){fail(error);await refresh({preserveInput:true}).catch(()=>{});}
  finally{busy=false;$('runtime-key').value='';for(const id of ['save-link','start-saved'])$(id).disabled=false;}
}
$('link-form').onsubmit=event=>{event.preventDefault();operate(()=>bridge.setupLink({tunnelId:$('tunnel-id').value.trim(),key:$('runtime-key').value}));};
$('stop-saved').onclick=()=>operate(()=>bridge.setupStopLink());
$('start-saved').onclick=()=>operate(()=>bridge.setupStartLink());
if(!bridge?.setupState){
  for(const button of document.querySelectorAll('button,input'))if(!button.matches('[data-guide],[data-external],#guide-close'))button.disabled=true;
  status('인증 설정은 설치된 Agentic PDF Reader 데스크톱 창에서 열어주세요.');
  $('link-status').textContent='데스크톱 앱에서 설정할 수 있습니다.';
}else{
  if(new URLSearchParams(location.search).get('welcome')==='1'){$('choices').hidden=false;$('connection').hidden=true;}
  await refresh().catch(fail);await layout().catch(fail);
}

if(bridge?.setupState)setInterval(async()=>{if(busy||polling||document.hidden)return;polling=true;try{await refresh({preserveInput:true});}catch{}finally{polling=false;}},2000);
