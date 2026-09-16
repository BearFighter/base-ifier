/**
 * Optional account sign-in for paid features. The app never requires it.
 * Talks to AUTH_BASE_URL (docs/auth-api.md); until that service exists every
 * attempt ends in a friendly "not available yet" message.
 */
import { create } from 'zustand';
import { AUTH_BASE_URL } from './config';

export interface AccountUser {
  email: string;
  name?: string;
  /** e.g. 'free' | 'pro'; the server decides */
  plan?: string;
}

interface AuthStore {
  status: 'signed-out' | 'signing-in' | 'signed-in';
  user: AccountUser | null;
  token: string | null;
  error: string | null;
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): void;
  /** re-validate a stored token on startup (keeps it when offline) */
  restore(): Promise<void>;
}

const STORAGE_KEY = 'baseifier.auth';

function loadStored(): { token: string; user: AccountUser } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { token?: string; user?: AccountUser };
    return j.token && j.user?.email ? { token: j.token, user: j.user } : null;
  } catch {
    return null;
  }
}

function store(token: string | null, user: AccountUser | null): void {
  try {
    if (token && user) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

const NOT_AVAILABLE = 'The account service is not available yet. Base-ifier works fully without signing in.';

async function request(path: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(`${AUTH_BASE_URL}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const useAuthStore = create<AuthStore>()((set, get) => {
  const stored = loadStored();
  return {
    status: stored ? 'signed-in' : 'signed-out',
    user: stored?.user ?? null,
    token: stored?.token ?? null,
    error: null,

    async signIn(email, password) {
      set({ status: 'signing-in', error: null });
      try {
        const r = await request('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (r.status === 401 || r.status === 403) {
          set({ status: 'signed-out', error: 'Wrong email or password.' });
          return false;
        }
        if (!r.ok) {
          set({ status: 'signed-out', error: NOT_AVAILABLE });
          return false;
        }
        const j = (await r.json()) as { token?: string; user?: AccountUser };
        if (!j.token || !j.user?.email) {
          set({ status: 'signed-out', error: 'Unexpected reply from the account service.' });
          return false;
        }
        store(j.token, j.user);
        set({ status: 'signed-in', user: j.user, token: j.token, error: null });
        return true;
      } catch {
        set({ status: 'signed-out', error: NOT_AVAILABLE });
        return false;
      }
    },

    signOut() {
      store(null, null);
      set({ status: 'signed-out', user: null, token: null, error: null });
    },

    async restore() {
      const token = get().token;
      if (!token) return;
      try {
        const r = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) {
          get().signOut();
          return;
        }
        if (r.ok) {
          const j = (await r.json()) as { user?: AccountUser };
          if (j.user?.email) {
            store(token, j.user);
            set({ user: j.user });
          }
        }
      } catch {
        /* offline or service not up: keep the stored session */
      }
    },
  };
});
