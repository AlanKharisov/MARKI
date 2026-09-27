import { auth } from '../firebase/config';
import { Capacitor } from '@capacitor/core';

const LOCAL_API_URL = 'http://localhost:8090';
const PROD_API_URL = 'https://idenity.onrender.com';

const envApiUrl = process.env.REACT_APP_API_URL;
const isLoopbackUrl = (url?: string) =>
    Boolean(url && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(url));

// localhost inside a Capacitor Android WebView points to the phone/emulator,
// not to the developer's Mac. Never bake a loopback API into a native APK.
const BASE_URL = Capacitor.isNativePlatform() && isLoopbackUrl(envApiUrl)
    ? PROD_API_URL
    : process.env.NODE_ENV === 'development'
        ? envApiUrl || LOCAL_API_URL
        : (envApiUrl || PROD_API_URL);

console.log('[API] API_BASE_URL:', BASE_URL);

async function getToken(): Promise<string | null> {
    try {
        return (await auth.currentUser?.getIdToken()) ?? null;
    } catch {
        return null;
    }
}

async function req<T>(
    method: string,
    path: string,
    body?: any,
    asForm = false
): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body && !asForm) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: asForm ? body : body != null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(msg || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
}

const get       = <T>(path: string)                    => req<T>('GET',    path);
const post      = <T>(path: string, b?: any)           => req<T>('POST',   path, b);
const put       = <T>(path: string, b?: any)           => req<T>('PUT',    path, b);
const del       = <T>(path: string)                    => req<T>('DELETE', path);
const postForm  = <T>(path: string, form: FormData)    => req<T>('POST',   path, form, true);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const apiRegister = (d: {
    uid: string; name: string; username: string; email: string; phone?: string;
}) => post<any>('/api/auth/register', d);

export const apiMe = () => get<any>('/api/auth/me');

// ── Profile ───────────────────────────────────────────────────────────────────
export const apiGetProfile    = (uid: string)          => get<any>(`/api/profile/${uid}`);
export const apiUpdateProfile = (uid: string, d: any)  => put<any>(`/api/profile/${uid}`, d);

export const apiUploadAvatar = (uid: string, file: File) => {
    const f = new FormData();
    f.append('avatar', file);
    return postForm<{ url: string }>(`/api/profile/${uid}/avatar`, f);
};

export const apiChangePassword = (uid: string, d: { newPassword: string }) =>
    put<any>(`/api/profile/${uid}/password`, d);

export const apiRequestApproval = (uid: string, d: {
    companyName: string;
    registrationNumber: string;
    contactEmail: string;
    description: string;
}) => post<any>(`/api/profile/${uid}/request-approval`, d);

// ── Marki Wallet ──────────────────────────────────────────────────────────────
export const apiGetMarkiWallet    = ()                    => get<any>('/api/wallets/marki');
export const apiUpdateMarkiEmail  = (newEmail: string)    => put<any>('/api/wallets/marki/email', { newEmail });
export const apiUpdateFingerprint = (enabled: boolean)    => put<any>('/api/wallets/marki/fingerprint', { enabled });

// ── Crypto Wallets (Phantom only) ─────────────────────────────────────────────
export const apiGetCryptoWallets    = ()                  => get<any[]>('/api/wallets/crypto');
export const apiAddCryptoWallet     = (d: { address: string; label?: string }) =>
    post<any>('/api/wallets/crypto', d);
export const apiRemoveCryptoWallet  = (id: string)        => del<any>(`/api/wallets/crypto/${id}`);
export const apiRefreshWalletBalance = (id: string)       => put<any>(`/api/wallets/crypto/${id}/balance`);

// ── NFTs ──────────────────────────────────────────────────────────────────────
export const apiGetMintInfo = () => get<{
    mintCount:          number;
    isFree:             boolean;
    commissionLamports: number;
}>('/api/nfts/mint-info');

export const apiGetNFTs   = ()                            => get<any[]>('/api/nfts');
export const apiGetNFT    = (id: string)                   => get<any>(`/api/nfts/${id}`);
export const apiVerifyNFT = (d: { nftId: string; ownerId: string }) => post<{
    issuedByIdenity: boolean;
    issuerVerified: boolean;
    issuerName: string;
    nft: any;
}>('/api/nfts/verify', d);
export const apiCreateNFT = (form: FormData)              => postForm<any>('/api/nfts', form);
export const apiUpdateNFT = (id: string, d: any)          => put<any>(`/api/nfts/${id}`, d);
export const apiDeleteNFT = (id: string)                  => del<any>(`/api/nfts/${id}`);
export const apiBatchCreate = (form: FormData)            => postForm<any>('/api/nfts/batch', form);
export const apiCreateEditionNFTs = (form: FormData)      => postForm<{
    masterId:     string;
    metadataUri:  string;
    imageUrl:     string;
    editionIds:   string[];
    editionCount: number;
}>('/api/nfts/editions', form);

// ── Posts ─────────────────────────────────────────────────────────────────────
export const apiGetPosts   = ()                           => get<any[]>('/api/posts');
export const apiCreatePost = (d: any)                     => post<any>('/api/posts', d);
export const apiDeletePost = (id: string)                 => del<any>(`/api/posts/${id}`);
export const apiLikePost   = (id: string)                 => post<any>(`/api/posts/${id}/like`);
export const apiAddComment = (id: string, text: string)   => post<any>(`/api/posts/${id}/comments`, { text });

// ── Marketplace ───────────────────────────────────────────────────────────────
export const apiBuyNFT = (d: {
    postId: string;
    buyerWalletId: string;
    nftId: string;
}) => post<any>('/api/marketplace/buy', d);

export type PaymentQuote = {
    quoteId: string;
    sourcePrice: number;
    sourceCurrency: string;
    sellerLamports: number;
    feeLamports: number;
    totalLamports: number;
    expiresAtUnix: number;
};

