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

test('verifies Q17 from its headers and retains the confirmation after reload', async ({
  page,
}) => {
  await seedSaveOnce(page, completedV1);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const log = page.getByRole('log');
  const proof = page.getByRole('button', {
    name: /^\[READ \d+\] Q17 header confirmation \[READ\]$/,
  });
  const correction = 'Delivery is not authorship. I had those reversed.';

  async function signIn() {
    await joinWithEnter(page);
    await connect(page).click();
    await button('USE DESIGNATION (OBS-02FF)').click();
    await expect(log.locator('.system').last()).toContainText('DEEP FIELD MAIN MENU');
  }

  async function expectSavedProof() {
    const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    expect(JSON.parse(saved!)).toMatchObject({
      flags: expect.arrayContaining(['deferred-verified', 'deferred-headers-verified']),
      bbsReadMessages: expect.arrayContaining(['message:q17-header-confirmation']),
      events: { bulletins: ['q17-batch-located', 'q17-header-confirmation'] },
    });
  }

  await page.goto('./');
  await signIn();
  await button('BOARDS').click();
  await expect(button('Q17 HEADER DESK')).toHaveCount(0);
  await button('THE FORGOTTEN BOARD').click();
  await button('Delivered messages and queue index').click();
  await expect(log).toContainText('Queue receipt: Q17; search batch identifier.');
  await typeCommand(page, 'BBS>', 'SEARCH Q17');
  await expect(log).toContainText('Q17 batch located');
  await button('BACK').click();
  await button('Departure ledger').click();
  await expect(log).toContainText('GHOST last present on 2001-03-03 | checkpoint 121.');
  await button('BACK').click();
  await button('BACK').click();
  await button('Q17 HEADER DESK').click();
  await button('Q17 message headers').click();
  await expect(log).toContainText('P17 / PACKET | WRITTEN 2001-03-01 18:10 | DELIVERED 141');
  await typeCommand(page, 'BBS>', 'SUBMIT DEFERRED');
  await expect(log.locator('.system').last()).toContainText(
    'Read Departure ledger on THE FORGOTTEN BOARD, then Q17 message headers and Queue policy on this desk.',
  );
  await expect(log).not.toContainText('DEFERRED VERIFIED / HEADER ANALYSIS');
  await button('BACK').click();
  await button('Queue policy').click();
  await expect(log).toContainText('A migration-held record released unchanged is DEFERRED.');
  await typeCommand(page, 'BBS>', 'SUBMIT DEFERRED');
  await expect(log.locator('.ai-fictional').last()).toContainText(
    'DEFERRED VERIFIED / HEADER ANALYSIS',
  );
  await expect(log.locator('.ai-fictional').last()).toContainText(correction);
  await expectSavedProof();

  await page.reload();
  await signIn();
  await expect(log.locator('.system').last()).toContainText('Q17 PROOF: DEFERRED VERIFIED');
  await button('MESSAGES').click();
  await expect(proof).toBeVisible();
  await proof.click();
  await expect(log.locator('.ai-fictional').last()).toContainText(
    'DEFERRED VERIFIED / HEADER ANALYSIS',
  );
  await expect(log.locator('.ai-fictional').last()).toContainText(correction);
  await expectSavedProof();
});

