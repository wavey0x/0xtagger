import { findRecord, MAX_TAGS, MAX_TAG_LENGTH, normalizeTags, sameTags, sourceName, usableName } from './shared.js';
import { checksumAddress } from './checksum.js';
import { chainLogos } from './vendor/chain-logos.js';
import { quickNetworks, scopeName, scopeSymbol } from './networks.js';
import { EDITOR_MARK, COPY_ICON, COPIED_ICON, EYE_ICON, EYE_OFF_ICON, GLOBE_ICON, CHEVRON_ICON, CHECK_ICON, PLUS_ICON, CLOSE_ICON, STAR_ICON, confirmCopied } from './icons.js';

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
export function createEditor(container, { address, scope: opened = 'global', state, save, close, onLayout = () => {}, visibility, toggleVisibility, suggestion = null, modal = false }) {
  const book = state.activeBook;
  // Which book a save goes to only matters once there is more than one.
  const bookName = state.books.length > 1 ? state.bookName : '';
  const displayAddress = checksumAddress(address);
  // Which network a save is for. It opens where the record already is, and the
  // menu beside Save moves it.
  let scope = opened;
  const own = findRecord(state.records, address, scope);
  // What the book says about this address, and the version a save must match.
  // A scope with no record of its own starts from the tags shown everywhere.
  const reading = from => {
    const mine = findRecord(from.records, address, scope);
    const shown = mine || (scope !== 'global' && findRecord(from.records, address, 'global'));
    return { tags: shown?.tags || [], version: mine?.version || null };
  };
  let loaded = reading(state);
  // What the website calls this address. Where nothing is saved it is a
  // starting value, so saving is the only thing left to do. Where something is
  // saved the address is settled, and the site's name is only ever offered.
  const offered = suggestion?.name && usableName(suggestion.name) ? suggestion : null;
  const prefill = offered && !loaded.tags.length ? offered : null;
  const draft = { tags: [...(loaded.tags.length ? loaded.tags : [prefill ? prefill.name : ''])], version: loaded.version };
  // Compared as a save would store them, so a stray space is not an edit.
  const written = () => draft.tags.map(tag => tag.trim()).filter(Boolean);
  // A name this editor put in the field itself is not something anyone typed.
  // Treating it as an unsaved draft would make opening one address and then
  // another ask to save work nobody did.
  const untouched = () => Boolean(prefill) && !loaded.tags.length && sameTags(written(), [prefill.name]);
  const edited = () => !untouched() && !sameTags(written(), loaded.tags);
  const adopt = next => {
    loaded = next;
    draft.tags = [...(next.tags.length ? next.tags : [''])];
    draft.version = next.version;
  };
  let phase = 'idle';
  let closed = false;
  let activeState = state;
  let pageNotice = '';

  const panel = element(modal ? 'dialog' : 'section', undefined, { class: 'editor', role: 'dialog', 'aria-label': 'Edit wallet tags' });
  panel.innerHTML = `<header><span class="brand" role="img" aria-label="0xtagger">${EDITOR_MARK}<svg class="sheen" aria-hidden="true"><linearGradient id="brand-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></svg></span><code></code><button type="button" class="quiet copy" aria-label="Copy">${COPY_ICON}</button><span class="source"></span>${visibility ? '<div class="visibility-group"><button type="button" class="quiet visibility" role="switch" aria-label="Show my tags for this address" aria-checked="true"></button></div>' : `<button type="button" class="quiet close" aria-label="Close editor" title="Close">${CLOSE_ICON}</button>`}</header>
    <div class="main"><div class="lead"></div><button type="button" class="quiet add" aria-label="Add tag" title="Add another tag">${PLUS_ICON}</button><div class="scope"><button type="button" class="network" aria-haspopup="listbox" aria-expanded="false"><span class="network-mark"></span><span class="symbol" aria-hidden="true"></span><span class="save-scope" id="save-scope"></span>${CHEVRON_ICON}</button><div class="networks" role="listbox" aria-label="Save for" popover="manual"></div></div><button type="button" class="primary save" aria-label="Save" aria-describedby="save-scope">${CHECK_ICON}</button></div>
    <div class="rows"></div>
    <p class="preview"></p><p class="offer" hidden></p><p class="notice" role="status"></p><div class="conflict" hidden></div>${modal && own ? '<div class="extras"><button type="button" class="quiet clear">Remove tags</button></div>' : ''}`;
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
  get('.save').title = bookName ? `Save to ${bookName}` : 'Save';
  function outside(event) {
    const path = event.composedPath();
    const box = modal && panel.getBoundingClientRect();
    if (menuOpen() && !path.includes(get('.networks')) && !path.includes(get('.network'))) closeMenu();
    const inside = path.includes(get('.networks')) || path.includes(panel) && (!modal || event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom);
    if (event.button === 0 && !inside && !path.some(node => node.matches?.('[data-0xtagger-edit]'))) finish();
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
    (panel.querySelector('.row input:not(:disabled), .add:not(:disabled)') || get('.copy')).focus({ preventScroll: true });
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
  if (get('.clear')) get('.clear').onclick = () => { draft.tags = []; renderRows(); };
  get('.copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(displayAddress);
      confirmCopied(get('.copy'));
    }
    catch { get('code').classList.add('whole'); get('.notice').textContent = 'Select the full address above to copy it.'; queueMicrotask(onLayout); }
  };
  // The network menu. It lives in the top layer, so neither the panel's own
  // scrolling nor a website's clipping can cut it off.
  const menu = get('.networks');
  const menuOpen = () => get('.network').getAttribute('aria-expanded') === 'true';
  // A network's own logo where there is one; a plain disc for any other chain.
  const networkMark = choice => (choice === 'global' ? GLOBE_ICON : chainLogos[choice.slice(7)] || '<i class="dot"></i>');
  function showScope() {
    get('.network-mark').innerHTML = networkMark(scope);
    get('.symbol').textContent = scopeSymbol(scope);
    get('.save-scope').textContent = scopeName(scope);
    get('.network').title = `Tags for ${scopeName(scope)}`;
  }
  function placeMenu() {
    const at = get('.network').getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = innerHeight - at.bottom - 8;
    menu.style.left = `${Math.max(8, Math.min(at.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${below >= height || at.top < height ? at.bottom + 4 : at.top - height - 4}px`;
  }
  function openMenu() {
    const choices = ['global', ...quickNetworks.map(network => `eip155:${network.chain}`)];
    if (!choices.includes(scope)) choices.push(scope);
    menu.replaceChildren(...choices.map(choice => {
      const option = element('button', undefined, { type: 'button', role: 'option', 'aria-selected': String(choice === scope), 'data-scope': choice, tabindex: '-1' });
      // A network with its own name for this address says so, which is the
      // only way to see an override without opening the book.
      const named = choice !== 'global' && findRecord(activeState.records, address, choice)?.tags.join(', ');
      option.innerHTML = networkMark(choice);
      option.append(element('span', scopeName(choice), { class: 'name' }));
      if (named) { option.append(element('i', undefined, { class: 'own' })); option.title = named; }
      option.append(element('span', scopeSymbol(choice), { class: 'symbol' }));
      option.onclick = () => { closeMenu(); chooseScope(choice); get('.network').focus(); };
      return option;
    }));
    menu.showPopover();
    get('.network').setAttribute('aria-expanded', 'true');
    placeMenu();
    menu.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
    addEventListener('scroll', closeMenu, { capture: true, passive: true });
    addEventListener('resize', closeMenu, { passive: true });
  }
  function closeMenu() {
    if (!menuOpen()) return;
    get('.network').setAttribute('aria-expanded', 'false');
    menu.hidePopover();
    removeEventListener('scroll', closeMenu, { capture: true });
    removeEventListener('resize', closeMenu);
  }
  // Moving to another network reads what that network says. Words already
  // typed stay in the field and go wherever the save does.
  function chooseScope(next) {
    if (next === scope || phase !== 'idle') return;
    const typed = edited() || untouched();
    scope = next;
    const fresh = reading(activeState);
    if (typed) { loaded = fresh; draft.version = fresh.version; }
    else adopt(fresh);
    showScope();
    renderRows(null);
  }
  get('.network').onclick = () => { if (menuOpen()) closeMenu(); else openMenu(); };
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="option"]')];
    const at = options.indexOf(menu.getRootNode().activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) { event.preventDefault(); options[(at + step + options.length) % options.length].focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); options.at(event.key === 'Home' ? 0 : -1).focus(); }
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); closeMenu(); get('.network').focus();
    }
  });
  showScope();
  // A record for one network giving way to a global one is worth saying, because
  // the tag that takes over is not on screen. That emptying the field puts the
  // address back is the field in front of you, said twice.
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
  // shown, never substituted, and taking it appends, so the preferred name
  // stays the preferred name.
  function attribution() {
    const live = Boolean(prefill) && draft.tags[0] === prefill.name;
    const row = panel.querySelector('.row');
    const field = row?.querySelector('input');
    const shown = row?.querySelector('.from');
    if (!live) { shown?.remove(); field?.removeAttribute('aria-describedby'); }
    else if (row && !shown) {
      const note = element('small', `(from ${sourceName(prefill.source)})`, { class: 'from', id: 'from-site' });
      row.insertBefore(note, row.querySelector('.rank'));
      field?.setAttribute('aria-describedby', 'from-site');
    }
    const spare = offered && !prefill && !draft.tags.some(tag => tag.trim() === offered.name);
    get('.offer').hidden = !spare;
    get('.offer').replaceChildren();
    if (spare) {
      const button = element('button', 'Add tag', { type: 'button', class: 'quiet' });
      button.onclick = () => { draft.tags.push(offered.name); renderRows(draft.tags.length - 1); };
      get('.offer').append(element('span', offered.name), button);
    }
  }
  function preview() {
    const fallback = !written().length && scope !== 'global'
      ? findRecord(activeState.records, address, 'global')?.tags[0] : null;
    get('.preview').hidden = !fallback;
    get('.preview').textContent = fallback ? `Removing this override will show ${fallback}.` : '';
    queueMicrotask(onLayout);
  }
  function guard() {
    const switched = activeState.activeBook !== book;
    updateControls();
    get('.notice').textContent = phase === 'saved' ? '' : switched ? `You switched to ${activeState.bookName}. Close this editor and try again.` : pageNotice;
    queueMicrotask(onLayout);
  }
  function updateControls() {
    updateVisibility();
    const busy = phase !== 'idle';
    get('.save').disabled = busy || activeState.activeBook !== book;
    if (phase === 'saved') {
      if (!get('.save').classList.contains('confirmed')) get('.save').innerHTML = COPIED_ICON;
      get('.save').classList.add('confirmed');
      get('.save').setAttribute('aria-label', 'Saved');
      get('.save').title = 'Saved';
    } else {
      if (get('.save').classList.contains('confirmed') || !get('.save').firstElementChild) get('.save').innerHTML = CHECK_ICON;
      get('.save').classList.remove('confirmed');
      get('.save').setAttribute('aria-label', busy ? 'Saving…' : 'Save');
      get('.save').title = bookName ? `Save to ${bookName}` : 'Save';
    }
    updateLive();
    panel.querySelectorAll('input').forEach(input => { input.disabled = busy; });
    const rows = panel.querySelectorAll('.row');
    rows.forEach(row => { row.querySelector('[aria-label^="Remove"]').disabled = busy; });
    get('.network').disabled = busy;
    get('.add').disabled = busy || rows.length >= MAX_TAGS;
    if (get('.clear')) get('.clear').disabled = busy || !written().length;
  }
  // Save lights up once there is something to save. It still works when it is
  // dim: pressing it then only closes the editor.
  function updateLive() { get('.save').classList.toggle('live', edited() || untouched()); }
  // The first tag is the one a page shows, so it gets the field beside the
  // network and Save. Any others are quieter lines under it.
  function renderRows(focus = 0) {
    if (!draft.tags.length) draft.tags.push('');
    const rows = get('.rows');
    const made = draft.tags.map((tag, index) => {
      const row = element('div', undefined, { class: index ? 'row alias' : 'row' });
      // Search inputs are excluded by Bitwarden even when ignore hints are disabled.
      // Keep the accessible role a textbox: this edits a tag, not a search query.
      const input = element('input', undefined, { type: 'search', role: 'textbox', name: `0xtagger-tag-${index + 1}`, maxlength: MAX_TAG_LENGTH, 'aria-label': `Tag ${index + 1}`, placeholder: index ? 'Another name' : 'Name this address', autocomplete: 'off', 'data-bwignore': 'true', spellcheck: 'false' });
      input.value = tag;
      // Typing changes no panel geometry; avoid positioning/layout work per letter.
      input.oninput = () => { draft.tags[index] = input.value; if (index === 0) attribution(); updateLive(); };
      // Alt and an arrow moves a tag; the first is the one a page shows.
      const move = to => {
        if (to < 0 || to >= draft.tags.length || to === index) return;
        draft.tags.splice(to, 0, ...draft.tags.splice(index, 1));
        renderRows(to);
      };
      input.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      input.addEventListener('keydown', event => {
        const step = event.altKey && { ArrowUp: -1, ArrowDown: 1 }[event.key];
        if (step && phase === 'idle') { event.preventDefault(); move(index + step); }
      });
      const controls = element('div', undefined, { class: 'rank' });
      if (index) {
        row.append(element('span', 'aka', { class: 'aka', 'aria-hidden': 'true' }));
        const lead = element('button', undefined, { type: 'button', class: 'quiet', 'aria-label': `Make tag ${index + 1} the default`, title: 'Show this one first' });
        lead.innerHTML = STAR_ICON;
        lead.onclick = () => move(0);
        controls.append(lead);
      }
      const remove = element('button', undefined, { type: 'button', class: 'quiet', 'aria-label': `Remove tag ${index + 1}`, title: 'Remove tag' });
      remove.innerHTML = CLOSE_ICON;
      remove.onclick = () => { draft.tags.splice(index, 1); renderRows(Math.min(index, Math.max(draft.tags.length - 1, 0))); };
      controls.append(remove);
      row.append(input, controls);
      return row;
    });
    get('.lead').replaceChildren(made[0]);
    rows.replaceChildren(...made.slice(1));
    updateControls();
    attribution();
    preview();
    if (focus === null) return;
    const input = panel.querySelectorAll('.row input')[focus];
    if (input) { input.focus(); input.select(); }
    else get('.add').focus();
  }
  get('.add').onclick = () => { draft.tags.push(''); renderRows(draft.tags.length - 1); };

  async function submit() {
    if (closed || phase !== 'idle' || activeState.activeBook !== book) return;
    let tags;
    try { tags = normalizeTags(written()); }
    catch (error) { get('.notice').textContent = error.message; queueMicrotask(onLayout); return; }
    phase = 'saving';
    guard();
    try {
      // A suggestion rewritten before it was ever saved is a name composed by
      // hand, and carries no origin. The book keeps the origin of a record that
      // already has one, so this only ever names a record being created.
      const source = prefill && tags[0] === prefill.name ? prefill.source : undefined;
      await save({ book, address, scope, tags, version: draft.version, source });
      if (closed) return;
      phase = 'saved';
      guard();
      // Confirm the write first; a small local animation never determines
      // whether a save succeeded. Keep the button locked until it closes.
      // The button gives a little under the press and comes back past where it
      // started, while a ring leaves it and the tick draws itself on. Brief
      // enough to be over before anyone waits for it.
      const frames = matchMedia('(prefers-reduced-motion: reduce)').matches ? [{ opacity: 1 }, { opacity: 1 }] : [
        { transform: 'scale(1)', boxShadow: '0 0 0 0 var(--0xtagger-accent-glow)' },
        { transform: 'scale(.95)', boxShadow: '0 0 0 2px var(--0xtagger-accent-pulse)', offset: .2 },
        { transform: 'scale(1.05)', boxShadow: '0 0 0 8px transparent', offset: .62 },
        { transform: 'scale(1)', boxShadow: '0 0 0 0 transparent' },
      ];
      await get('.save').animate(frames, { duration: 340, easing: 'cubic-bezier(.2,.9,.3,1)' }).finished.catch(() => {});
      finish();
    } catch (error) {
      if (closed) return;
      get('.notice').textContent = error.message;
      // A book that answered with something else puts its own panel on screen,
      // which is answer enough; everything else leaves only the notice, so the
      // button says it too.
      if (error.status !== 409) {
        get('.save').animate(matchMedia('(prefers-reduced-motion: reduce)').matches ? REFUSED_STILL : REFUSED,
          { duration: 300, easing: 'ease-out' });
      }
      // A refusal only ever means the book now says something else. Show what
      // it says and offer the two answers, each of them one click.
      if (error.status === 409) {
        const theirs = { tags: error.current?.tags || [], version: error.current?.version || null };
        const box = get('.conflict');
        box.hidden = false;
        const take = element('button', 'Use these', { type: 'button', class: 'quiet' });
        take.onclick = () => { adopt(theirs); box.hidden = true; get('.notice').textContent = ''; renderRows(); };
        const keep = element('button', 'Keep mine', { type: 'button', class: 'quiet' });
        // The other button beside it only changes what the field shows, as every
        // other control in this panel does. This one writes, so it answers to the
        // same rule as Save: a website script sharing this page must not be able
        // to settle a conflict in favour of a draft nobody confirmed.
        keep.onclick = event => { if (!event.isTrusted) return; draft.version = theirs.version; box.hidden = true; get('.notice').textContent = ''; submit(); };
        box.replaceChildren(element('p', theirs.tags.join(' · ') || 'No tags'), take, keep);
      }
    } finally {
      phase = 'idle';
      if (!closed) {
        updateControls();
        queueMicrotask(onLayout);
      }
    }
  }
  // The editor shares the page DOM. Website scripts must not submit the book.
  get('.save').addEventListener('click', event => { if (event.isTrusted) submit(); });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
    if (event.isTrusted && event.key === 'Enter' && event.target.matches('.row input') && !event.isComposing) { event.preventDefault(); event.stopPropagation(); submit(); }
  });
  guard();
  renderRows();
  return {
    focus, updateVisibility,
    closeIfUnchanged() {
      if (phase !== 'idle' || edited()) {
        pageNotice = 'Save or close this draft to edit another address.';
        guard(); focus();
        return false;
      }
      finish();
      return true;
    },
    // A draft nobody has touched follows the book, so a name saved in another
    // tab or window is simply what you see rather than a conflict waiting to
    // happen. A draft with typing in it is never overwritten.
    updateState(next) {
      activeState = next;
      if (phase === 'idle' && !edited()) {
        const fresh = reading(next);
        if (fresh.version !== loaded.version || !sameTags(fresh.tags, loaded.tags)) {
          adopt(fresh);
          const inputs = [...panel.querySelectorAll('.row input')];
          const here = inputs.indexOf(panel.getRootNode().activeElement);
          renderRows(here >= 0 ? here : null);
        }
      }
      guard();
    },
    detach(message = 'The page integration paused. Your draft is still safe to save to the book.') { pageNotice = message; guard(); },
    close: finish,
  };
}
