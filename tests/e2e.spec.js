const { test, expect } = require('@playwright/test');

test('record -> generate mix -> playback uses generated mix (fixture)', async ({ page }) => {
  // Navigate to deterministic fixture that simulates mix generation
  await page.goto('http://127.0.0.1:8000/tests/fixtures/mix_stub.html', { waitUntil: 'domcontentloaded' });

  // Ensure stub helper exists
  await page.waitForFunction(() => typeof window.prepareStudioMixPlayback === 'function', { timeout: 3000 });

  // Call the helper and wait for lastStudioRecording to be populated
  await page.evaluate(() => window.prepareStudioMixPlayback(null));
  await page.waitForFunction(() => !!(window.lastStudioRecording && window.lastStudioRecording.mixWavUrl), { timeout: 3000 });

  const last = await page.evaluate(() => window.lastStudioRecording || null);
  expect(last).not.toBeNull();
  expect(last.mixWavUrl).toBeTruthy();
});
