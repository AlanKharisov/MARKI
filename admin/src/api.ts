import { auth } from './firebase';

const BASE_URL = (import.meta.env.VITE_API_URL as string) || 'https://idenity.onrender.com';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not signed in');
  return t;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Company = {
  uid: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  avatar?: string;
  createdAt: string;
  companyApproved: boolean;
  pendingApproval: boolean;
  banned: boolean;
  companyName?: string;
  registrationNumber?: string;
  contactEmail?: string;
  businessDescription?: string;
  approvalRequestedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'banned';
  rejectionReason?: string;
  banReason?: string;
};

export type StatusFilter = 'pending' | 'approved' | 'rejected' | 'banned' | 'all';

export const apiAdminMe = () => req<{ uid: string; admin: boolean }>('GET', '/api/admin/me');

export const apiListCompanies = (status: StatusFilter) =>
  req<Company[]>('GET', `/api/admin/companies?status=${status}`);

export const apiApprove = (uid: string) =>
  req<void>('POST', `/api/admin/companies/${uid}/approve`, {});

export const apiReject = (uid: string, reason: string) =>
  req<void>('POST', `/api/admin/companies/${uid}/reject`, { reason });

export const apiBan = (uid: string, reason: string) =>
  req<void>('POST', `/api/admin/companies/${uid}/ban`, { reason });

export const apiUnban = (uid: string) =>
  req<void>('POST', `/api/admin/companies/${uid}/unban`, {});
