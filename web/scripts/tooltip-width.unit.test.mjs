import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('client help retains intrinsic content width and a viewport ceiling', () => {
 const css=readFileSync(new URL('../src/components/client/client.css', import.meta.url), 'utf8');
 assert.match(css, /\.client-help-popup \.ant-tooltip-container\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 32px\)/s);
 assert.match(css, /overflow-wrap:\s*anywhere/);
});
