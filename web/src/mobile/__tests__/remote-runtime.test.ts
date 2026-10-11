import {connectMobileRuntime, type MobileBusinessHost} from '../remote-runtime';

test('reopening a view connects to native business ownership without starting another service', async()=>{
  let event!: (value:{channel:string;data:unknown})=>void;
  const remove=jest.fn(async()=>{});
  const host:MobileBusinessHost={
    clientBootstrap:jest.fn(async()=>({capabilities:{platform:'android',vpn:true,connectionOwner:true,systemProxy:false,desktopLoginAutostart:false,externalCoreReplacement:false} as const})),
    clientInvoke:jest.fn(async options=>({success:true,data:options})),
    clientDisconnect:jest.fn(async()=>{}),
    addListener:jest.fn(async(_name,listener)=>{event=listener;return{remove};}),
  };
  const first=await connectMobileRuntime(host);const received=jest.fn();
  first.transport.on('fixture:event',received);
  event({channel:'fixture:event',data:{value:1}});expect(received).toHaveBeenCalledWith(undefined,{value:1});
  await first.close();event({channel:'fixture:event',data:{value:2}});expect(received).toHaveBeenCalledTimes(1);
  await expect(first.transport.invoke('config:get')).rejects.toThrow('closed');
  const second=await connectMobileRuntime(host);
  expect(await second.transport.invoke('config:get')).toMatchObject({success:true,data:{channel:'config:get'}});
  expect(host.clientInvoke).toHaveBeenCalledTimes(1);
  await second.close();expect(remove).toHaveBeenCalledTimes(2);expect(host.clientDisconnect).toHaveBeenCalledTimes(2);
});
test('bootstrap failure removes the view subscription and propagates genuine host failure',async()=>{
  const remove=jest.fn(async()=>{});
  await expect(connectMobileRuntime({clientBootstrap:async()=>{throw Error('engine unavailable');},clientInvoke:jest.fn(),clientDisconnect:jest.fn(async()=>{}),addListener:async()=>({remove})})).rejects.toThrow('engine unavailable');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('host termination reconnects once and restores only active subscriptions, never failed writes',async()=>{
  let event!: (value:{channel:string;data:unknown})=>void;
  const host:MobileBusinessHost={
    clientBootstrap:jest.fn(async()=>({capabilities:{platform:'android',vpn:true,connectionOwner:true,systemProxy:false,desktopLoginAutostart:false,externalCoreReplacement:false} as const})),
    clientInvoke:jest.fn(async options=>{
      if(options.channel==='config:save')throw Error('host terminated');
      return {success:true};
    }),
    clientDisconnect:jest.fn(async()=>{}),
    addListener:jest.fn(async(_name,listener)=>{event=listener;return{remove:jest.fn(async()=>{})};}),
  };
  const runtime=await connectMobileRuntime(host);
  await runtime.transport.invoke('stats:subscribe',{topic:'aggregate'});
  await runtime.transport.invoke('stats:subscribe',{topic:'detail'});
  await runtime.transport.invoke('stats:unsubscribe',{topic:'detail'});
  await expect(runtime.transport.invoke('config:save',{fictional:true})).rejects.toThrow('terminated');
  event({channel:'client:hostClosed',data:{}});
  await runtime.transport.invoke('config:get');
  expect(host.clientBootstrap).toHaveBeenCalledTimes(2);
  const calls=(host.clientInvoke as jest.Mock).mock.calls.map(([value])=>value);
  expect(calls.filter(value=>value.channel==='config:save')).toHaveLength(1);
  expect(calls.filter(value=>value.channel==='stats:subscribe'&&value.args.topic==='aggregate')).toHaveLength(2);
  expect(calls.filter(value=>value.channel==='stats:subscribe'&&value.args.topic==='detail')).toHaveLength(1);
  await runtime.close();
  event({channel:'client:hostClosed',data:{}});
  expect(host.clientBootstrap).toHaveBeenCalledTimes(2);
});

test.each(['stats:subscribe','stats:unsubscribe'])('recovery waits for the accepted %s result before restoring topic ownership',async channel=>{
  let event!: (value:{channel:string;data:unknown})=>void;
  let finish!: (value:unknown)=>void;
  let delay=false;
  const response=new Promise(resolve=>{finish=resolve;});
  const host:MobileBusinessHost={
    clientBootstrap:jest.fn(async()=>({capabilities:{platform:'android',vpn:true,connectionOwner:true,systemProxy:false,desktopLoginAutostart:false,externalCoreReplacement:false} as const})),
    clientInvoke:jest.fn(async options=>delay&&options.channel===channel?response:{success:true}),
    clientDisconnect:jest.fn(async()=>{}),
    addListener:jest.fn(async(_name,listener)=>{event=listener;return{remove:jest.fn(async()=>{})};}),
  };
  const runtime=await connectMobileRuntime(host);
  if(channel==='stats:unsubscribe')await runtime.transport.invoke('stats:subscribe',{topic:'stats'});
  delay=true;
  const pending=runtime.transport.invoke(channel,{topic:'stats'});
  await Promise.resolve();
  event({channel:'client:hostClosed',data:{}});
  await Promise.resolve();
  expect(host.clientBootstrap).toHaveBeenCalledTimes(1);
  delay=false;finish({success:true});await pending;
  await runtime.transport.invoke('config:get');
  expect(host.clientBootstrap).toHaveBeenCalledTimes(2);
  const calls=(host.clientInvoke as jest.Mock).mock.calls.map(([value])=>value);
  expect(calls.filter(value=>value.channel==='stats:subscribe')).toHaveLength(channel==='stats:subscribe'?2:1);
  await runtime.close();
});


test.each(['stats:subscribe','stats:unsubscribe'])('recovery preserves desired ownership when old %s fails during termination',async channel=>{
  let event!: (value:{channel:string;data:unknown})=>void;
  let fail!: (error:Error)=>void;
  let terminating=false;
  const response=new Promise((_resolve,reject)=>{fail=reject;});
  const host:MobileBusinessHost={
    clientBootstrap:jest.fn(async()=>({capabilities:{platform:'android',vpn:true,connectionOwner:true,systemProxy:false,desktopLoginAutostart:false,externalCoreReplacement:false} as const})),
    clientInvoke:jest.fn(async options=>terminating&&options.channel===channel?response:{success:true}),
    clientDisconnect:jest.fn(async()=>{}),
    addListener:jest.fn(async(_name,listener)=>{event=listener;return{remove:jest.fn(async()=>{})};}),
  };
  const runtime=await connectMobileRuntime(host);
  if(channel==='stats:unsubscribe')await runtime.transport.invoke('stats:subscribe',{topic:'aggregate'});
  terminating=true;
  const pending=runtime.transport.invoke(channel,{topic:'aggregate'});
  const rejected=expect(pending).rejects.toThrow('isolate terminated');
  await Promise.resolve();
  event({channel:'client:hostClosed',data:{}});
  terminating=false;fail(Error('isolate terminated'));await rejected;
  await runtime.transport.invoke('config:get');
  expect(host.clientBootstrap).toHaveBeenCalledTimes(2);
  const calls=(host.clientInvoke as jest.Mock).mock.calls.map(([value])=>value);
  expect(calls.filter(value=>value.channel==='stats:subscribe')).toHaveLength(channel==='stats:subscribe'?2:1);
  await runtime.close();
});
