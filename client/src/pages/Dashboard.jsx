/**
 * @file Role-based dashboard page. Workers see a personalized WorkerDashboard
 * with their assigned tasks, hours this week, rejected items needing attention,
 * and upcoming deadlines. All other roles see the AdminDashboard with company-wide
 * KPI stat cards, quick action buttons, active jobs overview, delayed tasks, and
 * recent activity feed.
 *
 * Worker Dashboard fetches from: /api/reports/worker-dashboard
 * Admin Dashboard fetches from: /api/reports/dashboard + /api/jobs?status=active
 *
 * Quick actions (role-filtered):
 * - Log Today's Work → /daily-entry (worker, foreman, admin)
 * - Submit Timesheet → /timesheets (worker, foreman, admin)
 * - View My Tasks → /my-tasks (worker only)
 * - Review Approvals (N) → /approvals (foreman, admin, shown when pending > 0)
 * - New Job → /jobs (project_manager, admin)
 *
 * Admin API field mapping (with fallbacks for compatibility):
 * - totalActiveJobs || activeJobs → Active Jobs stat card
 * - averageCompletion || avgCompletion → Avg Completion % stat card
 * - pendingApprovals → Pending Approvals stat card
 * - totalLaborHoursThisWeek → Labor Hours This Week stat card
 * - topDelayedTasks || delayedTasks → Delayed tasks table
 * - recentActivity → Recent activity feed
 * - job.overallPercentComplete || percentComplete || completion → Jobs table progress bars
 *
 * @module client/pages/Dashboard
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  TrendingUp,
  Clock,
  ClipboardCheck,
  AlertTriangle,
  ClipboardList,
  Plus,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingDown,
  Activity,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { getStatusBadge, formatCurrency, getProgressClass, formatRelativeDate } from '../utils/formatting';
import { DollarSign } from 'lucide-react';

/**
 * Dashboard - Home page that renders either a worker-specific view or the
 * company-wide admin/PM view based on the user's role.
 * @component
 */
export default function Dashboard() {
  const { user } = useAuth();
  const isWorker = user?.role === 'worker';
  return isWorker ? <WorkerDashboard /> : <AdminDashboard />;
}

/**
 * WorkerDashboard - Personalized dashboard for workers showing their assigned
 * tasks, hours this week, rejected items needing attention, and upcoming due dates.
 * @component
 */
