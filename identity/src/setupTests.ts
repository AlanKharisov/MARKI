import { webcrypto } from 'crypto';

// Keep binary values in Node's Uint8Array realm so crypto libraries that use
// instanceof checks agree with Buffer and WebCrypto results.
const NodeUint8Array = Object.getPrototypeOf(Buffer);
Object.assign(global, { Uint8Array: NodeUint8Array });

// CRA's Jest/jsdom environment does not expose these Web APIs by default,
// while Solana and the Phantom transport use both.
class JestTextEncoder {
    encode(value = ''): Uint8Array {
        return Uint8Array.from(Buffer.from(value, 'utf8'));
    }
}

class JestTextDecoder {
    decode(value?: ArrayBufferView | ArrayBuffer): string {
        if (!value) return '';
        return Buffer.from(value as any).toString('utf8');
    }
}

Object.assign(global, { TextDecoder: JestTextDecoder, TextEncoder: JestTextEncoder });
Object.defineProperty(global, 'crypto', { value: webcrypto });
