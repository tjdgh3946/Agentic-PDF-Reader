// Development-only MCP Apps host. It never calls a model or impersonates ChatGPT.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createBridgeClient} from '../link/bridge-client.mjs';
const origin='http://127.0.0.1:8768';
const call=createBridgeClient(fileURLToPath(new URL('../.local/link-connection.json',import.meta.url)));
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Paper Reader Link · 로컬 프로토콜 검증</title><style>body{font:14px system-ui;margin:0;background:#f1f3ef;color:#293428}header{padding:16px 24px;border-bottom:1px solid #ccd5c7}main{display:grid;grid-template-columns:minmax(380px,600px) 1fr;gap:24px;padding:24px}iframe{border:1px solid #dce3d5;border-radius:16px;width:100%;height:650px;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;font:12px system-ui}textarea{width:95%;min-height:95px;padding:12px}button{padding:10px;margin-top:12px}#result{line-height:1.7}</style><header><b>로컬 프로토콜 검증</b> · ChatGPT 서버에 연결하지 않으며 모델 요청을 보내지 않습니다.</header><main><iframe id="widget" title="Paper Reader Link 카드" src="/widget"></iframe><section><h2>호스트가 받은 질문</h2><pre id="message">아직 전송하지 않았습니다.</pre><h3>검증용 답변</h3><textarea id="answer" aria-label="검증용 답변">**로컬 왕복 검증**
이 주석은 MCP 연결 시험용입니다. 선택한 제목은 실행 중 자주 나타나는 경로의 자료형에 맞춰 코드를 특수화하는 JIT 기법을 뜻합니다.</textarea><button id="save" disabled>검증용 답변을 PDF 주석으로 저장</button><p id="result" role="status"></p></section></main><script>
const frame=document.getElementById('widget');let selectionId;
async function call(name,args){const response=await fetch('/tool',{method:'POST',headers:{'Content-Type':'application/json','X-Link-Preview':'1'},body:JSON.stringify({name,args})});return response.json();}
window.addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow || event.origin!==location.origin)return;
  const request=event.data;if(request?.jsonrpc!=='2.0'||request.id==null)return;
  let result,error;
  try{
    if(request.method==='ui/initialize')result={protocolVersion:request.params.protocolVersion,hostInfo:{name:'local-protocol-preview',version:'1.0.0'},hostCapabilities:{serverTools:{},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline'}};
    else if(request.method==='tools/call')result=await call(request.params.name,request.params.arguments);
    else if(request.method==='ui/message'){
      const text=request.params.content.filter(c=>c.type==='text').map(c=>c.text).join('\\n');document.getElementById('message').textContent=text;
      selectionId=text.match(/선택 ID: ([a-f0-9-]+)/)?.[1];document.getElementById('save').disabled=!selectionId;result={};
    }else throw new Error('Unsupported test host method');
  }catch(e){error={code:-32000,message:e.message};}
  frame.contentWindow.postMessage({jsonrpc:'2.0',id:request.id,...(error?{error}:{result})},location.origin);
});
document.getElementById('save').onclick=async()=>{const result=await call('save_annotation',{selectionId,note:document.getElementById('answer').value});document.getElementById('result').textContent=result.isError?result.content[0].text:'저장 완료 · Paper Reader의 PDF 하이라이트와 주석 패널에서 확인하세요.';};
</script></html>`;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  try{
    if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;}
    if(req.method==='GET'&&req.url==='/widget'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(await readFile(new URL('../plugins/paper-reader-link/widget.html',import.meta.url)));return;}
    if(req.method==='POST'&&req.url==='/tool'&&req.headers.origin===origin&&req.headers['x-link-preview']==='1'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>150000)throw new Error('Too large');}
      const {name,args}=JSON.parse(body);if(!['get_selection','save_annotation'].includes(name))throw new Error('Unknown tool');
      const data=await call(name,args);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({structuredContent:data,content:[]}));return;
    }
    res.writeHead(404).end();
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({isError:true,content:[{type:'text',text:error.message}]}));}
});
server.listen(8768,'127.0.0.1',()=>console.log('Local protocol preview: '+origin));
