// Current stYFI wallet surfaces and their native actions, observed 2026-11-14.
// Activity remains transaction content, even when its title mentions a wallet.
export const styfiRow = (wallet, { name = '', rowAddress = wallet,
  href = `https://etherscan.io/address/${wallet}` } = {}) => `
  <tr data-address="${rowAddress}"><td class="rank">01</td><td class="account">
    <span class="address-line"><button type="button" class="address-link${name ? ' has-name' : ''}"
      aria-label="View details for ${wallet}">
      <span class="address-label">${name || `${wallet.slice(0, 7)}…${wallet.slice(-5)}`}</span>
      <span class="address-label-compact">${name || `${wallet.slice(0, 5)}…${wallet.slice(-4)}`}</span>
    </button>${name ? `<span class="address-faint">${wallet.slice(0, 7)}…${wallet.slice(-5)}</span>` : ''}
    <button class="copy-trigger" type="button" aria-label="Copy address ${wallet}">⧉</button>
    <a class="explorer-link" href="${href}" target="_blank" aria-label="View ${wallet} on Etherscan">↗</a></span>
  </td><td class="power-value"><span class="power-num">202.19</span><span class="power-pct">1.2%</span><span class="power-bar"></span></td>
  <td class="numeric">67.40</td><td class="numeric">12.50</td><td class="numeric">18.57</td>
  <td class="numeric ybc-value">12.50</td><td class="numeric">3.14</td><td class="open-cell">›</td></tr>`;

export const styfiVoter = (wallet, { name = '', pool = false, rowAccount = wallet,
  href = `https://etherscan.io/address/${wallet}` } = {}) => `<li><div class="vrow" data-account="${rowAccount}">
  <span class="vwho-cell"><span class="vwho${pool ? ' pool' : name ? ' named' : ''}">${name || `${wallet.slice(0, 7)}…${wallet.slice(-5)}`}</span>
    <button class="copy-trigger" aria-label="Copy address ${wallet}">⧉</button>
    <a class="explorer-link" href="${href}" target="_blank" aria-label="View ${wallet} on Etherscan">↗</a></span>
  <span class="vbar" role="img" aria-label="For"></span><span class="vnum">202.19</span>
  <span class="vwhen">Nov 14<a class="explorer-link" href="https://etherscan.io/tx/0x${'ef'.repeat(32)}" aria-label="Vote transaction on Etherscan">↗</a></span>
  </div></li>`;

export const styfiPage = (rows, { loading = false, voters = '' } = {}) => `<header class="topbar"><div class="search-wrap"><input id="search" type="search" aria-label="Find a wallet"></div>
  <button id="theme-toggle">Switch color theme</button></header>
  <main class="shell"><button data-view="proposals">Proposals</button><button data-view="stakers">Stakers</button>
  <section id="proposals-view" hidden>Proposals</section><section id="stakers-view" class="ranking"><div class="table-scroll"><table><thead><tr>
    <th class="rank-col">#</th><th class="wallet-col"><button data-sort="address">Wallet</button></th>
    <th>Voting power</th><th class="numeric">stYFI</th><th class="numeric">stYFIx</th><th class="numeric">veYFI</th>
    <th class="numeric">YBC share</th><th class="numeric">Liquid lockers</th><th></th>
  </tr></thead><tbody id="ranking-body"${loading ? ' aria-busy="true"' : ''}>${rows}</tbody></table></div></section>
  <button id="outside">Outside</button></main>
  <aside id="wallet-panel" class="drawer" tabindex="-1" hidden><div class="drawer-head">
    <a id="wallet-address" target="_blank"></a><div id="wallet-copy"></div>
    <button id="wallet-close" aria-label="Close wallet details">×</button></div>
    <div id="wallet-activity"><a class="activity-row" href="https://etherscan.io/tx/0x${'ef'.repeat(32)}">
      <span class="activity-title">Deposit stYFI</span><span>6.49</span></a></div>
  </aside><aside id="proposal-panel" class="drawer" tabindex="-1" hidden>
    <div class="drawer-head">Proposal votes<button id="proposal-close" aria-label="Close proposal details">×</button></div>
    <div id="proposal-list"><ol class="vlist">${voters}</ol></div></aside>
  <style>.address-label-compact{display:none}.address-line,.drawer-head,.vwho-cell{display:flex;align-items:center}
  .address-link,.vwho{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .drawer[hidden]{display:flex;visibility:hidden;pointer-events:none}
  @media(max-width:700px){th.numeric,td.numeric,.address-faint,tbody .copy-trigger,tbody .explorer-link{display:none}}</style>
  <script>(${styfiControls.toString()})();</script>`;

function styfiControls() {
  const panel = document.querySelector('#wallet-panel');
  const proposal = document.querySelector('#proposal-panel');
  let opener;
  window.openWallet = wallet => {
    proposal.hidden = true;
    opener = document.activeElement;
    panel.hidden = false;
    if (window.site) window.site.hash = wallet;
    const heading = document.querySelector('#wallet-address');
    const named = document.querySelector(`tr[data-address="${wallet}"] .has-name .address-label`);
    const shortened = `${wallet.slice(0, 7)}…${wallet.slice(-5)}`;
    heading.textContent = named ? `${named.textContent} · ${shortened}` : shortened;
    heading.href = `https://etherscan.io/address/${wallet}`;
    document.querySelector('#wallet-copy').innerHTML = `<button class="copy-trigger" aria-label="Copy address ${wallet}">⧉</button><a class="explorer-link" href="https://etherscan.io/address/${wallet}">↗</a>`;
    panel.focus();
    setPageInert(coversPage.matches);
  };
  const coversPage = matchMedia('(max-width: 700px)');
  const setPageInert = inert => document.querySelectorAll('.topbar,.shell').forEach(element => { element.inert = inert; });
  coversPage.addEventListener('change', () => setPageInert(coversPage.matches && (!panel.hidden || !proposal.hidden)));
  const close = () => {
    if (panel.hidden && proposal.hidden) return;
    panel.hidden = proposal.hidden = true;
    setPageInert(false);
    if (window.site) window.site.hash = '';
    opener?.focus();
  };
  window.openProposal = () => {
    close();
    proposal.hidden = false;
    if (window.site) window.site.hash = 'proposals/dao-1';
    proposal.focus();
    setPageInert(coversPage.matches);
  };
  document.querySelector('#wallet-close').onclick = close;
  document.querySelector('#proposal-close').onclick = close;
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => {
    for (const view of ['stakers', 'proposals']) document.querySelector(`#${view}-view`).hidden = view !== button.dataset.view;
  };
  document.querySelector('#theme-toggle').onclick = () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  };
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
    if (!event.target.isConnected || event.target.closest('#wallet-panel, #proposal-panel, tr[data-address], .search-wrap, #theme-toggle')) return;
    close();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}
