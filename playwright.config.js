/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  timeout: 120000,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:8000',
    viewport: { width: 1280, height: 800 },
  },
  testDir: 'tests'
};
