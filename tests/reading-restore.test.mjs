import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPdfLayout} from '../reading-restore.mjs';

test('app restoration runs after PDF.js late initial view and layout completion',async()=>{
  let complete,page=8;
  const pagesPromise=new Promise(resolve=>complete=resolve),viewer={pdfViewer:{pagesPromise}};
  const waiting=waitForPdfLayout(viewer);
  // PDF.js registers a late view adjustment around documentinit/pagesPromise.
  pagesPromise.then(()=>{page=1;});complete();await waiting;
  assert.equal(page,1);page=8;await Promise.resolve();assert.equal(page,8);
});
test('unresolved PDF layout is bounded and rejected layout cannot block reading',async()=>{
  await waitForPdfLayout({pdfViewer:{pagesPromise:new Promise(()=>{})}},5);
  await waitForPdfLayout({pdfViewer:{pagesPromise:Promise.reject(Error('failed page'))}},5);
});
