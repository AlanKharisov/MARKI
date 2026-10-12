import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
    apiCashOnDelivery,
    apiAddCryptoWallet,
    apiGetCryptoWallets,
    apiGetPaymentQuote,
    apiTransferNFT,
    PaymentQuote,
} from '../services/apiClient';
import {
    connectPhantomWallet,
    signAndSendPhantomTransaction,
} from '../services/phantomWallet';

// Solana cluster the on-chain transfer should hit. Must match the cluster
// useUmi mints on (devnet by default) so wallets line up. Override with
// REACT_APP_SOLANA_RPC_URL in identity/.env.local if you move to mainnet.
const SOLANA_RPC_URL =
    process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

interface BuyModalProps {
    nft: any;
    onClose: () => void;
    onSuccess?: (boughtNft: any) => void;
}

type PaymentMethod = 'crypto' | 'cod';

const BuyModal: React.FC<BuyModalProps> = ({ nft, onClose, onSuccess }) => {
    const { currentUser } = useAuth();
    const nftCurrency = String(nft.currency || 'SOL').toUpperCase();
    const cryptoSupported = ['SOL', 'UAH', 'USD'].includes(nftCurrency);
    const [wallets, setWallets]                     = useState<any[]>([]);
    const [selectedWalletId, setSelectedWalletId]   = useState('');
    const [loading, setLoading]                     = useState(true);
    const [quote, setQuote]                         = useState<PaymentQuote | null>(null);
    const [quoteError, setQuoteError]               = useState('');
    const [connectingWallet, setConnectingWallet]   = useState(false);
    const [buying, setBuying]                       = useState(false);
    const [paymentMethod, setPaymentMethod]         = useState<PaymentMethod>(
        cryptoSupported ? 'crypto' : 'cod'
    );
    const [fiatCurrency, setFiatCurrency]           = useState<'UAH' | 'USD' | 'SOL'>('UAH');
    const [fullName, setFullName]                   = useState(currentUser?.name ?? '');
    const [phone, setPhone]                         = useState(currentUser?.phone ?? '');

    const nftPrice    = Number(nft.price) || 0;
    const transferableNftId =
        nft.walletNftId ||
        (Array.isArray(nft.walletNftIds) ? nft.walletNftIds[0] : '') ||
        '';
    const sellerAmountSol = (quote?.sellerLamports || 0) / LAMPORTS_PER_SOL;
    const feeSol = (quote?.feeLamports || 0) / LAMPORTS_PER_SOL;
    const totalSol = (quote?.totalLamports || 0) / LAMPORTS_PER_SOL;

    useEffect(() => {
        (async () => {
            if (!currentUser) { setLoading(false); return; }
            const [walletResult, quoteResult] = await Promise.allSettled([
                apiGetCryptoWallets(),
                transferableNftId && cryptoSupported
                    ? apiGetPaymentQuote(transferableNftId, nft.id)
                    : Promise.reject(new Error('This listing is not available for Phantom payment')),
            ]);

            if (walletResult.status === 'fulfilled') {
                const all = walletResult.value || [];
                setWallets(all);
                if (all.length > 0) setSelectedWalletId(all[0].id);
            } else {
                console.error('Failed to load wallets:', walletResult.reason);
            }

            if (quoteResult.status === 'fulfilled') {
                setQuote(quoteResult.value);
                setQuoteError('');
            } else {
                console.error('Failed to create payment quote:', quoteResult.reason);
                setQuoteError(
                    quoteResult.reason instanceof Error
                        ? quoteResult.reason.message
                        : 'SOL quote is currently unavailable'
                );
            }
            setLoading(false);
        })();
    }, [currentUser, cryptoSupported, nft.id, transferableNftId]);

    const selectedWallet = wallets.find(w => w.id === selectedWalletId);
    const hasFunds = Boolean(
        quote && selectedWallet && (Number(selectedWallet.balance) || 0) >= totalSol
    );

    const handleConnectWallet = async () => {
        if (!currentUser) return;
        setConnectingWallet(true);
        try {
            const address = await connectPhantomWallet(true);
            await apiAddCryptoWallet({ address, label: 'Phantom' });
            const all = await apiGetCryptoWallets();
            setWallets(all || []);
            const connected = all?.find(wallet => wallet.address === address) || all?.[0];
            if (connected) setSelectedWalletId(connected.id);
        } catch (error: any) {
            alert(`Could not connect Phantom: ${error?.message || error}`);
        } finally {
            setConnectingWallet(false);
        }
    };

    const handleBuyCrypto = async () => {
        if (!currentUser || !selectedWalletId || !selectedWallet) return;
        if (!cryptoSupported) {
            alert(`Crypto payment is unavailable for listings priced in ${nftCurrency}. Use Pay on Delivery.`);
            return;
        }
        if (!quote) {
            alert('The SOL quote is unavailable. Close this window and try again.');
            return;
        }
        if (quote.expiresAtUnix <= Math.floor(Date.now() / 1000)) {
            alert('The SOL quote expired. Close this window and open Buy now again.');
            return;
        }
        if (!hasFunds) {
            alert(`Insufficient balance. You need ${totalSol.toFixed(6)} SOL.`);
            return;
        }
        if (!transferableNftId) {
            alert('This listing has no transferable NFT ID. Ask the seller to relist it.');
            return;
        }

        const sellerAddress: string | undefined = (nft as any).sellerAddress;
        if (!sellerAddress) {
            alert('❌ Seller wallet address is unavailable — cannot execute on-chain transfer.');
            return;
        }

        setBuying(true);
        try {
            // ── Step 1: Authorize Phantom ──────────────────────────────────────
            // Capacitor uses Phantom's encrypted mobile deep-link protocol;
            // regular browsers use the injected extension provider.
            let phantomKey = await connectPhantomWallet(false);
            if (phantomKey !== selectedWallet.address) {
                // Let the user switch to the wallet selected in this modal.
                phantomKey = await connectPhantomWallet(true);
            }

            // ── Step 2: On-chain SOL transfer ──────────────────────────────────
            console.log('[Buy] connecting to', SOLANA_RPC_URL);
            const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

            const sellerLamports = quote.sellerLamports;
            const feeLamports = quote.feeLamports;
            const fromPubkey = new PublicKey(phantomKey);
            const toPubkey   = new PublicKey(sellerAddress);
            const treasuryPubkey = new PublicKey('2wZ2vKzRzY7ZxkRTRgTKVBDBVTqk1NfvGbQFgDxJAr9X');

            // Phantom must sign with the backend wallet selected for payment.
            if (phantomKey !== selectedWallet.address) {
                throw new Error(
                    `Phantom is unlocked for ${phantomKey.slice(0, 8)}…, but you selected wallet ${selectedWallet.address.slice(0, 8)}…. Switch accounts in Phantom and retry.`
                );
            }

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            const tx = new Transaction().add(
                SystemProgram.transfer({ fromPubkey, toPubkey, lamports: sellerLamports })
            );
            if (feeLamports > 0) {
                tx.add(SystemProgram.transfer({
                    fromPubkey,
                    toPubkey: treasuryPubkey,
                    lamports: feeLamports,
                }));
            }
            tx.recentBlockhash = blockhash;
            tx.feePayer = fromPubkey;

            console.log('[Buy] requesting signature for', sellerLamports + feeLamports, 'lamports');
            const signature = await signAndSendPhantomTransaction(tx, connection);
            console.log('[Buy] tx submitted:', signature);
            await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
            console.log('[Buy] tx confirmed');

            // ── Step 3: Sync off-chain Firestore state ─────────────────────────
            const sellerId    = nft.userId;
            const postId      = nft.id;

            await apiTransferNFT(
                transferableNftId,
                sellerId,
                postId,
                signature,
                phantomKey,
                quote.quoteId,
            );

            // ── Step 4: Update local UI ────────────────────────────────────────
            onSuccess?.({ ...nft, forSale: false, ownerId: currentUser.uid, ownerName: currentUser.email });
            onClose();
            alert(
                `✅ Покупка завершена!\n\n` +
                `NFT: ${nft.title}\nОплачено: ${totalSol.toFixed(6)} SOL через Phantom\n` +
                `TX: ${signature}\n\nNFT в твоём кошельке, продавец получил уведомление.`
            );
        } catch (err: any) {
            console.error('[Buy] error:', err);
            // 4001 = Phantom user-rejected.
            if (err?.code === 4001) {
                alert('Транзакция отменена в Phantom.');
            } else {
                alert(`❌ Ошибка покупки: ${err?.message ?? err}`);
            }
        } finally {
            setBuying(false);
        }
    };

    const handleCashOnDelivery = async () => {
        if (!currentUser) return;
        if (!transferableNftId) { alert('This listing has no transferable NFT ID.'); return; }
        if (!fullName.trim())        { alert('Please enter your full name.');     return; }
        if (!phone.trim())           { alert('Please enter your phone number.'); return; }
        setBuying(true);
        try {
            await apiCashOnDelivery({
                postId:          nft.id,
                nftId:           transferableNftId,
                deliveryAddress: 'COD',
                currency:        fiatCurrency,
                fullName:        fullName.trim(),
                phone:           phone.trim(),
            });
            onSuccess?.(nft);
            onClose();
            alert(`✅ Order placed! Seller will contact you for delivery.`);
        } catch (err: any) {
            console.error('COD error:', err);
            alert(`❌ Error: ${err.message}`);
        } finally {
            setBuying(false);
        }
    };

    return (
        <div style={s.overlay} onClick={onClose}>
            <style>{`
                @media(min-width:600px){
                    .buy-modal-sheet{border-radius:16px!important;align-self:center!important;margin:auto!important;}
                }
                @media(max-width:380px){
                    .buy-method-tab{font-size:11px!important;padding:8px 6px!important;}
                }
            `}</style>
            <div style={s.sheet} onClick={e => e.stopPropagation()}>
                <div style={s.handle} />

                <div style={s.header}>
                    <h2 style={s.title}>Purchase NFT</h2>
                    <button style={s.closeBtn} onClick={onClose}>✕</button>
                </div>

                {/* NFT preview */}
                <div style={s.nftRow}>
                    <img
                        src={nft.nftImage || nft.image || '/img/default-nft.png'}
                        alt={nft.title}
                        style={s.nftImg}
                        onError={e => { e.currentTarget.src = '/img/default-nft.png'; }}
                    />
                    <div style={s.nftInfo}>
                        <div style={s.nftTitle}>{nft.title}</div>
                        <div style={s.nftAuthor}>by {nft.ownerName || nft.userName || 'Unknown'}</div>
                        <div style={s.nftPrice}>{nftPrice} {nftCurrency}</div>
                    </div>
                </div>

                {/* Payment method tabs */}
                <div style={s.methodTabs}>
                    {cryptoSupported && (
                        <button
                            style={{ ...s.methodTab, background: paymentMethod === 'crypto' ? '#01ff77' : '#f0f0f0', color: paymentMethod === 'crypto' ? 'black' : '#666' }}
                            onClick={() => setPaymentMethod('crypto')}
                        >
                            👻 Pay with Phantom
                        </button>
                    )}
                    <button
                        style={{
                            ...s.methodTab,
                            flex: cryptoSupported ? 1 : '1 1 100%',
                            background: paymentMethod === 'cod' ? '#01ff77' : '#f0f0f0',
                            color: paymentMethod === 'cod' ? 'black' : '#666',
                        }}
                        onClick={() => setPaymentMethod('cod')}
                    >
                        🚚 Pay on Delivery
                    </button>
                </div>

                {/* Recipient details — required for COD, optional for crypto. */}
                {paymentMethod === 'cod' && (
                    <>
                        <div style={{ marginBottom: '10px' }}>
                            <label style={s.label}>👤 Full Name *</label>
                            <input
                                style={s.addrInput}
                                placeholder="Recipient's full name (for the parcel)"
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                            />
                        </div>
                        <div style={{ marginBottom: '10px' }}>
                            <label style={s.label}>📞 Phone *</label>
                            <input
                                style={s.addrInput}
                                placeholder="+380…"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                            />
                        </div>
                    </>
                )}

                

                {/* ── CRYPTO FLOW ─────────────────────────────────────── */}
                {paymentMethod === 'crypto' && (
                    loading ? (
                        <div style={s.center}>
                            <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
                            <div style={s.spinner} />
                        </div>
                    ) : quoteError ? (
                        <div style={s.errorBox}>
                            <div style={{ fontSize: '28px', marginBottom: '8px' }}>◎</div>
                            <strong>SOL quote unavailable</strong>
                            <div style={{ fontSize: '12px', color: '#888', marginTop: '6px', lineHeight: 1.45 }}>
                                {quoteError}
                            </div>
                        </div>
                    ) : wallets.length === 0 ? (
                        <>
                            <div style={s.connectBox}>
                                <div style={{ fontSize: '30px', marginBottom: '8px' }}>👻</div>
                                <strong>Connect Phantom to pay</strong>
                                <div style={{ fontSize: '12px', color: '#777', margin: '6px 0 14px', lineHeight: 1.45 }}>
                                    The app will open Phantom so you can approve your wallet and payment.
                                </div>
                                <button
                                    style={s.connectBtn}
                                    onClick={handleConnectWallet}
                                    disabled={connectingWallet}
                                >
                                    {connectingWallet ? 'Opening Phantom…' : '👻 Connect Phantom'}
                                </button>
                            </div>
                            <div style={s.summary}>
                                <div style={s.row}>
                                    <span style={{ color: '#888' }}>Listed price</span>
                                    <span style={{ color: '#888' }}>{nftPrice} {nftCurrency}</span>
                                </div>
                                <div style={s.row}>
                                    <span style={{ color: '#888' }}>Total in Phantom</span>
                                    <strong style={{ color: '#00b85c' }}>{totalSol.toFixed(6)} SOL</strong>
                                </div>
                                <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
                                    Includes the 1% platform fee. Quote is fixed for 10 minutes.
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <label style={s.label}>Pay with:</label>
                            <div style={s.walletList}>
                                {wallets.map(w => (
                                    <div
                                        key={w.id}
                                        style={{
                                            ...s.walletCard,
                                            borderColor: selectedWalletId === w.id ? '#01ff77' : '#e0e0e0',
                                            background:  selectedWalletId === w.id ? '#f0fff4' : 'white',
                                        }}
                                        onClick={() => setSelectedWalletId(w.id)}
                                    >
                                        <span style={{ fontSize: '22px' }}>👻</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={s.walletName}>Phantom {w.label ? `· ${w.label}` : ''}</div>
                                            <div style={s.walletAddr}>{w.address?.slice(0, 6)}...{w.address?.slice(-6)}</div>
                                            <div style={s.walletBal}>{(w.balance || 0).toFixed(4)} {w.currency || 'SOL'}</div>
                                        </div>
                                        {selectedWalletId === w.id && (
                                            <span style={{ color: '#01ff77', fontWeight: 'bold' }}>✓</span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {selectedWallet && (
                                <div style={hasFunds ? s.okBox : s.warnBox}>
                                    {hasFunds
                                        ? `✅ Balance OK: ${(selectedWallet.balance || 0).toFixed(4)} ${selectedWallet.currency || 'SOL'}`
                                        : `❌ Need ${totalSol.toFixed(6)} SOL, have ${(selectedWallet.balance || 0).toFixed(4)} ${selectedWallet.currency || 'SOL'}`
                                    }
                                </div>
                            )}

                            <div style={s.summary}>
                                <div style={s.row}>
                                    <span style={{ color: '#888' }}>Listed price</span>
                                    <span style={{ color: '#888' }}>{nftPrice} {nftCurrency}</span>
                                </div>
                                {nftCurrency !== 'SOL' && (
                                    <div style={s.row}>
                                        <span style={{ color: '#888' }}>Phantom quote</span>
                                        <span style={{ color: '#888' }}>{sellerAmountSol.toFixed(6)} SOL</span>
                                    </div>
                                )}
                                <div style={s.row}>
                                    <span style={{ color: '#888' }}>NFT payment</span>
                                    <span style={{ color: '#888' }}>{sellerAmountSol.toFixed(6)} SOL</span>
                                </div>
                                <div style={s.row}>
                                    <span style={{ color: '#888' }}>Platform fee (1%)</span>
                                    <span style={{ color: '#888' }}>+{feeSol.toFixed(6)} SOL</span>
                                </div>
                                <div style={{ ...s.row, borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '4px' }}>
                                    <strong>Total in Phantom</strong>
                                    <strong style={{ color: '#00b85c', fontSize: '16px' }}>{totalSol.toFixed(6)} SOL</strong>
                                </div>
                                <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
                                    The quote is fixed for 10 minutes. Phantom will open to approve the transaction.
                                </div>
                            </div>

                            <div style={s.actions}>
                                <button style={s.cancelBtn} onClick={onClose} disabled={buying}>Cancel</button>
                                <button
                                    style={{ ...s.buyBtn, opacity: (!selectedWalletId || !hasFunds || buying) ? 0.5 : 1 }}
                                    onClick={handleBuyCrypto}
                                    disabled={!selectedWalletId || !hasFunds || buying}
                                >
                                    {buying ? '⏳ Waiting for Phantom...' : '👻 Buy with Phantom'}
                                </button>
                            </div>
                        </>
                    )
                )}

                {/* ── CASH ON DELIVERY FLOW ───────────────────────────── */}
                {paymentMethod === 'cod' && (
                    <>
                        {/* Fiat currency selector */}
                        <div style={{ marginBottom: '14px' }}>
                            <label style={s.label}>Payment currency:</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {(['UAH', 'USD', 'SOL'] as const).map(c => (
                                    <button
                                        key={c}
                                        style={{ ...s.currencyChip, background: fiatCurrency === c ? '#01ff77' : '#f0f0f0', color: fiatCurrency === c ? 'black' : '#555', fontWeight: fiatCurrency === c ? 'bold' : 'normal' }}
                                        onClick={() => setFiatCurrency(c)}
                                    >
                                        {c === 'UAH' ? '₴ UAH' : c === 'USD' ? '$ USD' : '◎ SOL'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={s.codInfoBox}>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#333', marginBottom: '6px' }}>📦 Cash on Delivery via Nova Poshta</div>
                            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.5' }}>
                                Your order will be placed and the seller will be notified. Pay upon receiving your package at the Nova Poshta branch.
                            </div>
                            <div style={{ marginTop: '10px', fontSize: '13px', color: '#888' }}>
                                Price: <strong style={{ color: '#222' }}>{nftPrice} {nftCurrency}</strong>
                                <span style={{ margin: '0 6px', color: '#ccc' }}>→</span>
                                Pay in: <strong style={{ color: '#01ff77' }}>{fiatCurrency}</strong>
                            </div>
                        </div>

                        <div style={s.actions}>
                            <button style={s.cancelBtn} onClick={onClose} disabled={buying}>Cancel</button>
                            <button
                                style={{ ...s.codBtn, opacity: buying ? 0.5 : 1 }}
                                onClick={handleCashOnDelivery}
                                disabled={buying}
                            >
                                {buying ? '⏳ Placing order...' : '🚚 Pay on Delivery'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const s: any = {
    overlay:     { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 5000 },
    sheet:       { background: 'white', borderRadius: '24px 24px 0 0', padding: '16px 20px 36px', width: '100%', maxWidth: '520px', maxHeight: '92vh', overflowY: 'auto' },
    handle:      { width: '40px', height: '4px', background: '#ddd', borderRadius: '2px', margin: '0 auto 16px' },
    header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' },
    title:       { fontSize: '20px', fontWeight: 'bold', color: '#222', margin: 0 },
    closeBtn:    { background: '#f0f0f0', border: 'none', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '15px' },
    nftRow:      { display: 'flex', gap: '14px', background: '#f8f8f8', borderRadius: '14px', padding: '14px', marginBottom: '16px' },
    nftImg:      { width: '72px', height: '72px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0 },
    nftInfo:     { flex: 1 },
    nftTitle:    { fontWeight: 'bold', fontSize: '15px', color: '#222', marginBottom: '3px' },
    nftAuthor:   { fontSize: '12px', color: '#888', marginBottom: '4px' },
    nftPrice:    { fontWeight: 'bold', color: '#01ff77', fontSize: '20px' },
    methodTabs:  { display: 'flex', gap: '8px', marginBottom: '16px' },
    methodTab:   { flex: 1, padding: '10px', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: 'all 0.2s' },
    label:       { display: 'block', fontSize: '13px', fontWeight: '600', color: '#444', marginBottom: '6px' },
    addrInput:   { width: '100%', padding: '11px 14px', border: '1px solid #e0e0e0', borderRadius: '10px', fontSize: '14px', background: '#fafafa', outline: 'none', boxSizing: 'border-box' },
    center:      { textAlign: 'center', padding: '30px' },
    spinner:     { width: '32px', height: '32px', border: '3px solid #ddd', borderTop: '3px solid #01ff77', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' },
    walletList:  { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' },
    walletCard:  { display: 'flex', alignItems: 'center', gap: '12px', border: '2px solid', borderRadius: '12px', padding: '12px', cursor: 'pointer', transition: 'all 0.15s' },
    walletName:  { fontWeight: '600', fontSize: '14px', color: '#222' },
    walletAddr:  { fontSize: '11px', color: '#aaa', fontFamily: 'monospace' },
    walletBal:   { fontSize: '12px', color: '#888' },
    okBox:       { background: '#f0fff4', border: '1px solid #b2f0c8', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: '#00aa44', marginBottom: '14px' },
    warnBox:     { background: '#fff5f5', border: '1px solid #ffc0c0', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: '#cc2222', marginBottom: '14px' },
    errorBox:    { textAlign: 'center', background: '#fff5f5', border: '1px solid #ffc0c0', borderRadius: '12px', padding: '24px', color: '#cc2222', marginBottom: '20px' },
    connectBox:  { textAlign: 'center', background: '#f5f2ff', border: '1px solid #d9d0ff', borderRadius: '12px', padding: '20px', color: '#30265f', marginBottom: '14px' },
    connectBtn:  { width: '100%', padding: '13px', background: '#7c5bdc', color: 'white', border: 'none', borderRadius: '11px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
    summary:     { background: '#f8f8f8', borderRadius: '12px', padding: '14px', marginBottom: '20px' },
    row:         { display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' },
    actions:     { display: 'flex', gap: '10px' },
    cancelBtn:   { flex: 1, padding: '14px', background: 'white', border: '1px solid #ddd', borderRadius: '12px', fontSize: '15px', cursor: 'pointer' },
    buyBtn:      { flex: 2, padding: '14px', background: '#01ff77', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 'bold', transition: 'opacity 0.2s', cursor: 'pointer' },
    codBtn:      { flex: 2, padding: '14px', background: '#ff6b35', color: 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 'bold', transition: 'opacity 0.2s', cursor: 'pointer' },
    currencyChip:{ padding: '8px 20px', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '14px', transition: 'all 0.2s' },
    codInfoBox:  { background: '#fff8f0', border: '1px solid #ffd8b0', borderRadius: '12px', padding: '14px', marginBottom: '20px' },
};

export default BuyModal;