for (const journey of [
  {
    input: 'keyboard',
    desk: 'Q17 HEADER DESK',
    evidence: ['Q17 message headers', 'Queue policy'],
    proof: 'HEADER ANALYSIS',
    presentation: 'ai-fictional',
    sender: 'ECHO',
    title: 'Q17 header confirmation',
    confirmationId: 'q17-header-confirmation',
    routeFlag: 'deferred-headers-verified',
    outcome: ['INDEX COPY', 'Index the labeled training copy', 'LABELED COPY INDEXED'],
  },
  {
    input: 'pointer',
    desk: 'Q17 CUSTODY DESK',
    evidence: ['Sealed originals', 'Dispatch comparison', 'Migration hold receipt'],
    proof: 'CUSTODY AUDIT',
    presentation: 'recovered',
    sender: 'SYSOP',
    title: 'Q17 custody confirmation',
    confirmationId: 'q17-custody-confirmation',
    routeFlag: 'deferred-custody-verified',
    outcome: ['SEALED REFERENCES', 'Restrict to sealed references', 'SEALED REFERENCES ONLY'],
  },
] as const) {
  test(`plays the Forgotten Archive after ${journey.proof} by ${journey.input}`, async ({
    page,
  }) => {
    await seedSaveOnce(page, completedV1);
    const log = page.getByRole('log');
    const screen = log.locator('.door').last();
    const system = log.locator('.system').last();
    const prompt = page.getByLabel('BBS>');
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const activate = (name: string) => activateBbsButton(page, journey.input, name);
    const type = (command: string) => typeCommand(page, 'BBS>', command);
    const shelfButton = (command: string, label: string) => `[${command}] ${label}`;
    const act = (command: string, label: string) =>
      journey.input === 'keyboard'
        ? type(command)
        : activate(command === 'EXIT' ? label : shelfButton(command, label));
    const read = (fragment: string) =>
      act(`INSPECT ${fragment} FRAGMENT`, `Inspect ${fragment} fragment`);
    const open = '[OPEN forgotten-archive] THE FORGOTTEN ARCHIVE';
    const order = 'SEAL / ROUTE / ACK';
    const retry = 'ROUTE / SEAL / ACK';
    const insufficient = 'Inspect all three training fragments before recording the procedure.';
    const notebook = '[NOTEBOOK] Read notebook';

    async function signIn() {
      await joinWithEnter(page);
      if (journey.input === 'keyboard') {
        await typeCommand(page, 'OBS>', 'CONNECT');
        await type('DESIGNATION');
      } else {
        await connect(page).click();
        await activate('USE DESIGNATION (OBS-02FF)');
      }
      await expect(system).toContainText('DEEP FIELD MAIN MENU');
    }

    async function openArchive() {
      await activate('DOORS');
      await activate(open);
    }

    await page.goto('./');
    await signIn();
    await activate('DOORS');
    await expect(button(open)).toHaveCount(0);
    await type('OPEN forgotten-archive');
    await expect(log.locator('.restricted').last()).toContainText('DOOR UNAVAILABLE.');
    await activate('MAIN MENU');
    await activate('BOARDS');
    await activate('THE FORGOTTEN BOARD');
    await activate('Delivered messages and queue index');
    await type('SEARCH Q17');
    await expect(log.getByText('Q17 batch located', { exact: true })).toBeVisible();
    await activate('BACK');
    if (journey.input === 'keyboard') {
      await activate('Departure ledger');
      await activate('BACK');
    }
    await activate('BACK');
    await activate(journey.desk);
    for (const evidence of journey.evidence) {
      await activate(evidence);
      await activate('BACK');
    }
    const output = log.locator('.bbs-output');
    const beforeSubmit = await output.count();
    await type('SUBMIT DEFERRED');
    await expect(output).toHaveCount(beforeSubmit + 1);
    const confirmation = output.nth(beforeSubmit);
    await expect(confirmation).toContainClass(journey.presentation);
    for (const line of [
      journey.title,
      `FROM: ${journey.sender}`,
      `DEFERRED VERIFIED / ${journey.proof}`,
    ]) {
      await expect(confirmation.getByText(line, { exact: true })).toBeVisible();
    }
    const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    expect(saved).not.toBeNull();
    const { bbsReadMessages, events, flags } = JSON.parse(saved!) as ReturnType<typeof freshSave>;
    expect(bbsReadMessages).toContain(`message:${journey.confirmationId}`);
    expect(events.fired).toContain(journey.confirmationId);
    expect(events.bulletins).toContain(journey.confirmationId);
    expect(flags.filter((flag) => flag === 'deferred-verified')).toHaveLength(1);
    expect(
      flags.filter(
        (flag) => flag === 'deferred-headers-verified' || flag === 'deferred-custody-verified',
      ),
    ).toEqual([journey.routeFlag]);

    await activate('MAIN MENU');
    await openArchive();
    await expect(screen).toContainText('ARCHIVE VESTIBULE');
    await act('TRAINING SHELF', 'Visit training shelf');
    await expect(screen).toContainText(
      'POSTED RULE: An operation may only consume outputs already produced.',
    );
    await act(order, 'Submit order');
    await expect(screen).toContainText(insufficient);
    await expect(button(notebook)).toHaveCount(0);
    await activate('[INSPECT SEAL FRAGMENT] Inspect SEAL fragment');
    await expect(screen).toContainText('SEAL fixes an immutable original');
    await read('ROUTE');
    await expect(screen).toContainText('ROUTE requires the seal reference');

    await page.reload();
    await signIn();
    await openArchive();
    await expect(screen).toContainText('TRAINING SHELF');
    await act(retry, 'Submit order');
    await expect(screen).toContainText('ROUTE is missing the seal reference.');
    await expect(button('[INSPECT ACK FRAGMENT] Inspect ACK fragment')).toBeVisible();
    await act(order, 'Submit order');
    await expect(screen).toContainText(insufficient);
    await read('ACK');
    await expect(screen).toContainText('ACK requires the destination receipt');
    await act(order, 'Submit order');
    await expect(screen).toContainText('PROCEDURE LEARNED.');
    await expect(button(notebook)).toBeVisible();
    await act('NOTEBOOK', 'Read notebook');
    await expect(screen).toContainText(`TRAINING NOTEBOOK: ${order}.`);

    await act('VESTIBULE', 'Return to vestibule');
    await act('COMPARISON DESK', 'Visit comparison desk');
    await act('TALK GHOST', 'Open GHOST reconstruction');
    await expect(screen).toContainText('GHOST // RETAINED INDEX NOTE');
    await act('INSPECT COPY SCOPE', 'Inspect copy scope');
    await act('TALK GHOST', 'Open GHOST reconstruction');
    await expect(screen).toContainText('GHOST // RETAINED BENCH NOTE');
    await act('PRESERVATION VAULT', 'Visit preservation vault');
    await act('INSPECT CUSTODY POLICY', 'Inspect custody policy');
    await act('TALK PACKET', 'Open PACKET reconstruction');
    await expect(screen).toContainText('PACKET // RETAINED CUSTODY NOTE');
    const [decision, label, result] = journey.outcome;
    await act(decision, label);
    await expect(screen).toContainText(`FILING RESULT: ${result}.`);
    await expect(button(shelfButton(decision, label))).toHaveCount(0);
    await act('EXIT', 'EXIT');
    await expect(system).toContainText('DEEP FIELD MAIN MENU');
    await expect(prompt).toBeFocused();
    await expect(log.getByText('SIGNED IN AS OBS-02FF', { exact: true })).toHaveCount(1);
    await activate('MESSAGES');
    await expect(system).toContainText('DEEP FIELD MESSAGES');

    await page.reload();
    await signIn();
    await openArchive();
    await expect(screen).toContainText(`FILING RESULT: ${result}.`);
    await act('COMPARISON DESK', 'Return to comparison desk');
    await act('VESTIBULE', 'Return to vestibule');
    await expect(button(notebook)).toBeVisible();
    await act('NOTEBOOK', 'Read notebook');
    await expect(screen).toContainText(`TRAINING NOTEBOOK: ${order}.`);
    await act('EXIT', 'EXIT');
    await expect(system).toContainText('DEEP FIELD MAIN MENU');
  });
}

