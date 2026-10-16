import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { performance } from 'perf_hooks';

export interface OperationContext {
  traceId: string;
  operation: string;
  phase: 'start' | 'progress' | 'success' | 'failure';
  durationMs?: number;
}
const storage = new AsyncLocalStorage<OperationContext>();
export const currentOperation = (): OperationContext | undefined => storage.getStore();
/** Async-local ownership prevents concurrent IPC operations from mixing their evidence. */
export async function traceOperation<T>(
  operation: string,
  record: (context: OperationContext, error?: unknown) => void,
  run: () => Promise<T>,
  failed: (result: T) => boolean = () => false
): Promise<T> {
  const context: OperationContext = {
    traceId: randomBytes(16).toString('hex'),
    operation,
    phase: 'start',
  };
  const observe: typeof record = (value, error) => {
    try {
      record(value, error);
    } catch {
      /* Diagnostics cannot fail committed work. */
    }
  };
  return storage.run(context, async () => {
    const started = performance.now();
    observe(context);
    context.phase = 'progress';
    const slow = setTimeout(
      () => observe({ ...context, durationMs: Math.round(performance.now() - started) }),
      10000
    );
    slow.unref();
    try {
      const result = await run();
      const rejected = failed(result);
      const detail =
        rejected &&
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
          ? result.error
          : undefined;
      observe(
        {
          ...context,
          phase: rejected ? 'failure' : 'success',
          durationMs: Math.round(performance.now() - started),
        },
        detail ? new Error(detail) : undefined
      );
      return result;
    } catch (error) {
      observe(
        { ...context, phase: 'failure', durationMs: Math.round(performance.now() - started) },
        error
      );
      throw error;
    } finally {
      clearTimeout(slow);
    }
  });
}
