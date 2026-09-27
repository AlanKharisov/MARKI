import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatTime } from '../utils/formatters';
import {
  apiGetNotifications,
  apiMarkRead,
  apiMarkAllRead,
  apiDeleteNotification,
} from '../services/apiClient';
import { Icon } from '../components/brand';
import { useLanguage } from '../context/LanguageContext';

type NotifType = 'purchase' | 'sale' | 'like' | 'comment' | 'nft_created' | 'welcome' | 'system' | 'wallet';

interface AppNotification {
  id: string;
  type: NotifType;
  title: string;
  text: string;
  read: boolean;
  createdAt: string;
  metadata?: { price?: number; currency?: string; fromUser?: string; nftTitle?: string };
}

const ICON_MAP: Record<string, string> = {
  purchase:    '🛒',
  sale:        '💰',
  like:        '❤️',
  comment:     '💬',
  nft_created: '🎨',
  welcome:     '👋',
  wallet:      '💼',
  system:      'ℹ️',
};

const notificationIcon = (type: NotifType, size = 18) => (
  type === 'comment'
    ? <Icon.Comment size={size} aria-hidden="true" />
    : ICON_MAP[type] || 'ℹ️'
);

const POLL_INTERVAL = 30_000;

const AlertsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { language } = useLanguage();
  const uk = language === 'uk';
  const [alerts, setAlerts] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | NotifType>('all');

  const mapNotification = (n: any): AppNotification => ({
    id: n.id,
    type: n.type,
    title: n.title,
    text: n.text,
    read: n.read,
    createdAt: n.createdAt,
    metadata: n.metadata
      ? {
          price: n.metadata.price,
          currency: n.metadata.currency,
          fromUser: n.metadata.fromUser,
          nftTitle: n.metadata.nftTitle,
        }
      : undefined,
  });

  const loadNotifications = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      const data = await apiGetNotifications();
      setAlerts((data || []).map(mapNotification));
    } catch (e) {
      console.error('Notifications error:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const handleMarkRead = async (alert: AppNotification) => {
    if (alert.read || !alert.id) return;
    await apiMarkRead(alert.id).catch(() => null);
    setAlerts(prev => prev.map(a => (a.id === alert.id ? { ...a, read: true } : a)));
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm(uk ? 'Видалити це сповіщення?' : 'Delete this notification?')) return;
    try {
      await apiDeleteNotification(id);
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (error: any) {
      alert(`Could not delete notification: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleMarkAllRead = async () => {
    if (!currentUser) return;
    try {
      await apiMarkAllRead();
      setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    } catch (error: any) {
      alert(`Could not mark notifications as read: ${error?.message || 'Unknown error'}`);
    }
  };

  const filteredAlerts = filter === 'all' ? alerts : alerts.filter(a => a.type === filter);
  const unreadCount = alerts.filter(a => !a.read).length;

  const filterTabs: { key: 'all' | NotifType; label: string }[] = [
    { key: 'all',         label: uk ? 'Усі' : 'All' },
    { key: 'purchase',    label: uk ? 'Покупки' : 'Bought' },
    { key: 'sale',        label: uk ? 'Продажі' : 'Sold' },
    { key: 'like',        label: uk ? 'Вподобання' : 'Likes' },
    { key: 'comment',     label: uk ? 'Коментарі' : 'Comments' },
    { key: 'nft_created', label: uk ? 'Створені' : 'Created' },
  ];

  const localizedNotification = (alert: AppNotification) => {
    if (!uk) return { title: alert.title, text: alert.text };
    const nft = alert.metadata?.nftTitle || 'NFT';
    const user = alert.metadata?.fromUser || 'Користувач';
    const amount = alert.metadata?.price ? `${alert.metadata.price} ${alert.metadata.currency || ''}`.trim() : '';
    switch (alert.type) {
      case 'purchase': return { title: 'Покупку оформлено', text: amount ? `Ви придбали «${nft}» за ${amount}.` : `Замовлення «${nft}» успішно оформлено.` };
      case 'sale': return { title: 'Ваш NFT продано', text: amount ? `«${nft}» придбав ${user} за ${amount}.` : `«${nft}» успішно продано.` };
      case 'like': return { title: 'Ваш NFT вподобали', text: `${user} вподобав NFT «${nft}».` };
      case 'comment': return { title: 'Новий коментар', text: `${user} прокоментував NFT «${nft}».` };
      case 'nft_created': return { title: 'NFT створено', text: `Ваш NFT «${nft}» успішно створено.` };
      case 'welcome': return { title: 'Вітаємо в Idenity', text: 'Ваш гаманець створено. Тепер ви можете створювати та продавати NFT.' };
      case 'wallet': return { title: 'Оновлення гаманця', text: alert.text };
      default: return { title: 'Системне сповіщення', text: alert.text };
    }
  };

  if (loading) {
    return (
      <div className="page alert-page active mi-screen-pad" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', paddingBottom: 100 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="spinner" />
          <p className="muted" style={{ marginTop: 14 }}>{uk ? 'Завантаження сповіщень…' : 'Loading notifications…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page alert-page active mi-screen-pad" style={{ paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div>
          <h1 className="hero-title">{uk ? <>Мої<br /><span className="accent">Сповіщення</span></> : <>My<br /><span className="accent">Alerts</span></>}</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {unreadCount > 0 ? (uk ? `${unreadCount} непрочитаних` : `${unreadCount} unread`) : (uk ? 'Усе прочитано' : 'All caught up')}
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}
          >
            {uk ? 'Прочитати всі' : 'Mark all read'}
          </button>
        )}
      </div>

      <div className="scrollx" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {filterTabs.map(t => (
          <span
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`chip ${filter === t.key ? 'chip-active' : ''}`}
          >
            {t.label}
          </span>
        ))}
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>
            {filter === 'all' ? '🔔' : notificationIcon(filter, 40)}
          </div>
          <p style={{ fontSize: 15, fontWeight: 700 }}>
            {uk ? 'Сповіщень поки немає' : (filter === 'all' ? 'No notifications yet' : `No ${filter.replace('_', ' ')} notifications`)}
          </p>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {uk ? 'Купуйте, продавайте або створюйте NFT, щоб бачити оновлення тут' : 'Buy, sell or create NFTs to see updates here'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredAlerts.map(alert => {
            const localized = localizedNotification(alert);
            return (
            <div
              key={alert.id}
              onClick={() => handleMarkRead(alert)}
              style={{
                padding: 14,
                borderRadius: 14,
                background: alert.read ? 'var(--bg-card)' : 'var(--primary-faint)',
                border: '1px solid',
                borderColor: alert.read ? 'var(--border)' : 'var(--primary-soft)',
                display: 'flex',
                gap: 12,
                position: 'relative',
                cursor: alert.read ? 'default' : 'pointer',
              }}
            >
              {!alert.read && (
                <div
                  style={{
                    position: 'absolute',
                    top: 14, right: 14,
                    width: 8, height: 8,
                    borderRadius: 4,
                    background: 'var(--primary)',
                  }}
                />
              )}
              <div
                style={{
                  width: 38, height: 38,
                  borderRadius: 11,
                  background: 'var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                  border: '1px solid var(--border)',
                }}
              >
                {notificationIcon(alert.type)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{localized.title}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-faint)',
                      marginLeft: 'auto',
                      marginRight: alert.read ? 0 : 14,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTime(alert.createdAt)}
                  </span>
                  {alert.id && (
                    <button
                      onClick={e => handleDelete(e, alert.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-faint)',
                        padding: '2px 4px',
                        marginLeft: 4,
                      }}
                      aria-label="Delete"
                    >
                      <Icon.X size={14} />
                    </button>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    marginTop: 3,
                    lineHeight: 1.4,
                  }}
                >
                  {localized.text}
                </div>
                {alert.metadata?.price && (
                  <span
                    className="mono"
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      padding: '3px 9px',
                      borderRadius: 999,
                      background: 'var(--primary-soft)',
                      color: 'var(--primary-ink)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {alert.metadata.price} {alert.metadata.currency}
                  </span>
                )}
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
};

export default AlertsPage;
