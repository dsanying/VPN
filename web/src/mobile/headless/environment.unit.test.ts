import test from 'node:test';
import assert from 'node:assert/strict';
import { installHeadlessEnvironment } from './environment.ts';

const names = ['URL','URLSearchParams','structuredClone','atob','btoa','TextEncoder','TextDecoder','DOMException','AbortController','AbortSignal','crypto','setTimeout','setInterval','clearTimeout','clearInterval'];

test('headless standard APIs preserve parsing, cancellation, signatures, entropy and timer lifecycle', async () => {
  const original = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const scheduled: { id: number; delay: number; repeat: boolean }[] = [];
  const canceled: number[] = [];
  const initial = Uint8Array.from({ length: 65536 }, (_, i) => i & 255);
  const environment = installHeadlessEnvironment({ entropy: initial,
    refillEntropy: async () => { throw new Error('offline'); },
    scheduleTimer: (id, delay, repeat) => { scheduled.push({ id, delay, repeat }); },
    cancelTimer: id => { canceled.push(id); },
  });
  try {
    const url = new URL('https://example.com/a?x=1&x=2');
    assert.equal(url.hostname, 'example.com');
    assert.deepEqual(url.searchParams.getAll('x'), ['1','2']);
    assert.equal(new URL('http://[2001:db8::1]/').hostname, '[2001:db8::1]');
    assert.equal(new TextDecoder().decode(new TextEncoder().encode('暗影')), '暗影');
    assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([255])));
    assert.equal(atob(btoa('\x00\xff')), '\x00\xff');
    const object = { nested: { count: 1 } }; const copy = structuredClone(object);
    copy.nested.count = 2; assert.equal(object.nested.count, 1);
    const abort = new AbortController(); const reason = new Error('canceled');
    let aborted = 0; abort.signal.addEventListener('abort', () => { aborted++; });
    abort.abort(reason); abort.abort(new Error('second'));
    assert.equal(aborted, 1); assert.equal(abort.signal.reason, reason);
    assert.throws(() => abort.signal.throwIfAborted(), error => error === reason);
    assert.equal(AbortSignal.abort(reason).reason, reason);
    const parent = new AbortController();
    const timeoutSignal = AbortSignal.timeout(20);
    const combined = AbortSignal.any([parent.signal, timeoutSignal]);
    parent.abort(reason); assert.equal(combined.reason, reason);
    environment.fireTimer(scheduled.at(-1)!.id);
    assert.equal(timeoutSignal.aborted, true);
    assert.equal(timeoutSignal.reason.name, 'TimeoutError');
    assert.equal(combined.reason, reason);
    assert.equal(AbortSignal.any([AbortSignal.abort(reason)]).reason, reason);
    assert.throws(() => AbortSignal.timeout(-1));
    assert.throws(() => AbortSignal.any([{} as AbortSignal]));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc')));
    assert.equal(Buffer.from(digest).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const publicKey = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex');
    const signature = Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b','hex');
    const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
    assert.equal(await crypto.subtle.verify('Ed25519', key, signature, new Uint8Array()), true);
    assert.equal(await crypto.subtle.verify('Ed25519', key, signature, new Uint8Array([1])), false);
    await assert.rejects(crypto.subtle.verify('Ed25519', {} as CryptoKey, signature, new Uint8Array()));
    await assert.rejects(crypto.subtle.digest('SHA-1', new Uint8Array()));
    await assert.rejects(crypto.subtle.importKey('raw', publicKey, 'Ed25519', true, ['verify']));
    assert.match(crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const data = new Uint8Array(32); crypto.getRandomValues(data);
    assert.deepEqual(data, initial.slice(16, 48));
    assert.throws(() => crypto.getRandomValues(new Float32Array(1)));
    assert.throws(() => crypto.getRandomValues(new Uint8Array(65537)));
    // Exhaustion cannot silently switch to Math.random or reuse old bytes.
    crypto.getRandomValues(new Uint8Array(65536 - 48));
    assert.throws(() => crypto.getRandomValues(new Uint8Array(1)));
    let calls = 0;
    const timeout = setTimeout(() => { calls++; }, 10) as unknown as number;
    environment.fireTimer(timeout); environment.fireTimer(timeout);
    assert.equal(calls, 1);
    const interval = setInterval(() => { calls++; }, 5) as unknown as number;
    environment.fireTimer(interval); environment.fireTimer(interval); clearInterval(interval);
    environment.fireTimer(interval); assert.equal(calls, 3);
    const pending = setTimeout(() => { calls++; }, 1) as unknown as number;
    environment.close(); environment.fireTimer(pending);
    assert.equal(calls, 3); assert.ok(canceled.includes(pending));
    assert.equal(scheduled.length, 4); assert.throws(() => crypto.randomUUID());
  } finally {
    environment.close();
    for (const name of names) {
      const descriptor = original.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('native entropy refill preserves unused bytes and close continues after native cancellation failure', async () => {
  const original = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const canceled: number[] = [];
  let refills = 0;
  const environment = installHeadlessEnvironment({
    entropy: new Uint8Array(65536).fill(7),
    refillEntropy: async () => { refills++; return new Uint8Array(65536).fill(19); },
    scheduleTimer() {},
    cancelTimer(id) { canceled.push(id); throw new Error('native timer disappeared'); },
  });
  try {
    crypto.getRandomValues(new Uint8Array(40000));
    await Promise.resolve();
    const output = new Uint8Array(40000); crypto.getRandomValues(output);
    assert.ok(output.subarray(0, 25536).every(value => value === 7));
    assert.ok(output.subarray(25536).every(value => value === 19));
    assert.equal(refills, 1);
    const first = setTimeout(() => assert.fail('closed timer fired'), 1) as unknown as number;
    const second = setTimeout(() => assert.fail('closed timer fired'), 1) as unknown as number;
    environment.close(); environment.close();
    assert.deepEqual(canceled, [first, second]);
    environment.fireTimer(first); environment.fireTimer(second);
    assert.throws(() => crypto.randomUUID());
  } finally {
    environment.close();
    for (const name of names) {
      const descriptor = original.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
