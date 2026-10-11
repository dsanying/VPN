import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { checkSource } from './check-expanded.mjs';

test('内容折叠别名、命名空间和原生标签都失败', () => {
  assert.equal(checkSource(ts, `import { Collapse as Panel } from 'antd'; const x = <Panel/>;`).length, 1);
  assert.equal(checkSource(ts, `import * as Ant from 'antd'; const x = <Ant.Collapse/>;`).length, 1);
  assert.equal(checkSource(ts, `const x = <details><summary>高级</summary>设置</details>;`).length, 2);
  assert.equal(checkSource(ts, `import {SecondarySection as S} from '@/components/ui'; const x=<S/>;`).length, 1);
});
test('常显分区和操作菜单允许，注释及字符串不误报', () => {
  assert.deepEqual(checkSource(ts, `// <Collapse/>
  const label = '<details>'; const x = <DesktopSection><Select/><Dropdown/></DesktopSection>;`), []);
});
