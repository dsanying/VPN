// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createInstance } from 'i18next';
import dayjs from 'dayjs';

const modules = createRequire(import.meta.url);
function execute(relative, imports, context = {}) {
  const file = new URL(relative, import.meta.url);
  const javascript = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText;
  const exports = {};
  runInNewContext(javascript, {exports, require: imports, ...context}, {filename: file.pathname});
  return exports;
}
function languageRuntime({preference, browser = 'en-GB', dom = '', denied = false, server = false} = {}) {
  const storage = new Map();
  if (preference !== undefined) storage.set('shadowvpn-lang', preference);
  const document = {documentElement: {lang: dom}};
  const window = {navigator: {languages: [browser], language: browser}, localStorage: {
    getItem: name => { if (denied) throw new Error('storage unavailable'); return storage.get(name) ?? null; },
    setItem: (name, value) => { if (denied) throw new Error('storage unavailable'); storage.set(name, value); },
  }};
  const translation = createInstance();
  const imports = name => {
    if (name === 'i18next') return translation;
    if (name.endsWith('.json')) return JSON.parse(readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), 'utf8'));
    return modules(name);
  };
  const implementation = execute('../src/i18n/index.ts', imports, server ? {} : {document, window});
  return {implementation, translation, document, storage};
}

test('language precedence uses stored preference, device language, document metadata, then product fallback', () => {
  const cases = [
    [{preference: 'zh-HK', browser: 'en-US'}, 'zh-CN'],
    [{preference: 'de-DE', browser: 'en-GB'}, 'en-US'],
    [{browser: 'fr-FR', dom: 'zh'}, 'zh-CN'],
    [{browser: 'fr-FR', dom: ''}, 'zh-CN'],
    [{server: true}, 'zh-CN'],
  ];
  for (const [options, expected] of cases) {
    const runtime = languageRuntime(options);
    assert.equal(runtime.translation.resolvedLanguage, expected);
    if (!options.server) assert.equal(runtime.document.documentElement.lang, expected);
  }
});

test('switching languages updates metadata and persists the same canonical language', async () => {
  const runtime = languageRuntime({preference: 'zh-CN'});
  for (const language of ['en-US', 'zh-CN', 'en-US']) {
    await runtime.translation.changeLanguage(language);
    assert.equal(runtime.document.documentElement.lang, language);
    assert.equal(runtime.storage.get(runtime.implementation.LANGUAGE_STORAGE_KEY), language);
  }
});

test('blocked storage and absent browser globals do not block translations or language changes', async () => {
  for (const options of [{denied: true}, {server: true}]) {
    const runtime = languageRuntime(options);
    await runtime.translation.changeLanguage('en-US');
    assert.equal(runtime.translation.resolvedLanguage, 'en-US');
    if (!options.server) assert.equal(runtime.document.documentElement.lang, 'en-US');
  }
});

test('date labels and previously created date values follow the current UI language', async () => {
  const runtime = languageRuntime({preference: 'zh-CN'});
  const dates = execute('../src/utils/dateTime.ts', modules);
  const previous = dayjs().subtract(2, 'hour');
  assert.match(dates.formatRelativeTime(previous), /前/);
  assert.equal(dayjs('2026-10-12').format('MMMM dddd'), '十月 星期一');
  await runtime.translation.changeLanguage('en-US');
  assert.equal(dayjs('2026-10-12').format('MMMM dddd'), 'October Monday');
  assert.match(dates.formatRelativeTime(previous), /ago/);
  await runtime.translation.changeLanguage('zh-CN');
  assert.match(dates.formatRelativeTime(previous), /前/);
  const event = dates.parseServerTime('2026-10-12T00:00:00Z');
  assert.equal(dates.parseServerTime(dates.toOffsetDateTime(event)).valueOf(), event.valueOf());
});
