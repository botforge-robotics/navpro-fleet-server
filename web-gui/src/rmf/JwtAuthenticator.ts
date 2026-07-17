import EventEmitter from 'eventemitter3';
import { clearSession, getToken, getUser } from '../api/auth';

// Adapter bridging the platform JWT session to rmf-dashboard-framework's
// Authenticator interface, so the framework never shows its own login: there
// is exactly one auth system (the Platform API's). The interface below mirrors
// the framework's `Authenticator` contract (see
// packages/rmf-dashboard-framework/src/services/authenticator.ts).

export type AuthenticatorEventType = {
  userChanged: [string | null];
  tokenRefresh: null;
};

export interface AuthenticatorLike extends EventEmitter<AuthenticatorEventType> {
  user?: string;
  token?: string;
  init(): Promise<void>;
  refreshToken(): Promise<void>;
  login(successRedirectUri?: string): Promise<never> | Promise<void>;
  logout(): Promise<never> | Promise<void>;
}

export class JwtAuthenticator
  extends EventEmitter<AuthenticatorEventType>
  implements AuthenticatorLike
{
  get user(): string | undefined {
    return getUser()?.username;
  }

  get token(): string | undefined {
    return getToken() ?? undefined;
  }

  async init(): Promise<void> {
    // Session is established by the platform /login page before this mounts.
  }

  async refreshToken(): Promise<void> {
    // Platform JWTs are long-lived for LAN deployments; a 401 anywhere clears
    // the session and the auth guard redirects to /login.
  }

  async login(): Promise<void> {
    window.location.assign('/login');
  }

  async logout(): Promise<void> {
    this.emit('userChanged', null);
    clearSession();
    window.location.assign('/login');
  }
}
