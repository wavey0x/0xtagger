import { test, expect } from '@playwright/test';
import { address, other, record, start, health, reported } from './controller.js';

// Every registered adapter owes the same guarantees, whatever site it reads.
// Shared cases live below; a site limited to one widget has a focused suite.
//
//   canonical  a display whose identity is beyond doubt
//   fragment   an abbreviated display with no canonical source behind it
//   conflict   a display whose sources name two different wallets
//   nested     a display wrapped in another candidate, where one must win
const sites = [
  {
    id: 'Etherscan', url: 'https://etherscan.io/accounts', network: 'eip155:1',
    frame: body => `<header>Explorer</header><main>${body}</main>`,
    canonical: id => `<a id="${id}" href="/address/${address}">${address}</a>`,
    fragment: id => `<a id="${id}" href="/address/">0xabab…abab</a>`,
    conflict: id => `<a id="${id}" href="/address/${other}" data-full-address="${address}">${address}</a>`,
    nested: id => `<a id="${id}" href="/address/${address}"><span class="hash-tag">Treasury wallet</span></a>`,
  },
  {
    id: 'Safe', url: `https://app.safe.global/home?safe=eth:${address}`, network: 'eip155:1',
    frame: body => `<header>Safe</header><main>${body}</main>`,
    canonical: id => `<a id="${id}" href="/address/${address}">${address}</a>`,
    fragment: id => `<a id="${id}" href="/address/">0xabab…abab</a>`,
    conflict: id => `<a id="${id}" href="/address/${other}" data-address="${address}">${address}</a>`,
    nested: id => `<a id="${id}" href="/address/${address}"><span>${address}</span></a>`,
  },
  {
    id: 'This site', url: 'https://plain.example/wallets', network: undefined,
    frame: body => `<main>${body}</main>`,
    canonical: id => `<p id="${id}">${address}</p>`,
    fragment: id => `<p id="${id}">0xabab…abab</p>`,
    conflict: id => `<a id="${id}" href="/address/${other}">${address}</a>`,
    nested: id => `<div id="${id}"><p>${address}</p></div>`,
  },
];

