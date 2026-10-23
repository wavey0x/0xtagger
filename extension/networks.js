// Exact explorer hosts and chain IDs. The Etherscan group uses one page layout;
// other explorers can share a chain registry without being claimed by it.
// The quick choices stay small; every other chain can still be entered by ID.
// Source: api.etherscan.io/v2/chainlist, checked 2026-10-22; Blastscan's
// live mainnet and Sepolia pages use the same layout but are absent there.
const etherscanNetworks = [
  { chain: '1', name: 'Ethereum', explorer: 'etherscan.io', safe: ['eth'], quick: true },
  { chain: '11155111', name: 'Sepolia', explorer: 'sepolia.etherscan.io', safe: ['sep'], quick: true },
  { chain: '8453', name: 'Base', explorer: 'basescan.org', safe: ['base'], quick: true },
  { chain: '42161', name: 'Arbitrum', explorer: 'arbiscan.io', safe: ['arb1', 'arb'], quick: true },
  { chain: '10', name: 'Optimism', explorer: 'optimistic.etherscan.io', safe: ['oeth', 'op'], quick: true },
  { chain: '56', name: 'BNB Chain', explorer: 'bscscan.com', safe: ['bnb'], quick: true },
  { chain: '137', name: 'Polygon', explorer: 'polygonscan.com', safe: ['matic', 'polygon'], quick: true },
  { chain: '560048', name: 'Hoodi', explorer: 'hoodi.etherscan.io' },
  { chain: '97', name: 'BNB Testnet', explorer: 'testnet.bscscan.com' },
  { chain: '80002', name: 'Polygon Amoy', explorer: 'amoy.polygonscan.com' },
  { chain: '84532', name: 'Base Sepolia', explorer: 'sepolia.basescan.org' },
  { chain: '421614', name: 'Arbitrum Sepolia', explorer: 'sepolia.arbiscan.io' },
  { chain: '59144', name: 'Linea', explorer: 'lineascan.build' },
  { chain: '59141', name: 'Linea Sepolia', explorer: 'sepolia.lineascan.build' },
  { chain: '11155420', name: 'OP Sepolia', explorer: 'sepolia-optimism.etherscan.io' },
  { chain: '43114', name: 'Avalanche', explorer: 'snowscan.xyz' },
  { chain: '43113', name: 'Avalanche Fuji', explorer: 'testnet.snowscan.xyz' },
  { chain: '199', name: 'BitTorrent Chain', explorer: 'bttcscan.com' },
  { chain: '1029', name: 'BitTorrent Testnet', explorer: 'testnet.bttcscan.com' },
  { chain: '42220', name: 'Celo', explorer: 'celoscan.io' },
  { chain: '11142220', name: 'Celo Sepolia', explorer: 'sepolia.celoscan.io' },
  { chain: '252', name: 'Fraxtal', explorer: 'fraxscan.com' },
  { chain: '2523', name: 'Fraxtal Hoodi', explorer: 'hoodi.fraxscan.com' },
  { chain: '5000', name: 'Mantle', explorer: 'mantlescan.xyz' },
  { chain: '5003', name: 'Mantle Sepolia', explorer: 'sepolia.mantlescan.xyz' },
  { chain: '4352', name: 'MemeCore', explorer: 'memecorescan.io' },
  { chain: '43522', name: 'MemeCore Testnet', explorer: 'testnet.memecorescan.io' },
  { chain: '167000', name: 'Taiko', explorer: 'taikoscan.io' },
  { chain: '167013', name: 'Taiko Hoodi', explorer: 'hoodi.taikoscan.io' },
  { chain: '50', name: 'XDC', explorer: 'xdcscan.com' },
  { chain: '51', name: 'XDC Apothem', explorer: 'testnet.xdcscan.com' },
  { chain: '480', name: 'World', explorer: 'worldscan.org' },
  { chain: '4801', name: 'World Sepolia', explorer: 'sepolia.worldscan.org' },
  { chain: '146', name: 'Sonic', explorer: 'sonicscan.org' },
  { chain: '14601', name: 'Sonic Testnet', explorer: 'testnet.sonicscan.org' },
  { chain: '130', name: 'Unichain', explorer: 'uniscan.xyz' },
  { chain: '1301', name: 'Unichain Sepolia', explorer: 'sepolia.uniscan.xyz' },
  { chain: '2741', name: 'Abstract', explorer: 'abscan.org' },
  { chain: '11124', name: 'Abstract Sepolia', explorer: 'sepolia.abscan.org' },
  { chain: '80094', name: 'Berachain', explorer: 'berascan.com' },
  { chain: '80069', name: 'Berachain Bepolia', explorer: 'testnet.berascan.com' },
  { chain: '143', name: 'Monad', explorer: 'monadscan.com' },
  { chain: '10143', name: 'Monad Testnet', explorer: 'testnet.monadscan.com' },
  { chain: '999', name: 'HyperEVM', explorer: 'hyperevmscan.io' },
  { chain: '747474', name: 'Katana', explorer: 'katanascan.com' },
  { chain: '737373', name: 'Katana Bokuto', explorer: 'bokuto.katanascan.com' },
  { chain: '1329', name: 'Sei', explorer: 'seiscan.io' },
  { chain: '1328', name: 'Sei Testnet', explorer: 'testnet.seiscan.io' },
  { chain: '988', name: 'Stable', explorer: 'stablescan.xyz' },
  { chain: '2201', name: 'Stable Testnet', explorer: 'testnet.stablescan.xyz' },
  { chain: '9745', name: 'Plasma', explorer: 'plasmascan.to' },
  { chain: '9746', name: 'Plasma Testnet', explorer: 'testnet.plasmascan.to' },
  { chain: '4326', name: 'MegaETH', explorer: 'mega.etherscan.io' },
  { chain: '6343', name: 'MegaETH Testnet', explorer: 'testnet-mega.etherscan.io' },
  { chain: '4663', name: 'Robinhood Chain', explorer: 'robin.etherscan.io' },
  { chain: '5042', name: 'Arc', explorer: 'arc.etherscan.io' },
  { chain: '81457', name: 'Blast', explorer: 'blastscan.io' },
  { chain: '168587773', name: 'Blast Sepolia', explorer: 'sepolia.blastscan.io' },
];

const otherNetworks = [
  { chain: '100', name: 'Gnosis', explorer: 'gnosisscan.io', safe: ['gno'], quick: true },
];

export const networks = [...etherscanNetworks, ...otherNetworks];
export const quickNetworks = networks.filter(entry => entry.quick);

// Chain IDs stay strings: eip155 permits values beyond Number precision.
const byChain = new Map(networks.map(entry => [entry.chain, entry]));
const byExplorer = new Map(networks.map(entry => [entry.explorer, entry]));
const byEtherscanExplorer = new Map(etherscanNetworks.map(entry => [entry.explorer, entry]));
const bySafe = new Map(networks.flatMap(entry => (entry.safe || []).map(prefix => [prefix, entry])));

export const explorerNetwork = hostname => byExplorer.get(hostname) || null;
export const etherscanNetwork = hostname => byEtherscanExplorer.get(hostname) || null;
export const safeNetwork = prefix => bySafe.get(prefix) || null;
export const scopeOf = network => (network ? `eip155:${network.chain}` : undefined);

export function scopeName(scope) {
  if (scope === 'global') return 'All networks';
  const chain = String(scope).slice(7);
  return byChain.get(chain)?.name || `Chain ${chain}`;
}
