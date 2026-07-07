#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  roots.push('src/App.tsx', ...execFileSync('rg', ['--files', 'src/components'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean));
}
const forbidden = /(?:from\s+['"].*data\/feature-table\.json['"]|import\s+['"].*data\/feature-table\.json['"])/;
const offenders = roots.filter(file => {
  const path = isAbsolute(file) ? file : join(process.cwd(), file);
  return forbidden.test(readFileSync(path, 'utf8'));
});

if (offenders.length > 0) {
  console.error(`[UI import guard] feature-table.json must not be imported by browser UI files:\n${offenders.join('\n')}`);
  process.exit(1);
}

console.log(`[UI import guard] OK checked=${roots.length}`);
