const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtimePath = path.join(
  __dirname,
  '..',
  'runtime',
  'wechat-native-runtime',
  'kaypal-wechat-native-runtime.js',
);
const localEnginePath = path.join(
  __dirname,
  '..',
  '..',
  'backend',
  'src',
  'modules',
  'local-engine',
  'local-engine.service.ts',
);
const helperPath = path.join(
  __dirname,
  '..',
  'runtime',
  'wechat-db-helper',
  'wechat-db-helper.js',
);

test('random and all contact modes allow the full memory-key discovery window', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const localEngineSource = fs.readFileSync(localEnginePath, 'utf8');
  const helperSource = fs.readFileSync(helperPath, 'utf8');
  const match = source.match(/const DB_HELPER_TIMEOUT_MS = (\d+);/);
  const outerMatch = localEngineSource.match(
    /const WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS = (\d+) \* 60 \* 1000;/,
  );

  assert.ok(match, 'runtime must define a shared DB helper timeout');
  assert.ok(outerMatch, 'local engine must define the random sync timeout');
  assert.ok(
    Number(match[1]) >= 240000,
    'runtime must leave cleanup margin above the helper memory-key scan budget',
  );
  assert.ok(
    Number(outerMatch[1]) * 60 * 1000 > Number(match[1]),
    'local engine timeout must exceed the packaged runtime timeout',
  );
  assert.match(source, /timeout: DB_HELPER_TIMEOUT_MS/);
  assert.doesNotMatch(
    source,
    /mode === ['"]all['"] \? 180000 : 45000/,
    'random mode must not use the obsolete 45-second helper timeout',
  );
  assert.match(source, /helperTimedOut = result\.error && result\.error\.code === 'ETIMEDOUT'/);
  assert.match(helperSource, /const MIN_STABLE_DECRYPTED_CACHE_BYTES = 4096;/);
  assert.match(helperSource, /PRAGMA quick_check;/);
  assert.match(
    helperSource,
    /stableDecryptedDbPath\(originalDbPath\), 'stable-path', \{[\s\S]+minimumBytes: MIN_STABLE_DECRYPTED_CACHE_BYTES/,
  );
});
