import { hostPermission, normalizeScope, parseAddress } from './shared.js';
import { $, rpc, emptyState, currentSnapshot, syncText, bookPicker, connectForm, watchBook, tooltips } from './ui.js';
import { networks, scopeName } from './networks.js';
import { checksumAddress } from './checksum.js';
import { createEditor, editorStyles } from './editor.js';
import { COPY_ICON, PENCIL_ICON, confirmCopied } from './icons.js';

let state = emptyState;
let sites = {};
let tab;
let siteURL;
let busy = false;
let siteBusy = false;
let health = null;
let recordsByAddress = new Map();
let editor = null;
let chosenScope = 'global';
let customChain = '';
const shadow = $('#editor-host').attachShadow({ mode: 'open' });
const editorReady = editorStyles(shadow);
const bookSearch = new BroadcastChannel('0xtagger-book-search');
const theme = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => $('#editor-host').toggleAttribute('data-dark', theme.matches);
theme.addEventListener('change', applyTheme); applyTheme();
const tell = error => { $('#message').textContent = error?.message || String(error || ''); };
const node = (tag, className, value) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = value;
  return item;
};
const shortAddress = address => `${address.slice(0, 8)}…${address.slice(-6)}`;
const showAddressStart = input => { input.setSelectionRange(0, 0); input.scrollLeft = 0; };

async function edit(address, scope) {
  try {
    await editorReady;
    $('#home').hidden = true;
    $('#editor-host').hidden = false;
    tell('');
    editor = createEditor(shadow, { address, scope, state,
      save: draft => rpc({ type: 'Save', draft }),
      close: () => {
        editor = null;
        shadow.replaceChildren();
        $('#editor-host').hidden = true;
        $('#home').hidden = false;
        renderFinder();
        $('#lookup').focus();
        rpc({ type: 'State' }).then(result => render(result.state)).catch(tell);
      },
    });
    editor.focus();
  } catch (error) {
    $('#editor-host').hidden = true;
    $('#home').hidden = false;
    tell(error);
  }
}

function renderExact(address, output) {
  const found = [...(recordsByAddress.get(address) || [])]
    .sort((a, b) => (a.scope === 'global' ? -1 : b.scope === 'global' ? 1 : scopeName(a.scope).localeCompare(scopeName(b.scope))));
  $('#lookup-status').textContent = found.length ? 'Saved names for this address.' : 'No saved names for this address.';
  if (found.length) {
    const group = node('div', 'lookup-detail');
    // A network name takes precedence over the default there. The rows are
    // separate edits, but one group, and the address already occupies the field.
    for (const record of found) {
      group.append(resultRow(record, {
        others: record.tags.length - 1,
        scope: record.scope === 'global' ? (found.length > 1 ? 'Other networks' : 'All networks') : scopeName(record.scope),
        action: 'Edit tags',
        open: () => edit(address, record.scope),
      }));
    }
    output.append(group);
    return;
  }
  // A pasted address has no reliable chain context, unlike a name read from a
  // website. The global choice is explicit before a new record is written.
  const controls = node('div', 'add-controls');
  const select = node('select');
  select.setAttribute('aria-label', 'Where new tags apply');
  for (const [value, label] of [['global', 'All networks'], ...networks.map(network => [`eip155:${network.chain}`, network.name]), ['custom', 'Other chain…']]) {
    const option = node('option', '', label); option.value = value; select.append(option);
  }
  select.value = chosenScope;
  const chain = node('input', 'add-chain');
  chain.inputMode = 'numeric'; chain.placeholder = 'Chain ID'; chain.setAttribute('aria-label', 'Chain ID');
  chain.value = customChain; chain.hidden = chosenScope !== 'custom';
  select.onchange = () => { chosenScope = select.value; chain.hidden = chosenScope !== 'custom'; if (!chain.hidden) chain.focus(); };
  chain.oninput = () => { customChain = chain.value; };
  const add = node('button', 'primary', 'Add tags');
  add.type = 'button';
  const error = node('p', 'lookup-error');
  add.onclick = () => {
    try {
      const scope = chosenScope === 'custom' ? normalizeScope(`eip155:${chain.value.trim()}`) : chosenScope;
      error.textContent = '';
      edit(address, scope);
    } catch (failure) { error.textContent = failure.message; }
  };
  controls.append(select, add); output.append(controls, chain, error);
}

