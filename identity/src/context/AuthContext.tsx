import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth } from '../firebase/config';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    signOut,
    deleteUser,
    getRedirectResult,
    User,
} from 'firebase/auth';
import { getLocationFromCoords, getLocationByIP } from '../services/geocoding';
import { apiRegister, apiMe, apiUpdateProfile } from '../services/apiClient';

export interface UserData {
    uid: string;
    name: string;
    username: string;
    email: string;
    phone?: string;
    avatar?: string;
    location?: string;
    bio?: string;
    createdAt: string;
    companyApproved?: boolean;
    pendingApproval?: boolean;
    deliveryAddress?: string;
    roles?: string[];
    companyId?: string;
    ratingOverall?: number;
    ratingByCategory?: Record<string, number>;
}

interface AuthContextType {
    currentUser: UserData | null;
    loading: boolean;
    login:  (email: string, password: string) => Promise<{ success: boolean; user?: UserData; error?: string }>;
    register: (email: string, password: string, name: string, username: string, phone?: string) => Promise<{ success: boolean; user?: UserData; error?: string }>;
    logout: () => Promise<{ success: boolean; error?: string }>;
    updateUserLocation: (location: string) => Promise<void>;
    updateUserProfile:  (data: { name?: string; bio?: string; avatar?: string; username?: string; location?: string }) => Promise<void>;
    refreshLocation:    () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
};

// ─── Geolocation (unchanged) ──────────────────────────────────────────────────
const getUserLocation = async (): Promise<string> => {
    try {
        const timeout = new Promise<string>(r => setTimeout(() => r('Unknown location'), 3000));
        const ipLoc = await Promise.race([
            getLocationByIP().then(l => l || '').catch(() => ''),
            timeout,
        ]);
        if (ipLoc && ipLoc !== 'Unknown location') return ipLoc;

        if (navigator.geolocation) {
            return new Promise(resolve => {
                const t = setTimeout(() => resolve('Unknown location'), 4000);
                navigator.geolocation.getCurrentPosition(
                    async pos => {
                        clearTimeout(t);
                        const loc = await getLocationFromCoords(
                            pos.coords.latitude, pos.coords.longitude
                        ).catch(() => null);
                        resolve(loc || 'Unknown location');
                    },
                    () => { clearTimeout(t); resolve('Unknown location'); },
                    { timeout: 4000 }
                );
            });
        }
        return 'Unknown location';
    } catch { return 'Unknown location'; }
};

// ─── Map Rust API response to UserData ────────────────────────────────────────
const mapUser = (u: any): UserData => ({
    uid:             u.uid,
    name:            u.name,
    username:        String(u.username || '').replace(/^@+/, ''),
    email:           u.email,
    phone:           u.phone,
    avatar:          u.avatar || '/img/default-avatar.png',
    location:        u.location,
    bio:             u.bio,
    createdAt:       u.createdAt || new Date().toISOString(),
    companyApproved: u.companyApproved ?? false,
    pendingApproval: u.pendingApproval ?? false,
    deliveryAddress: u.deliveryAddress,
    ratingOverall:   u.ratingOverall ?? 0,
    ratingByCategory: u.ratingByCategory ?? {},
});

const syncFirebaseUser = async (firebaseUser: User) => {
    let userData = await apiMe().catch(() => null);

    if (!userData) {
        // User exists in Firebase but not in Rust API (common after signInWithRedirect on mobile)
        const displayName = firebaseUser.displayName || 'User';
        const nameParts   = displayName.split(' ');
        const username    = (nameParts[0] || 'user').toLowerCase() + firebaseUser.uid.slice(-4);
        try {
            await apiRegister({
                uid:      firebaseUser.uid,
                name:     displayName,
                username,
                email:    firebaseUser.email || '',
            });
            userData = await apiMe().catch(() => null);
        } catch (regErr) {
            console.error('Auto registration in AuthContext failed:', regErr);
        }
    }

    return userData ? mapUser(userData) : null;
};

const describeFirebaseUser = (user: User | null | undefined) => {
    if (!user) return null;
    return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        providerIds: user.providerData.map(provider => provider.providerId),
    };
};

