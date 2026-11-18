#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  roots.push('src/App.tsx');
  const components = readdirSync('src/components', { recursive: true, withFileTypes: true });
  roots.push(...components.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)));
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
