/**
 * @file Daily production entry page for field workers.
 * Provides a mobile-first 3-step flow: Select Job -> Select Activity -> Update Tasks (or Activity).
 * Jobs are filtered to those the user is assigned to or scheduled for this week.
 * Activities are filtered by schedule dates, worker assignments, and completion status.
 * Foreman+ roles see a "Show All Activities" toggle and can mark activities as force-available.
 * When tasks are disabled (per app/job settings), workers submit % complete at the activity level.
 * Pre-fills last submitted % for tasks/activities and remembers the last job+activity selection.
 * Fetches worker's updates from GET /api/daily-updates/worker/:workerId?date=today.
 * Uses buildActivityList() and getProgressClass() from utils/formatting.js.
 * @module client/pages/DailyEntry
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Calendar,
  ChevronDown,
  Camera,
  X,
  CheckCircle,
  AlertTriangle,
  Loader,
  Send,
  Image,
  Clock,
  FileText,
  Eye,
  EyeOff,
  Unlock,
  Lock,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { buildActivityList, getProgressClass } from '../utils/formatting';

const STORAGE_KEY = 'dailyEntry_lastSelection';

/**
 * DailyEntry - Worker daily production entry form.
 * Three-step flow: (1) Select active job (filtered by assignment/schedule),
 * (2) Select activity (filtered by schedule/availability/completion),
 * (3) For each task (or activity if tasks disabled), set % complete + photos + notes.
 * @component
 * @returns {JSX.Element} Daily production entry page
 */
