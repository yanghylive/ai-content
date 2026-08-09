const OpenAI = require('openai');
const client = new OpenAI({ apiKey: 'test', baseURL: 'http://localhost:9999/v1' });
client.images.generate(
  { model: 'jimeng', prompt: 'test' },
  { query: { a: 1 }, headers: { b: 2 }, body: { ratio: '16:9' } }
).catch(e => console.error(e.message));
