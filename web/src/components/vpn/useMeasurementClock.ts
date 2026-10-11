import {useSyncExternalStore} from 'react';
import {now} from '@/utils/dateTime';
let clock = now().valueOf();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<()=>void>();
function subscribe(listener:()=>void) {
 listeners.add(listener);
 if(!timer){clock=now().valueOf();timer=setInterval(()=>{clock=now().valueOf();for(const notify of listeners)notify();},30_000);}
 return ()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);timer=undefined;}};
}
export function useMeasurementClock() { return useSyncExternalStore(subscribe,()=>clock); }
