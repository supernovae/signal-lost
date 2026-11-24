import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import relayTrivia from '../../content/doors/relay-trivia.json' with { type: 'json' };
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

async function activateBbsButton(page: Page, input: 'keyboard' | 'pointer', name: string) {
  const target = page.getByRole('button', { name, exact: true });
  await expect(target).toBeVisible();
  if (input === 'pointer') {
    await target.click();
    return;
  }
  await expect(page.getByLabel('BBS>')).toBeFocused();
  const controls = await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button')
    .count();
  for (let i = 0; i < controls; i++) {
    await page.keyboard.press('Shift+Tab');
    if (await target.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await page.keyboard.press('Enter');
}

test('keyboard first contact and relay trivia from a migrated completed save', async ({ page }) => {
  await seedSaveOnce(page, completedV1);
  await page.goto('./');
  await joinWithEnter(page);
  const log = page.getByRole('log');
  const system = log.locator('.system').last();
  await expect(log).toContainText('INCOMING CONNECTION: DEEP FIELD');
  await expect(connect(page)).toBeVisible();
  await typeCommand(page, 'OBS>', 'STATUS');
  await expect(log.locator('p.dim').last()).toHaveText('ACCESS LEVEL: RELAY');

  await typeCommand(page, 'OBS>', 'CONNECT');
  await expect(log).toContainText('OBSERVER NETWORK RELAY 07');
  await typeCommand(page, 'BBS>', 'HELP');
  await expect(log.locator('.system').last()).toContainText('LOGIN <HANDLE>');
  await typeCommand(page, 'BBS>', 'DESIGNATION');
  await expect(log).toContainText('SIGNED IN AS OBS-02FF');
  await expect(system).toContainText('DEEP FIELD MAIN MENU');
  await expect(system).toContainText('ACCESS LEVEL: RELAY');
  await typeCommand(page, 'BBS>', 'MESSAGES');
  await expect(log).toContainText('READ <NUMBER>');
  await typeCommand(page, 'BBS>', 'READ 1');
  await expect(log).toContainText("I'm leaving the modem plugged in.");
  await typeCommand(page, 'BBS>', 'MENU');
  await typeCommand(page, 'BBS>', 'SYSOP');
  await expect(log.locator('.sysop')).toContainText('I am the local preservation routine.');
  await typeCommand(page, 'BBS>', 'MENU');
  await expect(log).not.toContainText('RELAY DRILL: COMPLETE');
  await typeCommand(page, 'BBS>', 'DOORS');
  const door = log.locator('.door').last();
  await expect(door).toContainText('DEEP FIELD DOOR DIRECTORY');
  await typeCommand(page, 'BBS>', 'OPEN relay-trivia');
  await expect(door).toContainText('Which port gets the dummy load for a bench-only test?');
  await typeCommand(page, 'BBS>', '2');
  await expect(door).toContainText('Which kit lets you monitor the receiver');
  await typeCommand(page, 'BBS>', '1');
  await expect(door).toContainText('DRILL COMPLETE. TRAINING RECORD LOGGED.');
  await typeCommand(page, 'BBS>', 'EXIT');
  await expect(system).toContainText('DEEP FIELD MAIN MENU');
  await expect(system).toContainText('RELAY DRILL: COMPLETE');
  await expect(page.getByLabel('BBS>')).toBeFocused();
  await expect(log.getByText('SIGNED IN AS OBS-02FF', { exact: true })).toHaveCount(1);

  await page.reload();
  await joinWithEnter(page);
  await typeCommand(page, 'OBS>', 'CONNECT');
  await typeCommand(page, 'BBS>', 'DESIGNATION');
  await expect(system).toContainText('RELAY DRILL: COMPLETE');
  await typeCommand(page, 'BBS>', 'MESSAGES');
  await expect(page.getByRole('button', { name: '[READ 1] LAST ONE OUT [READ]' })).toBeVisible();
  await typeCommand(page, 'BBS>', 'MENU');
  await typeCommand(page, 'BBS>', 'DOORS');
  await typeCommand(page, 'BBS>', 'OPEN relay-trivia');
  await expect(door).toContainText('DRILL COMPLETE. TRAINING RECORD LOGGED.');
  await typeCommand(page, 'BBS>', 'EXIT');
  await expect(system).toContainText('DEEP FIELD MAIN MENU');

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

  const log = page.getByRole('log');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const handle = page.getByLabel('FICTIONAL HANDLE');
  await connect(page).click();
  await expect(page.getByLabel('BBS>')).toBeFocused();
  await expect(log.getByText(/TYPE DESIGNATION OR LOGIN/)).toBeVisible();
  const system = log.locator('.system').first();
  await expect(system.getByText('SYSTEM', { exact: true })).toBeVisible();
  await expect(system).toHaveCSS('color', 'rgb(255, 204, 123)');
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
  await expect(history).toHaveCSS('color', 'rgb(248, 217, 168)');

  await button('MAIN MENU').click();
  await button('SYSOP').click();
  const sysop = log.locator('.sysop');
  await expect(sysop.getByText('SYSOP', { exact: true })).toBeVisible();
  await expect(sysop).toHaveCSS('color', 'rgb(243, 192, 255)');
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
  await expect(handle).toHaveCSS('text-transform', 'none');
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

test('posts a new bulletin after reading the relay note', async ({ page }) => {
  await seedSaveOnce(page, completedV1);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const receipt = page.getByRole('button', { name: /Relay desk receipt/ });
  const unread = button('[READ 2] Relay desk receipt [NEW]');
  async function openMessages() {
    await joinWithEnter(page);
    await connect(page).click();
    await button('USE DESIGNATION (OBS-02FF)').click();
    await button('MESSAGES').click();
    await expect(button('[READ 1] LAST ONE OUT [UNREAD]')).toBeVisible();
  }

  await page.goto('./');
  await openMessages();
  await expect(receipt).toHaveCount(0);
  await button('MAIN MENU').click();
  await button('BOARDS').click();
  await button('GENERAL').click();
  await button('Relay desk notes').click();
  const log = page.getByRole('log');
  await expect(log.locator('.ai-fictional')).toContainText('A note at the relay desk');
  await button('MAIN MENU').click();
  await button('MESSAGES').click();
  await expect(receipt).toHaveCount(1);
  await expect(unread).toBeVisible();

  await page.reload();
  await openMessages();
  await expect(receipt).toHaveCount(1);
  await expect(unread).toBeVisible();
  await unread.click();
  await expect(log).toContainText('Local receipt filed for the relay desk note.');
  await button('BACK').click();
  await expect(button('[READ 2] Relay desk receipt [READ]')).toBeVisible();
});

for (const input of ['keyboard', 'pointer'] as const) {
  test(`SECOND LINE denies and grants access through ${input} controls`, async ({ page }) => {
    const beforeRelay = JSON.parse(completedV1) as { puzzles: string[]; flags: string[] };
    beforeRelay.puzzles = beforeRelay.puzzles.filter((id) => id !== 'puzzle.service');
    beforeRelay.flags = beforeRelay.flags.filter(
      (id) => id !== 'service-panel-open' && id !== 'forge-opened',
    );
    await seedSaveOnce(page, JSON.stringify(beforeRelay));
    await page.goto('./');
    const log = page.getByRole('log');
    const latestMenu = log.locator('.system').last();
    const latestDenial = log.locator('.restricted').last();
    const denial = 'SECOND LINE SWITCHBOARD: CARRIER HELD. RELAY CLEARANCE REQUIRED.';
    const thread = 'A note from the second line';
    const activate = (name: string) => activateBbsButton(page, input, name);

    async function joinAndSignIn(level: string) {
      await joinWithEnter(page);
      if (input === 'keyboard') await typeCommand(page, 'OBS>', 'CONNECT');
      else await connect(page).click();
      await activate('USE DESIGNATION (OBS-02FF)');
      await expect(latestMenu).toContainText('DEEP FIELD MAIN MENU');
      await expect(latestMenu).toContainText(`ACCESS LEVEL: ${level}`);
    }

    async function readSecondLine() {
      await activate('BOARDS');
      await activate('SECOND LINE');
      await activate(thread);
      const post = log.locator('.recovered').last();
      await expect(post).toContainText('IS ANYONE ELSE ON THIS LINE');
      await expect(post).toContainText('FILED BY: SIGNAL//LOST maintainers (supernovae)');
    }

    await joinAndSignIn('VISITOR');
    await activate('BOARDS');
    if (input === 'keyboard') {
      await typeCommand(page, 'BBS>', 'BOARD second-line');
      await expect(latestDenial).toContainText(denial);
    }
    const denials = log.locator('.restricted');
    const countBeforeButton = input === 'keyboard' ? 1 : 0;
    await activate('SECOND LINE');
    await expect(denials).toHaveCount(countBeforeButton + 1);
    await expect(latestDenial).toContainText(denial);
    await expect(page.getByRole('button', { name: thread })).toHaveCount(0);

    await activate('MAIN MENU');
    await activate('DOORS');
    await activate(`[OPEN ${relayTrivia.id}] ${relayTrivia.name}`);
    for (const question of relayTrivia.questions) {
      await activate(`[${question.answer + 1}] ${question.options[question.answer]}`);
    }
    await expect(log.locator('.door').last()).toContainText(relayTrivia.success[0]!);
    await activate('EXIT');
    await expect(latestMenu).toContainText('DEEP FIELD MAIN MENU');
    await expect(latestMenu).toContainText('ACCESS LEVEL: RELAY');
    await expect(latestMenu).toContainText('RELAY DRILL: COMPLETE');
    await readSecondLine();

    await activate('DISCONNECT');
    await typeCommand(page, 'OBS>', 'STATUS');
    await expect(log.locator('p.dim').last()).toHaveText('ACCESS LEVEL: RELAY');
    const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    expect(JSON.parse(saved!).flags).toEqual(['relay-trivia-complete']);

    await page.reload();
    await joinAndSignIn('RELAY');
    await readSecondLine();
  });

  test(`BBS navigation and local progress from the ${input}`, async ({ page }) => {
    if (input === 'keyboard') await page.setViewportSize({ width: 360, height: 640 });
    await seedSaveOnce(page, completedV1);
    await page.goto('./');
    await joinWithEnter(page);
    const prompt = page.getByLabel('BBS>');
    const log = page.getByRole('log');
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const activate = (name: string) => activateBbsButton(page, input, name);

    async function signIn() {
      if (input === 'keyboard') await typeCommand(page, 'OBS>', 'CONNECT');
      else await connect(page).click();
      await activate('USE DESIGNATION (OBS-02FF)');
      await expect(prompt).toBeFocused();
    }
    async function goToThread() {
      await activate('BOARDS');
      if (input === 'keyboard') await typeCommand(page, 'BBS>', 'BOARD general');
      else await activate('GENERAL');
      await activate('Relay desk notes');
      await expect(prompt).toBeFocused();
    }

    await signIn();
    await goToThread();
    await expect(log.locator('.ai-fictional')).toContainText('type LINECHECK');
    const fictional = log.locator('.ai-fictional').getByText('FICTIONAL', { exact: true });
    await expect(fictional).toBeVisible();
    await expect(fictional).toHaveCSS('background-color', 'rgb(53, 35, 25)');
    await activate('HELP');
    await expect(log.locator('.system').last()).not.toContainText(/LINECHECK/i);
    await expect(button('LINECHECK')).toHaveCount(0);
    await typeCommand(page, 'BBS>', 'LiNeChEcK');
    await expect(log.locator('.private').last()).toContainText('LOCAL LINE CHECK COMPLETE.');
    await activate('Acknowledge the note');
    await expect(log.locator('.private').last()).toContainText('Receipt filed');
    await expect(button('Acknowledge the note')).toHaveAttribute('aria-pressed', 'true');
    await expect(button('Leave the note pending')).toBeDisabled();

    await activate('BACK');
    await activate('BACK');
    await activate('SECOND LINE');
    await activate('A note from the second line');
    const recovered = log.locator('.recovered');
    const reviewed = recovered.getByText('REVIEWED COMMUNITY CONTRIBUTION');
    await expect(reviewed).toBeVisible();
    await expect(reviewed).toHaveCSS('background-color', 'rgb(21, 53, 44)');
    await expect(recovered).toContainText('FILED BY: SIGNAL//LOST maintainers (supernovae)');
    await activate('MAIN MENU');

    await activate('PEOPLE');
    await activate('ECHO');
    await expect(log.locator('.history')).toContainText('Its messages are scripted records');
    await activate('BACK');
    await expect(button('ECHO')).toBeVisible();
    await activate('MAIN MENU');

    await activate('DIRECTORY');
    await activate('DOORS');
    await expect(log.locator('.door')).toContainText('RELAY TRIVIA');
    await activate('BACK');
    await activate('NETWORK');
    await expect(log.locator('.restricted')).toContainText('SILENT OBSERVATORY | RESTRICTED');
    await activate('MAIN MENU');
    await activate('HISTORY');
    await expect(log.locator('.system').last()).toContainText(
      'Replied in Relay desk notes: Acknowledge the note',
    );
    await activate('MAIN MENU');

    await activate('SETTINGS');
    const theme = page.getByLabel('BBS THEME');
    await expect(theme).toBeFocused();
    if (input === 'keyboard') {
      await theme.press('ArrowDown');
      await theme.press('ArrowDown');
    } else {
      await theme.selectOption('high-readability');
    }
    await expect(theme).toHaveValue('high-readability');
    await expect(theme).toHaveCSS('background-color', 'rgb(27, 32, 40)');
    await expect(log).toHaveCSS('background-color', 'rgb(16, 18, 22)');
    await expect(log.locator('.ai-fictional')).toHaveCSS('color', 'rgb(243, 220, 255)');
    if (input === 'keyboard') {
      for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
      await expect(button('CLOSE')).toBeFocused();
      await page.keyboard.press('Enter');
    } else {
      await button('CLOSE').click();
    }
    await expect(prompt).toBeFocused();

    await page.reload();
    await joinWithEnter(page);
    await signIn();
    await goToThread();
    await expect(log.getByText('Receipt filed', { exact: true })).toHaveCount(1);
    await expect(button('Acknowledge the note')).toHaveAttribute('aria-pressed', 'true');
    await expect(log.locator('.ai-fictional')).toHaveCSS('color', 'rgb(243, 220, 255)');
    await typeCommand(page, 'BBS>', 'LINECHECK');
    await expect(log.locator('.private').last()).toContainText(
      'ALREADY DISCOVERED ON THIS TERMINAL.',
    );
    await activate('MAIN MENU');
    await activate('HISTORY');
    const history = log.locator('.system').last();
    await expect(history.getByText('Discovered: LINECHECK', { exact: true })).toHaveCount(1);
    await expect(history.getByText('Viewed profile: ECHO', { exact: true })).toBeVisible();
    await expect(history.getByText('Viewed network directory', { exact: true })).toBeVisible();
    await activate('MAIN MENU');
    await activate('SETTINGS');
    await expect(theme).toHaveValue('high-readability');
  });
}

test('a refused reply save shows in-tab feedback and preserves stored bytes', async ({ page }) => {
  await seedSaveOnce(page, completedV1);
  await page.goto('./');
  await joinWithEnter(page);
  await typeCommand(page, 'OBS>', 'CONNECT');
  for (const command of ['DESIGNATION', 'BOARDS', 'BOARD general', 'THREAD relay-thread']) {
    await typeCommand(page, 'BBS>', command);
  }
  const prior = await page.evaluate((key) => {
    Storage.prototype.setItem = () => {
      throw new Error('storage refused write');
    };
    return localStorage.getItem(key);
  }, SAVE_KEY);
  await typeCommand(page, 'BBS>', 'REPLY defer');
  await expect(page.getByRole('log').locator('.network-error')).toContainText(
    'LOCAL SAVE UNAVAILABLE. THIS ACTION IS KEPT IN THIS TAB.',
  );
  await expect(page.getByRole('button', { name: 'Leave the note pending' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(prior);
});
