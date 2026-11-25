import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { completeEpisode } from './helpers.ts';

const forgeTool = (page: Page) => page.getByRole('button', { name: /\] FORGE$/ });
const forms = [
  ['FILE A TRANSMISSION', 'propose-transmission.yml'],
  ['FILE AN ARCHIVE ENTRY', 'propose-archive-entry.yml'],
  ['PROPOSE A CHARACTER', 'propose-character.yml'],
  ['PROPOSE A BRANCHING ADVENTURE', 'propose-branching-adventure.yml'],
  ['PROPOSE A DOOR GAME', 'propose-door-game.yml'],
  ['PROPOSE A NETWORK LOCATION', 'propose-network-location.yml'],
  ['PROPOSE A MECHANIC IMPROVEMENT', 'propose-mechanic-improvement.yml'],
] as const;

async function expectProposalLinks(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'FORGE', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(forms.length);
  for (const [name, template] of forms) {
    const link = nav.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      `https://github.com/supernovae/signal-lost/issues/new?template=${template}`,
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
}

async function unlockServicePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /NETWORK MAP/ }).click();
  await page.getByRole('button', { name: 'RELAY 07', exact: true }).click();
  await page.getByLabel('SERVICE CODE').fill('709');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('ITS POWER LIGHT COMES ON');
}

test('FORGE opens from the service panel and leads to the filing office', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  const log = page.getByRole('log');
  await expect(forgeTool(page)).toHaveCount(0);

  await unlockServicePanel(page);
  await forgeTool(page).click();
  await expect(log).toContainText('THIS NETWORK ACCEPTS NEW TRANSMISSIONS');
  await expect(log).toContainText("It isn't a place in my world");
  await expectProposalLinks(page);
  await expect(page.getByRole('region', { name: 'Real contributor credits' })).toContainText(
    'SIGNAL//LOST maintainers (supernovae)',
  );

  // A record nobody remembers writing, with a name on it.
  await page.getByRole('button', { name: /TRANSMISSIONS/ }).click();
  await expect(log).toContainText('TX-C01  FIRST LIGHT');
  await expect(log).toContainText('FILED BY: SIGNAL//LOST maintainers (supernovae)');
  await page.getByRole('button', { name: /\] ARCHIVE$/ }).click();
  await page.getByRole('button', { name: /IS ANYONE ELSE ON THIS LINE/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('FILED BY');
  await expect(log).toContainText('Nobody I remember wrote it');
});

test('discovers FORGE through the BBS Directory and reads real credits', async ({
  page,
  baseURL,
}) => {
  const offSite: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== new URL(baseURL!).origin) {
      offSite.push(url.href);
    }
  });
  await page.goto('./');
  await page.keyboard.press('Enter');
  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  await expect(forgeTool(page)).toHaveCount(0);
  await page.getByRole('button', { name: /\] CONNECT$/ }).click();
  await page.getByRole('button', { name: /USE DESIGNATION/ }).click();

  const log = page.getByRole('log');
  await expect(log).toContainText('DIRECTORY / FORGE takes proposals.');
  await page.getByRole('button', { name: 'MESSAGES', exact: true }).click();
  await page.getByRole('button', { name: /LAST ONE OUT/ }).click();
  const post = log.locator('.bbs-output').filter({ hasText: 'LAST ONE OUT' });
  await expect(post.getByText('FICTIONAL', { exact: true })).toBeVisible();
  await expect(post).toContainText('TKEEL');
  await expect(post).not.toContainText('SIGNAL//LOST maintainers');
  await expect(post).toHaveCSS('border-inline-start-style', 'double');

  await page.getByRole('button', { name: 'MAIN MENU', exact: true }).click();
  await page.getByRole('button', { name: 'DIRECTORY', exact: true }).click();
  const openForge = page.getByRole('button', { name: '[OPEN forge] FORGE', exact: true });
  await expect(openForge).toBeVisible();
  const prompt = page.getByLabel('BBS>');
  await expect(prompt).toBeFocused();
  await page.keyboard.type('OPEN forge');
  await page.keyboard.press('Enter');

  await expectProposalLinks(page);
  const credits = page.getByRole('region', { name: 'Real contributor credits' });
  await expect(credits).toBeVisible();
  await expect(log.getByRole('region', { name: 'Real contributor credits' })).toHaveCount(0);
  await expect(credits).toContainText('From reviewed content.');
  await expect(credits).toContainText('Only maintainers are credited so far.');
  const maintainer = credits.getByRole('listitem');
  await expect(maintainer).toHaveText('SIGNAL//LOST maintainers (supernovae)');
  await expect(credits).not.toContainText('TKEEL');
  await expect(credits).toHaveCSS('border-inline-start-style', 'solid');

  await page.setViewportSize({ width: 390, height: 844 });
  await maintainer.scrollIntoViewIfNeeded();
  await expect(maintainer).toBeInViewport();
  await expect(prompt).toBeFocused();
  const controls = await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button')
    .count();
  for (let i = 0; i <= controls; i++) await page.keyboard.press('Shift+Tab');
  const lastForm = page.getByRole('link', { name: 'PROPOSE A MECHANIC IMPROVEMENT' });
  await expect(lastForm).toBeFocused();
  await expect(lastForm).toBeInViewport();
  await expect(lastForm).toHaveCSS('outline-style', 'solid');
  expect(offSite).toEqual([]);

  await page.getByRole('button', { name: 'BACK', exact: true }).click();
  await expect(openForge).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'FORGE', exact: true })).toHaveCount(0);
  await expect(credits).toHaveCount(0);
  await expect(prompt).toBeFocused();
  await openForge.click();
  await page.getByRole('button', { name: 'DISCONNECT', exact: true }).click();
  await expect(page.getByLabel('OBS>')).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'FORGE', exact: true })).toHaveCount(0);
  await expect(forgeTool(page)).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await unlockServicePanel(page);
  await forgeTool(page).click();
  await expect(log).toContainText("It isn't a place in my world");
});
