#!/usr/bin/env node
import{spawnSync}from'node:child_process';import{existsSync}from'node:fs';import{resolve,dirname}from'node:path';const d=dirname(new URL(import.meta.url).pathname);const g=resolve(d,'../dist/gw');const[b,...a]=existsSync(g)?[g]:['bun',resolve(d,'../src/gw/cli/main.ts')];process.exit(spawnSync(b,[...a,'hook','stop-gate'],{stdio:'inherit'}).status??0);
