import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGetMarkiWallet, apiUpdateMarkiEmail, apiUpdateFingerprint } from '../services/apiClient';

interface WalletData {
    address: string;
    recoveryPhrase: string;
    balance: { SOLANA: number };
    fingerprintEnabled: boolean;
}

interface WalletSettingsPageProps {
    onBack: () => void;
}

const WalletSettingsPage: React.FC<WalletSettingsPageProps> = ({ onBack }) => {
    const { currentUser }                             = useAuth();
    const [loading, setLoading]                       = useState(true);
    const [saving, setSaving]                         = useState(false);
    const [wallet, setWallet]                         = useState<WalletData | null>(null);
    const [email, setEmail]                           = useState('');
    const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
    const [fingerprintEnabled, setFingerprintEnabled] = useState(false);

    useEffect(() => { loadWallet(); }, [currentUser]); // eslint-disable-line

    const loadWallet = async () => {
        if (!currentUser) return;
        try {
            const data = await apiGetMarkiWallet();
            setWallet(data);
            setEmail(currentUser.email || '');
            setFingerprintEnabled(data.fingerprintEnabled || false);
        } catch (e: any) {
            console.error('Error loading wallet:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateEmail = async () => {
        if (!wallet) return;
        setSaving(true);
        try {
            await apiUpdateMarkiEmail(email);
            alert('✅ Email updated successfully!');
        } catch (e: any) {
            alert(`❌ Error: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleFingerprint = async (enabled: boolean) => {
        setFingerprintEnabled(enabled);
        try {
            await apiUpdateFingerprint(enabled);
        } catch (e: any) {
            // revert on error
            setFingerprintEnabled(!enabled);
            alert(`❌ Error: ${e.message}`);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert('📋 Copied to clipboard!');
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f5f5' }}>
                <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
                <div style={{ width: '50px', height: '50px', border: '3px solid #ddd', borderTop: '3px solid #01ff77', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f5f5f5', zIndex: 2000, overflowY: 'auto', padding: '20px' }}>
            <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>

            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '15px' }}>
                <button onClick={onBack} aria-label="Back" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#01ff77', padding: '10px' }}>
                    <i className="fas fa-arrow-left"></i>
                </button>
                <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', margin: 0 }}>Marki Wallet</h2>
            </div>

            <div style={{ maxWidth: '500px', margin: '0 auto' }}>

                {/* Wallet address */}
                <div style={card}>
                    <h3 style={cardTitle}>Wallet Address</h3>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#f5f5f5', padding: '12px', borderRadius: '8px' }}>
                        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                            {wallet?.address || '—'}
                        </span>
                        <button style={iconBtn} aria-label="Copy wallet address" onClick={() => copyToClipboard(wallet?.address || '')}>
                            <i className="fas fa-copy"></i>
                        </button>
                    </div>
                </div>

                {/* Email */}
                <div style={card}>
                    <h3 style={cardTitle}>Wallet Email</h3>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <input
                            type="email"
                            style={input}
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="Enter email"
                        />
                        <button style={saveBtn} onClick={handleUpdateEmail} disabled={saving}>
                            Save
                        </button>
                    </div>
                </div>

                {/* Recovery Phrase */}
                <div style={card}>
                    <h3 style={cardTitle}>Recovery Phrase</h3>
                    {showRecoveryPhrase ? (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px', marginBottom: '16px', padding: '16px', background: '#f5f5f5', borderRadius: '10px' }}>
                                {wallet?.recoveryPhrase.split(' ').map((word, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '6px', padding: '8px', background: 'white', borderRadius: '6px' }}>
                                        <span style={{ color: '#01ff77', fontWeight: 'bold' }}>{i + 1}.</span>
                                        <span style={{ color: '#333' }}>{word}</span>
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button style={{ ...saveBtn, padding: '8px 16px' }} onClick={() => copyToClipboard(wallet?.recoveryPhrase || '')}>
                                    <i className="fas fa-copy"></i> Copy
                                </button>
                                <button style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                                        onClick={() => setShowRecoveryPhrase(false)}>
                                    Hide
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            style={{ width: '100%', padding: '12px', background: '#f0f0f0', border: '1px dashed #01ff77', borderRadius: '8px', color: '#01ff77', cursor: 'pointer' }}
                            onClick={() => setShowRecoveryPhrase(true)}
                        >
                            <i className="fas fa-eye"></i> Show Recovery Phrase
                        </button>
                    )}
                    <p style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '10px' }}>
                        ⚠️ Never share your recovery phrase with anyone!
                    </p>
                </div>

                {/* Fingerprint */}
                <div style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>🔐 Enable fingerprint unlock</span>
                        <div
                            style={{ width: '50px', height: '26px', borderRadius: '13px', background: fingerprintEnabled ? '#01ff77' : '#ccc', position: 'relative', cursor: 'pointer', transition: 'background 0.3s' }}
                            onClick={() => handleToggleFingerprint(!fingerprintEnabled)}
                        >
                            <div style={{ position: 'absolute', width: '18px', height: '18px', background: 'white', borderRadius: '50%', top: '4px', left: fingerprintEnabled ? '28px' : '4px', transition: 'left 0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

const card:      React.CSSProperties = { background: 'white', borderRadius: '15px', padding: '20px', marginBottom: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' };
const cardTitle: React.CSSProperties = { fontSize: '16px', fontWeight: 'bold', color: '#333', marginBottom: '15px' };
const input:     React.CSSProperties = { flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' };
const saveBtn:   React.CSSProperties = { padding: '12px 20px', background: '#01ff77', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' };
const iconBtn:   React.CSSProperties = { background: 'none', border: 'none', color: '#01ff77', cursor: 'pointer', fontSize: '16px' };

export default WalletSettingsPage;
