import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export function errMsg(e: any): string {
  const data = e?.response?.data;
  if (!data) return e?.message || '网络异常，请稍后重试';
  if (typeof data === 'string') return data;
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.message)) return data.message.join('；');
  return '请求失败';
}

export function isOverQuotaError(e: any): boolean {
  return e?.response?.data?.code === 'OVER_QUOTA_CONFIRM_REQUIRED';
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
