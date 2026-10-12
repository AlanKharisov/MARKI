import React, { useState, useRef } from 'react';
import { formatTime } from '../utils/formatters';
import { usePosts } from '../hooks/usePosts';
import { useAuth } from '../context/AuthContext';
import BuyModal from './BuyModal';
import HistoryView from './HistoryView';
import { getHistory, useViewHistory } from '../hooks/useViewHistory';
import { Icon } from '../components/brand';
import { useLanguage } from '../context/LanguageContext';

const DEFAULT_AVATAR = '/img/default-avatar.png';

const FILTER_OPTIONS = ['recommendations', 'mine', 'viewed', 'sale'] as const;

function HistoryIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CollectionGallery({ images, title }: { images: string[]; title: string }) {
  const previewImages = images.slice(0, 4);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 6,
        background: 'var(--bg-soft)',
        padding: 6,
      }}
    >
      {previewImages.map((src, idx) => (
        <img
          key={idx}
          src={src || '/img/default-nft.png'}
          alt={`${title} #${idx + 1}`}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            objectFit: 'cover',
            borderRadius: 11,
            display: 'block',
            gridColumn: previewImages.length === 1 ? '1 / -1' : undefined,
            gridRow: previewImages.length === 1 ? '1 / -1' : previewImages.length === 3 && idx === 0 ? '1 / 3' : undefined,
          }}
          onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          top: 12, left: 12, zIndex: 2,
          background: 'rgba(6,77,58,0.9)',
          backdropFilter: 'blur(10px)',
          color: 'white',
          borderRadius: 999,
          padding: '5px 10px',
          fontSize: 12,
          fontWeight: 800,
          pointerEvents: 'none',
        }}
      >
        {images.length} NFTs
      </div>
    </div>
  );
}

