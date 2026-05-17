/**
 * @file Job detail page — the most complex page in the application.
 * Displays full job metadata with job type badge + property spec badges,
 * 3-tier WBS hierarchy (Scope -> Activity -> Task) with collapsible tree,
 * team management (worker assignments), photo progress journal (grouped by
 * date with task filtering), and a link to the Gantt schedule view.
 * Supports CRUD modals for all WBS levels, archive confirmation with cascade
 * impact preview, and template application with budget validation.
 * Fetches from /api/jobs/:id, /api/scopes, /api/activities, /api/tasks, /api/users.
 * Uses shared utilities from utils/formatting.js for labels, badges, currency, and progress.
 * @module client/pages/JobDetail
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Archive,
  Plus,
  ChevronDown,
  ChevronRight,
  Layers,
  Activity,
  CheckSquare,
  Clock,
  DollarSign,
  Calendar,
  Users,
  Camera,
  Trash2,
  X,
  MapPin,
  User,
  GanttChart,
  Image,
  UserPlus,
  UserMinus,
  FileText,
  Search,
  AlertTriangle,
  Check,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { usePageTitle, useToast } from '../App';
import { JOB_TYPE_LABELS, getStatusBadge, formatStatus, formatCurrency, getProgressClass } from '../utils/formatting';

/**
 * JobDetail - Comprehensive job view with 4 tabs: Overview, Schedule, Team, Photos.
 * The Overview tab renders the full WBS tree with expand/collapse and inline CRUD.
 * Stats row shows: % complete, days remaining, labor hours, budget.
 * @component
 * @returns {JSX.Element} Full job detail page with tabs and modals
 */
