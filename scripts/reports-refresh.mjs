#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const required = [
  ['npm', ['run', 'update:onchain']],
  ['npm', ['run', 'update:derivatives']],
  ['npm', ['run', 'update:etf-flow']],
  ['npm', ['run', 'build:features']],
  ['npm', ['run', 'validate:data']],
  ['npm', ['run', 'backtest']],
  ['npm', ['run', 'write:runtime-summaries']],
  ['npm', ['run', 'check:freshness']],
];

function run(command, args, optional = false) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0 && !optional) process.exit(result.status ?? 1);
  if (result.status !== 0 && optional) console.warn(`[reports:refresh] optional command failed: ${command} ${args.join(' ')}`);
}

run('npm', ['run', 'update:macro'], true);
for (const [command, args] of required) run(command, args);
run('npm', ['run', 'backtest:ensemble-suite'], true);
run('npm', ['run', 'backtest:tail-risk-suite'], true);
