import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Icon } from '../components/brand';

interface NFT {
  id: string;
  title: string;
  description: string;
  image: string;
  ownerId?: string;
  userId?: string;
  ownerName: string;
  price?: number;
  currency?: string;
  blockchain?: string;
  royalty?: number;
  tags?: string[];
  category?: string;
  forSale?: boolean;
  createdAt?: string;
  // Collection fields
  nftImages?: string[];
  walletNftIds?: string[];
}

interface NFTViewerPageProps {
  nft: NFT;
  onClose: () => void;
}

const NFTViewerPage: React.FC<NFTViewerPageProps> = ({ nft, onClose }) => {
  const [scale, setScale] = useState(1);
  const [showQR, setShowQR] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');

  // Collection state
  const isCollection = !!(nft.nftImages && nft.nftImages.length > 1);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [itemQrUrls, setItemQrUrls] = useState<string[]>([]);
  const [collectionQrUrl, setCollectionQrUrl] = useState('');
  const [qrMode, setQrMode] = useState<'collection' | 'item'>('collection');

  useEffect(() => {
    if (isCollection) {
      generateCollectionQRCodes();
    } else {
      generateQRCode();
    }
  }, [nft]); // eslint-disable-line

  const generateQRCode = async () => {
    try {
      // Create a standard URL so regular phone cameras can scan and open it natively
      const baseUrl = window.location.origin + (window.location.pathname.includes('/idenity') ? '/idenity' : '');
      const qrData = `${baseUrl}/nft/${nft.id}?issuer=idenity&owner=${encodeURIComponent(nft.ownerId || nft.userId || '')}&v=1`;
      const url = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: { dark: '#0a0a0a', light: '#ffffff' },
      });
      setQrCodeUrl(url);
    } catch (error) {
      console.error('Error generating QR:', error);
    }
  };

  const generateCollectionQRCodes = async () => {
    try {
      const baseUrl = window.location.origin + (window.location.pathname.includes('/idenity') ? '/idenity' : '');
      // Collection-level QR (links to first item)
      const firstItemId = (nft.walletNftIds && nft.walletNftIds.length > 0) ? nft.walletNftIds[0] : nft.id;
      const ownerId = encodeURIComponent(nft.ownerId || nft.userId || '');
      const collectionData = `${baseUrl}/nft/${firstItemId}?issuer=idenity&owner=${ownerId}&v=1`;
      const collQr = await QRCode.toDataURL(collectionData, {
        width: 300, margin: 2,
        color: { dark: '#0a0a0a', light: '#ffffff' },
      });
      setCollectionQrUrl(collQr);

      // Per-item QR codes
      const ids = nft.walletNftIds || [];
      const urls: string[] = [];
      for (let i = 0; i < (nft.nftImages?.length || 0); i++) {
        const itemId = ids[i] || `${nft.id}_item_${i}`;
        const itemData = `${baseUrl}/nft/${itemId}?issuer=idenity&owner=${ownerId}&v=1`;
        const url = await QRCode.toDataURL(itemData, {
          width: 300, margin: 2,
          color: { dark: '#0a0a0a', light: '#ffffff' },
        });
        urls.push(url);
      }
      setItemQrUrls(urls);
    } catch (error) {
      console.error('Error generating collection QR codes:', error);
    }
  };

  const handleZoomIn = () => setScale(p => Math.min(p + 0.25, 3));
  const handleZoomOut = () => setScale(p => Math.max(p - 0.25, 0.5));
  const handleResetZoom = () => setScale(1);

  const currentQrUrl = isCollection
    ? (qrMode === 'collection' ? collectionQrUrl : itemQrUrls[activeImageIdx] || '')
    : qrCodeUrl;

  const currentQrLabel = isCollection
    ? (qrMode === 'collection'
      ? `Collection · ${nft.nftImages?.length} NFTs`
      : `NFT #${activeImageIdx + 1} of ${nft.nftImages?.length}`)
    : 'SCAN TO VERIFY';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-page)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--text)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: 'var(--bg-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text)',
          }}
          aria-label="Close"
        >
          <Icon.ArrowLeft />
        </button>
        <div style={{ textAlign: 'center', minWidth: 0, flex: 1, padding: '0 12px' }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nft.title}
            {isCollection && (
              <span style={{ fontSize: 12, color: 'var(--primary)', marginLeft: 6, fontWeight: 600 }}>
                📚 Collection
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            #{(nft.id || '').slice(0, 8)}
          </div>
        </div>
        <button
          onClick={() => setShowQR(v => !v)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: showQR ? 'var(--primary)' : 'var(--primary-soft)',
            color: showQR ? 'white' : 'var(--primary-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Toggle QR"
        >
          <Icon.QR size={18} />
        </button>
      </div>

      {/* Main */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: 'linear-gradient(180deg, var(--bg-page) 0%, var(--bg-soft) 100%)',
          overflow: 'auto',
        }}
      >
        {!showQR ? (
          /* ── Image view ── */
          isCollection ? (
            /* Collection gallery */
            <div style={{ width: '100%', maxWidth: 400 }}>
              <div
                style={{
                  borderRadius: 24,
                  overflow: 'hidden',
                  boxShadow: '0 20px 60px -20px rgba(16,185,129,0.25), 0 4px 12px rgba(0,0,0,0.08)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  padding: 12,
                }}
              >
                <img
                  src={nft.nftImages![activeImageIdx] || '/img/default-nft.png'}
                  alt={`${nft.title} #${activeImageIdx + 1}`}
                  style={{
                    transform: `scale(${scale})`,
                    transition: 'transform 0.3s ease',
                    width: '100%',
                    maxHeight: '50vh',
                    objectFit: 'contain',
                    transformOrigin: 'center',
                    borderRadius: 16,
                    display: 'block',
                  }}
                  onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
                />
              </div>
              {/* Thumbnail strip */}
              <div style={{
                display: 'flex', gap: 8, marginTop: 12,
                overflowX: 'auto', padding: '4px 0',
                justifyContent: nft.nftImages!.length <= 5 ? 'center' : 'flex-start',
              }}>
                {nft.nftImages!.map((img, i) => (
                  <img
                    key={i}
                    src={img || '/img/default-nft.png'}
                    alt={`#${i + 1}`}
                    onClick={() => { setActiveImageIdx(i); setScale(1); }}
                    style={{
                      width: 52, height: 52,
                      borderRadius: 10,
                      objectFit: 'cover',
                      cursor: 'pointer',
                      flexShrink: 0,
                      border: activeImageIdx === i
                        ? '2px solid var(--primary)'
                        : '2px solid transparent',
                      opacity: activeImageIdx === i ? 1 : 0.6,
                      transition: 'all 0.2s',
                    }}
                    onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
                  />
                ))}
              </div>
              <div className="mono" style={{
                textAlign: 'center', fontSize: 12,
                color: 'var(--text-muted)', marginTop: 6,
              }}>
                {activeImageIdx + 1} / {nft.nftImages!.length}
              </div>
            </div>
          ) : (
            /* Single NFT image */
            <div
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 24,
                overflow: 'hidden',
                boxShadow: '0 20px 60px -20px rgba(16,185,129,0.25), 0 4px 12px rgba(0,0,0,0.08)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                padding: 12,
              }}
            >
              <img
                src={nft.image}
                alt={nft.title}
                style={{
                  transform: `scale(${scale})`,
                  transition: 'transform 0.3s ease',
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  transformOrigin: 'center',
                  borderRadius: 16,
                  display: 'block',
                }}
              />
            </div>
          )
        ) : (
          /* ── QR view ── */
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {/* QR mode toggle for collections */}
            {isCollection && (
              <div style={{
                display: 'flex', gap: 4,
                background: 'var(--bg-soft)', borderRadius: 10, padding: 4,
                width: '100%',
              }}>
                <button
                  onClick={() => setQrMode('collection')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    border: 'none', cursor: 'pointer',
                    background: qrMode === 'collection' ? 'var(--primary)' : 'transparent',
                    color: qrMode === 'collection' ? 'white' : 'var(--text-muted)',
                  }}
                >
                  📚 Collection QR
                </button>
                <button
                  onClick={() => setQrMode('item')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    border: 'none', cursor: 'pointer',
                    background: qrMode === 'item' ? 'var(--primary)' : 'transparent',
                    color: qrMode === 'item' ? 'white' : 'var(--text-muted)',
                  }}
                >
                  🖼 NFT #{activeImageIdx + 1} QR
                </button>
              </div>
            )}

            {/* Item selector (only in item mode for collections) */}
            {isCollection && qrMode === 'item' && (
              <div style={{
                display: 'flex', gap: 6, overflowX: 'auto', width: '100%',
                padding: '4px 0',
                justifyContent: nft.nftImages!.length <= 5 ? 'center' : 'flex-start',
              }}>
                {nft.nftImages!.map((img, i) => (
                  <img
                    key={i}
                    src={img || '/img/default-nft.png'}
                    alt={`#${i + 1}`}
                    onClick={() => setActiveImageIdx(i)}
                    style={{
                      width: 44, height: 44,
                      borderRadius: 8,
                      objectFit: 'cover',
                      cursor: 'pointer',
                      flexShrink: 0,
                      border: activeImageIdx === i
                        ? '2px solid var(--primary)'
                        : '2px solid transparent',
                      opacity: activeImageIdx === i ? 1 : 0.5,
                    }}
                    onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
                  />
                ))}
              </div>
            )}

            {/* QR code card */}
            <div
              style={{
                background: 'white',
                padding: 20,
                borderRadius: 24,
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                boxShadow: 'var(--shadow-lg)',
                width: '100%',
              }}
            >
              {currentQrUrl ? (
                <img src={currentQrUrl} alt="QR Code" style={{ width: 240, height: 240, display: 'block' }} />
              ) : (
                <div className="spinner" />
              )}
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: '#666',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {currentQrLabel}
              </div>
              {currentQrUrl && (
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    const suffix = isCollection
                      ? (qrMode === 'collection' ? 'collection' : `item-${activeImageIdx + 1}`)
                      : nft.id;
                    link.download = `nft-${suffix}-qr.png`;
                    link.href = currentQrUrl;
                    link.click();
                  }}
                  className="btn btn-primary"
                  style={{ marginTop: 6, fontSize: 13, padding: '8px 16px' }}
                >
                  Download QR
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      {!showQR && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 20px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              borderRadius: 999,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <button
              onClick={handleZoomOut}
              style={{
                width: 32, height: 32,
                borderRadius: 999,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Zoom out"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16 }}>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5M8 11h6" />
              </svg>
            </button>
            <span
              className="mono"
              style={{
                fontSize: 12,
                fontWeight: 600,
                minWidth: 44,
                textAlign: 'center',
              }}
            >
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              style={{
                width: 32, height: 32,
                borderRadius: 999,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Zoom in"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16 }}>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
              </svg>
            </button>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
            <button
              onClick={handleResetZoom}
              style={{
                width: 32, height: 32,
                borderRadius: 999,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Reset zoom"
            >
              <Icon.Refresh size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: '14px 20px 18px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
            >
              Owner
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{nft.ownerName}</div>
          </div>
          {isCollection && (
            <div style={{ textAlign: 'center' }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                Items
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>
                {nft.nftImages?.length} NFTs
              </div>
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
            >
              Created
            </div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {nft.createdAt ? new Date(nft.createdAt).toLocaleDateString() : 'Today'}
            </div>
          </div>
          {nft.price && (
            <div style={{ textAlign: 'right' }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                Price
              </div>
              <div
                className="mono"
                style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}
              >
                {nft.price} {nft.currency || 'SOL'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NFTViewerPage;
