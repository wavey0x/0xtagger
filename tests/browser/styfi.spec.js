import { test, expect } from '@playwright/test';
import { address, other, record, start, reported, input, submit, shownAddress, contrast } from './controller.js';
import { styfiPage, styfiRow, styfiVoter } from '../fixtures/styfi.js';

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

test('stYFI requires agreeing row and Ethereum link evidence, including hidden labels', async ({ page }) => {
  await open(page, styfiRow(address, { rowAddress: other }) + styfiRow(address, { rowAddress: '' }) +
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
  for (const message of ['No address matches your search.', 'The verified holder data could not be loaded.']) {
    await open(page, `<tr><td class="empty" colspan="5">${message}</td></tr>`);
    expect(await reported(page)).toMatchObject({ status: 'ready' });
  }
  await open(page, `<tr><td class="account"><a class="address-link" href="https://etherscan.io/address/${address}" title="${address}">${address}</a></td></tr>`);
  await expect.poll(() => reported(page)).toMatchObject({ status: 'stale' });
});

test('stYFI identifies a deep-linked wallet during loading and recovers across view changes', async ({ page }) => {
  await start(page, { site, html: styfiPage('<tr class="skeleton" aria-hidden="true"><td><span></span></td></tr>', { loading: true }) });
  expect(await reported(page)).toMatchObject({ status: 'ready' });
  await page.evaluate(at => window.openWallet(at), address);
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await page.locator('#wallet-close').click();
  await page.locator('[data-view="proposals"]').click();
  await page.locator('#ranking-body').evaluate((body, html) => {
    body.innerHTML = html;
    body.removeAttribute('aria-busy');
  }, styfiRow(address));
  await expect(wallet(page)).not.toHaveAttribute('data-0xtagger-address');
  await page.locator('[data-view="stakers"]').click();
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await page.locator('[data-view="proposals"]').click();
  await expect(wallet(page)).not.toHaveAttribute('data-0xtagger-address');
  expect(await reported(page)).toMatchObject({ status: 'ready' });
});

test('stYFI keeps tags readable after native theme changes', async ({ page }) => {
  await start(page, { site, html: styfiPage(styfiRow(address)) +
    '<style>html{background:#fafafa}:root[data-theme=dark]{background:#111212}</style>' });
  await wallet(page).click();
  for (const surface of ['dark', 'light']) {
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-0xtagger-surface', surface);
    await drawerEdit(page).click();
    await expect(drawer(page)).toBeVisible();
    const [ink, background] = await heading(page).evaluate(element => [getComputedStyle(element, '::before').color,
      getComputedStyle(document.documentElement).backgroundColor]);
    expect(contrast(ink, background)).toBeGreaterThanOrEqual(4.5);
    await input(page).press('Escape');
  }
});

test('stYFI a proposal refresh keeps a failed draft attached to its original voter', async ({ page }) => {
  await start(page, { site, html: styfiPage(styfiRow(address), { voters: styfiVoter(address) }) });
  await page.evaluate(() => window.openProposal());
  await page.locator('#proposal-list [data-0xtagger-edit]').getByRole('button').click();
  await input(page).fill('Original voter draft');
  await page.evaluate(() => { window.saveError = 'Offline'; });
  await submit(page);
  await expect(input(page)).toHaveValue('Original voter draft');
  await page.locator('.vlist').evaluate((list, html) => { list.innerHTML = html; }, styfiVoter(other));
  await expect(page.locator('#proposal-list .vwho')).toHaveAttribute('data-0xtagger-address', other);
  expect((await shownAddress(page).textContent()).toLowerCase()).toBe(address);
  await page.evaluate(() => { window.saveError = null; });
  await submit(page);
  expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address, tags: ['Original voter draft', 'Operations'] });
  await expect(page.locator('#proposal-list .vwho')).not.toHaveAttribute('data-0xtagger-tag');
  await expect(wallet(page)).toHaveAttribute('data-0xtagger-tag', 'Original voter draft');
});

test('stYFI proposal voters and pools show tags while preserving native text and actions', async ({ page }) => {
  await start(page, { site, html: styfiPage(styfiRow(address), { voters:
    styfiVoter(address, { name: 'treasury.eth' }) + styfiVoter(other, { name: 'YBC pool', pool: true }) }),
    records: [record, { ...record, address: other, tags: ['Pool tag'] }] });
  await page.evaluate(() => window.openProposal());
  const voter = page.locator('#proposal-list .vwho').first();
  await expect(voter).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await expect(voter).toHaveText('treasury.eth');
  await expect(page.locator('.vwho.pool')).toHaveAttribute('data-0xtagger-address', other);
  await expect(page.locator('.vwho.pool')).toHaveAttribute('data-0xtagger-tag', 'Pool tag');
  await expect(page.locator('.vwho.pool')).toHaveText('YBC pool');
  await page.locator('#proposal-list .copy-trigger').first().click();
  expect(await page.evaluate(() => window.nativeCopied)).toBe(address);
  await page.locator('#proposal-list .vwho-cell .explorer-link').first().click();
  expect(await page.evaluate(() => window.nativeOpened)).toBe(`https://etherscan.io/address/${address}`);
  await page.locator('#proposal-list .vwhen .explorer-link').first().click();
  expect(await page.evaluate(() => window.nativeOpened)).toContain('https://etherscan.io/tx/');
  await expect(page.locator('#proposal-list a[data-0xtagger-address]')).toHaveCount(0);
  await page.locator('#proposal-close').click();
  await expect(page.locator('#proposal-list [data-0xtagger-address]')).toHaveCount(0);
});

