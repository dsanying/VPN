import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface UseRequestOptions {
  manual?: boolean;
  refreshDeps?: DependencyList;
  resetDataOnRefreshDepsChange?: boolean;
}
export interface UseRequestResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  run(): Promise<T | undefined>;
}

/** Reads have no notifications or polling. Each committed request owns its result generation. */
export function useRequest<T>(
  request: () => Promise<T>,
  options: UseRequestOptions = {}
): UseRequestResult<T> {
  const [result, setResult] = useState<{ data?: T; loading: boolean; error?: Error }>(() => ({
    loading: !options.manual,
  }));
  const lifecycle = useRef<{
    live: boolean;
    generation: number;
    request: () => Promise<T>;
    inputs?: unknown[];
  }>({
    live: false,
    generation: 0,
    request,
  });
  useEffect(() => {
    lifecycle.current.request = request;
  });
  useEffect(() => {
    const owner = lifecycle.current;
    owner.live = true;
    owner.inputs = undefined;
    return () => {
      owner.live = false;
      owner.generation++;
      owner.inputs = undefined;
    };
  }, []);
  const run = useCallback(async () => {
    const owner = lifecycle.current;
    if (!owner.live) return undefined;
    const generation = ++owner.generation;
    setResult((previous) => ({ data: previous.data, loading: true }));
    try {
      const data = await owner.request();
      if (owner.live && owner.generation === generation) setResult({ data, loading: false });
      return data;
    } catch (failure) {
      if (owner.live && owner.generation === generation)
        setResult((previous) => ({
          data: previous.data,
          loading: false,
          error: failure instanceof Error ? failure : new Error(String(failure)),
        }));
      return undefined;
    }
  }, []);
  useEffect(() => {
    const inputs = [!!options.manual, ...(options.refreshDeps ?? [])];
    const previous = lifecycle.current.inputs;
    if (
      previous &&
      inputs.length === previous.length &&
      inputs.every((value, index) => Object.is(value, previous[index]))
    )
      return;
    lifecycle.current.inputs = inputs;
    lifecycle.current.generation++;
    if (previous)
      setResult((value) => ({
        data: options.resetDataOnRefreshDepsChange ? undefined : value.data,
        loading: !options.manual,
      }));
    if (!options.manual) void run();
  }, [options.manual, options.refreshDeps, options.resetDataOnRefreshDepsChange, run]);
  return { data: result.data, error: result.error, loading: result.loading, run };
}
