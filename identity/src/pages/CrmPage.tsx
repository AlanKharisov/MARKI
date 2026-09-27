import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatTime } from '../utils/formatters';
import {
    apiAcceptCodOrder,
    apiAddCheckpoint,
    apiBindNfc,
    apiConfirmReceipt,
    apiCreateDelivery,
    apiGetNFTs,
    apiListCodOrders,
    apiListDeliveries,
    apiSyncNovaPoshta,
    apiUpdateCarrier,
    apiUpdateDeliveryStatus,
    apiVerifyNfc,
    type CodOrder,
    type Delivery,
} from '../services/apiClient';

type Tab = 'orders' | 'deliveries' | 'nfc' | 'verify';

interface CrmPageProps {
    onBack: () => void;
}

const STATUS_LABEL: Record<string, string> = {
    pending: 'Pending',
    assigned: 'Assigned',
    picked_up: 'Picked Up',
    in_transit: 'In Transit',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    verified: 'Verified',
    failed: 'Failed',
};

const STATUS_LABEL_UK: Record<string, string> = {
    pending: 'Очікує', assigned: 'Призначено', picked_up: 'Забрано',
    in_transit: 'У дорозі', out_for_delivery: 'Передано кур’єру',
    delivered: 'Доставлено', verified: 'Підтверджено', failed: 'Помилка',
};

const STATUS_COLOR: Record<string, string> = {
    pending: 'var(--text-faint)',
    assigned: '#42a5f5',
    picked_up: '#26a69a',
    in_transit: '#7e57c2',
    out_for_delivery: 'var(--warn)',
    delivered: 'var(--primary)',
    verified: 'var(--primary)',
    failed: 'var(--danger)',
};

