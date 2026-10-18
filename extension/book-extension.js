import { startBook } from './book.js';
import { rpc, watchBook } from './ui.js';

const tab = await chrome.tabs.getCurrent();
const bookSearch = new BroadcastChannel('0xtagger-book-search');
startBook({ rpc, watchBook, manageBooks: true,
  watchPending: listener => chrome.storage.session.onChanged.addListener(listener),
  watchSearch: listener => {
    bookSearch.onmessage = event => {
      if (event.data?.tabId === tab?.id && typeof event.data.query === 'string') listener(event.data.query);
    };
  },
});
