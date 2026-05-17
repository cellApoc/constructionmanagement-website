/**
 * @file Jobs list page with search, status filter, desktop table view,
 * mobile card view, and a "New Job" creation modal. Shows job type + sqft
 * badges on both table rows and mobile cards.
 * Fetches from /api/jobs with optional status query parameter.
 * Uses shared utilities from utils/formatting.js for labels, badges, and progress.
 * @module client/pages/JobsList
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  HardHat,
  MapPin,
  User,
  DollarSign,
  X,
  AlertTriangle,
  Clock,
  TrendingDown,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { JOB_TYPE_LABELS, getStatusBadge, formatStatus, formatCurrency, getProgressClass } from '../utils/formatting';

/**
 * JobsList - Displays all jobs with filtering and search capabilities.
 * Desktop view: sortable table. Mobile view: stacked cards.
 * Includes "New Job" modal for creating jobs with all required metadata.
 * @component
 * @returns {JSX.Element} Jobs list page with filter bar and job entries
 */
export default function JobsList() {
  const api = useApi();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  const [foremen, setForemen] = useState([]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const url = `/api/jobs${params.toString() ? `?${params}` : ''}`;
      const data = await api.get(url);
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    async function loadForemen() {
      try {
        const users = await api.get('/api/users');
        setForemen(
          (Array.isArray(users) ? users : []).filter(
            (u) => u.role === 'foreman' || u.role === 'project_manager'
          )
        );
      } catch {
        // non-critical - foremen dropdown will be empty
      }
    }
    loadForemen();
  }, [api]);

  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (job.name || '').toLowerCase().includes(q) ||
      (job.address || '').toLowerCase().includes(q) ||
      (job.customerName || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Jobs</h1>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          <Plus size={18} />
          New Job
        </button>
      </div>

      {/* Filter bar */}
      <div className="search-bar">
        <div className="search-input-wrapper">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search jobs by name, address, or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ padding: 20, marginBottom: 16, borderLeft: '4px solid var(--danger)' }}>
          <p className="text-danger">{error}</p>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={fetchJobs}>
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading jobs...</p>
        </div>
      )}

      {/* Desktop table */}
      {!loading && filteredJobs.length > 0 && (
        <div className="card desktop-only">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Job Name</th>
                  <th>Address</th>
                  <th>Customer</th>
                  <th>Foreman</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>% Complete</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const pct = job.overallPercentComplete ?? 0;
                  const progressClass = getProgressClass(pct);
                  const alerts = job.alerts || {};

                  return (
                    <tr
                      key={job.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <td>
                        <Link
                          to={`/jobs/${job.id}`}
                          style={{ fontWeight: 600 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {job.name}
                        </Link>
                        {(job.jobType || job.squareFootage > 0) && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {job.jobType && (
                              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                                {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                              </span>
                            )}
                            {job.squareFootage > 0 && (
                              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                                {Number(job.squareFootage).toLocaleString()} sqft
                              </span>
                            )}
                          </div>
                        )}
                        {alerts.total > 0 && (
                          <div className="job-alert-summary">
                            {alerts.overdue > 0 && <span className="job-alert-tag job-alert-danger"><Clock size={10} /> {alerts.overdue} overdue</span>}
                            {alerts.behind > 0 && <span className="job-alert-tag job-alert-warning"><TrendingDown size={10} /> {alerts.behind} behind</span>}
                            {alerts.costOverruns > 0 && <span className="job-alert-tag job-alert-danger"><DollarSign size={10} /> {alerts.costOverruns} over budget</span>}
                          </div>
                        )}
                      </td>
                      <td className="text-light">{job.address || '--'}</td>
                      <td>{job.customerName || '--'}</td>
                      <td>{getForemanName(job.foremanId, foremen)}</td>
                      <td>
                        <span className={`badge ${getStatusBadge(job.status)}`}>
                          {formatStatus(job.status)}
                        </span>
                      </td>
                      <td>
                        <JobHealthBadge alerts={alerts} />
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="progress-bar" style={{ flex: 1 }}>
                            <div
                              className={`progress-bar-fill ${progressClass}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 500, minWidth: 36, textAlign: 'right' }}>
                            {Math.round(pct)}%
                          </span>
                        </div>
                      </td>
                      <td>{formatCurrency(job.budget)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile cards */}
      {!loading && filteredJobs.length > 0 && (
        <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredJobs.map((job) => {
            const pct = job.overallPercentComplete ?? 0;
            const progressClass = getProgressClass(pct);

            return (
              <Link key={job.id} to={`/jobs/${job.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{job.name}</h3>
                    {job.address && (
                      <p className="text-light" style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={12} /> {job.address}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <JobHealthBadge alerts={job.alerts || {}} />
                    <span className={`badge ${getStatusBadge(job.status)}`}>
                      {formatStatus(job.status)}
                    </span>
                  </div>
                </div>
                {(job.jobType || job.squareFootage > 0) && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {job.jobType && (
                      <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                        {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                      </span>
                    )}
                    {job.squareFootage > 0 && (
                      <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                        {Number(job.squareFootage).toLocaleString()} sqft
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 16, fontSize: '0.8125rem', color: 'var(--text-light)', marginBottom: 10 }}>
                  {job.customerName && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <User size={12} /> {job.customerName}
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <DollarSign size={12} /> {formatCurrency(job.budget)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="progress-bar" style={{ flex: 1 }}>
                    <div
                      className={`progress-bar-fill ${progressClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                    {Math.round(pct)}%
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredJobs.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <HardHat size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p className="text-light">
            {searchQuery || statusFilter
              ? 'No jobs match your filters.'
              : 'No jobs yet. Create your first job to get started.'}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => setShowNewModal(true)}
            >
              <Plus size={18} /> Create First Job
            </button>
          )}
        </div>
      )}

      {/* New Job Modal */}
      {showNewModal && (
        <NewJobModal
          foremen={foremen}
          onClose={() => setShowNewModal(false)}
          onCreated={(newJob) => {
            setShowNewModal(false);
            navigate(`/jobs/${newJob.id}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * NewJobModal - Modal form for creating a new job.
 * Fields: name (required), address, customer name/contact, start date,
 * foreman selector, budget, CRM Opportunity ID, and notes.
 * @component
 * @param {Object} props
 * @param {Object[]} props.foremen - List of users eligible as foreman
 * @param {Function} props.onClose - Called when modal is dismissed
 * @param {Function} props.onCreated - Called with created job object on success
 * @returns {JSX.Element} Modal overlay with job creation form
 */
function NewJobModal({ foremen, onClose, onCreated }) {
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    address: '',
    customerName: '',
    customerContact: '',
    startDate: '',
    foremanId: '',
    budget: '',
    jobType: '',
    squareFootage: '',
    bedrooms: '',
    bathrooms: '',
    stories: '',
    garageType: '',
    notes: '',
    crmOpportunityId: '',
  });

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Job name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        budget: form.budget ? parseFloat(form.budget) : 0,
        foremanId: form.foremanId || undefined,
        jobType: form.jobType || undefined,
        squareFootage: form.squareFootage ? parseFloat(form.squareFootage) : undefined,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? parseFloat(form.bathrooms) : undefined,
        stories: form.stories ? parseInt(form.stories) : undefined,
        garageType: form.garageType || undefined,
        crmOpportunityId: form.crmOpportunityId || undefined,
      };
      const created = await api.post('/api/jobs', payload);
      onCreated(created);
    } catch (err) {
      setError(err.message || 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Job</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <p className="text-danger" style={{ marginBottom: 12 }}>{error}</p>
            )}
            <div className="form-row">
              <div className="form-group">
                <label>Job Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g. Johnson Residence Remodel"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => updateField('address', e.target.value)}
                  placeholder="123 Main St, City, State"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Customer Name</label>
                <input
                  type="text"
                  value={form.customerName}
                  onChange={(e) => updateField('customerName', e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className="form-group">
                <label>Customer Contact</label>
                <input
                  type="text"
                  value={form.customerContact}
                  onChange={(e) => updateField('customerContact', e.target.value)}
                  placeholder="Phone or email"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Date</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateField('startDate', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Foreman</label>
                <select
                  value={form.foremanId}
                  onChange={(e) => updateField('foremanId', e.target.value)}
                >
                  <option value="">-- Select Foreman --</option>
                  {foremen.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Budget ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.budget}
                  onChange={(e) => updateField('budget', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Job Type</label>
                <select
                  value={form.jobType}
                  onChange={(e) => updateField('jobType', e.target.value)}
                >
                  <option value="">-- Select Type --</option>
                  <option value="residential_new">Residential - New Build</option>
                  <option value="residential_remodel">Residential - Remodel</option>
                  <option value="residential_addition">Residential - Addition</option>
                  <option value="commercial_office">Commercial - Office Fit-Out</option>
                  <option value="commercial_retail">Commercial - Retail</option>
                  <option value="commercial_warehouse">Commercial - Warehouse</option>
                  <option value="industrial">Industrial</option>
                  <option value="infrastructure">Infrastructure</option>
                  <option value="renovation">Renovation</option>
                  <option value="demolition">Demolition</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="form-section-label">Property Specifications</div>
            <div className="form-row">
              <div className="form-group">
                <label>Square Footage</label>
                <input
                  type="number"
                  min="0"
                  value={form.squareFootage}
                  onChange={(e) => updateField('squareFootage', e.target.value)}
                  placeholder="e.g. 2400"
                />
              </div>
              <div className="form-group">
                <label>Bedrooms</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.bedrooms}
                  onChange={(e) => updateField('bedrooms', e.target.value)}
                  placeholder="e.g. 3"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Bathrooms</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.bathrooms}
                  onChange={(e) => updateField('bathrooms', e.target.value)}
                  placeholder="e.g. 2.5"
                />
              </div>
              <div className="form-group">
                <label>Stories</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.stories}
                  onChange={(e) => updateField('stories', e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Garage</label>
                <select
                  value={form.garageType}
                  onChange={(e) => updateField('garageType', e.target.value)}
                >
                  <option value="">-- Select --</option>
                  <option value="none">None</option>
                  <option value="1-car">1-Car</option>
                  <option value="2-car">2-Car</option>
                  <option value="3-car">3-Car</option>
                </select>
              </div>
              <div className="form-group">
                <label>CRM Opportunity ID</label>
                <input
                  type="text"
                  value={form.crmOpportunityId}
                  onChange={(e) => updateField('crmOpportunityId', e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="Any additional notes..."
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Looks up a foreman's display name by their ID.
 * @param {string|null} foremanId - Foreman UUID
 * @param {Object[]} foremen - Array of user objects
 * @returns {string} Foreman name or '--' if not found
 */
function getForemanName(foremanId, foremen) {
  if (!foremanId) return '--';
  const f = foremen.find((u) => u.id === foremanId);
  return f ? f.name : '--';
}

function JobHealthBadge({ alerts }) {
  if (!alerts || !alerts.health || alerts.total === 0) {
    return <span className="health-dot health-green" title="On Track" />;
  }
  const color = alerts.health === 'red' ? 'health-red' : 'health-amber';
  const title = [
    alerts.overdue > 0 && `${alerts.overdue} overdue`,
    alerts.behind > 0 && `${alerts.behind} behind schedule`,
    alerts.costOverruns > 0 && `${alerts.costOverruns} over budget`,
  ].filter(Boolean).join(', ');

  return (
    <span className={`health-dot ${color}`} title={title}>
      {alerts.total > 0 && <span className="health-count">{alerts.total}</span>}
    </span>
  );
}
