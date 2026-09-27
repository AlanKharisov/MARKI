import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor } from '@capacitor/core';
import { Connection, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const PHANTOM_BASE_URL = 'https://phantom.app/ul/v1';
const CALLBACK_SCHEME = 'markidentity';
const CALLBACK_HOST = 'phantom';
const APP_URL = 'https://idenity.onrender.com';
const CLUSTER = 'devnet';
const SESSION_STORAGE_KEY = 'mark.identity.phantom.session.v1';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

type CallbackOperation = 'connect' | 'sign-transaction';

type PhantomSession = {
    publicKey: string;
    session: string;
    dappPublicKey: string;
    dappSecretKey: string;
    phantomPublicKey: string;
    sharedSecret: string;
};

type PhantomCallback = {
    nonce?: string;
    data?: string;
    phantomEncryptionPublicKey?: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const usesPhantomMobileDeepLinks = () => Capacitor.isNativePlatform();

const callbackUrl = (operation: CallbackOperation) =>
    `${CALLBACK_SCHEME}://${CALLBACK_HOST}/${operation}`;

const readSession = (): PhantomSession | null => {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) as PhantomSession : null;
    } catch {
        return null;
    }
};

const saveSession = (session: PhantomSession) => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const clearPhantomSession = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const getConnectedPhantomAddress = () => readSession()?.publicKey ?? '';

const parseCallback = (
    rawUrl: string,
    expectedOperation: CallbackOperation,
): PhantomCallback | null => {
    const url = new URL(rawUrl);
    if (
        url.protocol !== `${CALLBACK_SCHEME}:` ||
        url.hostname !== CALLBACK_HOST ||
        url.pathname !== `/${expectedOperation}`
    ) {
        return null;
    }

    const errorCode = url.searchParams.get('errorCode');
    if (errorCode) {
        const error = new Error(
            url.searchParams.get('errorMessage') || `Phantom error ${errorCode}`,
        ) as Error & { code?: string };
        error.code = errorCode;
        throw error;
    }

    return {
        nonce: url.searchParams.get('nonce') ?? undefined,
        data: url.searchParams.get('data') ?? undefined,
        phantomEncryptionPublicKey:
            url.searchParams.get('phantom_encryption_public_key') ?? undefined,
    };
};

const openPhantomAndWait = async (
    operation: CallbackOperation,
    deepLink: string,
): Promise<PhantomCallback> => {
    let listener: Awaited<ReturnType<typeof App.addListener>> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    return new Promise<PhantomCallback>(async (resolve, reject) => {
        const finish = async (callback?: PhantomCallback, error?: unknown) => {
            if (timeout) clearTimeout(timeout);
            await listener?.remove();
            if (error) reject(error);
            else if (callback) resolve(callback);
        };

        const handleUrl = (url: string) => {
            try {
                const callback = parseCallback(url, operation);
                if (callback) void finish(callback);
            } catch (error) {
                void finish(undefined, error);
            }
        };

        try {
            listener = await App.addListener('appUrlOpen', event => handleUrl(event.url));
            timeout = setTimeout(
                () => void finish(undefined, new Error('Timed out waiting for Phantom. Please try again.')),
                CALLBACK_TIMEOUT_MS,
            );

            const opened = await AppLauncher.openUrl({ url: deepLink });
            if (!opened.completed) {
                await finish(
                    undefined,
                    new Error('Could not open Phantom. Install the Phantom app and try again.'),
                );
            }
        } catch (error) {
            await finish(undefined, error);
        }
    });
};

const decryptPayload = (data: string, nonce: string, sharedSecret: Uint8Array) => {
    const decrypted = nacl.box.open.after(
        bs58.decode(data),
        bs58.decode(nonce),
        sharedSecret,
    );
    if (!decrypted) throw new Error('Phantom response could not be decrypted.');
    return JSON.parse(textDecoder.decode(decrypted));
};

