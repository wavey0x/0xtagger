import { parseAddress, query, usableName, UI } from './shared.js';
import { etherscanNetwork, safeNetwork, scopeOf } from './networks.js';
import { addressLink, addressText, collect } from './detect.js';

// An adapter describes one website to the detection kernel:
//
//   id       shown in the toolbar and health reports
//   matches  claims a URL; the first match in `adapters` wins
//   probe    whether the page is ready, still loading, or no longer recognized
//   rules    where this site keeps address evidence (see detect.js)
//   nameBefore  optional native address line before which a name can be shown
//   scanRoot  optional enclosing widget whose identity must be rescanned together
//   styles   CSS the site's own elements need while this adapter is active
//   watch    extra attributes whose changes should trigger a rescan
//
// Everything below is data about a site. Add a website by adding an entry;
// no core file needs to know it exists.
const site = ({ rules, watch = [], ...adapter }) => ({
  ...adapter,
  // The controller checks this before it paints, so it travels with the
  // adapter as well as with its rules.
  allowed: rules.allowed,
  watch: [...new Set([...(rules.attributes || []), ...(rules.identifies || []), ...watch])],
  scan: (root, { url }) => collect(root, url, rules),
});

// seen: etherscan.io/ — search `vitalik.eth`; the last result links
//       /address/vitalik.eth and its resolved address is in a sibling span
//       beside the link — 2026-10-16.
const SEARCH_ROW = '.search-panel-container li[role="option"] > a[href]';
// The row saying who first funded an address. Where the explorer has a name for
// them it prints that name alone, in a plain truncating span carrying none of
// the markers its tables use, so the link is the only thing saying which wallet
// the row is about — and it says it whole, in the href.
// seen: etherscan.io/address/0x7a16ff8270133f063aab6c9977183d9e72835428
//       — Funded By names Michael Egorov 2 — 2026-10-16.
const FUNDED_BY = '#conFundedMainChain a[href*="/address/"]';
// The explorer writes the whole of a shortened display into a tooltip, which
// its own script then takes over: the title is in the markup it serves and
// gone from the page it runs. The marker it leaves behind is what both say.
const TIP = '[data-bs-toggle="tooltip"],[title]';
// A contract's reader is a frame of its own as well: an accordion of functions
// in place of rows. A function that answers with an address renders it as the
// same link the tables use, so nothing but the frame needs recognizing.
// seen: etherscan.io/address/0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE#readContract
//       — expand any function returning an address — 2026-10-16.
const CONTRACT_READER = '.js-read-contract-function';

// Holder rows link back to the token with the holder in ?a=. Named holders do
// not carry the data-highlight-target used by the unnamed rows; the same full
// address is on their own copy control beside the link.
// seen: etherscan.io/token/0x863a0d8bfc940969087bec4e4f1824f312a21565
//       — Holders, rows 8–16 — 2026-10-19.
const HOLDER_LINK = '#theadHolderTable + tbody td:nth-child(2) a[href*="/token/"][href*="?a="]';
const holderAddress = (element, url) => {
  if (!element.matches(HOLDER_LINK)) return null;
  let link;
  try { link = new URL(element.getAttribute('href'), url); }
  catch { return null; }
  const token = parseAddress(link.pathname.match(/^\/token\/(0x[0-9a-f]{40})$/i)?.[1]);
  const holdersToken = parseAddress(url.searchParams.get('a'));
  const holders = link.searchParams.getAll('a');
  const holder = holders.length === 1 && parseAddress(holders[0]);
  const copied = parseAddress(element.closest('td')?.querySelector('.js-clipboard[data-clipboard-text]')?.getAttribute('data-clipboard-text'));
  return link.origin === url.origin && token && token === holdersToken && holder === copied ? holder : null;
};

