/**
 * @file Foreman/Admin approval queue for reviewing and approving/rejecting
 * daily task updates, activity-level updates, and timesheet entries.
 * Three tabs: Updates (task + activity level), Timesheets, and History.
 * Supports date range and worker filters, batch approve all, photo lightbox,
 * fade-out animation on approval/rejection, toast feedback on all approve/reject
 * actions, relative dates via formatRelativeDate, and a combined approval
 * history view (lazy-loaded). Activity-level updates show a discriminator badge.
 * Rejection opens a confirmation modal requiring a reason note. Rejections create
 * notifications for the original submitter.
 * @module client/pages/ApprovalQueue
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Image,
  X,
  Filter,
  CheckSquare,
  AlertTriangle,
  PartyPopper,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../App';
import { formatRelativeDate } from '../utils/formatting';

/**
 * ApprovalQueue - Foreman/Admin page for reviewing pending submissions.
 * Tab 1 (Task Updates): Shows pending daily task updates with worker info,
 * progress change, photos (clickable for lightbox), and approve/reject buttons.
 * Tab 2 (Timesheets): Shows pending timesheet entries with hours and notes.
 * Tab 3 (History): Combined list of recently approved/rejected items with
 * approver name and timestamp. Lazy-loaded when tab is activated.
 * Supports batch approval, date/worker filters, and animated fade-out on action.
 * @component
 * @returns {JSX.Element} Approval queue page with tabbed interface
 */
