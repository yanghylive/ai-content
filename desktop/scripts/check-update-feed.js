try {
  const updateUrl = process.env.AI_CONTENT_UPDATE_URL || '';
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

console.log(`Release update feed: ${process.env.AI_CONTENT_UPDATE_URL}`);