function recoverySave(): string {
  const data = freshSave(42);
  const { designation, ...legacy } = JSON.parse(completedV1) as {
    designation: string;
    flags: string[];
    preferences: Partial<typeof data.preferences>;
  };
  return JSON.stringify({
    ...data,
    ...legacy,
    schemaVersion: data.schemaVersion,
    profile: { ...data.profile, designation },
    preferences: { ...data.preferences, ...legacy.preferences },
    flags: [...legacy.flags, 'deferred-verified', 'spool-02-order-learned'],
  });
}

test('restores SPOOL-02 and returns to the Annex by keyboard after reload', async ({ page }) => {
  await seedSaveOnce(page, recoverySave());
  await page.goto('./');
  const log = page.getByRole('log');
  const latest = log.locator('.system').last();
  const activate = (name: string) => activateBbsButton(page, 'keyboard', name);
  const type = (command: string) => typeCommand(page, 'BBS>', command);

  async function signIn() {
    await typeCommand(page, 'OBS>', 'CONNECT');
    await type('DESIGNATION');
    await expect(latest).toContainText('DEEP FIELD MAIN MENU');
  }

  await joinWithEnter(page);
  await signIn();
  await expect(latest).toContainText('TRAINING COMPLETE');
  await activate('DIRECTORY');
  await expect(page.getByRole('button', { name: 'MAINTENANCE ANNEX' })).toHaveCount(0);
  await activate('RECOVERY CONSOLE');
  await expect(latest).toContainText('TARGET: RELAY 07 / SPOOL-02');
  await expect(latest).toContainText('RESTORE WORKING SPOOL. RETAIN SEALED ORIGINALS.');
  await expect(latest).toContainText('Apply the training shelf procedure.');
  await type('APPLY SEAL / ACK / ROUTE');
  await expect(latest).toContainText(
    'ACK needs a destination receipt. Review the training notebook and retry.',
  );
  await expect(log).not.toContainText('SPOOL-02 WORKING SPOOL RESTORED');
  await type('APPLY SEAL / ROUTE / ACK');
  await expect(log).toContainText('SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.');
  await activate('BACK');
  await activate('MAINTENANCE ANNEX');
  await expect(latest).toContainText('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
  await activate('Retained source fragments');
  for (const fragment of [
    'signature-checker / SC-1',
    'queue-reader / QR-1',
    'replay-writer / RW-1',
  ]) {
    await expect(log.getByText(`BEGIN ${fragment}`, { exact: true })).toBeVisible();
  }
  await activate('MAIN MENU');
  await expect(latest).toContainText('ACCESS LEVEL: MAINTAINER');

  await page.reload();
  await joinWithEnter(page);
  await typeCommand(page, 'OBS>', 'STATUS');
  await expect(log).toContainText('ACCESS LEVEL: MAINTAINER');
  await expect(log).toContainText('OBSERVERS ONLINE: 1');
  await signIn();
  await expect(latest).toContainText('ACCESS LEVEL: MAINTAINER');
  await activate('DIRECTORY');
  await activate('MAINTENANCE ANNEX');
  await expect(latest).toContainText('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
});

const finaleJourneys = [
  {
    proof: 'headers',
    door: 'signal-hunter',
    input: 'keyboard',
    motion: 'explicit-reduce',
    forge: false,
  },
  { proof: 'headers', door: 'relay-trader', input: 'pointer', motion: 'animate', forge: true },
  {
    proof: 'custody',
    door: 'signal-hunter',
    input: 'pointer',
    motion: 'system-reduce',
    forge: true,
  },
  { proof: 'custody', door: 'relay-trader', input: 'keyboard', motion: 'animate', forge: false },
] as const;

for (const { proof, door, input, motion, forge } of finaleJourneys) {
  test(`Chapter 2 from Episode 000 through ${proof} and ${door} by ${input}`, async ({
    page,
    baseURL,
  }) => {
    const legacy = JSON.parse(completedV1) as {
      puzzles: string[];
      flags: string[];
      preferences: Partial<ReturnType<typeof freshSave>['preferences']>;
    };
    if (!forge) {
      legacy.puzzles = legacy.puzzles.filter((id) => id !== 'puzzle.service');
      legacy.flags = legacy.flags.filter(
        (id) => id !== 'service-panel-open' && id !== 'forge-opened',
      );
    }
    const animate = motion === 'animate';
    legacy.preferences.reducedMotion = motion === 'system-reduce' ? null : !animate;
    await page.emulateMedia({
      reducedMotion: motion === 'system-reduce' ? 'reduce' : 'no-preference',
    });
    await seedSaveOnce(page, JSON.stringify(legacy));

    const successfulAssets = new Set<string>();
    const assetProblems: string[] = [];
    const base = new URL(baseURL!);
    page.on('requestfailed', (request) => assetProblems.push(request.url()));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!response.ok() || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        assetProblems.push(response.url());
      } else {
        successfulAssets.add(url.pathname);
      }
    });
    const loaded = (chunk: RegExp) => [...successfulAssets].some((path) => chunk.test(path));
    const creditChunk = /\/contributor-view-[^/]+\.js$/;
    const log = page.getByRole('log');
    const system = log.locator('.system').last();
    const doorLog = log.locator('.door').last();
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const activate = (name: string) => activateBbsButton(page, input, name);
    const type = (command: string) => typeCommand(page, 'BBS>', command);
    const controls = () =>
      page.getByRole('navigation', { name: 'Tools' }).getByRole('button').allTextContents();
    const saved = () => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    const entry = page.getByRole('button', { name: /UNASSIGNED \/ routing-table entry/ });
    const receipt = page.getByRole('button', { name: /SPOOL-02 replay receipt/ });
    const annex = 'MAINTENANCE ANNEX';
    const mode = 'REPLAY / PRESERVE';
    const intro = 'SPOOL-02: LOCAL REPLAY VERIFIED';
    const reveal = 'PACKET and GHOST wrote those notes before they disappeared.';

    async function signIn() {
      if (input === 'keyboard') await typeCommand(page, 'OBS>', 'CONNECT');
      else await connect(page).click();
      await activate('USE DESIGNATION (OBS-02FF)');
      await expect(system).toContainText('DEEP FIELD MAIN MENU');
    }

    async function openAnnex() {
      await activate('MAIN MENU');
      await activate('DIRECTORY');
      await activate(annex);
    }

    async function unpublished() {
      if (await button('MAIN MENU').isVisible()) await activate('MAIN MENU');
      await activate('MESSAGES');
      await expect(entry).toHaveCount(0);
      await expect(receipt).toHaveCount(0);
    }

    await page.goto('./');
    await joinWithEnter(page);
    const hubTools = await controls();
    await signIn();
    await unpublished();
    await activate('MAIN MENU');
    await activate('BOARDS');
    await activate('THE FORGOTTEN BOARD');
    await activate('Delivered messages and queue index');
    await type('SEARCH Q17');
    await expect(log).toContainText('Q17 batch located');
    await activate('BACK');
    if (proof === 'headers') {
      await activate('Departure ledger');
      await activate('BACK');
    }
    await activate('BACK');
    await activate(proof === 'headers' ? 'Q17 HEADER DESK' : 'Q17 CUSTODY DESK');
    const evidence =
      proof === 'headers'
        ? ['Q17 message headers', 'Queue policy']
        : ['Sealed originals', 'Dispatch comparison', 'Migration hold receipt'];
    for (const title of evidence) {
      await activate(title);
      await activate('BACK');
    }
    await type('SUBMIT DEFERRED');
    await expect(log).toContainText(
      proof === 'headers'
        ? 'DEFERRED VERIFIED / HEADER ANALYSIS'
        : 'DEFERRED VERIFIED / CUSTODY AUDIT',
    );
    await activate('MAIN MENU');
    await activate('DOORS');
    await activate('[OPEN forgotten-archive] THE FORGOTTEN ARCHIVE');
    await expect(doorLog).toContainText('ARCHIVE VESTIBULE');
    await type('TRAINING SHELF');
    for (const fragment of ['SEAL', 'ROUTE', 'ACK']) await type(`INSPECT ${fragment} FRAGMENT`);
    await type('SEAL / ROUTE / ACK');
    await expect(doorLog).toContainText('PROCEDURE LEARNED.');
    await activate('EXIT');
    await activate('DIRECTORY');
    await activate('RECOVERY CONSOLE');
    if (input === 'keyboard') await type('APPLY SEAL / ROUTE / ACK');
    else {
      for (const operation of ['SEAL', 'ROUTE', 'ACK']) await activate(`ORDER ${operation}`);
      await activate('APPLY');
    }
    await expect(log).toContainText('SPOOL-02 WORKING SPOOL RESTORED');
    await activate('MAIN MENU');
    await expect(system).toContainText('ACCESS LEVEL: MAINTAINER');
    await activate('DOORS');
    if (door === 'signal-hunter') {
      await activate('[OPEN signal-hunter] SIGNAL HUNTER');
      await expect(doorLog).toContainText('H3 | SPOOL-02 / INTACT');
      await type('VERIFY H3');
    } else {
      await activate('[OPEN relay-trader] RELAY TRADER');
      await expect(doorLog).toContainText('NULL QUAY acknowledgement desk');
      for (const command of ['CLAIM ENVELOPE', 'STAMP ACK SPOOL-02', 'EXCHANGE'])
        await type(command);
    }
    await expect(doorLog).toContainText('SIGNED REPAIR MANIFEST R07-SPOOL-02');
    await activate('EXIT');
    await unpublished();
    await openAnnex();
    await expect(system).toContainText('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
    await expect(button('COMPARE')).toHaveCount(0);
    await activate('Retained source fragments');
    await expect(log).toContainText('END replay-writer / SEAL RW-1 VERIFIED');
    await activate('BACK');
    await type(`RECONSTRUCT ${mode}`);
    await expect(system).toContainText('COMPARE the retained fragments and recipe');
    await type('CREDITS');
    await expect(system).toContainText('COMMAND UNAVAILABLE HERE.');
    await expect(button('CONTRIBUTOR RECORD')).toHaveCount(0);
    await activate('COMPARE');
    await expect(system).toContainText(
      'RW-1 / replay-writer | REQUIRES: QR-1 and SC-1 | BOUNDARY: COMPLETE',
    );
    await activate('REPLAY / REPLACE');
    await expect(system).toContainText('REPLACE would overwrite the sealed originals');
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'bbs');
    await unpublished();
    await openAnnex();
    await activate('COMPARE');

    if (animate) {
      const endingClock = new Date('2025-01-01T00:00:00Z');
      await page.clock.install({ time: endingClock });
      await page.clock.pauseAt(new Date(endingClock.getTime() + 10_000));
    }
    if (input === 'pointer') await button(mode).click({ force: animate });
    else await type(`RECONSTRUCT ${mode}`);
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'ending');
    const ending = page.locator('.ending').getByRole('log');
    const proceed = button('CONTINUE');
    await expect(ending).toHaveAttribute('aria-live', 'polite');
    await expect(proceed).toBeFocused();
    if (animate) {
      await page.clock.runFor(1);
      await expect(ending).toContainText(intro);
      await expect(ending).not.toContainText(reveal);
      await page.clock.runFor(700);
      await expect(ending).not.toContainText(reveal);
      await page.clock.runFor(700);
      await expect(ending).toContainText(reveal);
      await expect(ending).not.toContainText('LOCAL REPLAY AUDIT');
    } else {
      expect(await ending.textContent()).toContain(intro);
      expect(await ending.textContent()).toContain(reveal);
      expect(await ending.textContent()).toContain(
        'DELIVERY 141 / P17 | REPLAY SEAL P17 = ORIGINAL SEAL P17',
      );
      expect(await ending.textContent()).toContain(
        'DELIVERY 142 / G17 | REPLAY SEAL G17 = ORIGINAL SEAL G17',
      );
    }
    const completed = JSON.parse((await saved())!) as ReturnType<typeof freshSave>;
    expect(completed.episodes).toEqual(['episode.000', 'episode.002']);
    expect(completed.profile.designation).toBe('OBS-02FF');
    expect(completed.flags.filter((flag) => flag === 'manifest-r07-spool-02')).toHaveLength(1);
    expect(
      completed.flags.filter((flag) => /^deferred-(headers|custody)-verified$/.test(flag)),
    ).toEqual([proof === 'headers' ? 'deferred-headers-verified' : 'deferred-custody-verified']);
    expect(completed.flags.includes('forge-opened')).toBe(forge);
    if (input === 'keyboard') await page.keyboard.press('Enter');
    else await proceed.click({ force: animate });
    if (animate) {
      await page.clock.fastForward(30_000);
      await page.clock.resume();
    }
    await expect(page.getByLabel('OBS>')).toBeFocused();
    expect(await controls()).toEqual(hubTools);
    await expect(log).not.toContainText(intro);
    await expect(log).not.toContainText('LOCAL REPLAY AUDIT');
    await typeCommand(page, 'OBS>', 'NETWORK MAP');
    const map = page.getByRole('group', { name: 'Network map' });
    await expect(map.getByRole('button', { name: 'SPOOL-02', exact: true })).toBeVisible();
    await map.getByRole('button', { name: 'SILENT OBSERVATORY' }).click();
    await expect(log).toContainText('NO CARRIER');
    await expect(log).toContainText('2 OBSERVERS REQUIRED');

    await page.getByLabel('OBS>').focus();
    await signIn();
    await activate('MESSAGES');
    await expect(receipt).toContainText('[READ]');
    await expect(entry).toContainText('[NEW]');
    await entry.click();
    await expect(log.locator('.recovered').last()).toContainText('REGISTERED OPERATOR: [EMPTY]');
    await expect(log.locator('.recovered').last()).toContainText(
      'Who prepared a destination with no registered operator?',
    );
    await openAnnex();
    await activate('VIEW REPLAY AUDIT');
    await expect(system).toContainText('RETAINED PACKET NOTE / P17: Acknowledge receipt.');
    await expect(system).toContainText('RETAINED GHOST NOTE / G17: Keep the signature');
    const creditsBefore = await saved();
    expect(loaded(creditChunk)).toBe(false);
    await activate('CONTRIBUTOR RECORD');
    const credits = page.getByRole('region', { name: 'Contributor record' });
    await expect(credits).toBeVisible();
    await expect(credits).toContainText('checked and independently reviewed');
    await expect(credits).toContainText('This build credits maintainers.');
    await expect(credits.getByRole('listitem')).toHaveText('SIGNAL//LOST maintainers (supernovae)');
    await expect(log.getByRole('region', { name: 'Contributor record' })).toHaveCount(0);
    await expect(credits).not.toContainText(/FROM:|OBSERVERS ONLINE|TKEEL/);
    await expect(button('CLOSE CONTRIBUTOR RECORD')).toBeFocused();
    if (input === 'keyboard') await page.keyboard.press('Enter');
    else await button('CLOSE CONTRIBUTOR RECORD').click();
    await expect(credits).toHaveCount(0);
    await expect(page.getByLabel('BBS>')).toBeFocused();
    expect(await saved()).toBe(creditsBefore);
    expect(loaded(creditChunk)).toBe(true);
    expect(loaded(/\/connection-[^/]+\.js$/)).toBe(true);
    expect(loaded(new RegExp(`/${door}-[^/]+\\.js$`))).toBe(true);
    expect(loaded(/\/code-door-content-[^/]+\.js$/)).toBe(true);
    expect(assetProblems).toEqual([]);

    await page.reload();
    await joinWithEnter(page);
    await expect(page.locator('.ending')).toHaveCount(0);
    await signIn();
    await activate('DOORS');
    await expect(button('[OPEN signal-hunter] SIGNAL HUNTER')).toBeVisible();
    await expect(button('[OPEN relay-trader] RELAY TRADER')).toBeVisible();
    await openAnnex();
    await activate('VIEW REPLAY AUDIT');
    await expect(system).toContainText('DELIVERY 142 / G17 | REPLAY SEAL G17 = ORIGINAL SEAL G17');
    await activate('MAIN MENU');
    await activate('MESSAGES');
    await expect(entry).toContainText('[READ]');
  });
}

