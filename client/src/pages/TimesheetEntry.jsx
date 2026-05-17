/**
 * @file Timesheet entry page for logging daily labor hours per activity.
 * Workers select a date and job, then add rows for each activity with hours and notes.
 * Jobs are filtered to those the user is assigned to or scheduled for (via /api/jobs/my-active).
 * Activities are filtered by schedule dates, worker assignments, and completion status.
 * Foreman+ roles see a "Show All Activities" toggle and can mark activities as force-available.
 * Each activity row shows estimated vs. actual hours with a color-coded progress bar.
 * Existing entries for the selected date are shown below with edit/delete for pending
 * and rejected entries. Rejected entries display the rejection note and can be
 * resubmitted (resets status to pending, clears rejection fields).
 * Remembers the last job selection in localStorage to support "continue where I left off".
 *
 * Submit: POST /api/timesheets with { workerId, activityId, date, hours, notes }.
 * Fetch existing: GET /api/timesheets/worker/:workerId filtered client-side by date.
 *
 * @module client/pages/TimesheetEntry
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Calendar,
  ChevronDown,
  Plus,
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle,
  X,
  Loader,
  Send,
  Edit2,
  Save,
  Eye,
  EyeOff,
  Unlock,
  Lock,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = 'timesheet_lastSelection';

/**
 * Returns the Monday (ISO week start) for a given date.
 */
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date;
}

/**
 * Compute percent complete for an activity from its tasks (or direct field).
 */
function getActivityPercent(a) {
  const tasks = a.tasks || [];
  if (tasks.length > 0) {
    return tasks.reduce((s, t) => s + (t.currentPercentComplete || 0), 0) / tasks.length;
  }
  return a.percentComplete || 0;
}

/**
 * TimesheetEntry - Page for logging hours against activities.
 * Features: filtered jobs, filtered activities with foreman overrides, date picker,
 * dynamic activity rows with hours/notes, running total, submit button.
 * Shows existing entries for the date with inline edit/delete for pending entries.
 * @component
 */