export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useApi();
  const { user } = useAuth();

  const { showToast } = useToast();
  const [job, setJob] = useState(null);
  usePageTitle(job?.name);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const validTabs = ['overview', 'team', 'photos'];
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTabState] = useState(validTabs.includes(tabFromUrl) ? tabFromUrl : 'overview');
  const setActiveTab = (tab) => { setActiveTabState(tab); setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true }); };

  // Modal states
  const [editJobModal, setEditJobModal] = useState(false);
  const [scopeModal, setScopeModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', scope }
  const [activityModal, setActivityModal] = useState(null); // null | { mode: 'create', scopeId } | { mode: 'edit', activity }
  const [taskModal, setTaskModal] = useState(null); // null | { mode: 'create', activityId } | { mode: 'edit', task }
  const [taskDetailModal, setTaskDetailModal] = useState(null); // task object or null
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, id, name }
  const [archiveConfirm, setArchiveConfirm] = useState(null); // null or cascade-info object
  // removeWorkerConfirm state moved into TeamTab component

  // Template flow states
  const [templateSelectModal, setTemplateSelectModal] = useState(false);
  const [templatePreviewModal, setTemplatePreviewModal] = useState(null); // { template, adjustedScopes }

  // Tree expand state
  const [expandedScopes, setExpandedScopes] = useState({});
  const [expandedActivities, setExpandedActivities] = useState({});

  // Health alerts
  const [jobAlerts, setJobAlerts] = useState(null);

  // Foremen/users
  const [allUsers, setAllUsers] = useState([]);

  const fetchJob = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/api/jobs/${id}`);
      setJob(data);
      // Auto-expand all scopes on first load
      if (data.scopes) {
        const expanded = {};
        data.scopes.forEach((s) => { expanded[s.id] = true; });
        setExpandedScopes((prev) => {
          const hasKeys = Object.keys(prev).length > 0;
          return hasKeys ? prev : expanded;
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    async function loadAlerts() {
      try {
        const data = await api.get(`/api/jobs/${id}/alerts`);
        setJobAlerts(data);
      } catch {
        // non-critical
      }
    }
    if (id) loadAlerts();
  }, [api, id, job]); // re-fetch when job data changes

  useEffect(() => {
    async function loadUsers() {
      try {
        const data = await api.get('/api/users');
        setAllUsers(Array.isArray(data) ? data : []);
      } catch {
        // non-critical
      }
    }
    loadUsers();
  }, [api]);

  const toggleScope = (scopeId) => {
    setExpandedScopes((prev) => ({ ...prev, [scopeId]: !prev[scopeId] }));
  };

  const toggleActivity = (activityId) => {
    setExpandedActivities((prev) => ({ ...prev, [activityId]: !prev[activityId] }));
  };

  /**
   * Fetches cascade impact info and opens the archive confirmation modal
   * instead of archiving immediately.
   */
  const handleArchive = async () => {
    try {
      const info = await api.get(`/api/jobs/${id}/cascade-info`);
      setArchiveConfirm(info);
    } catch (err) {
      showToast(err.message || 'Failed to load job info', 'error');
    }
  };

  /** Performs the actual archive after user confirms in the cascade preview modal. */
  const confirmArchive = async () => {
    try {
      await api.put(`/api/jobs/${id}/archive`);
      setArchiveConfirm(null);
      fetchJob();
      showToast('Job archived');
    } catch (err) {
      showToast(err.message || 'Failed to archive job', 'error');
    }
  };

  const handleUpdateProgress = async (taskId, percent) => {
    try {
      await api.put(`/api/tasks/${taskId}`, { currentPercentComplete: percent });
      fetchJob();
      showToast(`Progress updated to ${percent}%`);
    } catch (err) {
      showToast(err.message || 'Failed to update progress', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const { type, id: itemId, name: itemName } = deleteConfirm;
      if (type === 'scope') await api.del(`/api/scopes/${itemId}`);
      else if (type === 'activity') await api.del(`/api/activities/${itemId}`);
      else if (type === 'task') await api.del(`/api/tasks/${itemId}`);
      setDeleteConfirm(null);
      fetchJob();
      showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} "${itemName}" deleted`);
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  };

  if (loading) {
    return (
      <div className="page-fade-in">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading job...</p>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="page-fade-in">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="text-danger" style={{ fontWeight: 600 }}>{error || 'Job not found'}</p>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/jobs')}>
            Back to Jobs
          </button>
        </div>
      </div>
    );
  }

  const foremen = allUsers.filter((u) => u.role === 'foreman' || u.role === 'project_manager');
  const foremanName = job.foremanId ? (allUsers.find((u) => u.id === job.foremanId)?.name || '--') : '--';
  const pct = job.overallPercentComplete ?? 0;
  const progressClass = getProgressClass(pct);

  // Calculate stats
  const daysRemaining = job.endDate
    ? Math.max(0, Math.ceil((new Date(job.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : null;

  let totalEstimatedHours = 0;
  let totalActualHours = 0;
  if (job.scopes) {
    job.scopes.forEach((s) => {
      (s.activities || []).forEach((a) => {
        totalEstimatedHours += a.estimatedHours || 0;
        totalActualHours += a.actualHours || 0;
      });
    });
  }

  const isAdmin = user?.role === 'admin';
  const isPM = user?.role === 'project_manager';
  const canManageTemplates = isAdmin || isPM;

  return (
    <div className="page-fade-in">
      {/* Back nav */}
      <Link to="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.875rem', marginBottom: 16, color: 'var(--text-light)' }}>
        <ArrowLeft size={16} /> Back to Jobs
      </Link>

      {/* Header */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{job.name}</h1>
              <span className={`badge ${getStatusBadge(job.status)}`}>{formatStatus(job.status)}</span>
            </div>
            {job.address && (
              <p className="text-light" style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <MapPin size={14} /> {job.address}
              </p>
            )}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.875rem', color: 'var(--text-light)' }}>
              {job.customerName && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={14} /> {job.customerName}
                  {job.customerContact && ` (${job.customerContact})`}
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Users size={14} /> Foreman: {foremanName}
              </span>
            </div>
            {/* Job type + property specs */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {job.jobType && (
                <span className="badge badge-primary" style={{ fontSize: '0.75rem' }}>
                  {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                </span>
              )}
              {job.squareFootage > 0 && (
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {Number(job.squareFootage).toLocaleString()} sqft
                </span>
              )}
              {job.bedrooms > 0 && (
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {job.bedrooms} bed
                </span>
              )}
              {job.bathrooms > 0 && (
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {job.bathrooms} bath
                </span>
              )}
              {job.stories > 0 && (
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {job.stories} story
                </span>
              )}
              {job.garageType && job.garageType !== 'none' && (
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {job.garageType} garage
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditJobModal(true)}>
              <Edit2 size={14} /> Edit
            </button>
            {isAdmin && job.status !== 'archived' && (
              <button className="btn btn-danger btn-sm" onClick={handleArchive}>
                <Archive size={14} /> Archive
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Overall Progress</span>
            <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>{Math.round(pct)}%</span>
          </div>
          <div className="progress-bar" style={{ height: 10 }}>
            <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid-4" style={{ marginTop: 16 }}>
          <div className="stat-card" style={{ padding: '12px 16px' }}>
            <div className="stat-card-icon bg-primary" style={{ width: 32, height: 32 }}>
              <CheckSquare size={16} />
            </div>
            <div className="stat-card-value" style={{ fontSize: '1.125rem' }}>{Math.round(pct)}%</div>
            <div className="stat-card-label">Complete</div>
          </div>
          <div className="stat-card" style={{ padding: '12px 16px' }}>
            <div className="stat-card-icon bg-warning" style={{ width: 32, height: 32 }}>
              <Calendar size={16} />
            </div>
            <div className="stat-card-value" style={{ fontSize: '1.125rem' }}>{daysRemaining != null ? daysRemaining : '--'}</div>
            <div className="stat-card-label">Days Remaining</div>
          </div>
          <div className="stat-card" style={{ padding: '12px 16px' }}>
            <div className="stat-card-icon bg-success" style={{ width: 32, height: 32 }}>
              <Clock size={16} />
            </div>
            <div className="stat-card-value" style={{ fontSize: '1.125rem' }}>{totalActualHours}/{totalEstimatedHours}h</div>
            <div className="stat-card-label">Labor Hours</div>
          </div>
          <div className="stat-card" style={{ padding: '12px 16px' }}>
            <div className="stat-card-icon bg-primary" style={{ width: 32, height: 32 }}>
              <DollarSign size={16} />
            </div>
            <div className="stat-card-value" style={{ fontSize: '1.125rem' }}>{formatCurrency(job.budget)}</div>
            <div className="stat-card-label">Budget</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {['overview', 'schedule', 'team', 'photos'].map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => {
              if (tab === 'schedule') {
                navigate(`/jobs/${id}/gantt`);
              } else {
                setActiveTab(tab);
              }
            }}
          >
            {tab === 'overview' && <><Layers size={14} style={{ marginRight: 6 }} />Overview</>}
            {tab === 'schedule' && <><GanttChart size={14} style={{ marginRight: 6 }} />Schedule</>}
            {tab === 'team' && <><Users size={14} style={{ marginRight: 6 }} />Team</>}
            {tab === 'photos' && <><Camera size={14} style={{ marginRight: 6 }} />Photos</>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          job={job}
          jobAlerts={jobAlerts}
          expandedScopes={expandedScopes}
          expandedActivities={expandedActivities}
          toggleScope={toggleScope}
          toggleActivity={toggleActivity}
          onAddScope={() => setScopeModal({ mode: 'create' })}
          onEditScope={(scope) => setScopeModal({ mode: 'edit', scope })}
          onDeleteScope={(scope) => setDeleteConfirm({ type: 'scope', id: scope.id, name: scope.name })}
          onAddActivity={(scopeId) => setActivityModal({ mode: 'create', scopeId })}
          onEditActivity={(activity) => setActivityModal({ mode: 'edit', activity })}
          onDeleteActivity={(activity) => setDeleteConfirm({ type: 'activity', id: activity.id, name: activity.name })}
          onAddTask={(activityId) => setTaskModal({ mode: 'create', activityId })}
          onEditTask={(task) => setTaskModal({ mode: 'edit', task })}
          onDeleteTask={(task) => setDeleteConfirm({ type: 'task', id: task.id, name: task.name })}
          onViewTask={(task) => setTaskDetailModal(task)}
          onUpdateProgress={['foreman', 'admin'].includes(user?.role) ? handleUpdateProgress : null}
          canManageTemplates={canManageTemplates}
          onUseTemplate={() => setTemplateSelectModal(true)}
          api={api}
          userRole={user?.role}
        />
      )}

      {activeTab === 'team' && (
        <TeamTab job={job} allUsers={allUsers} api={api} onRefresh={fetchJob} />
      )}

      {activeTab === 'photos' && (
        <PhotosTab job={job} api={api} />
      )}

      {/* ─── Modals ─── */}

      {/* Edit Job Modal */}
      {editJobModal && (
        <EditJobModal
          job={job}
          foremen={foremen}
          onClose={() => setEditJobModal(false)}
          onSaved={() => { setEditJobModal(false); fetchJob(); showToast('Job updated'); }}
        />
      )}

      {/* Scope Modal */}
      {scopeModal && (
        <ScopeModal
          mode={scopeModal.mode}
          scope={scopeModal.scope}
          jobId={id}
          onClose={() => setScopeModal(null)}
          onSaved={() => { setScopeModal(null); fetchJob(); showToast(scopeModal.mode === 'create' ? 'Scope created' : 'Scope updated'); }}
        />
      )}

      {/* Activity Modal */}
      {activityModal && (
        <ActivityModal
          mode={activityModal.mode}
          activity={activityModal.activity}
          scopeId={activityModal.scopeId}
          onClose={() => setActivityModal(null)}
          onSaved={() => { setActivityModal(null); fetchJob(); showToast(activityModal.mode === 'create' ? 'Activity created' : 'Activity updated'); }}
        />
      )}

      {/* Task Modal */}
      {taskModal && (
        <TaskModal
          mode={taskModal.mode}
          task={taskModal.task}
          activityId={taskModal.activityId}
          onClose={() => setTaskModal(null)}
          onSaved={() => { setTaskModal(null); fetchJob(); showToast(taskModal.mode === 'create' ? 'Task created' : 'Task updated'); }}
        />
      )}

      {/* Task Detail Modal */}
      {taskDetailModal && (
        <TaskDetailModal
          task={taskDetailModal}
          api={api}
          onClose={() => setTaskDetailModal(null)}
          onEdit={(task) => { setTaskDetailModal(null); setTaskModal({ mode: 'edit', task }); }}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Confirm Delete</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
                {deleteConfirm.type === 'scope' && ' This will delete all activities and tasks within this scope.'}
                {deleteConfirm.type === 'activity' && ' This will delete all tasks within this activity.'}
              </p>
              <p className="text-danger" style={{ marginTop: 8, fontSize: '0.875rem' }}>This action cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Confirmation Modal */}
      {archiveConfirm && (
        <div className="modal-overlay" onClick={() => setArchiveConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <div className="modal-header">
              <h2>Archive Job</h2>
              <button className="modal-close" onClick={() => setArchiveConfirm(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 12 }}>
                Are you sure you want to archive <strong>{job.name}</strong>? This job and all its data will be marked as archived.
              </p>
              {(archiveConfirm.scopes > 0 || archiveConfirm.tasks > 0 || archiveConfirm.timesheets > 0) && (
                <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 12 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 8 }}>This job contains:</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.8125rem' }}>
                    {archiveConfirm.scopes > 0 && <span>{archiveConfirm.scopes} scope{archiveConfirm.scopes !== 1 ? 's' : ''}</span>}
                    {archiveConfirm.activities > 0 && <span>{archiveConfirm.activities} activit{archiveConfirm.activities !== 1 ? 'ies' : 'y'}</span>}
                    {archiveConfirm.tasks > 0 && <span>{archiveConfirm.tasks} task{archiveConfirm.tasks !== 1 ? 's' : ''}</span>}
                    {archiveConfirm.dailyUpdates > 0 && <span>{archiveConfirm.dailyUpdates} daily update{archiveConfirm.dailyUpdates !== 1 ? 's' : ''}</span>}
                    {archiveConfirm.timesheets > 0 && <span>{archiveConfirm.timesheets} timesheet{archiveConfirm.timesheets !== 1 ? 's' : ''}</span>}
                    {archiveConfirm.photos > 0 && <span>{archiveConfirm.photos} photo{archiveConfirm.photos !== 1 ? 's' : ''}</span>}
                    {archiveConfirm.workerAssignments > 0 && <span>{archiveConfirm.workerAssignments} worker assignment{archiveConfirm.workerAssignments !== 1 ? 's' : ''}</span>}
                  </div>
                </div>
              )}
              {archiveConfirm.pendingUpdates > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: '0.8125rem' }}>
                  <AlertTriangle size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {archiveConfirm.pendingUpdates} pending update{archiveConfirm.pendingUpdates !== 1 ? 's' : ''} will remain unreviewed.
                </div>
              )}
              <p className="text-light" style={{ fontSize: '0.8125rem' }}>
                Archived jobs are hidden from active views but all data is preserved.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setArchiveConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmArchive}>
                <Archive size={14} /> Archive Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Select Modal */}
      {templateSelectModal && (
        <TemplateSelectModal
          api={api}
          onClose={() => setTemplateSelectModal(false)}
          onSelect={async (template) => {
            setTemplateSelectModal(false);
            try {
              const full = await api.get(`/api/templates/${template.id}`);
              const adjustedScopes = (full.scopes || []).map((s) => ({
                templateScopeId: s.id,
                name: s.name,
                description: s.description,
                estimatedValue: s.estimatedValue || 0,
                activities: (s.activities || []).map((a) => ({
                  templateActivityId: a.id,
                  name: a.name,
                  estimatedHours: a.estimatedHours || 0,
                })),
              }));
              setTemplatePreviewModal({ template: full, adjustedScopes });
            } catch (err) {
              alert(err.message || 'Failed to load template');
            }
          }}
        />
      )}

      {/* Template Preview & Budget Validation Modal */}
      {templatePreviewModal && (
        <TemplatePreviewModal
          template={templatePreviewModal.template}
          adjustedScopes={templatePreviewModal.adjustedScopes}
          jobBudget={job.budget || 0}
          jobSpecs={{ squareFootage: job.squareFootage, bedrooms: job.bedrooms, bathrooms: job.bathrooms, stories: job.stories, garageType: job.garageType }}
          jobId={id}
          api={api}
          onUpdateScopes={(newScopes) => setTemplatePreviewModal({ ...templatePreviewModal, adjustedScopes: newScopes })}
          onClose={() => setTemplatePreviewModal(null)}
          onApplied={() => { setTemplatePreviewModal(null); fetchJob(); }}
        />
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   OVERVIEW TAB - Tree View
   ═══════════════════════════════════════════════════════════════ */
function OverviewTab({
  job, jobAlerts, expandedScopes, expandedActivities,
  toggleScope, toggleActivity,
  onAddScope, onEditScope, onDeleteScope,
  onAddActivity, onEditActivity, onDeleteActivity,
  onAddTask, onEditTask, onDeleteTask, onViewTask,
  canManageTemplates, onUseTemplate, onUpdateProgress,
  api, userRole,
}) {
  const canEditSettings = ['foreman', 'project_manager', 'admin'].includes(userRole);
  const [jobTasksEnabled, setJobTasksEnabled] = useState(undefined); // undefined = using app default
  const [savingTaskSetting, setSavingTaskSetting] = useState(false);
  const { showToast } = useToast();

  // Load per-job tasks_enabled setting
  useEffect(() => {
    if (!api || !job?.id) return;
    let cancelled = false;
    async function loadJobSetting() {
      try {
        const settings = await api.get(`/api/settings/jobs/${job.id}`);
        if (!cancelled) {
          if (settings?.tasks_enabled !== undefined) {
            const val = typeof settings.tasks_enabled === 'string' ? JSON.parse(settings.tasks_enabled) : settings.tasks_enabled;
            setJobTasksEnabled(val);
          } else {
            setJobTasksEnabled(undefined);
          }
        }
      } catch {
        if (!cancelled) setJobTasksEnabled(undefined);
      }
    }
    loadJobSetting();
    return () => { cancelled = true; };
  }, [api, job?.id]);

  async function saveJobTaskSetting(value) {
    setSavingTaskSetting(true);
    try {
      if (value === undefined) {
        // Delete override to revert to app default
        await api.del(`/api/settings/jobs/${job.id}/tasks_enabled`);
        setJobTasksEnabled(undefined);
        showToast('Reverted to app default');
      } else {
        await api.put(`/api/settings/jobs/${job.id}/tasks_enabled`, { value: JSON.stringify(value) });
        setJobTasksEnabled(value);
        showToast(`Task tracking ${value ? 'enabled' : 'disabled'} for this job`);
      }
    } catch (err) {
      showToast(err.message || 'Failed to save setting', 'error');
    } finally {
      setSavingTaskSetting(false);
    }
  }

  const scopes = job.scopes || [];
  const alerts = jobAlerts || {};
  const summary = alerts.summary || {};
  const hasAlerts = summary.total > 0;

  // Build lookup sets for flagging tree items
  const overdueTaskIds = new Set((alerts.overdue || []).map(a => a.id));
  const behindTaskIds = new Set((alerts.behindSchedule || []).map(a => a.id));
  const stalledTaskIds = new Set((alerts.stalled || []).map(a => a.id));
  const overrunScopeIds = new Set((alerts.costOverruns || []).map(a => a.scopeId));

  // Build scope-level alert counts (from tasks)
  const scopeAlertCounts = {};
  for (const item of [...(alerts.overdue || []), ...(alerts.behindSchedule || []), ...(alerts.stalled || [])]) {
    scopeAlertCounts[item.scopeId] = (scopeAlertCounts[item.scopeId] || 0) + 1;
  }

  const taskFlags = { overdueTaskIds, behindTaskIds, stalledTaskIds };

  return (
    <>
      {/* Issues Banner */}
      {hasAlerts && (
        <div className={`issues-banner ${summary.health === 'red' ? 'issues-banner-red' : 'issues-banner-amber'}`}>
          <div className="issues-banner-header">
            <AlertTriangle size={18} />
            <strong>{summary.total} Issue{summary.total !== 1 ? 's' : ''} Detected</strong>
          </div>
          <div className="issues-banner-details">
            {summary.overdue > 0 && (
              <span className="issues-tag issues-tag-danger">
                <Clock size={12} /> {summary.overdue} overdue task{summary.overdue !== 1 ? 's' : ''}
              </span>
            )}
            {summary.behindSchedule > 0 && (
              <span className="issues-tag issues-tag-warning">
                <TrendingUp size={12} /> {summary.behindSchedule} behind schedule
              </span>
            )}
            {summary.costOverruns > 0 && (
              <span className="issues-tag issues-tag-danger">
                <DollarSign size={12} /> {summary.costOverruns} scope{summary.costOverruns !== 1 ? 's' : ''} over budget
              </span>
            )}
            {summary.stalled > 0 && (
              <span className="issues-tag issues-tag-muted">
                <AlertTriangle size={12} /> {summary.stalled} stalled
              </span>
            )}
          </div>
          {/* Detailed list */}
          <div className="issues-detail-list">
            {(alerts.overdue || []).map(a => (
              <div key={'o-' + a.id} className="issues-detail-item issues-detail-danger">
                <Clock size={12} /> <strong>{a.taskName}</strong> <span className="text-muted">({a.scopeName})</span> — overdue since {formatDate(a.scheduledFinishDate)}, {Math.round(a.currentPercentComplete)}% done
              </div>
            ))}
            {(alerts.behindSchedule || []).map(a => (
              <div key={'b-' + a.id} className="issues-detail-item issues-detail-warning">
                <TrendingUp size={12} /> <strong>{a.taskName}</strong> <span className="text-muted">({a.scopeName})</span> — expected {a.expectedPercent}%, actual {Math.round(a.currentPercentComplete)}% ({a.gap}% gap)
              </div>
            ))}
            {(alerts.costOverruns || []).map(a => (
              <div key={'c-' + a.scopeId} className="issues-detail-item issues-detail-danger">
                <DollarSign size={12} /> <strong>{a.scopeName}</strong> — ${a.overrun.toLocaleString()} over budget (+{a.overrunPercent}%)
              </div>
            ))}
            {(alerts.stalled || []).map(a => (
              <div key={'s-' + a.id} className="issues-detail-item issues-detail-muted">
                <AlertTriangle size={12} /> <strong>{a.taskName}</strong> <span className="text-muted">({a.scopeName})</span> — {Math.round(a.currentPercentComplete)}% complete, no update in 7+ days
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-job task tracking setting (foreman+) */}
      {canEditSettings && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckSquare size={16} style={{ color: 'var(--text-light)' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Task Tracking</span>
              <span className={`badge ${jobTasksEnabled === undefined ? 'badge-neutral' : jobTasksEnabled ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.7rem' }}>
                {jobTasksEnabled === undefined ? 'App Default' : jobTasksEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {jobTasksEnabled !== undefined && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => saveJobTaskSetting(undefined)}
                  disabled={savingTaskSetting}
                  style={{ fontSize: '0.75rem' }}
                >
                  Use Default
                </button>
              )}
              <button
                className={`btn btn-sm ${jobTasksEnabled === true ? 'btn-success' : 'btn-secondary'}`}
                onClick={() => saveJobTaskSetting(true)}
                disabled={savingTaskSetting || jobTasksEnabled === true}
                style={{ fontSize: '0.75rem' }}
              >
                Enable
              </button>
              <button
                className={`btn btn-sm ${jobTasksEnabled === false ? 'btn-warning' : 'btn-secondary'}`}
                onClick={() => saveJobTaskSetting(false)}
                disabled={savingTaskSetting || jobTasksEnabled === false}
                style={{ fontSize: '0.75rem' }}
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Work Breakdown Structure</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {canManageTemplates && (
              <button className="btn btn-secondary btn-sm" onClick={onUseTemplate}>
                <FileText size={14} /> Use Template
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={onAddScope}>
              <Plus size={14} /> Scope
            </button>
          </div>
        </div>
        <div className="card-body">
          {scopes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Layers size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ fontWeight: 600, marginBottom: 4 }}>No scopes yet</p>
              <p className="text-light" style={{ marginBottom: 16 }}>Add scopes to start building the work breakdown structure, or apply a template to get started quickly.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={onAddScope}><Plus size={14} /> Add Scope</button>
                {canManageTemplates && <button className="btn btn-secondary" onClick={onUseTemplate}><FileText size={14} /> Use Template</button>}
              </div>
            </div>
          ) : (
            <ul className="tree-view">
              {scopes.map((scope) => (
                <ScopeTreeItem
                  key={scope.id}
                  scope={scope}
                  expanded={!!expandedScopes[scope.id]}
                  expandedActivities={expandedActivities}
                  onToggle={() => toggleScope(scope.id)}
                  onToggleActivity={toggleActivity}
                  onEdit={() => onEditScope(scope)}
                  onDelete={() => onDeleteScope(scope)}
                  onAddActivity={() => onAddActivity(scope.id)}
                  onEditActivity={onEditActivity}
                  onDeleteActivity={onDeleteActivity}
                  onAddTask={onAddTask}
                  onEditTask={onEditTask}
                  onDeleteTask={onDeleteTask}
                  onViewTask={onViewTask}
                  onUpdateProgress={onUpdateProgress}
                  alertCount={scopeAlertCounts[scope.id] || 0}
                  isOverrun={overrunScopeIds.has(scope.id)}
                  taskFlags={taskFlags}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function ScopeTreeItem({
  scope, expanded, expandedActivities,
  onToggle, onToggleActivity,
  onEdit, onDelete, onAddActivity,
  onEditActivity, onDeleteActivity,
  onAddTask, onEditTask, onDeleteTask, onViewTask, onUpdateProgress,
  alertCount, isOverrun, taskFlags,
}) {
  const pct = scope.percentComplete ?? 0;
  const progressClass = getProgressClass(pct);

  return (
    <li>
      <div className={`tree-item ${(alertCount > 0 || isOverrun) ? 'tree-item-flagged' : ''}`} onClick={onToggle}>
        <span className="tree-item-icon">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <Layers size={16} style={{ color: 'var(--primary)' }} />
        <span className="tree-item-label" style={{ fontWeight: 600 }}>
          {scope.name}
        </span>
        {isOverrun && (
          <span className="tree-alert-badge tree-alert-danger" title="Over budget">
            <DollarSign size={10} />
          </span>
        )}
        {alertCount > 0 && (
          <span className="tree-alert-badge tree-alert-warning" title={`${alertCount} task issue${alertCount !== 1 ? 's' : ''}`}>
            <AlertTriangle size={10} /> {alertCount}
          </span>
        )}
        <div className="progress-bar" style={{ width: 80 }}>
          <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${pct}%` }} />
        </div>
        <span style={{ fontSize: '0.75rem', fontWeight: 500, minWidth: 32, textAlign: 'right' }}>{Math.round(pct)}%</span>
        <div className="tree-item-actions">
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onAddActivity(); }} title="Add Activity">
            <Plus size={12} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="tree-view">
          {(scope.activities || []).map((activity) => (
            <ActivityTreeItem
              key={activity.id}
              activity={activity}
              expanded={!!expandedActivities[activity.id]}
              onToggle={() => onToggleActivity(activity.id)}
              onEdit={() => onEditActivity(activity)}
              onDelete={() => onDeleteActivity(activity)}
              onAddTask={() => onAddTask(activity.id)}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onViewTask={onViewTask}
              onUpdateProgress={onUpdateProgress}
              taskFlags={taskFlags}
            />
          ))}
          {(scope.activities || []).length === 0 && (
            <li style={{ padding: '8px 12px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              No activities. Click + to add one.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ActivityTreeItem({
  activity, expanded,
  onToggle, onEdit, onDelete,
  onAddTask, onEditTask, onDeleteTask, onViewTask, onUpdateProgress,
  taskFlags,
}) {
  const pct = activity.percentComplete ?? 0;
  const progressClass = getProgressClass(pct);
  const flags = taskFlags || {};

  // Count flagged tasks in this activity
  const activityAlertCount = (activity.tasks || []).filter(t =>
    flags.overdueTaskIds?.has(t.id) || flags.behindTaskIds?.has(t.id) || flags.stalledTaskIds?.has(t.id)
  ).length;

  return (
    <li>
      <div className={`tree-item ${activityAlertCount > 0 ? 'tree-item-flagged' : ''}`} onClick={onToggle}>
        <span className="tree-item-icon">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <Activity size={16} style={{ color: 'var(--warning)' }} />
        <span className="tree-item-label" style={{ fontWeight: 500 }}>
          {activity.name}
        </span>
        {activityAlertCount > 0 && (
          <span className="tree-alert-badge tree-alert-warning" title={`${activityAlertCount} task issue${activityAlertCount !== 1 ? 's' : ''}`}>
            <AlertTriangle size={10} /> {activityAlertCount}
          </span>
        )}
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {activity.actualHours || 0}/{activity.estimatedHours || 0}h
        </span>
        <div className="progress-bar" style={{ width: 60 }}>
          <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${pct}%` }} />
        </div>
        <span style={{ fontSize: '0.75rem', fontWeight: 500, minWidth: 32, textAlign: 'right' }}>{Math.round(pct)}%</span>
        <div className="tree-item-actions">
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onAddTask(); }} title="Add Task">
            <Plus size={12} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="tree-view">
          {(activity.tasks || []).map((task) => (
            <TaskTreeItem
              key={task.id}
              task={task}
              onView={() => onViewTask(task)}
              onEdit={() => onEditTask(task)}
              onDelete={() => onDeleteTask(task)}
              onUpdateProgress={onUpdateProgress}
              taskFlags={flags}
            />
          ))}
          {(activity.tasks || []).length === 0 && (
            <li style={{ padding: '8px 12px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              No tasks. Click + to add one.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function TaskTreeItem({ task, onView, onEdit, onDelete, onUpdateProgress, taskFlags }) {
  const [editing, setEditing] = useState(false);
  const [editPct, setEditPct] = useState(task.currentPercentComplete ?? 0);
  const pct = task.currentPercentComplete ?? 0;
  const progressClass = getProgressClass(pct);
  const flags = taskFlags || {};
  const isOverdue = flags.overdueTaskIds?.has(task.id);
  const isBehind = flags.behindTaskIds?.has(task.id);
  const isStalled = flags.stalledTaskIds?.has(task.id);
  const hasFlagClass = isOverdue || isBehind || isStalled;

  return (
    <li>
      <div className={`tree-item ${isOverdue ? 'tree-item-overdue' : hasFlagClass ? 'tree-item-flagged' : ''}`} onClick={onView}>
        <CheckSquare size={16} style={{ color: pct >= 100 ? 'var(--success)' : isOverdue ? 'var(--danger)' : 'var(--text-light)' }} />
        <span className="tree-item-label">{task.name}</span>
        {isOverdue && (
          <span className="tree-alert-badge tree-alert-danger" title="Overdue">
            <Clock size={10} />
          </span>
        )}
        {isBehind && !isOverdue && (
          <span className="tree-alert-badge tree-alert-warning" title="Behind schedule">
            <TrendingUp size={10} />
          </span>
        )}
        {isStalled && !isOverdue && !isBehind && (
          <span className="tree-alert-badge tree-alert-muted" title="Stalled — no update in 7+ days">
            <AlertTriangle size={10} />
          </span>
        )}
        {task.scheduledStartDate && (
          <span className="text-muted" style={{ fontSize: '0.7rem' }}>
            {formatDate(task.scheduledStartDate)} - {formatDate(task.scheduledFinishDate)}
          </span>
        )}
        {task.estimatedQuantity > 0 && (
          <span className="text-muted" style={{ fontSize: '0.7rem' }}>
            {task.estimatedQuantity} {task.unit}
          </span>
        )}
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={editPct}
              onChange={(e) => setEditPct(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, minWidth: 32 }}>{editPct}%</span>
            <button className="btn btn-success btn-sm" onClick={() => { onUpdateProgress(task.id, editPct); setEditing(false); }} title="Save">
              <Check size={12} />
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setEditPct(pct); }} title="Cancel">
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <div className="progress-bar" style={{ width: 60 }}>
              <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${pct}%` }} />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, minWidth: 32, textAlign: 'right' }}>{Math.round(pct)}%</span>
          </>
        )}
        <div className="tree-item-actions">
          {onUpdateProgress && !editing && (
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(true); setEditPct(pct); }} title="Update Progress">
              <TrendingUp size={12} />
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </li>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TEAM TAB
   ═══════════════════════════════════════════════════════════════ */
function TeamTab({ job, allUsers, api, onRefresh }) {
  const { showToast } = useToast();
  const [workersByActivity, setWorkersByActivity] = useState({});
  const [loadingActivity, setLoadingActivity] = useState(null);
  const [addWorkerModal, setAddWorkerModal] = useState(null); // activityId or null
  const [removeWorkerConfirm, setRemoveWorkerConfirm] = useState(null); // { activityId, workerId, workerName, activityName } or null

  const activities = [];
  (job.scopes || []).forEach((scope) => {
    (scope.activities || []).forEach((activity) => {
      activities.push({ ...activity, scopeName: scope.name });
    });
  });

  useEffect(() => {
    async function fetchWorkers() {
      const results = {};
      for (const act of activities) {
        try {
          const workers = await api.get(`/api/activities/${act.id}/workers`);
          results[act.id] = Array.isArray(workers) ? workers : [];
        } catch {
          results[act.id] = [];
        }
      }
      setWorkersByActivity(results);
    }
    if (activities.length > 0) fetchWorkers();
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Confirms and removes a worker from an activity after user confirmation.
   * Called when user confirms in the remove worker modal.
   */
  const confirmRemoveWorker = async () => {
    if (!removeWorkerConfirm) return;
    const { activityId, workerId } = removeWorkerConfirm;
    setRemoveWorkerConfirm(null);
    setLoadingActivity(activityId);
    try {
      await api.del(`/api/activities/${activityId}/workers/${workerId}`);
      const workers = await api.get(`/api/activities/${activityId}/workers`);
      setWorkersByActivity((prev) => ({ ...prev, [activityId]: workers }));
      showToast('Worker removed from activity', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to remove worker', 'error');
    } finally {
      setLoadingActivity(null);
    }
  };

  const handleAddWorker = async (activityId, workerId) => {
    setLoadingActivity(activityId);
    try {
      await api.post(`/api/activities/${activityId}/workers`, { workerId });
      const workers = await api.get(`/api/activities/${activityId}/workers`);
      setWorkersByActivity((prev) => ({ ...prev, [activityId]: workers }));
      setAddWorkerModal(null);
      showToast('Worker assigned to activity', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to add worker', 'error');
    } finally {
      setLoadingActivity(null);
    }
  };

  if (activities.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
          <Users size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <p className="text-light">No activities yet. Add scopes and activities first to assign team members.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activities.map((act) => {
          const workers = workersByActivity[act.id] || [];
          const assignedIds = new Set(workers.map((w) => w.id));

          return (
            <div className="card" key={act.id}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{act.name}</h3>
                  <p className="text-muted" style={{ fontSize: '0.8125rem', margin: 0 }}>{act.scopeName}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setAddWorkerModal(act.id)}>
                  <UserPlus size={14} /> Assign
                </button>
              </div>
              <div className="card-body">
                {workers.length === 0 ? (
                  <p className="text-light" style={{ fontSize: '0.875rem' }}>No workers assigned.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {workers.map((w) => (
                      <div
                        key={w.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 12px', background: 'var(--border-light)',
                          borderRadius: 'var(--radius-sm)', fontSize: '0.875rem',
                        }}
                      >
                        <User size={14} />
                        <span style={{ fontWeight: 500 }}>{w.name}</span>
                        <span className={`badge ${getRoleBadge(w.role)}`} style={{ fontSize: '0.7rem' }}>{w.role}</span>
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          style={{ padding: 2 }}
                          onClick={() => setRemoveWorkerConfirm({ activityId: act.id, workerId: w.id, workerName: w.name, activityName: act.name })}
                          disabled={loadingActivity === act.id}
                          title="Remove worker"
                        >
                          <UserMinus size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Worker Modal */}
      {addWorkerModal && (
        <div className="modal-overlay" onClick={() => setAddWorkerModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Assign Worker</h2>
              <button className="modal-close" onClick={() => setAddWorkerModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {(() => {
                const currentWorkers = workersByActivity[addWorkerModal] || [];
                const assignedIds = new Set(currentWorkers.map((w) => w.id));
                const available = allUsers.filter((u) => !assignedIds.has(u.id));
                if (available.length === 0) {
                  return <p className="text-light">All users are already assigned to this activity.</p>;
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {available.map((u) => (
                      <button
                        key={u.id}
                        className="btn btn-secondary"
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                        onClick={() => handleAddWorker(addWorkerModal, u.id)}
                        disabled={loadingActivity === addWorkerModal}
                      >
                        <User size={14} />
                        <span style={{ fontWeight: 500 }}>{u.name}</span>
                        <span className={`badge ${getRoleBadge(u.role)}`} style={{ fontSize: '0.7rem', marginLeft: 'auto' }}>{u.role}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAddWorkerModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Worker Confirmation Modal */}
      {removeWorkerConfirm && (
        <div className="modal-overlay" onClick={() => setRemoveWorkerConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Remove Worker</h2>
              <button className="modal-close" onClick={() => setRemoveWorkerConfirm(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to remove <strong>{removeWorkerConfirm.workerName}</strong> from <strong>{removeWorkerConfirm.activityName}</strong>?
              </p>
              <p className="text-light" style={{ marginTop: 8, fontSize: '0.875rem' }}>
                They will no longer see tasks from this activity in their task list.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRemoveWorkerConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmRemoveWorker}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════
   PHOTOS TAB
   ═══════════════════════════════════════════════════════════════ */
/**
 * PhotosTab - Photo progress journal for a job. Fetches all photos via a single
 * efficient query (GET /api/tasks/job/:jobId/photos), groups them by date (newest first),
 * and provides a task filter dropdown. Each thumbnail shows task name and worker attribution.
 * @component
 * @param {Object} props
 * @param {Object} props.job - Job object with id
 * @param {Object} props.api - API context for making requests
 * @returns {JSX.Element} Photo gallery grouped by date with filter and lightbox
 */
function PhotosTab({ job, api }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [filterTask, setFilterTask] = useState('');

  useEffect(() => {
    async function fetchPhotos() {
      setLoading(true);
      try {
        const data = await api.get(`/api/tasks/job/${job.id}/photos`);
        setPhotos(Array.isArray(data) ? data : []);
      } catch {
        setPhotos([]);
      }
      setLoading(false);
    }
    fetchPhotos();
  }, [job, api]);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p className="text-light" style={{ marginTop: 12 }}>Loading photos...</p>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <Image size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
        <p className="text-light">No photos yet. Photos are added through daily task updates.</p>
      </div>
    );
  }

  // Get unique tasks for filter dropdown
  const taskNames = [...new Set(photos.map(p => p.taskName))].sort();
  const filtered = filterTask ? photos.filter(p => p.taskName === filterTask) : photos;

  // Group by date
  const grouped = {};
  filtered.forEach(photo => {
    const date = photo.date || 'Unknown';
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(photo);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2>Job Photos ({filtered.length})</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-input"
              value={filterTask}
              onChange={(e) => setFilterTask(e.target.value)}
              style={{ minWidth: 180, fontSize: '0.875rem', padding: '6px 10px' }}
            >
              <option value="">All Tasks</option>
              {taskNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body">
          {sortedDates.map(date => {
            const datePhotos = grouped[date];
            const displayDate = date !== 'Unknown'
              ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              : 'Unknown Date';
            return (
              <div key={date} style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: '0.9375rem', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  {displayDate}
                  <span className="text-light" style={{ fontWeight: 400, marginLeft: 8, fontSize: '0.8125rem' }}>
                    {datePhotos.length} photo{datePhotos.length !== 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="photo-grid">
                  {datePhotos.map((photo) => (
                    <div
                      key={photo.id}
                      className="photo-thumb"
                      onClick={() => setLightboxSrc(`/uploads/${photo.filename}`)}
                      title={`${photo.taskName} — ${photo.workerName}`}
                    >
                      <img src={`/uploads/${photo.filename}`} alt={photo.originalName || 'Photo'} />
                      <div className="photo-thumb-overlay">
                        <Camera size={20} />
                      </div>
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                        color: '#fff', padding: '16px 6px 4px', fontSize: '0.6875rem', lineHeight: 1.3,
                      }}>
                        <div style={{ fontWeight: 600 }}>{photo.taskName}</div>
                        <div style={{ opacity: 0.8 }}>{photo.workerName}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}>
            <X size={20} />
          </button>
          <img src={lightboxSrc} alt="Full size" />
        </div>
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════
   EDIT JOB MODAL
   ═══════════════════════════════════════════════════════════════ */
function EditJobModal({ job, foremen, onClose, onSaved }) {
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: job.name || '',
    address: job.address || '',
    customerName: job.customerName || '',
    customerContact: job.customerContact || '',
    startDate: job.startDate || '',
    endDate: job.endDate || '',
    foremanId: job.foremanId || '',
    status: job.status || 'active',
    budget: job.budget ?? '',
    jobType: job.jobType || '',
    squareFootage: job.squareFootage ?? '',
    bedrooms: job.bedrooms ?? '',
    bathrooms: job.bathrooms ?? '',
    stories: job.stories ?? '',
    garageType: job.garageType || '',
    notes: job.notes || '',
    crmOpportunityId: job.crmOpportunityId || '',
  });

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Job name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/jobs/${job.id}`, {
        ...form,
        budget: form.budget !== '' ? parseFloat(form.budget) : 0,
        foremanId: form.foremanId || null,
        jobType: form.jobType || null,
        squareFootage: form.squareFootage !== '' ? parseFloat(form.squareFootage) : null,
        bedrooms: form.bedrooms !== '' ? parseInt(form.bedrooms) : null,
        bathrooms: form.bathrooms !== '' ? parseFloat(form.bathrooms) : null,
        stories: form.stories !== '' ? parseInt(form.stories) : null,
        garageType: form.garageType || null,
        crmOpportunityId: form.crmOpportunityId || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to update job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Job</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="text-danger" style={{ marginBottom: 12 }}>{error}</p>}
            <div className="form-row">
              <div className="form-group">
                <label>Job Name *</label>
                <input type="text" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={(e) => updateField('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Address</label>
              <input type="text" value={form.address} onChange={(e) => updateField('address', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Customer Name</label>
                <input type="text" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Customer Contact</label>
                <input type="text" value={form.customerContact} onChange={(e) => updateField('customerContact', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Date</label>
                <input type="date" value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>End Date</label>
                <input type="date" value={form.endDate} onChange={(e) => updateField('endDate', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Foreman</label>
                <select value={form.foremanId} onChange={(e) => updateField('foremanId', e.target.value)}>
                  <option value="">-- None --</option>
                  {foremen.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Budget ($)</label>
                <input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => updateField('budget', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Job Type</label>
                <select value={form.jobType} onChange={(e) => updateField('jobType', e.target.value)}>
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
              <div className="form-group">
                <label>CRM Opportunity ID</label>
                <input type="text" value={form.crmOpportunityId} onChange={(e) => updateField('crmOpportunityId', e.target.value)} />
              </div>
            </div>
            <div className="form-section-label">Property Specifications</div>
            <div className="form-row">
              <div className="form-group">
                <label>Square Footage</label>
                <input type="number" min="0" value={form.squareFootage} onChange={(e) => updateField('squareFootage', e.target.value)} placeholder="e.g. 2400" />
              </div>
              <div className="form-group">
                <label>Bedrooms</label>
                <input type="number" min="0" step="1" value={form.bedrooms} onChange={(e) => updateField('bedrooms', e.target.value)} placeholder="e.g. 3" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Bathrooms</label>
                <input type="number" min="0" step="0.5" value={form.bathrooms} onChange={(e) => updateField('bathrooms', e.target.value)} placeholder="e.g. 2.5" />
              </div>
              <div className="form-group">
                <label>Stories</label>
                <input type="number" min="1" step="1" value={form.stories} onChange={(e) => updateField('stories', e.target.value)} placeholder="e.g. 2" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Garage</label>
                <select value={form.garageType} onChange={(e) => updateField('garageType', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="none">None</option>
                  <option value="1-car">1-Car</option>
                  <option value="2-car">2-Car</option>
                  <option value="3-car">3-Car</option>
                </select>
              </div>
              <div className="form-group" />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   SCOPE MODAL
   ═══════════════════════════════════════════════════════════════ */
function ScopeModal({ mode, scope, jobId, onClose, onSaved }) {
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: scope?.name || '',
    description: scope?.description || '',
    estimatedValue: scope?.estimatedValue ?? '',
  });

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        estimatedValue: form.estimatedValue !== '' ? parseFloat(form.estimatedValue) : 0,
      };
      if (mode === 'create') {
        await api.post('/api/scopes', { ...payload, jobId });
      } else {
        await api.put(`/api/scopes/${scope.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save scope');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>{mode === 'create' ? 'Add Scope' : 'Edit Scope'}</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="text-danger" style={{ marginBottom: 12 }}>{error}</p>}
            <div className="form-group">
              <label>Scope Name *</label>
              <input type="text" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. Framing" autoFocus />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={(e) => updateField('description', e.target.value)} placeholder="Scope description..." />
            </div>
            <div className="form-group">
              <label>Estimated Value ($)</label>
              <input type="number" min="0" step="0.01" value={form.estimatedValue} onChange={(e) => updateField('estimatedValue', e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : mode === 'create' ? 'Add Scope' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   ACTIVITY MODAL
   ═══════════════════════════════════════════════════════════════ */
function ActivityModal({ mode, activity, scopeId, onClose, onSaved }) {
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: activity?.name || '',
    estimatedHours: activity?.estimatedHours ?? '',
  });

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        estimatedHours: form.estimatedHours !== '' ? parseFloat(form.estimatedHours) : 0,
      };
      if (mode === 'create') {
        await api.post('/api/activities', { ...payload, scopeId });
      } else {
        await api.put(`/api/activities/${activity.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save activity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>{mode === 'create' ? 'Add Activity' : 'Edit Activity'}</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="text-danger" style={{ marginBottom: 12 }}>{error}</p>}
            <div className="form-group">
              <label>Activity Name *</label>
              <input type="text" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. Wall Framing" autoFocus />
            </div>
            <div className="form-group">
              <label>Estimated Hours</label>
              <input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={(e) => updateField('estimatedHours', e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : mode === 'create' ? 'Add Activity' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TASK MODAL
   ═══════════════════════════════════════════════════════════════ */
function TaskModal({ mode, task, activityId, onClose, onSaved }) {
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: task?.name || '',
    estimatedQuantity: task?.estimatedQuantity ?? '',
    unit: task?.unit || 'each',
    scheduledStartDate: task?.scheduledStartDate || '',
    scheduledFinishDate: task?.scheduledFinishDate || '',
  });

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        estimatedQuantity: form.estimatedQuantity !== '' ? parseFloat(form.estimatedQuantity) : 0,
        unit: form.unit || 'each',
        scheduledStartDate: form.scheduledStartDate || null,
        scheduledFinishDate: form.scheduledFinishDate || null,
      };
      if (mode === 'create') {
        await api.post('/api/tasks', { ...payload, activityId });
      } else {
        await api.put(`/api/tasks/${task.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2>{mode === 'create' ? 'Add Task' : 'Edit Task'}</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="text-danger" style={{ marginBottom: 12 }}>{error}</p>}
            <div className="form-group">
              <label>Task Name *</label>
              <input type="text" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. Install drywall" autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Estimated Quantity</label>
                <input type="number" min="0" step="0.01" value={form.estimatedQuantity} onChange={(e) => updateField('estimatedQuantity', e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label>Unit</label>
                <select value={form.unit} onChange={(e) => updateField('unit', e.target.value)}>
                  <option value="each">Each</option>
                  <option value="sqft">Sq Ft</option>
                  <option value="lnft">Ln Ft</option>
                  <option value="cuyd">Cu Yd</option>
                  <option value="ton">Ton</option>
                  <option value="hours">Hours</option>
                  <option value="lot">Lot</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Scheduled Start</label>
                <input type="date" value={form.scheduledStartDate} onChange={(e) => updateField('scheduledStartDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Scheduled Finish</label>
                <input type="date" value={form.scheduledFinishDate} onChange={(e) => updateField('scheduledFinishDate', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : mode === 'create' ? 'Add Task' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TASK DETAIL MODAL
   ═══════════════════════════════════════════════════════════════ */
function TaskDetailModal({ task, api, onClose, onEdit }) {
  const [updates, setUpdates] = useState([]);
  const [loadingUpdates, setLoadingUpdates] = useState(true);

  useEffect(() => {
    async function fetchUpdates() {
      setLoadingUpdates(true);
      try {
        const data = await api.get(`/api/daily-updates/task/${task.id}`);
        setUpdates(Array.isArray(data) ? data : []);
      } catch {
        setUpdates([]);
      } finally {
        setLoadingUpdates(false);
      }
    }
    fetchUpdates();
  }, [api, task.id]);

  const pct = task.currentPercentComplete ?? 0;
  const progressClass = getProgressClass(pct);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{task.name}</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-body">
          {/* Task info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div className="progress-bar" style={{ flex: 1, height: 8 }}>
              <div className={`progress-bar-fill ${progressClass}`} style={{ width: `${pct}%` }} />
            </div>
            <span style={{ fontWeight: 700 }}>{Math.round(pct)}%</span>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <p className="text-muted" style={{ fontSize: '0.75rem' }}>Estimated Quantity</p>
              <p style={{ fontWeight: 500 }}>{task.estimatedQuantity || 0} {task.unit}</p>
            </div>
            <div>
              <p className="text-muted" style={{ fontSize: '0.75rem' }}>Schedule</p>
              <p style={{ fontWeight: 500 }}>
                {task.scheduledStartDate
                  ? `${formatDate(task.scheduledStartDate)} - ${formatDate(task.scheduledFinishDate)}`
                  : 'Not scheduled'}
              </p>
            </div>
          </div>

          {/* Dependencies */}
          {task.dependencies && task.dependencies.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Dependencies</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {task.dependencies.map((dep) => (
                  <span key={dep.id} className="badge badge-neutral">
                    {dep.predecessorName || dep.predecessorTaskId} ({dep.type})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Update history */}
          <h4 style={{ marginBottom: 8 }}>Update History</h4>
          {loadingUpdates ? (
            <p className="text-light" style={{ fontSize: '0.875rem' }}>Loading updates...</p>
          ) : updates.length === 0 ? (
            <p className="text-light" style={{ fontSize: '0.875rem' }}>No daily updates recorded for this task.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {updates.map((update) => (
                <div
                  key={update.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--border-light)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.875rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{update.workerName || 'Worker'}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`badge ${update.status === 'approved' ? 'badge-success' : update.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                        {update.status}
                      </span>
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>{formatDate(update.date)}</span>
                    </div>
                  </div>
                  <p className="text-light" style={{ fontSize: '0.8125rem' }}>
                    Progress: {update.percentComplete}%
                    {update.notes && ` -- ${update.notes}`}
                  </p>
                  {/* Photos */}
                  {update.photos && update.photos.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {update.photos.map((photo) => (
                        <div key={photo.id} className="photo-thumb" style={{ width: 60, height: 60 }}>
                          <img src={`/uploads/${photo.filename}`} alt={photo.originalName || 'Photo'} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => onEdit(task)}>
            <Edit2 size={14} /> Edit Task
          </button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TEMPLATE SELECT MODAL
   ═══════════════════════════════════════════════════════════════ */
function TemplateSelectModal({ api, onClose, onSelect }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get('/api/templates');
        if (!cancelled) setTemplates(Array.isArray(data) ? data : []);
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [api]);

  const filtered = searchQuery.trim()
    ? templates.filter((t) =>
        (t.name || '').toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (t.description || '').toLowerCase().includes(searchQuery.toLowerCase().trim())
      )
    : templates;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Select Template</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <p className="text-light" style={{ marginTop: 8 }}>Loading templates...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <FileText size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <p className="text-light">{templates.length === 0 ? 'No templates available. Create one from the Templates page.' : 'No templates match your search.'}</p>
          </div>
        ) : (
          <div>
            {filtered.map((t) => (
              <div key={t.id} className="template-select-item" onClick={() => onSelect(t)}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.name}</div>
                  {t.description && <div className="text-light" style={{ fontSize: '0.8125rem' }}>{t.description}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span className="badge badge-primary" style={{ marginRight: 6 }}>{t.scopeCount} scopes</span>
                  <span className="text-light" style={{ fontSize: '0.8125rem' }}>{formatCurrency(t.totalEstimatedValue)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TEMPLATE PREVIEW & BUDGET VALIDATION MODAL
   ═══════════════════════════════════════════════════════════════ */
function TemplatePreviewModal({ template, adjustedScopes, jobBudget, jobSpecs, jobId, api, onUpdateScopes, onClose, onApplied }) {
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const templateTotal = adjustedScopes.reduce((sum, s) => sum + (parseFloat(s.estimatedValue) || 0), 0);
  const difference = jobBudget - templateTotal;
  const isOverBudget = jobBudget > 0 && templateTotal > jobBudget;
  const hasBudget = jobBudget > 0;

  // Sqft-based scaling
  const templateSqft = template.squareFootage;
  const jobSqft = jobSpecs?.squareFootage;
  const canScaleBySqft = templateSqft > 0 && jobSqft > 0;
  const sqftFactor = canScaleBySqft ? jobSqft / templateSqft : null;

  function scaleBySquareFootage() {
    if (!canScaleBySqft) return;
    const factor = sqftFactor;
    const newScopes = adjustedScopes.map((s) => ({
      ...s,
      estimatedValue: Math.round((parseFloat(s.estimatedValue) || 0) * factor * 100) / 100,
      activities: s.activities.map((a) => ({
        ...a,
        estimatedHours: Math.round((parseFloat(a.estimatedHours) || 0) * factor * 100) / 100,
      })),
    }));
    onUpdateScopes(newScopes);
  }

  const formatGarage = (v) => v === 'none' ? 'None' : v || '--';

  function updateScopeValue(sIdx, value) {
    const newScopes = [...adjustedScopes];
    newScopes[sIdx] = { ...newScopes[sIdx], estimatedValue: parseFloat(value) || 0 };
    onUpdateScopes(newScopes);
  }

  function updateActivityHours(sIdx, aIdx, value) {
    const newScopes = [...adjustedScopes];
    const newActivities = [...newScopes[sIdx].activities];
    newActivities[aIdx] = { ...newActivities[aIdx], estimatedHours: parseFloat(value) || 0 };
    newScopes[sIdx] = { ...newScopes[sIdx], activities: newActivities };
    onUpdateScopes(newScopes);
  }

  function autoScale() {
    if (!hasBudget || templateTotal === 0) return;
    const ratio = jobBudget / templateTotal;
    const newScopes = adjustedScopes.map((s) => ({
      ...s,
      estimatedValue: Math.round((parseFloat(s.estimatedValue) || 0) * ratio * 100) / 100,
      activities: s.activities.map((a) => ({
        ...a,
        estimatedHours: Math.round((parseFloat(a.estimatedHours) || 0) * ratio * 100) / 100,
      })),
    }));
    onUpdateScopes(newScopes);
  }

  async function handleApply() {
    setApplying(true);
    setApplyError('');
    try {
      await api.post(`/api/templates/${template.id}/apply/${jobId}`, { scopes: adjustedScopes });
      onApplied();
    } catch (err) {
      setApplyError(err.message || 'Failed to apply template');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
            Preview: {template.name}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Budget Summary */}
        <div className="budget-summary">
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              <DollarSign size={20} />
            </div>
            <div>
              <div className="stat-card-number">{formatCurrency(jobBudget)}</div>
              <div className="stat-card-label">Job Budget</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: isOverBudget ? 'var(--danger-light)' : 'var(--success-light)', color: isOverBudget ? 'var(--danger)' : 'var(--success)' }}>
              <Layers size={20} />
            </div>
            <div>
              <div className="stat-card-number">{formatCurrency(templateTotal)}</div>
              <div className="stat-card-label">Template Total</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: isOverBudget ? 'var(--danger-light)' : 'var(--success-light)', color: isOverBudget ? 'var(--danger)' : 'var(--success)' }}>
              {isOverBudget ? <AlertTriangle size={20} /> : <Check size={20} />}
            </div>
            <div>
              <div className={`stat-card-number ${isOverBudget ? 'budget-over' : 'budget-under'}`}>
                {isOverBudget ? '-' : '+'}{formatCurrency(Math.abs(difference))}
              </div>
              <div className="stat-card-label">Difference</div>
            </div>
          </div>
        </div>

        {/* Budget Alert */}
        {hasBudget && isOverBudget && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <AlertTriangle size={16} />
            <span>Template total ({formatCurrency(templateTotal)}) exceeds job budget ({formatCurrency(jobBudget)}) by {formatCurrency(Math.abs(difference))}.</span>
          </div>
        )}
        {hasBudget && !isOverBudget && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            <Check size={16} />
            <span>Template fits within the job budget with {formatCurrency(difference)} remaining.</span>
          </div>
        )}
        {!hasBudget && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>No job budget set. Budget validation is not applicable.</span>
          </div>
        )}

        {/* Line-by-Line Table */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Original</th>
                  <th style={{ textAlign: 'right' }}>Adjusted</th>
                  <th style={{ textAlign: 'center', width: 80 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {adjustedScopes.map((scope, sIdx) => {
                  const scopeShare = hasBudget && templateTotal > 0
                    ? (scope.estimatedValue / templateTotal) * jobBudget
                    : null;
                  const scopeOver = scopeShare !== null && scope.estimatedValue > scopeShare * 1.1;

                  const originalScope = template.scopes?.find((s) => s.id === scope.templateScopeId);

                  return [
                    <tr key={`scope-${sIdx}`} className="scope-row">
                      <td style={{ fontWeight: 600 }}>
                        <Layers size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom', color: 'var(--primary)' }} />
                        {scope.name}
                      </td>
                      <td><span className="badge badge-primary">Scope</span></td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCurrency(originalScope?.estimatedValue || 0)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          className="form-input adjusted-input"
                          value={scope.estimatedValue}
                          onChange={(e) => updateScopeValue(sIdx, e.target.value)}
                          min="0"
                          step="100"
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {hasBudget && (
                          scopeOver
                            ? <span className="badge badge-danger">Over</span>
                            : <span className="badge badge-success">OK</span>
                        )}
                      </td>
                    </tr>,
                    ...scope.activities.map((act, aIdx) => (
                      <tr key={`act-${sIdx}-${aIdx}`} className="activity-row">
                        <td style={{ paddingLeft: 32 }}>
                          <Activity size={12} style={{ marginRight: 6, verticalAlign: 'text-bottom', color: 'var(--text-light)' }} />
                          {act.name}
                        </td>
                        <td><span className="badge badge-neutral">Activity</span></td>
                        <td style={{ textAlign: 'right', color: 'var(--text-light)', fontSize: '0.8125rem' }}>
                          {originalScope?.activities?.find((a) => a.id === act.templateActivityId)?.estimatedHours || 0}h
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            className="form-input adjusted-input"
                            value={act.estimatedHours}
                            onChange={(e) => updateActivityHours(sIdx, aIdx, e.target.value)}
                            min="0"
                            step="0.5"
                          />
                        </td>
                        <td></td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Property Specs Comparison */}
        {canScaleBySqft && (
          <div className="specs-comparison">
            <div className="spec-column">
              <h4>Template Base Specs</h4>
              <div className="spec-row"><span className="spec-label">Sqft</span><strong>{templateSqft?.toLocaleString()}</strong></div>
              {template.bedrooms != null && <div className="spec-row"><span className="spec-label">Beds</span><strong>{template.bedrooms}</strong></div>}
              {template.bathrooms != null && <div className="spec-row"><span className="spec-label">Baths</span><strong>{template.bathrooms}</strong></div>}
              {template.stories != null && <div className="spec-row"><span className="spec-label">Stories</span><strong>{template.stories}</strong></div>}
              {template.garageType && <div className="spec-row"><span className="spec-label">Garage</span><strong>{formatGarage(template.garageType)}</strong></div>}
            </div>
            <div className="spec-column">
              <h4>Job Specs</h4>
              <div className="spec-row"><span className="spec-label">Sqft</span><strong>{jobSqft?.toLocaleString()}</strong></div>
              {jobSpecs?.bedrooms != null && <div className="spec-row"><span className="spec-label">Beds</span><strong>{jobSpecs.bedrooms}</strong></div>}
              {jobSpecs?.bathrooms != null && <div className="spec-row"><span className="spec-label">Baths</span><strong>{jobSpecs.bathrooms}</strong></div>}
              {jobSpecs?.stories != null && <div className="spec-row"><span className="spec-label">Stories</span><strong>{jobSpecs.stories}</strong></div>}
              {jobSpecs?.garageType && <div className="spec-row"><span className="spec-label">Garage</span><strong>{formatGarage(jobSpecs.garageType)}</strong></div>}
            </div>
          </div>
        )}

        {/* Scaling Options */}
        {(canScaleBySqft || hasBudget) && (
          <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 8 }}>
              <Scale size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
              Scaling Options
            </div>
            {canScaleBySqft && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasBudget ? 8 : 0, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.8125rem' }}>
                  <span className="text-light">Scale by property size: </span>
                  {jobSqft.toLocaleString()} sqft / {templateSqft.toLocaleString()} sqft ={' '}
                  <span className={`scaling-factor-badge ${sqftFactor > 1.05 ? 'scale-up' : sqftFactor < 0.95 ? 'scale-down' : 'scale-neutral'}`}>
                    {sqftFactor.toFixed(2)}x
                  </span>
                </div>
                <button className="btn btn-outline btn-sm" onClick={scaleBySquareFootage}>
                  Scale by Sqft
                </button>
              </div>
            )}
            {hasBudget && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.8125rem' }}>
                  <span className="text-light">Scale to fit budget: </span>
                  {formatCurrency(jobBudget)}
                  {templateTotal > 0 && (
                    <>
                      {' '}={' '}
                      <span className={`scaling-factor-badge ${jobBudget / templateTotal > 1.05 ? 'scale-down' : jobBudget / templateTotal < 0.95 ? 'scale-up' : 'scale-neutral'}`}>
                        {(jobBudget / templateTotal).toFixed(2)}x
                      </span>
                    </>
                  )}
                </div>
                <button className="btn btn-outline btn-sm" onClick={autoScale}>
                  Scale to Budget
                </button>
              </div>
            )}
          </div>
        )}

        {applyError && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <span>{applyError}</span>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={applying}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={applying}>
            {applying ? 'Applying...' : 'Apply Template'}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
function getRoleBadge(role) {
  switch (role) {
    case 'admin': return 'badge-danger';
    case 'project_manager': return 'badge-primary';
    case 'foreman': return 'badge-warning';
    case 'worker': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