function copyButton(display, className = 'quiet copy') {
  const copy = node('button', className);
  copy.type = 'button'; copy.innerHTML = COPY_ICON;
  copy.setAttribute('aria-label', `Copy ${display}`);
  return copy;
}

function matchedName(record, query) {
  // The words searched lead the result, even when they are not the first name
  // saved for this address. The primary name stays nearby without a caption.
  return record.tags.find(tag => tag.toLocaleLowerCase().includes(query)) || record.tags[0];
}

function resultRow(record, { name = record.tags[0], others = 0, address = '', note = '', scope = '', action = '', open }) {
  const row = node('div', 'lookup-row');
  const item = node('button', 'lookup-item');
  item.type = 'button';
  const head = node('span', 'lookup-name');
  head.append(node('strong', '', name));
  if (others > 0) head.append(node('span', 'more-count', `+${others}`));
  item.append(head);
  if (address || note || scope) {
    const under = node('small');
    // The address is read character by character; the words beside it are not.
    if (note) under.append(note);
    if (address) {
      if (under.childNodes.length) under.append(' · ');
      under.append(node('span', 'hex', address));
    }
    for (const part of [scope].filter(Boolean)) {
      if (under.childNodes.length) under.append(' · ');
      under.append(part);
    }
    item.append(under);
  }
  if (action) {
    const icon = node('span', 'lookup-action');
    icon.innerHTML = PENCIL_ICON;
    icon.setAttribute('aria-hidden', 'true');
    item.append(icon);
  }
  item.setAttribute('aria-label',
    [name, note, scope, others > 0 ? `and ${others} more` : '', address, action || 'Show address details']
      .filter(Boolean).join(', '));
  item.onclick = open;
  item.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); $('#lookup').focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...$('#lookup-result').querySelectorAll('.lookup-item')];
      items[Math.max(0, Math.min(items.length - 1, items.indexOf(item) + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    }
  };
  row.append(item);
  if (address) {
    const display = checksumAddress(record.address);
    const copy = copyButton(display, 'quiet lookup-copy');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(display); confirmCopied(copy, `Copied ${display}`); }
      catch { tell('Copy was refused. Open the address to copy it.'); }
    };
    row.append(copy);
  }
  return row;
}

function popupRank(record, query) {
  const tags = record.tags.map(tag => tag.toLocaleLowerCase());
  if (tags.includes(query)) return 0;
  if (tags.some(tag => tag.startsWith(query))) return 1;
  if (record.address.startsWith(query)) return 2;
  if (tags.some(tag => tag.includes(query))) return 3;
  if (record.address.includes(query)) return 4;
  return 5;
}