const encryptPayload = (payload: object, sharedSecret: Uint8Array) => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box.after(
        textEncoder.encode(JSON.stringify(payload)),
        nonce,
        sharedSecret,
    );
    return { nonce: bs58.encode(nonce), payload: bs58.encode(encrypted) };
};

const connectMobilePhantom = async (force = false): Promise<string> => {
    const existing = readSession();
    if (existing && !force) return existing.publicKey;

    const dappKeyPair = nacl.box.keyPair();
    const dappPublicKey = bs58.encode(dappKeyPair.publicKey);
    const params = new URLSearchParams({
        app_url: APP_URL,
        dapp_encryption_public_key: dappPublicKey,
        redirect_link: callbackUrl('connect'),
        cluster: CLUSTER,
    });

    const callback = await openPhantomAndWait(
        'connect',
        `${PHANTOM_BASE_URL}/connect?${params.toString()}`,
    );
    if (!callback.phantomEncryptionPublicKey || !callback.nonce || !callback.data) {
        throw new Error('Phantom returned an incomplete connection response.');
    }

    const sharedSecret = nacl.box.before(
        bs58.decode(callback.phantomEncryptionPublicKey),
        dappKeyPair.secretKey,
    );
    const decrypted = decryptPayload(callback.data, callback.nonce, sharedSecret);
    if (!decrypted.public_key || !decrypted.session) {
        throw new Error('Phantom returned no wallet address or session.');
    }

    saveSession({
        publicKey: decrypted.public_key,
        session: decrypted.session,
        dappPublicKey,
        dappSecretKey: bs58.encode(dappKeyPair.secretKey),
        phantomPublicKey: callback.phantomEncryptionPublicKey,
        sharedSecret: bs58.encode(sharedSecret),
    });
    return decrypted.public_key;
};

const getInjectedProvider = () =>
    (window as any).phantom?.solana ?? (window as any).solana ?? null;

export const connectPhantomWallet = async (force = false): Promise<string> => {
    if (usesPhantomMobileDeepLinks()) return connectMobilePhantom(force);

    const provider = getInjectedProvider();
    if (!provider) {
        throw new Error('Phantom wallet not found. Install the Phantom browser extension.');
    }
    const response = await provider.connect();
    const publicKey = response?.publicKey?.toString() ?? provider.publicKey?.toString() ?? '';
    if (!publicKey) throw new Error('Phantom returned no public key.');
    return publicKey;
};

export const signAndSendPhantomTransaction = async (
    transaction: Transaction,
    connection: Connection,
): Promise<string> => {
    if (!usesPhantomMobileDeepLinks()) {
        const provider = getInjectedProvider();
        if (!provider) throw new Error('Phantom wallet not found.');
        const result = await provider.signAndSendTransaction(transaction);
        const signature = typeof result === 'string' ? result : result?.signature;
        if (!signature) throw new Error('Phantom returned no transaction signature.');
        return signature;
    }

    const session = readSession();
    if (!session) throw new Error('Connect Phantom before requesting a payment.');

    const sharedSecret = bs58.decode(session.sharedSecret);
    const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
    });
    const encrypted = encryptPayload({
        transaction: bs58.encode(serialized),
        session: session.session,
    }, sharedSecret);
    const params = new URLSearchParams({
        dapp_encryption_public_key: session.dappPublicKey,
        nonce: encrypted.nonce,
        redirect_link: callbackUrl('sign-transaction'),
        payload: encrypted.payload,
    });

    const callback = await openPhantomAndWait(
        'sign-transaction',
        `${PHANTOM_BASE_URL}/signTransaction?${params.toString()}`,
    );
    if (!callback.nonce || !callback.data) {
        throw new Error('Phantom returned an incomplete signed transaction.');
    }
    const decrypted = decryptPayload(callback.data, callback.nonce, sharedSecret);
    if (!decrypted.transaction) throw new Error('Phantom returned no signed transaction.');

    const signedTransaction = bs58.decode(decrypted.transaction);
    return connection.sendRawTransaction(signedTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });
};
