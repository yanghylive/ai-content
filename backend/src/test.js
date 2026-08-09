const OpenAI = require('openai');
const client = new OpenAI({ apiKey: 'test', baseURL: 'http://localhost:9999' });
client.images.generate({ model: 'x', prompt: 'y', ratio: '16:9', extra_body: { ratio: '16:9' } }, { query: { foo: 'bar' } }).catch(() => {});