export default function TimesheetEntry() {
  const api = useApi();
  const { user } = useAuth();
  const isManager = ['foreman', 'project_manager', 'admin'].includes(user?.role);

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Jobs and activities
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [activities, setActivities] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Filtering
  const [showAllActivities, setShowAllActivities] = useState(false);

  // Timesheet rows for new entry
  const [rows, setRows] = useState([]);

  // Existing entries for selected date
  const [existingEntries, setExistingEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editForm, setEditForm] = useState({ hours: '', notes: '' });

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Status
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Restore last selection from localStorage
  const restoredRef = useRef(false);

  // Load filtered jobs (my-active)
  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      setLoadingJobs(true);
      setError('');
      try {
        const res = await api.get('/api/jobs/my-active');
        if (!cancelled) {
          const jobList = Array.isArray(res) ? res : res?.jobs || [];
          setJobs(jobList);

          // Restore last selection or auto-select if only one job
          if (!restoredRef.current) {
            restoredRef.current = true;
            try {
              const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
              if (saved.jobId && jobList.some(j => (j._id || j.id) === saved.jobId)) {
                setSelectedJobId(saved.jobId);
              } else if (jobList.length === 1) {
                setSelectedJobId(jobList[0]._id || jobList[0].id);
              }
            } catch {
              if (jobList.length === 1) {
                setSelectedJobId(jobList[0]._id || jobList[0].id);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load jobs');
      } finally {
        if (!cancelled) setLoadingJobs(false);
      }
    }
    fetchJobs();
    return () => { cancelled = true; };
  }, [api]);

  // Save job selection to localStorage
  useEffect(() => {
    if (selectedJobId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: selectedJobId }));
    }
  }, [selectedJobId]);

  // Load activities when job selected — use /api/activities/available for filtering
  useEffect(() => {
    if (!selectedJobId) {
      setActivities([]);
      setRows([]);
      return;
    }
    let cancelled = false;
    async function fetchActivities() {
      setLoadingActivities(true);
      setRows([]);
      try {
        const params = new URLSearchParams({ jobId: selectedJobId, weekOf: selectedDate });
        if (showAllActivities && isManager) params.set('all', 'true');
        const data = await api.get(`/api/activities/available?${params}`);
        if (!cancelled) {
          setActivities(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load activities');
      } finally {
        if (!cancelled) setLoadingActivities(false);
      }
    }
    fetchActivities();
    return () => { cancelled = true; };
  }, [api, selectedJobId, selectedDate, showAllActivities, isManager]);

  // Load existing timesheet entries for selected date
  const fetchEntries = useCallback(async () => {
    const workerId = user?.id || user?._id;
    if (!workerId) return;
    setLoadingEntries(true);
    try {
      const res = await api.get(`/api/timesheets/worker/${workerId}`);
      const all = Array.isArray(res) ? res : res?.entries || res?.timesheets || [];
      const filtered = all.filter((e) => e.date === selectedDate);
      setExistingEntries(filtered);
    } catch {
      setExistingEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }, [api, selectedDate, user]);

  useEffect(() => {
    if (user) fetchEntries();
  }, [fetchEntries, user]);

  // Row management
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        activityId: '',
        activityName: '',
        scopeName: '',
        hours: '',
        notes: '',
      },
    ]);
  }

  function updateRow(rowId, field, value) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        if (field === 'activityId') {
          const act = activities.find((a) => a.id === value);
          return {
            ...r,
            activityId: value,
            activityName: act?.name || '',
            scopeName: act?.scopeName || '',
          };
        }
        return { ...r, [field]: value };
      })
    );
  }

  function removeRow(rowId) {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  }

  /** Toggle forceAvailable on an activity (foreman+ only) */
  async function toggleForceAvailable(activityId, currentValue) {
    try {
      await api.put(`/api/activities/${activityId}/force-available`, { forceAvailable: !currentValue });
      // Refresh activities
      const params = new URLSearchParams({ jobId: selectedJobId, weekOf: selectedDate });
      if (showAllActivities && isManager) params.set('all', 'true');
      const data = await api.get(`/api/activities/available?${params}`);
      setActivities(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to toggle availability');
    }
  }

  const totalHours = rows.reduce((sum, r) => {
    const h = parseFloat(r.hours);
    return sum + (isNaN(h) ? 0 : h);
  }, 0);

  async function handleSubmit() {
    const validRows = rows.filter((r) => r.activityId && r.hours && parseFloat(r.hours) > 0);
    if (validRows.length === 0) {
      setError('Add at least one activity with hours before submitting.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      for (const row of validRows) {
        await api.post('/api/timesheets', {
          workerId: user?.id || user?._id,
          jobId: selectedJobId,
          activityId: row.activityId,
          date: selectedDate,
          hours: parseFloat(row.hours),
          notes: row.notes,
        });
      }
      setSuccess(`Submitted ${validRows.length} timesheet entr${validRows.length > 1 ? 'ies' : 'y'}.`);
      setRows([]);
      fetchEntries();
    } catch (err) {
      setError(err.message || 'Failed to submit timesheet');
    } finally {
      setSubmitting(false);
    }
  }

  // Edit/delete existing entries
  function startEdit(entry) {
    setEditingEntryId(entry._id || entry.id);
    setEditForm({
      hours: entry.hours?.toString() || '',
      notes: entry.notes || '',
    });
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setEditForm({ hours: '', notes: '' });
  }

  async function saveEdit(entryId, wasRejected = false) {
    const h = parseFloat(editForm.hours);
    if (isNaN(h) || h <= 0) {
      setError('Hours must be a positive number.');
      return;
    }
    try {
      const payload = { hours: h, notes: editForm.notes };
      if (wasRejected) payload.status = 'pending';
      await api.put(`/api/timesheets/${entryId}`, payload);
      setEditingEntryId(null);
      setEditForm({ hours: '', notes: '' });
      fetchEntries();
      if (wasRejected) setSuccess('Timesheet resubmitted for approval.');
    } catch (err) {
      setError(err.message || 'Failed to update entry');
    }
  }

  async function confirmDeleteEntry() {
    if (!deleteConfirm) return;
    try {
      await api.del(`/api/timesheets/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchEntries();
    } catch (err) {
      setError(err.message || 'Failed to delete entry');
      setDeleteConfirm(null);
    }
  }

  function getStatusBadge(status) {
    switch (status?.toLowerCase()) {
      case 'approved':
        return 'badge-success';
      case 'rejected':
        return 'badge-danger';
      case 'pending':
      default:
        return 'badge-warning';
    }
  }

  // --- Render ---

  if (loadingJobs) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Timesheet Entry</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-fade-in">
      <h1 className="page-title">Timesheet Entry</h1>

      {/* Alerts */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={20} />
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
      )}
      {success && (
        <div className="alert alert-success" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={20} />
          <span>{success}</span>
          <button onClick={() => setSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Date and Job selection */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="grid-2" style={{ gap: 16 }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={18} />
                Date
              </label>
              <input
                type="date"
                className="form-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ fontSize: '1.1rem', padding: '14px 16px' }}
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                Job
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  className="form-input"
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  style={{ fontSize: '1.1rem', padding: '14px 16px', appearance: 'none' }}
                >
                  <option value="">-- Select Job --</option>
                  {jobs.map((j) => (
                    <option key={j._id || j.id} value={j._id || j.id}>
                      {j.name || j.jobName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={20}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-light)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Loading activities */}
      {loadingActivities && (
        <div className="card" style={{ textAlign: 'center', padding: 32, marginBottom: 16 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 8 }}>Loading activities...</p>
        </div>
      )}

      {/* Time entry table */}
      {selectedJobId && !loadingActivities && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={20} />
              Log Hours
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Foreman+ toggle to show all activities */}
              {isManager && (
                <button
                  className={`btn ${showAllActivities ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setShowAllActivities(!showAllActivities)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: '0.875rem' }}
                  title={showAllActivities ? 'Show filtered activities' : 'Show all activities'}
                >
                  {showAllActivities ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showAllActivities ? 'Show Filtered' : 'Show All'}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={addRow}
                disabled={activities.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: '1rem' }}
              >
                <Plus size={18} />
                Add Activity
              </button>
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="card-body">
              <p className="text-light">No activities available for this job{!showAllActivities && isManager ? '. Try "Show All" to see all activities.' : '.'}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
              <p className="text-light">Click &quot;Add Activity&quot; to start logging hours.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {rows.map((row, idx) => (
                  <div
                    key={row.id}
                    style={{
                      padding: '16px 20px',
                      borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {/* Activity selector */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Activity</label>
                      <div style={{ position: 'relative' }}>
                        <select
                          className="form-input"
                          value={row.activityId}
                          onChange={(e) => updateRow(row.id, 'activityId', e.target.value)}
                          style={{ fontSize: '1rem', padding: '12px 16px', appearance: 'none' }}
                        >
                          <option value="">-- Select Activity --</option>
                          {activities.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.scopeName} &rsaquo; {a.name}
                              {a.forceAvailable ? ' [forced]' : ''}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={18}
                          style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-light)' }}
                        />
                      </div>
                      {/* Activity hours tracking */}
                      {row.activityId && (() => {
                        const act = activities.find(a => a.id === row.activityId);
                        if (!act || !act.estimatedHours) return null;
                        const estimated = act.estimatedHours || 0;
                        const actual = act.actualHours || 0;
                        const pct = estimated > 0 ? Math.min(100, Math.round((actual / estimated) * 100)) : 0;
                        const isOver = actual > estimated;
                        return (
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                            <span>
                              <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                              {actual.toFixed(1)}h logged of {estimated.toFixed(1)}h estimated
                            </span>
                            <div style={{ flex: '0 0 80px', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 3, background: isOver ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)' }} />
                            </div>
                            <span style={{ fontWeight: 600, color: isOver ? 'var(--danger)' : 'var(--text-light)' }}>
                              {pct}%
                            </span>
                          </div>
                        );
                      })()}
                      {/* Foreman force-available toggle per activity */}
                      {isManager && row.activityId && showAllActivities && (() => {
                        const act = activities.find(a => a.id === row.activityId);
                        if (!act) return null;
                        return (
                          <div style={{ marginTop: 4 }}>
                            <button
                              className="btn btn-link"
                              onClick={() => toggleForceAvailable(act.id, act.forceAvailable)}
                              style={{ padding: '2px 0', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              {act.forceAvailable ? <Unlock size={12} /> : <Lock size={12} />}
                              {act.forceAvailable ? 'Remove force-available' : 'Make force-available'}
                            </button>
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                      {/* Hours input */}
                      <div className="form-group" style={{ marginBottom: 0, flex: '0 0 100px' }}>
                        <label className="form-label">Hours</label>
                        <input
                          type="number"
                          className="form-input"
                          value={row.hours}
                          onChange={(e) => updateRow(row.id, 'hours', e.target.value)}
                          placeholder="0"
                          min="0"
                          max="24"
                          step="0.25"
                          style={{ fontSize: '1.1rem', padding: '12px', textAlign: 'center', fontWeight: 600 }}
                        />
                      </div>

                      {/* Notes */}
                      <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                        <label className="form-label">Notes</label>
                        <input
                          type="text"
                          className="form-input"
                          value={row.notes}
                          onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                          placeholder="Optional notes"
                          style={{ fontSize: '1rem', padding: '12px' }}
                        />
                      </div>

                      {/* Remove button */}
                      <button
                        className="btn btn-secondary"
                        onClick={() => removeRow(row.id)}
                        style={{ padding: '12px', flexShrink: 0 }}
                        title="Remove row"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total and Submit */}
              <div
                style={{
                  padding: '16px 20px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: '1.1rem' }}>
                  <span className="text-light">Total Hours: </span>
                  <span style={{ fontWeight: 700, fontSize: '1.25rem', color: totalHours > 0 ? 'var(--primary)' : undefined }}>
                    {totalHours.toFixed(2)}
                  </span>
                </div>
                <button
                  className="btn btn-success"
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{ padding: '14px 28px', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {submitting ? (
                    <>
                      <Loader size={20} className="spinning" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      Submit Timesheet
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Existing entries for the selected date */}
      <div className="card">
        <div className="card-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={20} />
            Entries for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </h2>
        </div>

        {loadingEntries ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 24 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : existingEntries.length === 0 ? (
          <div className="card-body">
            <p className="text-light">No timesheet entries for this date.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Activity</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {existingEntries.map((entry) => {
                  const entryId = entry._id || entry.id;
                  const isPending = !entry.status || entry.status.toLowerCase() === 'pending';
                  const isRejected = entry.status?.toLowerCase() === 'rejected';
                  const canEdit = isPending || isRejected;
                  const isEditing = editingEntryId === entryId;

                  return (
                    <tr key={entryId}>
                      <td style={{ fontWeight: 600 }}>
                        {entry.jobName || entry.job?.name || '--'}
                      </td>
                      <td>{entry.activityName || entry.activity?.name || '--'}</td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            className="form-input"
                            value={editForm.hours}
                            onChange={(e) => setEditForm((f) => ({ ...f, hours: e.target.value }))}
                            min="0"
                            max="24"
                            step="0.25"
                            style={{ width: 80, padding: '6px 8px', textAlign: 'center', fontWeight: 600 }}
                          />
                        ) : (
                          <span style={{ fontWeight: 600 }}>{entry.hours}</span>
                        )}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            className="form-input"
                            value={editForm.notes}
                            onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                            style={{ padding: '6px 8px', minWidth: 120 }}
                          />
                        ) : (
                          entry.notes || '--'
                        )}
                      </td>
                      <td>
                        <span className={`badge ${getStatusBadge(entry.status)}`}>
                          {entry.status || 'pending'}
                        </span>
                        {isRejected && entry.rejectionNote && (
                          <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--danger)', maxWidth: 200 }}>
                            {entry.rejectionNote}
                          </div>
                        )}
                      </td>
                      <td>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="btn btn-success btn-sm"
                                  onClick={() => saveEdit(entryId, isRejected)}
                                  title="Save"
                                  style={{ padding: '6px 8px' }}
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={cancelEdit}
                                  title="Cancel"
                                  style={{ padding: '6px 8px' }}
                                >
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => startEdit(entry)}
                                  title={isRejected ? 'Edit & Resubmit' : 'Edit'}
                                  style={{ padding: '6px 8px' }}
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => setDeleteConfirm({ id: entryId, activityName: entry.activityName || entry.activity?.name || 'Unknown', hours: entry.hours })}
                                  title="Delete"
                                  style={{ padding: '6px 8px' }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Total for existing entries */}
        {existingEntries.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
            <span className="text-light">Total Logged: </span>
            <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {existingEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0).toFixed(2)} hours
            </span>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Delete Timesheet Entry</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete the <strong>{deleteConfirm.hours}h</strong> entry
                for <strong>{deleteConfirm.activityName}</strong>?
              </p>
              <p className="text-danger" style={{ marginTop: 8, fontSize: '0.875rem' }}>
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDeleteEntry}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
