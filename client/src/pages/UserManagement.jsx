/**
 * @file Admin-only user management page.
 * Lists all users with search and role filter. Provides edit modal (name, role, phone)
 * and invite modal (creates new user via /api/auth/register).
 * @module client/pages/UserManagement
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Edit2,
  Search,
  X,
  AlertTriangle,
  Mail,
  Phone,
  Shield,
  Calendar,
  DollarSign,
  Plus,
  Trash2,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../App';

/** @constant {string[]} ROLES - Available user roles for selection dropdowns */
const ROLES = ['admin', 'foreman', 'worker'];

/**
 * UserManagement - Admin page for managing application users.
 * Features: searchable/filterable user table, edit user modal (name, role, phone),
 * and invite new user modal (name, email, password, role, phone).
 * @component
 * @returns {JSX.Element} User management page with table and modals
 */
export default function UserManagement() {
  const api = useApi();
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Edit modal
  const [editModal, setEditModal] = useState(null); // user object or null
  const [editForm, setEditForm] = useState({ name: '', role: '', phone: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Labor rates for edit modal
  const [laborRates, setLaborRates] = useState([]);
  const [laborRatesLoading, setLaborRatesLoading] = useState(false);
  const [newRate, setNewRate] = useState({ trade: '', hourlyRate: '', effectiveDate: '' });
  const [tradesSuggestions, setTradesSuggestions] = useState([]);

  // Invite modal
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', password: '', role: 'worker', phone: '', trade: '', hourlyRate: '' });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/api/users');
      setUsers(Array.isArray(data) ? data : data?.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    let result = users;
    if (roleFilter) {
      result = result.filter((u) => u.role === roleFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [users, roleFilter, searchQuery]);

  // Fetch trades suggestions on mount
  useEffect(() => {
    api.get('/api/labor-rates/trades').then(setTradesSuggestions).catch(() => {});
  }, [api]);

  // Edit handlers
  function openEditModal(u) {
    setEditForm({
      name: u.name || '',
      role: u.role || 'worker',
      phone: u.phone || '',
    });
    setEditError('');
    setEditModal(u);
    setNewRate({ trade: '', hourlyRate: '', effectiveDate: '' });
    // Fetch labor rates for this user
    if (['worker', 'foreman'].includes(u.role)) {
      setLaborRatesLoading(true);
      api.get(`/api/labor-rates/worker/${u._id || u.id}`).then(rates => {
        setLaborRates(rates);
        setLaborRatesLoading(false);
      }).catch(() => setLaborRatesLoading(false));
    } else {
      setLaborRates([]);
    }
  }

  async function addLaborRate() {
    if (!newRate.trade.trim() || !newRate.hourlyRate) {
      showToast('Trade and hourly rate are required', 'error');
      return;
    }
    try {
      const id = editModal._id || editModal.id;
      const rate = await api.post('/api/labor-rates', {
        workerId: id,
        trade: newRate.trade.trim(),
        hourlyRate: parseFloat(newRate.hourlyRate),
        effectiveDate: newRate.effectiveDate || undefined,
      });
      setLaborRates(prev => [rate, ...prev]);
      setNewRate({ trade: '', hourlyRate: '', effectiveDate: '' });
      showToast('Labor rate added');
      if (!tradesSuggestions.includes(newRate.trade.trim())) {
        setTradesSuggestions(prev => [...prev, newRate.trade.trim()].sort());
      }
    } catch (err) {
      showToast(err.message || 'Failed to add rate', 'error');
    }
  }

  async function deleteLaborRate(rateId) {
    try {
      await api.del(`/api/labor-rates/${rateId}`);
      setLaborRates(prev => prev.filter(r => r.id !== rateId));
      showToast('Labor rate removed');
    } catch (err) {
      showToast(err.message || 'Failed to delete rate', 'error');
    }
  }

  async function handleEditSave() {
    if (!editForm.name.trim()) {
      setEditError('Name is required');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      const id = editModal._id || editModal.id;
      const updated = await api.put(`/api/users/${id}`, {
        name: editForm.name.trim(),
        role: editForm.role,
        phone: editForm.phone.trim(),
      });
      setUsers((prev) =>
        prev.map((u) => ((u._id || u.id) === id ? { ...u, ...updated, ...editForm } : u))
      );
      setEditModal(null);
    } catch (err) {
      setEditError(err.message || 'Failed to update user');
    } finally {
      setEditSaving(false);
    }
  }

  // Invite handlers
  function openInviteModal() {
    setInviteForm({ name: '', email: '', password: '', role: 'worker', phone: '', trade: '', hourlyRate: '' });
    setInviteError('');
    setInviteModal(true);
  }

  async function handleInviteSave() {
    if (!inviteForm.name.trim() || !inviteForm.email.trim() || !inviteForm.password.trim()) {
      setInviteError('Name, email, and password are required');
      return;
    }
    setInviteSaving(true);
    setInviteError('');
    try {
      const regResult = await api.post('/api/auth/register', {
        name: inviteForm.name.trim(),
        email: inviteForm.email.trim(),
        password: inviteForm.password.trim(),
        role: inviteForm.role,
        phone: inviteForm.phone.trim() || undefined,
      });
      // Create initial labor rate if trade/rate provided
      if (inviteForm.trade.trim() && inviteForm.hourlyRate && ['worker', 'foreman'].includes(inviteForm.role)) {
        const userId = regResult?.user?.id || regResult?.user?._id;
        if (userId) {
          await api.post('/api/labor-rates', {
            workerId: userId,
            trade: inviteForm.trade.trim(),
            hourlyRate: parseFloat(inviteForm.hourlyRate),
          }).catch(() => {}); // non-critical
        }
      }
      setInviteModal(false);
      fetchUsers();
    } catch (err) {
      setInviteError(err.message || 'Failed to create user');
    } finally {
      setInviteSaving(false);
    }
  }

  function getRoleBadgeClass(role) {
    switch (role) {
      case 'admin':
        return 'badge-danger';
      case 'foreman':
        return 'badge-warning';
      case 'worker':
        return 'badge-success';
      default:
        return 'badge-neutral';
    }
  }

  return (
    <div className="page-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>User Management</h1>
        <button className="btn btn-primary" onClick={openInviteModal}>
          <UserPlus size={16} />
          Invite User
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">Search</label>
            <div style={{ position: 'relative' }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-light)',
                }}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label className="form-label">Role</label>
            <select
              className="form-input"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All Roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading users...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <Users size={40} style={{ color: 'var(--text-light)', marginBottom: 12 }} />
          <p className="text-light">
            {users.length === 0 ? 'No users found.' : 'No users match your filters.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Phone</th>
                  <th>Created</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const id = u._id || u.id;
                  return (
                    <tr key={id}>
                      <td style={{ fontWeight: 600 }}>{u.name || '--'}</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Mail size={14} style={{ color: 'var(--text-light)', flexShrink: 0 }} />
                          {u.email || '--'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${getRoleBadgeClass(u.role)}`}>
                          {u.role || 'unknown'}
                        </span>
                      </td>
                      <td>
                        {u.phone ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Phone size={14} style={{ color: 'var(--text-light)', flexShrink: 0 }} />
                            {u.phone}
                          </span>
                        ) : (
                          <span className="text-light">--</span>
                        )}
                      </td>
                      <td className="text-light">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '--'}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.8125rem' }}
                          onClick={() => openEditModal(u)}
                        >
                          <Edit2 size={14} />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, paddingBottom: 12 }}>
            <p className="text-light" style={{ fontSize: '0.8125rem', margin: 0 }}>
              Showing {filteredUsers.length} of {users.length} users
            </p>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Edit User</h2>
              <button
                onClick={() => setEditModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {editError && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <span>{editError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                type="text"
                className="form-input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={editModal.email || ''}
                disabled
                style={{ opacity: 0.6 }}
              />
              <p className="text-light" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                Email cannot be changed.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-input"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                type="tel"
                className="form-input"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>

            {/* Labor Rates Section — shown for workers and foremen */}
            {['worker', 'foreman'].includes(editForm.role) && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <DollarSign size={16} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Labor Rates</span>
                </div>

                {laborRatesLoading ? (
                  <p className="text-light" style={{ fontSize: '0.8125rem' }}>Loading rates...</p>
                ) : (
                  <>
                    {laborRates.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        {laborRates.map((r) => (
                          <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 10px', borderRadius: 'var(--radius-xs)',
                            border: '1px solid var(--border)', marginBottom: 6, fontSize: '0.8125rem',
                          }}>
                            <div>
                              <span style={{ fontWeight: 600 }}>{r.trade}</span>
                              <span style={{ marginLeft: 8, color: 'var(--success)', fontWeight: 600 }}>${parseFloat(r.hourlyRate).toFixed(2)}/hr</span>
                              <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.75rem' }}>
                                from {r.effectiveDate}
                              </span>
                            </div>
                            <button
                              className="btn btn-sm btn-danger"
                              style={{ padding: '2px 6px' }}
                              onClick={() => deleteLaborRate(r.id)}
                              title="Remove rate"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new rate row */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Trade</label>
                        <input
                          className="form-input"
                          style={{ fontSize: '0.8125rem' }}
                          value={newRate.trade}
                          onChange={(e) => setNewRate({ ...newRate, trade: e.target.value })}
                          placeholder="e.g. Carpenter"
                          list="trade-suggestions"
                        />
                        <datalist id="trade-suggestions">
                          {tradesSuggestions.map(t => <option key={t} value={t} />)}
                        </datalist>
                      </div>
                      <div style={{ width: 90 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>$/hr</label>
                        <input
                          type="number"
                          className="form-input"
                          style={{ fontSize: '0.8125rem' }}
                          value={newRate.hourlyRate}
                          onChange={(e) => setNewRate({ ...newRate, hourlyRate: e.target.value })}
                          step="0.50"
                          min="0"
                        />
                      </div>
                      <div style={{ width: 120 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Effective</label>
                        <input
                          type="date"
                          className="form-input"
                          style={{ fontSize: '0.8125rem' }}
                          value={newRate.effectiveDate}
                          onChange={(e) => setNewRate({ ...newRate, effectiveDate: e.target.value })}
                        />
                      </div>
                      <button className="btn btn-sm btn-primary" onClick={addLaborRate} style={{ marginBottom: 2 }}>
                        <Plus size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setEditModal(null)} disabled={editSaving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      {inviteModal && (
        <div className="modal-overlay" onClick={() => setInviteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Invite New User</h2>
              <button
                onClick={() => setInviteModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {inviteError && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <span>{inviteError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                type="text"
                className="form-input"
                value={inviteForm.name}
                onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                placeholder="John Smith"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email *</label>
              <input
                type="email"
                className="form-input"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Temporary Password *</label>
              <input
                type="text"
                className="form-input"
                value={inviteForm.password}
                onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                placeholder="Minimum 6 characters"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-input"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                type="tel"
                className="form-input"
                value={inviteForm.phone}
                onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>

            {['worker', 'foreman'].includes(inviteForm.role) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <DollarSign size={14} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Initial Labor Rate (optional)</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Trade</label>
                    <input
                      className="form-input"
                      value={inviteForm.trade}
                      onChange={(e) => setInviteForm({ ...inviteForm, trade: e.target.value })}
                      placeholder="e.g. Carpenter"
                      list="trade-suggestions-invite"
                    />
                    <datalist id="trade-suggestions-invite">
                      {tradesSuggestions.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                  <div className="form-group" style={{ width: 100, marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>$/hr</label>
                    <input
                      type="number"
                      className="form-input"
                      value={inviteForm.hourlyRate}
                      onChange={(e) => setInviteForm({ ...inviteForm, hourlyRate: e.target.value })}
                      step="0.50"
                      min="0"
                    />
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setInviteModal(false)} disabled={inviteSaving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleInviteSave} disabled={inviteSaving}>
                {inviteSaving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
