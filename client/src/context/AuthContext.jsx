/**
 * @file Authentication context provider and hook.
 * Manages user login/register/logout state with JWT tokens stored in localStorage.
 * Provides the useAuth() hook for consuming components.
 * @module client/context/AuthContext
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

/** @type {React.Context<AuthContextValue|null>} */
const AuthContext = createContext(null);

/**
 * AuthProvider - Wraps children with authentication state and methods.
 * On mount, restores session from localStorage if a valid token exists.
 * @component
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 * @returns {JSX.Element} Context provider wrapping children
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  /**
   * Authenticate user with email and password.
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<{token: string, user: Object}>} Auth response
   * @throws {Error} If login fails
   */
  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  /**
   * Register a new user account and auto-login.
   * @param {string} email - New user email
   * @param {string} password - New user password
   * @param {string} name - Display name
   * @param {string} role - User role (worker|foreman|project_manager|admin)
   * @returns {Promise<{token: string, user: Object}>} Auth response
   * @throws {Error} If registration fails
   */
  const register = useCallback(async (email, password, name, role) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(err.error || 'Registration failed');
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  /** Clear auth state and remove token/user from localStorage. */
  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, register, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Custom hook to access auth context.
 * @returns {{user: Object|null, token: string|null, login: Function, logout: Function, register: Function, loading: boolean}}
 * @throws {Error} If used outside AuthProvider
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
