import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Icon } from '../components/brand';
import { apiVerifyNfc, apiGetNFT, apiVerifyNFT } from '../services/apiClient';
import { useLanguage } from '../context/LanguageContext';

interface QrScannerPageProps {
    onClose: () => void;
}

interface NFTData {
    id: string;
    title: string;
    description?: string;
    image?: string;
    imageUrl?: string;
    attributes?: { trait_type: string; value: string }[];
    forSale?: boolean;
    price?: number;
    currency?: string;
    userId?: string;
    ownerId?: string;
    mintAddress?: string;
    metadataUri?: string;
    nfcUid?: string;
    tags?: string[];
    category?: string;
    blockchain?: string;
    royalty?: number;
    createdAt?: string;
}

type ScanSource = { kind: 'nft'; nftId: string; ownerId?: string; idenityPayload?: boolean } | { kind: 'nfc'; uid: string } | null;

const QrScannerPage: React.FC<QrScannerPageProps> = ({ onClose }) => {
    const { t } = useLanguage();
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animFrameRef = useRef<number>(0);

    const [scanning, setScanning] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [torchOn, setTorchOn] = useState(false);
    const [hasTorch, setHasTorch] = useState(false);

    // Result state
    const [source, setSource] = useState<ScanSource>(null);
    const [nft, setNft] = useState<NFTData | null>(null);
    const [ownerName, setOwnerName] = useState<string | null>(null);
    const [loadingNft, setLoadingNft] = useState(false);
    const [nftError, setNftError] = useState<string | null>(null);
    const [scanVerified, setScanVerified] = useState(false);
    const [issuedByIdenity, setIssuedByIdenity] = useState(false);
    const [issuerVerified, setIssuerVerified] = useState(false);
    const [issuerName, setIssuerName] = useState<string | null>(null);

    const stopCamera = useCallback(() => {
        if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = 0; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    }, []);

    const startCamera = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            streamRef.current = stream;
            const track = stream.getVideoTracks()[0];
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) setHasTorch(true);
            if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        } catch (e: any) {
            if (e.name === 'AbortError') return;
            if (e.name === 'NotAllowedError') setError(t('cameraDenied'));
            else if (e.name === 'NotFoundError') setError(t('cameraNotFound'));
            else setError(`Camera error: ${e.message}`);
        }
    }, [t]);

    const parseQr = useCallback((raw: string): ScanSource => {
        // JSON with nftId or collection
        try {
            const p = JSON.parse(raw);
            // Collection QR — use first item's nftId to show collection data
            if (p.type === 'collection' && p.itemIds?.length > 0) {
                return { kind: 'nft', nftId: p.itemIds[0], ownerId: p.ownerId, idenityPayload: p.issuer === 'idenity' };
            }
            // Single NFT QR (from collection item or standalone)
            if (p.type === 'nft' && (p.id || p.collectionId)) {
                return { kind: 'nft', nftId: p.id || p.collectionId, ownerId: p.ownerId, idenityPayload: p.issuer === 'idenity' };
            }
            if (p.nftId || p.id) return { kind: 'nft', nftId: p.nftId || p.id };
        } catch { /* not JSON */ }
        // NFC UID pattern
        if (/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){3,}$/.test(raw.trim()))
            return { kind: 'nfc', uid: raw.trim() };
        // URL with params or path
        try {
            const url = new URL(raw);
            const nfc = url.searchParams.get('nfc');
            const nftParam = url.searchParams.get('nft');
            const ownerId = url.searchParams.get('owner') || undefined;
            const idenityPayload = url.searchParams.get('issuer') === 'idenity';
            const pathMatch = url.pathname.match(/\/nft\/([^\/]+)/);
            if (nfc) return { kind: 'nfc', uid: nfc };
            if (nftParam) return { kind: 'nft', nftId: nftParam, ownerId, idenityPayload };
            if (pathMatch) return { kind: 'nft', nftId: pathMatch[1], ownerId, idenityPayload };
        } catch { /* not URL */ }
        return null;
    }, []);

    const scanFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
            animFrameRef.current = requestAnimationFrame(scanFrame);
            return;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

        if (code?.data) {
            const parsed = parseQr(code.data);
            if (parsed) {
                setSource(parsed);
                setScanning(false);
                stopCamera();
                return;
            }
        }
        animFrameRef.current = requestAnimationFrame(scanFrame);
    }, [parseQr, stopCamera]);

    // Start camera when scanning
    useEffect(() => {
        if (scanning) {
            startCamera().then(() => { animFrameRef.current = requestAnimationFrame(scanFrame); });
        }
        return () => stopCamera();
    }, [scanning, startCamera, scanFrame, stopCamera]);

    // Load NFT data when source is set
    useEffect(() => {
        if (!source) return;
        let cancelled = false;
        (async () => {
            setLoadingNft(true);
            setNftError(null);
            setNft(null);
            setOwnerName(null);
            setScanVerified(false);
            setIssuedByIdenity(false);
            setIssuerVerified(false);
            setIssuerName(null);
            try {
                if (source.kind === 'nft') {
                    if (source.idenityPayload && source.ownerId) {
                        const result = await apiVerifyNFT({ nftId: source.nftId, ownerId: source.ownerId });
                        if (!cancelled) {
                            setNft(result.nft);
                            setIssuedByIdenity(result.issuedByIdenity);
                            setIssuerVerified(result.issuerVerified);
                            setIssuerName(result.issuerName);
                            setScanVerified(result.issuedByIdenity);
                        }
                    } else {
                        const data = await apiGetNFT(source.nftId);
                        if (!cancelled) setNft(data);
                    }
                } else {
                    const verified = await apiVerifyNfc(source.uid);
                    if (!cancelled) {
                        setScanVerified(true);
                        setOwnerName(verified.ownerName);
                        const data = await apiGetNFT(verified.nftId);
                        if (!cancelled) setNft(data);
                    }
                }
            } catch (e: any) {
                if (!cancelled) setNftError(e?.message ?? 'Failed to load NFT');
            } finally {
                if (!cancelled) setLoadingNft(false);
            }
        })();
        return () => { cancelled = true; };
    }, [source]);

    const toggleTorch = async () => {
        if (!streamRef.current) return;
        const track = streamRef.current.getVideoTracks()[0];
        try { await (track as any).applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(!torchOn); } catch {}
    };

    const rescan = () => {
        setSource(null); setNft(null); setNftError(null); setOwnerName(null); setScanVerified(false);
        setIssuedByIdenity(false); setIssuerVerified(false); setIssuerName(null);
        setScanning(true);
    };

    const explorerUrl = nft?.mintAddress
        ? `https://explorer.solana.com/address/${nft.mintAddress}?cluster=devnet`
        : null;

    // ── Scanner view ──────────────────────────────────────────────────────
    if (scanning) {
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 2200, display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', zIndex: 10 }}>
                    <button onClick={() => { stopCamera(); onClose(); }} style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.1)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }} aria-label="Close">
                        <Icon.ArrowLeft size={20} />
                    </button>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>{t('qrScanner')}</h2>
                    <div style={{ width: 38 }} />
                </div>

                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    <video ref={videoRef} playsInline muted style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', minWidth: '100%', minHeight: '100%', objectFit: 'cover' }} />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    {/* Viewfinder */}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', maskImage: 'radial-gradient(ellipse 240px 240px at center, transparent 50%, black 51%)', WebkitMaskImage: 'radial-gradient(ellipse 240px 240px at center, transparent 50%, black 51%)' }} />
                        <div style={{ width: 240, height: 240, position: 'relative' }}>
                            {[
                                { top: 0, left: 0, borderTop: '3px solid #10b981', borderLeft: '3px solid #10b981' },
                                { top: 0, right: 0, borderTop: '3px solid #10b981', borderRight: '3px solid #10b981' },
                                { bottom: 0, left: 0, borderBottom: '3px solid #10b981', borderLeft: '3px solid #10b981' },
                                { bottom: 0, right: 0, borderBottom: '3px solid #10b981', borderRight: '3px solid #10b981' },
                            ].map((s, i) => (
                                <div key={i} style={{ position: 'absolute', width: 32, height: 32, ...s }} />
                            ))}
                            <div style={{ position: 'absolute', left: 8, right: 8, height: 2, background: 'linear-gradient(90deg, transparent, #10b981, transparent)', boxShadow: '0 0 12px rgba(16,185,129,0.6)', animation: 'qrScanLine 2s ease-in-out infinite' }} />
                        </div>
                    </div>

                    {/* Bottom */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 20px 40px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>{t('pointCamera')}</div>
                        {hasTorch && (
                            <button onClick={toggleTorch} style={{ padding: '10px 20px', borderRadius: 999, background: torchOn ? '#10b981' : 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
                                💡 {torchOn ? 'Turn Off' : 'Flashlight'}
                            </button>
                        )}
                    </div>

                    {error && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                            <div style={{ background: '#1a1f2e', border: '1px solid rgba(229,72,72,0.3)', borderRadius: 16, padding: 24, textAlign: 'center', maxWidth: 320 }}>
                                <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
                                <div style={{ color: '#e54848', fontWeight: 600, marginBottom: 8 }}>Camera Unavailable</div>
                                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>{error}</div>
                                <button onClick={() => { stopCamera(); onClose(); }} style={{ padding: '12px 24px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Close</button>
                            </div>
                        </div>
                    )}
                </div>

                <style>{`@keyframes qrScanLine { 0%, 100% { top: 8px; } 50% { top: calc(100% - 10px); } }`}</style>
            </div>
        );
    }

    // ── NFT Viewer (after scan) ────────────────────────────────────────────
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-page)', zIndex: 2200, display: 'flex', flexDirection: 'column', color: 'var(--text)' }}>
            {/* Top bar */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--bg-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }} aria-label="Back">
                    <Icon.ArrowLeft />
                </button>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Marki · Identity</div>
                <button onClick={rescan} style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-ink)' }} aria-label="Scan again">
                    <Icon.Scan size={18} />
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 40px' }}>
                {loadingNft && (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px' }} />
                        Loading...
                    </div>
                )}

                {!loadingNft && nftError && (
                    <div className="card" style={{ maxWidth: 400, margin: '40px auto', textAlign: 'center', padding: 24 }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
                        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Error</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px' }}>{nftError}</p>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                            <button onClick={rescan} className="btn btn-primary" style={{ padding: '10px 20px' }}>
                                <Icon.Scan size={16} /> Scan Again
                            </button>
                            <button onClick={onClose} className="btn" style={{ padding: '10px 20px' }}>Back</button>
                        </div>
                    </div>
                )}

                {!loadingNft && !nftError && nft && (
                    <>
                        {/* Verification summary */}
                        <div style={{ background: issuedByIdenity ? 'var(--primary-faint)' : 'rgba(217,119,6,.09)', border: `1px solid ${issuedByIdenity ? 'var(--primary-soft)' : 'rgba(217,119,6,.25)'}`, padding: 16, borderRadius: 16, marginBottom: 20 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 800, color: issuedByIdenity ? 'var(--primary-ink)' : 'var(--warn)', marginBottom: 10 }}>
                                {issuedByIdenity ? <Icon.Check size={20} /> : <Icon.Shield size={20} />}
                                {issuedByIdenity ? t('issuedByIdenity') : t('originNotVerified')}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{t('brandWallet')}</span>
                                <strong style={{ color: issuerVerified ? 'var(--primary)' : 'var(--warn)', textAlign: 'right' }}>
                                    {issuerVerified ? t('verified') : t('notVerified')}
                                </strong>
                            </div>
                            {issuerName && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('issuer')}: {issuerName}</div>}
                            {!issuerVerified && issuedByIdenity && (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>
                                    The NFT exists in Idenity, but the issuing brand has not completed company verification.
                                </div>
                            )}
                            {!issuedByIdenity && source?.kind === 'nft' && (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>
                                    This is a legacy or external QR. Do not treat it as proof of authenticity.
                                </div>
                            )}
                        </div>

                        {/* Image */}
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', maxWidth: 240, aspectRatio: '1 / 1', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {nft.imageUrl || nft.image ? (
                                <img src={nft.imageUrl || nft.image} alt={nft.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                            ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Image</span>
                            )}
                        </div>

                        {/* Title */}
                        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px', letterSpacing: '-0.02em' }}>{nft.title}</h1>

                        {/* Badges */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                            {nft.forSale && <Badge color="var(--primary)" bg="var(--primary-faint)">on sale · {nft.price} {nft.currency}</Badge>}
                            {nft.mintAddress && <Badge color="#42a5f5" bg="rgba(66,165,245,0.12)">on-chain</Badge>}
                            {nft.nfcUid && <Badge color="#42a5f5" bg="rgba(66,165,245,0.12)">NFC verified</Badge>}
                            {nft.category && <Badge color="var(--text-muted)" bg="var(--bg-soft)">{nft.category}</Badge>}
                            {scanVerified && <Badge color="var(--primary)" bg="var(--primary-faint)">scan OK ✓</Badge>}
                        </div>

                        {/* Description */}
                        {nft.description && (
                            <Section label="Description">
                                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{nft.description}</p>
                            </Section>
                        )}

                        {/* Tags */}
                        {nft.tags && nft.tags.length > 0 && (
                            <Section label="Tags">
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {nft.tags.map(t => (
                                        <span key={t} style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--bg-soft)', color: 'var(--text-muted)', fontSize: 12 }}>#{t}</span>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Metadata table */}
                        <Section label="Metadata">
                            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                                {nft.category && <MetaRow label="Category" value={nft.category} />}
                                {nft.blockchain && <MetaRow label="Blockchain" value={nft.blockchain} />}
                                {typeof nft.royalty === 'number' && <MetaRow label="Royalty" value={`${nft.royalty}%`} />}
                                {nft.currency && <MetaRow label="Currency" value={nft.currency} />}
                                {nft.forSale && nft.price !== undefined && <MetaRow label="Price" value={`${nft.price} ${nft.currency ?? ''}`} highlight />}
                                {nft.userId && <MetaRow label="Owner" value={ownerName || nft.userId} mono />}
                                {nft.createdAt && <MetaRow label="Created" value={new Date(nft.createdAt).toLocaleString()} />}
                            </div>
                        </Section>

                        {/* On-chain */}
                        {(nft.mintAddress || nft.nfcUid) && (
                            <Section label="On-chain">
                                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                                    {nft.mintAddress && <MetaRow label="Mint address" value={nft.mintAddress} mono href={explorerUrl ?? undefined} />}
                                    {nft.nfcUid && <MetaRow label="NFC UID" value={nft.nfcUid} mono />}
                                </div>
                            </Section>
                        )}

                        {/* Attributes */}
                        {nft.attributes && nft.attributes.length > 0 && (
                            <Section label="Attributes">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                                    {nft.attributes.map((a, i) => (
                                        <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                                            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-faint)', letterSpacing: '0.06em', marginBottom: 4 }}>{a.trait_type}</div>
                                            <div style={{ fontSize: 13, fontWeight: 500 }}>{a.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Actions */}
                        <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
                            <button onClick={rescan} style={{ flex: 1, padding: '14px 20px', borderRadius: 14, background: 'var(--primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                <Icon.Scan size={18} /> Scan Again
                            </button>
                            <button onClick={onClose} style={{ padding: '14px 20px', borderRadius: 14, background: 'var(--bg-soft)', color: 'var(--text)', border: 'none', fontWeight: 600, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer' }}>
                                ← Close
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Helpers ────────────────────────────────────────────────────────────────

function Badge({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
    return (
        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', background: bg, color }}>
            {children}
        </span>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 8, fontWeight: 600 }}>{label}</div>
            {children}
        </div>
    );
}

function MetaRow({ label, value, mono, href, highlight }: { label: string; value: string; mono?: boolean; href?: string; highlight?: boolean }) {
    const valStyle: React.CSSProperties = {
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
        fontSize: mono ? 12 : 14,
        color: highlight ? 'var(--primary)' : 'var(--text)',
        fontWeight: highlight ? 600 : 400,
        wordBreak: 'break-all',
    };
    const inner = <span style={valStyle}>{value}</span>;

    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</div>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
                {href ? <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{inner}</a> : inner}
            </div>
        </div>
    );
}

export default QrScannerPage;
