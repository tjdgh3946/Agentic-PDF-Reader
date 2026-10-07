import {PAPER_INSTRUCTIONS} from './tokens.mjs';
import {randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {createRemoteJWKSet, jwtVerify} from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class UserError extends Error {
  constructor(message, status = 400) {super(message); this.status = status;}
}

export async function createAuth({directory, origin, fetcher = fetch, jwks, clock = Date.now}) {
  const getOrigin = () => typeof origin === 'function' ? origin() : origin;
  await mkdir(directory,{recursive:true, mode:0o700});
  const metadataPath = path.join(directory,'registration.json');
  let metadata;
  try {metadata = JSON.parse(await readFile(metadataPath,'utf8'));}
  catch (error) {if(error.code !== 'ENOENT') throw error; metadata={hostId:`urn:uuid:${randomUUID()}`,profiles:[]};}
  let saveQueue = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(metadata,null,2);
    saveQueue = saveQueue.catch(()=>{}).then(async()=>{
      await writeFile(metadataPath+'.tmp',snapshot,{mode:0o600});
      await rename(metadataPath+'.tmp',metadataPath);
    });
    return saveQueue;
  }
  await save();
  const transactions = new Map(), tickets = new Map();
  let active = null, refreshing = null, revision = 0, authError = '', lastResult = '', catalog = [];
  const activeRequests = new Set();
  const keySet = jwks || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  let discovery;
  async function configuration() {
    if(discovery) return discovery;
    const response = await fetcher(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new UserError('OpenAI 인증 서버에 연결하지 못했습니다. 다시 시도하세요.',502);
    const result = await response.json();
    if(result.issuer !== ISSUER || result.authorization_endpoint !== `${ISSUER}/api/accounts/authorize` || result.token_endpoint !== `${ISSUER}/api/accounts/oauth/token` || result.jwks_uri !== `${ISSUER}/.well-known/jwks.json`) throw new UserError('인증 서버 설정을 검증하지 못했습니다.',502);
    if(result.revocation_endpoint && new URL(result.revocation_endpoint).origin !== ISSUER) throw new UserError('인증 서버 설정이 올바르지 않습니다.',502);
    discovery = result; return result;
  }
  function expire() {
    for(const [key,value] of transactions) if(value.expires <= clock()) transactions.delete(key);
    for(const [key,value] of tickets) if(value.expires <= clock()) tickets.delete(key);
  }
  function abortRequests() {for(const controller of activeRequests) controller.abort(); activeRequests.clear(); catalog=[];}
  function info() {
    expire();
    return {
      connected:!!active, planEnabled:!!active?.scopes.includes('chatgpt.tokens.use.direct'),
      account:active ? {email:active.email,name:active.name,profileId:active.profileId} : null,
      profiles:metadata.profiles.map(p=>({id:p.id,label:p.email || p.name || `등록 ${p.id.slice(0,6)}`,suffix:p.client_id.slice(-6)})),
      pending:transactions.size>0 || tickets.size>0,error:authError,result:lastResult,
      storage:'session-only'
    };
  }
  async function start(profileId) {
    expire();
    if(transactions.size + tickets.size >= 10) throw new UserError('진행 중인 로그인 요청이 많습니다. 잠시 후 다시 시도하세요.');
    const profile = profileId && profileId !== 'new' ? metadata.profiles.find(p=>p.id===profileId) : null;
    if(profileId && profileId !== 'new' && !profile) throw new UserError('저장된 계정 등록을 찾을 수 없습니다.');
    await configuration();
    authError=''; lastResult='';
    const ticket = random();
    tickets.set(ticket,{profile,expires:clock()+10*60*1000});
    return `${getOrigin()}/auth/launch?ticket=${ticket}`;
  }
  function launch(ticket) {
    const pending = tickets.get(ticket); tickets.delete(ticket);
    if(!pending || pending.expires<=clock()) throw new UserError('로그인 링크가 만료되었습니다. 앱에서 다시 연결하세요.');
    const state = random(), verifier = random(), nonce = random(), browserSession = random();
    const tx = {state,verifier,nonce,browserSession,profile:pending.profile,expires:clock()+10*60*1000,redirectUri:`${getOrigin()}/auth/callback`};
    transactions.set(state,tx);
    const params = new URLSearchParams({
      client_id:tx.profile?.client_id || 'dynamic_agent_client',
      ext_agent_host_id:metadata.hostId,response_type:'code',redirect_uri:tx.redirectUri,
      scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',
      code_challenge:createHash('sha256').update(verifier).digest('base64url')
    });
    if(!tx.profile) params.set('agent_name_hint','Paper Reader');
    return {url:`${discovery.authorization_endpoint}?${params}`,cookie:`paper_reader_oauth=${browserSession}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`};
  }
  async function tokenRequest(body) {
    const config = await configuration();
    const response = await fetcher(config.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(body),signal:AbortSignal.timeout(20000)});
    if(!response.ok) {
      if(response.status===400 || response.status===401) throw new UserError('로그인 승인이 만료되었거나 거절되었습니다. 같은 등록으로 다시 로그인하세요.',401);
      throw new UserError(`OpenAI 인증 요청이 실패했습니다 (HTTP ${response.status}). 다시 시도하세요.`,502);
    }
    return response.json();
  }
  async function callback(params,cookie) {
    const state=params.get('state'), tx=transactions.get(state);
    if(!tx || tx.expires<=clock() || !same(tx.browserSession,cookie)) throw new UserError('로그인 요청을 확인할 수 없습니다. 앱에서 다시 연결하세요.');
    transactions.delete(state);
    const callbackRevision=revision;
    try {
      if(params.has('error')) throw new UserError(params.get('error')==='access_denied' ? '로그인 또는 구독 사용 승인이 취소되었습니다.' : 'OpenAI에서 로그인을 완료하지 못했습니다.');
      const code=params.get('code'), returnedId=params.get('client_id');
      if(!code) throw new UserError('인증 코드가 없습니다. 다시 로그인하세요.');
      if(tx.profile && returnedId && returnedId !== tx.profile.client_id) throw new UserError('계정 등록 정보가 일치하지 않습니다.');
      const clientId=tx.profile?.client_id || returnedId;
      if(!clientId || clientId==='dynamic_agent_client' || !/^[A-Za-z0-9_-]{1,200}$/.test(clientId)) throw new UserError('앱 등록이 완료되지 않았습니다. 다시 로그인하세요.');
      // Keep an issued client ID even when code exchange fails; never reuse a code.
      let profile=tx.profile;
      if(!profile) {profile={id:randomUUID(),client_id:clientId,subject:null};metadata.profiles.push(profile);await save();}
      const tokens=await tokenRequest({grant_type:'authorization_code',client_id:clientId,code,code_verifier:tx.verifier,redirect_uri:tx.redirectUri,resource:RESOURCE});
      if(typeof tokens.id_token!=='string') throw new UserError('인증 서버에서 계정 증명을 받지 못했습니다.');
      let identity;
      try {
        ({payload:identity}=await jwtVerify(tokens.id_token,keySet,{issuer:ISSUER,audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce'],clockTolerance:5}));
        if(!same(identity.nonce,tx.nonce) || typeof identity.sub!=='string' || !identity.sub) throw new Error('Invalid identity');
        if(profile.subject && profile.subject!==identity.sub) throw new Error('Different account');
      } catch {throw new UserError('계정 서명을 검증하지 못했습니다. 로그인 정보는 사용하지 않았습니다.');}
      if(callbackRevision!==revision) throw new UserError('로그인 중 계정 연결이 변경되었습니다. 다시 시도하세요.');
      profile.subject=identity.sub; profile.email=typeof identity.email==='string'?identity.email:''; profile.name=typeof identity.name==='string'?identity.name:'';
      await save();
      if(callbackRevision!==revision) throw new UserError('로그인 중 계정 연결이 변경되었습니다. 다시 시도하세요.');
      abortRequests(); revision++;
      const scopes=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[];
      active={profileId:profile.id,clientId,subject:identity.sub,email:profile.email,name:profile.name,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,idToken:tokens.id_token,scopes,expires:clock()+Math.max(0,Number(tokens.expires_in)||0)*1000};
      if(typeof active.accessToken!=='string') active.scopes=[];
      authError=''; lastResult='connected';
      return info();
    } catch(error) {authError=error instanceof UserError?error.message:'로그인 처리 중 오류가 발생했습니다. 다시 시도하세요.';throw new UserError(authError);}
  }
  async function accessToken() {
    if(!active) throw new UserError('먼저 ChatGPT에 로그인하세요.',401);
    if(!active.scopes.includes('chatgpt.tokens.use.direct')) throw new UserError('이 연결에 ChatGPT 구독 사용 권한이 없습니다. ChatGPT 설정에서 권한을 확인하세요.',403);
    if(active.expires>clock()+60000) return active.accessToken;
    if(!active.refreshToken) throw new UserError('로그인이 만료되었습니다. 다시 연결하세요.',401);
    if(!refreshing) {
      const current=active,currentRevision=revision;
      refreshing=(async()=>{
        const tokens=await tokenRequest({grant_type:'refresh_token',client_id:current.clientId,refresh_token:current.refreshToken,resource:RESOURCE});
        if(revision!==currentRevision || active!==current) throw new UserError('계정 연결이 변경되었습니다. 다시 시도하세요.',401);
        if(typeof tokens.access_token!=='string') throw new UserError('로그인을 갱신하지 못했습니다. 다시 연결하세요.',401);
        active={...current,accessToken:tokens.access_token,refreshToken:tokens.refresh_token || current.refreshToken,idToken:tokens.id_token || current.idToken,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):current.scopes,expires:clock()+Math.max(0,Number(tokens.expires_in)||0)*1000};
        if(!active.scopes.includes('chatgpt.tokens.use.direct')) throw new UserError('ChatGPT 구독 사용 권한을 다시 확인하세요.',403);
        return active.accessToken;
      })().finally(()=>{refreshing=null;});
    }
    return refreshing;
  }
  async function models() {
    const currentRevision=revision;
    const token=await accessToken();
    const response=await fetcher(`${RESOURCE}/models`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new UserError(`사용 가능한 모델을 가져오지 못했습니다 (HTTP ${response.status}).`,response.status===401?401:502);
    const data=await response.json();
    if(revision!==currentRevision) throw new UserError('계정 연결이 변경되었습니다.',401);
    catalog=(data.models || []).filter(m=>m.visibility==='list' && typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name || m.slug}));
    return catalog;
  }
  async function inference(model,input,signal) {
    if(!catalog.some(m=>m.id===model)) throw new UserError('사용 가능한 모델을 먼저 선택하세요.');
    const currentRevision=revision,token=await accessToken();
    if(revision!==currentRevision) throw new UserError('계정 연결이 변경되었습니다.',401);
    return fetcher(`${RESOURCE}/responses`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({model,input:[{role:'user',content:input}],instructions:PAPER_INSTRUCTIONS,store:false,stream:true}),signal});
  }
  async function logout() {
    const previous=active;
    active=null;revision++;abortRequests();transactions.clear();tickets.clear();lastResult='signed-out';authError='';
    let revoked=!previous?.refreshToken;
    if(previous?.refreshToken) {
      try {
        const config=await configuration();
        if(config.revocation_endpoint) {
          for(let attempt=0;attempt<2;attempt++) {
            const response=await fetcher(config.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:previous.refreshToken,token_type_hint:'refresh_token',client_id:previous.clientId}),signal:AbortSignal.timeout(10000)});
            if(response.ok) {revoked=true;break;}
            if(response.status<500) break;
          }
        }
      } catch {}
    }
    return {revoked,message:revoked?'로그아웃했습니다.':'이 PC에서는 로그아웃했습니다. 원격 연결 해지는 확인하지 못했습니다. ChatGPT 설정에서 연결을 해제할 수 있습니다.'};
  }
  return {info,start,launch,callback,models,inference,logout,activeRequests};
}
