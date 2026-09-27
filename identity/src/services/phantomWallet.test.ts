import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { AppLauncher } from '@capacitor/app-launcher';
import {
    clearPhantomSession,
    connectPhantomWallet,
    signAndSendPhantomTransaction,
} from './phantomWallet';

jest.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));

jest.mock('@capacitor/app', () => ({
    App: {
        addListener: jest.fn(async () => ({ remove: jest.fn(async () => undefined) })),
    },
}));

jest.mock('@capacitor/app-launcher', () => ({
    AppLauncher: { openUrl: jest.fn() },
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encrypt = (value: object, sharedSecret: Uint8Array) => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const data = nacl.box.after(encoder.encode(JSON.stringify(value)), nonce, sharedSecret);
    return { nonce: bs58.encode(nonce), data: bs58.encode(data) };
};

const decrypt = (data: string, nonce: string, sharedSecret: Uint8Array) => {
    const opened = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), sharedSecret);
    if (!opened) throw new Error('test payload could not be decrypted');
    return JSON.parse(decoder.decode(opened));
};

const deliverAppUrl = (url: string) => {
    const calls = require('@capacitor/app').App.addListener.mock.calls;
    const handler = calls[calls.length - 1]?.[1];
    if (!handler) throw new Error('appUrlOpen listener was not registered');
    handler({ url });
};

describe('Phantom mobile payment flow', () => {
    beforeEach(() => {
        clearPhantomSession();
        jest.clearAllMocks();
    });

    it('connects, signs a SOL payment in Phantom, and submits the signed transaction', async () => {
        const wallet = Keypair.generate();
        const phantomEncryptionKeys = nacl.box.keyPair();
        let sharedSecret: Uint8Array | undefined;

        (AppLauncher.openUrl as jest.Mock).mockImplementation(async ({ url: rawUrl }: { url: string }) => {
            const url = new URL(rawUrl);

            if (url.pathname.endsWith('/connect')) {
                const dappPublicKey = bs58.decode(url.searchParams.get('dapp_encryption_public_key')!);
                sharedSecret = nacl.box.before(dappPublicKey, phantomEncryptionKeys.secretKey);
                const encrypted = encrypt({
                    public_key: wallet.publicKey.toString(),
                    session: 'test-phantom-session',
                }, sharedSecret);
                Promise.resolve().then(() => deliverAppUrl(
                    `markidentity://phantom/connect?phantom_encryption_public_key=${encodeURIComponent(bs58.encode(phantomEncryptionKeys.publicKey))}&nonce=${encodeURIComponent(encrypted.nonce)}&data=${encodeURIComponent(encrypted.data)}`,
                ));
                return { completed: true };
            }

            expect(url.pathname).toContain('/signTransaction');
            expect(sharedSecret).toBeDefined();
            const payload = decrypt(
                url.searchParams.get('payload')!,
                url.searchParams.get('nonce')!,
                sharedSecret!,
            );
            expect(payload.session).toBe('test-phantom-session');

            const signed = Transaction.from(bs58.decode(payload.transaction));
            signed.partialSign(wallet);
            const encrypted = encrypt({ transaction: bs58.encode(signed.serialize()) }, sharedSecret!);
            Promise.resolve().then(() => deliverAppUrl(
                `markidentity://phantom/sign-transaction?nonce=${encodeURIComponent(encrypted.nonce)}&data=${encodeURIComponent(encrypted.data)}`,
            ));
            return { completed: true };
        });

        await expect(connectPhantomWallet(true).catch(error => {
            // Preserve the originating crypto stack in Jest's promise matcher output.
            throw new Error(error?.stack || String(error));
        })).resolves.toBe(wallet.publicKey.toString());

        const payment = new Transaction().add(SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1_000_000,
        }));
        payment.feePayer = wallet.publicKey;
        payment.recentBlockhash = Keypair.generate().publicKey.toString();

        const sendRawTransaction = jest.fn(async (signedBytes: Uint8Array) => {
            const signed = Transaction.from(signedBytes);
            expect(signed.verifySignatures()).toBe(true);
            return 'devnet-payment-signature';
        });
        const connection = { sendRawTransaction } as any;

        await expect(signAndSendPhantomTransaction(payment, connection))
            .resolves.toBe('devnet-payment-signature');
        expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    });
});