export default function CrmPage({ onBack }: CrmPageProps) {
    const { currentUser } = useAuth();
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [tab, setTab] = useState<Tab>('orders');
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Delivery | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiListDeliveries();
            setDeliveries(data);
        } catch (e: any) {
            console.warn('Deliveries API error:', e);
            setDeliveries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh().catch((e) => console.warn('CRM init error:', e));
    }, [refresh]);

    const isMine = (d: Delivery) => d.sellerId === currentUser?.uid;

    const sellerStats = useMemo(() => {
        const mine = deliveries.filter(isMine);
        return {
            total: mine.length,
            inTransit: mine.filter(d => ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'].includes(d.status)).length,
            done: mine.filter(d => ['delivered', 'verified'].includes(d.status)).length,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deliveries, currentUser?.uid]);

    return (
        <div className="page mi-screen-pad" style={{ padding: '16px 20px 100px', color: 'var(--text)', minHeight: '100vh', overflowY: 'auto', background: 'var(--bg-page)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button
                    onClick={onBack}
                    style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--bg-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', border: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
                    aria-label="Back"
                >
                    ←
                </button>
                <div>
                    <h2 className="h2">CRM</h2>
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{uk ? 'Керування замовленнями та доставкою' : 'Order and delivery management'}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                <Stat label={uk ? 'Усього' : 'Total'} value={sellerStats.total} />
                <Stat label={uk ? 'У дорозі' : 'In transit'} value={sellerStats.inTransit} color="var(--warn)" />
                <Stat label={uk ? 'Доставлено' : 'Delivered'} value={sellerStats.done} color="var(--primary)" />
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <TabBtn active={tab === 'orders'}     onClick={() => setTab('orders')}>{uk ? 'Замовлення' : 'Orders'}</TabBtn>
                <TabBtn active={tab === 'deliveries'} onClick={() => setTab('deliveries')}>{uk ? 'Доставки' : 'Deliveries'}</TabBtn>
                <TabBtn active={tab === 'nfc'}        onClick={() => setTab('nfc')}>NFC</TabBtn>
                <TabBtn active={tab === 'verify'}     onClick={() => setTab('verify')}>{uk ? 'Перевірка' : 'Verify'}</TabBtn>
            </div>

            {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>{uk ? 'Завантаження…' : 'Loading...'}</div>}

            {tab === 'orders' && (
                <OrdersTab
                    onOrderAccepted={() => { setTab('deliveries'); refresh(); }}
                />
            )}
            {tab === 'deliveries' && (
                <DeliveriesTab
                    loading={loading}
                    deliveries={deliveries}
                    onRefresh={refresh}
                    selected={selected}
                    setSelected={setSelected}
                    currentUid={currentUser?.uid ?? ''}
                />
            )}
            {tab === 'nfc' && <NfcBindTab />}
            {tab === 'verify' && <NfcVerifyTab />}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Orders tab — incoming COD orders, one-click accept → Delivery
// ───────────────────────────────────────────────────────────────────────────────

function OrdersTab({ onOrderAccepted }: { onOrderAccepted: () => void }) {
    const { currentUser } = useAuth();
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [orders, setOrders] = useState<CodOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiListCodOrders();
            setOrders(data);
        } catch (e: any) {
            console.warn('Orders loading error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh().catch((e) => console.warn('Orders init error:', e));
    }, [refresh]);

    const myOrders = orders.filter(o => o.sellerId === currentUser?.uid);
    const pending  = myOrders.filter(o => o.status === 'pending');
    const inFlight = myOrders.filter(o => o.status === 'in_delivery');

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <button onClick={refresh} style={btnSecondary}>↻ {uk ? 'Оновити' : 'Refresh'}</button>
                <span style={{ color: '#aaa', fontSize: 13 }}>
                    {uk ? 'Очікують' : 'Pending'}: {pending.length} · {uk ? 'У доставці' : 'In delivery'}: {inFlight.length}
                </span>
            </div>

            {loading && <div>{uk ? 'Завантаження…' : 'Loading...'}</div>}

            {!loading && pending.length === 0 && (
                <div style={{ color: '#aaa', padding: 20, textAlign: 'center' }}>
                    {uk ? 'Нових замовлень немає. Вони з’являться автоматично після оформлення покупцем післяплати.' : 'No new orders. They appear automatically when buyers place COD orders through the app.'}
                </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
                {pending.map(o => (
                    <OrderCard
                        key={o.id}
                        order={o}
                        accepting={acceptingId === o.id}
                        onStartAccept={() => setAcceptingId(o.id)}
                        onCancelAccept={() => setAcceptingId(null)}
                        onAccepted={() => { setAcceptingId(null); refresh(); onOrderAccepted(); }}
                    />
                ))}
            </div>
        </div>
    );
}

function OrderCard({ order, accepting, onStartAccept, onCancelAccept, onAccepted }: {
    order: CodOrder;
    accepting: boolean;
    onStartAccept: () => void;
    onCancelAccept: () => void;
    onAccepted: () => void;
}) {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [carrierType, setCarrierType] = useState<'self' | 'nova_poshta'>('self');
    const [ttn, setTtn] = useState('');
    const [courierId, setCourierId] = useState('');
    const [nfcUid, setNfcUid] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function accept() {
        setBusy(true); setErr(null);
        try {
            await apiAcceptCodOrder(order.id, {
                carrierType,
                npTrackingNumber: carrierType === 'nova_poshta' ? (ttn || undefined) : undefined,
                courierId:        carrierType === 'self'        ? (courierId || undefined) : undefined,
                nfcUid: nfcUid || undefined,
            });
            onAccepted();
        } catch (e: any) {
            setErr(e?.message ?? 'Ошибка');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                    <div style={{ fontWeight: 600 }}>{order.nftTitle}</div>
                    <div style={{ fontSize: 13, color: '#ddd', marginTop: 6 }}>
                        <div>👤 <b>{order.fullName || order.buyerName}</b></div>
                        <div>📞 {order.phone}</div>
                        <div>🚚 {order.deliveryAddress}</div>
                        <div style={{ color: '#aaa' }}>
                            💰 {order.price} {order.nftCurrency} ({order.paymentCurrency})
                        </div>
                    </div>
                </div>
                {!accepting && (
                    <button onClick={onStartAccept} style={btnPrimary}>{uk ? 'Прийняти' : 'Accept'}</button>
                )}
            </div>

            {accepting && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #333' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <button onClick={() => setCarrierType('self')}        style={carrierType === 'self'        ? btnPrimary : btnSecondary}>{uk ? 'Власна доставка' : 'Self delivery'}</button>
                        <button onClick={() => setCarrierType('nova_poshta')} style={carrierType === 'nova_poshta' ? btnPrimary : btnSecondary}>Nova Poshta</button>
                    </div>
                    {carrierType === 'nova_poshta' ? (
                        <input value={ttn}       onChange={e => setTtn(e.target.value)}       placeholder="Nova Poshta tracking #"          style={input} />
                    ) : (
                        <input value={courierId} onChange={e => setCourierId(e.target.value)} placeholder="Courier UID (optional)"   style={input} />
                    )}
                    <input value={nfcUid} onChange={e => setNfcUid(e.target.value)} placeholder="NFC UID tag (optional)" style={input} />
                    {err && <div style={errBox}>{err}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button disabled={busy} onClick={accept}         style={btnPrimary}>✓ {uk ? 'Створити доставку' : 'Create delivery'}</button>
                        <button disabled={busy} onClick={onCancelAccept} style={btnSecondary}>{uk ? 'Скасувати' : 'Cancel'}</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Deliveries tab
// ───────────────────────────────────────────────────────────────────────────────

interface DeliveriesTabProps {
    loading: boolean;
    deliveries: Delivery[];
    onRefresh: () => void;
    selected: Delivery | null;
    setSelected: (d: Delivery | null) => void;
    currentUid: string;
}

function DeliveriesTab({ loading, deliveries, onRefresh, selected, setSelected, currentUid }: DeliveriesTabProps) {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [creating, setCreating] = useState(false);

    if (selected) {
        return (
            <DeliveryDetail
                delivery={selected}
                onBack={() => setSelected(null)}
                onChanged={(d) => { setSelected(d); onRefresh(); }}
                currentUid={currentUid}
            />
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <button onClick={onRefresh} style={btnSecondary}>↻ {uk ? 'Оновити' : 'Refresh'}</button>
                <button onClick={() => setCreating(true)} style={btnPrimary}>+ {uk ? 'Нова доставка' : 'New delivery'}</button>
            </div>

            {creating && (
                <CreateDeliveryForm
                    onCancel={() => setCreating(false)}
                    onCreated={(d) => { setCreating(false); onRefresh(); setSelected(d); }}
                />
            )}

            {loading && <div>{uk ? 'Завантаження…' : 'Loading...'}</div>}

            {!loading && deliveries.length === 0 && (
                <div style={{ color: '#aaa', padding: 20, textAlign: 'center' }}>
                    {uk ? 'Доставок поки немає. Створіть першу кнопкою «Нова доставка».' : 'No deliveries yet. Create the first one using the "+ New delivery" button.'}
                </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
                {deliveries.map(d => (
                    <div key={d.id} onClick={() => setSelected(d)} style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>{d.nftTitle}</div>
                                <div style={{ fontSize: 12, color: '#aaa' }}>
                                    {uk ? 'Покупець' : 'Buyer'}: {d.buyerName} · {d.deliveryAddress}
                                </div>
                                <div style={{ fontSize: 12, color: '#aaa' }}>
                                    {uk ? 'Перевізник' : 'Carrier'}: {d.carrierType === 'self'
                                        ? `${uk ? 'Власна доставка' : 'Self delivery'}${d.courierName ? ` · ${d.courierName}` : ''}`
                                        : `Nova Poshta${d.npTrackingNumber ? ` · ${d.npTrackingNumber}` : ''}`}
                                </div>
                            </div>
                            <StatusBadge status={d.status} />
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                            {uk ? 'Оновлено' : 'Updated'} {formatTime(d.updatedAt)} · {uk ? 'Події' : 'Checkpoints'}: {d.checkpoints.length}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Delivery detail
// ───────────────────────────────────────────────────────────────────────────────

function DeliveryDetail({ delivery, onBack, onChanged, currentUid }: {
    delivery: Delivery;
    onBack: () => void;
    onChanged: (d: Delivery) => void;
    currentUid: string;
}) {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [busy, setBusy] = useState(false);
    const [cpStatus, setCpStatus] = useState('');
    const [cpLocation, setCpLocation] = useState('');
    const [cpNote, setCpNote] = useState('');

    const isSeller = delivery.sellerId === currentUid;
    const isBuyer  = delivery.buyerId === currentUid;
    const isCourier = delivery.courierId === currentUid;
    const canModify = isSeller || isCourier || delivery.controllerId === currentUid;

    async function call<T>(fn: () => Promise<T>) {
        setBusy(true);
        try {
            const r = await fn();
            return r;
        } finally {
            setBusy(false);
        }
    }

    async function addCheckpoint() {
        if (!cpStatus.trim() || !cpLocation.trim()) return;
        const updated = await call(() => apiAddCheckpoint(delivery.id, {
            status: cpStatus, location: cpLocation, note: cpNote || undefined,
        }));
        setCpStatus(''); setCpLocation(''); setCpNote('');
        onChanged(updated);
    }

    async function setStatus(status: string) {
        const updated = await call(() => apiUpdateDeliveryStatus(delivery.id, status));
        onChanged(updated);
    }

    async function syncNp() {
        const updated = await call(() => apiSyncNovaPoshta(delivery.id));
        onChanged(updated);
    }

    async function confirm() {
        const updated = await call(() => apiConfirmReceipt(delivery.id));
        onChanged(updated);
    }

    return (
        <div>
            <button onClick={onBack} style={btnGhost}>← {uk ? 'До списку' : 'Back to list'}</button>

            <div style={{ ...card, marginTop: 12 }}>
                <h3 style={{ margin: '0 0 8px' }}>{delivery.nftTitle}</h3>
                <StatusBadge status={delivery.status} />
                <div style={{ marginTop: 12, fontSize: 14, color: '#ccc', display: 'grid', gap: 4 }}>
                    <div>{uk ? 'Покупець' : 'Buyer'}: <b>{delivery.buyerName}</b></div>
                    <div>{uk ? 'Адреса' : 'Address'}: {delivery.deliveryAddress}</div>
                    <div>{uk ? 'Перевізник' : 'Carrier'}: {delivery.carrierType === 'self' ? (uk ? 'Власна доставка' : 'Self delivery') : 'Nova Poshta'}</div>
                    {delivery.courierName    && <div>{uk ? 'Кур’єр' : 'Courier'}: {delivery.courierName}</div>}
                    {delivery.controllerName && <div>{uk ? 'Контролер' : 'Controller'}: {delivery.controllerName}</div>}
                    {delivery.npTrackingNumber && <div>Tracking #: {delivery.npTrackingNumber}</div>}
                    {delivery.nfcUid && <div>NFC UID: <code>{delivery.nfcUid}</code></div>}
                </div>
            </div>

            {isSeller && (
                <CarrierEditor delivery={delivery} onChanged={onChanged} />
            )}

            {canModify && (
                <div style={{ ...card, marginTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Додати подію доставки' : 'Add checkpoint'}</h4>
                    <input value={cpStatus}   onChange={e => setCpStatus(e.target.value)}   placeholder="Status (e.g. Arrived in Kyiv)"          style={input} />
                    <input value={cpLocation} onChange={e => setCpLocation(e.target.value)} placeholder="Location (e.g. Sorting center)" style={input} />
                    <input value={cpNote}     onChange={e => setCpNote(e.target.value)}     placeholder="Note (optional)"                     style={input} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button disabled={busy} onClick={addCheckpoint} style={btnPrimary}>+ {uk ? 'Додати' : 'Add'}</button>
                        {delivery.carrierType === 'nova_poshta' && (
                            <button disabled={busy} onClick={syncNp} style={btnSecondary}>↻ Sync Nova Poshta</button>
                        )}
                        {!['delivered', 'verified'].includes(delivery.status) && (
                            <>
                                <button disabled={busy} onClick={() => setStatus('out_for_delivery')} style={btnSecondary}>{uk ? 'Передано кур’єру' : 'Out for delivery'}</button>
                                <button disabled={busy} onClick={() => setStatus('delivered')}        style={btnSecondary}>{uk ? 'Доставлено' : 'Delivered'}</button>
                                <button disabled={busy} onClick={() => setStatus('failed')}           style={btnDanger}>{uk ? 'Помилка' : 'Failed'}</button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {isBuyer && !delivery.customerReceived && (
                <div style={{ ...card, marginTop: 12, borderColor: '#01ff77' }}>
                    <h4 style={{ margin: '0 0 8px', color: '#01ff77' }}>{uk ? 'Я отримав товар' : 'I received the item'}</h4>
                    <p style={{ fontSize: 13, color: '#aaa', margin: '0 0 8px' }}>
                        Confirm receipt or tap NFC tag in the Verify tab.
                    </p>
                    <button disabled={busy} onClick={confirm} style={btnPrimary}>✓ {uk ? 'Підтвердити отримання' : 'Confirm receipt'}</button>
                </div>
            )}

            <div style={{ ...card, marginTop: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Історія доставки' : 'Tracking history'}</h4>
                {delivery.checkpoints.length === 0 && <div style={{ color: '#aaa' }}>{uk ? 'Подій поки немає' : 'No checkpoints yet'}</div>}
                <div style={{ display: 'grid', gap: 8 }}>
                    {[...delivery.checkpoints].reverse().map(cp => (
                        <div key={cp.id} style={{ borderLeft: '3px solid #01ff77', paddingLeft: 10 }}>
                            <div style={{ fontWeight: 600 }}>{cp.status}</div>
                            <div style={{ fontSize: 12, color: '#aaa' }}>
                                {cp.location} · {formatTime(cp.timestamp)}
                                {cp.recordedByName && ` · ${cp.recordedByName}`}
                            </div>
                            {cp.note && <div style={{ fontSize: 12, color: '#888' }}>{cp.note}</div>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Carrier editor
// ───────────────────────────────────────────────────────────────────────────────

function CarrierEditor({ delivery, onChanged }: { delivery: Delivery; onChanged: (d: Delivery) => void }) {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [carrierType, setCarrierType] = useState<'self' | 'nova_poshta'>(delivery.carrierType);
    const [ttn, setTtn]             = useState(delivery.npTrackingNumber ?? '');
    const [courierId, setCourierId] = useState(delivery.courierId ?? '');
    const [controllerId, setControllerId] = useState(delivery.controllerId ?? '');
    const [busy, setBusy] = useState(false);

    async function save() {
        setBusy(true);
        try {
            const updated = await apiUpdateCarrier(delivery.id, {
                carrierType,
                npTrackingNumber: carrierType === 'nova_poshta' ? (ttn || undefined) : undefined,
                courierId:    carrierType === 'self' ? (courierId || undefined) : undefined,
                controllerId: controllerId || undefined,
            });
            onChanged(updated);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={{ ...card, marginTop: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Перевізник' : 'Carrier'}</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button onClick={() => setCarrierType('self')}        style={carrierType === 'self'        ? btnPrimary : btnSecondary}>{uk ? 'Власна доставка' : 'Self delivery'}</button>
                <button onClick={() => setCarrierType('nova_poshta')} style={carrierType === 'nova_poshta' ? btnPrimary : btnSecondary}>Nova Poshta</button>
            </div>
            {carrierType === 'nova_poshta' ? (
                <input value={ttn}          onChange={e => setTtn(e.target.value)}          placeholder="Nova Poshta tracking #" style={input} />
            ) : (
                <input value={courierId}    onChange={e => setCourierId(e.target.value)}    placeholder="Courier UID"     style={input} />
            )}
            <input value={controllerId} onChange={e => setControllerId(e.target.value)} placeholder="Controller UID (optional)" style={input} />
            <button disabled={busy} onClick={save} style={btnPrimary}>{uk ? 'Зберегти' : 'Save'}</button>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Create-delivery form
// ───────────────────────────────────────────────────────────────────────────────

function CreateDeliveryForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (d: Delivery) => void }) {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [nfts, setNfts] = useState<any[]>([]);
    const [nftId, setNftId] = useState('');
    const [buyerId, setBuyerId] = useState('');
    const [address, setAddress] = useState('');
    const [carrierType, setCarrierType] = useState<'self' | 'nova_poshta'>('self');
    const [ttn, setTtn] = useState('');
    const [courierId, setCourierId] = useState('');
    const [nfcUid, setNfcUid] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        apiGetNFTs().then(setNfts).catch((e) => { console.warn('NFTs error:', e); setNfts([]); });
    }, []);

    async function submit() {
        if (!nftId || !buyerId || !address) {
            setErr('NFT, покупатель и адрес обязательны');
            return;
        }
        setBusy(true); setErr(null);
        try {
            const d = await apiCreateDelivery({
                nftId, buyerId, deliveryAddress: address, carrierType,
                npTrackingNumber: carrierType === 'nova_poshta' ? (ttn || undefined) : undefined,
                courierId:        carrierType === 'self'        ? (courierId || undefined) : undefined,
                nfcUid: nfcUid || undefined,
            });
            onCreated(d);
        } catch (e: any) {
            setErr(e?.message ?? 'Create error');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={{ ...card, marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Нова доставка' : 'New delivery'}</h4>
            <select value={nftId} onChange={e => setNftId(e.target.value)} style={input}>
                <option value="">— {uk ? 'Оберіть NFT' : 'Select NFT'} —</option>
                {nfts.map((n: any) => (
                    <option key={n.id} value={n.id}>{n.title}</option>
                ))}
            </select>
            <input value={buyerId}   onChange={e => setBuyerId(e.target.value)}   placeholder={uk ? 'UID покупця' : 'Buyer UID'} style={input} />
            <input value={address}   onChange={e => setAddress(e.target.value)}   placeholder={uk ? 'Адреса доставки' : 'Delivery address'} style={input} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button onClick={() => setCarrierType('self')}        style={carrierType === 'self'        ? btnPrimary : btnSecondary}>{uk ? 'Власна доставка' : 'Self delivery'}</button>
                <button onClick={() => setCarrierType('nova_poshta')} style={carrierType === 'nova_poshta' ? btnPrimary : btnSecondary}>Nova Poshta</button>
            </div>
            {carrierType === 'nova_poshta' ? (
                <input value={ttn}       onChange={e => setTtn(e.target.value)}       placeholder="Tracking #"          style={input} />
            ) : (
                <input value={courierId} onChange={e => setCourierId(e.target.value)} placeholder="Courier UID" style={input} />
            )}
            <input value={nfcUid} onChange={e => setNfcUid(e.target.value)} placeholder="NFC UID tag (optional)" style={input} />
            {err && <div style={errBox}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={submit} style={btnPrimary}>{uk ? 'Створити' : 'Create'}</button>
                <button disabled={busy} onClick={onCancel} style={btnSecondary}>{uk ? 'Скасувати' : 'Cancel'}</button>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// NFC binding tab
// ───────────────────────────────────────────────────────────────────────────────

function NfcBindTab() {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [nfts, setNfts] = useState<any[]>([]);
    const [nftId, setNftId] = useState('');
    const [uid, setUid] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);

    useEffect(() => {
        apiGetNFTs().then(setNfts).catch((e) => { console.warn('NFTs error:', e); setNfts([]); });
    }, []);

    async function bind() {
        if (!nftId || !uid) return;
        setBusy(true); setMsg(null); setQrCodeUrl(null);
        try {
            const r = await apiBindNfc({ nftId, nfcUid: uid });
            setMsg({ kind: 'ok', text: `Bound: UID ${r.nfcUid}` });
            
            // Generate test QR code
            try {
                const qrUrl = `https://alankharisov.github.io/idenity/?nfc=${r.nfcUid}`;
                const dataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 200, color: { dark: '#000000', light: '#ffffff' } });
                setQrCodeUrl(dataUrl);
            } catch (err) {
                console.warn('Failed to generate QR code', err);
            }
            
            setUid('');
        } catch (e: any) {
            setMsg({ kind: 'err', text: e?.message ?? 'Error' });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={card}>
            <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Прив’язати NFC-мітку до NFT' : 'Bind NFC tag to NFT'}</h4>
            <p style={{ fontSize: 12, color: '#aaa' }}>
                MVP: NTAG 216, UID verification. For production copy protection,
                we will move to NTAG 424 DNA with CMAC.
            </p>
            <select value={nftId} onChange={e => setNftId(e.target.value)} style={input}>
                <option value="">— {uk ? 'Оберіть NFT' : 'Select NFT'} —</option>
                {nfts.map((n: any) => (
                    <option key={n.id} value={n.id}>{n.title}</option>
                ))}
            </select>
            <input value={uid} onChange={e => setUid(e.target.value)} placeholder="UID (e.g. 04:A1:B2:C3:D4:E5:80)" style={input} />
            {msg && <div style={msg.kind === 'ok' ? okBox : errBox}>{msg.text}</div>}
            <button disabled={busy} onClick={bind} style={btnPrimary}>{uk ? 'Прив’язати' : 'Bind'}</button>

            {qrCodeUrl && (
                <div style={{ marginTop: 24, textAlign: 'center', background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                    <h5 style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: 14 }}>{uk ? 'Тестовий QR-код для сканера' : 'Test QR Code for Scanner'}</h5>
                    <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>{uk ? 'Відскануйте його вбудованим QR-сканером для імітації NFC.' : 'Scan this directly with the in-app QR Scanner to simulate an NFC tap.'}</p>
                    <img src={qrCodeUrl} alt="Test QR Code" style={{ borderRadius: 8, display: 'block', margin: '0 auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// NFC verify tab — buyer's "tap to confirm receipt" flow
// ───────────────────────────────────────────────────────────────────────────────

function NfcVerifyTab() {
    const { language } = useLanguage();
    const uk = language === 'uk';
    const [uid, setUid] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [err, setErr] = useState<string | null>(null);

    async function verify(useWebNfc: boolean) {
        setErr(null); setResult(null);
        if (useWebNfc) {
            // @ts-ignore – Web NFC is non-standard but works on Chrome Android
            if (typeof NDEFReader === 'undefined') {
                setErr('Web NFC not available on this device. Enter UID manually.');
                return;
            }
            try {
                // @ts-ignore
                const reader = new NDEFReader();
                await reader.scan();
                reader.onreading = (event: any) => {
                    const serial = event.serialNumber || '';
                    setUid(serial);
                    submit(serial);
                };
            } catch (e: any) {
                setErr('Could not start NFC: ' + (e?.message ?? 'unknown'));
            }
        } else {
            submit(uid);
        }
    }

    async function submit(value: string) {
        if (!value.trim()) return;
        setBusy(true); setErr(null);
        try {
            const r = await apiVerifyNfc(value);
            setResult(r);
        } catch (e: any) {
            setErr(e?.message ?? 'Verification error');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={card}>
            <h4 style={{ margin: '0 0 8px' }}>{uk ? 'Перевірка автентичності / отримання товару' : 'Authenticity verification / item receipt'}</h4>
            <p style={{ fontSize: 12, color: '#aaa' }}>
                Tap your phone to the tag (Android) or enter UID manually. If you have
                an open delivery for this NFT — it will automatically close.
            </p>
            <input value={uid} onChange={e => setUid(e.target.value)} placeholder="UID (or tap Scan)" style={input} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button disabled={busy} onClick={() => verify(true)}  style={btnPrimary}>{uk ? 'Сканувати' : 'Scan'}</button>
                <button disabled={busy} onClick={() => verify(false)} style={btnSecondary}>{uk ? 'Перевірити вручну' : 'Verify manually'}</button>
            </div>
            {err && <div style={errBox}>{err}</div>}
            {result && (
                <div style={okBox}>
                    <b>{result.nftTitle}</b><br />
                    {uk ? 'Власник' : 'Owner'}: {result.ownerName}<br />
                    {result.mintAddress && <>Mint: <code>{result.mintAddress.slice(0, 12)}…</code><br /></>}
                    {result.autoConfirmedReceipt
                        ? (uk ? '✓ Доставку автоматично позначено отриманою' : '✓ Delivery automatically marked as received')
                        : (uk ? 'Автентичність підтверджено' : 'Authenticity confirmed')}
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Bits and pieces
// ───────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const { language } = useLanguage();
    const color = STATUS_COLOR[status] ?? 'var(--text-faint)';
    return (
        <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 999,
            background: 'var(--primary-soft)', color: 'var(--primary-ink)',
            fontSize: 11, fontWeight: 700, border: `1px solid ${color}`,
        }}>
            {(language === 'uk' ? STATUS_LABEL_UK[status] : STATUS_LABEL[status]) ?? status}
        </span>
    );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
    return (
        <div className="card" style={{ padding: '12px 14px' }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: color ?? 'var(--text)', marginTop: 2 }}>{value}</div>
        </div>
    );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick} style={{
            background: 'none', border: 'none',
            color: active ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
            padding: '10px 14px', cursor: 'pointer', fontSize: 13,
            fontWeight: 600, fontFamily: 'inherit', marginBottom: -1,
        }}>
            {children}
        </button>
    );
}

const card: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
    padding: 14, cursor: 'pointer', color: 'var(--text)',
};
const input: React.CSSProperties = {
    width: '100%', padding: '12px 14px', marginBottom: 10, background: 'var(--bg-soft)',
    border: '1px solid transparent', color: 'var(--text)', borderRadius: 12,
    fontFamily: 'inherit', fontSize: 14, outline: 'none',
};
const btnPrimary: React.CSSProperties = {
    background: 'var(--primary)', color: '#fff', border: 'none', padding: '10px 18px',
    borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};
const btnSecondary: React.CSSProperties = {
    background: 'var(--bg-soft)', color: 'var(--text)', border: 'none', padding: '10px 18px',
    borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};
const btnDanger: React.CSSProperties = {
    background: 'rgba(229,72,72,0.1)', color: 'var(--danger)', border: 'none', padding: '10px 18px',
    borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};
const btnGhost: React.CSSProperties = {
    background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-strong)',
    padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
};
const errBox: React.CSSProperties = {
    background: 'rgba(229,72,72,0.08)', color: 'var(--danger)',
    border: '1px solid rgba(229,72,72,0.25)', padding: 10, borderRadius: 12, marginBottom: 10, fontSize: 13,
};
const okBox: React.CSSProperties = {
    background: 'var(--primary-faint)', color: 'var(--primary-ink)',
    border: '1px solid var(--primary-soft)', padding: 10, borderRadius: 12, marginBottom: 10, fontSize: 13,
};
