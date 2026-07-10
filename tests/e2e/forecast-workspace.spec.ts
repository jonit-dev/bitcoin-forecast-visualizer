import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const viewports = [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'laptop', width: 1280, height: 900 }, { name: 'desktop', width: 1440, height: 900 }];

for (const viewport of viewports) {
  test(`completes the core forecast flow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('tablist', { name: 'Forecast asset' })).toBeVisible();
    await page.getByRole('tab', { name: 'S&P 500' }).click();
    await expect(page.getByText('S&P 500', { exact: true }).first()).toBeVisible();
    await page.getByRole('region', { name: 'Forecast controls' }).getByRole('button', { name: '1Y' }).click();
    await page.getByRole('button', { name: 'Chart settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Chart settings' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /MVRV/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Chart settings' })).toBeFocused();
    await page.getByRole(viewport.width < 768 ? 'button' : 'tab', { name: 'Model & risk' }).click();
    await expect(page.getByRole('heading', { name: 'Model trust' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('supports keyboard-only navigation and visible focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const btc = page.getByRole('tab', { name: 'BTC' }); await btc.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'S&P 500' })).toBeFocused();
  await page.getByRole('button', { name: 'Chart settings' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Chart settings' })).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Chart settings' })).toBeFocused();
});

test('uses accessible evidence accordions on mobile and remains usable at 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const accordion = page.getByRole('button', { name: 'Model & risk' });
  await expect(accordion).toHaveAttribute('aria-expanded', 'false'); await accordion.click(); await expect(accordion).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('has no critical or serious accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const defaultResults = await new AxeBuilder({ page }).analyze();
  expect(defaultResults.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Chart settings' }).click();
  const dialogResults = await new AxeBuilder({ page }).include('.chart-settings').analyze();
  expect(dialogResults.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
});

test('captures stable workspace states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page).toHaveScreenshot('forecast-workspace-desktop.png', { animations: 'disabled', fullPage: true, mask: [page.getByRole('status')] });
  await page.getByRole('button', { name: 'Chart settings' }).click();
  await expect(page).toHaveScreenshot('chart-settings-desktop.png', { animations: 'disabled', fullPage: true, mask: [page.getByRole('status')] });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Data & market' }).click();
  await expect(page).toHaveScreenshot('evidence-data-desktop.png', { animations: 'disabled', fullPage: true, mask: [page.getByRole('status')] });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Overview' }).click();
  await expect(page).toHaveScreenshot('forecast-workspace-mobile.png', { animations: 'disabled', fullPage: true, mask: [page.getByRole('status')] });
});
