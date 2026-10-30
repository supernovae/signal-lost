import { expect, test } from './fixtures.ts';

test('startup makes no failed or off-site requests, and logs no errors', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const problems: string[] = [];
  page.on('requestfailed', (request) => problems.push(`failed: ${request.url()}`));
  page.on('response', (response) => {
    if (!response.ok()) problems.push(`${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== origin) {
      problems.push(`off-site: ${request.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`error: ${error.message}`));

  await page.goto('./');
  await expect(page.getByRole('log')).toContainText('PRESS ENTER TO JOIN THE NETWORK');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});
