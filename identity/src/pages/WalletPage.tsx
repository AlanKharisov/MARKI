import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGetNFTs, apiUpdateNFT, apiGetCryptoWallets } from '../services/apiClient';
import { Icon } from '../components/brand';

interface WalletPageProps {
  onNFTClick: (nft: any) => void;
  onSellNFT:  (nft: any) => void;
  onOpenSettings: () => void;
}

const getNFTImage = (nft: any): string => nft.image || nft.imageUrl || nft.nftImage || '/img/default-nft.png';

type Tab = 'all' | 'listed' | 'hidden';
type WalletEntry = { type: 'single'; nft: any } | { type: 'batch'; id: string; name: string; items: any[] };

const FILTERS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All NFTs' },
  { id: 'listed', label: 'Listed for Sale' },
  { id: 'hidden', label: 'Hidden' },
];

const getEditionNumber = (nft: any): number | null => {
  const value = nft.editionNumber ?? nft.edition_number;
  return typeof value === 'number' ? value : null;
};

const getMasterId = (nft: any): string | null => (
  nft.masterNftId || nft.master_nft_id || null
);

const getExplicitBatchId = (nft: any): string | null => (
  nft.batchId || nft.batch_id || null
);

const getInferredEditionBatchId = (nft: any): string | null => {
  const masterId = getMasterId(nft);
  if (masterId) return `edition:${masterId}`;

  if (getEditionNumber(nft) === 0) {
    return `edition:${nft.id}`;
  }

  return null;
};

const getBatchName = (nft: any): string => (
  nft.batchName || nft.batch_name || nft.collectionName || nft.title || 'Collection'
);

const getBatchIndex = (nft: any): number => {
  const value = nft.batchIndex ?? nft.batch_index;
  return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
};

const getCreatedAt = (nft: any): string => nft.createdAt || nft.created_at || '';

