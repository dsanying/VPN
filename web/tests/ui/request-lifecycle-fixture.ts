import { StrictMode, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRequest } from '../../src/hooks/useRequest';
const operations: Array<{ resolve(value: string): void; reject(error: Error): void }> = [];
const state = {
  change: (_value: number) => {},
  manual: (_value: boolean) => {},
  run: async () => undefined as string | undefined,
};
function Harness() {
  const [key, change] = useState(0);
  const [manual, setManual] = useState(false);
  const result = useRequest(
    () => new Promise<string>((resolve, reject) => operations.push({ resolve, reject })),
    {
      manual,
      refreshDeps: [key],
      resetDataOnRefreshDepsChange: true,
    }
  );
  Object.assign(state, { change, manual: setManual, run: result.run });
  return createElement('output', { id: 'result' }, JSON.stringify({ ...result, run: undefined }));
}
const root = createRoot(document.getElementById('root')!);
root.render(createElement(StrictMode, null, createElement(Harness)));
Object.assign(window, {
  requestHarness: {
    count: () => operations.length,
    resolve: (index: number, value: string) => operations[index].resolve(value),
    reject: (index: number) => operations[index].reject(new Error('fixture failure')),
    change: (value: number) => state.change(value),
    manual: (value: boolean) => state.manual(value),
    run: () => state.run(),
    unmount: () => root.unmount(),
  },
});
