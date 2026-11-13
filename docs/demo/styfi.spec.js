import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { address, other, record, start } from '../../tests/browser/controller.js';
import { styfiPage, styfiRow } from '../../tests/fixtures/styfi.js';

// Native sizing from styfi.wavey.info on 2026-11-12: automatic table sizing,
// a compact mobile ranking with balances hidden, and a flex drawer heading.
const styles = `<style>
  *{box-sizing:border-box}body{margin:0;background:#fafafa;color:#222;font:12px/1.5 system-ui,sans-serif}
  @media(prefers-color-scheme:dark){body{background:#171717;color:#eee;color-scheme:dark}}
  button,a{font:inherit;color:inherit}button{border:0;background:none;cursor:pointer}a{text-decoration:none}
  header,main{padding:16px}#outside{display:none}header:before{content:'stYFI · Holder ranking';display:block;font-size:16px;font-weight:700;margin-bottom:12px}
  input{border:1px solid #8886;border-radius:4px;padding:6px;background:transparent;color:inherit}
  .table-scroll{overflow-x:auto;border:1px solid #8884;border-radius:8px}table{width:100%;border-collapse:collapse;white-space:nowrap}
  th,td{padding:8px;text-align:left;border-bottom:1px solid #8884}td.numeric{text-align:right}
  .address-line{max-width:100%;white-space:nowrap}.address-link{min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;font:12.5px monospace}
  .address-link.has-name{font:500 13px system-ui}.address-faint{margin-left:8px;color:#888;font:11px monospace}
  .copy-trigger,.explorer-link{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;padding:0;color:#888}
  .copy-trigger{margin-left:4px}.drawer{margin:16px;border:1px solid #8884;border-radius:8px;max-width:480px}
  .drawer-head{gap:4px;height:52px;padding:0 12px 0 20px}#wallet-address{min-width:0;overflow:hidden;text-overflow:ellipsis;font:12px monospace}
  #wallet-copy{display:flex;flex:none}#wallet-close{margin-left:auto}.activity-row{display:flex;justify-content:space-between;padding:16px}
  @media(max-width:700px){th:nth-child(n+4),td.numeric,.address-faint,tbody .copy-trigger,tbody .explorer-link{display:none}.address-link{max-width:42vw}.drawer{margin:0;border-radius:0}.drawer-head{padding-left:12px}th,td{padding:6px 4px}}
  </style>`;

test('capture stYFI ranking and drawer with short, long and ENS names', async ({ page }) => {
  await mkdir('docs/images', { recursive: true });
  const named = '0x' + 'ef'.repeat(20);
  const records = [{ ...record, tags: ['wavey deployer'] },
    { ...record, address: other, tags: ['Treasury operations '.repeat(4).trimEnd() + '!'] },
    { ...record, address: named, tags: ['Named treasury'] }];
  for (const theme of ['dark', 'light']) for (const width of [390, 800]) {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await start(page, { site: 'https://styfi.wavey.info/', records,
      html: styfiPage(styfiRow(address) + styfiRow(other) + styfiRow(named, { name: 'treasury.eth' })) + styles });
    await expect(page.locator('#ranking-body [data-0xtagger-tag]')).toHaveCount(3);
    for (const [wallet, tag, suffix] of [[other, records[1].tags[0], ''], [address, records[0].tags[0], '-short']]) {
      await page.evaluate(at => window.openWallet(at), wallet);
      await expect(page.locator('#wallet-address')).toHaveAttribute('data-0xtagger-tag', tag);
      const panel = await page.locator('#wallet-panel').boundingBox();
      await page.screenshot({ path: `docs/images/tag-styfi${suffix}-${theme}-${width}.png`, animations: 'disabled',
        clip: { x: 0, y: 0, width, height: Math.ceil(panel.y + panel.height + 16) } });
    }
  }
});
