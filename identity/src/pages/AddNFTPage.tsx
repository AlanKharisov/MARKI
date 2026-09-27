import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiCreateNFT, apiUpdateNFT, apiGetNFTs, apiCreatePost, apiDeletePost, apiBatchCreate, apiGetPosts, apiGetMintInfo, apiCreateEditionNFTs, apiAiGenerateImage } from '../services/apiClient';
import { useUmi } from '../hooks/useUmi';
import { generateSigner, percentAmount, lamports, publicKey as umiPublicKey, some } from '@metaplex-foundation/umi';
import { createNft } from '@metaplex-foundation/mpl-token-metadata';
import { transferSol } from '@metaplex-foundation/mpl-toolbox';
import { useLanguage } from '../context/LanguageContext';

// ─── Platform treasury ────────────────────────────────────────────────────────
// TODO: replace with your real treasury wallet before going to mainnet.
const PLATFORM_TREASURY = umiPublicKey('2wZ2vKzRzY7ZxkRTRgTKVBDBVTqk1NfvGbQFgDxJAr9X');

// ─── Commission helper ────────────────────────────────────────────────────────
// Sends platform fee as a SEPARATE transaction so it never gets bundled with
// createNft/printV1.  Bundling causes "insufficient funds for rent" on devnet
// because the treasury address may not exist yet and 120 000 lamports is below
// the rent-exempt minimum (~890 880 lamports for a zero-byte account).
// The try/catch lets devnet skip the fee gracefully so minting always proceeds.
async function sendCommission(umi: any, commissionLamports: number): Promise<void> {
    try {
        const feeBlockhash = await rpcWithRetry<any>(() => umi.rpc.getLatestBlockhash(), 'commission blockhash');
        await rpcWithRetry(
            () => transferSol(umi, {
                destination: PLATFORM_TREASURY,
                amount:      lamports(commissionLamports),
            })
                .setBlockhash(feeBlockhash)
                .sendAndConfirm(umi, { confirm: { strategy: { type: 'blockhash', ...feeBlockhash } } }),
            'commission send',
        );
        console.log('[AddNFT] commission sent:', commissionLamports, 'lamports');
    } catch (feeErr: any) {
        // On devnet the treasury often doesn't exist yet → rent error.
        // Log and continue so the mint itself is never blocked by the fee TX.
        console.warn('[AddNFT] commission transfer skipped (likely devnet treasury missing):', feeErr?.message);
    }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES  = ['Art', 'Music', 'Photography', 'Gaming', '3D', 'Collectible', 'Sports', 'Meme'];
const CURRENCIES  = ['SOL', 'UAH', 'USD'];
const BLOCKCHAINS = [
    { id: 'solana', name: 'Solana', icon: '◎', currency: 'SOL', fee: '~$0.01' },
];

async function rpcWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
    attempts = 5,
): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            lastErr = e;
            const msg = String(e?.message ?? e ?? '');
            const isRateLimit = msg.includes('429') || /too many|rate.?limit/i.test(msg);
            if (!isRateLimit || attempt === attempts - 1) throw e;
            const delay = 500 * Math.pow(2, attempt) + Math.random() * 300;
            console.warn(`[AddNFT] ${label}: RPC rate limited, retry in ${Math.round(delay)}ms (${attempt + 1}/${attempts})`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

// ─── Image compression ────────────────────────────────────────────────────────
// Resizes to ≤ maxPx on the longest edge and re-encodes as JPEG.
// Falls back to the original file if the Canvas API is unavailable.
function compressImage(file: File, maxPx = 1080, quality = 0.8): Promise<File> {
    return new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale  = Math.min(1, maxPx / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(img.width  * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                blob => {
                    if (!blob) { resolve(file); return; }
                    const name = file.name.replace(/\.[^.]+$/, '.jpg');
                    resolve(new File([blob], name, { type: 'image/jpeg' }));
                },
                'image/jpeg',
                quality,
            );
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

type Step = 1 | 2 | 3;
type Mode = 'create' | 'wallet' | 'batch';

interface AddNFTPageProps {
    preselectedNFT?: any | null;
}

const AddNFTPage: React.FC<AddNFTPageProps> = ({ preselectedNFT }) => {
    const { currentUser } = useAuth();
    const { language } = useLanguage();
    const uk = language === 'uk';
    const { umi, isReady: walletReady, connect: connectPhantom } = useUmi();
    const fileInputRef    = useRef<HTMLInputElement>(null);
    const batchInputRef   = useRef<HTMLInputElement>(null);

    // ── Mode ──────────────────────────────────────────────────────────────────
    const [mode, setMode] = useState<Mode>(preselectedNFT ? 'wallet' : 'create');

    // ── Wallet mode ───────────────────────────────────────────────────────────
    const [walletNFTs, setWalletNFTs]               = useState<any[]>([]);
    const [walletLoading, setWalletLoading]         = useState(false);
    const [selectedWalletNFT, setSelectedWalletNFT] = useState<any | null>(preselectedNFT || null);
    const [editTitle, setEditTitle]                 = useState('');
    const [editDescription, setEditDescription]     = useState('');
    const [editTags, setEditTags]                   = useState<string[]>([]);
    const [editTagInput, setEditTagInput]           = useState('');
    const [editCategory, setEditCategory]           = useState('Art');
    const [sellPrice, setSellPrice]                 = useState('');
    const [sellCurrency, setSellCurrency]           = useState('SOL');
    const [selling, setSelling]                     = useState(false);
    const [sellSuccess, setSellSuccess]             = useState(false);

    // ── Create mode ───────────────────────────────────────────────────────────
    const [step, setStep]                     = useState<Step>(1);
    const [loading, setLoading]               = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [dragOver, setDragOver]             = useState(false);
    const [success, setSuccess]               = useState(false);
    const [selectedFile, setSelectedFile]     = useState<File | null>(null);
    const [previewUrl, setPreviewUrl]         = useState('');
    const [title, setTitle]                   = useState('');
    const [description, setDescription]       = useState('');
    const [tags, setTags]                     = useState<string[]>([]);
    const [tagInput, setTagInput]             = useState('');
    const [category, setCategory]             = useState('Art');
    const [forSale, setForSale]               = useState(false);
    const [price, setPrice]                   = useState('');
    const [currency, setCurrency]             = useState('SOL');
    const [blockchain, setBlockchain]         = useState('solana');
    const [royalty, setRoyalty]               = useState('10');
    const [editionCount, setEditionCount]     = useState('1'); // '1' = regular 1-of-1
    // Collection creation
    const [isCollection, setIsCollection]     = useState(false);
    const [collectionName, setCollectionName] = useState('');
    const [collectionFiles, setCollectionFiles] = useState<File[]>([]);

    // ── AI generation ─────────────────────────────────────────────────────────
    const [aiPrompt, setAiPrompt]             = useState('');
    const [aiGenerating, setAiGenerating]     = useState(false);
    const [aiError, setAiError]               = useState('');
    const [showAiPanel, setShowAiPanel]       = useState(false);
    const [aiStatus, setAiStatus]             = useState('');

    // ── Batch mode ────────────────────────────────────────────────────────────
    const [batchFiles, setBatchFiles]         = useState<File[]>([]);
    const [batchBlockchain, setBatchBlockchain] = useState('solana');
    const [batchCurrency, setBatchCurrency]   = useState('SOL');
    const [batchRoyalty, setBatchRoyalty]     = useState('10');
    const [batchForSale, setBatchForSale]     = useState(false);
    const [batchPrice, setBatchPrice]         = useState('');
    const [batchTags, setBatchTags]           = useState<string[]>([]);
    const [batchTagInput, setBatchTagInput]   = useState('');
    const [batchLoading, setBatchLoading]     = useState(false);
    const [batchResult, setBatchResult]       = useState<any | null>(null);

    // ── Load wallet NFTs ──────────────────────────────────────────────────────
    useEffect(() => {
        if (mode === 'wallet' && !preselectedNFT && !selectedWalletNFT) {
            setWalletLoading(true);
            apiGetNFTs()
                .then(nfts => setWalletNFTs((nfts || []).filter((n: any) => !n.forSale)))
                .catch(() => setWalletNFTs([]))
                .finally(() => setWalletLoading(false));
        }
    }, [mode]); // eslint-disable-line

    // ── Fill form from selected NFT ───────────────────────────────────────────
    useEffect(() => {
        if (selectedWalletNFT) {
            setEditTitle(selectedWalletNFT.title || '');
            setEditDescription(selectedWalletNFT.description || '');
            setEditTags(selectedWalletNFT.tags || []);
            setEditCategory(selectedWalletNFT.category || 'Art');
            setSellCurrency(selectedWalletNFT.currency || 'SOL');
        }
    }, [selectedWalletNFT]);

    // ── AI image generation via backend proxy ─────────────────────────────────
    // The server calls Pollinations.ai (no CORS on server side) and streams
    // the image back. No API key, no registration, completely free.
    const handleAiGenerate = async () => {
        const prompt = aiPrompt.trim();
        if (!prompt) return;

        setAiGenerating(true);
        setAiError('');
        setAiStatus('Generating image... (~15–30 sec)');

        try {
            const blob = await apiAiGenerateImage(prompt);
            const seed = Math.floor(Math.random() * 1_000_000);
            const file = new File([blob], `ai-nft-${seed}.jpg`, { type: 'image/jpeg' });
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setShowAiPanel(false);
        } catch (e: any) {
            setAiError(e.message || 'Generation failed. Try again.');
        } finally {
            setAiGenerating(false);
            setAiStatus('');
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getNFTImage = (nft: any) => nft.image || nft.nftImage || '/img/default-nft.png';

    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) { alert('Please upload an image file'); return; }
        if (file.size > 10 * 1024 * 1024)   { alert('File too large. Max 10MB.'); return; }
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    }, []); // eslint-disable-line

    const addTag = (input: string, list: string[], setList: (t: string[]) => void, setInput: (s: string) => void) => {
        const t = input.trim().replace(/^#/, '');
        if (t && !list.includes(t) && list.length < 8) { setList([...list, t]); setInput(''); }
    };

    const canGoNext = () => {
        if (step === 1) {
            const hasFile = isCollection ? collectionFiles.length > 0 : !!selectedFile;
            return hasFile && !!title.trim() && !!description.trim();
        }
        if (step === 2) return !!blockchain;
        return true;
    };

    // ── Create submit ────────────────────────────────────────────────────────
    const handleCreateSubmit = async () => {
        if (!currentUser) return;

        // ── Pre-flight validation — ALL guards before setLoading so we never
        //    enter the loading state just to immediately return out of it. ──────
        if (!walletReady) {
            alert('Please connect your Phantom wallet first to mint on-chain.');
            return;
        }
        if (isCollection && collectionFiles.length === 0) {
            alert('Please select images for your collection');
            return;
        }
        if (!isCollection && !selectedFile) {
            alert('Please select an image');
            return;
        }

        // Guard against a stale umi instance that was built without Phantom
        // identity (can happen when useMemo fires before publicKey is set).
        // This surfaces the issue as an explicit error instead of a silent
        // transaction that "signs" with a no-op key and never opens Phantom.
        if (!umi?.identity?.publicKey) {
            alert('Wallet signer not ready. Please disconnect and reconnect Phantom, then try again.');
            return;
        }

        setLoading(true);
        setUploadProgress('');

        try {
            if (isCollection) {
                // ── Step 1 — Upload all images + generate per-item metadata URIs ──
                const totalItems = collectionFiles.length;
                setUploadProgress(`Step 1/${totalItems + 3} — Uploading ${totalItems} images to backend…`);

                const items = collectionFiles.map((f, i) => ({
                    title:       f.name.replace(/\.[^.]+$/, '') || `${collectionName.trim() || 'Collection'} #${i + 1}`,
                    description: description.trim(),
                    ...(forSale && price ? { price: parseFloat(price) } : {}),
                }));
                setUploadProgress(`Step 1/${totalItems + 3} — Compressing ${totalItems} images…`);
                const compressedFiles = await Promise.all(collectionFiles.map(f => compressImage(f)));

                const form = new FormData();
                compressedFiles.forEach(f => form.append('images[]', f));
                form.append('metadata', JSON.stringify({
                    batchName: collectionName.trim() || title.trim() || 'Collection',
                    blockchain, currency,
                    royalty: parseFloat(royalty),
                    forSale, tags, items,
                }));
                setUploadProgress(`Step 1/${totalItems + 3} — Uploading ${totalItems} images to backend…`);
                const collectionResult = await apiBatchCreate(form);
                if (collectionResult?.failed > 0) {
                    console.warn('[AddNFT] Collection batch had upload failures:', collectionResult);
                }

                const successful: any[] = (collectionResult?.results ?? [])
                    .filter((r: any) => r.status === 'ok' && r.id && r.metadataUri);
                if (successful.length === 0) {
                    throw new Error('No items were successfully uploaded to the backend.');
                }

                // ── Check freemium tier once, before any Phantom prompt ───────────
                setUploadProgress('Checking mint fee…');
                const mintInfo = await apiGetMintInfo();
                console.log('[AddNFT] collection mintInfo:', mintInfo);

                // Commission is applied once per collection (first paid TX only).
                // Subsequent items in the same upload are free of the platform fee.
                let feeCharged = false;

                // Accumulate image URLs and NFT IDs for the single collection post.
                const collectionImageUrls: string[] = [];
                const collectionNftIds:    string[] = [];

                const chargeCommission = !mintInfo.isFree && !feeCharged && mintInfo.commissionLamports > 0;
                if (chargeCommission) {
                    setUploadProgress('Sending platform fee — approve in Phantom…');
                    await sendCommission(umi, mintInfo.commissionLamports);
                    feeCharged = true;
                }

                setUploadProgress(`Building ${successful.length} transactions…`);
                const sharedBlockhash = await umi.rpc.getLatestBlockhash();
                const collectionMintSigners: any[] = [];
                const partiallySignedTxs: any[] = [];

                for (let i = 0; i < successful.length; i++) {
                    const item = successful[i];
                    const itemTitle = items[item.index]?.title ?? `${collectionName.trim() || 'Collection'} #${item.index + 1}`;

                    const mintSigner = generateSigner(umi);
                    collectionMintSigners.push({ id: item.id, imageUrl: item.imageUrl, signer: mintSigner });

                    const builtTx = createNft(umi, {
                        mint: mintSigner,
                        name: itemTitle,
                        uri: item.metadataUri,
                        sellerFeeBasisPoints: percentAmount(parseFloat(royalty)),
                    }).setBlockhash(sharedBlockhash).build(umi);

                    const partSigned = await mintSigner.signTransaction(builtTx);
                    partiallySignedTxs.push(partSigned);
                }

                setUploadProgress(`Approve all ${successful.length} items in Phantom (one click)…`);
                console.log(`[AddNFT] requesting signAllTransactions for ${successful.length} collection items…`);
                const fullySignedTxs = await umi.identity.signAllTransactions(partiallySignedTxs);

                for (let i = 0; i < fullySignedTxs.length; i++) {
                    setUploadProgress(`Broadcasting item ${i + 1}/${successful.length}…`);
                    const sig = await umi.rpc.sendTransaction(fullySignedTxs[i], { skipPreflight: true });
                    partiallySignedTxs[i] = sig; // repurpose array to store signatures
                    await new Promise(r => setTimeout(r, 300)); // small delay to avoid send rate limit
                }

                for (let i = 0; i < fullySignedTxs.length; i++) {
                    setUploadProgress(`Confirming item ${i + 1}/${successful.length}…`);
                    const sig = partiallySignedTxs[i];
                    try {
                        await umi.rpc.confirmTransaction(sig, {
                            strategy: { type: 'blockhash', ...sharedBlockhash },
                        });
                    } catch (err) {
                        console.warn(`[AddNFT] collection item ${i + 1} confirm error (ignoring devnet RPC issues):`, err);
                    }

                    const info = collectionMintSigners[i];
                    console.log(`[AddNFT] collection item ${i + 1} confirmed:`, info.signer.publicKey);
                    await apiUpdateNFT(info.id, { mintAddress: info.signer.publicKey });

                    collectionImageUrls.push(info.imageUrl as string);
                    collectionNftIds.push(info.id as string);
                }

                // ── Single collection post after all mints complete ───────────────
                // One post represents the whole collection in the feed; individual
                // NFT records remain in the wallet as separate items.
                const collectionStepNum = successful.length + 2;
                const collectionStepTotal = successful.length + 3;
                setUploadProgress(`Step ${collectionStepNum}/${collectionStepTotal} — Publishing collection to feed…`);
                await apiCreatePost({
                    nftImages:    collectionImageUrls,
                    walletNftIds: collectionNftIds,
                    title:        collectionName.trim() || title.trim(),
                    description:  description.trim(),
                    tags,
                    forSale,
                    price:        forSale && price ? parseFloat(price) : null,
                    currency,
                });
                console.log(`[AddNFT] collection flow complete — ${successful.length} items minted, 1 feed post created.`);

            } else {
                const numEditions = Math.max(1, parseInt(editionCount) || 1);
                const baseMetadata: any = {
                    title:       title.trim(),
                    description: description.trim(),
                    tags,
                    category,
                    blockchain,
                    royalty:     parseFloat(royalty),
                    forSale,
                    currency,
                };
                if (forSale && price) baseMetadata.price = parseFloat(price);

                // ── Check freemium tier once (shared by both paths below). ──────────
                // Done here — before any Umi call — so the user sees the fee
                // message BEFORE Phantom opens, and the result is reused in both
                // the master-edition and the single-mint paths without a second
                // network round-trip.
                setUploadProgress('Checking mint fee…');
                const mintInfo = await apiGetMintInfo();
                console.log('[AddNFT] mintInfo:', mintInfo);

                if (numEditions > 1) {
                    // ══ Multi-edition path ══════════════════════════════════════════
                    // Strategy: mint N independent NFTs (same image/URI, unique mints).
                    // Build all transactions first, pre-sign with mint keypairs, then
                    // call signAllTransactions → ONE Phantom approval for all editions.
                    // This avoids: (a) the printV1 DataTypeMismatch error, and
                    //              (b) N separate Phantom confirmation popups.

                    // Step 1/4 ── Upload image + create N backend records.
                    setUploadProgress('Step 1/4 — Compressing & uploading image…');
                    const editionForm = new FormData();
                    editionForm.append('image',    await compressImage(selectedFile!));
                    editionForm.append('metadata', JSON.stringify({
                        ...baseMetadata,
                        batchName: collectionName.trim() || title.trim(),
                        editionCount: numEditions,
                    }));
                    const edResult = await apiCreateEditionNFTs(editionForm);
                    const { masterId, metadataUri, imageUrl, editionIds } = edResult;
                    console.log('[AddNFT] edition backend records created:', { masterId, editionIds });

                    // Step 2/4 ── Commission (separate TX, best-effort on devnet).
                    if (!mintInfo.isFree && mintInfo.commissionLamports > 0) {
                        setUploadProgress('Step 2/4 — Sending platform fee — approve in Phantom…');
                        await sendCommission(umi, mintInfo.commissionLamports);
                    }

                    // Step 3/4 ── Build N createNft transactions, pre-sign with each
                    // mint keypair, then sign ALL with Phantom in one popup.
                    setUploadProgress(`Step 3/4 — Building ${numEditions} transactions…`);
                    const sharedBlockhash = await rpcWithRetry<any>(() => umi.rpc.getLatestBlockhash(), 'editions blockhash');
                    const editionMintSigners: any[] = [];
                    const partiallySignedTxs: any[] = [];

                    for (let i = 0; i < numEditions; i++) {
                        const mintSigner = generateSigner(umi);
                        editionMintSigners.push(mintSigner);

                        const builtTx = createNft(umi, {
                            mint:                 mintSigner,
                            name:                 `${title.trim()} #${i + 1}/${numEditions}`,
                            uri:                  metadataUri,
                            sellerFeeBasisPoints: percentAmount(parseFloat(royalty)),
                        }).setBlockhash(sharedBlockhash).build(umi);

                        // Pre-sign with the generated mint keypair (not Phantom).
                        const partSigned = await mintSigner.signTransaction(builtTx);
                        partiallySignedTxs.push(partSigned);
                    }

                    // ONE Phantom popup for all editions.
                    setUploadProgress(`Step 3/4 — Approve all ${numEditions} editions in Phantom (one click)…`);
                    console.log(`[AddNFT] requesting signAllTransactions for ${numEditions} editions…`);
                    const fullySignedTxs = await umi.identity.signAllTransactions(partiallySignedTxs);

                    // Step 4/4 ── Broadcast all quickly to beat blockhash expiration.
                    const sentEditions: { index: number; sig: any }[] = [];
                    const sendErrors: { index: number; err: string }[] = [];
                    for (let i = 0; i < fullySignedTxs.length; i++) {
                        setUploadProgress(`Step 4/4 — Broadcasting edition ${i + 1}/${numEditions}…`);
                        try {
                            const sig = await rpcWithRetry(
                                () => umi.rpc.sendTransaction(fullySignedTxs[i], { skipPreflight: true }),
                                `send edition ${i + 1}`,
                            );
                            sentEditions.push({ index: i, sig });
                        } catch (err: any) {
                            sendErrors.push({ index: i, err: String(err?.message ?? err) });
                            console.warn(`[AddNFT] edition ${i + 1} send failed:`, err);
                        }
                        await new Promise(r => setTimeout(r, 300));
                    }

                    if (sentEditions.length === 0) {
                        throw new Error(`All ${numEditions} editions failed to send: ${sendErrors[0]?.err ?? 'unknown error'}`);
                    }

                    // Confirmation on public devnet is frequently rate-limited.
                    // Once a transaction is sent, a confirmation 429 must not abort
                    // the already-created backend records or block wallet grouping.
                    const confirmErrors: { index: number; err: string }[] = [];
                    for (let i = 0; i < sentEditions.length; i++) {
                        const { index, sig } = sentEditions[i];
                        setUploadProgress(`Step 4/4 — Confirming edition ${i + 1}/${sentEditions.length}…`);
                        try {
                            await rpcWithRetry(
                                () => umi.rpc.confirmTransaction(sig, {
                                    strategy: { type: 'blockhash', ...sharedBlockhash },
                                }),
                                `confirm edition ${index + 1}`,
                                3,
                            );
                            console.log(`[AddNFT] edition ${index + 1} confirmed:`, editionMintSigners[index].publicKey);
                        } catch (err: any) {
                            confirmErrors.push({ index, err: String(err?.message ?? err) });
                            console.warn(`[AddNFT] edition ${index + 1} confirm skipped after send (devnet RPC issue):`, err);
                        }
                    }

                    const sentIndices = sentEditions.map(e => e.index).sort((a, b) => a - b);
                    setUploadProgress(`Step 4/4 — Saving mint addresses (${sentIndices.length}/${numEditions})…`);
                    await Promise.allSettled(
                        sentIndices.map(i => apiUpdateNFT(editionIds[i], { mintAddress: editionMintSigners[i].publicKey })),
                    );

                    if (sendErrors.length > 0 || confirmErrors.length > 0) {
                        console.warn('[AddNFT] edition mint completed with RPC warnings:', { sendErrors, confirmErrors });
                    }

                    // One combined post for the whole edition series.
                    setUploadProgress('Step 4/4 — Publishing to feed…');
                    const sentEditionIds = sentIndices.map(i => editionIds[i]);
                    await apiCreatePost({
                        nftImages:    sentEditionIds.map(() => imageUrl),  // same art, N tokens
                        walletNftIds: sentEditionIds,
                        title:        sentEditionIds.length === numEditions
                            ? `${title.trim()} (${numEditions} editions)`
                            : `${title.trim()} (${sentEditionIds.length}/${numEditions} editions)`,
                        description:  description.trim(),
                        tags,
                        forSale,
                        price:        forSale && price ? parseFloat(price) : null,
                        currency,
                        blockchain,
                    });
                    console.log('[AddNFT] multi-edition flow complete.');

                } else {
                    // ══ Single NFT — 4-step on-chain mint ══════════════════════════

                    // Step 1/4 ── Compress + upload image + metadata to backend.
                    setUploadProgress('Step 1/4 — Compressing & uploading image…');
                    const form = new FormData();
                    form.append('image',    await compressImage(selectedFile!));
                    form.append('metadata', JSON.stringify(baseMetadata));
                    const result = await apiCreateNFT(form);
                    console.log('[AddNFT] single NFT backend record created:', result?.id);

                    const nftId       = result?.id;
                    const metadataUri = result?.metadataUri;
                    if (!nftId || !metadataUri) {
                        throw new Error('Backend did not return id / metadataUri — check Rust create_nft handler.');
                    }

                    // Step 2/4 ── Commission (separate TX) then mint on-chain.
                    if (!mintInfo.isFree && mintInfo.commissionLamports > 0) {
                        setUploadProgress('Step 2/4 — Sending platform fee — approve in Phantom…');
                        await sendCommission(umi, mintInfo.commissionLamports);
                    }

                    setUploadProgress('Step 2/4 — Minting — approve in Phantom…');
                    console.log('[AddNFT] building single mint tx…');

                    const mint            = generateSigner(umi);
                    const latestBlockhash = await umi.rpc.getLatestBlockhash();
                    console.log('[AddNFT] single mint blockhash:', latestBlockhash.blockhash);

                    await createNft(umi, {
                        mint,
                        name:                 title.trim(),
                        uri:                  metadataUri,
                        sellerFeeBasisPoints: percentAmount(parseFloat(royalty)),
                    })
                        .setBlockhash(latestBlockhash)
                        .sendAndConfirm(umi, { confirm: { strategy: { type: 'blockhash', ...latestBlockhash } } });

                    console.log('[AddNFT] single NFT minted:', mint.publicKey);

                    // Step 3/4 ── Persist on-chain mint address.
                    setUploadProgress('Step 3/4 — Recording on-chain identity…');
                    await apiUpdateNFT(nftId, { mintAddress: mint.publicKey });

                    // Step 4/4 ── Publish to feed.
                    setUploadProgress('Step 4/4 — Publishing to feed…');
                    await apiCreatePost({
                        nftImage:    result.image,
                        title:       title.trim(),
                        description: description.trim(),
                        tags,
                        forSale,
                        price:       forSale && price ? parseFloat(price) : null,
                        currency,
                        walletNftId: nftId,
                    });
                    console.log('[AddNFT] single NFT flow complete.');
                }
            }

            setUploadProgress('');
            setSuccess(true);

        } catch (err: any) {
            // Dump the full error — Umi's SendTransactionError carries .logs and
            // .cause that are far more useful than just .message.
            console.error('[AddNFT] mint failed — full error object:', err);
            console.error('[AddNFT] error breakdown:', {
                message: err?.message,
                logs:    err?.logs,      // Solana program logs
                cause:   err?.cause,     // underlying RPC error
                stack:   err?.stack,
            });
            const displayMsg =
                err?.message
                ?? (typeof err === 'string' ? err : JSON.stringify(err, null, 2));
            alert(`❌ Minting failed\n\n${displayMsg}\n\nOpen the browser console for full Solana logs.`);
        } finally {
            setLoading(false);
            setUploadProgress('');
        }
    };

    // ── Sell from wallet submit ───────────────────────────────────────────────
    const handleSellFromWallet = async () => {
        if (!currentUser || !selectedWalletNFT || !sellPrice || !editTitle.trim()) return;
        const numPrice = parseFloat(sellPrice);
        if (isNaN(numPrice) || numPrice <= 0) { alert('Enter valid price'); return; }

        setSelling(true);
        try {
            await apiUpdateNFT(selectedWalletNFT.id, {
                title:       editTitle.trim(),
                description: editDescription.trim(),
                tags:        editTags,
                category:    editCategory,
                price:       numPrice,
                forSale:     true,
                currency:    sellCurrency,
            });

            // Delete old post for this NFT, then create new one
            try {
                const posts = await apiGetPosts();
                const oldPost = posts.find((p: any) => p.walletNftId === selectedWalletNFT.id && p.userId === currentUser.uid);
                if (oldPost?.id) await apiDeletePost(oldPost.id).catch(() => null);
            } catch { /* non-critical */ }

            await apiCreatePost({
                nftImage:    getNFTImage(selectedWalletNFT),
                title:       editTitle.trim(),
                description: editDescription.trim(),
                tags:        editTags,
                forSale:     true,
                price:       numPrice,
                currency:    sellCurrency,
                walletNftId: selectedWalletNFT.id,
            });

            setSellSuccess(true);
        } catch (err: any) {
            alert(`❌ Error: ${err.message}`);
        } finally {
            setSelling(false);
        }
    };

    // ── Batch submit ─────────────────────────────────────────────────────────
    const handleBatchSubmit = async () => {
        if (!currentUser || batchFiles.length === 0) { alert('Please select files'); return; }
        setBatchLoading(true);
        try {
            const items = batchFiles.map((f, i) => ({
                title:       f.name.replace(/\.[^.]+$/, '') || `Batch NFT #${i + 1}`,
                description: `Batch upload item ${i + 1}`,
                price:       batchForSale && batchPrice ? parseFloat(batchPrice) : undefined,
            }));
            const metadata = {
                batchName: 'Batch',
                blockchain: batchBlockchain,
                currency:   batchCurrency,
                royalty:    parseFloat(batchRoyalty),
                forSale:    batchForSale,
                tags:       batchTags,
                items,
            };
            const batchCompressed = await Promise.all(batchFiles.map(f => compressImage(f)));
            const form = new FormData();
            batchCompressed.forEach(f => form.append('images[]', f));
            form.append('metadata', JSON.stringify(metadata));

            const result = await apiBatchCreate(form);
            if (result?.failed > 0) {
                console.warn('[AddNFT] Batch failures:', result);
            }

            // Publish each successfully created NFT to the home feed.
            const successfulItems = (result?.results ?? [])
                .filter((r: any) => r.status === 'ok' && r.id && r.imageUrl);
            for (let i = 0; i < successfulItems.length; i++) {
                const r        = successfulItems[i];
                const itemMeta = items[r.index ?? i];
                await apiCreatePost({
                    nftImage:    r.imageUrl,
                    title:       itemMeta?.title ?? `Batch NFT #${i + 1}`,
                    description: itemMeta?.description ?? '',
                    tags:        batchTags,
                    forSale:     batchForSale,
                    price:       batchForSale && batchPrice ? parseFloat(batchPrice) : null,
                    currency:    batchCurrency,
                    walletNftId: r.id,
                });
            }
            console.log(`[AddNFT] batch: published ${successfulItems.length} feed posts.`);

            setBatchResult(result);
        } catch (err: any) {
            console.error('[AddNFT] batch error:', err);
            alert(`❌ Batch error: ${err.message}`);
        } finally {
            setBatchLoading(false);
        }
    };

    const handleReset = () => {
        setStep(1); setSelectedFile(null); setPreviewUrl(''); setTitle('');
        setDescription(''); setTags([]); setTagInput(''); setCategory('Art');
        setForSale(false); setPrice(''); setCurrency('SOL');
        setBlockchain('solana'); setRoyalty('10'); setSuccess(false);
        setIsCollection(false); setCollectionName(''); setCollectionFiles([]);
    };

    // ── Mode tabs (3 buttons) ─────────────────────────────────────────────────
    const ModeTabs = () => (
        <>
          <div style={{ padding: '18px 20px 0' }}>
              <h1 className="hero-title">{uk ? 'Створити' : 'Create'}<br /><span className="accent">NFT</span></h1>
              <div className="seg" style={{ marginTop: 16 }}>
                <button
                    className={`seg-item ${mode === 'create' ? 'active' : ''}`}
                    onClick={() => { setMode('create'); setSelectedWalletNFT(null); }}
                >{uk ? 'Створити' : 'Create'}</button>
                <button
                    className={`seg-item ${mode === 'wallet' ? 'active' : ''}`}
                    onClick={() => setMode('wallet')}
                >{uk ? 'Продати' : 'Sell'}</button>
                <button
                    className={`seg-item ${mode === 'batch' ? 'active' : ''}`}
                    onClick={() => setMode('batch')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                >
                    {uk ? 'Пакет' : 'Batch'}
                    <span style={{ padding: '2px 5px', borderRadius: 5, background: mode === 'batch' ? 'rgba(255,255,255,0.25)' : 'var(--primary)', color: mode === 'batch' ? 'var(--on-primary)' : 'white', fontSize: 8.5, fontWeight: 800 }}>BIZ</span>
                </button>
              </div>
          </div>
          {!currentUser?.companyApproved && (
              <div style={{ margin: '12px 20px 0', padding: '12px 14px', borderRadius: 12, background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.22)', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.55 }}>
                  {uk
                    ? <><strong style={{ color: 'var(--warn)' }}>Неверифікований емітент:</strong> Idenity стягує 3% комісії з наступних перепродажів через платформу. Політика записується в on-chain metadata NFT; її виконання на зовнішніх маркетплейсах залежить від підтримки роялті.</>
                    : <><strong style={{ color: 'var(--warn)' }}>Unverified issuer:</strong> Idenity charges a 3% platform fee on subsequent resales made through Idenity. This policy is recorded in the NFT on-chain metadata. Enforcement on external marketplaces depends on their royalty support.</>}
              </div>
          )}
        </>
    );

    // ══════════════════════════════════════════════════════════════════════════
    // BATCH UPLOAD MODE
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === 'batch') {
        if (batchResult) {
            return (
                <div className="page active" style={s.page}>
                    <ModeTabs />
                    <div style={s.successBox}>
                        <div style={s.successCircle}>📦</div>
                        <h2 style={s.successTitle}>Batch Upload Complete!</h2>
                        <p style={s.successText}>
                            ✅ Created: <strong>{batchResult.created}</strong> &nbsp;
                            {batchResult.failed > 0 && <>❌ Failed: <strong>{batchResult.failed}</strong></>}
                        </p>
                        {batchResult.failed > 0 && batchResult.results?.filter((r: any) => r.status === 'error').map((r: any) => (
                            <div key={r.index} style={{ background: 'rgba(229,72,72,0.08)', border: '1px solid rgba(229,72,72,0.25)', borderRadius: '8px', padding: '8px 12px', marginBottom: '6px', fontSize: '12px', color: 'var(--danger)', textAlign: 'left', width: '100%' }}>
                                Item #{r.index + 1}: {r.message || 'Unknown error'}
                            </div>
                        ))}
                        <button style={s.primaryBtn} onClick={() => { setBatchResult(null); setBatchFiles([]); }}>
                            Upload Another Batch
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="page active" style={s.page}>
                <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
                <ModeTabs />
                <div style={{ ...s.stepContent, marginTop: '16px' }}>
                    <h2 style={s.stepTitle}>📦 Batch Upload</h2>
                    <p style={s.stepSub}>Upload multiple NFTs at once — designed for company use</p>

                    {/* Company notice */}
                    <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px', fontSize: '13px', color: 'var(--warn)' }}>
                        ⚠️ <strong>Note:</strong> Publishing each NFT in the batch will incur a <strong>1% platform fee</strong> on sales.
                    </div>

                    {/* File picker */}
                    <div style={s.field}>
                        <label style={s.fieldLabel}>Select Images *</label>
                        <input
                            ref={batchInputRef}
                            type="file" accept="image/*" multiple style={{ display: 'none' }}
                            onChange={e => {
                                const files = Array.from(e.target.files || []);
                                setBatchFiles(files);
                            }}
                        />
                        <button style={{ width: '100%', padding: '14px', background: 'var(--bg-soft)', border: '2px dashed var(--primary)', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', color: 'var(--text)' }}
                                onClick={() => batchInputRef.current?.click()}>
                            📁 {batchFiles.length > 0 ? `${batchFiles.length} file(s) selected` : 'Click to select multiple images'}
                        </button>
                        {batchFiles.length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                                {batchFiles.slice(0, 8).map((f, i) => (
                                    <div key={i} style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--primary-ink)' }}>
                                        {f.name.slice(0, 15)}{f.name.length > 15 ? '...' : ''}
                                    </div>
                                ))}
                                {batchFiles.length > 8 && <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px' }}>+{batchFiles.length - 8} more</div>}
                            </div>
                        )}
                    </div>

                    {/* Blockchain */}
                    <div style={s.field}>
                        <label style={s.fieldLabel}>Blockchain</label>
                        <div style={s.chipRow}>
                            {BLOCKCHAINS.map(b => (
                                <button key={b.id} style={{ ...s.chip, background: batchBlockchain === b.id ? 'var(--primary-soft)' : 'var(--bg-soft)', color: batchBlockchain === b.id ? 'var(--primary-ink)' : 'var(--text-muted)', borderColor: batchBlockchain === b.id ? 'var(--primary)' : 'transparent' }}
                                        onClick={() => { setBatchBlockchain(b.id); setBatchCurrency(b.currency); }}>
                                    {b.icon} {b.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Currency */}
                    <div style={s.field}>
                        <label style={s.fieldLabel}>Currency</label>
                        <div style={s.chipRow}>
                            {CURRENCIES.map(c => (
                                <button key={c} style={{ ...s.chip, background: batchCurrency === c ? 'var(--primary-soft)' : 'var(--bg-soft)', color: batchCurrency === c ? 'var(--primary-ink)' : 'var(--text-muted)', borderColor: batchCurrency === c ? 'var(--primary)' : 'transparent' }}
                                        onClick={() => setBatchCurrency(c)}>{c}</button>
                            ))}
                        </div>
                    </div>

                    {/* Royalty */}
                    <div style={s.field}>
                        <label style={s.fieldLabel}>Royalty: <strong style={{ color: 'var(--primary)' }}>{batchRoyalty}%</strong></label>
                        <input type="range" min="0" max="30" step="1" value={batchRoyalty}
                               onChange={e => setBatchRoyalty(e.target.value)} style={s.slider} />
                    </div>

                    {/* Tags */}
                    <div style={s.field}>
                        <label style={s.fieldLabel}>Tags (applied to all)</label>
                        <div style={s.tagInputRow}>
                            <input style={{ ...s.input, flex: 1, margin: 0 }} placeholder="#tag" value={batchTagInput}
                                   onChange={e => setBatchTagInput(e.target.value)}
                                   onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(batchTagInput, batchTags, setBatchTags, setBatchTagInput); }}} />
                            <button style={s.addTagBtn} onClick={() => addTag(batchTagInput, batchTags, setBatchTags, setBatchTagInput)}>Add</button>
                        </div>
                        {batchTags.length > 0 && (
                            <div style={s.tagsRow}>
                                {batchTags.map(tag => (
                                    <span key={tag} style={s.tagBadge}>
                                        #{tag}
                                        <button style={s.tagRemove} onClick={() => setBatchTags(batchTags.filter(t => t !== tag))}>✕</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* For sale toggle */}
                    <div style={s.toggleRow}>
                        <div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>List all for Sale</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Set a price for all NFTs in batch</div>
                        </div>
                        <div style={{ ...s.toggle, background: batchForSale ? 'var(--primary)' : 'var(--border-strong)' }} onClick={() => setBatchForSale(!batchForSale)}>
                            <div style={{ ...s.toggleThumb, left: batchForSale ? '26px' : '4px' }} />
                        </div>
                    </div>
                    {batchForSale && (
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Price per NFT ({batchCurrency})</label>
                            <input type="number" style={s.input} placeholder="0.00" min="0" step="0.001"
                                   value={batchPrice} onChange={e => setBatchPrice(e.target.value)} />
                        </div>
                    )}

                    <button
                        style={{ ...s.nextBtn, width: '100%', opacity: (batchFiles.length === 0 || batchLoading) ? 0.5 : 1 }}
                        onClick={handleBatchSubmit}
                        disabled={batchFiles.length === 0 || batchLoading}
                    >
                        {batchLoading
                            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span style={s.btnSpinner} /> Uploading {batchFiles.length} files...</span>
                            : `🚀 Upload ${batchFiles.length || 0} NFTs`
                        }
                    </button>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WALLET SELL MODE
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === 'wallet') {
        if (sellSuccess) {
            return (
                <div className="page active" style={s.page}>
                    <div style={s.successBox}>
                        <div style={s.successCircle}>💰</div>
                        <h2 style={s.successTitle}>NFT Listed!</h2>
                        <p style={s.successText}>
                            <strong>"{editTitle}"</strong> listed for <strong>{sellPrice} {sellCurrency}</strong>
                        </p>
                        {selectedWalletNFT && (
                            <img src={getNFTImage(selectedWalletNFT)} alt={editTitle} style={s.successPreview}
                                 onError={e => { e.currentTarget.src = '/img/default-nft.png'; }} />
                        )}
                        <button style={s.primaryBtn} onClick={() => { setSellSuccess(false); setSelectedWalletNFT(null); setSellPrice(''); setMode('create'); }}>+ Create New NFT</button>
                        <button style={{ ...s.primaryBtn, background: 'var(--bg-soft)', marginTop: '10px', color: 'var(--text)' }}
                                onClick={() => {
                                    setSellSuccess(false); setSelectedWalletNFT(null);
                                    setSellPrice(''); setEditTitle(''); setEditDescription(''); setEditTags([]);
                                    setWalletLoading(true);
                                    apiGetNFTs().then(nfts => { setWalletNFTs((nfts || []).filter((n: any) => !n.forSale)); setWalletLoading(false); });
                                }}>Sell Another</button>
                    </div>
                </div>
            );
        }

        return (
            <div className="page active" style={s.page}>
                <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
                <ModeTabs />

                {!selectedWalletNFT ? (
                    <div style={{ ...s.stepContent, marginTop: '16px' }}>
                        <h2 style={s.stepTitle}>Sell from Wallet</h2>
                        <p style={s.stepSub}>Choose an NFT from your collection</p>
                        {walletLoading ? (
                            <div style={{ textAlign: 'center', padding: '40px' }}>
                                <div style={s.miniSpinner} />
                                <p style={{ color: 'var(--text-muted)', marginTop: '12px' }}>Loading your NFTs...</p>
                            </div>
                        ) : walletNFTs.length === 0 ? (
                            <div style={s.emptyWallet}>
                                <div style={{ fontSize: '44px', marginBottom: '12px' }}>🖼</div>
                                <strong>No NFTs available to sell</strong>
                                <button style={{ ...s.primaryBtn, marginTop: '14px' }} onClick={() => setMode('create')}>Create New NFT</button>
                            </div>
                        ) : (
                            <div style={s.nftPickGrid}>
                                {walletNFTs.map((nft: any) => (
                                    <div key={nft.id} style={s.nftPickCard} onClick={() => setSelectedWalletNFT(nft)}>
                                        <img src={getNFTImage(nft)} alt={nft.title} style={s.nftPickImg}
                                             onError={e => { e.currentTarget.src = '/img/default-nft.png'; }} />
                                        <div style={s.nftPickOverlay}>
                                            <div style={s.nftPickTitle}>{nft.title}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--primary)' }}>Tap to select →</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ ...s.stepContent, marginTop: '16px' }}>
                        <h2 style={s.stepTitle}>Edit & List for Sale</h2>
                        <p style={s.stepSub}>Set price and details before listing</p>

                        {/* Fee notice */}
                        <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: 'var(--warn)' }}>
                            💡 Listing is free. A <strong>1% platform fee</strong> is applied when your NFT sells.
                        </div>

                        <div style={s.sellPreviewRow}>
                            <img src={getNFTImage(selectedWalletNFT)} alt={selectedWalletNFT.title} style={s.sellPreviewImg}
                                 onError={e => { e.currentTarget.src = '/img/default-nft.png'; }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Selected NFT</div>
                                <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{selectedWalletNFT.title}</div>
                            </div>
                            <button style={s.changeBtn} onClick={() => setSelectedWalletNFT(null)}>✕ Change</button>
                        </div>

                        {/* Title */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Title</label>
                            <input style={s.input} value={editTitle} maxLength={60} onChange={e => setEditTitle(e.target.value)} />
                            <span style={s.charCount}>{editTitle.length}/60</span>
                        </div>

                        {/* Description */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Description</label>
                            <textarea style={{ ...s.input, height: '80px', resize: 'none' } as any}
                                      value={editDescription} maxLength={300} onChange={e => setEditDescription(e.target.value)} />
                            <span style={s.charCount}>{editDescription.length}/300</span>
                        </div>

                        {/* Category */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Category</label>
                            <div style={s.chipRow}>
                                {CATEGORIES.map(cat => (
                                    <button key={cat} style={{ ...s.chip, background: editCategory === cat ? 'var(--primary-soft)' : 'var(--bg-soft)', color: editCategory === cat ? 'var(--primary-ink)' : 'var(--text-muted)', borderColor: editCategory === cat ? 'var(--primary)' : 'transparent' }}
                                            onClick={() => setEditCategory(cat)}>{cat}</button>
                                ))}
                            </div>
                        </div>

                        {/* Tags */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Tags (up to 8)</label>
                            <div style={s.tagInputRow}>
                                <input style={{ ...s.input, flex: 1, margin: 0 }} placeholder="#tag" value={editTagInput}
                                       onChange={e => setEditTagInput(e.target.value)}
                                       onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(editTagInput, editTags, setEditTags, setEditTagInput); }}} />
                                <button style={s.addTagBtn} onClick={() => addTag(editTagInput, editTags, setEditTags, setEditTagInput)}>Add</button>
                            </div>
                            {editTags.length > 0 && (
                                <div style={s.tagsRow}>
                                    {editTags.map(tag => (
                                        <span key={tag} style={s.tagBadge}>#{tag}<button style={s.tagRemove} onClick={() => setEditTags(editTags.filter(t => t !== tag))}>✕</button></span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ borderTop: '1px solid #f0f0f0', margin: '4px 0 18px' }} />

                        {/* Currency */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Currency</label>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as any }}>
                                {CURRENCIES.map(c => (
                                    <button key={c} style={{ ...s.chip, background: sellCurrency === c ? 'var(--primary-soft)' : 'var(--bg-soft)', color: sellCurrency === c ? 'var(--primary-ink)' : 'var(--text-muted)', borderColor: sellCurrency === c ? 'var(--primary)' : 'transparent' }}
                                            onClick={() => setSellCurrency(c)}>{c}</button>
                                ))}
                            </div>
                        </div>

                        {/* Price */}
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Listing Price ({sellCurrency})</label>
                            <input type="number" min="0" step="0.001" placeholder="e.g. 0.5"
                                   value={sellPrice} onChange={e => setSellPrice(e.target.value)} style={s.input} />
                            {sellPrice && !isNaN(parseFloat(sellPrice)) && parseFloat(sellPrice) > 0 && (
                                <div style={s.priceNote}>
                                    You receive <strong style={{ color: 'var(--primary)' }}>{parseFloat(sellPrice)} {sellCurrency}</strong> — buyer pays +1% platform fee
                                </div>
                            )}
                        </div>

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                            <button style={s.backBtn} onClick={() => setSelectedWalletNFT(null)} disabled={selling}>← Back</button>
                            <button
                                style={{ ...s.nextBtn, flex: 1, opacity: (!sellPrice || !editTitle.trim() || selling) ? 0.5 : 1 }}
                                onClick={handleSellFromWallet}
                                disabled={!sellPrice || !editTitle.trim() || selling}
                            >
                                {selling
                                    ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span style={s.btnSpinner} /> Listing...</span>
                                    : `💰 List for ${sellPrice || '?'} ${sellCurrency}`
                                }
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE NEW MODE
    // ══════════════════════════════════════════════════════════════════════════
    if (success) {
        return (
            <div className="page active" style={s.page}>
                <div style={s.successBox}>
                    <div style={s.successCircle}>🎨</div>
                    <h2 style={s.successTitle}>{isCollection ? 'Collection Created!' : 'NFT Created!'}</h2>
                    <p style={s.successText}>
                        <strong>"{title}"</strong> added to your Marki Wallet!
                        {forSale && price && ` Listed for ${price} ${currency}.`}
                    </p>
                    {previewUrl && <img src={previewUrl} alt={title} style={s.successPreview} />}
                    <button style={s.primaryBtn} onClick={handleReset}>+ Create Another</button>
                </div>
            </div>
        );
    }

    return (
        <div className="page active" style={s.page}>
            <style>{`
                @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
                @media(min-width:600px){
                    .nft-add-page-inner{max-width:560px;margin:0 auto;}
                    .nft-chip-row{flex-wrap:nowrap!important;overflow-x:auto;}
                    .nft-method-tabs{max-width:560px;margin:0 auto 16px;}
                }
                @media(max-width:400px){
                    .nft-step-content{padding:14px!important;}
                    .nft-chip-row button{font-size:11px!important;padding:5px 10px!important;}
                }
            `}</style>

            <ModeTabs />

            {/* Progress */}
            <div style={s.progressWrap}>
                {([1, 2, 3] as Step[]).map(i => (
                    <React.Fragment key={i}>
                        <div style={{ ...s.progressStep, background: step >= i ? 'var(--grad-cta)' : 'var(--bg-card)', border: step >= i ? 'none' : '1.5px solid var(--border-strong)', color: step >= i ? 'var(--on-primary)' : 'var(--text-faint)', boxShadow: step >= i ? 'var(--shadow-chip)' : 'none' }}>
                            {step > i ? '✓' : i}
                        </div>
                        {i < 3 && <div style={{ ...s.progressLine, background: step > i ? 'linear-gradient(to right, #12c07e, var(--border-strong))' : 'var(--border-strong)' }} />}
                    </React.Fragment>
                ))}
            </div>
            <div style={s.stepLabels}>
                <span style={step === 1 ? s.labelActive : s.label}>{uk ? 'Файл' : 'Upload'}</span>
                <span style={step === 2 ? s.labelActive : s.label}>{uk ? 'Блокчейн' : 'Blockchain'}</span>
                <span style={step === 3 ? s.labelActive : s.label}>{uk ? 'Ціна' : 'Price'}</span>
            </div>

            {/* Step 1 */}
            {step === 1 && (
                <div style={s.stepContent}>
                    <h2 style={s.stepTitle}>{uk ? 'Завантажте ваше NFT' : 'Upload your NFT'}</h2>

                    {/* Collection toggle */}
                    <div style={{ ...s.toggleRow, marginBottom: '16px' }}>
                        <div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>{uk ? 'Створити як колекцію' : 'Create as Collection'}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{uk ? 'Об’єднайте пов’язані NFT в одну колекцію' : 'Group related NFTs into a collection'}</div>
                        </div>
                        <div style={{ ...s.toggle, background: isCollection ? 'var(--primary)' : 'var(--border-strong)' }} onClick={() => setIsCollection(!isCollection)}>
                            <div style={{ ...s.toggleThumb, left: isCollection ? '26px' : '4px' }} />
                        </div>
                    </div>

                    {isCollection && (
                        <div style={s.field}>
                            <label style={s.fieldLabel}>{uk ? 'Назва колекції' : 'Collection Name'}</label>
                            <input style={s.input} placeholder="e.g. Cosmic Dreams Series"
                                   value={collectionName} maxLength={60}
                                   onChange={e => setCollectionName(e.target.value)} />
                            <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '8px', padding: '8px 12px', marginTop: '8px', fontSize: '12px', color: 'var(--warn)' }}>
                                ⚠️ Publishing this collection will apply a <strong>1% platform fee</strong> on all sales within the collection.
                            </div>
                        </div>
                    )}

                    {isCollection ? (
                        /* ── Collection multi-file picker ── */
                        <div>
                            <div
                                style={{ ...s.dropZone, borderColor: collectionFiles.length > 0 ? 'var(--primary)' : 'var(--border-strong)', background: collectionFiles.length > 0 ? 'var(--primary-faint)' : 'var(--bg-soft)', cursor: 'pointer' }}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {collectionFiles.length > 0 ? (
                                    <div style={{ width: '100%', padding: '12px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '10px' }}>
                                            {collectionFiles.slice(0, 8).map((f, i) => (
                                                <div key={i} style={{ aspectRatio: '1', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-soft)' }}>
                                                    <img src={URL.createObjectURL(f)} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ fontSize: '13px', color: 'var(--primary-ink)', textAlign: 'center' }}>
                                            {collectionFiles.length} image{collectionFiles.length !== 1 ? 's' : ''} selected — click to change
                                        </div>
                                    </div>
                                ) : (
                                    <div style={s.dropContent}>
                                        <div style={{ fontSize: '40px', marginBottom: '10px' }}>🖼</div>
                                        <p style={{ fontWeight: 'bold', color: 'var(--text)', marginBottom: '4px' }}>{uk ? 'Оберіть кілька зображень' : 'Select multiple images'}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '4px' }}>Hold Ctrl / ⌘ to select many at once</p>
                                        <p style={{ color: 'var(--text-faint)', fontSize: '11px' }}>JPG, PNG, GIF, WebP · Max 10MB each</p>
                                    </div>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                                   onChange={e => {
                                       const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024);
                                       if (files.length >= 2) {
                                           // 2+ photos = auto-collection
                                           setIsCollection(true);
                                           setCollectionFiles(files);
                                           setSelectedFile(null);
                                           setPreviewUrl('');
                                       } else if (files.length === 1) {
                                           setIsCollection(false);
                                           setCollectionFiles([]);
                                           setSelectedFile(files[0]);
                                           setPreviewUrl(URL.createObjectURL(files[0]));
                                       }
                                   }} />
                        </div>
                    ) : (
                        /* ── Single-file picker ── */
                        <div>
                            {/* ── AI Generate button ── */}
                            {!previewUrl && (
                                <div style={{ marginBottom: '12px' }}>
                                    <button
                                        style={{ width: '100%', padding: '12px', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 999, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}
                                        onClick={() => { setShowAiPanel(!showAiPanel); setAiError(''); }}
                                    >
                                        ✨ {uk ? 'Створити за допомогою AI' : 'Generate with AI'}
                                    </button>
                                    {showAiPanel && (
                                        <div style={{ background: 'var(--primary-faint)', border: '1px solid var(--primary-soft)', borderRadius: 14, padding: 14, marginTop: 10 }}>

                                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Describe your NFT image</div>
                                            <textarea
                                                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)', borderRadius: 12, fontSize: 14, background: 'var(--bg-card)', color: 'var(--text)', resize: 'none', height: 80, boxSizing: 'border-box', outline: 'none', marginBottom: 10, fontFamily: 'inherit' } as React.CSSProperties}
                                                placeholder="e.g. cyberpunk cat in the city, neon lights, 4k"
                                                value={aiPrompt}
                                                onChange={e => setAiPrompt(e.target.value)}
                                            />

                                            {aiStatus && !aiError && (
                                                <div style={{ fontSize: 12, color: 'var(--primary-ink)', background: 'var(--primary-faint)', border: '1px solid var(--primary-soft)', borderRadius: 10, padding: '8px 10px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={s.btnSpinner} />
                                                    {aiStatus}
                                                </div>
                                            )}

                                            {aiError && (
                                                <div style={{ color: 'var(--danger)', fontSize: 12, background: 'rgba(229,72,72,0.08)', border: '1px solid rgba(229,72,72,0.25)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
                                                    {aiError}
                                                </div>
                                            )}

                                            <button
                                                style={{ width: '100%', padding: 11, background: (aiGenerating || !aiPrompt.trim()) ? 'var(--border-strong)' : 'var(--primary)', color: 'white', border: 'none', borderRadius: 999, fontWeight: 600, fontSize: 14, cursor: (aiGenerating || !aiPrompt.trim()) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}
                                                onClick={handleAiGenerate}
                                                disabled={aiGenerating || !aiPrompt.trim()}
                                            >
                                                {aiGenerating
                                                    ? <><span style={s.btnSpinner} /> {aiStatus || 'Generating...'}</>
                                                    : '✨ Generate Image'
                                                }
                                            </button>
                                            <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginTop: 8 }}>
                                                Powered by Stable Horde · Free · No API key needed
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div
                                style={{ ...s.dropZone, borderColor: dragOver ? 'var(--primary)' : previewUrl ? 'var(--primary)' : 'var(--border-strong)', background: dragOver ? 'var(--primary-faint)' : previewUrl ? 'var(--primary-faint)' : 'var(--bg-soft)' }}
                                onClick={() => !previewUrl && fileInputRef.current?.click()}
                                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                            >
                                {previewUrl ? (
                                    <div style={s.previewWrap}>
                                        <img src={previewUrl} alt="preview" style={s.previewImg} />
                                        <button style={s.removeImgBtn} onClick={e => { e.stopPropagation(); setPreviewUrl(''); setSelectedFile(null); }}>✕ Change</button>
                                    </div>
                                ) : (
                                    <div style={s.dropContent}>
                                        <div style={{ fontSize: '40px', marginBottom: '10px' }}>📁</div>
                                        <p style={{ fontWeight: 'bold', color: 'var(--text)', marginBottom: '4px' }}>{uk ? 'Перетягніть файл або натисніть для вибору' : 'Drag & drop or click to browse'}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '4px' }}>{uk ? '2+ зображення автоматично створять колекцію' : 'Select 2+ images → auto-collection'}</p>
                                        <p style={{ color: 'var(--text-faint)', fontSize: '11px' }}>JPG, PNG, GIF, WebP · Max 10MB</p>
                                    </div>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                                   onChange={e => {
                                       const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024);
                                       if (files.length >= 2) {
                                           setIsCollection(true);
                                           setCollectionFiles(files);
                                           setSelectedFile(null);
                                           setPreviewUrl('');
                                       } else if (files.length === 1) {
                                           processFile(files[0]);
                                       }
                                   }} />
                        </div>
                    )}

                    <div style={s.field}>
                        <label style={s.fieldLabel}>{uk ? 'Назва NFT *' : 'NFT Title *'}</label>
                        <input style={s.input} placeholder="e.g. Cosmic Dream #1" value={title} maxLength={60} onChange={e => setTitle(e.target.value)} />
                        <span style={s.charCount}>{title.length}/60</span>
                    </div>
                    <div style={s.field}>
                        <label style={s.fieldLabel}>{uk ? 'Опис *' : 'Description *'}</label>
                        <textarea style={{ ...s.input, height: '90px', resize: 'none' } as any}
                                  placeholder={uk ? 'Опишіть ваше NFT...' : 'Describe your NFT...'} value={description} maxLength={300}
                                  onChange={e => setDescription(e.target.value)} />
                        <span style={s.charCount}>{description.length}/300</span>
                    </div>
                    <div style={s.field}>
                        <label style={s.fieldLabel}>{uk ? 'Категорія' : 'Category'}</label>
                        <div style={s.chipRow}>
                            {CATEGORIES.map(cat => (
                                <button key={cat} style={{ ...s.chip, background: category === cat ? 'var(--primary-soft)' : 'var(--bg-soft)', color: category === cat ? 'var(--primary-ink)' : 'var(--text-muted)', borderColor: category === cat ? 'var(--primary)' : 'transparent' }}
                                        onClick={() => setCategory(cat)}>{cat}</button>
                            ))}
                        </div>
                    </div>
                    <div style={s.field}>
                        <label style={s.fieldLabel}>{uk ? 'Теги (до 8)' : 'Tags (up to 8)'}</label>
                        <div style={s.tagInputRow}>
                            <input style={{ ...s.input, flex: 1, margin: 0 }} placeholder="#tag" value={tagInput}
                                   onChange={e => setTagInput(e.target.value)}
                                   onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput, tags, setTags, setTagInput); }}} />
                            <button style={s.addTagBtn} onClick={() => addTag(tagInput, tags, setTags, setTagInput)}>{uk ? 'Додати' : 'Add'}</button>
                        </div>
                        {tags.length > 0 && (
                            <div style={s.tagsRow}>
                                {tags.map(tag => (
                                    <span key={tag} style={s.tagBadge}>#{tag}<button style={s.tagRemove} onClick={() => setTags(tags.filter(t => t !== tag))}>✕</button></span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
                <div style={s.stepContent}>
                    <h2 style={s.stepTitle}>{uk ? 'Оберіть блокчейн' : 'Choose Blockchain'}</h2>
                    {BLOCKCHAINS.map(chain => (
                        <div key={chain.id} style={{ ...s.chainCard, borderColor: blockchain === chain.id ? 'var(--primary)' : 'var(--border)', background: blockchain === chain.id ? 'var(--primary-faint)' : 'var(--bg-card)' }}
                             onClick={() => { setBlockchain(chain.id); setCurrency(chain.currency); }}>
                            <span style={{ fontSize: '28px', flexShrink: 0 }}>{chain.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', color: 'var(--text)', fontSize: '15px' }}>{chain.name}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Fee: {chain.fee}</div>
                            </div>
                            <div style={{ ...s.chainRadio, background: blockchain === chain.id ? 'var(--primary)' : 'var(--bg-card)', borderColor: blockchain === chain.id ? 'var(--primary)' : 'var(--border-strong)' }}>
                                {blockchain === chain.id && <span style={s.chainRadioDot} />}
                            </div>
                        </div>
                    ))}

                    {/* Multi-edition — only for single NFT (not collection) on Solana */}
                    {!isCollection && (
                        <div style={s.field}>
                            <label style={s.fieldLabel}>
                                Editions:&nbsp;
                                <strong style={{ color: 'var(--primary)' }}>
                                    {editionCount === '1' ? '1 (unique)' : `${editionCount} copies`}
                                </strong>
                            </label>
                            <input
                                type="range" min="1" max="100" step="1"
                                value={editionCount}
                                onChange={e => setEditionCount(e.target.value)}
                                style={s.slider}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px' }}>
                                <span>1 (unique)</span><span>50</span><span>100</span>
                            </div>
                            {parseInt(editionCount) > 1 && (
                                <div style={{ background: 'var(--primary-faint)', border: '1px solid var(--primary-soft)', borderRadius: '10px', padding: '10px 12px', fontSize: '12px', color: 'var(--primary-ink)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                    <span style={{ fontSize: '16px', flexShrink: 0 }}>◎</span>
                                    <span>
                                        <strong>Master Edition</strong> + <strong>{editionCount} Print Editions</strong> will be minted on Solana.
                                        Each edition is a unique on-chain token.
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={s.field}>
                        <label style={s.fieldLabel}>{uk ? 'Роялті' : 'Royalty'}: <strong style={{ color: 'var(--primary)' }}>{royalty}%</strong></label>
                        <input type="range" min="0" max="30" step="1" value={royalty} onChange={e => setRoyalty(e.target.value)} style={s.slider} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-faint)' }}>
                            <span>0%</span><span>15%</span><span>30%</span>
                        </div>
                        <div style={{ marginTop: 10, padding: '11px 12px', borderRadius: 10, background: 'var(--primary-faint)', color: 'var(--primary-ink)', fontSize: 12, lineHeight: 1.55 }}>
                            {uk
                              ? 'Роялті — це відсоток від кожного наступного перепродажу NFT, який отримує його початковий автор або бренд. Наприклад, при роялті 10% і перепродажі за 1 SOL автор отримає 0,1 SOL.'
                              : 'Royalty is the percentage of each future NFT resale paid to its original creator or brand. For example, with a 10% royalty and a 1 SOL resale, the creator receives 0.1 SOL.'}
                        </div>
                    </div>
                </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
                <div style={s.stepContent}>
                    <h2 style={s.stepTitle}>{uk ? 'Перевірка та ціна' : 'Review & Price'}</h2>
                    {previewUrl && (
                        <div style={s.reviewCard}>
                            <img src={previewUrl} alt={title} style={s.reviewImg} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '15px', color: 'var(--text)', marginBottom: '4px' }}>{title}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{description.slice(0, 80)}{description.length > 80 ? '...' : ''}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{BLOCKCHAINS.find(b => b.id === blockchain)?.icon} {blockchain} · Royalty {royalty}%</div>
                                {!isCollection && parseInt(editionCount) > 1 && (
                                    <div style={{ fontSize: '12px', color: 'var(--primary-ink)', marginTop: '4px' }}>◎ {editionCount} editions (Master + Prints)</div>
                                )}
                                {isCollection && collectionName && (
                                    <div style={{ fontSize: '12px', color: 'var(--primary)', marginTop: '4px' }}>📚 Collection: {collectionName}</div>
                                )}
                            </div>
                        </div>
                    )}

                    <div style={s.toggleRow}>
                        <div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>{uk ? 'Виставити на продаж' : 'List for Sale'}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{uk ? 'Зробити доступним для покупки' : 'Make available to buy'}</div>
                        </div>
                        <div style={{ ...s.toggle, background: forSale ? 'var(--primary)' : 'var(--border-strong)' }} onClick={() => setForSale(!forSale)}>
                            <div style={{ ...s.toggleThumb, left: forSale ? '26px' : '4px' }} />
                        </div>
                    </div>

                    {forSale && (
                        <>
                            <div style={s.field}>
                                <label style={s.fieldLabel}>Price</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="number" style={{ ...s.input, flex: 1, margin: 0 }}
                                           placeholder="0.00" min="0" step="0.001"
                                           value={price} onChange={e => setPrice(e.target.value)} />
                                    <select style={s.currencySelect} value={currency} onChange={e => setCurrency(e.target.value)}>
                                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                {price && !isNaN(parseFloat(price)) && (
                                    <div style={s.priceNote}>
                                        Buyer pays: <strong>{(parseFloat(price) * 1.01).toFixed(4)} {currency}</strong> (includes 1% platform fee)
                                    </div>
                                )}
                            </div>

                            {/* Fee notice for collections */}
                            {isCollection && (
                                <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: 'var(--warn)' }}>
                                    📚 <strong>Collection fee:</strong> Publishing this collection applies a <strong>1% platform fee</strong> on all sales.
                                </div>
                            )}
                        </>
                    )}

                </div>
            )}

            {/* Navigation */}
            <div style={s.navRow}>
                {step > 1 && (
                    <button style={s.backBtn} onClick={() => setStep((step - 1) as Step)} disabled={loading}>← {uk ? 'Назад' : 'Back'}</button>
                )}
                {step < 3 ? (
                    <button style={{ ...s.nextBtn, opacity: canGoNext() ? 1 : 0.5, flex: step === 1 ? 1 : undefined }}
                            onClick={() => setStep((step + 1) as Step)} disabled={!canGoNext()}>
                        {uk ? 'Далі' : 'Next'} →
                    </button>
                ) : (
                    !walletReady ? (
                        <button style={{ ...s.nextBtn, flex: 1, background: 'var(--primary)' }}
                                onClick={async () => {
                                    try {
                                        const pk = await connectPhantom();
                                        console.log('[Phantom] connected, publicKey =', pk);
                                    } catch (e: any) {
                                        console.error('[Phantom] connect failed', e);
                                        alert(`Phantom connect failed: ${e?.message ?? e} (Code: ${e?.code})`);
                                    }
                                }}>
                            👻 Connect Phantom Wallet
                        </button>
                    ) : (
                        <button style={{ ...s.nextBtn, flex: 1, opacity: loading ? 0.7 : 1 }}
                                onClick={handleCreateSubmit} disabled={loading}>
                            {loading
                                ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span style={s.btnSpinner} />{uploadProgress || 'Creating...'}</span>
                                : <span>🚀 {forSale ? `Create & List ${isCollection ? 'Collection' : 'NFT'}` : `Save to Wallet`}</span>
                            }
                        </button>
                    )
                )}
            </div>
        </div>
    );
};

// ─── Styles — design tokens (light theme, emerald accent) ────────────────────
const s: any = {
    page:          { background: 'var(--bg-page)', minHeight: '100vh', paddingBottom: '100px' },
    modeTabs:      { display: 'flex', margin: '16px 20px 0', background: 'var(--bg-soft)', borderRadius: 12, padding: 4, gap: 4 },
    modeTab:       { flex: 1, padding: '10px', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text-muted)', background: 'transparent', position: 'relative', fontFamily: 'inherit' },
    progressWrap:  { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 30px 8px', gap: 8 },
    progressStep:  { width: 30, height: 30, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0, background: 'var(--bg-card)', color: 'var(--text-faint)' },
    progressLine:  { flex: 1, height: 2 },
    stepLabels:    { display: 'flex', justifyContent: 'space-between', padding: '0 28px', marginBottom: 16 },
    label:         { fontSize: 11, color: 'var(--text-faint)', flex: 1, textAlign: 'center', fontWeight: 600 },
    labelActive:   { fontSize: 11, color: 'var(--text)', fontWeight: 700, flex: 1, textAlign: 'center' },
    stepContent:   { background: 'var(--bg-card)', margin: '0 20px', borderRadius: 20, padding: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' },
    stepTitle:     { fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4, letterSpacing: '-0.02em' },
    stepSub:       { fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 },
    miniSpinner:   { width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' },
    emptyWallet:   { textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' },
    nftPickGrid:   { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 },
    nftPickCard:   { position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '1', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)' },
    nftPickImg:    { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    nftPickOverlay:{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', padding: 10, color: 'white' },
    nftPickTitle:  { fontWeight: 700, fontSize: 13, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    sellPreviewRow:{ display: 'flex', gap: 12, background: 'var(--bg-soft)', borderRadius: 14, padding: 12, marginBottom: 18, alignItems: 'center', position: 'relative' },
    sellPreviewImg:{ width: 60, height: 60, borderRadius: 10, objectFit: 'cover', flexShrink: 0 },
    changeBtn:     { background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 999, padding: '5px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'inherit' },
    priceNote:     { fontSize: 12, color: 'var(--text-muted)', marginTop: 6, padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 10 },
    dropZone:      { border: '2px dashed var(--border-strong)', borderRadius: 20, minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 20, transition: 'all 0.2s', overflow: 'hidden', background: 'var(--primary-faint)' },
    dropContent:   { textAlign: 'center', padding: 20 },
    previewWrap:   { position: 'relative', width: '100%' },
    previewImg:    { width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' },
    removeImgBtn:  { position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 999, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
    field:         { marginBottom: 18 },
    fieldLabel:    { display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 },
    input:         { width: '100%', padding: '13px 14px', border: '1px solid var(--border-strong)', borderRadius: 14, fontSize: 14, background: 'var(--bg-card)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
    charCount:     { fontSize: 11, color: 'var(--text-faint)', float: 'right', marginTop: 3 },
    chipRow:       { display: 'flex', flexWrap: 'wrap', gap: 8 },
    chip:          { padding: '6px 12px', border: '1px solid transparent', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: 'var(--bg-soft)', color: 'var(--text-muted)' },
    tagInputRow:   { display: 'flex', gap: 8, marginBottom: 10 },
    addTagBtn:     { padding: '0 18px', background: 'var(--grad-cta)', color: 'var(--on-primary)', border: 'none', borderRadius: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 14, fontFamily: 'inherit' },
    tagsRow:       { display: 'flex', flexWrap: 'wrap', gap: 8 },
    tagBadge:      { background: 'var(--primary-soft)', color: 'var(--primary-ink)', border: '1px solid var(--primary)', borderRadius: 999, padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 },
    tagRemove:     { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-ink)', fontSize: 11, padding: 0, fontFamily: 'inherit' },
    chainCard:     { display: 'flex', alignItems: 'center', gap: 14, border: '2px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12, cursor: 'pointer', background: 'var(--bg-card)' },
    chainRadio:    { width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--bg-card)' },
    chainRadioDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--bg-card)' },
    slider:        { width: '100%', accentColor: 'var(--primary)', marginBottom: 4 },
    reviewCard:    { display: 'flex', gap: 14, background: 'var(--bg-soft)', borderRadius: 14, padding: 14, marginBottom: 20 },
    reviewImg:     { width: 80, height: 80, borderRadius: 12, objectFit: 'cover' },
    toggleRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-soft)', borderRadius: 14, padding: 16, marginBottom: 16 },
    toggle:        { width: 50, height: 28, borderRadius: 14, position: 'relative', cursor: 'pointer', transition: 'background 0.3s', flexShrink: 0 },
    toggleThumb:   { position: 'absolute', width: 20, height: 20, background: 'var(--bg-card)', borderRadius: '50%', top: 4, transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
    currencySelect:{ padding: '14px 12px', border: '1px solid transparent', borderRadius: 12, background: 'var(--bg-soft)', fontSize: 15, fontWeight: 600, minWidth: 90, color: 'var(--text)', fontFamily: 'inherit' },
    navRow:        { display: 'flex', gap: 12, padding: '16px 20px', position: 'sticky', bottom: 70, background: 'linear-gradient(transparent, var(--bg-page) 30%)' },
    backBtn:       { padding: '12px 22px', background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 16, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit' },
    nextBtn:       { padding: '15px 30px', background: 'var(--grad-cta)', color: 'var(--on-primary)', border: 'none', borderRadius: 16, fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-cta)' },
    btnSpinner:    { width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' },
    successBox:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', textAlign: 'center' },
    successCircle: { width: 96, height: 96, background: 'var(--grad-fab)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, marginBottom: 20, color: 'white', boxShadow: '0 16px 40px rgba(18,192,126,0.35)' },
    successTitle:  { fontSize: 26, fontWeight: 700, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.02em' },
    successText:   { fontSize: 15, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 },
    successPreview:{ width: 180, height: 180, borderRadius: 16, objectFit: 'cover', marginBottom: 24, boxShadow: 'var(--shadow-lg)' },
    primaryBtn:    { padding: '15px 36px', background: 'var(--grad-cta)', color: 'var(--on-primary)', border: 'none', borderRadius: 16, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-cta)' },
};

export default AddNFTPage;