test('opens Signal Hunter after restoration, verifies the manifest and solves practice by keyboard', async ({
  page,
}) => {
  await seedSaveOnce(page, recoverySave());
  await page.goto('./');
  await joinWithEnter(page);
  const log = page.getByRole('log');
  const system = log.locator('.system').last();
  const door = log.locator('.door').last();
  const type = (command: string) => typeCommand(page, 'BBS>', command);
  const hunter = page.getByRole('button', { name: '[OPEN signal-hunter] SIGNAL HUNTER' });

  await typeCommand(page, 'OBS>', 'CONNECT');
  await type('DESIGNATION');
  await expect(system).toContainText('DEEP FIELD MAIN MENU');
  await type('DOORS');
  await expect(door).toContainText('DEEP FIELD DOOR DIRECTORY');
  await expect(hunter).toHaveCount(0);
  await type('OPEN signal-hunter');
  await expect(log.locator('.restricted').last()).toContainText('DOOR UNAVAILABLE.');

  await type('BACK');
  await type('DIRECTORY');
  await type('BOARD spool-02-recovery');
  await expect(system).toContainText('TARGET: RELAY 07 / SPOOL-02');
  await type('APPLY SEAL / ROUTE / ACK');
  await expect(log).toContainText('SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.');
  await type('BACK');
  await type('DOORS');
  await expect(hunter).toBeVisible();
  await type('OPEN signal-hunter');
  for (const card of [
    'H1 | RELAY-07 / INTACT',
    'H2 | SPOOL-02 / DAMAGED',
    'H3 | SPOOL-02 / INTACT',
  ]) {
    await expect(door).toContainText(card);
  }
  await type('VERIFY H3');
  for (const line of [
    'SIGNED REPAIR MANIFEST R07-SPOOL-02',
    'SC-1 / signature-checker | REQUIRES: none',
    'QR-1 / queue-reader | REQUIRES: SC-1',
    'RW-1 / replay-writer | REQUIRES: QR-1 and SC-1',
    'BUILD ORDER: SC-1 → QR-1 → RW-1',
    'DESTINATION: separate replay copy. Preserve sealed originals unchanged.',
  ]) {
    await expect(door).toContainText(line);
  }
  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(saved!).flags).toContain('manifest-r07-spool-02');

  await type('PRACTICE');
  await expect(door).toContainText('Choose a practice drill.');
  await type('INTERFERENCE');
  await expect(door).toContainText('Samples 1–4 (receiver/reference)');
  const lanes = door.getByText(/^Lane [A-D]:/);
  await expect(lanes).toHaveCount(4);
  const validLanes = (await lanes.allTextContents()).filter((line) => {
    const pairs = [...line.matchAll(/(\d+)\/(\d+)/g)];
    return (
      pairs.length === 4 &&
      pairs.every(([, receiver, reference]) => Number(receiver) - Number(reference) >= 5)
    );
  });
  expect(validLanes).toEqual([expect.stringMatching(/^Lane C:/)]);
  await type('SUBMIT A');
  await expect(door).toContainText(/Lane A, sample [1-4] has a residual/);
  await type('SUBMIT C');
  await expect(door).toContainText('ROUND SOLVED.');
  await type('EXIT');
  await expect(system).toContainText('DEEP FIELD MAIN MENU');
  await expect(page.getByLabel('BBS>')).toBeFocused();
  await expect(log.getByText('SIGNED IN AS OBS-02FF', { exact: true })).toHaveCount(1);
});

