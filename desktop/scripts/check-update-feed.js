const fs = require('fs');
const path = require('path');

function configuredUpdateUrl() {
  if (process.env.AI_CONTENT_UPDATE_URL) {
    return process.env.AI_CONTENT_UPDATE_URL;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    return pkg?.build?.publish?.url || '';
  } catch {
    return '';
  }
}

try {
  const updateUrl = configuredUpdateUrl();
  const parsed = new URL(updateUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('update feed must use HTTPS');
  }
  if (parsed.hostname.includes('your-server') || parsed.hostname.includes('your-domain')) {
    throw new Error('placeholder domains are not allowed');
  }
} catch (err) {
  console.error(`Release blocked: AI_CONTENT_UPDATE_URL must be a real HTTPS generic update feed base URL, for example https://updates.example.com/updates/. ${err.message}`);
  process.exit(1);
}

console.log(`Release update feed: ${configuredUpdateUrl()}`);
