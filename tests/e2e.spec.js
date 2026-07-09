const { test, expect } = require('@playwright/test');

test('record -> generate mix -> playback uses generated mix', async ({ page }) => {
  await page.goto('/#freestyle');
  // Play beat
  const playBeat = page.locator('button', { hasText: 'Jouer le beat' }).first();
  await playBeat.click();
  await page.waitForTimeout(2000);

  // Click Mix Studio
  const mixBtn = page.locator('button', { hasText: 'Mix Studio' }).first();
  await mixBtn.click();
  await page.waitForTimeout(1000);

  // Click listen to recording (generate/prepare mix)
  const listen = page.locator('button', { hasText: "Écouter l'enregistrement" }).first();
  await listen.click();
  await page.waitForTimeout(4000);

  const last = await page.evaluate(() => window.lastStudioRecording || null);
  expect(last).not.toBeNull();
  expect(last.mixWavUrl).toBeTruthy();
});
