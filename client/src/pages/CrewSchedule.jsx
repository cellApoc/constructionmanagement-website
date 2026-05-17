/**
 * @file Crew scheduling page with weekly calendar grid.
 * Manages crew/worker assignments to jobs by day with drag-and-drop,
 * conflict detection, and worker availability display.
 * @module client/pages/CrewSchedule
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  User,
  X,
  AlertTriangle,
  Calendar,
  Clock,
  Trash2,
  Edit3,
  UserPlus,
  UserMinus,
  Copy,
  BarChart3,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../App';

/** @type {string[]} Day name abbreviations for the weekly grid header */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Get the Monday Date object of the week containing the given date.
 * @param {Date} date - Any date within the desired week
 * @returns {Date} Monday of that week
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

/**
 * Format a Date to an ISO date string (YYYY-MM-DD).
 * @param {Date} d - Date to format
 * @returns {string} ISO date string
 */
function formatDate(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Add N days to a Date, returning a new Date.
 * @param {Date} d - Starting date
 * @param {number} n - Number of days to add (can be negative)
 * @returns {Date} New date offset by N days
 */
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * Format a Date as a short M/D string (e.g., "4/6").
 * @param {Date} d - Date to format
 * @returns {string} Short date string
 */
function formatShortDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Format a week range label from Monday to Sunday (e.g., "Apr 6 – Apr 12, 2026").
 * @param {Date} monday - Monday of the week
 * @returns {string} Formatted week range
 */
function formatWeekRange(monday) {
  const sun = addDays(monday, 6);
  const mStr = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sStr = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${mStr} – ${sStr}`;
}

/**
 * Crew scheduling page with weekly calendar grid.
 * Displays jobs as rows and 7 weekdays as columns. Supports drag-and-drop
 * assignment of crews/workers to job-date cells, conflict detection with
 * force-override, named crew management, and worker availability display.
 * @returns {JSX.Element}
 */
export default function CrewSchedule() {
  const api = useApi();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [monday, setMonday] = useState(() => getMonday(new Date()));
  const [jobs, setJobs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [crews, setCrews] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Assignment modal
  const [assignModal, setAssignModal] = useState(null); // { jobId, date, editing? }
  const [assignType, setAssignType] = useState('worker'); // 'worker' | 'crew'
  const [assignWorkerId, setAssignWorkerId] = useState('');
  const [assignCrewId, setAssignCrewId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignHours, setAssignHours] = useState(8);
  const [assignSaving, setAssignSaving] = useState(false);

  // Conflict modal
  const [conflictData, setConflictData] = useState(null);
  const [pendingAssign, setPendingAssign] = useState(null);

  // Crew management modal
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [crewForm, setCrewForm] = useState(null); // null = list, { id?, name, description, memberIds }
  const [crewSaving, setCrewSaving] = useState(false);

  // Availability modal
  const [availModal, setAvailModal] = useState(null); // { workerId, date }
  const [availType, setAvailType] = useState('time_off');
  const [availNotes, setAvailNotes] = useState('');

  // Filter
  const [filterJobId, setFilterJobId] = useState('');

  // Drag state
  const dragRef = useRef(null);
  const [dropTarget, setDropTarget] = useState(null);

  // Bulk assignment modal
  const [bulkModal, setBulkModal] = useState(null); // { jobId }
  const [bulkType, setBulkType] = useState('worker');
  const [bulkWorkerId, setBulkWorkerId] = useState('');
  const [bulkCrewId, setBulkCrewId] = useState('');
  const [bulkDays, setBulkDays] = useState([0, 1, 2, 3, 4]); // Mon-Fri by default
  const [bulkHours, setBulkHours] = useState(8);
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkConflicts, setBulkConflicts] = useState(null);

  // Time tracking
  const [showTimeTracking, setShowTimeTracking] = useState(false);
  const [timeTracking, setTimeTracking] = useState(null);
  const [timeTrackingLoading, setTimeTrackingLoading] = useState(false);

  // Schedule permissions: foreman+ always has read, but write depends on settings
  const [canManage, setCanManage] = useState(false);
  const canView = user?.role !== 'worker'; // foreman+ always has read access

  useEffect(() => {
    if (!user || user.role === 'worker') {
      setCanManage(false);
      return;
    }
    // Admin always can manage
    if (user.role === 'admin') {
      setCanManage(true);
      return;
    }
    // Check schedule_manage_roles setting for foreman/PM
    let cancelled = false;
    async function checkPermission() {
      try {
        const settings = await api.get('/api/settings');
        if (!cancelled) {
          const allowedRoles = settings?.schedule_manage_roles || ['admin', 'project_manager', 'foreman'];
          setCanManage(allowedRoles.includes(user.role));
        }
      } catch {
        // Default: allow foreman+ to manage if settings can't be loaded
        if (!cancelled) setCanManage(true);
      }
    }
    checkPermission();
    return () => { cancelled = true; };
  }, [api, user]);

  const fetchData = useCallback(async () => {
    if (!user) return; // Guard: don't fetch before auth is ready
    setLoading(true);
    try {
      const weekDate = formatDate(monday);
      const [weekData, jobsData, crewsData, workersData] = await Promise.all([
        api.get(`/api/schedule/week?date=${weekDate}`),
        api.get('/api/jobs?status=active'),
        api.get('/api/crews'),
        canView ? api.get('/api/users?role=worker') : Promise.resolve([]),
      ]);
      setAssignments(weekData.assignments || []);
      setAvailability(weekData.availability || []);
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      setCrews(Array.isArray(crewsData) ? crewsData : []);
      setWorkers(Array.isArray(workersData) ? workersData : workersData?.users || []);
    } catch (err) {
      showToast(err.message || 'Failed to load schedule', 'error');
    } finally {
      setLoading(false);
    }
  }, [api, monday, canView, user, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Week navigation ──
  function prevWeek() { setMonday(addDays(monday, -7)); }
  function nextWeek() { setMonday(addDays(monday, 7)); }
  function goToday() { setMonday(getMonday(new Date())); }

  // ── Build week days ──
  const weekDays = [];
  const today = formatDate(new Date());
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    weekDays.push({ date: formatDate(d), dateObj: d, dayName: DAY_NAMES[i], isToday: formatDate(d) === today, isWeekend: i >= 5 });
  }

  // ── Filtered jobs ──
  const displayJobs = filterJobId ? jobs.filter(j => j.id === filterJobId) : jobs;

  // ── Get assignments for a cell ──
  function getCellAssignments(jobId, date) {
    return assignments.filter(a => a.jobId === jobId && a.date === date);
  }

  // ── Get availability for a date ──
  function getDateAvailability(date) {
    return availability.filter(a => a.date === date);
  }

  // ── Assignment CRUD ──
  function openAssignModal(jobId, date, existing) {
    if (!canManage) return;
    if (existing) {
      setAssignModal({ jobId, date, editingId: existing.id });
      setAssignType(existing.crewId ? 'crew' : 'worker');
      setAssignWorkerId(existing.workerId || '');
      setAssignCrewId(existing.crewId || '');
      setAssignNotes(existing.notes || '');
      setAssignHours(existing.scheduledHours || 8);
    } else {
      setAssignModal({ jobId, date });
      setAssignType('worker');
      setAssignWorkerId('');
      setAssignCrewId('');
      setAssignNotes('');
      setAssignHours(8);
    }
  }

  async function saveAssignment(force) {
    if (!assignModal) return;
    const { jobId, date, editingId } = assignModal;
    const body = {
      jobId, date,
      workerId: assignType === 'worker' ? assignWorkerId : null,
      crewId: assignType === 'crew' ? assignCrewId : null,
      notes: assignNotes || null,
      scheduledHours: assignHours,
      force: force || false,
    };

    if (assignType === 'worker' && !assignWorkerId) return showToast('Select a worker', 'error');
    if (assignType === 'crew' && !assignCrewId) return showToast('Select a crew', 'error');

    setAssignSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/schedule/${editingId}`, body);
        showToast('Assignment updated');
      } else {
        await api.post('/api/schedule', body);
        showToast('Assignment created');
      }
      setAssignModal(null);
      setConflictData(null);
      setPendingAssign(null);
      fetchData();
    } catch (err) {
      if (err.status === 409 || err.hasConflict || (err.conflicts)) {
        const data = err.conflicts ? err : await err.json?.() || err;
        setConflictData(data.conflicts || []);
        setPendingAssign({ ...body, editingId });
      } else {
        showToast(err.message || 'Failed to save assignment', 'error');
      }
    } finally {
      setAssignSaving(false);
    }
  }

  async function forceAssignment() {
    if (!pendingAssign) return;
    const { editingId, ...body } = pendingAssign;
    body.force = true;
    setAssignSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/schedule/${editingId}`, body);
      } else {
        await api.post('/api/schedule', body);
      }
      showToast('Assignment saved (conflict overridden)');
      setAssignModal(null);
      setConflictData(null);
      setPendingAssign(null);
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setAssignSaving(false);
    }
  }

  async function deleteAssignment(id) {
    try {
      await api.del(`/api/schedule/${id}`);
      showToast('Assignment removed');
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'error');
    }
  }

  // ── Drag and drop ──
  const [dragging, setDragging] = useState(false);

  function handleDragStart(e, assignment) {
    dragRef.current = assignment;
    e.dataTransfer.effectAllowed = e.altKey ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', assignment.id);
    // Style the drag ghost
    const el = e.currentTarget;
    el.classList.add('dragging');
    setDragging(true);
    // Store whether this is a copy operation
    dragRef.copyMode = e.altKey;
  }

  function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    setDragging(false);
    setDropTarget(null);
  }

  function handleDragOver(e, jobId, date) {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragRef.copyMode ? 'copy' : 'move';
    const key = `${jobId}-${date}`;
    if (dropTarget !== key) setDropTarget(key);
  }

  function handleDragLeave(e) {
    // Only clear if leaving the cell entirely
    const related = e.relatedTarget;
    if (!e.currentTarget.contains(related)) {
      setDropTarget(null);
    }
  }

  async function handleDrop(e, jobId, date) {
    e.preventDefault();
    setDropTarget(null);
    setDragging(false);
    const assignment = dragRef.current;
    if (!assignment) return;
    if (assignment.jobId === jobId && assignment.date === date) return;

    try {
      if (dragRef.copyMode) {
        // Copy mode — create a new assignment at the target
        await api.post('/api/schedule', {
          jobId,
          date,
          workerId: assignment.workerId || null,
          crewId: assignment.crewId || null,
          notes: assignment.notes || null,
          scheduledHours: assignment.scheduledHours || 8,
        });
        showToast('Assignment copied');
      } else {
        await api.put(`/api/schedule/${assignment.id}`, { jobId, date });
        showToast('Assignment moved');
      }
      fetchData();
    } catch (err) {
      if (err.status === 409 || err.hasConflict) {
        showToast('Conflict detected — edit assignment to override', 'error');
      } else {
        showToast(err.message || 'Failed to ' + (dragRef.copyMode ? 'copy' : 'move'), 'error');
      }
    }
    dragRef.current = null;
    dragRef.copyMode = false;
  }

  // ── Crew Management ──
  async function saveCrew() {
    if (!crewForm) return;
    setCrewSaving(true);
    try {
      if (crewForm.id) {
        await api.put(`/api/crews/${crewForm.id}`, {
          name: crewForm.name,
          description: crewForm.description,
          memberIds: crewForm.memberIds,
        });
        showToast('Crew updated');
      } else {
        await api.post('/api/crews', {
          name: crewForm.name,
          description: crewForm.description,
          memberIds: crewForm.memberIds,
        });
        showToast('Crew created');
      }
      setCrewForm(null);
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to save crew', 'error');
    } finally {
      setCrewSaving(false);
    }
  }

  async function deleteCrew(id) {
    try {
      await api.del(`/api/crews/${id}`);
      showToast('Crew deleted');
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to delete crew', 'error');
    }
  }

  async function editCrew(crew) {
    try {
      const full = await api.get(`/api/crews/${crew.id}`);
      setCrewForm({
        id: full.id,
        name: full.name,
        description: full.description || '',
        memberIds: full.members?.map(m => m.id) || [],
      });
    } catch (err) {
      showToast('Failed to load crew details', 'error');
    }
  }

  // ── Availability ──
  async function saveAvailability() {
    if (!availModal) return;
    try {
      await api.post('/api/schedule/availability', {
        workerId: availModal.workerId,
        date: availModal.date,
        type: availType,
        notes: availNotes || null,
      });
      showToast('Availability marked');
      setAvailModal(null);
      setAvailNotes('');
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    }
  }

  async function removeAvailability(id) {
    try {
      await api.del(`/api/schedule/availability/${id}`);
      showToast('Availability cleared');
      fetchData();
    } catch (err) {
      showToast(err.message || 'Failed to remove', 'error');
    }
  }

  // ── Bulk Assignment ──
  function openBulkModal(jobId) {
    setBulkModal({ jobId });
    setBulkType('worker');
    setBulkWorkerId('');
    setBulkCrewId('');
    setBulkDays([0, 1, 2, 3, 4]);
    setBulkHours(8);
    setBulkNotes('');
    setBulkConflicts(null);
  }

  function toggleBulkDay(dayIndex) {
    setBulkDays(prev =>
      prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort()
    );
  }

  async function saveBulkAssignment(force) {
    if (!bulkModal) return;
    if (bulkType === 'worker' && !bulkWorkerId) return showToast('Select a worker', 'error');
    if (bulkType === 'crew' && !bulkCrewId) return showToast('Select a crew', 'error');
    if (bulkDays.length === 0) return showToast('Select at least one day', 'error');

    const dates = bulkDays.map(i => formatDate(addDays(monday, i)));
    const body = {
      jobId: bulkModal.jobId,
      dates,
      workerId: bulkType === 'worker' ? bulkWorkerId : null,
      crewId: bulkType === 'crew' ? bulkCrewId : null,
      notes: bulkNotes || null,
      scheduledHours: bulkHours,
      force: force || false,
    };

    setBulkSaving(true);
    try {
      const result = await api.post('/api/schedule/bulk', body);
      showToast(result.message || `${result.created} assignments created`);
      setBulkModal(null);
      setBulkConflicts(null);
      fetchData();
    } catch (err) {
      if (err.status === 409 || err.hasConflict || err.conflicts) {
        const data = err.conflicts ? err : await err.json?.() || err;
        setBulkConflicts(data.conflicts || []);
      } else {
        showToast(err.message || 'Failed to create assignments', 'error');
      }
    } finally {
      setBulkSaving(false);
    }
  }

  // ── Time Tracking ──
  async function fetchTimeTracking() {
    setTimeTrackingLoading(true);
    try {
      const weekDate = formatDate(monday);
      const sundayDate = formatDate(addDays(monday, 6));
      const params = `startDate=${weekDate}&endDate=${sundayDate}${filterJobId ? `&jobId=${filterJobId}` : ''}`;
      const data = await api.get(`/api/schedule/time-tracking?${params}`);
      setTimeTracking(data);
    } catch (err) {
      showToast(err.message || 'Failed to load time tracking', 'error');
    } finally {
      setTimeTrackingLoading(false);
    }
  }

  function toggleTimeTracking() {
    if (!showTimeTracking) {
      fetchTimeTracking();
    }
    setShowTimeTracking(!showTimeTracking);
  }

  // ── Render ──
  if (loading) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Crew Schedule</h1>
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading schedule...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-fade-in">
      <h1 className="page-title">Crew Schedule</h1>

      {/* Toolbar */}
      <div className="schedule-toolbar">
        <div className="schedule-week-nav">
          <button onClick={prevWeek}><ChevronLeft size={16} /></button>
          <span className="schedule-week-label">{formatWeekRange(monday)}</span>
          <button onClick={nextWeek}><ChevronRight size={16} /></button>
          <button onClick={goToday} className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }}>Today</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 200 }} value={filterJobId} onChange={e => setFilterJobId(e.target.value)}>
            <option value="">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <button className={`btn ${showTimeTracking ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleTimeTracking}>
            <BarChart3 size={16} /> Time Tracking
          </button>
          {canManage && (
            <button className="btn btn-secondary" onClick={() => { setShowCrewModal(true); setCrewForm(null); }}>
              <Users size={16} /> Manage Crews
            </button>
          )}
        </div>
      </div>

      {/* Time Tracking Panel */}
      {showTimeTracking && (
        <div className="card time-tracking-panel" style={{ marginBottom: 16, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>
              <BarChart3 size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Scheduled vs. Logged Hours
            </h3>
            <button className="btn btn-sm btn-secondary" onClick={fetchTimeTracking} disabled={timeTrackingLoading}>
              {timeTrackingLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {timeTrackingLoading && !timeTracking ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : timeTracking ? (
            <>
              <div className="grid-4" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-card-label">Scheduled</div>
                  <div className="stat-card-number">{timeTracking.summary.totalScheduled}h</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Logged</div>
                  <div className="stat-card-number">{timeTracking.summary.totalLogged}h</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Approved</div>
                  <div className="stat-card-number" style={{ color: 'var(--success)' }}>{timeTracking.summary.totalApproved}h</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Variance</div>
                  <div className="stat-card-number" style={{ color: timeTracking.summary.variance > 0 ? 'var(--success)' : timeTracking.summary.variance < 0 ? 'var(--danger)' : 'var(--text)' }}>
                    {timeTracking.summary.variance > 0 ? '+' : ''}{timeTracking.summary.variance}h
                  </div>
                </div>
              </div>
              {timeTracking.entries.length > 0 ? (
                <div className="table-container" style={{ maxHeight: 300 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Date</th>
                        <th>Job</th>
                        <th>Scheduled</th>
                        <th>Logged</th>
                        <th>Status</th>
                        <th>Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeTracking.entries.map((e, i) => (
                        <tr key={i}>
                          <td>{e.workerName}{e.crewName ? ` (${e.crewName})` : ''}</td>
                          <td>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                          <td>{e.jobName}</td>
                          <td>{e.scheduledHours}h</td>
                          <td>{e.loggedHours}h</td>
                          <td>
                            {e.unscheduled ? (
                              <span className="badge badge-warning">Unscheduled</span>
                            ) : e.loggedHours === 0 ? (
                              <span className="badge badge-neutral">No entry</span>
                            ) : e.pendingHours > 0 ? (
                              <span className="badge badge-warning">Pending</span>
                            ) : (
                              <span className="badge badge-success">Approved</span>
                            )}
                          </td>
                          <td>
                            <span style={{ color: e.variance > 0 ? 'var(--success)' : e.variance < 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                              {e.variance > 0 ? '+' : ''}{Math.round(e.variance * 100) / 100}h
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-light" style={{ textAlign: 'center', padding: 16 }}>No schedule or timesheet data for this week.</p>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Schedule Grid */}
      {displayJobs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <Calendar size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
          <h3 style={{ margin: '0 0 8px' }}>No active jobs</h3>
          <p className="text-light">Create a job first to start scheduling crews.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div className={`schedule-grid ${dragging ? 'drag-active' : ''}`} style={{ minWidth: 800 }}>
            {/* Header row */}
            <div className="schedule-corner">Jobs</div>
            {weekDays.map(day => (
              <div key={day.date} className={`schedule-header-cell ${day.isToday ? 'today' : ''} ${day.isWeekend ? 'weekend' : ''}`}>
                {day.dayName}
                <span className="day-date">{day.dateObj.getDate()}</span>
              </div>
            ))}

            {/* Job rows */}
            {displayJobs.map(job => (
              <React.Fragment key={job.id}>
                <div className="schedule-job-label">
                  <div>
                    {job.name}
                    {job.address && <span className="job-address">{job.address}</span>}
                  </div>
                  {canManage && (
                    <button className="btn btn-sm btn-outline bulk-assign-btn" onClick={() => openBulkModal(job.id)} title="Assign full week">
                      <Copy size={12} />
                    </button>
                  )}
                </div>
                {weekDays.map(day => {
                  const cellAssignments = getCellAssignments(job.id, day.date);
                  const dateAvail = getDateAvailability(day.date);
                  const isDropping = dropTarget === `${job.id}-${day.date}`;
                  return (
                    <div
                      key={`${job.id}-${day.date}`}
                      className={`schedule-cell ${day.isWeekend ? 'weekend' : ''} ${isDropping ? 'drop-target' : ''}`}
                      onDragOver={canManage ? (e) => handleDragOver(e, job.id, day.date) : undefined}
                      onDragLeave={canManage ? handleDragLeave : undefined}
                      onDrop={canManage ? (e) => handleDrop(e, job.id, day.date) : undefined}
                    >
                      {cellAssignments.map(a => (
                        <div
                          key={a.id}
                          className={`assignment-chip ${a.crewId ? 'crew' : 'worker'}`}
                          draggable={canManage}
                          onDragStart={canManage ? (e) => handleDragStart(e, a) : undefined}
                          onDragEnd={canManage ? handleDragEnd : undefined}
                          onClick={() => canManage && openAssignModal(job.id, day.date, a)}
                          title={a.notes || ''}
                        >
                          {a.crewId ? <Users size={10} /> : <User size={10} />}
                          <span>{a.crewName || a.workerName}</span>
                          {a.scheduledHours && a.scheduledHours !== 8 && <span className="assignment-chip-hours">{a.scheduledHours}h</span>}
                          {a.notes && <span className="assignment-chip-notes">{a.notes}</span>}
                          {canManage && (
                            <button
                              className="assignment-chip-remove"
                              onClick={(e) => { e.stopPropagation(); deleteAssignment(a.id); }}
                            >
                              <X size={8} />
                            </button>
                          )}
                        </div>
                      ))}
                      {dateAvail.length > 0 && cellAssignments.length === 0 && (
                        <div className="availability-marker">
                          <Clock size={10} />
                          {dateAvail.length} off
                        </div>
                      )}
                      {canManage && (
                        <button className="schedule-cell-add" onClick={() => openAssignModal(job.id, day.date)}>
                          <Plus size={10} /> Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: '0.75rem', color: 'var(--text-light)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ background: 'var(--primary)', width: 12, height: 12, borderRadius: 6, display: 'inline-block' }} /> Crew
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ background: 'var(--success)', width: 12, height: 12, borderRadius: 6, display: 'inline-block' }} /> Individual
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} style={{ color: 'var(--warning)' }} /> Unavailable
        </span>
        {canManage && (
          <span className="text-muted" style={{ marginLeft: 'auto' }}>
            Drag to move · Hold Alt+drag to copy
          </span>
        )}
      </div>

      {/* ── Assignment Modal ── */}
      {assignModal && (
        <div className="modal-overlay" onClick={() => { setAssignModal(null); setConflictData(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
                {assignModal.editingId ? 'Edit Assignment' : 'New Assignment'}
              </h2>
              <button onClick={() => { setAssignModal(null); setConflictData(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p className="text-light" style={{ fontSize: '0.875rem', margin: '0 0 16px' }}>
              {jobs.find(j => j.id === assignModal.jobId)?.name} — {new Date(assignModal.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>

            {conflictData && conflictData.length > 0 && (
              <div className="conflict-banner">
                <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                <div>
                  <strong>Scheduling Conflicts Detected</strong>
                  {conflictData.map((c, i) => (
                    <div key={i} style={{ fontSize: '0.8125rem', marginTop: 4 }}>
                      {c.workerName}: {c.type === 'double_booked' ? `already assigned to ${c.existingJobName}` : `marked as ${c.type}`}
                    </div>
                  ))}
                  <button className="btn btn-sm btn-warning" style={{ marginTop: 8 }} onClick={forceAssignment} disabled={assignSaving}>
                    Assign Anyway
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Assign</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn btn-sm ${assignType === 'worker' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAssignType('worker')}
                >
                  <User size={14} /> Worker
                </button>
                <button
                  className={`btn btn-sm ${assignType === 'crew' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAssignType('crew')}
                >
                  <Users size={14} /> Crew
                </button>
              </div>
            </div>

            {assignType === 'worker' ? (
              <div className="form-group">
                <label className="form-label">Worker</label>
                <select className="form-input" value={assignWorkerId} onChange={e => setAssignWorkerId(e.target.value)}>
                  <option value="">-- Select Worker --</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Crew</label>
                <select className="form-input" value={assignCrewId} onChange={e => setAssignCrewId(e.target.value)}>
                  <option value="">-- Select Crew --</option>
                  {crews.map(c => <option key={c.id} value={c.id}>{c.name} ({c.memberCount} members)</option>)}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Scheduled Hours</label>
                <input className="form-input" type="number" min="0.25" max="24" step="0.25" value={assignHours} onChange={e => setAssignHours(parseFloat(e.target.value) || 8)} />
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" placeholder="e.g., Bring excavator" value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => { setAssignModal(null); setConflictData(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={() => saveAssignment(false)} disabled={assignSaving}>
                {assignSaving ? 'Saving...' : assignModal.editingId ? 'Update' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Crew Management Modal ── */}
      {showCrewModal && (
        <div className="modal-overlay" onClick={() => { setShowCrewModal(false); setCrewForm(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, padding: 24, maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
                {crewForm ? (crewForm.id ? 'Edit Crew' : 'New Crew') : 'Manage Crews'}
              </h2>
              <button onClick={() => { setShowCrewModal(false); setCrewForm(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {!crewForm ? (
              <>
                <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }}
                  onClick={() => setCrewForm({ name: '', description: '', memberIds: [] })}
                >
                  <Plus size={14} /> New Crew
                </button>

                {crews.length === 0 ? (
                  <p className="text-light" style={{ textAlign: 'center', padding: 24 }}>No crews created yet.</p>
                ) : (
                  crews.map(c => (
                    <div key={c.id} className="crew-card">
                      <div className="crew-card-header">
                        <h3><Users size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />{c.name}</h3>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => editCrew(c)}><Edit3 size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteCrew(c.id)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      {c.description && <p className="text-light" style={{ fontSize: '0.8125rem', margin: '0 0 4px' }}>{c.description}</p>}
                      <span className="badge badge-neutral">{c.memberCount} members</span>
                    </div>
                  ))
                )}
              </>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Crew Name *</label>
                  <input className="form-input" value={crewForm.name} onChange={e => setCrewForm({ ...crewForm, name: e.target.value })} placeholder="e.g., Framing Crew A" />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-input" value={crewForm.description} onChange={e => setCrewForm({ ...crewForm, description: e.target.value })} placeholder="Optional description" />
                </div>
                <div className="form-group">
                  <label className="form-label">Members</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {crewForm.memberIds.map(mid => {
                      const w = workers.find(x => x.id === mid);
                      return (
                        <span key={mid} className="crew-member-tag">
                          <User size={10} /> {w?.name || mid}
                          <button onClick={() => setCrewForm({ ...crewForm, memberIds: crewForm.memberIds.filter(id => id !== mid) })}>
                            <X size={8} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <select className="form-input" value="" onChange={e => {
                    if (e.target.value && !crewForm.memberIds.includes(e.target.value)) {
                      setCrewForm({ ...crewForm, memberIds: [...crewForm.memberIds, e.target.value] });
                    }
                  }}>
                    <option value="">+ Add worker...</option>
                    {workers.filter(w => !crewForm.memberIds.includes(w.id)).map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-secondary" onClick={() => setCrewForm(null)}>Back</button>
                  <button className="btn btn-primary" onClick={saveCrew} disabled={crewSaving || !crewForm.name}>
                    {crewSaving ? 'Saving...' : crewForm.id ? 'Update Crew' : 'Create Crew'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk Assignment Modal ── */}
      {bulkModal && (
        <div className="modal-overlay" onClick={() => { setBulkModal(null); setBulkConflicts(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
                <Copy size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Bulk Assign — {jobs.find(j => j.id === bulkModal.jobId)?.name}
              </h2>
              <button onClick={() => { setBulkModal(null); setBulkConflicts(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p className="text-light" style={{ fontSize: '0.875rem', margin: '0 0 16px' }}>
              Assign a worker or crew to this job for multiple days in the week of {formatWeekRange(monday)}.
            </p>

            {bulkConflicts && bulkConflicts.length > 0 && (
              <div className="conflict-banner" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                <div>
                  <strong>Conflicts on {bulkConflicts.length} day(s)</strong>
                  {bulkConflicts.map((c, i) => (
                    <div key={i} style={{ fontSize: '0.8125rem', marginTop: 4 }}>
                      {c.date}: {c.conflicts.map(x => `${x.workerName}: ${x.type === 'double_booked' ? `assigned to ${x.existingJobName}` : x.type}`).join('; ')}
                    </div>
                  ))}
                  <button className="btn btn-sm btn-warning" style={{ marginTop: 8 }} onClick={() => saveBulkAssignment(true)} disabled={bulkSaving}>
                    Assign Anyway
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Assign</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn btn-sm ${bulkType === 'worker' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setBulkType('worker')}>
                  <User size={14} /> Worker
                </button>
                <button className={`btn btn-sm ${bulkType === 'crew' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setBulkType('crew')}>
                  <Users size={14} /> Crew
                </button>
              </div>
            </div>

            {bulkType === 'worker' ? (
              <div className="form-group">
                <label className="form-label">Worker</label>
                <select className="form-input" value={bulkWorkerId} onChange={e => setBulkWorkerId(e.target.value)}>
                  <option value="">-- Select Worker --</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Crew</label>
                <select className="form-input" value={bulkCrewId} onChange={e => setBulkCrewId(e.target.value)}>
                  <option value="">-- Select Crew --</option>
                  {crews.map(c => <option key={c.id} value={c.id}>{c.name} ({c.memberCount} members)</option>)}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Days</label>
              <div className="bulk-day-picker">
                {DAY_NAMES.map((name, i) => (
                  <button
                    key={i}
                    className={`bulk-day-btn ${bulkDays.includes(i) ? 'active' : ''} ${i >= 5 ? 'weekend' : ''}`}
                    onClick={() => toggleBulkDay(i)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-outline" onClick={() => setBulkDays([0, 1, 2, 3, 4])}>Weekdays</button>
                <button className="btn btn-sm btn-outline" onClick={() => setBulkDays([0, 1, 2, 3, 4, 5, 6])}>All Week</button>
                <button className="btn btn-sm btn-outline" onClick={() => setBulkDays([])}>Clear</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Hours/Day</label>
                <input className="form-input" type="number" min="0.25" max="24" step="0.25" value={bulkHours} onChange={e => setBulkHours(parseFloat(e.target.value) || 8)} />
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" placeholder="e.g., Full week framing" value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span className="text-light" style={{ fontSize: '0.8125rem' }}>
                {bulkDays.length} day(s) × {bulkHours}h = {bulkDays.length * bulkHours}h total
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => { setBulkModal(null); setBulkConflicts(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveBulkAssignment(false)} disabled={bulkSaving}>
                  {bulkSaving ? 'Assigning...' : `Assign ${bulkDays.length} Days`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
