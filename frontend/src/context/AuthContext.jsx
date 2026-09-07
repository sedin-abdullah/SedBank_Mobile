/**
 * Authentication state: the current user, the JWT, and login/logout.
 * The token is restored from localStorage on boot and re-validated against
 * /auth/me so a revoked or expired session never renders a stale UI.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { http, setToken, getToken, setUnauthorizedHandler } from '../lib/api.js';
import { IS_NATIVE, registerPush, onPushToken } from '../lib/native.js';
import { isStaff } from '../lib/constants.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const queryClient = useQueryClient();

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  /**
   * Push registration waits for a signed-in user — prompting for
   * notification permission on a sign-in screen asks before there is
   * anything to notify anyone about.
   *
   * Delivery needs a Firebase project and google-services.json. Without one
   * this resolves to `{ granted: false, reason: 'no-firebase' }` and the app
   * carries on: notifications are still visible in the in-app bell.
   */
  useEffect(() => {
    if (!IS_NATIVE || !user) return undefined;

    let stop = () => {};
    (async () => {
      const result = await registerPush({
        onNotification: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      });
      if (result.granted) {
        stop = onPushToken((token) => {
          // The device token is only useful to a backend that sends pushes;
          // logged for now so wiring it up is a one-line change later.
          console.info('[push] device token acquired', token?.slice(0, 12), '…');
        });
      }
    })();

    return () => stop();
  }, [user, queryClient]);

  // Any 401 from the API (other than a failed login) ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => clearSession());
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Restore a persisted session on first paint.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getToken()) {
        setStatus('anonymous');
        return;
      }
      try {
        const data = await http.get('/auth/me');
        if (cancelled) return;
        setUser(data.user);
        setStatus('authenticated');
      } catch {
        if (!cancelled) clearSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const applySession = useCallback(
    (session) => {
      setToken(session.token);
      setUser(session.user);
      setStatus('authenticated');
      queryClient.clear();
      return session.user;
    },
    [queryClient]
  );

  const login = useCallback(
    async (credentials) => applySession(await http.post('/auth/login', credentials)),
    [applySession]
  );

  const register = useCallback(
    async (payload) => applySession(await http.post('/auth/register', payload)),
    [applySession]
  );

  /** Completes an OTP sign-in; returns the user, or null for the signup flow. */
  const verifyOtp = useCallback(
    async (payload) => {
      const result = await http.post('/auth/otp/verify', payload);
      return result.token ? applySession(result) : null;
    },
    [applySession]
  );

  const logout = useCallback(() => clearSession(), [clearSession]);

  /** Merges fields into the cached user after a profile update. */
  const patchUser = useCallback((changes) => setUser((current) => ({ ...current, ...changes })), []);

  const value = useMemo(
    () => ({
      user,
      status,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated',
      isStaff: !!user && isStaff(user.role),
      isCustomer: user?.role === 'customer',
      role: user?.role ?? null,
      login,
      register,
      verifyOtp,
      logout,
      patchUser,
    }),
    [user, status, login, register, verifyOtp, logout, patchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
};

export default AuthContext;
