#!/usr/bin/env electron
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { KEY_RECORD_FILE, ensureCredentialMasterKey } = require('../credential-key-store');

async function main() {
  await app.whenReady();
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jiuzhang-safe-storage-'));
  try {
    const first = ensureCredentialMasterKey({ safeStorage, userDataPath });
    const second = ensureCredentialMasterKey({ safeStorage, userDataPath });
    const recordPath = path.join(userDataPath, 'security', KEY_RECORD_FILE);

    assert.equal(first.source, 'generated-device-store');
    assert.equal(second.source, 'device-store');
    assert.equal(second.value, first.value);
    assert.equal(fs.existsSync(recordPath), true);
    assert.equal(fs.readFileSync(recordPath, 'utf8').includes(first.value), false);
    console.log(`Electron credential key smoke passed (storage=${first.storageBackend}).`);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error.stack || error.message);
    app.exit(1);
  });
