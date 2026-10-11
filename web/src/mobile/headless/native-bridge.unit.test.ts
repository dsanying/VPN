import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessNativeBridge, type NativeInvocation} from './native-bridge.ts';

test('headless bridge preserves request identity, native errors, event removal and closed-host cancellation', async () => {
  const sent: NativeInvocation[] = [];
  const bridge=createHeadlessNativeBridge(request => sent.push(request));
  const hostile='fictional"; globalThis.compromised=true; //';
  const first=bridge.native.requestText({id:'fixture',url:'https://example.com/',route:'direct',userAgent:hostile});
  const second=bridge.native.status();
  assert.equal((sent[0]!.data as {userAgent:string}).userAgent,hostile);
  bridge.receive({kind:'reply',id:sent[1]!.id,value:{running:false,busy:false}});
  bridge.receive({kind:'reply',id:sent[0]!.id,error:{code:'HTTP_TIMEOUT',message:'Timed out'}});
  assert.deepEqual(await second,{running:false,busy:false});
  await assert.rejects(first,{code:'HTTP_TIMEOUT'});
  assert.throws(()=>bridge.receive({kind:'reply',id:sent[0]!.id,value:{}}));
  const seen: unknown[]=[];
  const handle=await bridge.native.addListener('statusChanged',state=>seen.push(state));
  bridge.receive({kind:'event',event:'statusChanged',data:{running:true,busy:false}});
  await handle.remove();
  bridge.receive({kind:'event',event:'statusChanged',data:{running:false,busy:false}});
  assert.equal(seen.length,1);
  const pending=bridge.native.status();bridge.close();bridge.close();
  await assert.rejects(pending,/closed/);await assert.rejects(bridge.native.status(),/closed/);
});
