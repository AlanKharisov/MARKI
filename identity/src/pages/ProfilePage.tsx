import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUploadAvatar, apiRequestApproval } from '../services/apiClient';
import { Icon } from '../components/brand';
import QrScannerPage from './QrScannerPage';
import { Language, useLanguage } from '../context/LanguageContext';

interface ProfilePageProps {
  onOpenWalletSettings: () => void;
  onOpenCryptoWallets:  () => void;
  onOpenNftWallet:      () => void;
}

const ProfilePage: React.FC<ProfilePageProps> = ({ onOpenWalletSettings, onOpenCryptoWallets, onOpenNftWallet }) => {
  const { currentUser, logout, updateUserProfile, refreshLocation } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPage, setCurrentPage] = useState<'profile' | 'security' | 'company' | 'edit-profile' | 'qr-scanner'>('profile');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', username: '', bio: '', location: '' });
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [companyDesc, setCompanyDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!currentUser) {
    return (
      <div className="page active mi-screen-pad" style={{ paddingTop: 80, textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large. Max 5MB.'); return; }

    setAvatarLoading(true);
    try {
      const { url } = await apiUploadAvatar(currentUser.uid, file);
      await updateUserProfile({ avatar: url });
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setAvatarLoading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const openEditProfile = () => {
    setEditForm({
      name: currentUser.name || '',
      username: currentUser.username || '',
      bio: currentUser.bio || '',
      location: currentUser.location || '',
    });
    setCurrentPage('edit-profile');
  };

  const saveProfile = async () => {
    if (!editForm.name.trim() || !editForm.username.trim()) {
      alert('Name and username are required');
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile({
        name: editForm.name.trim(),
        username: editForm.username.trim(),
        bio: editForm.bio.trim(),
        location: editForm.location.trim(),
      });
      setCurrentPage('profile');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to logout?')) await logout();
  };

  const handleSubmitApproval = async () => {
    if (!companyName.trim() || !regNumber.trim() || !contactEmail.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequestApproval(currentUser.uid, {
        companyName: companyName.trim(),
        registrationNumber: regNumber.trim(),
        contactEmail: contactEmail.trim(),
        description: companyDesc.trim(),
      });
      setCurrentPage('profile');
      alert('Company verification request submitted');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const accountRows: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; badge?: string }[] = [
    { icon: <Icon.User />, label: t('editProfile'), sub: t('editProfileSub'), onClick: openEditProfile },
    { icon: <Icon.Wallet />, label: t('myNfts'), sub: t('myNftsSub'), onClick: onOpenNftWallet },
    { icon: <Icon.Shield />, label: t('security'), sub: t('inDevelopment'), onClick: () => setCurrentPage('security') },
    { icon: <Icon.Wallet />, label: t('cryptoWallets'), sub: t('cryptoWalletsSub'), onClick: onOpenCryptoWallets },
    { icon: <Icon.CRM />, label: t('markiWallet'), sub: t('markiWalletSub'), onClick: onOpenWalletSettings },
    { icon: <Icon.Globe />, label: t('companyApproval'), sub: currentUser.companyApproved ? t('verified') : currentUser.pendingApproval ? 'Pending review' : 'Submit a request', onClick: () => setCurrentPage('company') },
    { icon: <Icon.Scan />, label: t('qrScanner'), sub: t('qrScannerSub'), onClick: () => setCurrentPage('qr-scanner') },
  ];

  return (
    <div className="page profile-page active mi-screen-pad" style={{ paddingTop: 16, paddingBottom: 100 }}>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleAvatarChange}
      />

      <h1 className="hero-title" style={{ marginBottom: 16 }}>{language === 'uk' ? <>Мій<br /><span className="accent">Профіль</span></> : <>My<br /><span className="accent">Profile</span></>}</h1>

      {/* Header card */}
      <div
        style={{
          padding: 20,
          borderRadius: 24,
          background: 'linear-gradient(135deg, var(--bg-card), var(--primary-faint))',
          border: '1px solid var(--border)',
          marginBottom: 16,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div
            style={{ position: 'relative', cursor: 'pointer' }}
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarLoading ? (
              <div
                style={{
                  width: 72, height: 72,
                  borderRadius: '50%',
                  background: 'var(--bg-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '3px solid var(--bg-card)',
                }}
              >
                <div className="spinner" style={{ width: 24, height: 24 }} />
              </div>
            ) : (
              <img
                src={currentUser.avatar || '/img/default-avatar.png'}
                alt="Avatar"
                style={{
                  width: 72, height: 72,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid var(--bg-card)',
                  display: 'block',
                }}
                onError={e => { (e.currentTarget as HTMLImageElement).src = '/img/default-avatar.png'; }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 24,
                height: 24,
                borderRadius: 12,
                background: 'var(--primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '3px solid var(--bg-card)',
              }}
            >
              <Icon.Camera size={12} />
            </div>
          </div>
          {currentUser.companyApproved && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'var(--primary)',
                color: 'white',
                fontWeight: 700,
              }}
            >
              <Icon.Check size={12} /> Verified
            </span>
          )}
        </div>
        <div style={{ marginTop: 14, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {currentUser.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>@{currentUser.username || 'username'}</span>
          {currentUser.location && (
            <>
              <span>·</span>
              <span>{currentUser.location}</span>
              <button
                onClick={refreshLocation}
                style={{ color: 'var(--primary)', display: 'inline-flex', padding: 0 }}
                aria-label="Refresh location"
              >
                <Icon.Refresh size={12} />
              </button>
            </>
          )}
        </div>
        {currentUser.bio && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            {currentUser.bio}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{t('language')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('interfacePreference')}</div>
          </div>
          <select value={language} onChange={e => setLanguage(e.target.value as Language)} aria-label="Language" style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)', fontWeight: 700 }}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{t('brandRating')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('overallByCategory')}</div>
          </div>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 28, fontWeight: 800, color: 'var(--primary)' }}>
            {currentUser.ratingOverall ? currentUser.ratingOverall.toFixed(1) : 'N/A'}
          </div>
        </div>
        {([
          ['Authenticity', t('authenticity')],
          ['Product quality', t('productQuality')],
          ['Delivery', t('delivery')],
          ['Communication', t('communication')],
        ] as const).map(([category, label]) => {
          const value = currentUser.ratingByCategory?.[category] || 0;
          return <div key={category} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 28px', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
            <div style={{ height: 7, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${value * 20}%`, background: 'var(--primary)', borderRadius: 4 }} /></div>
            <strong>{value ? value.toFixed(1) : '-'}</strong>
          </div>;
        })}
        {!currentUser.ratingOverall && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>{t('ratingsAfterTransactions')}</div>}
      </div>

      {/* Account list */}
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Account
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {accountRows.map((row, i) => (
          <div
            key={row.label}
            onClick={row.onClick}
            role="button"
            tabIndex={0}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                row.onClick();
              }
            }}
            style={{
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              borderBottom: i < accountRows.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 36, height: 36,
                borderRadius: 10,
                background: 'var(--primary-soft)',
                color: 'var(--primary-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {row.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.sub}</div>
            </div>
            <span style={{ color: 'var(--text-faint)' }}>
              <Icon.ChevronRight />
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={handleLogout}
        style={{
          marginTop: 18,
          width: '100%',
          padding: 14,
          borderRadius: 14,
          background: 'var(--bg-soft)',
          color: 'var(--danger)',
          fontWeight: 600,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontFamily: 'inherit',
        }}
      >
        <Icon.Logout /> Logout
      </button>

      {/* Security overlay */}
      {currentPage === 'security' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-page)',
            zIndex: 2100,
            overflowY: 'auto',
            padding: '20px',
            paddingBottom: '120px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <button
              onClick={() => setCurrentPage('profile')}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'var(--bg-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text)',
              }}
              aria-label="Back"
            >
              <Icon.ArrowLeft />
            </button>
            <h2 className="h2">{t('security')}</h2>
          </div>

          <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary-ink)' }}><Icon.Shield size={28} /></div>
            <h3 className="h3">{t('inDevelopment')}</h3>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
              {language === 'uk' ? 'Налаштування пароля та двофакторної автентифікації з’являться в наступному оновленні.' : 'Password and two-factor authentication settings will be available in a future update.'}
            </p>
          </div>
        </div>
      )}

      {/* Edit Profile overlay */}
      {currentPage === 'edit-profile' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-page)',
            zIndex: 2100,
            overflowY: 'auto',
            padding: '20px',
            paddingBottom: '120px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button
              onClick={() => setCurrentPage('profile')}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'var(--bg-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text)',
              }}
              aria-label="Back"
            >
              <Icon.ArrowLeft />
            </button>
            <h2 className="h2">Редактирование профиля</h2>
          </div>

          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div
                onClick={() => avatarInputRef.current?.click()}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'var(--primary-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  border: '2px solid var(--primary)',
                }}
              >
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Icon.User />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{currentUser.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>@{currentUser.username}</div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>Имя</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Ваше имя"
              />
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>Username</label>
              <input
                value={editForm.username}
                onChange={e => setEditForm({ ...editForm, username: e.target.value })}
                placeholder="@username"
              />
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>Bio</label>
              <textarea
                value={editForm.bio}
                onChange={e => setEditForm({ ...editForm, bio: e.target.value })}
                placeholder="Расскажите о себе..."
                style={{ height: 80, resize: 'none' as any }}
              />
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>Местоположение</label>
              <input
                value={editForm.location}
                onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                placeholder="Город, страна"
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={saving}
              className="btn btn-primary btn-block"
              style={{ padding: 14, marginTop: 8 }}
            >
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      )}

      {/* Company overlay */}
      {currentPage === 'company' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-page)',
            zIndex: 2100,
            overflowY: 'auto',
            padding: '20px',
            paddingBottom: '120px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <button
              onClick={() => setCurrentPage('profile')}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'var(--bg-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text)',
              }}
              aria-label="Back"
            >
              <Icon.ArrowLeft />
            </button>
            <h2 className="h2">Company verification</h2>
          </div>

          {currentUser.companyApproved ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
              <h3 className="h3" style={{ color: 'var(--primary-ink)' }}>Company verified</h3>
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                Your company account has been approved.
              </p>
            </div>
          ) : currentUser.pendingApproval ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>⏳</div>
              <h3 className="h3" style={{ color: 'var(--warn)' }}>Request pending</h3>
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                Your verification request is under review.
              </p>
            </div>
          ) : (
            <div>
              <div
                className="card"
                style={{
                  padding: 14,
                  marginBottom: 16,
                  background: 'var(--primary-faint)',
                  border: '1px solid var(--primary-soft)',
                  fontSize: 13,
                  color: 'var(--primary-ink)',
                }}
              >
                Submit a request to verify your company. Verified accounts unlock batch NFT uploads and business features.
              </div>

              {[
                { label: 'Company name', value: companyName, setter: setCompanyName, placeholder: 'e.g. Acme Corp' },
                { label: 'Registration number', value: regNumber, setter: setRegNumber, placeholder: 'e.g. 12345678' },
                { label: 'Contact email', value: contactEmail, setter: setContactEmail, placeholder: 'company@example.com' },
              ].map(f => (
                <div className="field" key={f.label} style={{ marginBottom: 12 }}>
                  <label>{f.label}</label>
                  <input
                    placeholder={f.placeholder}
                    value={f.value}
                    onChange={e => f.setter(e.target.value)}
                  />
                </div>
              ))}

              <div className="field" style={{ marginBottom: 16 }}>
                <label>Business description</label>
                <textarea
                  placeholder="Briefly describe your company and its NFT activities…"
                  value={companyDesc}
                  onChange={e => setCompanyDesc(e.target.value)}
                  style={{ height: 90, resize: 'none' as any }}
                />
              </div>

              <button
                onClick={handleSubmitApproval}
                disabled={submitting}
                className="btn btn-primary btn-block"
                style={{ padding: 14 }}
              >
                {submitting ? 'Submitting…' : 'Submit verification request'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* QR Scanner overlay */}
      {currentPage === 'qr-scanner' && (
        <QrScannerPage onClose={() => setCurrentPage('profile')} />
      )}
    </div>
  );
};

export default ProfilePage;
