import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';

export const defaultConnectionPath=()=>path.join(process.env.APPDATA || path.join(homedir(),'.config'),'Paper Reader','link-connection.json');
export function createBridgeClient(connectionPath=defaultConnectionPath()){
  return async(method,args={})=>{
    let connection;
    try{connection=JSON.parse(await readFile(connectionPath,'utf8'));}
    catch{throw new Error('Paper Reader를 열고 문장을 선택한 뒤 Paper Reader Link로 보내세요.');}
    if(connection.version!==1 || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(connection.origin) || !/^[a-f\d]{64}$/.test(connection.token))throw new Error('Link 연결 정보가 올바르지 않습니다. 앱에서 연결을 해제하고 다시 공유하세요.');
    let response;
    try{response=await fetch(connection.origin+'/link/rpc',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+connection.token},body:JSON.stringify({method,args})});}
    catch{throw new Error('Paper Reader에 연결하지 못했습니다. 앱이 켜져 있는지 확인하세요.');}
    const value=await response.json();
    if(!response.ok)throw new Error(value.error || 'Link 요청에 실패했습니다.');
    return value;
  };
}