for (const input of ['keyboard', 'pointer'] as const) {
  test(`relay trader restores and completes a fixed-seed trade by ${input}`, async ({ page }) => {
    await seedSaveOnce(page, recoverySave());
    await page.goto('./');
    const log = page.getByRole('log');
    const system = log.locator('.system').last();
    const door = log.locator('.door').last();
    const traderName = '[OPEN relay-trader] RELAY TRADER';
    const trader = page.getByRole('button', { name: traderName, exact: true });
    const activate = (name: string) => activateBbsButton(page, input, name);
    const type = (command: string) => typeCommand(page, 'BBS>', command);

    async function signIn() {
      await joinWithEnter(page);
      if (input === 'pointer') await connect(page).click();
      else await typeCommand(page, 'OBS>', 'CONNECT');
      await activate('USE DESIGNATION (OBS-02FF)');
      await expect(system).toContainText('DEEP FIELD MAIN MENU');
    }

    await signIn();
    await activate('DOORS');
    await expect(door).toContainText('DEEP FIELD DOOR DIRECTORY');
    await expect(trader).toHaveCount(0);
    await type('OPEN relay-trader');
    await expect(log.locator('.restricted').last()).toContainText('DOOR UNAVAILABLE.');
    await activate('BACK');
    await activate('DIRECTORY');
    await activate('RECOVERY CONSOLE');
    await type('APPLY SEAL / ROUTE / ACK');
    await expect(log).toContainText('SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.');
    await activate('BACK');
    await activate('DOORS');
    await activate(traderName);
    await expect(door).toContainText('PACKET: NULL QUAY acknowledgement desk.');

    if (input === 'keyboard') await type('MARKET');
    else await activate('[MARKET] Open market');
    await expect(door).toContainText('Outpost: NULL QUAY | Credits: 12 | Cargo: 0/3');
    await expect(door).toContainText(
      'Power cell | Buy 3 | Sell 1 | Stock 6 | Demand 1 | A charging bank keeps cells plentiful',
    );
    await expect(door).toContainText('SWITCHYARD | Toll 2 | Safe passage.');
    await expect(door).toContainText(
      'FAR RELAY | Toll 1 | Shortcut: 1 in 4 chance to lose one carried unit.',
    );

    await activate('[BUY POWER CELL] Buy Power cell');
    await expect(door).toContainText('Outpost: NULL QUAY | Credits: 9 | Cargo: 1/3');
    if (input === 'keyboard') await type('TRAVEL SWITCHYARD');
    else await activate('[TRAVEL SWITCHYARD] Travel to SWITCHYARD');
    await expect(door).toContainText('Outpost: SWITCHYARD | Credits: 7 | Cargo: 1/3');

    await page.reload();
    await signIn();
    await activate('DOORS');
    await activate(traderName);
    await expect(door).toContainText('Outpost: SWITCHYARD | Credits: 7 | Cargo: 1/3');
    await expect(door).toContainText(
      'Power cell | Buy 12 | Sell 10 | Stock 1 | Demand 6 | The switching crews need spare cells',
    );
    await activate('[SELL POWER CELL] Sell Power cell');
    await expect(door).toContainText('Outpost: SWITCHYARD | Credits: 17 | Cargo: 0/3');
    await expect(door).toContainText('Power cell | Buy 12 | Sell 10 | Stock 1 | Demand 5');
    await activate('EXIT');
    await expect(system).toContainText('DEEP FIELD MAIN MENU');
    await expect(page.getByLabel('BBS>')).toBeFocused();
    await expect(log.getByText('SIGNED IN AS OBS-02FF', { exact: true })).toHaveCount(1);
  });
}

