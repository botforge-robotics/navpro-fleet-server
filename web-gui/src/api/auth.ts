import type { LoginResponse, User } from './types';

// Minimal auth store: JWT + user persisted in localStorage, subscribable so
// React (useSyncExternalStore) and the fetch/ws clients share one source.

const TOKEN_KEY = 'navpro.token';
const USER_KEY = 'navpro.user';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSession(session: LoginResponse): void {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  notify();
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notify();
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
