// PDF.js applies its own initial view after documentloaded. Wait for its page
// layout and one event-loop turn before applying the app's authoritative state.
export async function waitForPdfLayout(viewer,timeout=11000){
  let timer;
  try{await Promise.race([viewer.pdfViewer.pagesPromise?.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,timeout);})]);}
  finally{clearTimeout(timer);}
  await new Promise(resolve=>setTimeout(resolve,0));
}
