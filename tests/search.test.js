import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEntries, searchEntries } from '../extension/shared.js';

test('the full book finds address, tag, network and source words', () => {
  const one = { address: '0x' + 'ab'.repeat(20), scope: 'eip155:8453', tags: ['Base payroll'], source: 'safe:address-book' };
  const two = { address: '0x' + 'cd'.repeat(20), scope: 'global', tags: ['Treasury'] };
  const entries = searchEntries([one, two]);
  for (const query of [one.address.toUpperCase(), 'payroll', 'BASE', 'safe']) {
    assert.deepEqual(filterEntries(entries, query).map(entry => entry.record), [one]);
  }
  assert.deepEqual(filterEntries(entries, 'treasury').map(entry => entry.record), [two]);
  assert.deepEqual(filterEntries(entries, '').map(entry => entry.record), [one, two]);
});