export default function DailyEntry() {
  const api = useApi();
  const { user } = useAuth();
  const isManager = ['foreman', 'project_manager', 'admin'].includes(user?.role);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const todayISO = new Date().toISOString().split('T')[0];

  // Step state
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [job, setJob] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState('');
  const [selectedActivity, setSelectedActivity] = useState(null);

  // Task entries: { [taskId]: { percentComplete, photos: File[], notes } }
  const [taskEntries, setTaskEntries] = useState({});
  // Activity-level entry (when tasks disabled)
  const [activityEntry, setActivityEntry] = useState({ percentComplete: 0, photos: [], notes: '' });

  // Filtering
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [tasksEnabled, setTasksEnabled] = useState(true);

  // Loading/status
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingJob, setLoadingJob] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Today's submissions (task + activity level)
  const [todaysSubmissions, setTodaysSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Pre-fill data
  const [lastUpdates, setLastUpdates] = useState({});

  // Restore last selection from localStorage
  const restoredRef = useRef(false);

  // Load filtered jobs (my-active for workers, all active for managers)
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

  // Save selection to localStorage
  useEffect(() => {
    if (selectedJobId || selectedActivityId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        jobId: selectedJobId,
        activityId: selectedActivityId,
      }));
    }
  }, [selectedJobId, selectedActivityId]);

  // Load job detail + check tasks_enabled when job selected
  useEffect(() => {
    if (!selectedJobId) {
      setJob(null);
      setSelectedActivityId('');
      setSelectedActivity(null);
      setTaskEntries({});
      setActivityEntry({ percentComplete: 0, photos: [], notes: '' });
      return;
    }
    let cancelled = false;
    async function fetchJob() {
      setLoadingJob(true);
      setError('');
      setSelectedActivityId('');
      setSelectedActivity(null);
      setTaskEntries({});
      setActivityEntry({ percentComplete: 0, photos: [], notes: '' });
      try {
        const [data, jobSettings, appSettings] = await Promise.all([
          api.get(`/api/jobs/${selectedJobId}`),
          api.get(`/api/settings/jobs/${selectedJobId}`).catch(() => ({})),
          api.get('/api/settings').catch(() => ({})),
        ]);
        if (!cancelled) {
          setJob(data);
          // Resolve tasks_enabled: job setting → app setting → true
          const jobVal = jobSettings?.tasks_enabled;
          const appVal = appSettings?.tasks_enabled;
          const enabled = jobVal !== undefined ? (typeof jobVal === 'string' ? JSON.parse(jobVal) : jobVal)
            : appVal !== undefined ? (typeof appVal === 'string' ? JSON.parse(appVal) : appVal)
            : true;
          setTasksEnabled(enabled);

          // Restore activity selection from localStorage
          try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.activityId && saved.jobId === selectedJobId) {
              setTimeout(() => setSelectedActivityId(saved.activityId), 0);
            }
          } catch { /* ignore */ }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load job details');
      } finally {
        if (!cancelled) setLoadingJob(false);
      }
    }
    fetchJob();
    return () => { cancelled = true; };
  }, [api, selectedJobId]);

  // Load today's submissions (both task and activity level)
  const fetchSubmissions = useCallback(async () => {
    if (!user) return;
    setLoadingSubmissions(true);
    try {
      const [taskSubs, actSubs] = await Promise.all([
        api.get(`/api/daily-updates/worker/${user?.id || user?._id}?date=${todayISO}`).catch(() => []),
        api.get(`/api/daily-updates/activity/worker/${user?.id || user?._id}?date=${todayISO}`).catch(() => []),
      ]);
      const allSubs = [
        ...(Array.isArray(taskSubs) ? taskSubs : []).map(s => ({ ...s, updateType: 'task' })),
        ...(Array.isArray(actSubs) ? actSubs : []).map(s => ({ ...s, updateType: 'activity' })),
      ];
      setTodaysSubmissions(allSubs);

      // Build pre-fill map from today's submissions
      const prefill = {};
      for (const sub of allSubs) {
        if (sub.updateType === 'task' && sub.taskId) {
          prefill[`task_${sub.taskId}`] = sub.percentComplete;
        } else if (sub.updateType === 'activity' && sub.activityId) {
          prefill[`activity_${sub.activityId}`] = sub.percentComplete;
        }
      }
      setLastUpdates(prefill);
    } catch {
      setTodaysSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [api, user, todayISO]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions, success]);

  // Build activity list and filter
  const allActivities = buildActivityList(job);

  const filteredActivities = showAllActivities ? allActivities : allActivities.filter(a => {
    // Check if activity is scheduled this week or has no dates (always available) or is force-available
    const now = new Date();
    const weekStart = getMonday(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const wsISO = weekStart.toISOString().split('T')[0];
    const weISO = weekEnd.toISOString().split('T')[0];

    const hasSchedule = a.scheduledStartDate && a.scheduledFinishDate;
    const inRange = hasSchedule && a.scheduledStartDate <= weISO && a.scheduledFinishDate >= wsISO;
    const noDates = !a.scheduledStartDate && !a.scheduledFinishDate;

    if (!inRange && !noDates && !a.forceAvailable) return false;

    // Hide 100% complete
    const tasks = a.tasks || [];
    if (tasks.length > 0) {
      const avg = tasks.reduce((s, t) => s + (t.currentPercentComplete || 0), 0) / tasks.length;
      if (avg >= 100) return false;
    } else if ((a.percentComplete || 0) >= 100) return false;

    return true;
  });

  // When activity is selected, populate task entries with pre-filled percentages
  useEffect(() => {
    if (!selectedActivityId) {
      setSelectedActivity(null);
      setTaskEntries({});
      setActivityEntry({ percentComplete: 0, photos: [], notes: '' });
      return;
    }
    const activity = allActivities.find((a) => a.id === selectedActivityId);
    if (activity) {
      setSelectedActivity(activity);

      if (tasksEnabled) {
        const entries = {};
        const incompleteTasks = (activity.tasks || []).filter(t => (t.currentPercentComplete || 0) < 100);
        incompleteTasks.forEach((task) => {
          const prefillPct = lastUpdates[`task_${task.id}`];
          entries[task.id] = {
            percentComplete: prefillPct !== undefined ? prefillPct : (task.currentPercentComplete ?? 0),
            photos: [],
            notes: '',
          };
        });
        setTaskEntries(entries);
      } else {
        // Activity-level entry
        const prefillPct = lastUpdates[`activity_${activity.id}`];
        setActivityEntry({
          percentComplete: prefillPct !== undefined ? prefillPct : (activity.percentComplete ?? 0),
          photos: [],
          notes: '',
        });
      }
    }
  }, [selectedActivityId, tasksEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateTaskEntry(taskId, field, value) {
    setTaskEntries((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], [field]: value },
    }));
  }

  function handlePhotoAdd(taskId, files) {
    if (!files || files.length === 0) return;
    if (taskId === '__activity__') {
      setActivityEntry(prev => ({
        ...prev,
        photos: [...prev.photos, ...Array.from(files)].slice(0, 3),
      }));
    } else {
      setTaskEntries((prev) => {
        const existing = prev[taskId]?.photos || [];
        return { ...prev, [taskId]: { ...prev[taskId], photos: [...existing, ...Array.from(files)].slice(0, 3) } };
      });
    }
  }

  function handlePhotoRemove(taskId, index) {
    if (taskId === '__activity__') {
      setActivityEntry(prev => {
        const photos = [...prev.photos];
        photos.splice(index, 1);
        return { ...prev, photos };
      });
    } else {
      setTaskEntries((prev) => {
        const photos = [...(prev[taskId]?.photos || [])];
        photos.splice(index, 1);
        return { ...prev, [taskId]: { ...prev[taskId], photos } };
      });
    }
  }

  /** Toggle forceAvailable on an activity (foreman+ only) */
  async function toggleForceAvailable(activityId, currentValue) {
    try {
      await api.put(`/api/activities/${activityId}/force-available`, { forceAvailable: !currentValue });
      // Refresh job to get updated data
      const data = await api.get(`/api/jobs/${selectedJobId}`);
      setJob(data);
    } catch (err) {
      setError(err.message || 'Failed to toggle availability');
    }
  }

  async function handleSubmit() {
    if (!selectedJobId || !selectedActivityId) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (tasksEnabled) {
        // Task-level submission
        const activity = selectedActivity;
        const tasks = (activity?.tasks || []).filter(t => (t.currentPercentComplete || 0) < 100);
        const entriesToSubmit = tasks.filter((task) => {
          const entry = taskEntries[task.id];
          if (!entry) return false;
          const currentPct = task.currentPercentComplete ?? 0;
          return entry.percentComplete !== currentPct || entry.photos.length > 0 || entry.notes.trim() !== '';
        });

        if (entriesToSubmit.length === 0) {
          setError('No changes to submit. Update at least one task.');
          setSubmitting(false);
          return;
        }

        for (const task of entriesToSubmit) {
          const entry = taskEntries[task.id];
          const formData = new FormData();
          formData.append('jobId', selectedJobId);
          formData.append('activityId', selectedActivityId);
          formData.append('taskId', task.id);
          formData.append('date', todayISO);
          formData.append('percentComplete', entry.percentComplete);
          formData.append('notes', entry.notes);
          entry.photos.forEach((photo) => formData.append('photos', photo));
          await api.upload('/api/daily-updates', formData);
        }

        setSuccess(`Submitted updates for ${entriesToSubmit.length} task${entriesToSubmit.length > 1 ? 's' : ''}.`);
      } else {
        // Activity-level submission
        const currentPct = selectedActivity?.percentComplete ?? 0;
        if (activityEntry.percentComplete === currentPct && activityEntry.photos.length === 0 && activityEntry.notes.trim() === '') {
          setError('No changes to submit.');
          setSubmitting(false);
          return;
        }

        const formData = new FormData();
        formData.append('activityId', selectedActivityId);
        formData.append('percentComplete', activityEntry.percentComplete);
        formData.append('notes', activityEntry.notes);
        activityEntry.photos.forEach((photo) => formData.append('photos', photo));
        await api.upload('/api/daily-updates/activity', formData);

        setSuccess('Activity update submitted successfully.');
      }

      setSelectedActivityId('');
      setSelectedActivity(null);
      setTaskEntries({});
      setActivityEntry({ percentComplete: 0, photos: [], notes: '' });
    } catch (err) {
      setError(err.message || 'Failed to submit daily updates');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Render ---

  if (loadingJobs) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Daily Production Entry</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading jobs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-fade-in">
      {/* Header with date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Daily Production Entry</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>
          <Calendar size={20} />
          {today}
        </div>
      </div>

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

      {/* Step 1: Select Job */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              1. Select Job
            </label>
            {jobs.length === 0 ? (
              <p className="text-light">No jobs assigned to you this week.</p>
            ) : (
              <div style={{ position: 'relative' }}>
                <select
                  className="form-input"
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  style={{ fontSize: '1.1rem', padding: '14px 16px', appearance: 'none' }}
                >
                  <option value="">-- Choose a Job --</option>
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
            )}
          </div>
        </div>
      </div>

      {/* Loading job detail */}
      {loadingJob && (
        <div className="card" style={{ textAlign: 'center', padding: 32, marginBottom: 16 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 8 }}>Loading job details...</p>
        </div>
      )}

      {/* Step 2: Select Activity */}
      {job && !loadingJob && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label className="form-label" style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
                  2. Select Activity
                </label>
                {isManager && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowAllActivities(!showAllActivities)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}
                  >
                    {showAllActivities ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showAllActivities ? 'Show Scheduled' : 'Show All'}
                  </button>
                )}
              </div>
              {!tasksEnabled && (
                <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                  Task tracking is disabled for this job. Progress is reported at the activity level.
                </p>
              )}
              {filteredActivities.length === 0 ? (
                <p className="text-light">
                  {showAllActivities
                    ? 'No activities found for this job.'
                    : 'No activities scheduled this week. '
                  }
                  {!showAllActivities && isManager && (
                    <button className="btn btn-link" onClick={() => setShowAllActivities(true)} style={{ padding: 0, fontSize: '0.875rem' }}>
                      Show all activities
                    </button>
                  )}
                </p>
              ) : (
                <>
                  <div style={{ position: 'relative' }}>
                    <select
                      className="form-input"
                      value={selectedActivityId}
                      onChange={(e) => setSelectedActivityId(e.target.value)}
                      style={{ fontSize: '1.1rem', padding: '14px 16px', appearance: 'none' }}
                    >
                      <option value="">-- Choose an Activity --</option>
                      {filteredActivities.map((a) => {
                        const pct = getActivityPercent(a);
                        return (
                          <option key={a.id} value={a.id}>
                            {a.scopeName} › {a.name} ({Math.round(pct)}%){a.forceAvailable ? ' ★' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown
                      size={20}
                      style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-light)' }}
                    />
                  </div>
                  {/* Foreman: force-available toggle for selected activity */}
                  {isManager && selectedActivityId && (() => {
                    const act = allActivities.find(a => a.id === selectedActivityId);
                    if (!act) return null;
                    return (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => toggleForceAvailable(act.id, act.forceAvailable)}
                        style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}
                      >
                        {act.forceAvailable ? <Lock size={14} /> : <Unlock size={14} />}
                        {act.forceAvailable ? 'Remove from always available' : 'Make always available for workers'}
                      </button>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Task Entries (when tasks enabled) */}
      {selectedActivity && tasksEnabled && (() => {
        const incompleteTasks = (selectedActivity.tasks || []).filter(t => (t.currentPercentComplete || 0) < 100);
        if (incompleteTasks.length === 0) {
          return (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
                <CheckCircle size={32} style={{ color: 'var(--success)', marginBottom: 8 }} />
                <p className="text-light">All tasks in this activity are 100% complete.</p>
              </div>
            </div>
          );
        }
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h2 style={{ fontSize: '1.1rem' }}>3. Update Tasks</h2>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {incompleteTasks.map((task) => (
                <TaskEntryCard
                  key={task.id}
                  task={task}
                  entry={taskEntries[task.id] || { percentComplete: 0, photos: [], notes: '' }}
                  onUpdate={(field, value) => updateTaskEntry(task.id, field, value)}
                  onPhotoAdd={(files) => handlePhotoAdd(task.id, files)}
                  onPhotoRemove={(index) => handlePhotoRemove(task.id, index)}
                />
              ))}
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
              <button
                className="btn btn-success"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ width: '100%', padding: '16px', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {submitting ? (<><Loader size={20} className="spinning" /> Submitting...</>) : (<><Send size={20} /> Submit Daily Update</>)}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Step 3: Activity Entry (when tasks disabled) */}
      {selectedActivity && !tasksEnabled && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h2 style={{ fontSize: '1.1rem' }}>3. Update Activity Progress</h2>
          </div>
          <div className="card-body">
            <ActivityEntryCard
              activity={selectedActivity}
              entry={activityEntry}
              onUpdate={(field, value) => setActivityEntry(prev => ({ ...prev, [field]: value }))}
              onPhotoAdd={(files) => handlePhotoAdd('__activity__', files)}
              onPhotoRemove={(index) => handlePhotoRemove('__activity__', index)}
            />
          </div>
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
            <button
              className="btn btn-success"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ width: '100%', padding: '16px', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {submitting ? (<><Loader size={20} className="spinning" /> Submitting...</>) : (<><Send size={20} /> Submit Activity Update</>)}
            </button>
          </div>
        </div>
      )}

      {/* Today's Submissions */}
      <div className="card">
        <div className="card-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={20} />
            Today&apos;s Submissions
          </h2>
        </div>
        {loadingSubmissions ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 24 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : todaysSubmissions.length === 0 ? (
          <div className="card-body">
            <p className="text-light">No submissions yet today.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
            {todaysSubmissions.map((sub, idx) => {
              const isRejected = sub.status === 'rejected';
              const isApproved = sub.status === 'approved';
              const statusClass = isRejected ? 'badge-danger' : isApproved ? 'badge-success' : 'badge-warning';
              const label = sub.updateType === 'activity'
                ? (sub.activityName || 'Activity')
                : (sub.taskName || sub.task?.name || '--');
              return (
                <div
                  key={sub._id || sub.id || idx}
                  style={{
                    padding: 12,
                    border: `1px solid ${isRejected ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: isRejected ? 'var(--danger-light)' : 'var(--card-bg)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      {sub.updateType === 'activity' && (
                        <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: '0.7rem' }}>Activity</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="badge badge-success">{sub.percentComplete ?? 0}%</span>
                      {(sub.photos?.length || 0) > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', color: 'var(--text-light)' }}>
                          <Image size={14} /> {sub.photos.length}
                        </span>
                      )}
                      <span className={`badge ${statusClass}`}>{sub.status || 'pending'}</span>
                    </div>
                  </div>
                  {sub.notes && (
                    <p className="text-light" style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>{sub.notes}</p>
                  )}
                  {isRejected && sub.rejectionNote && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff', borderRadius: 'var(--radius-xs)', border: '1px solid var(--danger)', fontSize: '0.8125rem' }}>
                      <strong>Rejection reason:</strong> {sub.rejectionNote}
                      {sub.rejectorName && <span className="text-light"> — {sub.rejectorName}</span>}
                    </div>
                  )}
                  {isRejected && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setSelectedJobId(sub.jobId);
                        setTimeout(() => {
                          const actId = sub.activityId || '';
                          if (actId) setSelectedActivityId(actId);
                        }, 500);
                      }}
                    >
                      <Send size={14} /> Resubmit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function getActivityPercent(a) {
  const tasks = a.tasks || [];
  if (tasks.length > 0) {
    return tasks.reduce((s, t) => s + (t.currentPercentComplete || 0), 0) / tasks.length;
  }
  return a.percentComplete || 0;
}

// ── Sub-components ──────────────────────────────────────────────────────────

/**
 * TaskEntryCard - Individual task update card within the daily entry form.
 * @component
 */
function TaskEntryCard({ task, entry, onUpdate, onPhotoAdd, onPhotoRemove }) {
  const fileInputRef = useRef(null);
  const currentPct = task.currentPercentComplete ?? 0;
  const pctChanged = entry.percentComplete !== currentPct;
  const progressClass = getProgressClass(entry.percentComplete);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--bg-secondary, #fafafa)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{task.name}</h3>
          {task.estimatedQuantity > 0 && (
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{task.estimatedQuantity} {task.unit}</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>Current:</span>{' '}
          <span className="badge badge-neutral" style={{ fontSize: '0.85rem' }}>{Math.round(currentPct)}%</span>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>New % Complete</span>
          <span style={{ fontWeight: 700, fontSize: '1.25rem', color: pctChanged ? 'var(--primary)' : undefined }}>{entry.percentComplete}%</span>
        </label>
        <input type="range" min="0" max="100" step="5" value={entry.percentComplete}
          onChange={(e) => onUpdate('percentComplete', parseInt(e.target.value, 10))}
          style={{ width: '100%', height: 40, cursor: 'pointer', accentColor: 'var(--primary)' }} />
        <div className="progress-bar" style={{ height: 8, marginTop: 4 }}>
          <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${entry.percentComplete}%` }} />
        </div>
      </div>
      <PhotoUpload entry={entry} onPhotoAdd={onPhotoAdd} onPhotoRemove={onPhotoRemove} fileInputRef={fileInputRef} />
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={14} /> Notes</label>
        <textarea className="form-input" value={entry.notes} onChange={(e) => onUpdate('notes', e.target.value)}
          placeholder="Add notes about progress, issues, etc." rows={2}
          style={{ fontSize: '1rem', padding: '12px', resize: 'vertical' }} />
      </div>
    </div>
  );
}

/**
 * ActivityEntryCard - Activity-level update card (when tasks disabled).
 * @component
 */
function ActivityEntryCard({ activity, entry, onUpdate, onPhotoAdd, onPhotoRemove }) {
  const fileInputRef = useRef(null);
  const currentPct = activity.percentComplete ?? 0;
  const pctChanged = entry.percentComplete !== currentPct;
  const progressClass = getProgressClass(entry.percentComplete);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--bg-secondary, #fafafa)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{activity.name}</h3>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>{activity.scopeName}</span>
          {activity.estimatedHours > 0 && (
            <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>{activity.estimatedHours}h estimated</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>Current:</span>{' '}
          <span className="badge badge-neutral" style={{ fontSize: '0.85rem' }}>{Math.round(currentPct)}%</span>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>New % Complete</span>
          <span style={{ fontWeight: 700, fontSize: '1.25rem', color: pctChanged ? 'var(--primary)' : undefined }}>{entry.percentComplete}%</span>
        </label>
        <input type="range" min="0" max="100" step="5" value={entry.percentComplete}
          onChange={(e) => onUpdate('percentComplete', parseInt(e.target.value, 10))}
          style={{ width: '100%', height: 40, cursor: 'pointer', accentColor: 'var(--primary)' }} />
        <div className="progress-bar" style={{ height: 8, marginTop: 4 }}>
          <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${entry.percentComplete}%` }} />
        </div>
      </div>
      <PhotoUpload entry={entry} onPhotoAdd={onPhotoAdd} onPhotoRemove={onPhotoRemove} fileInputRef={fileInputRef} />
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={14} /> Notes</label>
        <textarea className="form-input" value={entry.notes} onChange={(e) => onUpdate('notes', e.target.value)}
          placeholder="Add notes about progress, issues, etc." rows={2}
          style={{ fontSize: '1rem', padding: '12px', resize: 'vertical' }} />
      </div>
    </div>
  );
}

/** Shared photo upload UI used by both TaskEntryCard and ActivityEntryCard */
function PhotoUpload({ entry, onPhotoAdd, onPhotoRemove, fileInputRef }) {
  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <label className="form-label">Photos ({entry.photos.length}/3)</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {entry.photos.map((photo, idx) => (
          <div key={idx} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <img src={URL.createObjectURL(photo)} alt={`Upload ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button onClick={() => onPhotoRemove(idx)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
              <X size={12} />
            </button>
          </div>
        ))}
        {entry.photos.length < 3 && (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            style={{ width: 72, height: 72, borderRadius: 8, border: '2px dashed var(--border)', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--text-light)', fontSize: '0.7rem' }}>
            <Camera size={24} /> Add
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple
          onChange={(e) => { onPhotoAdd(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
