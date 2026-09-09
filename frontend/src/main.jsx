import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_CONFIG_ERROR } from './lib/api.js';
import { initNative } from './lib/native.js';
import { mirrorTestIdsToNativeIds } from './lib/nativeIds.js';

import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import './index.css';

/**
 * Query defaults.
 * Live Socket.IO events drive most invalidation, so polling stays off; a short
 * stale time still de-duplicates the bursts of refetches a navigation causes.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry a client error — the request is wrong, not unlucky.
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});


/**
 * A misconfigured native build cannot reach any API, so every screen would be
 * a spinner or a vague "cannot reach" toast. Say so plainly once, instead.
 */
function ConfigError({ message }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#180B10',
        color: '#F8FAFC',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: '34rem' }}>
        <p
          style={{
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#EC7BA4',
            margin: 0,
          }}
        >
          Build misconfigured
        </p>
        <h1 style={{ fontSize: '1.5rem', margin: '0.75rem 0 0', fontWeight: 600 }}>
          This build cannot reach the SedBank API
        </h1>
        <p style={{ color: '#B8A9AC', lineHeight: 1.65, marginTop: '0.75rem' }}>{message}</p>
      </div>
    </div>
  );
}

// Status bar, keyboard, capability profile and power handling. No-ops on web.
initNative();
// Gives every testid a matching resource-id — see lib/nativeIds.js.
mirrorTestIdsToNativeIds();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {API_CONFIG_ERROR ? (
      <ConfigError message={API_CONFIG_ERROR} />
    ) : (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <SocketProvider>
              <App />
            </SocketProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
    )}
  </StrictMode>
);