const normalizeTitle = (value: string): string => (
  value.replace(/\s+#\d+(?:\/\d+)?\s*$/i, '').trim().toLowerCase()
);

const sortBatchItems = (items: any[]) => [...items].sort((a, b) => {
  const ai = getBatchIndex(a);
  const bi = getBatchIndex(b);
  if (ai !== bi) return ai - bi;
  return getCreatedAt(a).localeCompare(getCreatedAt(b));
});

const buildWalletEntries = (nfts: any[]): WalletEntry[] => {
  const batches = new Map<string, any[]>();
  const entries: WalletEntry[] = [];
  const inferredEditionGroups = new Map<string, any[]>();

  nfts.forEach(nft => {
    const inferredId = getInferredEditionBatchId(nft);
    if (!inferredId) return;
    const items = inferredEditionGroups.get(inferredId) || [];
    items.push(nft);
    inferredEditionGroups.set(inferredId, items);
  });

  const hasRelatedEditions = (master: any): boolean => {
    const inferredId = `edition:${master.id}`;
    const relatedById = inferredEditionGroups.get(inferredId) || [];
    if (relatedById.length > 1) return true;

    const masterName = normalizeTitle(getBatchName(master));
    return nfts.some(nft => (
      nft.id !== master.id &&
      getEditionNumber(nft) !== null &&
      normalizeTitle(getBatchName(nft)) === masterName
    ));
  };

  nfts.forEach(nft => {
    const explicitBatchId = getExplicitBatchId(nft);
    const inferredBatchId = getInferredEditionBatchId(nft);
    const inferredGroupSize = inferredBatchId ? (inferredEditionGroups.get(inferredBatchId)?.length || 0) : 0;
    const batchId = explicitBatchId || (inferredGroupSize > 1 ? inferredBatchId : null);

    if (!batchId && getEditionNumber(nft) === 0 && hasRelatedEditions(nft)) {
      return;
    }

    if (!batchId) {
      entries.push({ type: 'single', nft });
      return;
    }
    const items = batches.get(batchId) || [];
    items.push(nft);
    batches.set(batchId, items);
  });

  batches.forEach((items, id) => {
    const sorted = sortBatchItems(items);
    if (sorted.length === 0) return;
    entries.push({
      type: 'batch',
      id,
      name: getBatchName(sorted[0]),
      items: sorted,
    });
  });

  return entries.sort((a, b) => {
    const aDate = a.type === 'single' ? getCreatedAt(a.nft) : getCreatedAt(a.items[0] || {});
    const bDate = b.type === 'single' ? getCreatedAt(b.nft) : getCreatedAt(b.items[0] || {});
    return bDate.localeCompare(aDate);
  });
};

const WalletPage: React.FC<WalletPageProps> = ({
  onNFTClick,
  onSellNFT,
  onOpenSettings,
}) => {
  const { currentUser } = useAuth();
  const [myNFTs, setMyNFTs] = useState<any[]>([]);
  const [cryptoWallets, setCryptoWallets] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [currentUser]); // eslint-disable-line

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [nfts, wallets] = await Promise.all([apiGetNFTs(), apiGetCryptoWallets()]);
      setMyNFTs(nfts || []);
      setCryptoWallets(wallets || []);
    } catch (e) {
      console.error('Error loading wallet data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromSale = async (nft: any) => {
    if (!currentUser) return;
    try {
      await apiUpdateNFT(nft.id, { forSale: false, price: null });
      setMyNFTs(prev => prev.map(n => (n.id === nft.id ? { ...n, forSale: false, price: null } : n)));
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const totalBalance = cryptoWallets.reduce(
    (sum: number, w: any) => sum + (Number(w.balance) || 0),
    0,
  );

  const visibleNFTs = myNFTs.filter(n => {
    if (tab === 'listed') return n.forSale;
    if (tab === 'hidden') return n.hidden;
    return true;
  });
  const walletEntries = buildWalletEntries(visibleNFTs);
  const allWalletEntries = buildWalletEntries(myNFTs);
  const openBatch = openBatchId
    ? allWalletEntries.find((entry): entry is Extract<WalletEntry, { type: 'batch' }> => (
      entry.type === 'batch' && entry.id === openBatchId
    ))
    : null;

  if (loading) {
    return (
      <div className="page wallet-page active" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (openBatch) {
    return (
      <div className="page wallet-page active mi-screen-pad" style={{ paddingTop: 16, paddingBottom: 148 }}>
        <BatchFolderView
          batch={openBatch}
          onClose={() => setOpenBatchId(null)}
          onNFTClick={onNFTClick}
          onSellNFT={onSellNFT}
          onRemoveFromSale={handleRemoveFromSale}
        />
      </div>
    );
  }

  return (
    <div className="page wallet-page active mi-screen-pad" style={{ paddingTop: 16, paddingBottom: 148 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 className="hero-title">My<br /><span className="accent">Wallet</span></h1>
        <button aria-label="Settings" className="icon-btn-round" onClick={onOpenSettings}>
          <Icon.Settings size={18} />
        </button>
      </div>

      {/* Balance card */}
      <div
        style={{
          marginTop: 16,
          padding: '22px 20px 24px',
          borderRadius: 24,
          background: 'var(--grad-balance)',
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
          marginBottom: 16,
          boxShadow: '0 10px 28px rgba(10,138,95,.35)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -70, right: -50,
            width: 210, height: 210,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,.22), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -50, left: -30,
            width: 160, height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(78,240,168,.25), transparent 70%)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, color: 'rgba(255,255,255,.7)' }}>TOTAL BALANCE</div>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,.16)',
              border: '1px solid rgba(255,255,255,.25)',
              borderRadius: 999,
              padding: '4px 10px',
              color: '#fff', fontSize: 10.5, fontWeight: 700,
            }}
          >
            Marki Wallet
          </div>
        </div>
        <div className="mono" style={{ fontSize: 36, fontWeight: 700, marginTop: 12, position: 'relative' }}>
          {totalBalance.toFixed(2)} <span style={{ fontSize: 17, color: '#bff5dd' }}>SOL</span>
        </div>
      </div>

      {/* My NFTs header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          flexDirection: 'column',
          gap: 10,
          padding: '4px 0 12px',
        }}
      >
        <div className="seg" style={{ width: '100%' }}>
          {FILTERS.map(filter => (
            <button
              key={filter.id}
              onClick={() => setTab(filter.id)}
              className={`seg-item ${tab === filter.id ? 'active' : ''}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
          {walletEntries.length} items
        </div>
      </div>

      {walletEntries.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '50px 20px' }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>🖼</div>
          <h3 className="h3">No NFTs yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Create your own NFT or buy from the marketplace.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {walletEntries.map(entry => (
            entry.type === 'single' ? (
              <NFTCard
                key={entry.nft.id}
                nft={entry.nft}
                onNFTClick={onNFTClick}
                onSellNFT={onSellNFT}
                onRemoveFromSale={handleRemoveFromSale}
              />
            ) : (
              <BatchFolderCard
                key={entry.id}
                batch={entry}
                onOpen={() => setOpenBatchId(entry.id)}
              />
            )
          ))}
        </div>
      )}

    </div>
  );
};

function NFTCard({
  nft,
  onNFTClick,
  onSellNFT,
  onRemoveFromSale,
}: {
  nft: any;
  onNFTClick: (nft: any) => void;
  onSellNFT: (nft: any) => void;
  onRemoveFromSale: (nft: any) => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onClick={() => onNFTClick(nft)}
    >
      <div
        style={{
          height: 140,
          background: 'var(--bg-soft)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <img
          src={getNFTImage(nft)}
          alt={nft.title}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
        />
        {nft.forSale && (
          <div
            style={{
              position: 'absolute',
              top: 10, left: 10,
              padding: '4px 9px',
              borderRadius: 999,
              background: 'var(--grad-cta)',
              color: 'var(--on-primary)',
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: '0.8px',
            }}
          >
            LISTED
          </div>
        )}
      </div>
      <NFTCardMeta nft={nft} onSellNFT={onSellNFT} onRemoveFromSale={onRemoveFromSale} />
    </div>
  );
}

function NFTCardMeta({
  nft,
  onSellNFT,
  onRemoveFromSale,
}: {
  nft: any;
  onSellNFT: (nft: any) => void;
  onRemoveFromSale: (nft: any) => void;
}) {
  return (
    <div style={{ padding: 10 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {nft.title || 'Untitled'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 4,
          minWidth: 0,
        }}
      >
        {nft.forSale && nft.price ? (
          <span
            className="mono"
            style={{
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              color: 'var(--primary)',
              fontWeight: 700,
            }}
          >
            {nft.price} {nft.currency || 'SOL'}
          </span>
        ) : (
          <span
            style={{
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              color: 'var(--text-faint)',
            }}
          >
            Not listed
          </span>
        )}
        {nft.forSale ? (
          <button
            onClick={e => { e.stopPropagation(); onRemoveFromSale(nft); }}
            style={{
              flex: '0 0 auto',
              fontSize: 11,
              color: 'var(--danger)',
              fontWeight: 700,
              maxWidth: 64,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Remove
          </button>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onSellNFT(nft); }}
            style={{
              flex: '0 0 auto',
              fontSize: 11,
              color: 'var(--primary)',
              fontWeight: 700,
              maxWidth: 44,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Sell
          </button>
        )}
      </div>
    </div>
  );
}

function BatchFolderCard({ batch, onOpen }: { batch: Extract<WalletEntry, { type: 'batch' }>; onOpen: () => void }) {
  const preview = batch.items[0];

  return (
    <button
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onClick={onOpen}
    >
      <div
        style={{
          height: 156,
          padding: 10,
          background: 'linear-gradient(180deg, var(--bg-soft) 0%, var(--bg-card) 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <img
          src={getNFTImage(preview)}
          alt={batch.name}
          loading="lazy"
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            borderRadius: 12,
            border: '1px solid rgba(12,20,16,0.08)',
            boxShadow: '0 8px 18px rgba(12,20,16,0.12)',
          }}
          onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
        />
        <div
          style={{
            position: 'absolute',
            zIndex: 3,
            top: 18,
            left: 18,
            padding: '4px 9px',
            borderRadius: 999,
            background: 'rgba(6,77,58,0.92)',
            color: 'white',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          FOLDER
        </div>
      </div>
      <div style={{ padding: '12px 12px 13px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 10,
            minWidth: 0,
          }}
        >
          <span
            style={{
              minWidth: 0,
              flex: '1 1 auto',
              fontSize: 15,
              lineHeight: 1.25,
              fontWeight: 800,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {batch.name}
          </span>
          <span
            style={{
              flex: '0 0 auto',
              fontSize: 12,
              lineHeight: 1,
              color: 'var(--primary-ink)',
              fontWeight: 800,
              background: 'var(--primary-faint)',
              border: '1px solid var(--primary-soft)',
              borderRadius: 999,
              padding: '6px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {batch.items.length} {batch.items.length === 1 ? 'NFT' : 'NFTs'}
          </span>
        </div>
      </div>
    </button>
  );
}

function BatchFolderView({
  batch,
  onClose,
  onNFTClick,
  onSellNFT,
  onRemoveFromSale,
}: {
  batch: Extract<WalletEntry, { type: 'batch' }>;
  onClose: () => void;
  onNFTClick: (nft: any) => void;
  onSellNFT: (nft: any) => void;
  onRemoveFromSale: (nft: any) => void;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <button
          aria-label="Back"
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--bg-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text)',
          }}
        >
          <Icon.ArrowLeft />
        </button>
        <div style={{ minWidth: 0, flex: 1, padding: '0 12px' }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {batch.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {batch.items.length} {batch.items.length === 1 ? 'item' : 'items'}
          </div>
        </div>
        <div style={{ width: 36, height: 36 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {batch.items.map(nft => (
          <NFTCard
            key={nft.id}
            nft={nft}
            onNFTClick={onNFTClick}
            onSellNFT={onSellNFT}
            onRemoveFromSale={onRemoveFromSale}
          />
        ))}
      </div>
    </div>
  );
}

export default WalletPage;
