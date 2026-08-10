const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CommandFailure,
  executeBuild,
  hostBuildPlatform,
  normalizeReleaseChannel,
  run,
  runWindowsBuildSteps,
} = require('./build-win-full');

const restoreLabels = [
  'Restore host SQLite and Prisma bundle after Windows packaging',
  'Prune foreign Prisma engines after Windows packaging',
  'Restore host Node runtime after Windows packaging',
  'Restore host media tools after Windows packaging',
  'Restore host Playwright Chromium after Windows packaging',
];

test('run throws a CommandFailure with the child exit code', () => {
  assert.throws(
    () => run('intentional fixture failure', process.execPath, ['-e', 'process.exit(23)'], { stdio: 'ignore' }),
    (error) => error instanceof CommandFailure && error.exitCode === 23,
  );
});

test('host build platform resolves supported non-Windows staging targets', () => {
  assert.equal(hostBuildPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(hostBuildPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(hostBuildPlatform('linux', 'x64'), 'linux-x64');
});

test('testing channel creates testing config and does not apply the commercial signature gate', () => {
  const calls = [];
  runWindowsBuildSteps(
    (label, command, args, options) => {
      calls.push({ label, command, args, options });
    },
    { releaseChannel: 'testing' },
  );

  const prepare = calls.find((call) => call.label === 'Prepare testing release config');
  assert.ok(prepare);
  assert.deepEqual(prepare.args, ['scripts/prepare-release-config.js', '--testing']);
  assert.equal(prepare.options.env.KAYPAL_RELEASE_CHANNEL, 'testing');
  assert.equal(
    calls.some((call) => call.label === 'Verify Windows installer Authenticode signature'),
    false,
  );
  assert.equal(normalizeReleaseChannel('testing'), 'testing');
  assert.throws(() => normalizeReleaseChannel('preview'), /unsupported Windows release channel/);
});

test('build failure restores every host staging area and preserves the build exit code', () => {
  const calls = [];
  const buildError = new CommandFailure('Build Windows installer', 37);
  const restoreError = new CommandFailure('Restore host Node runtime after Windows packaging', 19);

  assert.throws(
    () =>
      executeBuild({
        platform: 'darwin',
        arch: 'arm64',
        runCommand(label, command, args, options) {
          calls.push({ label, command, args, options });
          if (label === 'Build Windows installer') throw buildError;
          if (label === 'Restore host Node runtime after Windows packaging') throw restoreError;
        },
      }),
    (error) =>
      error === buildError &&
      error.exitCode === 37 &&
      error.restoreError?.exitCode === 19,
  );

  assert.deepEqual(
    calls.filter((call) => restoreLabels.includes(call.label)).map((call) => call.label),
    restoreLabels,
  );
  for (const call of calls.filter((item) => restoreLabels.includes(item.label))) {
    assert.equal(call.options.env.BUILD_PLATFORM, 'mac-arm64');
  }
});

test('successful build still runs all restores and reports a restore failure after all attempts', () => {
  const calls = [];
  assert.throws(
    () =>
      executeBuild({
        platform: 'darwin',
        arch: 'x64',
        runCommand(label, command, args, options) {
          calls.push({ label, command, args, options });
          if (label === 'Restore host SQLite and Prisma bundle after Windows packaging') {
            throw new CommandFailure(label, 29);
          }
        },
      }),
    (error) => error.name === 'RestoreFailure' && error.exitCode === 29,
  );

  assert.deepEqual(
    calls.filter((call) => restoreLabels.includes(call.label)).map((call) => call.label),
    restoreLabels,
  );
});

test('native Windows builds do not run host staging restores', () => {
  const labels = [];
  executeBuild({
    platform: 'win32',
    arch: 'x64',
    runCommand(label) {
      labels.push(label);
    },
  });
  assert.equal(labels.some((label) => restoreLabels.includes(label)), false);
});