export default function ApprovalQueue() {
  const api = useApi();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('tasks');
  const [taskUpdates, setTaskUpdates] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingTimesheets, setLoadingTimesheets] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [workers, setWorkers] = useState([]);

  // Photo modal
  const [photoModal, setPhotoModal] = useState(null);

  // Fade-out tracking
  const [fadingIds, setFadingIds] = useState(new Set());

  // Processing state
  const [processingIds, setProcessingIds] = useState(new Set());

  // Rejection modal
  const [rejectModal, setRejectModal] = useState(null); // { item, type: 'task' | 'timesheet' }
  const [rejectionNote, setRejectionNote] = useState('');

  // History
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchTaskUpdates = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (workerFilter) params.set('workerId', workerFilter);
      const qs = params.toString();
      const taskUrl = '/api/daily-updates/pending' + (qs ? `?${qs}` : '');
      const actUrl = '/api/daily-updates/activity/pending' + (qs ? `?${qs}` : '');
      const [taskData, actData] = await Promise.all([
        api.get(taskUrl),
        api.get(actUrl).catch(() => []),
      ]);
      const tasks = (Array.isArray(taskData) ? taskData : taskData?.updates || []).map(u => ({ ...u, _updateType: 'task' }));
      const acts = (Array.isArray(actData) ? actData : []).map(u => ({ ...u, _updateType: 'activity' }));
      setTaskUpdates([...tasks, ...acts]);
    } catch (err) {
      setError(err.message || 'Failed to load updates');
    } finally {
      setLoadingTasks(false);
    }
  }, [api, dateFrom, dateTo, workerFilter]);

  const fetchTimesheets = useCallback(async () => {
    setLoadingTimesheets(true);
    try {
      let url = '/api/timesheets/pending';
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (workerFilter) params.set('workerId', workerFilter);
      const qs = params.toString();
      if (qs) url += `?${qs}`;
      const data = await api.get(url);
      setTimesheets(Array.isArray(data) ? data : data?.timesheets || []);
    } catch (err) {
      setError(err.message || 'Failed to load timesheets');
    } finally {
      setLoadingTimesheets(false);
    }
  }, [api, dateFrom, dateTo, workerFilter]);

  const fetchWorkers = useCallback(async () => {
    try {
      const data = await api.get('/api/users?role=worker');
      setWorkers(Array.isArray(data) ? data : data?.users || []);
    } catch {
      // Non-critical, filter just won't populate
    }
  }, [api]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const [taskHistory, actHistory, timesheetHistory] = await Promise.all([
        api.get('/api/daily-updates/history'),
        api.get('/api/daily-updates/activity/history').catch(() => []),
        api.get('/api/timesheets/history'),
      ]);
      const tasks = (Array.isArray(taskHistory) ? taskHistory : []).map((item) => ({
        ...item,
        _type: 'task',
      }));
      const acts = (Array.isArray(actHistory) ? actHistory : []).map((item) => ({
        ...item,
        _type: 'activity',
      }));
      const sheets = (Array.isArray(timesheetHistory) ? timesheetHistory : []).map((item) => ({
        ...item,
        _type: 'timesheet',
      }));
      const combined = [...tasks, ...acts, ...sheets].sort(
        (a, b) => new Date(b.approvedAt || b.rejectedAt || 0) - new Date(a.approvedAt || a.rejectedAt || 0)
      );
      setHistoryItems(combined);
    } catch (err) {
      setError(err.message || 'Failed to load approval history');
    } finally {
      setLoadingHistory(false);
    }
  }, [api]);

  useEffect(() => {
    fetchTaskUpdates();
    fetchTimesheets();
    fetchWorkers();
  }, [fetchTaskUpdates, fetchTimesheets, fetchWorkers]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  function fadeOutAndRemove(id, type) {
    setFadingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      if (type === 'task') {
        setTaskUpdates((prev) => prev.filter((item) => (item._id || item.id) !== id));
      } else {
        setTimesheets((prev) => prev.filter((item) => (item._id || item.id) !== id));
      }
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 400);
  }

  async function handleApproveTask(update) {
    const id = update._id || update.id;
    const isActivity = update._updateType === 'activity';
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const endpoint = isActivity
        ? `/api/daily-updates/activity/${id}/approve`
        : `/api/daily-updates/${id}/approve`;
      await api.put(endpoint);
      fadeOutAndRemove(id, 'task');
      showToast(`${isActivity ? 'Activity' : 'Task'} update approved`);
    } catch (err) {
      showToast(err.message || 'Failed to approve update', 'error');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function handleRejectTask(update) {
    setRejectModal({ item: update, type: update._updateType === 'activity' ? 'activity' : 'task' });
    setRejectionNote('');
  }

  async function handleApproveTimesheet(ts) {
    const id = ts._id || ts.id;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await api.put(`/api/timesheets/${id}/approve`);
      fadeOutAndRemove(id, 'timesheet');
      showToast('Timesheet approved');
    } catch (err) {
      showToast(err.message || 'Failed to approve timesheet', 'error');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function handleRejectTimesheet(ts) {
    setRejectModal({ item: ts, type: 'timesheet' });
    setRejectionNote('');
  }

  async function confirmRejection() {
    if (!rejectModal) return;
    const { item, type } = rejectModal;
    const id = item._id || item.id;
    let endpoint;
    if (type === 'activity') {
      endpoint = `/api/daily-updates/activity/${id}/reject`;
    } else if (type === 'task') {
      endpoint = `/api/daily-updates/${id}/reject`;
    } else {
      endpoint = `/api/timesheets/${id}/reject`;
    }
    const fadeType = type === 'timesheet' ? 'timesheet' : 'task';

    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await api.put(endpoint, { rejectionNote: rejectionNote.trim() || null });
      fadeOutAndRemove(id, fadeType);
      const label = type === 'activity' ? 'Activity update' : type === 'task' ? 'Task update' : 'Timesheet';
      showToast(`${label} rejected`);
      setRejectModal(null);
      setRejectionNote('');
    } catch (err) {
      showToast(err.message || 'Failed to reject', 'error');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleBatchApproveTasks() {
    const pending = taskUpdates.filter(
      (u) => !fadingIds.has(u._id || u.id) && !processingIds.has(u._id || u.id)
    );
    if (pending.length === 0) return;

    pending.forEach((u) =>
      setProcessingIds((prev) => new Set(prev).add(u._id || u.id))
    );

    try {
      await Promise.allSettled(
        pending.map((u) => {
          const id = u._id || u.id;
          const endpoint = u._updateType === 'activity'
            ? `/api/daily-updates/activity/${id}/approve`
            : `/api/daily-updates/${id}/approve`;
          return api.put(endpoint);
        })
      );
      pending.forEach((u) => fadeOutAndRemove(u._id || u.id, 'task'));
      showToast(`${pending.length} updates approved`);
    } catch (err) {
      showToast(err.message || 'Failed to batch approve', 'error');
    } finally {
      pending.forEach((u) =>
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(u._id || u.id);
          return next;
        })
      );
    }
  }

  const totalPendingHours = timesheets.reduce(
    (sum, ts) => sum + (parseFloat(ts.hours) || 0),
    0
  );

  const taskCount = taskUpdates.length;
  const timesheetCount = timesheets.length;
  const historyCount = historyItems.length;

  return (
    <div className="page-fade-in">
      <h1 className="page-title">Approval Queue</h1>

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
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">From Date</label>
            <input
              type="date"
              className="form-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">To Date</label>
            <input
              type="date"
              className="form-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">Worker</label>
            <select
              className="form-input"
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
            >
              <option value="">All Workers</option>
              {workers.map((w) => (
                <option key={w._id || w.id} value={w._id || w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setWorkerFilter('');
            }}
            style={{ marginBottom: 0 }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button
          className={`tab ${activeTab === 'tasks' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Updates
          {taskCount > 0 ? (
            <span className="badge badge-danger" style={{ marginLeft: 8, fontSize: '0.75rem', minWidth: 20, textAlign: 'center' }}>
              {taskCount}
            </span>
          ) : (
            <span className="badge badge-neutral" style={{ marginLeft: 8, fontSize: '0.75rem' }}>0</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === 'timesheets' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('timesheets')}
        >
          Timesheets
          {timesheetCount > 0 ? (
            <span className="badge badge-danger" style={{ marginLeft: 8, fontSize: '0.75rem', minWidth: 20, textAlign: 'center' }}>
              {timesheetCount}
            </span>
          ) : (
            <span className="badge badge-neutral" style={{ marginLeft: 8, fontSize: '0.75rem' }}>0</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History{historyCount > 0 ? ` (${historyCount})` : ''}
        </button>
      </div>

      {/* Task Updates Tab */}
      {activeTab === 'tasks' && (
        <div>
          {taskCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="btn btn-success" onClick={handleBatchApproveTasks}>
                <CheckSquare size={16} />
                Approve All ({taskCount})
              </button>
            </div>
          )}

          {loadingTasks ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <p className="text-light" style={{ marginTop: 12 }}>Loading pending updates...</p>
            </div>
          ) : taskCount === 0 ? (
            <EmptyState message="All caught up! No pending updates." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {taskUpdates.map((update) => {
                const id = update._id || update.id;
                const isFading = fadingIds.has(id);
                const isProcessing = processingIds.has(id);
                const isActivity = update._updateType === 'activity';
                return (
                  <div
                    key={`${update._updateType}-${id}`}
                    className="approval-card approval-pending"
                    style={{
                      opacity: isFading ? 0 : 1,
                      transition: 'opacity 0.4s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>
                          {update.workerName || update.worker?.name || update.submittedBy?.name || 'Unknown Worker'}
                        </h3>
                        <p className="text-light" style={{ margin: '4px 0', fontSize: '0.875rem' }}>
                          {formatRelativeDate(update.date)}
                          {' | '}
                          {update.jobName || update.job?.name || 'Unknown Job'}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span className={`badge ${isActivity ? 'badge-primary' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                          {isActivity ? 'Activity' : 'Task'}
                        </span>
                        <span className="badge badge-warning">Pending</span>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                        <strong>Activity:</strong> {update.activityName || update.activity?.name || '--'}
                      </p>
                      {!isActivity && (
                        <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                          <strong>Task:</strong> {update.taskName || update.task?.name || '--'}
                        </p>
                      )}
                      <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                        <strong>Progress:</strong>{' '}
                        <span className="badge badge-warning">
                          {update.previousPercent ?? update.percentBefore ?? 0}%
                        </span>
                        {' \u2192 '}
                        <span className="badge badge-success">
                          {update.newPercent ?? update.percentAfter ?? update.percentComplete ?? 0}%
                        </span>
                      </p>
                    </div>

                    {/* Photos */}
                    {update.photos && update.photos.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8 }}>
                          <Image size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                          Photos ({update.photos.length})
                        </p>
                        <div className="photo-grid">
                          {update.photos.map((photo, idx) => (
                            <div
                              key={idx}
                              className="photo-thumbnail"
                              onClick={() => setPhotoModal(photo.url || photo)}
                              style={{ cursor: 'pointer' }}
                            >
                              <img
                                src={photo.thumbnail || photo.url || photo}
                                alt={`Photo ${idx + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {update.notes && (
                      <div style={{ marginTop: 12 }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>Notes:</p>
                        <p className="text-light" style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                          {update.notes}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-danger"
                        disabled={isProcessing}
                        onClick={() => handleRejectTask(update)}
                      >
                        <XCircle size={16} />
                        Reject
                      </button>
                      <button
                        className="btn btn-success"
                        disabled={isProcessing}
                        onClick={() => handleApproveTask(update)}
                      >
                        <CheckCircle size={16} />
                        Approve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Timesheets Tab */}
      {activeTab === 'timesheets' && (
        <div>
          {timesheetCount > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="text-light">Total Pending Hours: </span>
                  <strong>{totalPendingHours.toFixed(1)}</strong>
                </div>
                <span className="badge badge-warning">{timesheetCount} pending</span>
              </div>
            </div>
          )}

          {loadingTimesheets ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <p className="text-light" style={{ marginTop: 12 }}>Loading pending timesheets...</p>
            </div>
          ) : timesheetCount === 0 ? (
            <EmptyState message="All caught up! No pending timesheets." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {timesheets.map((ts) => {
                const id = ts._id || ts.id;
                const isFading = fadingIds.has(id);
                const isProcessing = processingIds.has(id);
                return (
                  <div
                    key={id}
                    className="approval-card approval-pending"
                    style={{
                      opacity: isFading ? 0 : 1,
                      transition: 'opacity 0.4s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>
                          {ts.workerName || ts.worker?.name || ts.submittedBy?.name || 'Unknown Worker'}
                        </h3>
                        <p className="text-light" style={{ margin: '4px 0', fontSize: '0.875rem' }}>
                          {formatRelativeDate(ts.date)}
                        </p>
                      </div>
                      <span className="badge badge-warning">
                        <Clock size={12} style={{ marginRight: 4 }} />
                        {ts.hours || 0}h
                      </span>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                        <strong>Activity:</strong> {ts.activityName || ts.activity?.name || '--'}
                      </p>
                      {ts.notes && (
                        <p className="text-light" style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                          {ts.notes}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-danger"
                        disabled={isProcessing}
                        onClick={() => handleRejectTimesheet(ts)}
                      >
                        <XCircle size={16} />
                        Reject
                      </button>
                      <button
                        className="btn btn-success"
                        disabled={isProcessing}
                        onClick={() => handleApproveTimesheet(ts)}
                      >
                        <CheckCircle size={16} />
                        Approve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div>
          {loadingHistory ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <p className="text-light" style={{ marginTop: 12 }}>Loading approval history...</p>
            </div>
          ) : historyCount === 0 ? (
            <EmptyState message="No approval history yet." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {historyItems.map((item) => {
                const id = item._id || item.id;
                const isApproved = item.status === 'approved';
                return (
                  <div
                    key={`${item._type}-${id}`}
                    className={`approval-card ${isApproved ? 'approval-approved' : 'approval-rejected'}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>
                          {item.workerName || 'Unknown Worker'}
                        </h3>
                        <p className="text-light" style={{ margin: '4px 0', fontSize: '0.875rem' }}>
                          {formatRelativeDate(item.date)}
                          {' | '}
                          {item.jobName || 'Unknown Job'}
                        </p>
                      </div>
                      <span className={`badge ${isApproved ? 'badge-success' : 'badge-danger'}`}>
                        {isApproved ? 'Approved' : 'Rejected'}
                      </span>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      {item._type === 'task' ? (
                        <>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <span className="badge badge-neutral" style={{ fontSize: '0.65rem', marginRight: 6 }}>Task</span>
                            <strong>Task:</strong> {item.taskName || '--'}
                          </p>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <strong>% Complete:</strong> {item.percentComplete ?? 0}%
                          </p>
                        </>
                      ) : item._type === 'activity' ? (
                        <>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <span className="badge badge-primary" style={{ fontSize: '0.65rem', marginRight: 6 }}>Activity</span>
                            <strong>Activity:</strong> {item.activityName || '--'}
                          </p>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <strong>% Complete:</strong> {item.percentComplete ?? 0}%
                          </p>
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <span className="badge badge-neutral" style={{ fontSize: '0.65rem', marginRight: 6 }}>Timesheet</span>
                            <strong>Activity:</strong> {item.activityName || '--'}
                          </p>
                          <p style={{ fontSize: '0.875rem', margin: '4px 0' }}>
                            <strong>Hours:</strong> {item.hours || 0}h
                          </p>
                        </>
                      )}
                    </div>

                    {!isApproved && item.rejectionNote && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--danger-light)', borderRadius: 'var(--radius-xs)', fontSize: '0.875rem' }}>
                        <strong>Reason:</strong> {item.rejectionNote}
                      </div>
                    )}

                    <div className="text-light" style={{ marginTop: 8, fontSize: '0.875rem' }}>
                      {item.approverName || item.rejectorName
                        ? `${isApproved ? 'Approved' : 'Rejected'} by ${isApproved ? item.approverName : (item.rejectorName || item.approverName)}`
                        : ''}
                      {(isApproved ? item.approvedAt : item.rejectedAt || item.approvedAt)
                        ? ` on ${new Date(isApproved ? item.approvedAt : (item.rejectedAt || item.approvedAt)).toLocaleString()}`
                        : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rejection Reason Modal */}
      {rejectModal && (
        <div className="modal-overlay" onClick={() => setRejectModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.125rem' }}>
              Reject {rejectModal.type === 'activity' ? 'Activity Update' : rejectModal.type === 'task' ? 'Task Update' : 'Timesheet'}
            </h2>
            <p className="text-light" style={{ margin: '0 0 16px', fontSize: '0.875rem' }}>
              {rejectModal.type === 'task'
                ? `${rejectModal.item.workerName || 'Worker'}'s update for "${rejectModal.item.taskName || 'task'}"`
                : rejectModal.type === 'activity'
                ? `${rejectModal.item.workerName || 'Worker'}'s update for "${rejectModal.item.activityName || 'activity'}" — ${rejectModal.item.percentComplete ?? 0}%`
                : `${rejectModal.item.workerName || 'Worker'}'s timesheet — ${rejectModal.item.hours || 0}h for "${rejectModal.item.activityName || 'activity'}"`
              }
            </p>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 6 }}>
              Reason for Rejection
            </label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Explain why this is being rejected so the worker can correct and resubmit..."
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              autoFocus
              style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setRejectModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={confirmRejection}
                disabled={processingIds.has(rejectModal.item._id || rejectModal.item.id)}
              >
                <XCircle size={16} />
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {photoModal && (
        <div className="modal-overlay" onClick={() => setPhotoModal(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 800, padding: 0, overflow: 'hidden', background: '#000' }}
          >
            <button
              onClick={() => setPhotoModal(null)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff',
                zIndex: 10,
              }}
            >
              <X size={20} />
            </button>
            <img
              src={photoModal}
              alt="Full size"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * EmptyState - Displayed when there are no pending items in the approval queue.
 * Shows a green checkmark icon with the provided message.
 * @component
 * @param {Object} props
 * @param {string} props.message - Message to display (e.g., "All caught up!")
 * @returns {JSX.Element} Centered empty state card
 */
function EmptyState({ message }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 60 }}>
      <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: 16 }} />
      <h3 style={{ margin: '0 0 8px' }}>{message}</h3>
      <p className="text-light">Check back later for new items to review.</p>
    </div>
  );
}
