import { findRecord, MAX_TAG_LENGTH, normalizeTags, sameTags, sourceName, usableName } from './shared.js';
import { checksumAddress } from './checksum.js';
import { chainLogos } from './vendor/chain-logos.js';
import { quickNetworks, scopeName, scopeSymbol } from './networks.js';
import { EDITOR_MARK, COPY_ICON, COPIED_ICON, EYE_ICON, EYE_OFF_ICON, GLOBE_ICON, CHEVRON_ICON, CLOSE_ICON, UNDO_ICON, GRIP_ICON, PLUS_ICON, confirmCopied } from './icons.js';

const element = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export async function editorStyles(root) {
  const sheet = new CSSStyleSheet();
  const styles = await Promise.all(['colors.css', 'editor.css'].map(async file =>
    (await fetch(new URL(file, import.meta.url))).text()));
  sheet.replaceSync(styles.join('\n'));
  root.adoptedStyleSheets = [sheet];
}

// The confirmation's opposite number, in the same vocabulary: a nudge and a
// ring in the colour the notice is written in, with no overshoot and nothing
// to celebrate. A line of small print in the corner of a panel is easy to miss
// after ten seconds of waiting; the button that was pressed is not.
const RING = '0 0 0 3px var(--0xtagger-warning-pulse)';
const REFUSED = [
  { transform: 'translateX(0)', boxShadow: '0 0 0 0 transparent' },
  { transform: 'translateX(-3px)', boxShadow: RING, offset: .22 },
  { transform: 'translateX(3px)', offset: .52 },
  { transform: 'translateX(-1px)', offset: .78 },
  { transform: 'translateX(0)', boxShadow: '0 0 0 0 transparent' },
];
// Where movement is unwelcome the ring alone says it, and says it where the
// eye already is.
const REFUSED_STILL = [
  { boxShadow: '0 0 0 0 transparent' }, { boxShadow: RING, offset: .3 }, { boxShadow: '0 0 0 0 transparent' },
];