export const apiGetPaymentQuote = (nftId: string, postId: string) =>
    post<PaymentQuote>(`/api/nfts/${nftId}/payment-quote`, { postId });

/** Called immediately after an on-chain Solana transaction confirms.
 *  Syncs Firestore: moves the NFT from the seller's wallet to the buyer's
 *  wallet and marks the post as no longer for sale. */
export const apiTransferNFT = (
    nftId:    string,   // wallet NFT ID (nft.walletNftId || nft.id)
    sellerId: string,   // seller's Firebase UID (nft.userId)
    postId:   string,   // marketplace post ID
    signature: string,  // confirmed Solana payment signature
    payerAddress: string,
    quoteId: string,
) => post<{ success: boolean; newNftId: string }>(
    `/api/nfts/${nftId}/transfer`,
    { sellerId, postId, signature, payerAddress, quoteId },
);

export const apiCashOnDelivery = (d: {
    postId: string;
    nftId: string;
    deliveryAddress: string;
    currency: string;
    fullName: string;
    phone: string;
}) => post<any>('/api/marketplace/cod', d);

// ── COD orders (CRM inbox) ────────────────────────────────────────────────────
export type CodOrder = {
    id: string;
    postId: string;
    nftId: string;
    nftTitle: string;
    buyerId: string;
    buyerName: string;
    sellerId: string;
    price: number;
    nftCurrency: string;
    paymentCurrency: string;
    deliveryAddress: string;
    fullName: string;
    phone: string;
    status: 'pending' | 'in_delivery' | 'completed' | 'cancelled';
    createdAt: string;
    deliveryId?: string;
};

export const apiListCodOrders = () => get<CodOrder[]>('/api/cod-orders');
export const apiAcceptCodOrder = (id: string, d: {
    carrierType: 'self' | 'nova_poshta';
    npTrackingNumber?: string;
    courierId?: string;
    controllerId?: string;
    nfcUid?: string;
}) => post<Delivery>(`/api/cod-orders/${id}/accept`, d);

// ── AI image generation ───────────────────────────────────────────────────────
export const apiAiGenerateImage = (prompt: string): Promise<Blob> =>
    fetch(`${BASE_URL}/api/ai/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt }),
    }).then(res => {
        if (!res.ok) return res.text().then(t => Promise.reject(new Error(t || `HTTP ${res.status}`)));
        return res.blob();
    });

// ── Notifications ─────────────────────────────────────────────────────────────
export const apiGetNotifications   = ()                   => get<any[]>('/api/notifications');
export const apiMarkRead           = (id: string)         => put<any>(`/api/notifications/${id}/read`);
export const apiMarkAllRead        = ()                   => put<any>('/api/notifications/read-all');
export const apiDeleteNotification = (id: string)         => del<any>(`/api/notifications/${id}`);

// ── Deliveries (CRM) ──────────────────────────────────────────────────────────
export type DeliveryCheckpoint = {
    id: string;
    status: string;
    location: string;
    timestamp: string;
    recordedBy: string;
    recordedByName?: string;
    note?: string;
};

export type Delivery = {
    id: string;
    orderId?: string;
    nftId: string;
    nftTitle: string;
    sellerId: string;
    buyerId: string;
    buyerName: string;
    deliveryAddress: string;
    carrierType: 'self' | 'nova_poshta';
    courierId?: string;
    courierName?: string;
    controllerId?: string;
    controllerName?: string;
    npTrackingNumber?: string;
    npLastSyncedAt?: string;
    status: string;
    checkpoints: DeliveryCheckpoint[];
    customerReceived: boolean;
    receivedAt?: string;
    nfcUid?: string;
    nfcVerified: boolean;
    nfcVerifiedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export const apiListDeliveries = () => get<Delivery[]>('/api/deliveries');
export const apiGetDelivery    = (id: string) => get<Delivery>(`/api/deliveries/${id}`);

export const apiCreateDelivery = (d: {
    orderId?: string;
    nftId: string;
    buyerId: string;
    deliveryAddress: string;
    carrierType: 'self' | 'nova_poshta';
    npTrackingNumber?: string;
    courierId?: string;
    controllerId?: string;
    nfcUid?: string;
}) => post<Delivery>('/api/deliveries', d);

export const apiUpdateCarrier = (id: string, d: {
    carrierType: 'self' | 'nova_poshta';
    npTrackingNumber?: string;
    courierId?: string;
    controllerId?: string;
}) => put<Delivery>(`/api/deliveries/${id}/carrier`, d);

export const apiUpdateDeliveryStatus = (id: string, status: string) =>
    put<Delivery>(`/api/deliveries/${id}/status`, { status });

export const apiAddCheckpoint = (id: string, d: {
    status: string;
    location: string;
    note?: string;
}) => post<Delivery>(`/api/deliveries/${id}/checkpoints`, d);

export const apiSyncNovaPoshta = (id: string) =>
    post<Delivery>(`/api/deliveries/${id}/sync-novaposhta`);

export const apiConfirmReceipt = (id: string) =>
    post<Delivery>(`/api/deliveries/${id}/confirm-receipt`);

// ── NFC ───────────────────────────────────────────────────────────────────────
export const apiBindNfc = (d: { nftId: string; nfcUid: string }) =>
    post<{ success: boolean; nfcUid: string; nftId: string }>('/api/nfc/bind', d);

export const apiVerifyNfc = (nfcUid: string) =>
    post<{
        nftId: string;
        nftTitle: string;
        ownerId: string;
        ownerName: string;
        mintAddress?: string;
        deliveryId?: string;
        autoConfirmedReceipt: boolean;
    }>('/api/nfc/verify', { nfcUid });