const logAuthError = (label: string, error: any) => {
    console.error(label, {
        code: error?.code,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        customData: error?.customData,
        raw: error,
    });
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<UserData | null>(null);
    const [loading, setLoading]         = useState(true);

    const updateUserLocation = async (location: string) => {
        if (!currentUser) return;
        try {
            await apiUpdateProfile(currentUser.uid, { location });
            setCurrentUser(prev => prev ? { ...prev, location } : null);
        } catch (e) { console.error('Location update error:', e); }
    };

    const updateUserProfile = async (data: { name?: string; bio?: string; avatar?: string; username?: string; location?: string }) => {
        if (!currentUser) return;
        const normalizedData = data.username === undefined
            ? data
            : { ...data, username: data.username.replace(/^@+/, '') };
        try {
            await apiUpdateProfile(currentUser.uid, normalizedData);
            setCurrentUser(prev => prev ? { ...prev, ...normalizedData } : null);
        } catch (e) { console.error('Profile update error:', e); }
    };

    const refreshLocation = async () => {
        if (!currentUser) return;
        const location = await getUserLocation();
        await updateUserLocation(location);
    };

    useEffect(() => {
        let active = true;
        let unsubscribe: (() => void) | undefined;

        const initAuth = async () => {
            try {
                const result = await getRedirectResult(auth);
                console.log('[AUTH] redirect result', result ? {
                    operationType: result.operationType,
                    providerId: result.providerId,
                    user: describeFirebaseUser(result.user),
                } : null);
                console.log('[AUTH] current user', describeFirebaseUser(auth.currentUser));

                if (!active) return;
                if (result?.user) {
                    setCurrentUser(await syncFirebaseUser(result.user));
                }
            } catch (e: any) {
                logAuthError('[AUTH] redirect result error', e);
            }

            if (!active) return;
            unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
                console.log('[AUTH] auth state changed', describeFirebaseUser(firebaseUser));
                console.log('[AUTH] current user', describeFirebaseUser(auth.currentUser));

                try {
                    if (firebaseUser) {
                        setCurrentUser(await syncFirebaseUser(firebaseUser));
                    } else {
                        setCurrentUser(null);
                    }
                } catch (e) {
                    console.error('Auth state error:', e);
                    setCurrentUser(null);
                } finally {
                    setLoading(false);
                }
            });
        };

        initAuth();

        return () => {
            active = false;
            unsubscribe?.();
        };
    }, []);

    const login = async (email: string, password: string) => {
        try {
            const credential = await signInWithEmailAndPassword(auth, email, password);
            const userData = await syncFirebaseUser(credential.user);
            if (!userData) {
                return {
                    success: false,
                    error: 'Signed in, but your profile could not be loaded. Check the API connection and try again.',
                };
            }
            setCurrentUser(userData);
            return { success: true, user: userData };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    };

    const register = async (
        email: string, password: string, name: string, username: string, phone?: string
    ) => {
        let firebaseUser = null;
        const normalizedUsername = username.replace(/^@+/, '');
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password);
            firebaseUser = result.user;
            await updateProfile(result.user, { displayName: name });

            // Create profile + wallet on Rust backend (public endpoint)
            await apiRegister({ uid: result.user.uid, name, username: normalizedUsername, email, phone });

            // Attach location (best-effort, token is now available)
            const location = await getUserLocation();
            try { await apiUpdateProfile(result.user.uid, { location }); } catch { /* non-critical */ }

            const userData: UserData = {
                uid: result.user.uid, name, username: normalizedUsername, email, phone: phone || '',
                avatar: '/img/default-avatar.png', location, bio: '',
                createdAt: new Date().toISOString(),
            };
            return { success: true, user: userData };
        } catch (e: any) {
            // If Firebase user was created but API failed - delete the Firebase user
            if (firebaseUser) {
                try { await deleteUser(firebaseUser); } catch { /* ignore */ }
            }
            return { success: false, error: e.message };
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    };

    return (
        <AuthContext.Provider value={{
            currentUser, loading,
            login, register, logout,
            updateUserLocation, updateUserProfile, refreshLocation,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
