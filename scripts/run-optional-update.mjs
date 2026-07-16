#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [cachePath, command, ...args] = process.argv.slice(2);
if (!cachePath || !command) {
  console.error('Usage: run-optional-update.mjs <cache-path> <command> [args...]');
  process.exit(2);
}

const existed = existsSync(cachePath);
const previous = existed ? readFileSync(cachePath) : null;
const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });

if (result.status === 0) process.exit(0);

if (previous) writeFileSync(cachePath, previous);
else rmSync(cachePath, { force: true });

const outcome = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? 'unknown'}`;
console.warn(`[Optional data] updater failed (${outcome}); preserved previous cache at ${cachePath}`);
