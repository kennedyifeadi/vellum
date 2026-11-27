// Puppeteer ships ES modules only. Jest can require an ES module only on Node 24.9+, but Node
// 22 can itself, so tests load puppeteer through Node's own require, as the server does.
// Jest's `module` builtin returns Jest's require, hence the builtin straight from Node.
const { createRequire } = process.getBuiltinModule('node:module');

module.exports = createRequire(__filename)('puppeteer');
