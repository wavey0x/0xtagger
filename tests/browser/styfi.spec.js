import { test, expect } from '@playwright/test';
import { address, other, record, start, reported, input, submit, shownAddress } from './controller.js';
import { styfiPage, styfiRow } from '../fixtures/styfi.js';

const site = 'https://styfi.wavey.info/';
const open = (page, rows = styfiRow(address), records = [record]) => start(page, { site, html: styfiPage(rows), records });
const wallet = page => page.locator('#ranking-body .address-link');
const heading = page => page.locator('#wallet-address');
const drawer = page => page.locator('#wallet-panel');
const rowEdit = page => page.locator('#ranking-body [data-0xtagger-edit]').getByRole('button');
const drawerEdit = page => page.locator('.drawer-head [data-0xtagger-edit]').getByRole('button');

test('stYFI tags wallet buttons while preserving native opening, copying and explorer navigation', async ({ page }) => {
  await open(page);
  expect(await reported(page)).toMatchObject({ adapter: 'stYFI', status: 'ready', network: 'eip155:1' });
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-address', address);
  await expect(wallet(page).locator('.address-label-compact')).toHaveText('0xaba…abab');
  await expect(wallet(page)).toHaveAttribute('aria-label', `View details for ${address}`);
  await expect(page.locator('.copy-trigger[data-0xtagger-address], .explorer-link[data-0xtagger-address]')).toHaveCount(0);
  await expect(wallet(page).locator('[data-0xtagger-edit]')).toHaveCount(0);
  await page.locator('#ranking-body .copy-trigger').click();
  expect(await page.evaluate(() => window.nativeCopied)).toBe(address);
  await expect(drawer(page)).toBeHidden();
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await page.locator('#ranking-body .explorer-link').click();
  expect(await page.evaluate(() => window.nativeOpened)).toBe(`https://etherscan.io/address/${address}`);
  await expect(drawer(page)).toBeHidden();
  await rowEdit(page).click();
  await expect(input(page)).toHaveValue('Treasury');
  await expect(drawer(page)).toBeHidden();
  await input(page).press('Escape');
  await wallet(page).press('Enter');
  await expect(heading(page)).toHaveAttribute('data-0xtagger-address', address);
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await expect(page.locator('[data-0xtagger-edit]')).toHaveCount(2);
});

test('stYFI requires agreeing row, title and Ethereum link evidence, including hidden labels', async ({ page }) => {
  await open(page, styfiRow(address, { title: other }) + styfiRow(address, { rowAddress: other }) +
    styfiRow(address, { title: '' }) + styfiRow(address, { rowAddress: '' }) +
    styfiRow(address, { href: `https://basescan.org/address/${address}` }) +
    styfiRow(address, { href: `/wallet/${address}` }) + styfiRow(address));
  await expect(page.locator('[data-0xtagger-address]')).toHaveCount(1);
  const sound = wallet(page).last();
  await expect(sound).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await sound.locator('.address-label-compact').evaluate(e => { e.textContent = '0xcdc…cdcd'; });
  await expect(sound).not.toHaveAttribute('data-0xtagger-address');
  expect(await reported(page)).toMatchObject({ status: 'ready' });
});

test('stYFI rescans sibling and row evidence and restores a valid wallet', async ({ page }) => {
  await open(page);
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  const link = page.locator('#ranking-body .explorer-link');
  await link.evaluate((e, at) => { e.href = `https://etherscan.io/address/${at}`; }, other);
  await expect(wallet(page)).not.toHaveAttribute('data-0xtagger-address');
  await link.evaluate((e, at) => { e.href = `https://etherscan.io/address/${at}`; }, address);
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await page.locator('tr[data-address]').evaluate((e, at) => { e.dataset.address = at; }, other);
  await expect(wallet(page)).not.toHaveAttribute('data-0xtagger-address');
  await page.locator('#ranking-body').evaluate((e, html) => { e.innerHTML = html; }, styfiRow(other) + styfiRow(address));
  await expect(wallet(page).first()).toHaveAttribute('data-0xtagger-address', other);
  await expect(wallet(page).first()).not.toHaveAttribute('data-0xtagger-tag');
  await expect(wallet(page).last()).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await expect(page.locator('[data-0xtagger-edit]')).toHaveCount(2);
});

