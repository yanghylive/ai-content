#!/usr/bin/env node

console.error(
  'KaypalAI one-click desktop packages must not publish external dependency installers. Bundle the required runtime resources inside the app package instead.',
);
process.exit(1);
