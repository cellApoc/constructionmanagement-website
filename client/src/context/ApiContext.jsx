/**
 * @file API context provider and hook.
 * Wraps all HTTP requests with JWT Authorization headers and handles
 * 401 auto-logout. Provides get, post, put, del, and upload methods.
 * @module client/context/ApiContext
 */

import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

/** @type {React.Context<ApiMethods|null>} */
const ApiContext = createContext(null);

/**
 * ApiProvider - Provides API methods (get, post, put, del, upload) to children.
 * Automatically attaches Bearer token and handles JSON serialization.
 * Auto-logs out on 401 responses.
 * @component
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 * @returns {JSX.Element} Context provider wrapping children
 */
export function ApiProvider({ children }) {
  const { token, logout } = useAuth();

  const api = useMemo(() => {
    /**
     * Core request function that handles auth headers, content type, and error handling.
     * @param {string} url - API endpoint URL
     * @param {RequestInit} [options={}] - Fetch options (method, body, headers)
     * @returns {Promise<Object|null>} Parsed JSON response or null for 204
     * @throws {Error} On non-OK responses (except 401 which triggers logout)
     */
    async function request(url, options = {}) {
      const headers = { ...options.headers };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, { ...options, headers });

      if (res.status === 401) {
        logout();
        throw new Error('Session expired. Please log in again.');
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `Request failed with status ${res.status}`);
      }

      if (res.status === 204) return null;
      return res.json();
    }

    return {
      get: (url) => request(url),
      post: (url, data) => request(url, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
      put: (url, data) => request(url, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
      del: (url) => request(url, { method: 'DELETE' }),
      upload: (url, formData) => request(url, {
        method: 'POST',
        body: formData,
      }),
    };
  }, [token, logout]);

  return (
    <ApiContext.Provider value={api}>
      {children}
    </ApiContext.Provider>
  );
}

/**
 * Custom hook to access API methods.
 * @returns {{get: Function, post: Function, put: Function, del: Function, upload: Function}}
 * @throws {Error} If used outside ApiProvider
 */
export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within ApiProvider');
  return ctx;
}
