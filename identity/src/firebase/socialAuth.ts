import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    setPersistence,
    browserLocalPersistence,
    FacebookAuthProvider,
    OAuthProvider,
    AuthProvider,
    UserCredential
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { auth } from './config';
import { apiMe, apiRegister } from '../services/apiClient';

// signInWithRedirect only works when the page shares storage with authDomain.
// On GitHub Pages (alankharisov.github.io ≠ idenity-e7f29.firebaseapp.com)
// browsers partition third-party storage and getRedirectResult comes back
// null, so every browser — mobile included — must use the popup flow.
// The redirect flow stays for the native Capacitor app only.
const isNativeRedirectFlow = (): boolean => Capacitor.isNativePlatform();

const signInWithMobileRedirect = async (provider: AuthProvider) => {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithRedirect(auth, provider);
};

// Google sign-in
export const signInWithGoogle = async (): Promise<{ success: boolean; user?: any; error?: string }> => {
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        if (isNativeRedirectFlow()) {
            await signInWithMobileRedirect(provider);
            return { success: true };
        }
        const result   = await signInWithPopup(auth, provider);
        return await handleSocialAuthResult(result);
    } catch (error: any) {
        console.error('Google sign in error:', error);
        return { success: false, error: error.message };
    }
};

// Facebook sign-in
export const signInWithFacebook = async (): Promise<{ success: boolean; user?: any; error?: string }> => {
    try {
        const provider = new FacebookAuthProvider();
        if (isNativeRedirectFlow()) {
            await signInWithMobileRedirect(provider);
            return { success: true };
        }
        const result   = await signInWithPopup(auth, provider);
        return await handleSocialAuthResult(result);
    } catch (error: any) {
        console.error('Facebook sign in error:', error);
        return { success: false, error: error.message };
    }
};

// Apple sign-in
export const signInWithApple = async (): Promise<{ success: boolean; user?: any; error?: string }> => {
    try {
        const provider = new OAuthProvider('apple.com');
        if (isNativeRedirectFlow()) {
            await signInWithMobileRedirect(provider);
            return { success: true };
        }
        const result   = await signInWithPopup(auth, provider);
        return await handleSocialAuthResult(result);
    } catch (error: any) {
        console.error('Apple sign in error:', error);
        return { success: false, error: error.message };
    }
};

// After Firebase popup succeeds, ensure user exists in Rust backend
const handleSocialAuthResult = async (result: UserCredential) => {
    const fbUser = result.user;
    try {
        // Check if user already registered in Rust API
        const existing = await apiMe().catch(() => null);
        if (existing) {
            return { success: true, user: existing };
        }

        // New user — register in Rust backend
        const displayName = fbUser.displayName || 'User';
        const nameParts   = displayName.split(' ');
        const username    = (nameParts[0] || 'user').toLowerCase() + fbUser.uid.slice(-4);

        await apiRegister({
            uid:      fbUser.uid,
            name:     displayName,
            username,
            email:    fbUser.email || '',
        });

        const userData = await apiMe();
        return { success: true, user: userData };
    } catch (error: any) {
        console.error('Social auth backend sync error:', error);
        return { success: false, error: error.message };
    }
};
