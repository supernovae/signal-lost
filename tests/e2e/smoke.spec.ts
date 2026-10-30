import { expect, test } from './fixtures.ts';

test('the production build boots under the Pages subpath', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toContainText('SIGNAL RECEIVED');
});
