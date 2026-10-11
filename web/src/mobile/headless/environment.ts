import HostURL from 'core-js-pure/features/url/index.js';
import HostURLSearchParams from 'core-js-pure/features/url-search-params/index.js';
import clone from 'core-js-pure/features/structured-clone.js';
import decodeBase64 from 'core-js-pure/features/atob.js';
import encodeBase64 from 'core-js-pure/features/btoa.js';
import HostDOMException from 'core-js-pure/features/dom-exception/index.js';
import encoding from '@sinonjs/text-encoding';
const { TextEncoder, TextDecoder } = encoding;
import { AbortController as BaseAbortController, AbortSignal as BaseAbortSignal } from 'abort-controller/dist/abort-controller.mjs';
import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';

export interface HeadlessEnvironmentHost {
  entropy: Uint8Array;
  refillEntropy(): Promise<Uint8Array>;
  scheduleTimer(id: number, delay: number, repeat: boolean): void;
  cancelTimer(id: number): void;
}

function bytes(source: BufferSource): Uint8Array<ArrayBuffer> {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(new Uint8Array(source.buffer, source.byteOffset, source.byteLength))
    : new Uint8Array(new Uint8Array(source));
}

/** Standard APIs required by the shared business runtime; no DOM or hidden WebView. */
export function installHeadlessEnvironment(host: HeadlessEnvironmentHost) {
  const timers = new Map<number, { callback: () => void; repeat: boolean }>();
  const keys = new WeakMap<object, Uint8Array<ArrayBuffer>>();
  const reasons = new WeakMap<object, unknown>();
  let nextTimer = 0;
  let entropy = new Uint8Array(host.entropy);
  let cursor = 0;
  let refill: Promise<void> | undefined;
  let closed = false;
  const replenish = () => {
    if (closed || refill) return;
    refill = host.refillEntropy().then(value => {
      if (closed) return;
      if (!(value instanceof Uint8Array) || value.length < 65536)
        throw new Error('Native entropy refill is invalid');
      const remaining = entropy.slice(cursor);
      entropy.fill(0);
      entropy = new Uint8Array(remaining.length + value.length);
      entropy.set(remaining);
      entropy.set(value, remaining.length);
      cursor = 0;
    }).catch(() => {
      // Remaining genuine entropy remains usable; exhaustion fails closed.
    }).finally(() => { refill = undefined; });
  };
  const getRandomValues = <T extends ArrayBufferView | null>(target: T): T => {
    if (closed) throw new HostDOMException('Host is closed', 'OperationError');
    if (!target || !ArrayBuffer.isView(target) || target instanceof DataView ||
      target instanceof Float32Array || target instanceof Float64Array)
      throw new HostDOMException('Integer typed array required', 'TypeMismatchError');
    if (target.byteLength > 65536) throw new HostDOMException('Entropy quota exceeded', 'QuotaExceededError');
    if (entropy.length - cursor < target.byteLength) {
      replenish();
      throw new HostDOMException('Native entropy unavailable', 'OperationError');
    }
    const output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    output.set(entropy.subarray(cursor, cursor + output.length));
    entropy.fill(0, cursor, cursor + output.length);
    cursor += output.length;
    if (entropy.length - cursor < 32768) replenish();
    return target;
  };
  const crypto = {
    getRandomValues,
    randomUUID() {
      const value = getRandomValues(new Uint8Array(16));
      value[6] = (value[6]! & 15) | 64;
      value[8] = (value[8]! & 63) | 128;
      const hex = Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    subtle: {
      async digest(algorithm: AlgorithmIdentifier, value: BufferSource) {
        if ((typeof algorithm === 'string' ? algorithm : algorithm.name) !== 'SHA-256')
          throw new HostDOMException('Unsupported digest', 'NotSupportedError');
        return sha256(bytes(value)).buffer;
      },
      async importKey(format: string, value: BufferSource, algorithm: AlgorithmIdentifier, extractable: boolean, usages: string[]) {
        if (format !== 'raw' || (typeof algorithm === 'string' ? algorithm : algorithm.name) !== 'Ed25519' ||
          extractable || usages.length !== 1 || usages[0] !== 'verify')
          throw new HostDOMException('Unsupported key operation', 'NotSupportedError');
        const keyBytes = bytes(value);
        if (keyBytes.length !== 32) throw new HostDOMException('Invalid verification key', 'DataError');
        const key = Object.freeze({ type: 'public', extractable: false,
          algorithm: Object.freeze({ name: 'Ed25519' }), usages: Object.freeze(['verify']) });
        keys.set(key, keyBytes);
        return key;
      },
      async verify(algorithm: AlgorithmIdentifier, key: object, signature: BufferSource, value: BufferSource) {
        const keyBytes = keys.get(key);
        if (!keyBytes || (typeof algorithm === 'string' ? algorithm : algorithm.name) !== 'Ed25519')
          throw new HostDOMException('Invalid verification operation', 'InvalidAccessError');
        try { return ed25519.verify(bytes(signature), bytes(value), keyBytes, { zip215: false }); }
        catch { return false; }
      },
    },
  };
  class HostAbortController extends BaseAbortController {
    override abort(reason: unknown = new HostDOMException('Aborted', 'AbortError')) {
      if (this.signal.aborted) return;
      reasons.set(this.signal, reason);
      super.abort();
    }
  }
  Object.defineProperties(BaseAbortSignal.prototype, {
    reason: { configurable: true, get() { return reasons.get(this); } },
    throwIfAborted: { configurable: true, value(this: BaseAbortSignal) {
      if (this.aborted) throw reasons.get(this);
    } },
  });
  Object.defineProperties(BaseAbortSignal, {
    abort: { configurable: true, value(reason?: unknown) {
      const controller = new HostAbortController(); controller.abort(reason); return controller.signal;
    } },
    timeout: { configurable: true, value(milliseconds: number) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 2147483647)
        throw new RangeError('Unsupported timeout duration');
      const controller = new HostAbortController();
      globalThis.setTimeout(() => controller.abort(new HostDOMException('Timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    } },
    any: { configurable: true, value(signals: Iterable<BaseAbortSignal>) {
      const sources = [...new Set(signals)];
      if (sources.some(signal => !(signal instanceof BaseAbortSignal))) throw new TypeError('AbortSignal required');
      const controller = new HostAbortController();
      const listeners = new Map<BaseAbortSignal, () => void>();
      const abort = (signal: BaseAbortSignal) => {
        controller.abort(reasons.get(signal));
        for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
        listeners.clear();
      };
      for (const signal of sources) {
        if (signal.aborted) { abort(signal); break; }
        const listener = () => abort(signal);
        listeners.set(signal, listener); signal.addEventListener('abort', listener);
      }
      return controller.signal;
    } },
  });
  const schedule = (callback: (...args: unknown[]) => void, delay: number | undefined, repeat: boolean, args: unknown[]) => {
    if (closed) throw new Error('Host is closed');
    if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function');
    if (timers.size >= 256) throw new Error('Timer capacity exceeded');
    const id = ++nextTimer;
    if (!Number.isSafeInteger(id)) throw new Error('Timer identity exhausted');
    timers.set(id, { callback: () => callback(...args), repeat });
    const duration = Number(delay);
    try { host.scheduleTimer(id, Number.isFinite(duration) ? Math.max(repeat ? 1 : 0, Math.min(2147483647, duration)) : 0, repeat); }
    catch (error) { timers.delete(id); throw error; }
    return id;
  };
  const cancel = (id: number) => { if (timers.delete(id)) host.cancelTimer(id); };
  Object.defineProperties(globalThis, Object.fromEntries(Object.entries({
    URL: HostURL, URLSearchParams: HostURLSearchParams, structuredClone: clone,
    atob: decodeBase64, btoa: encodeBase64, TextEncoder, TextDecoder,
    DOMException: HostDOMException, AbortController: HostAbortController, AbortSignal: BaseAbortSignal, crypto,
    setTimeout: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => schedule(callback, delay, false, args),
    setInterval: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => schedule(callback, delay, true, args),
    clearTimeout: cancel, clearInterval: cancel,
  }).map(([name, value]) => [name, { value, configurable: true }])));
  return {
    fireTimer(id: number) {
      if (closed) return;
      const timer = timers.get(id);
      if (!timer) return;
      if (!timer.repeat) timers.delete(id);
      timer.callback();
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        for (const id of [...timers.keys()]) {
          try { cancel(id); } catch { /* Closing continues if a native timer already disappeared. */ }
        }
      } finally { entropy.fill(0); }
    },
  };
}