function WorkerDashboard() {
  const api = useApi();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weekSchedule, setWeekSchedule] = useState([]);
  const [timeTracking, setTimeTracking] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const res = await api.get('/api/reports/worker-dashboard');
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function fetchSchedule() {
      try {
        const today = new Date().toISOString().split('T')[0];
        const d = new Date();
        const day = d.getDay();
        const mondayDate = new Date(d);
        mondayDate.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
        const sundayDate = new Date(mondayDate);
        sundayDate.setDate(mondayDate.getDate() + 6);
        const startDate = mondayDate.toISOString().split('T')[0];
        const endDate = sundayDate.toISOString().split('T')[0];

        const [schedRes, ttRes] = await Promise.all([
          api.get(`/api/schedule/week?date=${today}`),
          api.get(`/api/schedule/time-tracking?startDate=${startDate}&endDate=${endDate}`).catch(() => null),
        ]);
        if (!cancelled) {
          setWeekSchedule(schedRes.assignments || []);
          if (ttRes) setTimeTracking(ttRes);
        }
      } catch { /* non-critical */ }
    }
    fetchSchedule();
    return () => { cancelled = true; };
  }, [api]);

  if (loading) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">My Dashboard</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">My Dashboard</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <AlertTriangle size={40} style={{ color: 'var(--danger)', marginBottom: 12 }} />
          <p className="text-danger">{error}</p>
        </div>
      </div>
    );
  }

  const { totalAssigned = 0, completedTasks = 0, overdueTasks = 0, hoursThisWeek = 0, pendingHours = 0, rejectedItems = [], upcomingTasks = [] } = data || {};

  return (
    <div className="page-fade-in">
      <h1 className="page-title">My Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid-4">
        <div className="stat-card">
          <div className="stat-card-icon bg-primary">
            <ClipboardList size={24} />
          </div>
          <div className="stat-card-value">{totalAssigned}</div>
          <div className="stat-card-label">Assigned Tasks</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-success">
            <CheckCircle size={24} />
          </div>
          <div className="stat-card-value">{completedTasks}</div>
          <div className="stat-card-label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-danger">
            <AlertTriangle size={24} />
          </div>
          <div className="stat-card-value">{overdueTasks}</div>
          <div className="stat-card-label">Overdue</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-warning">
            <Clock size={24} />
          </div>
          <div className="stat-card-value">{hoursThisWeek}h</div>
          <div className="stat-card-label">Hours This Week{pendingHours > 0 ? ` (+${pendingHours}h pending)` : ''}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/daily-entry" className="btn btn-primary">
            <ClipboardList size={16} /> Log Today's Work
          </Link>
          <Link to="/timesheets" className="btn btn-secondary">
            <Clock size={16} /> Submit Timesheet
          </Link>
          <Link to="/my-tasks" className="btn btn-outline">
            <CheckCircle size={16} /> View My Tasks
          </Link>
        </div>
      </div>

      {/* Rejected Items Needing Attention */}
      {rejectedItems.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h2 style={{ color: 'var(--danger)' }}>
              <XCircle size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Needs Your Attention ({rejectedItems.length})
            </h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rejectedItems.map((item, idx) => (
              <div key={item.id || idx} style={{
                padding: '10px 14px', background: 'var(--danger-light)', borderRadius: 'var(--radius-sm)',
                borderLeft: '3px solid var(--danger)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {item.type === 'daily_update' ? `Task Update: ${item.taskName}` : `Timesheet: ${item.activityName} (${item.hours}h)`}
                    </span>
                    <span className="text-light" style={{ fontSize: '0.8125rem', marginLeft: 8 }}>{item.jobName}</span>
                  </div>
                  <span className="badge badge-danger" style={{ fontSize: '0.6875rem', flexShrink: 0 }}>Rejected</span>
                </div>
                {item.rejectionNote && (
                  <p style={{ fontSize: '0.8125rem', marginTop: 4, color: 'var(--danger)' }}>
                    {item.rejectorName ? `${item.rejectorName}: ` : ''}{item.rejectionNote}
                  </p>
                )}
                <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
                  <Link to={item.type === 'daily_update' ? '/daily-entry' : '/timesheets'} style={{ fontWeight: 600 }}>
                    Resubmit &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Tasks */}
      {upcomingTasks.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h2>
              <Calendar size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Due This Week
            </h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Job</th>
                  <th>Due Date</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {upcomingTasks.map((task) => {
                  const pct = task.currentPercentComplete || 0;
                  return (
                    <tr key={task.id}>
                      <td style={{ fontWeight: 600 }}>{task.name}</td>
                      <td>
                        <Link to={`/jobs/${task.jobId}`}>{task.jobName}</Link>
                      </td>
                      <td>{task.scheduledFinishDate ? new Date(task.scheduledFinishDate + 'T12:00:00').toLocaleDateString() : '--'}</td>
                      <td style={{ minWidth: 120 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="progress-bar" style={{ flex: 1, height: 6 }}>
                            <div className={`progress-bar-fill ${getProgressClass(pct)}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* My Schedule This Week — 5-day mini-calendar strip with job assignment pills */}
      {weekSchedule.length > 0 && (() => {
        const today = new Date();
        const day = today.getDay();
        const mondayDate = new Date(today);
        mondayDate.setDate(today.getDate() - day + (day === 0 ? -6 : 1));
        const days = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(mondayDate);
          d.setDate(mondayDate.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          const dayAssignments = weekSchedule.filter(a => a.date === dateStr);
          // Aggregate time tracking for this day
          const dayTracking = timeTracking?.entries?.filter(e => e.date === dateStr) || [];
          const dayScheduledHours = dayTracking.reduce((s, e) => s + e.scheduledHours, 0);
          const dayLoggedHours = dayTracking.reduce((s, e) => s + e.loggedHours, 0);
          days.push({ date: d, dateStr, dayAssignments, isToday: dateStr === today.toISOString().split('T')[0], dayScheduledHours, dayLoggedHours });
        }
        return (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-body">
              <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>
                <Calendar size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                My Schedule This Week
              </h3>
              <div className="schedule-mini-week">
                {days.map(d => (
                  <div key={d.dateStr} className={`schedule-mini-day ${d.isToday ? 'today' : ''}`}>
                    <div className="mini-day-label">{d.date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div className="mini-day-date">{d.date.getMonth()+1}/{d.date.getDate()}</div>
                    {d.dayAssignments.length === 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>—</div>}
                    {d.dayAssignments.map(a => (
                      <div key={a.id} className={`mini-assignment ${a.crewId ? 'crew' : 'worker-assign'}`}>
                        {a.jobName}
                      </div>
                    ))}
                    {d.dayScheduledHours > 0 && (
                      <div className="mini-hours-tracker">
                        <div className="mini-hours-bar">
                          <div
                            className={`mini-hours-fill ${d.dayLoggedHours >= d.dayScheduledHours ? 'complete' : d.dayLoggedHours > 0 ? 'partial' : ''}`}
                            style={{ width: `${Math.min(100, (d.dayLoggedHours / d.dayScheduledHours) * 100)}%` }}
                          />
                        </div>
                        <span className="mini-hours-text">{d.dayLoggedHours}/{d.dayScheduledHours}h</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Link to="/schedule" style={{ display: 'inline-block', marginTop: 12, fontSize: '0.8125rem' }}>View Full Schedule →</Link>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * AdminDashboard - Company-wide KPI dashboard for admins, PMs, and foremen.
 * Shows: Active Jobs count, Average Completion %, Labor Hours This Week,
 * Pending Approvals, role-filtered quick action buttons, active jobs table
 * with progress bars and empty state guidance, delayed tasks, and recent
 * approved activity feed with relative dates.
 * @component
 * @returns {JSX.Element} Dashboard page with stat cards, quick actions, and data tables
 */
function AdminDashboard() {
  const api = useApi();
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState(null);
  const [activeJobs, setActiveJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [budgetOverview, setBudgetOverview] = useState([]);
  const [budgetAlerts, setBudgetAlerts] = useState([]);
  const [chartData, setChartData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError('');
      try {
        const [dashboard, jobsResponse, charts] = await Promise.all([
          api.get('/api/reports/dashboard'),
          api.get('/api/jobs?status=active'),
          api.get('/api/reports/charts').catch(() => null),
        ]);
        if (!cancelled) {
          setDashboardData(dashboard);
          const jobs = Array.isArray(jobsResponse) ? jobsResponse : jobsResponse?.jobs || [];
          setActiveJobs(jobs);
          // Fetch budget data + earned value for active jobs with budgets
          const budgetJobs = jobs.filter(j => j.budget > 0);
          if (budgetJobs.length > 0) {
            const [budgetResults, evResults] = await Promise.all([
              Promise.all(budgetJobs.slice(0, 5).map(j => api.get(`/api/budget/${j.id}`).catch(() => null))),
              Promise.all(budgetJobs.slice(0, 5).map(j => api.get(`/api/budget/${j.id}/earned-value`).catch(() => null))),
            ]);
            if (!cancelled) {
              setBudgetOverview(budgetResults.filter(Boolean));
              // Build alerts from EV data
              const alerts = [];
              evResults.forEach((ev, i) => {
                if (!ev || !budgetResults[i]) return;
                const jobName = budgetResults[i].job.name;
                const jobId = budgetResults[i].job.id;
                if (ev.mismatchCount > 0) {
                  alerts.push({ jobId, jobName, type: 'mismatch', count: ev.mismatchCount });
                }
                if (ev.jobLevel.CV < 0 && Math.abs(ev.jobLevel.CV) > budgetResults[i].job.budget * 0.1) {
                  alerts.push({ jobId, jobName, type: 'cost_overrun', cv: ev.jobLevel.CV });
                }
                if (ev.jobLevel.SV < 0 && ev.jobLevel.PV > 0) {
                  alerts.push({ jobId, jobName, type: 'behind_schedule', sv: ev.jobLevel.SV });
                }
              });
              setBudgetAlerts(alerts);
            }
          }
          if (!cancelled && charts) setChartData(charts);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load dashboard data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [api]);

  if (loading) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Dashboard</h1>
        <div className="grid-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="stat-card-icon bg-primary" style={{ opacity: 0.3 }} />
              <div className="stat-card-value" style={{ opacity: 0.3 }}>--</div>
              <div className="stat-card-label" style={{ opacity: 0.3 }}>Loading...</div>
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Dashboard</h1>
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 40 }}>
          <AlertTriangle size={40} style={{ color: 'var(--danger)', marginBottom: 12 }} />
          <p className="text-danger" style={{ fontWeight: 600 }}>{error}</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeJobCount = dashboardData?.totalActiveJobs ?? dashboardData?.activeJobs ?? activeJobs.length;
  const avgCompletion = dashboardData?.averageCompletion ?? dashboardData?.avgCompletion ?? 0;
  const totalLaborHours = dashboardData?.totalLaborHoursThisWeek ?? 0;
  const pendingApprovals = dashboardData?.pendingApprovals ?? 0;
  const delayedTasks = dashboardData?.topDelayedTasks || dashboardData?.delayedTasks || [];
  const recentActivity = dashboardData?.recentActivity || [];

  return (
    <div className="page-fade-in">
      <h1 className="page-title">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid-4">
        <div className="stat-card">
          <div className="stat-card-icon bg-primary">
            <Briefcase size={24} />
          </div>
          <div className="stat-card-value">{activeJobCount}</div>
          <div className="stat-card-label">Active Jobs</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-success">
            <TrendingUp size={24} />
          </div>
          <div className="stat-card-value">{Math.round(avgCompletion)}%</div>
          <div className="stat-card-label">Avg Completion</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-warning">
            <Clock size={24} />
          </div>
          <div className="stat-card-value">{totalLaborHours}</div>
          <div className="stat-card-label">Labor Hours This Week</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-danger">
            <ClipboardCheck size={24} />
          </div>
          <div className="stat-card-value">{pendingApprovals}</div>
          <div className="stat-card-label">Pending Approvals</div>
        </div>
      </div>

      {/* Job Health Status */}
      {(() => {
        const redJobs = activeJobs.filter(j => j.alerts?.health === 'red');
        const amberJobs = activeJobs.filter(j => j.alerts?.health === 'amber');
        if (redJobs.length === 0 && amberJobs.length === 0) return null;
        return (
          <div className={`card dashboard-health-banner ${redJobs.length > 0 ? 'health-banner-red' : 'health-banner-amber'}`} style={{ marginTop: 24 }}>
            <div className="card-body">
              <div className="dashboard-health-header">
                <Activity size={20} />
                <h3 style={{ margin: 0, fontSize: '1rem' }}>
                  Job Health
                  {redJobs.length > 0 && <span className="badge badge-danger" style={{ marginLeft: 8, fontSize: '0.75rem' }}>{redJobs.length} Critical</span>}
                  {amberJobs.length > 0 && <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: '0.75rem' }}>{amberJobs.length} At Risk</span>}
                </h3>
              </div>
              <div className="dashboard-health-jobs">
                {redJobs.map(job => (
                  <div key={job.id} className="dashboard-health-job health-job-red">
                    <div className="health-job-header">
                      <span className="health-dot health-red" />
                      <Link to={`/jobs/${job.id}`} style={{ fontWeight: 600 }}>{job.name}</Link>
                    </div>
                    <div className="health-job-tags">
                      {(job.alerts.overdue || 0) > 0 && (
                        <span className="health-job-tag tag-danger"><Clock size={12} /> {job.alerts.overdue} overdue</span>
                      )}
                      {(job.alerts.behind || 0) > 0 && (
                        <span className="health-job-tag tag-warning"><TrendingDown size={12} /> {job.alerts.behind} behind</span>
                      )}
                      {(job.alerts.costOverruns || 0) > 0 && (
                        <span className="health-job-tag tag-danger"><DollarSign size={12} /> {job.alerts.costOverruns} over budget</span>
                      )}
                    </div>
                  </div>
                ))}
                {amberJobs.map(job => (
                  <div key={job.id} className="dashboard-health-job health-job-amber">
                    <div className="health-job-header">
                      <span className="health-dot health-amber" />
                      <Link to={`/jobs/${job.id}`} style={{ fontWeight: 600 }}>{job.name}</Link>
                    </div>
                    <div className="health-job-tags">
                      {(job.alerts.overdue || 0) > 0 && (
                        <span className="health-job-tag tag-warning"><Clock size={12} /> {job.alerts.overdue} overdue</span>
                      )}
                      {(job.alerts.behind || 0) > 0 && (
                        <span className="health-job-tag tag-warning"><TrendingDown size={12} /> {job.alerts.behind} behind</span>
                      )}
                      {(job.alerts.costOverruns || 0) > 0 && (
                        <span className="health-job-tag tag-danger"><DollarSign size={12} /> {job.alerts.costOverruns} over budget</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Actions */}
      {(['worker', 'foreman', 'admin'].includes(user?.role)) && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/daily-entry" className="btn btn-primary">
              <ClipboardList size={16} />
              Log Today's Work
            </Link>
            <Link to="/timesheets" className="btn btn-secondary">
              <Clock size={16} />
              Submit Timesheet
            </Link>
            {(['foreman', 'admin'].includes(user?.role)) && pendingApprovals > 0 && (
              <Link to="/approvals" className="btn btn-warning">
                <ClipboardCheck size={16} />
                Review Approvals ({pendingApprovals})
              </Link>
            )}
            {(['project_manager', 'admin'].includes(user?.role)) && (
              <Link to="/jobs" className="btn btn-outline">
                <Plus size={16} />
                New Job
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      {chartData && (
        <div className="grid-2" style={{ marginTop: 24 }}>
          {/* Job Completion Chart */}
          {chartData.jobCompletion?.length > 0 && (
            <div className="card chart-card">
              <h3>Job Completion</h3>
              <div className="bar-chart">
                {chartData.jobCompletion.map((job) => {
                  const h = Math.max((job.percentComplete / 100) * 160, 2);
                  const color = job.percentComplete >= 70 ? 'var(--success)' : job.percentComplete >= 40 ? 'var(--warning)' : 'var(--danger)';
                  return (
                    <div key={job.id} className="bar-chart-col">
                      <span className="bar-chart-value">{Math.round(job.percentComplete)}%</span>
                      <div className="bar-chart-bar" style={{ height: h, background: color }} title={`${job.name}: ${job.percentComplete}%`} />
                      <span className="bar-chart-label" title={job.name}>{job.name.length > 10 ? job.name.slice(0, 10) + '...' : job.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly Labor Hours Chart */}
          {chartData.weeklyLabor?.length > 0 && (() => {
            const maxHours = Math.max(...chartData.weeklyLabor.map(w => w.approved + w.pending), 1);
            return (
              <div className="card chart-card">
                <h3>Weekly Labor Hours</h3>
                <div className="bar-chart">
                  {chartData.weeklyLabor.map((week, i) => {
                    const approvedH = (week.approved / maxHours) * 160;
                    const pendingH = (week.pending / maxHours) * 160;
                    return (
                      <div key={i} className="bar-chart-col">
                        <span className="bar-chart-value">{week.approved + week.pending > 0 ? Math.round(week.approved + week.pending) : ''}</span>
                        <div className="stacked-bar" style={{ height: Math.max(approvedH + pendingH, 2) }}>
                          <div className="stacked-bar-segment" style={{ height: pendingH, background: 'var(--warning)' }} />
                          <div className="stacked-bar-segment" style={{ height: approvedH, background: 'var(--success)' }} />
                        </div>
                        <span className="bar-chart-label">{week.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="chart-legend">
                  <span><span className="chart-legend-dot" style={{ background: 'var(--success)' }} />Approved</span>
                  <span><span className="chart-legend-dot" style={{ background: 'var(--warning)' }} />Pending</span>
                </div>
              </div>
            );
          })()}

          {/* Budget Utilization Chart */}
          {chartData.budgetUtilization?.length > 0 && (
            <div className="card chart-card" style={{ gridColumn: chartData.jobCompletion?.length > 0 && chartData.weeklyLabor?.length > 0 ? '1 / -1' : undefined }}>
              <h3>Budget Utilization</h3>
              <div className="bar-chart" style={{ height: 140 }}>
                {chartData.budgetUtilization.map((job) => {
                  const pct = job.budget > 0 ? (job.spent / job.budget) * 100 : 0;
                  const h = Math.max((Math.min(pct, 100) / 100) * 120, 2);
                  const color = pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--primary)';
                  return (
                    <div key={job.id} className="bar-chart-col">
                      <span className="bar-chart-value">{Math.round(pct)}%</span>
                      <div className="bar-chart-bar" style={{ height: h, background: color }} title={`${job.name}: ${formatCurrency(job.spent)} / ${formatCurrency(job.budget)}`} />
                      <span className="bar-chart-label" title={job.name}>{job.name.length > 10 ? job.name.slice(0, 10) + '...' : job.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Jobs Table */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2>Active Jobs Overview</h2>
        </div>
        {activeJobs.length === 0 ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <Briefcase size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
            <p style={{ fontWeight: 600, marginBottom: 4 }}>No active jobs</p>
            <p className="text-light" style={{ marginBottom: 16 }}>Create a new job to get started tracking your projects.</p>
            {(['project_manager', 'admin'].includes(user?.role)) && (
              <Link to="/jobs" className="btn btn-primary"><Plus size={14} /> New Job</Link>
            )}
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Job Name</th>
                  <th>Health</th>
                  <th>Foreman</th>
                  <th>% Complete</th>
                  <th>Status</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.map((job) => {
                  const pct = job.overallPercentComplete ?? job.percentComplete ?? job.completion ?? 0;
                  const progressClass = getProgressClass(pct);
                  const statusBadge = getStatusBadge(job.status);
                  const alerts = job.alerts;
                  const health = alerts?.health || 'green';

                  return (
                    <tr key={job._id || job.id}>
                      <td>
                        <Link
                          to={`/jobs/${job._id || job.id}`}
                          style={{ fontWeight: 600 }}
                        >
                          {job.name || job.jobName}
                        </Link>
                      </td>
                      <td>
                        <span className={`health-dot health-${health}`} title={health === 'green' ? 'On Track' : health === 'amber' ? 'At Risk' : 'Critical'} />
                        {alerts && alerts.total > 0 && (
                          <span className="health-count" style={{ color: health === 'red' ? 'var(--danger)' : 'var(--warning)' }}>{alerts.total}</span>
                        )}
                      </td>
                      <td>{job.foreman?.name || job.foremanName || '--'}</td>
                      <td style={{ minWidth: 140 }}>
                        <div className="progress-label">
                          <span>{job.name ? '' : ''}</span>
                          <span>{Math.round(pct)}%</span>
                        </div>
                        <div className="progress-bar">
                          <div
                            className={`progress-bar-fill ${progressClass}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${statusBadge}`}>
                          {job.status}
                        </span>
                      </td>
                      <td>{formatCurrency(job.budget)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Budget Variance Alerts */}
      {budgetAlerts.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h2 style={{ color: 'var(--warning)' }}>
              <AlertTriangle size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Budget Alerts ({budgetAlerts.length})
            </h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {budgetAlerts.map((alert, i) => (
              <div key={i} style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-xs)',
                background: alert.type === 'cost_overrun' ? 'var(--danger-light)' : alert.type === 'behind_schedule' ? 'var(--warning-light)' : 'var(--warning-light)',
                borderLeft: `3px solid ${alert.type === 'cost_overrun' ? 'var(--danger)' : 'var(--warning)'}`,
                fontSize: '0.8125rem',
              }}>
                <Link to="/budget" style={{ fontWeight: 600 }}>{alert.jobName}</Link>
                {alert.type === 'mismatch' && (
                  <span> — {alert.count} activit{alert.count === 1 ? 'y' : 'ies'} with budget/completion mismatch</span>
                )}
                {alert.type === 'cost_overrun' && (
                  <span style={{ color: 'var(--danger)' }}> — Cost variance: {formatCurrency(alert.cv)}</span>
                )}
                {alert.type === 'behind_schedule' && (
                  <span style={{ color: 'var(--warning)' }}> — Behind schedule (SV: {formatCurrency(alert.sv)})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Budget Overview */}
      {budgetOverview.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2><DollarSign size={18} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Budget Overview</h2>
            {['project_manager', 'admin'].includes(user?.role) && (
              <Link to="/budget" className="btn btn-sm btn-outline">View Details</Link>
            )}
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {budgetOverview.map((b) => {
              const pct = b.summary.adjustedBudget ? (b.summary.totalActual / b.summary.adjustedBudget * 100) : 0;
              const isOver = pct > 100;
              return (
                <div key={b.job.id} className="budget-dashboard-card">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <Link to={`/jobs/${b.job.id}`} style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.job.name}
                      </Link>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: isOver ? 'var(--danger)' : 'var(--text-light)', flexShrink: 0, marginLeft: 8 }}>
                        {formatCurrency(b.summary.totalActual)} / {formatCurrency(b.summary.adjustedBudget)}
                      </span>
                    </div>
                    <div className="budget-bar-mini">
                      <div
                        className="budget-bar-mini-fill"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          background: isOver ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--success)',
                        }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isOver ? 'var(--danger)' : 'var(--success)', flexShrink: 0 }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delayed Tasks */}
      {delayedTasks.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h2>Top Delayed Tasks</h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Job</th>
                  <th>Due Date</th>
                  <th>Days Overdue</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {delayedTasks.map((task, idx) => {
                  const dueDate = task.scheduledFinishDate || task.dueDate;
                  return (
                    <tr key={task._id || task.id || idx}>
                      <td style={{ fontWeight: 600 }}>{task.taskName || task.name}</td>
                      <td>
                        {task.jobId ? (
                          <Link to={`/jobs/${task.jobId}`}>{task.jobName || task.job?.name || '--'}</Link>
                        ) : (
                          task.jobName || task.job?.name || '--'
                        )}
                      </td>
                      <td>{dueDate ? new Date(dueDate).toLocaleDateString() : '--'}</td>
                      <td>
                        <span className="badge badge-danger">
                          {task.daysOverdue || calculateDaysOverdue(dueDate)} days
                        </span>
                      </td>
                      <td>
                        {task.currentPercentComplete != null
                          ? `${task.currentPercentComplete}%`
                          : task.assignedTo?.name || task.assigneeName || '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2>Recent Activity</h2>
        </div>
        {recentActivity.length === 0 ? (
          <div className="card-body">
            <p className="text-light">No recent activity to display.</p>
          </div>
        ) : (
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {recentActivity.slice(0, 5).map((item, idx) => (
              <div
                key={item._id || item.id || idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  paddingBottom: idx < recentActivity.slice(0, 5).length - 1 ? 16 : 0,
                  borderBottom:
                    idx < recentActivity.slice(0, 5).length - 1
                      ? '1px solid var(--border)'
                      : 'none',
                }}
              >
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {item.jobName || item.job?.name || 'Daily Update'}
                  </p>
                  <p className="text-light" style={{ fontSize: '0.8125rem' }}>
                    {item.summary || item.description || 'Approved daily update'}
                  </p>
                  <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                    By {item.submittedBy?.name || item.userName || 'Unknown'}
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                  <span className="badge badge-success">Approved</span>
                  <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                    {formatRelativeDate(item.date || item.approvedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * Calculates how many days a task is overdue from today.
 * @param {string|null} dueDate - ISO date string of the due date
 * @returns {number} Number of days overdue (0 if not overdue or no date)
 */
function calculateDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.floor((now - due) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}
