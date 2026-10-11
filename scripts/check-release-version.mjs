#!/usr/bin/env node
import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF;
const candidate = process.argv.includes('--candidate');
const refMatches = candidate
  ? process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^refs\/heads\/.+/.test(tag ?? '')
  : tag === `refs/tags/v${version}`;
if (!/^\d+\.\d+\.\d+$/.test(version) || !refMatches) {
  throw new Error('Release tag must match the stable package version');
}
console.log(`${candidate ? 'Candidate' : 'Release'} version verified: ${version}`);