const HomePage: React.FC = () => {
  const { posts, loading, likePost, addComment, refreshPosts } = usePosts();
  const { currentUser } = useAuth();
  const { language } = useLanguage();

  const [searchQuery, setSearchQuery] = useState('');
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const [buyNft, setBuyNft] = useState<any | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<typeof FILTER_OPTIONS[number]>('recommendations');
  const filterRef = useRef<HTMLDivElement>(null);

  const { attachObserver } = useViewHistory();

  const filteredPosts = posts
    .filter(post => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || (
        post.title?.toLowerCase().includes(q) ||
        post.description?.toLowerCase().includes(q) ||
        post.userName?.toLowerCase().includes(q) ||
        post.tags?.some(tag => tag.toLowerCase().includes(q))
      );
      let matchesFilter = true;
      if (activeFilter === 'mine') matchesFilter = post.userId === currentUser?.uid;
      else if (activeFilter === 'viewed') matchesFilter = getHistory().includes(post.id);
      else if (activeFilter === 'sale') matchesFilter = !!post.forSale;
      return matchesSearch && matchesFilter;
    });

  const handleLike = async (post: any) => {
    if (!post.id || !currentUser) return;
    await likePost(post.id);
  };

  const handleAddComment = async (post: any) => {
    const text = (newComment[post.id] || '').trim();
    if (!text || !currentUser || !post.id) return;
    await addComment(post.id, text);
    setNewComment(prev => ({ ...prev, [post.id]: '' }));
  };

  const handleBuySuccess = () => { setBuyNft(null); refreshPosts(); };

  if (loading) {
    return (
      <div className="page home-page active mi-screen-pad" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', paddingBottom: 100 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 15px' }} />
          <p className="muted">{language === 'uk' ? 'Завантаження NFT…' : 'Loading NFTs…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page home-page active mi-screen-pad" style={{ paddingTop: 18, paddingBottom: 148 }}>
      {/* Marketplace header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <h1 className="hero-title">Market<br /><span className="accent">place</span></h1>
          <button
            onClick={() => setHistoryOpen(true)}
            className="icon-btn-round"
            aria-label="View history"
          >
            <HistoryIcon size={18} />
          </button>
        </div>
        <div
          style={{
            marginTop: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 16,
            padding: '13px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--text-faint)',
            fontSize: 13.5,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Icon.Search size={17} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search NFTs, creators…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 13.5,
              padding: 0,
            }}
          />
        </div>
      </div>

      {/* Category chips */}
      <div ref={filterRef} className="scrollx" style={{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 2 }}>
        {FILTER_OPTIONS.map(opt => (
          <span
            key={opt}
            onClick={() => setActiveFilter(opt)}
            className={`chip ${activeFilter === opt ? 'chip-active' : ''}`}
          >
            {language === 'uk'
              ? ({ recommendations: 'Рекомендації', mine: 'Мої', viewed: 'Переглянуті', sale: 'На продаж' } as const)[opt]
              : ({ recommendations: 'Recommendations', mine: 'My', viewed: 'Viewed', sale: 'For sale' } as const)[opt]}
          </span>
        ))}
      </div>

      {/* Feed */}
      {filteredPosts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎨</div>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>No NFTs found</p>
          <p className="muted" style={{ fontSize: 13 }}>Try a different search or filter</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredPosts.map(post => (
            <div
              key={post.id}
              className="card"
              ref={el => { if (el && post.id) attachObserver(el, post.id); }}
              style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}
            >
              <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg-soft)' }}>
                {post.nftImages && post.nftImages.length > 0 ? (
                  <CollectionGallery images={post.nftImages} title={post.title} />
                ) : (
                  <img
                    src={post.nftImage || '/img/default-nft.png'}
                    alt={post.title}
                    loading="lazy"
                    style={{
                      width: '100%',
                      aspectRatio: '4 / 3',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-nft.png'; }}
                  />
                )}
                {post.forSale && post.price && (
                  <div
                    className="mono"
                    style={{
                      position: 'absolute',
                      top: 12, right: 12,
                      padding: '6px 11px',
                      borderRadius: 999,
                      background: 'rgba(6,77,58,0.9)',
                      backdropFilter: 'blur(10px)',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {post.price} {post.currency || 'SOL'}
                  </div>
                )}
              </div>

              <div style={{ padding: 13 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 17,
                        lineHeight: 1.25,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {post.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, minWidth: 0 }}>
                      <div className="avatar" style={{ width: 24, height: 24, fontSize: 11 }}>
                        {post.userAvatar ? (
                          <img
                            src={post.userAvatar}
                            alt="Avatar"
                            onError={e => { const img = e.currentTarget as HTMLImageElement; img.onerror = null; img.src = DEFAULT_AVATAR; }}
                          />
                        ) : (
                          (post.userName || '?').slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {post.userName || 'Unknown creator'}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    marginTop: 12,
                    paddingTop: 11,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                      {post.forSale && post.price ? 'Price' : 'Status'}
                    </div>
                    <div
                      className={post.forSale && post.price ? 'price' : undefined}
                      style={{
                        marginTop: 2,
                        fontSize: post.forSale && post.price ? 20 : 14,
                        fontWeight: post.forSale && post.price ? 700 : 800,
                        color: post.forSale && post.price ? undefined : 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {post.forSale && post.price ? `${post.price} ${post.currency || 'SOL'}` : 'Not listed'}
                    </div>
                  </div>

                  {post.forSale && post.price && post.userId !== currentUser?.uid ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => setBuyNft(post)}
                      style={{ padding: '11px 20px', fontSize: 14, fontWeight: 800, flex: '0 0 auto', minWidth: 104 }}
                    >
                      Buy now
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={() => post.id && setSelectedPost(selectedPost === post.id ? null : post.id)}
                      style={{ padding: '11px 20px', fontSize: 14, fontWeight: 800, flex: '0 0 auto', minWidth: 104 }}
                    >
                      View item
                    </button>
                  )}
                </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, alignItems: 'center', color: 'var(--text-faint)' }}>
                  <span
                    onClick={() => handleLike(post)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      color: post.liked ? 'var(--danger)' : 'inherit',
                    }}
                  >
                    <Icon.Heart filled={post.liked} size={16} /> {post.likes || 0}
                  </span>
                  <span
                    onClick={() => post.id && setSelectedPost(selectedPost === post.id ? null : post.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <Icon.Comment size={16} /> {post.comments?.length || 0}
                  </span>
                  <span
                    onClick={() =>
                      navigator.share?.({
                        title: post.title,
                        text: post.description,
                        url: window.location.href,
                      }).catch(() => {})
                    }
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <Icon.Share size={16} />
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
                    {formatTime(post.createdAt)}
                  </span>
                </div>
              </div>

              {selectedPost === post.id && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={newComment[post.id || ''] || ''}
                      onChange={e =>
                        setNewComment(prev => ({ ...prev, [post.id!]: e.target.value }))
                      }
                      onKeyUp={e => { if (e.key === 'Enter') handleAddComment(post); }}
                      placeholder="Write a comment…"
                      style={{
                        flex: 1,
                        background: 'var(--bg-soft)',
                        border: 'none',
                        borderRadius: 12,
                        padding: '10px 12px',
                        fontSize: 13,
                        outline: 'none',
                        color: 'var(--text)',
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => handleAddComment(post)}
                      style={{ padding: '0 14px', fontSize: 13 }}
                    >
                      Post
                    </button>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {post.comments?.map((c: any) => (
                      <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                          {c.userAvatar ? (
                            <img src={c.userAvatar} alt="" />
                          ) : (
                            (c.userName || '?').slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{c.userName}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{c.text}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                            {formatTime(c.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          ))}
        </div>
      )}

      {historyOpen && (
        <>
          <div
            onClick={() => setHistoryOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 3000,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: 0, right: 0, bottom: 0,
              width: 320,
              maxWidth: '100%',
              background: 'var(--bg-card)',
              zIndex: 3001,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '18px 16px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span className="h3">View history</span>
              <button
                onClick={() => setHistoryOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'var(--bg-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text)',
                }}
                aria-label="Close"
              >
                <Icon.X />
              </button>
            </div>
            <HistoryView onClose={() => setHistoryOpen(false)} />
          </div>
        </>
      )}

      {buyNft && (
        <BuyModal
          nft={buyNft}
          onClose={() => setBuyNft(null)}
          onSuccess={handleBuySuccess}
        />
      )}
    </div>
  );
};

export default HomePage;