test('stYFI pool edits appear immediately, survive a refresh and restore native names when removed', async ({ page }) => {
  const pools = [[address, 'stYFIx pool'], [other, 'YBC pool']];
  const voters = pools.map(([wallet, name]) => styfiVoter(wallet, { name, pool: true })).join('');
  await start(page, { site, html: styfiPage(styfiRow(address), { voters }), records: [] });
  await page.evaluate(() => window.openProposal());
  for (const [wallet, name] of pools) {
    const row = page.locator(`#proposal-list [data-account="${wallet}"]`);
    await row.locator('[data-0xtagger-edit]').getByRole('button').click();
    await input(page).fill(name);
    await submit(page);
    await expect(row.locator('.vwho')).toHaveAttribute('data-0xtagger-tag', name);
    expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address: wallet, scope: 'global', tags: [name] });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.locator('.vlist').evaluate((list, html) => { list.innerHTML = html; }, voters);
  for (const [wallet, name] of pools) {
    const row = page.locator(`#proposal-list [data-account="${wallet}"]`);
    await expect(row.locator('.vwho')).toHaveAttribute('data-0xtagger-tag', name);
    await row.locator('[data-0xtagger-edit]').getByRole('button').click();
    await page.getByRole('button', { name: 'Remove tag 1' }).click();
    await submit(page);
    await expect(row.locator('.vwho')).not.toHaveAttribute('data-0xtagger-tag');
    await expect(row.locator('.vwho')).toHaveText(name);
    expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address: wallet, tags: [] });
  }
});

test('stYFI voter evidence must agree and is rescanned after changes or sorting', async ({ page }) => {
  await start(page, { site, html: styfiPage(styfiRow(address), { voters:
    styfiVoter(address, { rowAccount: other }) + styfiVoter(address, { rowAccount: '' }) +
    styfiVoter(address, { href: `https://basescan.org/address/${address}` }) +
    styfiVoter(address, { name: '0xcdcdc…dcdcd' }) + styfiVoter(address) }) });
  await page.evaluate(() => window.openProposal());
  const voter = page.locator('#proposal-list .vwho').last();
  await expect(page.locator('#proposal-list [data-0xtagger-address]')).toHaveCount(1);
  await voter.evaluate((element, at) => { element.closest('.vrow').dataset.account = at; }, other);
  await expect(voter).not.toHaveAttribute('data-0xtagger-address');
  await voter.evaluate((element, at) => { element.closest('.vrow').dataset.account = at; }, address);
  await expect(voter).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  await page.locator('#proposal-list .vwho-cell > a').last().evaluate((element, at) => { element.href = `https://etherscan.io/address/${at}`; }, other);
  await expect(voter).not.toHaveAttribute('data-0xtagger-address');
  await page.locator('.vlist').evaluate((list, html) => { list.innerHTML = html; }, styfiVoter(other) + styfiVoter(address));
  await expect(page.locator('#proposal-list [data-0xtagger-address]')).toHaveCount(2);
  await expect(page.locator('#proposal-list .vwho').first()).toHaveAttribute('data-0xtagger-address', other);
  await expect(voter).toHaveAttribute('data-0xtagger-tag', 'Treasury');
});

for (const panel of ['wallet', 'proposal']) test(`stYFI mobile ${panel} editing works over the inert page and saves the right wallet`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, { site, html: styfiPage(styfiRow(address), { voters: styfiVoter(address) }) });
  if (panel === 'wallet') await wallet(page).click();
  else await page.evaluate(() => window.openProposal());
  await page.locator(`#${panel}-panel [data-0xtagger-edit]`).getByRole('button').click();
  await input(page).fill('Mobile treasury');
  await submit(page);
  await expect(page.locator(`#${panel}-panel [data-0xtagger-tag]`)).toHaveAttribute('data-0xtagger-tag', 'Mobile treasury');
  expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address, scope: 'global' });
  await page.locator(`#${panel}-panel [data-0xtagger-edit]`).getByRole('button').click();
  await input(page).press('Escape');
  await expect(page.locator(`#${panel}-panel`)).toBeVisible();
  await page.locator(`#${panel}-close`).click();
  await wallet(page).click();
  await expect(heading(page)).toHaveAttribute('data-0xtagger-tag', 'Mobile treasury');
});
