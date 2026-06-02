const path = require('path');
const { spawnSync } = require('child_process');

const electronBuilderBin = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const result = spawnSync(
  electronBuilderBin,
  [
    '--publish',
    'always',
    '--config.publish.provider=generic',
    `--config.publish.url=${process.env.AI_CONTENT_UPDATE_URL}`,
    '--config.publish.channel=latest',
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  }
);

process.exit(result.status ?? 1);