test('stYFI keeps ENS text intact and uses Ethereum overrides in both displays', async ({ page }) => {
  await open(page, styfiRow(address, { name: 'treasury.eth' }) + styfiRow(other, { name: 'unlabelled.eth' }),
    [record, { ...record, scope: 'eip155:1', tags: ['Ethereum treasury'] }]);
  await expect(wallet(page).first()).toHaveAttribute('data-0xtagger-tag', 'Ethereum treasury');
  await expect(wallet(page).last()).toHaveAttribute('data-0xtagger-address', other);
  await expect(wallet(page).last()).not.toHaveAttribute('data-0xtagger-tag');
  await expect(wallet(page).first().locator('.address-label')).toHaveText('treasury.eth');
  await wallet(page).first().click();
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Ethereum treasury');
  await expect(heading(page)).toHaveText('treasury.eth · 0xababa…babab');
  await page.evaluate(() => window.controller.stop());
  await expect(page.locator('[data-0xtagger-address], [data-0xtagger-tag], [data-0xtagger-ui]')).toHaveCount(0);
  await expect(wallet(page).first().locator('.address-label')).toHaveText('treasury.eth');
  await page.locator('#wallet-close').click();
  await wallet(page).first().click();
  await expect(drawer(page)).toBeVisible();
});

test('stYFI drawer works without a ranking match and leaves activity and votes untouched', async ({ page }) => {
  await open(page, '<tr><td class="empty" colspan="5">No address matches your search.</td></tr>');
  await page.evaluate(at => {
    window.openWallet(at);
    const title = document.querySelector('.activity-title');
    title.textContent = `Remove ${at.slice(0, 7)}…${at.slice(-5)}`;
    title.title = `Remove ${at} · YBC`;
  }, address);
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await expect(page.locator('#wallet-activity [data-0xtagger-address], #wallet-activity [data-0xtagger-edit]')).toHaveCount(0);
  await page.locator('.activity-row').click();
  expect(await page.evaluate(() => window.nativeOpened)).toContain('https://etherscan.io/tx/');
  await heading(page).evaluate((e, at) => { e.href = `https://etherscan.io/address/${at}`; }, other);
  await expect(heading(page)).not.toHaveAttribute('data-0xtagger-address');
  await page.evaluate(at => window.openWallet(at), address);
  await expect(heading(page)).toHaveAttribute('data-0xtagger-address', address);
  await page.locator('#wallet-close').click();
  await expect(heading(page)).not.toHaveAttribute('data-0xtagger-address');
  await expect(drawerEdit(page)).toHaveCount(0);
});

test('stYFI editing keeps details open, saves both displays, and preserves native dismissal', async ({ page }) => {
  await open(page);
  await wallet(page).click();
  await drawerEdit(page).click();
  await input(page).click();
  await expect(drawer(page)).toBeVisible();
  await input(page).fill('Renamed treasury');
  await submit(page);
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Renamed treasury');
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Renamed treasury');
  await drawerEdit(page).click();
  await input(page).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await drawerEdit(page).click();
  await input(page).fill('Saved on leaving');
  await page.locator('#outside').click();
  await expect(drawer(page)).toBeHidden();
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Saved on leaving');
  expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address, scope: 'global' });
});

test('stYFI a failed save survives a wallet switch without retargeting the draft', async ({ page }) => {
  await open(page, styfiRow(address) + styfiRow(other));
  await wallet(page).first().click();
  await drawerEdit(page).click();
  await input(page).fill('Original wallet draft');
  await page.evaluate(() => { window.saveError = 'Offline'; });
  await wallet(page).last().click();
  await expect(heading(page)).toHaveAttribute('data-0xtagger-address', other);
  await expect(heading(page)).not.toHaveAttribute('data-0xtagger-tag');
  await expect(input(page)).toHaveValue('Original wallet draft');
  expect((await shownAddress(page).textContent()).toLowerCase()).toBe(address);
  await page.evaluate(() => { window.saveError = null; });
  await submit(page);
  expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address, tags: ['Original wallet draft', 'Operations'] });
  await expect(wallet(page).first()).toHaveAttribute('data-0xtagger-tag', 'Original wallet draft');
  await expect(heading(page)).not.toHaveAttribute('data-0xtagger-tag');
});

test('stYFI detects an unrecognized populated table but accepts loading and empty results', async ({ page }) => {
  for (const message of ['Reading verified balances…', 'No address matches your search.', 'The verified holder data could not be loaded.']) {
    await open(page, `<tr><td class="empty" colspan="5">${message}</td></tr>`);
    expect(await reported(page)).toMatchObject({ status: 'ready' });
  }
  await open(page, `<tr><td class="account"><a class="address-link" href="https://etherscan.io/address/${address}" title="${address}">${address}</a></td></tr>`);
  await expect.poll(() => reported(page)).toMatchObject({ status: 'stale' });
});
