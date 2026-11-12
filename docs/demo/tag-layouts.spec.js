import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { address, other, record, start } from '../../tests/browser/controller.js';

// Review captures, not pixel assertions. These keep the native sizing rules
// observed on the public pages beside the adapter comments.
test('capture complete and constrained names across supported layouts', async ({ page }) => {
  await mkdir('docs/images', { recursive: true });
  const long = 'Treasury operations '.repeat(4).trimEnd() + '!';
  const records = [{ ...record, tags: ['wavey deployer'] }, { ...record, address: other, tags: [long] }];
  const capture = async name => {
    const main = await page.locator('main').boundingBox();
    await page.screenshot({ path: `docs/images/${name}.png`, animations: 'disabled',
      clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(main.y + main.height) } });
  };
  for (const width of [390, 800]) {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ colorScheme: 'dark' });
    const base = `<style>body{margin:0;background:#171717;color:#eee;font:14px/1.5 system-ui,sans-serif;color-scheme:dark}
      header{padding:16px;border-bottom:1px solid #333}main{padding:20px}a{color:#65b9d9}p{margin:0}</style>`;
    const actor = (at, title) => `<div class="AuditLog_auditRow__fixture"><span class="timeline">+</span><strong>${title}</strong>
      <span class="time">Nov 8, 2026, 10:13:47 AM</span><div class="AuditLog_actorRow__fixture">
      <div role="button" tabindex="0" aria-label="Copy address ${at}" class="actor-copy">
      <span class="AuditLog_actorText__fixture">By ${at.slice(0,6)}…${at.slice(-4)}</span></div></div></div>`;
    await start(page, { site: `https://app.safe.global/transactions/queue?safe=eth:${address}`, records, html: `${base}<style>
      main{container-type:inline-size;container-name:audit-log-container}.AuditLog_auditRow__fixture{display:grid;grid-template-columns:28px 1fr auto;grid-template-areas:'timeline label timestamp' 'timeline actor .';column-gap:8px;margin-bottom:20px}
      .timeline{grid-area:timeline}.time{grid-area:timestamp;font-size:12px;color:#999}.AuditLog_actorRow__fixture{grid-area:actor;display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden}
      .actor-copy{display:flex;min-width:0;overflow:hidden}.AuditLog_actorText__fixture{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
      @container audit-log-container (max-width:300px){.AuditLog_auditRow__fixture{grid-template-columns:28px 1fr;grid-template-areas:'timeline label' 'timeline actor' 'timeline timestamp'}}
      </style><header>Safe · Audit log</header><main>${actor(address, 'Created')}${actor(other, 'Signed (1/2)')}</main>` });
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(2);
    await capture(`tag-safe-${width}`);

    await start(page, { site: `https://etherscan.io/address/${other}`, records, html: `${base}<style>
      h1{font-size:22px;margin:0 0 24px}.line{display:flex;align-items:center;gap:4px;margin-top:16px}
      .hash-tag{display:inline-block;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [data-truncate=address]{max-width:21ch}.native-icon{display:inline-block;width:14px;height:14px;background:#65b9d9;margin-right:4px}
      </style><header>Etherscan · Heading and compact rows</header><main><h1><span id="mainaddress">${other}</span></h1>
      <div class="line">Direct <a class="hash-tag" data-full-address="${other}" data-truncate="address" href="/address/${other}">Original name</a></div>
      <div class="line">With icon <a class="hash-tag" data-highlight-target="${other}" href="/address/${other}"><i class="native-icon"></i><span>Original name</span></a></div>
      <div class="line">Short <a class="hash-tag" href="/address/${address}">${address}</a></div></main>` });
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(4);
    await capture(`tag-etherscan-${width}`);
  }
});