for (const site of sites) {
  const open = (page, body) => start(page, { site: site.url, html: site.frame(body) });

  test.describe(site.id, () => {
    test('claims its pages and names only a chain the URL establishes', async ({ page }) => {
      await open(page, site.canonical('subject'));
      expect(await reported(page)).toMatchObject({ adapter: site.id, status: 'ready' });
      expect((await health(page)).network).toBe(site.network);
    });

    test('tags a canonical display with the address it actually names', async ({ page }) => {
      await open(page, site.canonical('subject'));
      await expect(page.locator('#subject')).toHaveAttribute('data-0xtagger-address', address);
      await expect(page.locator('#subject')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    });

    test('never establishes identity from an abbreviation alone', async ({ page }) => {
      await open(page, site.fragment('subject'));
      await expect(page.locator('#subject')).not.toHaveAttribute('data-0xtagger-address');
    });

    test('disqualifies contradictory evidence without costing the page its tags', async ({ page }) => {
      await open(page, site.conflict('subject') + site.canonical('sound'));
      expect(await health(page)).toMatchObject({ status: 'ready' });
      await expect(page.locator('#subject')).not.toHaveAttribute('data-0xtagger-address');
      await expect(page.locator('#sound')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    });

    test('invalid links do not disable sound address annotations', async ({ page }) => {
      const href = `http://[/address/${address}`;
      await open(page, `<a id="invalid" href="${href}">${address}</a>` + site.canonical('sound'));
      expect(await health(page)).toMatchObject({ status: 'ready' });
      for (const id of ['invalid', 'sound']) {
        await expect(page.locator('#' + id)).toHaveAttribute('data-0xtagger-address', address);
        await expect(page.locator('#' + id)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
      }
      await expect(page.locator('#invalid')).toHaveAttribute('href', href);
      await expect(page.locator('#invalid')).toHaveText(address);
    });

    // The controller's invalidation depends on this: it finds an affected
    // ancestor with a single closest(), so a nested pair would strand a tag.
    test('never annotates one element inside another, through re-rendering', async ({ page }) => {
      await open(page, site.nested('subject'));
      const survey = () => page.evaluate(() => {
        const all = [...document.querySelectorAll('[data-0xtagger-address]')];
        return { total: all.length, nested: all.filter(a => all.some(b => b !== a && b.contains(a))).length };
      });
      expect(await survey()).toEqual({ total: 1, nested: 0 });
      // Re-render the row the way a live table does.
      await page.locator('#subject').evaluate(element => element.append(document.createElement('i')));
      await expect.poll(survey).toEqual({ total: 1, nested: 0 });
    });

    test('leaves editable and interactive content alone', async ({ page }) => {
      await open(page, `<input value="${address}"><button id="pressable">${address}</button>
        <div contenteditable="true">${address}</div><span aria-hidden="true">${address}</span>`);
      await expect(page.locator('[data-0xtagger-address],[data-0xtagger-tag]')).toHaveCount(0);
    });

    test('removes every trace of itself when stopped', async ({ page }) => {
      await open(page, site.canonical('subject'));
      await expect(page.locator('#subject')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
      await page.evaluate(() => window.controller.stop());
      await expect(page.locator('[data-0xtagger-address],[data-0xtagger-tag],[data-0xtagger-ui]')).toHaveCount(0);
      await expect(page.locator('#subject')).toHaveText(address);
    });
  });
}

test.describe('Etherscan explorer hosts', () => {
  for (const [host, chain] of [
    ['arbiscan.io', '42161'],
    ['optimistic.etherscan.io', '10'],
    ['sepolia.basescan.org', '84532'],
    ['hyperevmscan.io', '999'],
    ['testnet-mega.etherscan.io', '6343'],
    ['blastscan.io', '81457'],
  ]) {
    test(`${host} uses the shared adapter with its own chain`, async ({ page }) => {
      await start(page, {
        site: `https://${host}/address/${address}`,
        html: `<header>Explorer</header><main><span id="mainaddress">${address}</span></main>`,
        records: [
          { ...record, scope: `eip155:${chain}`, tags: ['This chain'] },
          { ...record, scope: 'eip155:1', tags: ['Ethereum only'] },
        ],
      });
      expect(await reported(page)).toMatchObject({ adapter: 'Etherscan', status: 'ready', network: `eip155:${chain}` });
      await expect(page.locator('#mainaddress')).toHaveAttribute('data-0xtagger-tag', 'This chain');
    });
  }

  for (const host of ['gnosisscan.io', 'apescan.io', 'opbnbscan.com', 'arbiscan.io.example']) {
    test(`${host} is not claimed as Etherscan`, async ({ page }) => {
      await start(page, {
        site: `https://${host}/address/${address}`,
        html: `<header>Explorer</header><main><span id="mainaddress">${address}</span></main>`,
      });
      expect(await reported(page)).toMatchObject({ adapter: 'This site', status: 'ready' });
    });
  }
});

test.describe('stYFI ranking', () => {
  const site = 'https://styfi.wavey.info/';
  const row = (wallet, { title = wallet, href = `https://etherscan.io/address/${wallet}` } = {}) => `
    <tr><td class="rank">01</td><td class="account">
      <span class="address-line">
        <a class="address-link" href="${href}" title="${title}" target="_blank">
          <span class="address-label">0x${wallet.slice(2, 7)}…${wallet.slice(-5)}</span>
          <span class="address-label-compact">0x${wallet.slice(2, 5)}…${wallet.slice(-4)}</span>
        </a>
        <button class="copy-trigger" type="button">Copy address</button>
      </span>
      <span class="account-extras"><span class="badge">YBC</span></span>
    </td><td>${wallet}</td></tr>`;
  const frame = body => `<header><input id="search" type="search"></header><main>
    <p id="elsewhere">${address}</p>
    <section class="ranking"><table><thead><tr><th><button data-sort="address">ADDRESS</button></th></tr></thead>
    <tbody id="ranking-body">${body}</tbody></table></section></main>`;
  const open = (page, body) => start(page, { site, html: frame(body) });

  test('tags only the main table address link and preserves its native controls', async ({ page }) => {
    await open(page, row(address));
    expect(await reported(page)).toMatchObject({ adapter: 'stYFI', status: 'ready', network: 'eip155:1' });
    const link = page.locator('#ranking-body .address-link');
    await expect(link).toHaveAttribute('data-0xtagger-address', address);
    await expect(link).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(link).toHaveAttribute('href', `https://etherscan.io/address/${address}`);
    await expect(link).toHaveAttribute('title', address);
    await expect(link.locator('.address-label-compact')).toHaveText('0xaba…abab');
    await expect(page.locator('#elsewhere')).not.toHaveAttribute('data-0xtagger-address');
    await expect(page.locator('#ranking-body td:last-child')).not.toHaveAttribute('data-0xtagger-address');
    await expect(page.locator('.account-extras .badge')).toHaveText('YBC');
    await page.locator('.copy-trigger').evaluate((button, wallet) => {
      button.addEventListener('click', () => { window.nativeCopied = wallet; });
    }, address);
    await page.locator('.copy-trigger').click();
    expect(await page.evaluate(() => window.nativeCopied)).toBe(address);
    await page.locator('.address-line > [data-0xtagger-edit]').getByRole('button').click();
    await expect(page.getByRole('textbox', { name: 'Tag 1', exact: true })).toHaveValue('Treasury');
  });

  test('requires matching full Ethereum addresses in the link and title', async ({ page }) => {
    await open(page, row(address, { title: other }) +
      row(address, { href: 'https://basescan.org/address/' + address }) +
      row(address, { href: '/wallet/' + address }) +
      row(address, { title: '' }) + row(address));
    await expect(page.locator('#ranking-body .address-link[data-0xtagger-address]')).toHaveCount(1);
    await expect(page.locator('#ranking-body tr:last-child .address-link')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  });

  test('reannotates addresses when search or sort rebuilds ranking rows', async ({ page }) => {
    await open(page, row(address));
    await expect(page.locator('#ranking-body .address-link')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await page.locator('#ranking-body').evaluate((body, html) => { body.innerHTML = html; }, row(other));
    await expect(page.locator('#ranking-body .address-link')).not.toHaveAttribute('data-0xtagger-address');
    await page.locator('#ranking-body').evaluate((body, html) => { body.innerHTML = html; }, row(address));
    await expect(page.locator('#ranking-body .address-link')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  });
});

// A table an explorer embeds is a frame of its own: rows, and none of the
// landmarks the page around it has. The frame's URL is the explorer's business.
test.describe('Etherscan embedded transfers', () => {
  const site = `https://etherscan.io/token/generic-tokentxns2?contractAddress=${other}&a=${address}`;
  const table = `<div class="table-responsive"><table><tbody><tr>
    <td><a id="from" class="hash-tag" href="/address/${other}#tokentxns" target="_parent"
      data-highlight-target="${other}" data-full-address="${other}">0xcdcd…cdcd</a></td>
    <td><span id="to" class="hash-tag" data-highlight-target="${address}">BuilderNet</span></td>
  </tr></tbody></table></div>`;

  test('tags the headerless transfer table from canonical row identities and the explorer chain', async ({ page }) => {
    await start(page, { site, html: table, framed: true, records: [record,
      { ...record, scope: 'eip155:1', tags: ['Ethereum treasury'] },
      { ...record, address: other, tags: ['Sender'] },
    ] });
    expect(await reported(page)).toMatchObject({ adapter: 'Etherscan', status: 'ready', network: 'eip155:1' });
    await expect(page.locator('#from')).toHaveAttribute('data-0xtagger-tag', 'Sender');
    await expect(page.locator('#from')).toHaveAttribute('href', `/address/${other}#tokentxns`);
    await expect(page.locator('#from')).toHaveAttribute('target', '_parent');
    await expect(page.locator('#from')).toHaveText('0xcdcd…cdcd');
    await expect(page.locator('#to')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('#to')).toHaveAttribute('data-0xtagger-tag', 'Ethereum treasury');
    await expect(page.locator('#to')).toHaveText('BuilderNet');
  });

  test('a newly mapped testnet scopes addresses in its embedded table', async ({ page }) => {
    await start(page, { site: `https://sepolia.basescan.org/token/generic-tokentxns2?a=${address}`,
      html: table, framed: true, records: [
        { ...record, scope: 'eip155:84532', tags: ['Base test wallet'] },
        { ...record, scope: 'eip155:1', tags: ['Ethereum wallet'] },
      ] });
    expect(await reported(page)).toMatchObject({ adapter: 'Etherscan', status: 'ready', network: 'eip155:84532' });
    await expect(page.locator('#to')).toHaveAttribute('data-0xtagger-tag', 'Base test wallet');
    await expect(page.locator('#from')).toHaveAttribute('href', `/address/${other}#tokentxns`);
  });

  test('an embedded view still requires a table, and a page of its own still requires landmarks', async ({ page }) => {
    await start(page, { site, html: '<p>Unavailable</p>', framed: true });
    await expect.poll(() => health(page)).toMatchObject({ status: 'stale' });
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
    // The same table, in a document nothing embedded: an explorer page that has
    // lost its landmarks is an explorer we no longer read, not a frame.
    await start(page, { site: 'https://etherscan.io/accounts', html: table });
    await expect.poll(() => health(page)).toMatchObject({ status: 'stale' });
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
  });

  test('a token page tags the table it embeds, whatever that frame is called', async ({ page }) => {
    for (const frame of ['/token/generic-tokentxns2?a=' + address, '/address-tokenpage?a=' + address, '/whatever-they-rename-it-to']) {
      await start(page, { site: `https://etherscan.io${frame}`, html: table, framed: true,
        records: [{ ...record, address: other, tags: ['Sender'] }] });
      expect(await reported(page), frame).toMatchObject({ status: 'ready' });
      await expect(page.locator('#from')).toHaveAttribute('data-0xtagger-tag', 'Sender');
    }
  });
});

test.describe('Etherscan token holders', () => {
  const site = `https://etherscan.io/token/generic-tokenholders2?m=dark&a=${other}&p=1`;
  const row = ({ id = 'holder', href = `/token/${other}?a=${address}`, copied = address,
    name = 'Curve: Fee Receiver' } = {}) => `<tr><td>13</td><td><div class="d-flex align-items-center gap-1">
      <span data-bs-toggle="tooltip" title="Proxy: ${name} (${address}); implementation: ${other}">
        <i class="far fa-memo"></i> <a id="${id}" href="${href}" target="_parent">${name}</a>
      </span><a id="copy-${id}" class="js-clipboard" href="javascript:;" data-clipboard-text="${copied}"
        onclick="window.nativeCopied=this.dataset.clipboardText">Copy</a>
    </div></td><td></td><td></td><td></td><td><a id="analytics-${id}" href="/token/${other}?a=${address}#analytics">Analytics</a></td></tr>`;
  const table = body => `<div class="table-responsive"><table><thead id="theadHolderTable"><tr><th>Rank</th><th>Address</th></tr></thead><tbody>${body}</tbody></table></div>`;

  test('tags a named holder from matching link and copy addresses while keeping native controls', async ({ page }) => {
    await start(page, { site, html: table(row()), framed: true });
    expect(await reported(page)).toMatchObject({ adapter: 'Etherscan', status: 'ready', network: 'eip155:1' });
    await expect(page.locator('#holder')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('#holder')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#holder')).toHaveText('Curve: Fee Receiver');
    await expect(page.locator('#holder')).toHaveAttribute('href', `/token/${other}?a=${address}`);
    await expect(page.locator('#holder')).toHaveAttribute('target', '_parent');
    await expect(page.locator('#analytics-holder')).not.toHaveAttribute('data-0xtagger-address');
    await page.locator('#copy-holder').click();
    expect(await page.evaluate(() => window.nativeCopied)).toBe(address);
  });

  test('offers the verified holder name with an all-networks default', async ({ page }) => {
    await start(page, { site, html: table(row()), framed: true, records: [] });
    await page.getByRole('button', { name: 'Edit wallet tags' }).click();
    await expect(page.getByRole('textbox', { name: 'Tag 1', exact: true })).toHaveValue('Curve: Fee Receiver');
    await page.getByRole('textbox', { name: 'Tag 1', exact: true }).press('Enter');
    await expect.poll(() => page.evaluate(() => window.saves.at(-1)))
      .toMatchObject({ address, scope: 'global', tags: ['Curve: Fee Receiver'], source: 'etherscan:page' });
  });

  test('rejects a holder whose link and copy disagree or whose token page differs', async ({ page }) => {
    const wrongCopy = row({ id: 'wrong-copy', copied: other });
    const wrongToken = row({ id: 'wrong-token', href: `/token/${address}?a=${address}` });
    await start(page, { site, html: table(wrongCopy + wrongToken), framed: true });
    await expect(page.locator('#wrong-copy')).not.toHaveAttribute('data-0xtagger-address');
    await expect(page.locator('#wrong-token')).not.toHaveAttribute('data-0xtagger-address');
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(0);
  });
});

// The contract reader is a frame of its own as well. A view function that
// answers with an address renders it as the link the tables use, filled in by
// the explorer's own script once the function has been queried.
test.describe('Etherscan embedded contract reader', () => {
  const site = `https://etherscan.io/readContract?m=light&a=${other}&n=mainnet&v=${other}`;
  const fn = (id, href, text) => `<div class="accordion mb-2"><div class="accordion-item">
    <div class="js-read-contract-function accordion-collapse collapse show">
      <div class="accordion-body bg-light border-top small rounded-bottom-2">
        <div class="row gx-1"></div><a id="${id}" class="me-1" href="${href}" target="_parent">${text}</a>
        <span class="badge">address</span></div></div></div></div>`;
  // An answer, and a function nobody has queried yet.
  const reader = fn('answer', `/address/${address}`, address) + fn('pending', '/address/', '');

  test('names the address a view function answers with, and keeps the answer in view', async ({ page }) => {
    await start(page, { site, html: reader, framed: true });
    expect(await reported(page)).toMatchObject({ adapter: 'Etherscan', status: 'ready', network: 'eip155:1' });
    await expect(page.locator('#answer')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#answer')).toHaveAttribute('data-0xtagger-short', '0xABaB…ABaB');
    // The explorer's own link is left to work as it did: the frame navigates
    // the page around it, not itself.
    await expect(page.locator('#answer')).toHaveAttribute('href', `/address/${address}`);
    await expect(page.locator('#answer')).toHaveAttribute('target', '_parent');
    await expect(page.locator('#answer')).toHaveText(address);
    // An empty answer names no wallet.
    await expect(page.locator('#pending')).not.toHaveAttribute('data-0xtagger-address', /./);
  });

  test('names an answer that arrives after the frame was read', async ({ page }) => {
    await start(page, { site, html: reader, framed: true });
    await expect(page.locator('#pending')).not.toHaveAttribute('data-0xtagger-address', /./);
    await page.evaluate(wallet => {
      const link = document.querySelector('#pending');
      link.setAttribute('href', `/address/${wallet}`);
      link.textContent = wallet;
    }, address);
    await expect(page.locator('#pending')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#pending')).toHaveAttribute('data-0xtagger-short', '0xABaB…ABaB');
  });
});

test.describe('Generic address text', () => {
  test('recognizes whole addresses regardless of casing or adjacent text boundaries', async ({ page }) => {
    await start(page, { site: 'https://plain.example/wallets', html: `<main>
      <span id="uppercase">${address.toUpperCase()}</span><span id="prefix"></span><span id="split"></span>
      <span id="fragment">0xabab…abab</span><span id="prose">Wallet: ${address}</span><span id="long">${address}ab</span>
      </main><script>
      document.querySelector('#prefix').append(document.createTextNode('0'), document.createComment('framework boundary'), document.createTextNode('${address.slice(1).toUpperCase()}'));
      document.querySelector('#split').append(document.createTextNode('${address.slice(0, 21)}'), document.createTextNode('${address.slice(21)}'));
      </script>` });
    for (const id of ['uppercase', 'prefix', 'split']) {
      await expect(page.locator('#' + id)).toHaveAttribute('data-0xtagger-address', address);
      await expect(page.locator('#' + id)).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    }
    for (const id of ['fragment', 'prose', 'long']) {
      await expect(page.locator('#' + id)).not.toHaveAttribute('data-0xtagger-address');
    }
    await expect(page.locator('#uppercase')).toHaveText(address.toUpperCase());
    await expect(page.locator('#prefix')).toHaveText(address.toUpperCase());
    await expect(page.locator('#split')).toHaveText(address);
  });

  test('updates split address identity when the website replaces its text', async ({ page }) => {
    await start(page, { site: 'https://plain.example/wallets',
      records: [record, { ...record, address: other, tags: ['Other wallet'] }],
      html: `<main><span id="subject"></span></main><script>
      document.querySelector('#subject').append(document.createTextNode('0x'), document.createTextNode('${address.slice(2)}'));
      </script>`,
    });
    const subject = page.locator('#subject');
    await expect(subject).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await subject.evaluate((element, other) => { element.lastChild.data = other.slice(2); }, other);
    await expect(subject).toHaveAttribute('data-0xtagger-address', other);
    await expect(subject).toHaveAttribute('data-0xtagger-tag', 'Other wallet');
    await expect(subject).toHaveText(other);
    expect(await health(page)).toMatchObject({ status: 'ready' });
  });
});

// Safe sets the name in a box of its own above the address, and sometimes puts
// a badge beside it saying which of its books the name came from. Replacing the
// name rather than the address is what keeps one name to a widget; leaving the
// badge there would have the page vouching for our wording.
test.describe('Safe address widget', () => {
  const site = `https://app.safe.global/settings/setup?safe=eth:${other}`;
  const splitAddress = `0x<b>${address.slice(2, 6)}</b>${address.slice(6, -4)}<b>${address.slice(-4)}</b>`;
  const widget = ({ name = 'dudesahn', link = true, shown = `0xabab…abab`, href = '/home?safe=eth:' + other,
    explorer = 'etherscan.io', key = '' } = {}) =>
    `<div class="SrcEthHashInfo_container__h">
      <div class="SrcEthHashInfo_avatarContainer__h"></div>
      <div>
        ${name ? `<div title="${name}" class="ethHashInfo-name flex items-center">
          ${href ? `<a id="name${key}" href="${href}">${name}</a>` : `<div id="name${key}">${name}</div>`}
          <span id="badge${key}"><svg aria-hidden="true" width="20" height="20"></svg></span>
        </div>` : ''}
        <div class="SrcEthHashInfo_addressContainer__h">
          <b>eth:</b><span id="native-copy${key}" class="inline-flex cursor-pointer" aria-label="Copy to clipboard"
            onclick="window.nativeCopied='${address}';window.nativeCopyCount=(window.nativeCopyCount||0)+1"><span id="addr${key}">${shown}</span></span>
          ${link ? `<a id="explorer${key}" data-testid="explorer-btn" href="https://${explorer}/address/${address}">open</a>` : ''}
        </div>
      </div>
    </div>`;
  const open = (page, html) => start(page, { site, html: `<header>Safe</header><main>${html}</main>` });

  // The name is wrapped in a link, and a display holding a link is disqualified:
  // matching the name's own box rather than the box Safe groups it in is the
  // whole difference between this working and silently doing nothing.
  test('tags the name beside the address, through the link Safe wraps it in', async ({ page }) => {
    await open(page, widget());
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#name')).toHaveText('dudesahn');
    await expect(page.locator('#name')).toHaveAttribute('href', `/home?safe=eth:${other}`);
  });

  test('tags a plain name box the same way', async ({ page }) => {
    await open(page, widget({ href: '' }));
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
  });

  // One name to a widget: the address below the replaced name stays an address.
  test('leaves the address alone where the name carries the tag', async ({ page }) => {
    await open(page, widget());
    await expect(page.locator('#addr')).not.toHaveAttribute('data-0xtagger-tag', /./);
    await expect(page.locator('#addr')).toHaveText('0xabab…abab');
    await expect(page.locator('[data-0xtagger-name-line]')).toHaveCount(0);
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(1);
  });

  test('puts a tag above Safe’s unnamed address and keeps its own controls', async ({ page }) => {
    await open(page, widget({ name: '' }));
    const line = page.locator('[data-0xtagger-name-line]');
    await expect(line).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(line).toBeVisible();
    await expect(line.locator('[data-0xtagger-edit]')).toHaveCount(1);
    await expect(page.locator('#addr')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('#addr')).not.toHaveAttribute('data-0xtagger-tag', /./);
    await expect(page.locator('#addr')).toHaveText('0xabab…abab');
    await expect(page.locator('#addr')).toBeVisible();
    await expect(page.locator('#explorer')).toHaveAttribute('href', `https://etherscan.io/address/${address}`);
    await page.locator('#addr').click();
    expect(await page.evaluate(() => window.nativeCopied)).toBe(address);
    expect(await page.evaluate(() => window.nativeCopyCount)).toBe(1);
    await line.getByRole('button', { name: 'Edit wallet tags' }).click();
    expect(await page.evaluate(() => window.nativeCopyCount)).toBe(1);
    await expect(page.getByRole('textbox', { name: 'Tag 1', exact: true })).toHaveValue('Treasury');
    await page.keyboard.press('Escape');
  });

  test('tags bold-split address parameters in two expanded batch actions and after a rerender', async ({ page }) => {
    const transaction = `https://app.safe.global/transactions/tx?safe=hyper-evm:${other}`;
    await start(page, { site: transaction, html: `<header>Safe</header><main>
      <section data-testid="batch-action">${widget({ shown: splitAddress, explorer: 'hyperevmscan.io', key: '-named' })}</section>
      <section data-testid="batch-action">${widget({ name: '', shown: splitAddress, explorer: 'hyperevmscan.io', key: '-unnamed' })}</section>
      </main>` });
    await expect(page.locator('#name-named')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#addr-named')).not.toHaveAttribute('data-0xtagger-tag', /./);
    await expect(page.locator('#addr-unnamed')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('[data-testid="batch-action"]').nth(1).locator('[data-0xtagger-name-line]'))
      .toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(2);

    await page.locator('[data-testid="batch-action"]').nth(1).evaluate(node => { node.innerHTML = node.innerHTML; });
    await expect(page.locator('#addr-unnamed')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(2);
    await expect(page.locator('[data-testid="batch-action"]').nth(1).locator('[data-0xtagger-name-line] [data-0xtagger-edit]'))
      .toHaveCount(1);
  });

  test('keeps nested address arrays and abbreviated signer values taggable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page, `<div data-testid="tx-data-row"><div data-testid="address-array">
      ${widget({ name: '', key: '-array' })}
      <div data-testid="nested-array">${widget({ name: '', key: '-nested' })}</div>
      </div></div><div data-testid="signer-summary">${widget({ name: '', key: '-signer' })}</div>`);
    for (const key of ['-array', '-nested', '-signer']) {
      await expect(page.locator(`#addr${key}`)).toHaveAttribute('data-0xtagger-address', address);
      await expect(page.locator(`#explorer${key}`)).toHaveAttribute('href', `https://etherscan.io/address/${address}`);
    }
    await expect(page.locator('[data-0xtagger-name-line]')).toHaveCount(3);
  });

  test('leaves batch calldata and transaction hashes alone', async ({ page }) => {
    const calldata = '0x00518c21' + 'ab'.repeat(50);
    const hash = '0x' + 'cd'.repeat(32);
    await open(page, `<div data-testid="tx-hexData"><span id="collapsed">${calldata}</span>
      <span id="expanded">${calldata}</span></div><span id="hash">${hash}</span>${widget({ name: '' })}`);
    for (const id of ['collapsed', 'expanded', 'hash']) {
      await expect(page.locator(`#${id}`)).not.toHaveAttribute('data-0xtagger-address');
    }
    await expect(page.locator('[data-0xtagger-name-line]')).toHaveCount(1);
  });

  // The badge claims the name came from one of Safe's own books. While a tag
  // stands in its place that claim is false, so it goes — and comes back.
  test('hides Safe\'s name-origin badge only while a tag stands in for the name', async ({ page }) => {
    await open(page, widget());
    await expect(page.locator('#badge')).toBeHidden();
    // Only Safe's badge: hiding our own control beside it would make the row
    // the substitution happened on the one row nobody can edit.
    await expect(page.locator('#name + [data-0xtagger-edit], #name [data-0xtagger-edit]')).toBeVisible();
    await page.evaluate(() => window.controller.stop());
    await expect(page.locator('#badge')).toBeVisible();
    await expect(page.locator('#name')).toHaveText('dudesahn');
  });

  // Safe gives that slot to its name-origin icon or to a notice of its own,
  // never to both. A notice there says nothing about where our wording came
  // from, so hiding it would be pure loss — and the kind of loss that matters.
  test('leaves a notice beside the name alone', async ({ page }) => {
    const warned = widget().replace('<span id="badge"><svg aria-hidden="true" width="20" height="20"></svg></span>',
      '<span id="warning"><svg aria-hidden="true" width="20" height="20"></svg><b>Looks like another address</b></span>');
    await open(page, warned);
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('#warning')).toBeVisible();
    await expect(page.locator('#warning')).toContainText('Looks like another address');
  });

  // Nothing proves which wallet an abbreviation belongs to, so a widget with no
  // explorer link names nobody — and must not take the address down with it.
  test('an unprovable widget tags nothing, and a full address can prove its name', async ({ page }) => {
    await open(page, widget({ link: false }));
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
    await page.evaluate(() => window.controller.stop());
    await open(page, widget({ link: false, shown: address }));
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-address', address);
    await expect(page.locator('#addr')).not.toHaveAttribute('data-0xtagger-tag', /./);
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('[data-0xtagger-name-line]')).toHaveCount(0);
  });

  test('does not name a widget whose full address disagrees with its explorer link', async ({ page }) => {
    const disputed = widget({ shown: address }).replace(
      `https://etherscan.io/address/${address}`, `https://etherscan.io/address/${other}`);
    await open(page, disputed);
    await expect(page.locator('[data-0xtagger-address],[data-0xtagger-name-line]')).toHaveCount(0);
    await expect(page.locator('#addr')).toHaveText(address);
  });

  test('returns an unnamed address to Safe when its tag is hidden or the row changes', async ({ page }) => {
    await open(page, widget({ name: '' }));
    const line = page.locator('[data-0xtagger-name-line]');
    await expect(line).toHaveCount(1);
    await line.getByRole('button', { name: 'Edit wallet tags' }).click();
    await page.getByRole('switch', { name: 'Show my tags for this address', exact: true }).click();
    await expect(line).toHaveCount(0);
    await expect(page.locator('#addr')).toHaveText('0xabab…abab');
    await page.getByRole('switch', { name: 'Show my tags for this address', exact: true }).click();
    await expect(line).toHaveCount(1);
    await page.keyboard.press('Escape');
    const oldAddress = await page.locator('#addr').elementHandle();
    await page.locator('.SrcEthHashInfo_container__h').evaluate(node => { node.innerHTML = node.innerHTML; });
    await expect.poll(() => page.locator('#addr').evaluate((node, old) => node !== old, oldAddress)).toBe(true);
    await expect(line).toHaveCount(1);
    await expect(line.locator('[data-0xtagger-edit]').getByRole('button')).toBeVisible();
    await expect(page.locator('#addr')).toHaveText('0xabab…abab');
    await line.evaluate(node => node.remove());
    await expect(line.locator('[data-0xtagger-edit]').getByRole('button')).toBeVisible();
    await page.evaluate(() => window.controller.stop());
    await expect(line).toHaveCount(0);
    await expect(page.locator('#addr')).toHaveText('0xabab…abab');
  });

  // Safe's own placeholders name no wallet: one is the page talking about
  // itself, the other is the absence of a name. Neither is worth offering back.
  test('never offers Safe\'s placeholders as a name', async ({ page }) => {
    for (const placeholder of ['This Safe account', 'Unverified contract']) {
      await open(page, widget({ name: placeholder, href: '' }));
      await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-address', address);
      await page.locator('#name + [data-0xtagger-edit], #name [data-0xtagger-edit]').getByRole('button').click();
      await expect(page.getByRole('textbox', { name: 'Tag 1', exact: true })).toHaveValue('Treasury');
      await expect(page.getByRole('dialog').locator('.offer')).toBeHidden();
      await page.keyboard.press('Escape');
    }
  });

  // The website's own name and its badge are borrowed, never taken: hiding our
  // tags for a moment must hand both back exactly as they were.
  test('hands the name and its badge back while tags are hidden', async ({ page }) => {
    await open(page, widget());
    await expect(page.locator('#badge')).toBeHidden();
    await page.locator('#name + [data-0xtagger-edit], #name [data-0xtagger-edit]').getByRole('button').click();
    await page.getByRole('switch', { name: 'Show my tags for this address', exact: true }).click();
    await expect(page.locator('#name')).not.toHaveAttribute('data-0xtagger-tag', /./);
    await expect(page.locator('#badge')).toBeVisible();
    await page.getByRole('switch', { name: 'Show my tags for this address', exact: true }).click();
    await expect(page.locator('#badge')).toBeHidden();
  });

  // A live panel rewrites its own rows; the substitution has to survive that.
  test('keeps one name to a widget through a rerender', async ({ page }) => {
    await open(page, widget());
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(1);
    await page.locator('.SrcEthHashInfo_container__h').evaluate(node => { node.innerHTML = node.innerHTML; });
    await expect(page.locator('#name')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    await expect(page.locator('[data-0xtagger-tag]')).toHaveCount(1);
    await expect(page.locator('#badge')).toBeHidden();
  });

  // In the audit log the line naming a signer is the control that copies them,
  // so the only display of who signed sits inside something interactive. It
  // names itself by the whole address; the text beside it is an abbreviation,
  // which on its own proves nothing.
  test('names a signer on an audit line that is a copy control', async ({ page }) => {
    const row = at => `<div class="AuditLog_auditRow__h">
      <p class="AuditLog_label__h">Signed (1/3)</p>
      <div class="AuditLog_actorRow__h">
        <div id="actor" role="button" tabindex="0" aria-label="Copy address ${at}">
          <p class="AuditLog_actorText__h">By 0xabab…abab</p>
        </div>
      </div></div>`;
    await open(page, row(address));
    const text = page.locator('#actor p');
    await expect(text).toHaveAttribute('data-0xtagger-address', address);
    await expect(text).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    // The control keeps the name it copies by, and what it copies.
    await expect(page.locator('#actor')).toHaveAttribute('aria-label', `Copy address ${address}`);
    await expect(text).toHaveText('By 0xabab…abab');
    // Our own button goes beside the control rather than inside it: a button
    // within a button answers to the wrong press.
    await expect(page.locator('#actor [data-0xtagger-edit]')).toHaveCount(0);
    await page.locator('#actor + [data-0xtagger-edit]').getByRole('button').click();
    await expect(page.getByRole('textbox', { name: 'Tag 1', exact: true })).toHaveValue('Treasury');
    await page.keyboard.press('Escape');

    // Interactive is still interactive: only a control an adapter vouched for
    // is read, and only where it says which wallet it is about.
    // The current public audit row has the same abbreviated text and no
    // full-address label. It cannot establish which signer to annotate.
    await open(page, row(address).replace(`aria-label="Copy address ${address}"`, ''));
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
    await open(page, `<div role="button" aria-label="Copy address ${address}"><input id="field" value="x"></div>`);
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
  });

  // A control says what it copies, and not everything copied is an address: a
  // transaction hash begins the same way and runs longer, so reading the first
  // forty characters of one would name a wallet nobody mentioned — and an
  // abbreviation that then disagreed with it would pause the whole page.
  test('a control that copies a transaction hash names nobody', async ({ page }) => {
    const hash = '0xdead' + 'ab'.repeat(29) + 'beef';
    await open(page, `<div role="button" aria-label="Copy transaction hash ${hash}"><span id="hash">0xdead…beef</span></div>`);
    await expect(page.locator('[data-0xtagger-address]')).toHaveCount(0);
    expect(await page.evaluate(() => window.controller.health.status)).toBe('ready');
  });

});

// Safe keeps its own address book in site storage. It is read when someone
// asks to import it and at no other time — never while reading the page, and
// never on a website whose adapter keeps nothing.
test.describe('importing the names a website keeps', () => {
  const book = { 1: { [address]: 'Treasury', [other]: 'dudesahn' },
    8453: { [address]: 'Base treasury' }, nonsense: { [address]: 'Ignored' } };
  const watched = `<script>
    window.storageReads = 0;
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) { window.storageReads += 1; return read.call(this, key); };
    localStorage.setItem('SAFE_v2__addressBook', ${JSON.stringify(JSON.stringify(book))});
  </script><header>Safe</header><main><a id="row" href="/address/${address}">${address}</a></main>`;

  test('reads Safe\'s book only when asked, and only what is a name for a wallet', async ({ page }) => {
    await start(page, { site: `https://app.safe.global/home?safe=eth:${other}`, html: watched });
    await expect(page.locator('#row')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    // Reading the page never touches the website's own storage.
    expect(await page.evaluate(() => window.storageReads)).toBe(0);

    const found = await page.evaluate(() => window.controller.harvest());
    expect(await page.evaluate(() => window.storageReads)).toBeGreaterThan(0);
    expect(found).toEqual([
      { address, scope: 'eip155:1', tags: ['Treasury'], source: 'safe:address-book' },
      { address: other, scope: 'eip155:1', tags: ['dudesahn'], source: 'safe:address-book' },
      { address, scope: 'eip155:8453', tags: ['Base treasury'], source: 'safe:address-book' },
    ]);
  });

  test('a website that keeps no book of its own offers nothing', async ({ page }) => {
    await start(page, { site: 'https://etherscan.io/accounts', html: watched });
    expect(await page.evaluate(() => window.controller.harvest())).toEqual([]);
    expect(await page.evaluate(() => window.storageReads)).toBe(0);
  });

  test('a book that is not a book at all reads as nothing', async ({ page }) => {
    const broken = `<script>localStorage.setItem('SAFE_v2__addressBook', 'not json');</script>
      <header>Safe</header><main><a id="row" href="/address/${address}">${address}</a></main>`;
    await start(page, { site: `https://app.safe.global/home?safe=eth:${other}`, html: broken });
    await expect(page.locator('#row')).toHaveAttribute('data-0xtagger-tag', 'Treasury');
    expect(await page.evaluate(() => window.controller.harvest())).toEqual([]);
  });
});
