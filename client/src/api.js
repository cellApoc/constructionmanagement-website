/**
 * API Helper for Cloudflare Pages deployment.
 *
 * In development: API calls go to /api/... (Vite proxy forwards to localhost:3001)
 * In production:  API calls go to https://your-backend.elasticbeanstalk.com/api/...
 *
 * Usage in React components:
 *   import api from '../api';
 *
 *   // GET
 *   const jobs = await api.get('/api/jobs');
 *
 *   // POST
 *   const result = await api.post('/api/auth/login', { email, password });
 *
 *   // PUT
 *   await api.put('/api/tasks/' + taskId, { name: 'Updated' });
 *
 *   // DELETE
 *   await api.del('/api/tasks/' + taskId);
 */

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request(method, path, body = null) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }

  if (res.status === 204) return null;
  return res.json();
}

const api = {
  get:  (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put:  (path, body) => request('PUT', path, body),
  del:  (path) => request('DELETE', path),
};

export default api;