// Shared by the page popover and book. The draft never follows a recycled row.
//
// Every tag is a line of its own with the network it is for. The book keeps one
// list per network, so a line's network says which list its tag is in, and
// saving a line rewrites that list (and the one it left, when it moved).
export function createEditor(container, { address, scope: opened = 'global', state, save, close, onLayout = () => {}, visibility, toggleVisibility, suggestion = null, modal = false }) {
  const book = state.activeBook;
  // Which book a save goes to only matters once there is more than one.
  const bookName = state.books.length > 1 ? state.bookName : '';
  const displayAddress = checksumAddress(address);
  const own = findRecord(state.records, address, opened);
  // The network the editor was opened for comes first: it is what this page
  // shows. All networks follows, then the quick networks in their usual order.
  const rank = scope => {
    if (scope === opened) return -2;
    if (scope === 'global') return -1;
    const quick = quickNetworks.findIndex(network => `eip155:${network.chain}` === scope);
    return quick >= 0 ? quick : quickNetworks.length;
  };
  // What each network's list said when the editor last read it, and the
  // version a save to it must match.
  const seen = new Map();
  const known = scope => seen.get(scope) || { tags: [], version: null };
  const line = (tag, scope) => ({ tag, scope, saved: { tag, scope }, removed: false, moved: false });
  let lines = [];
  const read = from => {
    seen.clear();
    const held = from.records.filter(item => item.address === address).sort((a, b) => rank(a.scope) - rank(b.scope));
    for (const record of held) seen.set(record.scope, { tags: record.tags, version: record.version || null });
    lines = held.flatMap(record => record.tags.map(tag => line(tag, record.scope)));
  };
  read(state);
  // What the website calls this address. Where nothing is saved it is a
  // starting value, so saving is the only thing left to do. Where something is
  // saved the address is settled, and the site's name is only ever offered.
  const offered = suggestion?.name && usableName(suggestion.name) ? suggestion : null;
  const prefill = offered && !lines.length ? offered : null;
  // The last line is always there for a new tag, and saves like any other.
  const blank = (tag = '') => ({ tag, scope: opened, saved: null, removed: false, moved: false });
  let fresh = blank(prefill ? prefill.name : '');
  // The new line shows only when it is needed: for an address with no tags,
  // or once "+" is pressed. Otherwise the list is just the tags.
  let adding = false;
  const all = () => (!lines.length || adding || fresh.tag.trim() ? [...lines, fresh] : [...lines]);
  // Compared as a save would store it, so a stray space is not an edit.
  const pending = item => !item.saved ? Boolean(item.tag.trim())
    : item.removed || item.moved || item.tag.trim() !== item.saved.tag || item.scope !== item.saved.scope;
  // A name this editor put in the field itself is not something anyone typed.
  // Treating it as an unsaved draft would make opening one address and then
  // another ask to save work nobody did.
  const untouched = () => Boolean(prefill) && !lines.length && fresh.tag.trim() === prefill.name;
  const edited = () => !untouched() && all().some(pending);
  let phase = 'idle';
  let closed = false;
  let activeState = state;
  let pageNotice = '';

  const panel = element(modal ? 'dialog' : 'section', undefined, { class: 'editor', role: 'dialog', 'aria-label': 'Edit wallet tags' });
  panel.innerHTML = `<header><span class="brand" role="img" aria-label="0xtagger">${EDITOR_MARK}<svg class="sheen" aria-hidden="true"><linearGradient id="brand-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></svg></span><code></code><button type="button" class="quiet copy" aria-label="Copy">${COPY_ICON}</button><span class="source"></span>${visibility ? '<div class="visibility-group"><button type="button" class="quiet visibility" role="switch" aria-label="Show my tags for this address" aria-checked="true"></button></div>' : `<button type="button" class="quiet close" aria-label="Close editor" title="Close">${CLOSE_ICON}</button>`}</header>
    <div class="lines"></div><div class="foot"><button type="button" class="quiet add" aria-label="Add tag" title="Add tag">${PLUS_ICON}</button><button type="button" class="quiet discard" title="Leave without saving (Esc)" hidden>Cancel</button></div><div class="networks" role="listbox" aria-label="Save for" popover="manual"></div>
    <p class="offer" hidden></p><p class="notice" role="status"></p><div class="conflict" hidden></div>
    <div class="extras">${modal && own ? '<button type="button" class="quiet clear">Remove tags</button>' : ''}</div>`;
  container.replaceChildren(panel);
  if (modal) panel.showModal();
  const get = selector => panel.querySelector(selector);
  // The whole address is in the text, so selecting or reading it gives all of
  // it; only its middle is folded away on screen.
  get('code').append(element('span', displayAddress.slice(0, 6)), element('span', displayAddress.slice(6, -4), { class: 'fold' }), element('span', displayAddress.slice(-4)));
  get('code').title = displayAddress;
  const origin = modal && own?.source ? `Source: ${sourceName(own.source)}` : '';
  get('.source').textContent = [bookName, origin].filter(Boolean).join(' · ');
  get('.source').title = [bookName ? `Saving to ${bookName}` : 'Saving to your address book', origin].filter(Boolean).join(' · ');
  get('.source').setAttribute('aria-label', get('.source').title);
  get('.copy').title = `Copy ${displayAddress}`;
  const menu = get('.networks');
  let menuFor = null;
  function outside(event) {
    const path = event.composedPath();
    const box = modal && panel.getBoundingClientRect();
    if (menuFor && !path.includes(menu) && !path.includes(menuFor.button)) closeMenu();
    const inside = path.includes(menu) || path.includes(panel) && (!modal || event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom);
    if (event.button === 0 && !inside && !path.some(node => node.matches?.('[data-0xtagger-edit]'))) leave(event.isTrusted);
  }
  // Clicking away keeps what was typed: anything waiting is saved, and the
  // editor closes once it is. A failed save leaves it open with the draft.
  // Escape is the way to leave without saving. A website script cannot save
  // by faking a click, so one leaves an edited draft where it is.
  async function leave(trusted) {
    if (phase !== 'idle' || !edited()) { finish(); return true; }
    if (!trusted) return false;
    await commit(all().filter(pending));
    return closed;
  }
  // Dismiss before the browser focuses the clicked website control. The
  // composed path distinguishes panel content across its shadow boundary.
  panel.ownerDocument.addEventListener('pointerdown', outside, true);
  function finish() {
    if (!closed) {
      closed = true;
      panel.ownerDocument.removeEventListener('pointerdown', outside, true);
      closeMenu();
      if (modal) panel.close();
      close();
    }
  }
  function focus() {
    (panel.querySelector('.row input:not(:disabled)') || get('.copy')).focus({ preventScroll: true });
  }
  function updateVisibility() {
    if (!visibility || closed) return;
    const view = visibility();
    const button = get('.visibility');
    get('.visibility-group').hidden = !view.available;
    button.disabled = !view.enabled;
    button.setAttribute('aria-checked', String(!view.hidden));
    button.innerHTML = view.hidden ? EYE_OFF_ICON : EYE_ICON;
    button.title = `${view.hidden ? 'Show my tags' : 'Show website original'} for this address on this page. Resets on refresh.`;
  }
  if (visibility) get('.visibility').onclick = () => { if (!closed) { toggleVisibility(); updateVisibility(); } };
  else get('.close').onclick = finish;
  if (modal) panel.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  if (get('.clear')) get('.clear').onclick = () => { lines.forEach(item => { item.removed = true; }); fresh = blank(); adding = false; renderLines(null); get('.remove')?.focus(); };
  get('.copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(displayAddress);
      confirmCopied(get('.copy'));
    }
    catch { get('code').classList.add('whole'); get('.notice').textContent = 'Select the full address above to copy it.'; queueMicrotask(onLayout); }
  };

  // The network menu, shared by every line. It lives in the top layer, so
  // neither the panel's own scrolling nor a website's clipping can cut it off.
  // A network's own logo where there is one; a plain disc for any other chain.
  const networkMark = choice => (choice === 'global' ? GLOBE_ICON : chainLogos[choice.slice(7)] || '<i class="dot"></i>');
  function placeMenu(button) {
    const at = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = innerHeight - at.bottom - 8;
    menu.style.left = `${Math.max(8, Math.min(at.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${below >= height || at.top < height ? at.bottom + 4 : at.top - height - 4}px`;
  }
  function openMenu(item, button) {
    closeMenu();
    const choices = ['global', ...quickNetworks.map(network => `eip155:${network.chain}`)];
    if (!choices.includes(item.scope)) choices.push(item.scope);
    menu.replaceChildren(...choices.map(choice => {
      const option = element('button', undefined, { type: 'button', role: 'option', 'aria-selected': String(choice === item.scope), 'data-scope': choice, tabindex: '-1' });
      option.innerHTML = networkMark(choice);
      option.append(element('span', scopeName(choice), { class: 'name' }));
      // A network with its own tags for this address is marked, which is the
      // only way to see an override without opening the book.
      const named = choice !== 'global' && known(choice).tags.join(', ');
      if (named) { option.append(element('i', undefined, { class: 'own' })); option.title = named; }
      option.append(element('span', scopeSymbol(choice), { class: 'symbol' }));
      option.onclick = () => { closeMenu(); item.scope = choice; renderLines(null); (rowOf(item)?.querySelector('input:not(:disabled)') || rowOf(item)?.querySelector('.network'))?.focus(); };
      return option;
    }));
    menuFor = { item, button };
    menu.showPopover();
    button.setAttribute('aria-expanded', 'true');
    placeMenu(button);
    menu.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
    addEventListener('scroll', closeMenu, { capture: true, passive: true });
    addEventListener('resize', closeMenu, { passive: true });
  }
  function closeMenu() {
    if (!menuFor) return;
    menuFor.button.setAttribute('aria-expanded', 'false');
    menuFor = null;
    menu.hidePopover();
    removeEventListener('scroll', closeMenu, { capture: true });
    removeEventListener('resize', closeMenu);
  }
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="option"]')];
    const at = options.indexOf(menu.getRootNode().activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) { event.preventDefault(); options[(at + step + options.length) % options.length].focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); options.at(event.key === 'Home' ? 0 : -1).focus(); }
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      const button = menuFor?.button;
      closeMenu(); button?.focus();
    }
  });

  // A name the editor filled in reads as any other tag would, because it is
  // one keystroke from being exactly that — setting it in the muted ink of a
  // placeholder would say the field was empty while it holds the thing a save
  // would store. What it needs instead is to say whose words these are, and
  // that belongs beside them rather than on a line of its own: an aside about
  // the value, not the app accounting for itself.
  //
  // It describes the words in the field and nothing else, so it goes the
  // moment they stop being the website's. A record already saved never shows
  // it: those words are yours whatever they were read from.
  //
  // The offer below is for an address already named: the site's other name is
  // shown, never substituted, and taking it puts it on the new line.
  function attribution() {
    const live = Boolean(prefill) && fresh.tag === prefill.name;
    const row = rowOf(fresh);
    const field = row?.querySelector('input');
    const shown = row?.querySelector('.from');
    if (!live) { shown?.remove(); field?.removeAttribute('aria-describedby'); }
    else if (row && !shown) {
      const note = element('small', `(from ${sourceName(prefill.source)})`, { class: 'from', id: 'from-site' });
      field.after(note);
      field.setAttribute('aria-describedby', 'from-site');
    }
    const spare = offered && !prefill && !all().some(item => item.tag.trim() === offered.name);
    get('.offer').hidden = !spare;
    get('.offer').replaceChildren();
    if (spare) {
      const button = element('button', 'Add tag', { type: 'button', class: 'quiet' });
      button.onclick = () => { fresh.tag = offered.name; adding = true; renderLines(null); rowOf(fresh)?.querySelector('input').focus(); };
      get('.offer').append(element('span', offered.name), button);
    }
  }
  function guard() {
    const switched = activeState.activeBook !== book;
    updateControls();
    get('.notice').textContent = phase === 'saved' ? '' : switched ? `You switched to ${activeState.bookName}. Close this editor and try again.` : pageNotice;
    queueMicrotask(onLayout);
  }
  const rowOf = item => [...panel.querySelectorAll('.row')][all().indexOf(item)];
  // One line's state, said on the line: tinted while it has something to save,
  // plain once it is saved. Enter saves; there is no button to find.
  function showLine(item, row = rowOf(item)) {
    if (!row) return;
    const waiting = pending(item);
    row.classList.toggle('dirty', waiting);
    row.classList.toggle('removed', item.removed);
    row.querySelector('.network-mark').innerHTML = networkMark(item.scope);
    row.querySelector('.symbol').textContent = scopeSymbol(item.scope);
    row.querySelector('.save-scope').textContent = scopeName(item.scope);
    row.querySelector('.network').title = `Network: ${scopeName(item.scope)}`;
    const remove = row.querySelector('.remove');
    if (remove) {
      const index = all().indexOf(item) + 1;
      remove.innerHTML = item.removed ? UNDO_ICON : CLOSE_ICON;
      remove.setAttribute('aria-label', `${item.removed ? 'Keep' : 'Remove'} tag ${index}`);
      remove.title = item.removed ? 'Keep this tag' : 'Remove tag';
    }
  }
  function updateControls() {
    updateVisibility();
    const busy = phase !== 'idle';
    panel.querySelectorAll('.row').forEach((row, index) => {
      const item = all()[index];
      row.querySelector('input').disabled = busy || Boolean(item?.removed);
      row.querySelector('.network').disabled = busy;
      const remove = row.querySelector('.remove');
      if (remove) remove.disabled = busy;
    });
    get('.extras').hidden = !get('.clear');
    // "+" waits until there is a tag to add another to.
    get('.add').hidden = all().includes(fresh) && !fresh.tag.trim();
    get('.add').disabled = busy;
    // Leaving without saving, said where it can be seen while there is
    // something to lose. Escape does the same.
    get('.discard').hidden = !edited();
    get('.discard').disabled = busy;
    if (get('.clear')) get('.clear').disabled = busy || !lines.some(item => !item.removed);
  }
  // A new order for the lines. Tags whose order changed within their network
  // are waiting to be saved, since that order is what a page reads.
  function reorder(order, focusAt) {
    for (const scope of new Set(lines.map(item => item.saved?.scope).filter(Boolean))) {
      const before = lines.filter(item => item.saved?.scope === scope);
      order.filter(item => item.saved?.scope === scope).forEach((item, at) => { if (before[at] !== item) item.moved = true; });
    }
    lines = order;
    renderLines(focusAt);
  }
  // "+" opens the new line; pressed again with a tag in it, that tag becomes a
  // line of its own and a new blank opens under it.
  get('.discard').onclick = () => finish();
  get('.add').onclick = () => {
    if (phase !== 'idle') return;
    if (all().includes(fresh) && fresh.tag.trim()) { lines.push(fresh); fresh = blank(); }
    adding = true;
    renderLines(lines.length);
  };
  function renderLines(focusAt = 0, typing = false) {
    const items = all();
    get('.lines').classList.toggle('ranked', lines.length > 1);
    get('.lines').replaceChildren(...items.map((item, index) => {
      const row = element('div', undefined, { class: item === fresh ? 'row fresh' : 'row' });
      // Search inputs are excluded by Bitwarden even when ignore hints are disabled.
      // Keep the accessible role a textbox: this edits a tag, not a search query.
      const input = element('input', undefined, { type: 'search', role: 'textbox', name: `0xtagger-tag-${index + 1}`, maxlength: MAX_TAG_LENGTH, 'aria-label': `Tag ${index + 1}`, autocomplete: 'off', 'data-bwignore': 'true', spellcheck: 'false' });
      if (item === fresh) input.placeholder = lines.length ? 'Add a tag' : 'Name this address';
      input.value = item.tag;
      // Typing changes no panel geometry; avoid positioning/layout work per letter.
      input.oninput = () => {
        item.tag = input.value;
        showLine(item, row); if (item === fresh) attribution(); updateControls();
      };
      // Order is priority: within one network, the first is the one a page
      // shows. A row is dragged by its handle, or moved with Alt and an arrow.
      input.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      input.addEventListener('keydown', event => {
        const step = event.altKey && { ArrowUp: -1, ArrowDown: 1 }[event.key];
        const to = index + step;
        if (!step || phase !== 'idle' || item === fresh || to < 0 || to >= lines.length) return;
        event.preventDefault();
        const order = [...lines];
        [order[index], order[to]] = [order[to], item];
        reorder(order, to);
      });
      if (item !== fresh && lines.length > 1) {
        const grip = element('span', undefined, { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' });
        grip.innerHTML = GRIP_ICON;
        // Only the handle starts a drag, so selecting text in the field still works.
        grip.onpointerdown = () => { if (phase === 'idle') row.draggable = true; };
        grip.onpointerup = () => { row.draggable = false; };
        // A drag moves the rows themselves; the order is read back from them
        // once it is let go, so nothing is held against a row that has moved.
        row.addEventListener('dragstart', event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', ''); row.classList.add('dragging'); });
        row.addEventListener('dragend', () => {
          row.draggable = false;
          const order = [...get('.lines').children].map(child => items[child.dataset.index]).filter(other => other !== fresh);
          reorder(order, order.indexOf(item));
        });
        row.prepend(grip);
      }
      row.dataset.index = index;
      // The new line stays last; a row dragged over it stops just above it.
      row.addEventListener('dragover', event => {
        const held = get('.lines .dragging');
        if (!held) return;
        event.preventDefault();
        if (held === row) return;
        const after = item !== fresh && [...row.parentNode.children].indexOf(held) < [...row.parentNode.children].indexOf(row);
        row.parentNode.insertBefore(held, after ? row.nextSibling : row);
      });
      const network = element('button', undefined, { type: 'button', class: 'network', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
      network.innerHTML = `<span class="network-mark"></span><span class="symbol" aria-hidden="true"></span><span class="save-scope"></span>${CHEVRON_ICON}`;
      network.onclick = () => { if (menuFor?.item === item) closeMenu(); else openMenu(item, network); };
      // The tick that confirms a save, shown on the line's corner only then.
      const mark = element('span', undefined, { class: 'mark', 'aria-hidden': 'true' });
      row.append(input, network, mark);
      if (item !== fresh) {
        const remove = element('button', undefined, { type: 'button', class: 'quiet remove' });
        // A line never saved has nothing to keep: removing it is immediate.
        remove.onclick = () => {
          if (!item.saved) { lines.splice(lines.indexOf(item), 1); renderLines(null); return; }
          item.removed = !item.removed; showLine(item, row); updateControls();
        };
        row.append(remove);
      }
      showLine(item, row);
      return row;
    }));
    updateControls();
    attribution();
    queueMicrotask(onLayout);
    if (focusAt === null) return;
    const input = panel.querySelectorAll('.row input')[focusAt];
    if (input && !input.disabled) { input.focus(); if (typing) input.setSelectionRange(input.value.length, input.value.length); else input.select(); }
  }

  // The lists a save of these lines writes: for each network they touch, every
  // line in order, with these lines as they are now and the rest as saved.
  function plan(chosen) {
    const touched = new Set();
    for (const item of chosen) {
      if (item.saved) touched.add(item.saved.scope);
      if (!item.removed && item.tag.trim()) touched.add(item.scope);
    }
    const lists = new Map([...touched].map(scope => [scope, []]));
    for (const item of all()) {
      const now = chosen.includes(item) ? (item.removed || !item.tag.trim() ? null : { tag: item.tag.trim(), scope: item.scope }) : item.saved;
      if (now && lists.has(now.scope)) lists.get(now.scope).push(now.tag);
    }
    return [...lists].filter(([scope, tags]) => !sameTags(tags, known(scope).tags)).map(([scope, tags]) => ({ scope, tags }));
  }
  // The version a write must match. After our own write the book's answer is
  // the new version; until it arrives, the copy this view holds says it.
  function versionOf(scope) {
    const mine = seen.get(scope);
    const held = findRecord(activeState.records, address, scope);
    if (mine?.ours && held && sameTags(held.tags, mine.tags)) return held.version || null;
    return mine?.version ?? null;
  }
  // What a successful save leaves: the saved lines are plain again, removed
  // ones are gone, and a new tag becomes a line with a fresh blank under it.
  function settle(chosen, written) {
    const scopes = new Set(written.map(entry => entry.scope));
    lines = lines.filter(item => !(chosen.includes(item) && (item.removed || !item.tag.trim())));
    for (const item of lines) {
      if (chosen.includes(item)) { item.tag = item.tag.trim(); item.saved = { tag: item.tag, scope: item.scope }; item.moved = false; }
      else if (item.saved && scopes.has(item.saved.scope)) item.moved = false;
    }
    if (chosen.includes(fresh) && fresh.tag.trim()) { lines.push(line(fresh.tag.trim(), fresh.scope)); fresh = blank(); }
    adding = false;
  }
  let retry = null;
  async function commit(chosen) {
    if (closed || phase !== 'idle' || activeState.activeBook !== book || !chosen.length) return;
    let writes;
    try { writes = plan(chosen).map(entry => ({ ...entry, tags: normalizeTags(entry.tags) })); }
    catch (error) { get('.notice').textContent = error.message; queueMicrotask(onLayout); return; }
    retry = () => commit(chosen);
    const rows = chosen.map(item => rowOf(item)).filter(Boolean);
    phase = 'saving';
    guard();
    let at = null;
    try {
      for (const entry of writes) {
        at = entry.scope;
        // A suggestion rewritten before it was ever saved is a name composed by
        // hand, and carries no origin. The book keeps the origin of a record
        // that already has one, so this only ever names a record being created.
        const source = prefill && !known(entry.scope).version && entry.tags[0] === prefill.name ? prefill.source : undefined;
        await save({ book, address, scope: entry.scope, tags: entry.tags, version: versionOf(entry.scope), source });
        seen.set(entry.scope, { tags: entry.tags, version: versionOf(entry.scope), ours: true });
      }
      if (closed) return;
      settle(chosen, writes);
      phase = 'saved';
      guard();
      // Confirm the write first; a small local animation never determines
      // whether a save succeeded. Each saved line's tick draws itself on in
      // green while a ring leaves it. Brief enough to be over before anyone waits.
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      await Promise.all(rows.map(row => {
        const tick = row.querySelector('.mark');
        tick.innerHTML = COPIED_ICON;
        tick.classList.add('confirmed');
        row.classList.add('saved');
        return tick.animate(still ? [{ opacity: 1 }, { opacity: 1 }] : [
          { transform: 'scale(.6)', opacity: 0, boxShadow: '0 0 0 0 var(--0xtagger-success-pulse, transparent)' },
          { transform: 'scale(1.12)', opacity: 1, offset: .45 },
          { transform: 'scale(1)', opacity: 1, boxShadow: '0 0 0 7px transparent' },
        ], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' }).finished.catch(() => {});
      }));
      if (!still) await new Promise(resolve => setTimeout(resolve, 140));
      // Nothing left to save closes the editor; anything still waiting keeps it open.
      if (!all().some(pending)) { finish(); return; }
      phase = 'idle';
      renderLines(null);
      guard();
    } catch (error) {
      if (closed) return;
      phase = 'idle';
      get('.notice').textContent = error.message;
      // A book that answered with something else puts its own panel on screen,
      // which is answer enough; everything else leaves only the notice, so the
      // button says it too.
      if (error.status !== 409) {
        for (const row of rows) row.animate(matchMedia('(prefers-reduced-motion: reduce)').matches ? REFUSED_STILL : REFUSED,
          { duration: 300, easing: 'ease-out' });
      }
      // A refusal only ever means the book now says something else for one
      // network. Show what it says and offer the two answers, each one click.
      if (error.status === 409 && at) {
        const scope = at;
        const theirs = { tags: error.current?.tags || [], version: error.current?.version || null };
        const box = get('.conflict');
        box.hidden = false;
        const take = element('button', 'Use these', { type: 'button', class: 'quiet' });
        take.onclick = () => {
          seen.set(scope, theirs);
          const first = lines.findIndex(item => item.saved?.scope === scope);
          const kept = lines.filter(item => item.saved?.scope !== scope);
          kept.splice(first < 0 ? kept.length : first, 0, ...theirs.tags.map(tag => line(tag, scope)));
          lines = kept;
          box.hidden = true; get('.notice').textContent = ''; renderLines(null);
        };
        const keep = element('button', 'Keep mine', { type: 'button', class: 'quiet' });
        // The other button beside it only changes what the lines show, as every
        // other control in this panel does. This one writes, so it answers to the
        // same rule as Save: a website script sharing this page must not be able
        // to settle a conflict in favour of a draft nobody confirmed.
        keep.onclick = event => {
          if (!event.isTrusted) return;
          seen.set(scope, { tags: theirs.tags, version: theirs.version });
          box.hidden = true; get('.notice').textContent = ''; retry?.();
        };
        box.replaceChildren(element('p', `${scopeName(scope)}: ${theirs.tags.join(' · ') || 'No tags'}`), take, keep);
      }
      updateControls();
      queueMicrotask(onLayout);
    }
  }
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
    // Enter saves every line with something to save, from a tag or from the
    // control that just marked one for removal; with nothing waiting, it closes.
    if (event.isTrusted && event.key === 'Enter' && event.target.matches('.row input, .remove') && !event.isComposing) {
      event.preventDefault(); event.stopPropagation();
      const waiting = all().filter(pending);
      if (waiting.length) commit(waiting);
      else finish();
    }
  });
  guard();
  renderLines();
  return {
    focus, updateVisibility,
    // Opening another address is leaving this one: its draft is saved first.
    // While a save is under way, or one cannot be made, the draft stays open.
    async closeIfUnchanged() {
      if (phase === 'idle' && (!edited() || activeState.activeBook === book) && await leave(true)) return true;
      if (!closed) {
        pageNotice = 'Save or close this draft to edit another address.';
        guard(); focus();
      }
      return closed;
    },
    // Lines nobody has touched follow the book, so a name saved in another tab
    // or window is simply what you see rather than a conflict waiting to
    // happen. A draft with typing in it is never overwritten.
    updateState(next) {
      activeState = next;
      for (const [scope, mine] of seen) {
        const held = findRecord(next.records, address, scope);
        if (mine.ours && held && sameTags(held.tags, mine.tags)) seen.set(scope, { tags: held.tags, version: held.version || null });
        else if (mine.ours && !held && !mine.tags.length) seen.delete(scope);
      }
      if (phase === 'idle' && !edited()) {
        const held = next.records.filter(item => item.address === address);
        const same = held.length === seen.size && held.every(item => sameTags(item.tags, known(item.scope).tags) && (item.version || null) === known(item.scope).version);
        if (!same) {
          const inputs = [...panel.querySelectorAll('.row input')];
          const here = inputs.indexOf(panel.getRootNode().activeElement);
          read(next);
          renderLines(here >= 0 ? here : null);
        }
      }
      guard();
    },
    detach(message = 'The page integration paused. Your draft is still safe to save to the book.') { pageNotice = message; guard(); },
    close: finish,
  };
}