function renderFinder() {
  const input = $('#lookup');
  const output = $('#lookup-result');
  const value = input.value.trim();
  $('#lookup-clear').hidden = !input.value;
  const address = parseAddress(value);
  $('#lookup-copy').hidden = !address;
  output.replaceChildren();
  if (!value) {
    $('#lookup-status').textContent = '';
    // The placeholder has already said what this takes. Only a book with
    // nothing in it needs a word, because it has nothing else to show.
    if (!state.records.length) output.append(node('p', 'lookup-hint', 'No tags yet'));
    return;
  }
  if (address) { renderExact(address, output); return; }
  const query = value.toLocaleLowerCase();
  // This field promises names and addresses. Source and scope metadata stay
  // searchable in the full book, where those columns explain their matches.
  const matches = state.records.filter(record => record.address.includes(query) ||
    record.tags.some(tag => tag.toLocaleLowerCase().includes(query)))
    .sort((a, b) => popupRank(a, query) - popupRank(b, query) ||
      a.tags[0].localeCompare(b.tags[0]) || a.address.localeCompare(b.address));
  // Search answers with addresses. A record on another network is another
  // name for the same destination, not a second destination in this list.
  const byAddress = new Map();
  for (const record of matches) if (!byAddress.has(record.address)) byAddress.set(record.address, record);
  const distinct = [...byAddress.values()];
  if (!distinct.length) {
    $('#lookup-status').textContent = 'No matches.';
    output.append(node('p', 'lookup-hint',
      value.startsWith('0x') ? 'Paste the full address to add it' : 'No matches'));
    return;
  }
  const list = node('div', 'lookup-list');
  $('#lookup-status').textContent = `${distinct.length} ${distinct.length === 1 ? 'address' : 'addresses'} found.`;
  for (const record of distinct.slice(0, 5)) {
    const name = matchedName(record, query);
    const where = record.scope === 'global'
      ? ((recordsByAddress.get(record.address)?.length || 0) > 1 ? 'Other networks' : 'All networks')
      : scopeName(record.scope);
    list.append(resultRow(record, {
      name,
      others: record.tags.length - 1,
      address: shortAddress(checksumAddress(record.address)),
      note: name === record.tags[0] ? '' : record.tags[0],
      scope: where,
      open: () => { input.value = checksumAddress(record.address); renderFinder(); input.focus(); showAddressStart(input); },
    }));
  }
  output.append(list);
  if (distinct.length > 5) {
    // A way to the rest, rather than a sentence about there being more.
    const more = node('button', 'quiet lookup-more', `${distinct.length - 5} more`);
    more.type = 'button';
    more.setAttribute('aria-label', `Open ${distinct.length - 5} more matching addresses in the book`);
    more.onclick = () => openBook(value).catch(tell);
    output.append(more);
  }
}
const setup = connectForm({ container: $('#server'), state: () => state, created: render,
  busy: value => { busy = value; render(); }, error: tell,
  visible: open => { $('#home').hidden = open; tell(''); },
});
const picker = bookPicker({
  connect: () => setup.open(),
  // One field is not worth a dialog: the book is made and its row opens on its
  // own name. A refusal — twenty books already — lands where every other one
  // does, on the page behind the menu.
  create: async () => {
    try { const { book } = await rpc({ type: 'AddBook', name: '', storage: { kind: 'device' } }); tell(''); return book; }
    catch (error) { tell(error); throw error; }
  },
  choose: async book => {
    try { await rpc({ type: 'Use', book }); tell(''); } catch (error) { tell(error); }
  },
  // A refused name is reported in the row being typed in, so the picker keeps it.
  rename: async (book, name) => { await rpc({ type: 'RenameBook', book, name }); tell(''); },
});
function render(next = state) {
  if (!currentSnapshot(next, state)) return;
  if (next.records !== state.records) {
    recordsByAddress = new Map();
    for (const record of next.records) {
      if (!recordsByAddress.has(record.address)) recordsByAddress.set(record.address, []);
      recordsByAddress.get(record.address).push(record);
    }
  }
  state = next;
  picker(state);
  if (editor) editor.updateState(state);
  $('#location').disabled = busy;
  $('#sync').textContent = busy ? 'Connecting…' : syncText(state);
  $('#sync').dataset.tip = state.error || '';
  $('#sync').dataset.offline = String(Boolean(state.error));
  const enabled = Boolean(siteURL && sites[siteURL.origin]);
  // With no website in front of it the row has nothing to say, so it says
  // nothing rather than standing there explaining its own absence.
  $('.site').hidden = !siteURL;
  $('#site-toggle').setAttribute('aria-checked', String(enabled));
  // The switch still answers without a book, because a control that silently
  // ignores a click reads as broken rather than unavailable.
  $('#site-toggle').disabled = siteBusy;
  $('#site-toggle').dataset.tip = enabled ? 'Show the website originals again' : 'Show my tags on this website';
  // Only a website that keeps names of its own has any to bring in, and only
  // once it has been turned on. Everywhere else the row is not there at all.
  const offers = enabled && health?.imports && health.status === 'ready';
  $('#import-site').hidden = !offers;
  $('#import-site').disabled = busy || siteBusy;
  if (offers) $('#import-site').textContent = `Import names from ${health.adapter}`;
  renderFinder();
}
async function openBook(query = '') {
  const page = chrome.runtime.getURL('book.html');
  // The book opens on what was being searched, so "19 more" means these
  // nineteen rather than everything.
  const url = query ? `${page}?q=${encodeURIComponent(query)}` : page;
  // documentUrls matches whole URLs, and this one may carry a query, so the
  // book tab is found by its page rather than by a pattern.
  const open = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  const book = open.find(context => context.documentUrl?.startsWith(page));
  if (book) {
    await chrome.tabs.update(book.tabId, { active: true });
    await chrome.windows.update(book.windowId, { focused: true });
    // Reusing the live page keeps an unfinished edit or import review intact.
    if (query) bookSearch.postMessage({ tabId: book.tabId, query });
  } else await chrome.tabs.create({ url });
}
async function enable(enabled) {
  // Both asked for before anything is awaited: Chrome grants access only while
  // the click that asked for it is still the reason, and the first await ends
  // that. The note goes with the question rather than after the answer, because
  // this popup may not be here when the answer arrives.
  if (enabled && siteURL) rpc({ type: 'Enabling', tabId: tab.id }).catch(() => {});
  const asked = enabled && siteURL ? chrome.permissions.request({ origins: [hostPermission(siteURL.origin)] }) : null;
  siteBusy = true; render();
  try {
    if (!siteURL) throw new Error('Open a website to enable tagging.');
    if (enabled && !await asked) throw new Error('Website access was not granted.');
    sites = (await rpc({ type: 'Site', tabId: tab.id, enabled })).sites;
    $('#adapter-warning').hidden = true; tell('');
  } catch (error) { tell(error); }
  finally { siteBusy = false; render(); }
}
$('#site-toggle').onclick = () => enable(!sites[siteURL?.origin]);
$('#lookup').oninput = event => {
  chosenScope = 'global'; customChain = ''; renderFinder();
  // A pasted full address is a lookup, not a word being composed. Leave its
  // recognizable 0x prefix in view instead of the tail of a scrolled field.
  if (event.inputType === 'insertFromPaste' && parseAddress($('#lookup').value.trim())) showAddressStart($('#lookup'));
};
$('#lookup-copy').innerHTML = COPY_ICON;
$('#lookup-copy').onclick = async () => {
  const address = parseAddress($('#lookup').value.trim());
  if (!address) return;
  const display = checksumAddress(address);
  try { await navigator.clipboard.writeText(display); confirmCopied($('#lookup-copy'), 'Address copied'); }
  catch {
    $('#lookup').value = display;
    $('#lookup').focus(); $('#lookup').select();
    tell('Address selected. Copy it with your keyboard.');
  }
};
$('#lookup').onkeydown = event => {
  if (event.key === 'ArrowDown') {
    const first = $('#lookup-result .lookup-item');
    if (first) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Enter') {
    const action = $('#lookup-result .lookup-item, #lookup-result .add-controls button');
    if (action) { event.preventDefault(); action.click(); }
  }
  if (event.key === 'Escape' && $('#lookup').value) {
    event.preventDefault(); $('#lookup').value = ''; renderFinder();
  }
};
$('#lookup-clear').onclick = () => {
  $('#lookup').value = ''; chosenScope = 'global'; customChain = '';
  renderFinder(); $('#lookup').focus();
};
$('#disable').onclick = () => enable(false);
$('#retry').onclick = async () => {
  try {
    const result = await rpc({ type: 'Retry', tabId: tab.id });
    if (result?.health) $('#adapter-warning').hidden = result.health.status !== 'stale';
    tell('');
  } catch (error) { tell(error); }
};
$('#open-book').onclick = async () => {
  const button = $('#open-book');
  if (button.disabled) return;
  button.disabled = true; tell('');
  try { await openBook(); }
  catch (error) { tell(error); }
  finally { button.disabled = false; }
};
// This import action only asks what the website keeps; the book page is where
// the user reviews those names and decides what to save.
$('#import-site').onclick = async () => {
  const button = $('#import-site');
  if (button.disabled) return;
  button.disabled = true; tell('');
  try {
    const result = await rpc({ type: 'Harvest', tabId: tab.id });
    if (!result.count) tell('This website is keeping no names to bring in.');
    else { await openBook(); window.close(); }
  } catch (error) { tell(error); }
  finally { button.disabled = false; }
};
tooltips();
watchBook(() => state, render);
render();
try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) siteURL = new URL(tab.url);
  $('#site-name').textContent = siteURL?.hostname || '';
  const result = await rpc({ type: 'State', tabId: tab?.id });
  sites = result.sites; health = result.health; render(result.state);
  $('#lookup').focus();
  // The popup is only ever open for a moment, so ask while it is, rather than
  // waiting for a button press to make the time above it true. The ask is
  // conditional and rate limited, so opening the popup repeatedly costs little.
  rpc({ type: 'Sync' }).then(result => render({ ...state, syncedAt: result?.syncedAt ?? state.syncedAt })).catch(() => {});
  if (result.health?.status === 'stale' && sites[siteURL?.origin]) {
    $('#adapter-warning p').textContent = `${result.health.adapter} tagging paused. Your book is safe.`;
    $('#adapter-warning').hidden = false;
  }
} catch (error) { tell(error); }
