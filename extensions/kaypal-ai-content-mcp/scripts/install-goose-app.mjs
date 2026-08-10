#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createKaypalAiContentAppHtml,
  createKaypalAiContentAppMetadata,
  KAYPAL_AI_CONTENT_APP_URI,
} from '../dist/app-resource.js';

const cacheDir = join(homedir(), '.config', 'goose', 'mcp-apps-cache');
const uri = KAYPAL_AI_CONTENT_APP_URI;
const fileName = `apps_${createHash('sha256').update(uri).digest('hex')}.json`;
const filePath = join(cacheDir, fileName);

const app = {
  ...createKaypalAiContentAppMetadata(),
  text: createKaypalAiContentAppHtml(),
};

mkdirSync(cacheDir, { recursive: true });
writeFileSync(filePath, `${JSON.stringify(app, null, 2)}\n`, 'utf8');

console.log(`Installed Goose app: ${filePath}`);
console.log(`URI: ${uri}`);