// A name cut short to fit is not a name: whatever stands in the field is what
// Save would store. The whole of it is written in a tooltip, and the explorer's
// own script takes that tooltip over and the title out of the markup before
// anyone can click a row, so half a name cannot be used on its own.
const whole = element => (/[.…]$/.test(element.textContent.trim()) ? null : element.textContent);
// A token is named in its own row rather than by a public name tag: the row
// leads with the token's name and sets its symbol beside it in muted text,
// each under a tooltip of its own. A token the explorer has no name for leads
// with its symbol, which is short enough to be shown whole.
const tokenName = element => {
  // Read from the row rather than from whatever part of it was annotated: the
  // name may be painted on the text beside the token's own logo.
  const row = element.closest('a[href*="/token/"]');
  const named = row ? query(row, TIP).find(node => node !== row && node.textContent.trim()) : null;
  return named ? whole(named) : null;
};
// A block's fee recipient is named by the link itself, with no name tag in it
// and the address kept in the tooltip rather than shown. Once the tooltip is
// the site's own, the name is all that is left in the row — and a row with any
// of an address in it is showing the address, not a name.
const linkName = element => addressLink(element, element.baseURI) &&
  !/0x[0-9a-f]/i.test(element.textContent) ? whole(element) : null;

// Receipt logs keep the emitter's public name beside its address, even while
// the Logs tab is closed. Unlike token-row titles, this caption and its
// data-bs-title survive tooltip initialization. All four address sources must
// agree before the caption can name another display of that same address.
// seen: https://etherscan.io/tx/0xb9b2278b14348b37d9a7537d362bd56270a24688a137d0c8fdc6b0a34c53b3f7
//       — open sfrxUSD's tag in ERC-20 Tokens Transferred; its full public name
//       is already in the unselected Logs tab — 2026-10-27.
const LOG_EMITTER = '#eventlog-tab-content [id^="logI_"] > div > dl:first-child > dd > a[data-highlight-target]';
const eventLogName = (element, { address, url }) => {
  const names = new Set();
  for (const link of query(element.ownerDocument, LOG_EMITTER)) {
    let href;
    try { href = new URL(link.getAttribute('href'), url); }
    catch { continue; }
    if (href.origin !== url.origin || addressLink(link, url)?.address !== address ||
        parseAddress(link.textContent.trim()) !== address ||
        parseAddress(link.getAttribute('data-highlight-target')) !== address) continue;
    const labels = link.parentElement.querySelectorAll(':scope > span[data-bs-toggle="tooltip"][data-bs-title]');
    if (labels.length !== 1) continue;
    const label = labels[0];
    const detail = label.getAttribute('data-bs-title').match(/^(.+?)\s*\((0x[0-9a-f]{40})\)\s*$/is);
    const name = usableName(detail?.[1]);
    if (!name || /[.…]$/.test(name) || parseAddress(detail?.[2]) !== address ||
        label.textContent.trim().replace(/\s+/g, ' ') !== `(${name})`) continue;
    names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
};

const etherscanAdapter = site({
  id: 'Etherscan',
  source: 'etherscan:page',
  // What the explorer calls this address: its public name tag, which is the
  // same element a tag is allowed to stand in for. Several displays carry
  // no name tag and name the thing themselves — a token row, a holder row,
  // and a link whose text is the name with the address kept out of sight.
  names: (element, context) => {
    const tagged = element.matches('.hash-tag') ? element : element.querySelector('.hash-tag');
    let name;
    if (tagged) name = whole(tagged);
    else if (element.matches(HOLDER_LINK)) name = /0x[0-9a-f]/i.test(element.textContent) ? null : whole(element);
    else name = tokenName(element) || linkName(element);
    return usableName(name) || eventLogName(element, context);
  },
  // The exact-host group excludes explorers with different frontends.
  // seen: gnosisscan.io/address/0x000000000000000000000000000000000000dEaD
  //       — open address page; it is now Blockscout — 2026-10-22.
  // seen: blastscan.io/address/0x000000000000000000000000000000000000dEaD
  //       — open address page; it keeps the Etherscan layout — 2026-10-22.
  matches: url => Boolean(etherscanNetwork(url.hostname)),
  watch: ['data-highlight-value'],
  // The heading of an address page is what the page is about, and so is each
  // address a view function answers with. A name alone would take away the one
  // thing identifying everything below it, or the value that was asked for.
  subject: `#mainaddress,${CONTRACT_READER} a[href*="/address/"]`,
  // Address badges lose their decoration only while a custom tag is visible.
  // seen: etherscan.io/txs?a=0x16388463d60FFE0661Cf7F1f31a7D658aC790ff7,
  // 2026-10-18 — sign in with a private name tag for 0x1b5f15…D271 and open
  // its From row. Etherscan caps [data-truncate=address] at 21ch; our hidden
  // native text has zero font size, so that cap becomes zero and clips the tag.
  // 171px is that cap at Etherscan's normal 14px link size.
  // The Owners menu puts each inline-flex address link in a plain list item.
  // Our edit control follows that link; the item has to carry both on one row.
  // seen: etherscan.io/address/0xc420C9d507D0E038BD76383AaADCAd576ed0073c
  //       — open Owners — 2026-10-20.
  styles: `.badge:is([data-0xtagger-tag], :has([data-0xtagger-tag])) {
      background: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding: 0 !important;
    }
    [data-truncate="address"][data-0xtagger-tag] {
      max-width: 171px;
    }
    #owner_container > li:has(> [data-0xtagger-edit]) {
      display: flex;
      align-items: center;
    }
    #owner_container > li:has(> [data-0xtagger-edit]) > .dropdown-item {
      flex: 1 1 auto;
      min-width: 0;
      width: auto;
    }`,
  probe({ document, url, embedded }) {
    const network = etherscanNetwork(url.hostname);
    if (document.querySelector('#challenge-running,#challenge-stage,[name="cf-turnstile-response"]') || /^(Just a moment|Attention Required)/i.test(document.title)) return { status: 'waiting' };
    if (document.readyState === 'loading') return { status: 'waiting' };
    const landmarks = document.querySelector('main') && document.querySelector('header,nav');
    // An explorer embeds its tables and its contract reader as documents of
    // their own: a frame holding rows or functions, and none of the outer
    // page's landmarks. Which URL those frames load from is the explorer's
    // business and changes with its pages; what they hold does not, and what
    // they hold carries the same identities the page does.
    if (embedded && !landmarks) {
      return document.querySelector(`.table-responsive table tbody,${CONTRACT_READER}`)
        ? { status: 'ready', network: scopeOf(network) }
        : { status: 'stale', reason: 'embedded-view-unrecognized' };
    }
    if (!landmarks) return { status: 'stale', reason: 'explorer-landmarks-missing' };
    if (/^\/address\//.test(url.pathname) && !document.querySelector('#mainaddress')) return { status: 'stale', reason: 'main-address-missing' };
    return { status: 'ready', network: scopeOf(network) };
  },
  rules: {
    // Includes homepage fee-recipient links, which have no .hash-tag child.
    targets: `#mainaddress,[data-highlight-target],a[href*="/address/"],a[href*="/address/"] .hash-tag,[data-full-address],${HOLDER_LINK}`,
    attributes: ['data-full-address', 'data-highlight-target', 'data-address', 'title', 'aria-label'],
    identifies: ['data-full-address'],
    anchors: '#mainaddress,[data-highlight-target]',
    named: `.hash-tag,[data-highlight-value],${SEARCH_ROW},${FUNDED_BY},${HOLDER_LINK}`,
    denied: 'nav',
    // An owners or holders menu is content, not navigation: its rows name real
    // wallets, under whatever the explorer already calls them.
    keeps: '.dropdown-item',
    // The innermost verified address widget owns the annotation.
    skip: element => !element.matches('#mainaddress,[data-highlight-target]') &&
      element.querySelector('[data-highlight-target],.hash-tag'),
    // ENS search rows resolve the domain beside its link; token holder rows
    // put the wallet in the link query and its native copy control.
    sources: (element, url) => element.matches(SEARCH_ROW)
      ? query(element.parentElement, 'span').map(node => parseAddress(node.textContent.trim()))
      : [holderAddress(element, url)],
  },
});

const SAFE_SELECTOR_NAME = '[data-testid="safe-selector-trigger-name"]';
const SAFE_SELECTOR_ADDRESS = '[data-testid="safe-selector-trigger-address"]';
const SAFE_SELECTOR_DETAILS = '[data-testid="safe-selector-trigger-details"]';
const SAFE_SELECTOR = `${SAFE_SELECTOR_NAME},${SAFE_SELECTOR_ADDRESS}`;
const SAFE_WIDGET = '[class*="addressContainer"],[class*="EthHashInfo_container"],[class*="SrcEthHashInfo_container"]';
// Safe's address widget sets the name in a box of its own, under a plain class
// rather than a hashed one, and sometimes puts a badge beside it saying which
// of Safe's books the name came from. The name's own box is the first child:
// wrapping it in a link is Safe's business, and a link inside a display would
// disqualify the display, so the box is what we match rather than its parent.
const SAFE_NAME = '.ethHashInfo-name';
const SAFE_NAME_BOX = `${SAFE_NAME} > :first-child`;
// The address lives beside the name in the same widget, and an explorer link
// beside it is what proves which wallet the pair is about.
const SAFE_ADDRESS_LINK = 'a[href*="/address/"]';
// In the audit log the line naming a signer is itself a copy control. Its
// abbreviated text proves no identity; only a control label with the whole
// address can make that interactive display safe to annotate.
// seen: app.safe.global/transactions/history?safe=matic:0xa1F0FC535Ad0EBcae0ef81b2990fcD75465AD7Ae
//       — open the first burn transaction's audit log — 2026-10-16. Its copy
//       buttons now lack a full-address aria-label, so this rule leaves them
//       untagged. Only a control that does expose the whole address qualifies.
const SAFE_COPIES = '[role="button"][aria-label*="0x"]';
// Exactly forty characters and no more: a transaction hash starts the same way
// and runs longer, and its first forty would name a wallet nobody mentioned.
const WHOLE_ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const safePair = element => element.closest(`${SAFE_NAME},[class*="addressContainer"]`)?.parentElement || null;

// Safe puts a named wallet above its address, but an unnamed wallet has only
// the address line. Give the latter a place for our name without replacing the
// address or the controls Safe keeps beside it.
// seen: app.safe.global/settings/setup?safe=eth:0xFE11a5009f2121622271e7dd0FD470264e076af6
//       — Members > Signers, compare a named signer with an unnamed one — 2026-10-18.
const safeNameBefore = element => {
  const addressLine = element.closest('[class*="addressContainer"]');
  const pair = addressLine && safePair(element);
  return pair && !pair.querySelector(SAFE_NAME) && pair.contains(addressLine) ? addressLine : null;
};

const safeAdapter = site({
  id: 'Safe',
  matches: url => url.hostname === 'app.safe.global',
  source: 'safe:page',
  nameBefore: safeNameBefore,
  // The selected account's name depends on its sibling address, even when
  // Safe updates that address without rebuilding or renaming the account.
  scanRoot: root => root.closest?.(SAFE_SELECTOR_DETAILS) || root,
  // What Safe calls this address, read from the box it sets names in — never
  // from our own replacement, which lives in a stylesheet and leaves the title
  // alone. Safe's two placeholders name no wallet: one is the page talking
  // about itself, the other is the absence of a name.
  names: element => {
    const name = safePair(element)?.querySelector(SAFE_NAME)?.getAttribute('title');
    return ['This Safe account', 'Unverified contract'].includes(name) ? null : name;
  },
  // Safe keeps its own address book in site storage, one name per chain. It is
  // the one thing about this page our reading of it cannot show: Workspace
  // names and ENS arrive rendered, the local book never does. Read only when
  // someone asks for it to be imported, and never on a scan.
  harvest(win) {
    let held;
    try { held = JSON.parse(win.localStorage.getItem('SAFE_v2__addressBook') || '{}'); }
    catch { return []; }
    if (!held || typeof held !== 'object') return [];
    const found = [];
    for (const [chain, names] of Object.entries(held)) {
      if (!/^[1-9][0-9]{0,19}$/.test(chain) || !names || typeof names !== 'object') continue;
      for (const [at, name] of Object.entries(names)) {
        const address = parseAddress(at);
        const tag = usableName(name);
        if (address && tag) found.push({ address, scope: `eip155:${chain}`, tags: [tag], source: 'safe:address-book' });
      }
    }
    return found;
  },
  probe({ document, url }) {
    if (document.readyState === 'loading' || document.querySelector('[role="progressbar"]')) return { status: 'waiting' };
    if (!document.querySelector('main') && !(document.querySelector('header') && document.querySelector('[data-testid="sidebar-container"]'))) return { status: 'stale', reason: 'safe-landmarks-missing' };
    const network = safeNetwork(url.searchParams.get('safe')?.split(':')[0]);
    return { status: 'ready', ...(network ? { network: scopeOf(network) } : {}) };
  },
  // The badge beside Safe's name says which of its books that name came from.
  // While a tag stands in its place the claim is false, so it goes — and only
  // it. Safe gives that slot to one icon or to a notice of its own, never to
  // both, so a notice there is never a claim about our wording and must be
  // left alone; anything carrying words of its own stays. Nothing of ours is
  // touched either, or the one row a name was replaced on would be the one row
  // nobody could edit.
  styles: `${SAFE_NAME} > [data-0xtagger-tag] ~ :has(> svg):not(${UI}):not(:has(:is(p, div, b, strong, label))) {
      display: none !important;
    }`,
  rules: {
    targets: `a[href*="/address/"],[data-address],[title],[class*="addressContainer"] span,main span,${SAFE_NAME_BOX},${SAFE_SELECTOR},${SAFE_COPIES} [class*="actorText"]`,
    attributes: ['data-address', 'title', 'aria-label'],
    identifies: ['data-address'],
    // A name may stand in for the address in Safe's name boxes, including the
    // selected account, or on the audit line that is about one signer alone.
    named: `${SAFE_NAME_BOX},${SAFE_SELECTOR_NAME},${SAFE_COPIES} [class*="actorText"]`,
    allowed: SAFE_COPIES,
    skip: element => {
      if (element.matches(`${SAFE_NAME_BOX},${SAFE_SELECTOR_NAME}`)) return false;
      // The selected account has two rows: a name (or abbreviation) above its
      // full address. Only the name owns the tag, including when Safe splits
      // the address into spans or supplies a second display for small screens.
      // seen: app.safe.global/transactions/queue?safe=oeth:0x6d447e544D01a59cb0774763bf15526574CffFeD
      //       — open the queue and inspect the selected account — 2026-10-26.
      if (element.closest(SAFE_SELECTOR_DETAILS)?.querySelector(SAFE_SELECTOR_NAME)) return true;
      // Safe bolds the first and last four digits of a scalar address. The
      // inner span still says one whole wallet; its outer copy span does not.
      // seen: app.safe.global/transactions/tx?safe=hyper-evm:0x518C21DC88D9780c0A1Be566433c571461A70149
      //       &id=multisig_0x518C21DC88D9780c0A1Be566433c571461A70149_0xb9b970ebc8b90fe4ae8e4f6002fa29955200f337cfa70b7cefe94c08a057cccf
      //       — expand the first swapOwner action — 2026-10-21.
      const highlightedAddress = element.matches('span') && element.closest('[class*="addressContainer"]') &&
        element.children.length && [...element.children].every(child => child.localName === 'b') &&
        parseAddress(element.textContent.trim());
      if (element.children.length && !element.matches(`${SAFE_ADDRESS_LINK},${SAFE_SELECTOR}`) && !highlightedAddress) return true;
      // One name to a widget. Where Safe shows a name above the address and the
      // widget proves which wallet it is, the name is the display a tag
      // replaces, and the address below is left to go on being an address.
      const pair = element.closest('[class*="addressContainer"]') && safePair(element);
      const fullAddress = pair && query(pair, '[class*="addressContainer"] span')
        .some(node => parseAddress(node.textContent.trim()));
      return Boolean(pair?.querySelector(SAFE_NAME) && (pair.querySelector(SAFE_ADDRESS_LINK) || fullAddress));
    },
    // Explorer links in a compact EthHashInfo widget can identify its display,
    // and the selected Safe is named by the URL and the header's explorer link.
    sources: (element, url) => {
      const widget = element.matches(SAFE_NAME_BOX) ? safePair(element) : element.closest(SAFE_WIDGET);
      const found = widget ? query(widget, SAFE_ADDRESS_LINK).map(link => addressLink(link, url)?.address) : [];
      if (element.matches(SAFE_NAME_BOX) && widget) {
        found.push(...query(widget, '[class*="addressContainer"] span').map(node => parseAddress(node.textContent.trim())));
      }
      // A control that names itself by the address it copies says it whole.
      const copies = element.closest(SAFE_COPIES)?.getAttribute('aria-label')?.match(WHOLE_ADDRESS);
      if (copies) found.push(parseAddress(copies[0]));
      if (!element.matches(SAFE_SELECTOR)) return found;
      found.push(parseAddress(url.searchParams.get('safe')?.split(':')[1]));
      const details = element.closest(SAFE_SELECTOR_DETAILS);
      found.push(parseAddress(details?.querySelector(SAFE_SELECTOR_ADDRESS)?.textContent.trim()));
      const header = element.closest('header');
      if (header) found.push(...query(header, '[data-testid="safe-item-explorer-link"]').map(link => addressLink(link, url)?.address));
      return found;
    },
  },
});

// The ranking renders two abbreviated labels for each address, one for narrow
// screens. Neither label proves identity; the Ethereum explorer link and its
// full-address title do, and must agree. Keep the copy button and membership
// badges beside the link in the site's own hands.
// seen: styfi.wavey.info/ — load the ranking, then search or sort Address;
//       narrow the viewport to see the compact label — 2026-10-18.
const STYFI_ADDRESS = '#ranking-body > tr > td.account .address-line > a.address-link';

const styfiAdapter = site({
  id: 'stYFI',
  matches: url => url.hostname === 'styfi.wavey.info',
  probe({ document }) {
    if (document.readyState === 'loading') return { status: 'waiting' };
    if (!document.querySelector('main .ranking #ranking-body') ||
        !document.querySelector('thead [data-sort="address"]')) {
      return { status: 'stale', reason: 'styfi-ranking-missing' };
    }
    return { status: 'ready', network: 'eip155:1' };
  },
  rules: {
    targets: STYFI_ADDRESS,
    attributes: ['title'],
    anchors: STYFI_ADDRESS,
    skip: element => {
      const link = addressLink(element, element.baseURI);
      const title = parseAddress(element.getAttribute('title'));
      return link?.network !== 'eip155:1' || !title || link.address !== title;
    },
  },
});

const genericAdapter = site({
  id: 'This site',
  matches: () => true,
  probe: () => ({ status: 'ready' }),
  rules: {
    // Whole, leaf display values only: never guess from an abbreviation, and
    // never trust a site attribute we have no adapter to vouch for. Which tag
    // shows the address is not our business; that it shows nothing else is.
    candidates: addressText,
    skip: element => element.matches('html,body,head') ||
      [...element.children].some(child => !child.matches(UI)),
  },
});

export const adapters = [etherscanAdapter, safeAdapter, styfiAdapter, genericAdapter];