test('stages, clears and applies the recovery order with pointer controls', async ({ page }) => {
  await seedSaveOnce(page, recoverySave());
  await page.goto('./');
  await joinWithEnter(page);
  await connect(page).click();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const log = page.getByRole('log');
  await button('USE DESIGNATION (OBS-02FF)').click();
  await button('DIRECTORY').click();
  await button('RECOVERY CONSOLE').click();
  await expect(button('CLEAR')).toBeDisabled();
  await expect(button('APPLY')).toBeDisabled();
  await button('ORDER ACK').click();
  await expect(button('ORDER ACK')).toBeDisabled();
  await expect(log).toContainText('STAGED ORDER: ACK');
  await button('CLEAR').click();
  await expect(button('ORDER ACK')).toBeEnabled();
  await expect(log).toContainText('STAGED ORDER: EMPTY');
  await button('ORDER SEAL').click();
  await button('ORDER ROUTE').click();
  await expect(button('APPLY')).toBeDisabled();
  await button('ORDER ACK').click();
  await expect(log).toContainText('STAGED ORDER: SEAL / ROUTE / ACK');
  await button('APPLY').click();
  await expect(log).toContainText('SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.');
  await button('BACK').click();
  await button('MAINTENANCE ANNEX').click();
  await expect(log).toContainText('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
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
