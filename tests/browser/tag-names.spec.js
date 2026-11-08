import { test, expect } from '@playwright/test';
import { address, record, start, edit, input } from './controller.js';

// The display can shorten a name, but editing, copying and native identity
// must still use complete values. Paint is reviewed in docs/demo separately.
for (const site of ['https://example.com/', 'https://app.safe.global/transactions/queue?safe=eth:' + address]) {
  test(`a constrained name retains its full value and native copy action on ${new URL(site).hostname}`, async ({ page }) => {
    const safe = site.includes('safe.global');
    const name = 'Treasury operations '.repeat(4).trimEnd() + '!';
    const native = safe ? 'By 0xabab…abab' : address;
    const row = `<div id="row" style="display:flex;width:160px;align-items:center">
      <div id="copy" role="button" tabindex="0" aria-label="Copy address ${address}"
        style="display:flex;min-width:0;overflow:hidden" onclick="window.copied='${address}';window.copyCount=(window.copyCount||0)+1">
        <span id="address" class="AuditLog_actorText__fixture"
          style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${native}</span>
      </div></div>`;
    await start(page, { site, records: [{ ...record, tags: [name] }], html: `<header>Site</header><main>${safe ? row :
      `<div id="row"><a id="address" href="/wallet/${address}" style="display:inline-block;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${address}</a>
      <button id="copy" onclick="window.copied=document.querySelector('#address').textContent;window.copyCount=(window.copyCount||0)+1">Copy</button></div>`}</main>` });
    const shown = page.locator('#address');
    await expect(shown).toHaveText(native);
    await expect(shown).toHaveAttribute('data-0xtagger-tag', name);
    await expect(edit(page)).toHaveAccessibleDescription(name);
    await expect(edit(page)).toHaveAttribute('title', `${name}\nEdit tags`);
    await page.locator('#copy').click();
    expect(await page.evaluate(() => window.copied)).toBe(address);

    // Keyboard users can read and edit the whole name through the same control.
    await edit(page).focus();
    await page.keyboard.press('Enter');
    await expect(input(page)).toHaveValue(name);
    expect(await page.evaluate(() => window.copyCount)).toBe(1);
    const changed = name.replace('Treasury', 'treasury');
    await input(page).fill(changed);
    await input(page).press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.saves.at(-1))).toMatchObject({ address, tags: [changed] });
    await expect(edit(page)).toHaveAccessibleDescription(changed);

    // React-style replacement must leave one working control for this wallet.
    await page.locator('#row').evaluate(node => { node.innerHTML = node.innerHTML; });
    await expect(page.getByRole('button', { name: 'Edit wallet tags', exact: true })).toHaveCount(1);
    await edit(page).click();
    await expect(input(page)).toHaveValue(changed);
    await page.getByRole('switch', { name: 'Show my tags for this address' }).click();
    await expect(shown).not.toHaveAttribute('data-0xtagger-tag');
    await expect(shown).toHaveText(native);
    await expect(edit(page)).not.toHaveAttribute('aria-description');
    await page.getByRole('switch', { name: 'Show my tags for this address' }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.controller.stop());
    await expect(page.locator('[data-0xtagger-clip],[data-0xtagger-tag],[data-0xtagger-edit]')).toHaveCount(0);
    await expect(shown).toHaveText(native);
    await page.locator('#copy').click();
    expect(await page.evaluate(() => window.copied)).toBe(address);
  });
}
