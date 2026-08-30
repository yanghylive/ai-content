const assert = require('assert/strict');
const test = require('node:test');

const {
  FEED_DEFINITIONS,
  parseLatestYml,
  remoteFeedDefinitions,
} = require('./verify-oss-release');

test('OSS release verification covers all update channels', () => {
  assert.deepEqual(
    FEED_DEFINITIONS.map((feed) => feed.name),
    ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'],
  );
  assert.deepEqual(
    remoteFeedDefinitions.map((feed) => feed.name),
    ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'],
  );
  assert.equal(FEED_DEFINITIONS.find((feed) => feed.name === 'latest.yml').requiresBlockmap, true);
  assert.equal(FEED_DEFINITIONS.find((feed) => feed.name === 'latest-mac.yml').requiresBlockmap, true);
  assert.equal(FEED_DEFINITIONS.find((feed) => feed.name === 'latest-linux.yml').requiresBlockmap, false);
});

test('latest feed parser keeps version, path, size and sha512 metadata', () => {
  assert.deepEqual(
    parseLatestYml(
      'version: 1.2.3\npath: My App-1.2.3.AppImage\nsha512: abc123\nsize: 42\n',
    ),
    { version: '1.2.3', path: 'My App-1.2.3.AppImage', sha512: 'abc123', size: 42 },
  );
});
