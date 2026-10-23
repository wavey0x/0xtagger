import test from 'node:test';
import assert from 'node:assert/strict';
import { addressAt } from '../extension/detect.js';
import { etherscanNetwork, explorerNetwork, networks, quickNetworks, safeNetwork, scopeName } from '../extension/networks.js';

// Etherscan's published chain list on 2026-10-22, minus Gnosis (now
// Blockscout), plus the two live Blastscan explorers. Each line is a host and
// the EIP-155 chain it must name, independently of the app's registry.
const expected = `
etherscan.io 1
sepolia.etherscan.io 11155111
hoodi.etherscan.io 560048
bscscan.com 56
testnet.bscscan.com 97
polygonscan.com 137
amoy.polygonscan.com 80002
basescan.org 8453
sepolia.basescan.org 84532
arbiscan.io 42161
sepolia.arbiscan.io 421614
lineascan.build 59144
sepolia.lineascan.build 59141
optimistic.etherscan.io 10
sepolia-optimism.etherscan.io 11155420
snowscan.xyz 43114
testnet.snowscan.xyz 43113
bttcscan.com 199
testnet.bttcscan.com 1029
celoscan.io 42220
sepolia.celoscan.io 11142220
fraxscan.com 252
hoodi.fraxscan.com 2523
mantlescan.xyz 5000
sepolia.mantlescan.xyz 5003
memecorescan.io 4352
testnet.memecorescan.io 43522
taikoscan.io 167000
hoodi.taikoscan.io 167013
xdcscan.com 50
testnet.xdcscan.com 51
worldscan.org 480
sepolia.worldscan.org 4801
sonicscan.org 146
testnet.sonicscan.org 14601
uniscan.xyz 130
sepolia.uniscan.xyz 1301
abscan.org 2741
sepolia.abscan.org 11124
berascan.com 80094
testnet.berascan.com 80069
monadscan.com 143
testnet.monadscan.com 10143
hyperevmscan.io 999
katanascan.com 747474
bokuto.katanascan.com 737373
seiscan.io 1329
testnet.seiscan.io 1328
stablescan.xyz 988
testnet.stablescan.xyz 2201
plasmascan.to 9745
testnet.plasmascan.to 9746
mega.etherscan.io 4326
testnet-mega.etherscan.io 6343
robin.etherscan.io 4663
arc.etherscan.io 5042
blastscan.io 81457
sepolia.blastscan.io 168587773
`.trim().split('\n').map(line => line.split(' '));

test('every Etherscan-layout hostname names exactly its own chain', () => {
  const address = '0x' + 'ab'.repeat(20);
  assert.equal(expected.length, 58);
  assert.equal(new Set(expected.map(([host]) => host)).size, expected.length);
  assert.equal(new Set(expected.map(([, chain]) => chain)).size, expected.length);
  for (const [host, chain] of expected) {
    assert.equal(etherscanNetwork(host)?.chain, chain, host);
    assert.equal(explorerNetwork(host)?.chain, chain, host);
    assert.deepEqual(addressAt(`https://${host}/address/${address}`, 'https://example.com'),
      { address, network: `eip155:${chain}` }, host);
  }
  assert.equal(networks.length, expected.length + 1, 'Gnosis remains known for Safe and link scoping');
});

test('different frontends and lookalike domains cannot claim the Etherscan adapter', () => {
  assert.equal(explorerNetwork('gnosisscan.io')?.chain, '100');
  assert.equal(safeNetwork('gno')?.chain, '100');
  for (const host of ['gnosisscan.io', 'apescan.io', 'opbnbscan.com', 'fake-arbiscan.io', 'arbiscan.io.example']) {
    assert.equal(etherscanNetwork(host), null, host);
  }
  assert.equal(explorerNetwork('arbiscan.io.example'), null);
});

test('new chain labels do not swell the quick network picker', () => {
  assert.deepEqual(quickNetworks.map(network => network.chain),
    ['1', '11155111', '8453', '42161', '10', '56', '137', '100']);
  assert.equal(scopeName('eip155:999'), 'HyperEVM');
  assert.equal(scopeName('eip155:168587773'), 'Blast Sepolia');
});
