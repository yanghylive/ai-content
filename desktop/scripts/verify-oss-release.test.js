const assert = require('assert/strict');
const test = require('node:test');

const {
  FEED_DEFINITIONS,
  parseLatestYml,
  remoteFeedDefinitions,
} = require('./verify-oss-release');

test('OSS release verification covers the supported update channels', () => {
  // v1.1.110（复核 / 大王决策）：Linux 退出产品范围，远端门禁只查 Win/Mac。
  assert.deepEqual(
    FEED_DEFINITIONS.map((feed) => feed.name),
    ['latest.yml', 'latest-mac.yml'],
  );
  assert.deepEqual(
    remoteFeedDefinitions.map((feed) => feed.name),
    ['latest.yml', 'latest-mac.yml'],
  );
  assert.equal(FEED_DEFINITIONS.find((feed) => feed.name === 'latest.yml').requiresBlockmap, true);
  assert.equal(FEED_DEFINITIONS.find((feed) => feed.name === 'latest-mac.yml').requiresBlockmap, true);
});

test('latest feed parser keeps version, path, size and sha512 metadata', () => {
  assert.deepEqual(
    parseLatestYml(
      'version: 1.2.3\npath: My App-1.2.3.AppImage\nsha512: abc123\nsize: 42\n',
    ),
    { version: '1.2.3', path: 'My App-1.2.3.AppImage', sha512: 'abc123', size: 42 },
  );
});
