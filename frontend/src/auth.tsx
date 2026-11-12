import React, { createContext, useContext, useState } from 'react';
import { api } from './api';

export interface Profile {
  id: string;
  username: string;
  name: string;
  role: 'STUDENT' | 'MENTOR' | 'ADMIN';
  studentNo?: string | null;
  mentorId?: string | null;
  mentorQuota?: number | null;
  mentorTitle?: string | null;
  labId?: string | null;
  labName?: string | null;
}

interface AuthCtx {
  user: Profile | null;
  token: string | null;
  login: (username: string, password: string) => Promise<Profile>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  token: null,
  login: async () => {
    throw new Error('not ready');
  },
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  const login = async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data.user as Profile;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, token, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

export function homeOf(role?: string): string {
  if (role === 'MENTOR') return '/mentor/interviews';
  if (role === 'ADMIN') return '/admin/quota';
  return '/student/intent';
}
