#!/usr/bin/env node
import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF;
if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `refs/tags/v${version}`) {
  throw new Error('Release tag must match the stable package version');
}
console.log(`Release version verified: ${version}`);
