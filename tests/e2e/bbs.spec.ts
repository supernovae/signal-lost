import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { freshSave } from '../../src/progress/save.ts';
import { expect, test } from './fixtures.ts';
import { SAVE_KEY, seedSaveOnce } from './helpers.ts';

const completedV1 = readFileSync(
  new URL('../fixtures/episode-000-complete-v1.json', import.meta.url),
  'utf8',
);
const connect = (page: Page) => page.getByRole('button', { name: /\] CONNECT$/ });

async function joinWithEnter(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Join the network' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('OBS>')).toBeFocused();
}

async function typeCommand(page: Page, prompt: 'OBS>' | 'BBS>', command: string): Promise<void> {
  await expect(page.getByLabel(prompt)).toBeFocused();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

test('keyboard first contact from a migrated completed save', async ({ page }) => {
  await seedSaveOnce(page, completedV1);
  await page.goto('./');
  await joinWithEnter(page);
  const log = page.getByRole('log');
  await expect(log).toContainText('INCOMING CONNECTION: DEEP FIELD');
  await expect(connect(page)).toBeVisible();

  await typeCommand(page, 'OBS>', 'CONNECT');
  await expect(log).toContainText('OBSERVER NETWORK RELAY 07');
  await typeCommand(page, 'BBS>', 'HELP');
  await expect(log.locator('.system').last()).toContainText('LOGIN <HANDLE>');
  await typeCommand(page, 'BBS>', 'DESIGNATION');
  await expect(log).toContainText('SIGNED IN AS OBS-02FF');
  await typeCommand(page, 'BBS>', 'MESSAGES');
  await expect(log).toContainText('READ <NUMBER>');
  await typeCommand(page, 'BBS>', 'READ 1');
  await expect(log).toContainText("I'm leaving the modem plugged in.");
  await typeCommand(page, 'BBS>', 'MENU');
  await typeCommand(page, 'BBS>', 'SYSOP');
  await expect(log.locator('.sysop')).toContainText('I am the local preservation routine.');
  await typeCommand(page, 'BBS>', 'DISCONNECT');
  await expect(page.getByLabel('OBS>')).toBeFocused();
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');

  await typeCommand(page, 'OBS>', 'CONNECT');
  await expect(log).toContainText('OBSERVER NETWORK RELAY 07');
  await typeCommand(page, 'BBS>', 'LOGIN RelayFinch');
  await expect(log).toContainText('SIGNED IN AS RelayFinch');
  await typeCommand(page, 'BBS>', 'DISCONNECT');
  await expect(page.getByLabel('OBS>')).toBeFocused();
});

test('clickable first contact keeps the custom handle and message progress after reload', async ({
  page,
}) => {
  const data = freshSave(42);
  data.episodes.push('episode.000');
  data.profile.designation = 'OBS-0001';
  await seedSaveOnce(page, JSON.stringify(data));
  await page.goto('./');
  await joinWithEnter(page);

  await page.addStyleTag({
    content: 'body[data-scene="bbs"] :is(.system, .history, .sysop) { color: white !important; }',
  });
  const log = page.getByRole('log');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const handle = page.getByLabel('FICTIONAL HANDLE');
  await connect(page).click();
  await expect(page.getByLabel('BBS>')).toBeFocused();
  await expect(log.getByText(/TYPE DESIGNATION OR LOGIN/)).toBeVisible();
  const system = log.locator('.system').first();
  await expect(system.getByText('SYSTEM', { exact: true })).toBeVisible();
  await expect(system).toHaveCSS('color', 'rgb(255, 255, 255)');
  await button('HELP').click();
  await expect(log.locator('.system').last()).toContainText('LOGIN <HANDLE>');

  await button('CUSTOM HANDLE').click();
  await expect(handle).toBeFocused();
  await handle.fill('   ');
  await button('SIGN IN').click();
  await expect(log).toContainText('ENTER A FICTIONAL HANDLE.');
  await expect(handle).toBeFocused();
  await handle.fill('  <b>Relay</b>  ');
  await button('SIGN IN').click();
  await expect(log.getByText('SIGNED IN AS <b>Relay</b>', { exact: true })).toBeVisible();
  await expect(log.locator('b')).toHaveCount(0);
  await expect(handle).toHaveCount(0);
  await button('MESSAGES').click();
  await expect(log.getByText(/TYPE READ <NUMBER>/)).toBeVisible();
  await button('[READ 1] LAST ONE OUT [UNREAD]').click();
  const history = log.locator('.history');
  await expect(history.getByText('HISTORICAL MESSAGE', { exact: true })).toBeVisible();
  await expect(history.getByText('FROM: TKEEL', { exact: true })).toBeVisible();
  await expect(history.getByText('DATE: 2001-03-01', { exact: true })).toBeVisible();
  await expect(history).toHaveCSS('color', 'rgb(255, 255, 255)');

  await button('MAIN MENU').click();
  await button('SYSOP').click();
  const sysop = log.locator('.sysop');
  await expect(sysop.getByText('SYSOP', { exact: true })).toBeVisible();
  await expect(sysop).toHaveCSS('color', 'rgb(255, 255, 255)');
  await button('DISCONNECT').click();
  await expect(page.getByLabel('OBS>')).toBeFocused();
  await page.getByRole('button', { name: /\] STATUS$/ }).click();
  await expect(log.getByText('HANDLE: <b>Relay</b>', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /\] SETTINGS$/ }).click();
  await expect(page.getByLabel('SOUND MUTED')).toBeVisible();

  await page.reload();
  await joinWithEnter(page);
  await connect(page).click();
  await button('CUSTOM HANDLE').click();
  await expect(handle).toHaveValue('<b>Relay</b>');
  await button('USE DESIGNATION (OBS-0001)').click();
  await expect(log).toContainText('SIGNED IN AS OBS-0001');
  await button('MESSAGES').click();
  await expect(button('[READ 1] LAST ONE OUT [READ]')).toBeVisible();
  await expect(log.locator('.history')).toHaveCount(0);
  await button('DISCONNECT').click();
  await expect(page.getByLabel('OBS>')).toBeFocused();

  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(saved!)).toMatchObject({
    profile: { handle: '<b>Relay</b>', designation: 'OBS-0001' },
    bbsReadMessages: ['archive:lore.last-sysop'],
    archives: [],
  });
});
