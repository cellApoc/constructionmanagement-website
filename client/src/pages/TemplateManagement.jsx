/**
 * @file Template management page for PM and Admin users.
 * Lists all templates with search. Provides create/edit modals with nested
 * scope and activity editing. Supports duplicate (clone), edit, and delete
 * with confirmation. Duplicate creates a "(Copy)" of the template with all
 * nested scopes and activities via POST /api/templates/:id/duplicate.
 * @module client/pages/TemplateManagement
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Plus,
  Copy,
  Edit2,
  Trash2,
  Search,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Layers,
  Activity,
  DollarSign,
  Clock,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';

let tempIdCounter = 0;
function nextTempId() {
  return `temp_${++tempIdCounter}`;
}

function emptyScope() {
  return { tempId: nextTempId(), name: '', description: '', estimatedValue: '', activities: [emptyActivity()] };
}

function emptyActivity() {
  return { tempId: nextTempId(), name: '', estimatedHours: '' };
}

export default function TemplateManagement() {
  const api = useApi();

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', template }
  const [form, setForm] = useState({ name: '', description: '', squareFootage: '', bedrooms: '', bathrooms: '', stories: '', garageType: '', scopes: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Expanded scopes in modal
  const [expandedScopes, setExpandedScopes] = useState({});

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name }

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/api/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;
    const q = searchQuery.toLowerCase().trim();
    return templates.filter(
      (t) =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
    );
  }, [templates, searchQuery]);

  function openCreateModal() {
    setForm({ name: '', description: '', squareFootage: '', bedrooms: '', bathrooms: '', stories: '', garageType: '', scopes: [emptyScope()] });
    setSaveError('');
    setExpandedScopes({ 0: true });
    setModal({ mode: 'create' });
  }

  async function openEditModal(template) {
    setSaveError('');
    try {
      const full = await api.get(`/api/templates/${template.id}`);
      const scopes = (full.scopes || []).map((s) => ({
        tempId: nextTempId(),
        name: s.name || '',
        description: s.description || '',
        estimatedValue: s.estimatedValue || '',
        activities: (s.activities || []).map((a) => ({
          tempId: nextTempId(),
          name: a.name || '',
          estimatedHours: a.estimatedHours || '',
        })),
      }));
      setForm({ name: full.name || '', description: full.description || '', squareFootage: full.squareFootage ?? '', bedrooms: full.bedrooms ?? '', bathrooms: full.bathrooms ?? '', stories: full.stories ?? '', garageType: full.garageType || '', scopes });
      const expanded = {};
      scopes.forEach((_, i) => { expanded[i] = true; });
      setExpandedScopes(expanded);
      setModal({ mode: 'edit', template: full });
    } catch (err) {
      setError(err.message || 'Failed to load template');
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setSaveError('Template name is required');
      return;
    }
    const hasScope = form.scopes.some((s) => s.name.trim());
    if (!hasScope) {
      setSaveError('At least one scope with a name is required');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        squareFootage: form.squareFootage ? parseFloat(form.squareFootage) : null,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : null,
        bathrooms: form.bathrooms ? parseFloat(form.bathrooms) : null,
        stories: form.stories ? parseInt(form.stories) : null,
        garageType: form.garageType || null,
        scopes: form.scopes
          .filter((s) => s.name.trim())
          .map((s, sIdx) => ({
            name: s.name.trim(),
            description: s.description.trim() || null,
            estimatedValue: parseFloat(s.estimatedValue) || 0,
            sortOrder: sIdx,
            activities: (s.activities || [])
              .filter((a) => a.name.trim())
              .map((a, aIdx) => ({
                name: a.name.trim(),
                estimatedHours: parseFloat(a.estimatedHours) || 0,
                sortOrder: aIdx,
              })),
          })),
      };

      if (modal.mode === 'create') {
        await api.post('/api/templates', payload);
      } else {
        await api.put(`/api/templates/${modal.template.id}`, payload);
      }
      setModal(null);
      fetchTemplates();
    } catch (err) {
      setSaveError(err.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await api.del(`/api/templates/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchTemplates();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  }

  // Scope helpers
  function addScope() {
    const newScopes = [...form.scopes, emptyScope()];
    setForm({ ...form, scopes: newScopes });
    setExpandedScopes({ ...expandedScopes, [newScopes.length - 1]: true });
  }

  function removeScope(idx) {
    const newScopes = form.scopes.filter((_, i) => i !== idx);
    setForm({ ...form, scopes: newScopes });
  }

  function updateScope(idx, field, value) {
    const newScopes = [...form.scopes];
    newScopes[idx] = { ...newScopes[idx], [field]: value };
    setForm({ ...form, scopes: newScopes });
  }

  function toggleScopeExpand(idx) {
    setExpandedScopes({ ...expandedScopes, [idx]: !expandedScopes[idx] });
  }

  // Activity helpers
  function addActivity(scopeIdx) {
    const newScopes = [...form.scopes];
    newScopes[scopeIdx] = {
      ...newScopes[scopeIdx],
      activities: [...newScopes[scopeIdx].activities, emptyActivity()],
    };
    setForm({ ...form, scopes: newScopes });
  }

  function removeActivity(scopeIdx, actIdx) {
    const newScopes = [...form.scopes];
    newScopes[scopeIdx] = {
      ...newScopes[scopeIdx],
      activities: newScopes[scopeIdx].activities.filter((_, i) => i !== actIdx),
    };
    setForm({ ...form, scopes: newScopes });
  }

  function updateActivity(scopeIdx, actIdx, field, value) {
    const newScopes = [...form.scopes];
    const newActivities = [...newScopes[scopeIdx].activities];
    newActivities[actIdx] = { ...newActivities[actIdx], [field]: value };
    newScopes[scopeIdx] = { ...newScopes[scopeIdx], activities: newActivities };
    setForm({ ...form, scopes: newScopes });
  }

  function formatCurrency(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '$0';
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  return (
    <div className="page-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Templates</h1>
        <button className="btn btn-primary" onClick={openCreateModal}>
          <Plus size={16} />
          New Template
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">Search</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Templates Table */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading templates...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <FileText size={40} style={{ color: 'var(--text-light)', marginBottom: 12 }} />
          <p className="text-light">
            {templates.length === 0 ? 'No templates yet. Create your first template to get started.' : 'No templates match your search.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Scopes</th>
                  <th>Total Est. Value</th>
                  <th>Last Updated</th>
                  <th style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td className="text-light">{t.description || '--'}</td>
                    <td>
                      <span className="badge badge-primary">{t.scopeCount} scope{t.scopeCount !== 1 ? 's' : ''}</span>
                    </td>
                    <td>{formatCurrency(t.totalEstimatedValue)}</td>
                    <td className="text-light">
                      {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.8125rem' }}
                          onClick={async () => {
                            try {
                              await api.post(`/api/templates/${t.id}/duplicate`);
                              fetchTemplates();
                            } catch (err) {
                              setError(err.message || 'Failed to duplicate template');
                            }
                          }}
                          title="Duplicate"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.8125rem' }}
                          onClick={() => openEditModal(t)}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: '0.8125rem' }}
                          onClick={() => setDeleteConfirm({ id: t.id, name: t.name })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, paddingBottom: 12 }}>
            <p className="text-light" style={{ fontSize: '0.8125rem', margin: 0 }}>
              Showing {filteredTemplates.length} of {templates.length} templates
            </p>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
                {modal.mode === 'create' ? 'New Template' : 'Edit Template'}
              </h2>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {saveError && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <span>{saveError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Template Name *</label>
              <input
                type="text"
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Standard Residential Build"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this template..."
              />
            </div>

            {/* Base Property Specs */}
            <div className="form-section-label">Base Property Specs (reference baseline for scaling)</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Square Footage</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={form.squareFootage}
                  onChange={(e) => setForm({ ...form, squareFootage: e.target.value })}
                  placeholder="e.g. 2000"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bedrooms</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  step="1"
                  value={form.bedrooms}
                  onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
                  placeholder="e.g. 3"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bathrooms</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  step="0.5"
                  value={form.bathrooms}
                  onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
                  placeholder="e.g. 2"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Stories</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  step="1"
                  value={form.stories}
                  onChange={(e) => setForm({ ...form, stories: e.target.value })}
                  placeholder="e.g. 2"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Garage</label>
                <select
                  className="form-input"
                  value={form.garageType}
                  onChange={(e) => setForm({ ...form, garageType: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  <option value="none">None</option>
                  <option value="1-car">1-Car</option>
                  <option value="2-car">2-Car</option>
                  <option value="3-car">3-Car</option>
                </select>
              </div>
              <div className="form-group" />
            </div>

            {/* Scopes Section */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>
                  <Layers size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                  Scopes
                </h3>
                <button className="btn btn-outline btn-sm" onClick={addScope}>
                  <Plus size={14} /> Add Scope
                </button>
              </div>

              {form.scopes.map((scope, sIdx) => (
                <div key={scope.tempId} className="template-scope-block">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: expandedScopes[sIdx] ? 12 : 0 }}>
                    <button
                      onClick={() => toggleScopeExpand(sIdx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
                    >
                      {expandedScopes[sIdx] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', flex: 1 }}>
                      {scope.name || `Scope ${sIdx + 1}`}
                    </span>
                    {scope.estimatedValue && (
                      <span className="text-light" style={{ fontSize: '0.8125rem' }}>
                        {formatCurrency(scope.estimatedValue)}
                      </span>
                    )}
                    <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                      {scope.activities.filter((a) => a.name.trim()).length} activities
                    </span>
                    <button
                      onClick={() => removeScope(sIdx)}
                      className="btn btn-danger btn-sm"
                      style={{ padding: '2px 6px' }}
                      title="Remove scope"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {expandedScopes[sIdx] && (
                    <div>
                      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                        <div className="form-group" style={{ marginBottom: 0, flex: 2 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Scope Name *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={scope.name}
                            onChange={(e) => updateScope(sIdx, 'name', e.target.value)}
                            placeholder="e.g., Foundation"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Est. Value ($)</label>
                          <input
                            type="number"
                            className="form-input"
                            value={scope.estimatedValue}
                            onChange={(e) => updateScope(sIdx, 'estimatedValue', e.target.value)}
                            placeholder="0"
                            min="0"
                            step="100"
                          />
                        </div>
                      </div>

                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Description</label>
                        <input
                          type="text"
                          className="form-input"
                          value={scope.description}
                          onChange={(e) => updateScope(sIdx, 'description', e.target.value)}
                          placeholder="Optional description"
                        />
                      </div>

                      {/* Activities */}
                      <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--primary-light)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-light)' }}>
                            <Activity size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />
                            Activities
                          </span>
                          <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => addActivity(sIdx)}>
                            <Plus size={12} /> Add
                          </button>
                        </div>

                        {scope.activities.length > 0 && (
                          <div className="template-activity-row" style={{ marginBottom: 4, paddingBottom: 0, borderBottom: 'none' }}>
                            <span style={{ flex: 2, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</span>
                            <span style={{ width: 100, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Hours</span>
                            <span style={{ width: 22, flexShrink: 0 }} />
                          </div>
                        )}
                        {scope.activities.map((act, aIdx) => (
                          <div key={act.tempId} className="template-activity-row">
                            <input
                              type="text"
                              className="form-input"
                              style={{ flex: 2 }}
                              value={act.name}
                              onChange={(e) => updateActivity(sIdx, aIdx, 'name', e.target.value)}
                              placeholder="Activity name"
                            />
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 100 }}
                              value={act.estimatedHours}
                              onChange={(e) => updateActivity(sIdx, aIdx, 'estimatedHours', e.target.value)}
                              placeholder="Hours"
                              min="0"
                              step="0.5"
                            />
                            <button
                              onClick={() => removeActivity(sIdx, aIdx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--danger)', flexShrink: 0 }}
                              title="Remove activity"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}

                        {scope.activities.length === 0 && (
                          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '8px 0' }}>No activities yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {form.scopes.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <p className="text-light" style={{ margin: 0 }}>No scopes added. Click "Add Scope" to begin.</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setModal(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : modal.mode === 'create' ? 'Create Template' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Delete Template</h2>
              <button onClick={() => setDeleteConfirm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>
            <p>Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
