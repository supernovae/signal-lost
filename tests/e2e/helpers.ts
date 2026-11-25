import { expect, type Page } from '@playwright/test';

export const SAVE_KEY = 'signal-lost.save';

export async function seedSaveOnce(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ({ key, text }) => {
      const marker = 'progress-test-save-seeded';
      if (sessionStorage.getItem(marker)) return;
      localStorage.setItem(key, text);
      sessionStorage.setItem(marker, '1');
    },
    { key: SAVE_KEY, text: value },
  );
}

export async function disableWebGl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (typeof args[0] === 'string' && args[0].includes('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
}

/** Plays Episode 000 through the real interface, from the hub to the ending. */
export async function completeEpisode(page: Page): Promise<void> {
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await page.getByLabel('BANDWIDTH').selectOption('5');
  await page.getByLabel('TUNE').fill('200');
  await page.getByLabel('DRIFT', { exact: true }).fill('-0.42');
  await page.getByRole('button', { name: 'LOCK' }).click();

  await page.getByRole('button', { name: /DECODER/ }).click();
  await page.getByLabel('RASTER WIDTH').fill('13');
  await page.getByLabel('GRID REFERENCE').fill('417');
  await page.getByRole('button', { name: 'SUBMIT' }).click();

  await page.getByRole('button', { name: /INQUIRY/ }).click();
  await page.getByLabel('FIRST RECEIPT').fill('1999-11-02');
  await page.getByLabel('DISCONNECT ORDERED BY').selectOption('MOYE');
  await page.getByLabel('RELAY 07 STATUS').selectOption('RUNNING');
  await page.getByRole('button', { name: 'FILE REPORT' }).click();
  await expect(page.locator('.ending')).toBeVisible();
}
