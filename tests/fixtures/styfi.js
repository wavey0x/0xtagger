// Current stYFI wallet surfaces and their native actions, observed 2026-11-12.
// Activity remains transaction content, even when its title mentions a wallet.
export const styfiRow = (wallet, { name = '', title = wallet, rowAddress = wallet,
  href = `https://etherscan.io/address/${wallet}` } = {}) => `
  <tr data-address="${rowAddress}"><td class="rank">01</td><td class="account">
    <span class="address-line"><button type="button" class="address-link${name ? ' has-name' : ''}"
      title="${title}" aria-label="View details for ${wallet}">
      <span class="address-label">${name || `${wallet.slice(0, 7)}…${wallet.slice(-5)}`}</span>
      <span class="address-label-compact">${name || `${wallet.slice(0, 5)}…${wallet.slice(-4)}`}</span>
    </button>${name ? `<span class="address-faint">${wallet.slice(0, 7)}…${wallet.slice(-5)}</span>` : ''}
    <button class="copy-trigger" type="button" aria-label="Copy address ${wallet}">⧉</button>
    <a class="explorer-link" href="${href}" target="_blank" aria-label="View ${wallet} on Etherscan">↗</a></span>
  </td><td class="power-value">202.19</td><td class="numeric">67.40</td><td class="numeric ybc-value">12.50</td></tr>`;

export const styfiPage = rows => `<header><div class="search-wrap"><input id="search" type="search" aria-label="Find a wallet"></div></header>
  <main><section class="ranking"><div class="table-scroll"><table><thead><tr>
    <th class="rank-col">#</th><th class="wallet-col"><button data-sort="address">Wallet</button></th>
    <th>Voting power</th><th>stYFI</th><th>YBC share</th>
  </tr></thead><tbody id="ranking-body">${rows}</tbody></table></div></section>
  <button id="outside">Outside</button></main>
  <aside id="wallet-panel" class="drawer" hidden><div class="drawer-head">
    <a id="wallet-address" target="_blank"></a><div id="wallet-copy"></div>
    <button id="wallet-close" aria-label="Close wallet details">×</button></div>
    <div id="wallet-activity"><a class="activity-row" href="https://etherscan.io/tx/0x${'ef'.repeat(32)}">
      <span class="activity-title">Deposit stYFI</span><span>6.49</span></a></div>
  </aside><style>.address-label-compact{display:none}.address-line,.drawer-head{display:flex;align-items:center}
  .drawer[hidden]{display:flex;visibility:hidden;pointer-events:none}</style>
  <script>(${styfiControls.toString()})();</script>`;

function styfiControls() {
  const panel = document.querySelector('#wallet-panel');
  let opener;
  window.openWallet = wallet => {
    opener = document.activeElement;
    panel.hidden = false;
    if (window.site) window.site.hash = wallet;
    const heading = document.querySelector('#wallet-address');
    const named = document.querySelector(`tr[data-address="${wallet}"] .has-name .address-label`);
    heading.textContent = named ? `${named.textContent} · ${wallet.slice(0, 7)}…${wallet.slice(-5)}` : wallet;
    heading.title = wallet;
    heading.href = `https://etherscan.io/address/${wallet}`;
    document.querySelector('#wallet-copy').innerHTML = `<button class="copy-trigger" aria-label="Copy address ${wallet}">⧉</button>`;
  };
  const close = () => { panel.hidden = true; if (window.site) window.site.hash = ''; opener?.focus(); };
  document.querySelector('#wallet-close').onclick = close;
  document.querySelector('#ranking-body').onclick = event => {
    if (event.target.closest('button:not(.address-link), a') || String(getSelection())) return;
    const row = event.target.closest('tr[data-address]');
    if (row) window.openWallet(row.dataset.address);
  };
  document.addEventListener('click', event => {
    const copy = event.target.closest('.copy-trigger');
    if (copy) {
      window.nativeCopied = copy.getAttribute('aria-label').match(/0x[0-9a-f]{40}/i)[0];
      copy.setAttribute('aria-label', `Copied address ${window.nativeCopied}`);
    }
    const link = event.target.closest('a[href]');
    if (link) { event.preventDefault(); window.nativeOpened = link.href; }
    if (panel.hidden || !event.target.isConnected || event.target.closest('#wallet-panel, tr[data-address], .search-wrap')) return;
    close();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
}
