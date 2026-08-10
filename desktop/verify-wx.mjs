import { extractFile } from '@electron/asar';
const asarPath = '/Users/yanghy/Documents/New project/ai-content/desktop/dist/win-unpacked/resources/app.asar';
import fs from 'fs';
const files = extractFile(asarPath, 'frontend/_next/static/chunks'); // dir not supported; scan by listing
