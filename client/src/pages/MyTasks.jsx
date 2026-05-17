/**
 * @file My Tasks page showing all tasks assigned to the current user across
 * all active jobs. Tasks are fetched via GET /api/tasks/my which joins through
 * worker_assignments at the activity level. Features summary stat cards
 * (total, completed, overdue), filter tabs (all, in progress, overdue),
 * and a task table with job links, due dates, and progress bars.
 * @module client/pages/MyTasks
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, CheckCircle, AlertTriangle } from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { getProgressClass } from '../utils/formatting';

/**
 * MyTasks - Displays all tasks assigned to the current user via worker_assignments.
 * Shows summary stats (total, completed, overdue), filter tabs, and a task table
 * with job links, activity context, due dates (with overdue badges), and progress bars.
 * Empty states guide workers to request activity assignments from their foreman.
 * @component
 * @returns {JSX.Element} My Tasks page with stat cards, filters, and task table
 */
export default function MyTasks() {
  const api = useApi();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, incomplete, overdue

  useEffect(() => {
    let cancelled = false;
    async function fetchTasks() {
      setLoading(true);
      try {
        const data = await api.get('/api/tasks/my');
        if (!cancelled) setTasks(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTasks();
    return () => { cancelled = true; };
  }, [api]);

  const now = new Date();
  const filtered = tasks.filter((t) => {
    if (filter === 'incomplete') return (t.currentPercentComplete ?? 0) < 100;
    if (filter === 'overdue') return t.scheduledFinishDate && new Date(t.scheduledFinishDate) < now && (t.currentPercentComplete ?? 0) < 100;
    return true;
  });

  const totalTasks = tasks.length;
  const completedCount = tasks.filter((t) => (t.currentPercentComplete ?? 0) >= 100).length;
  const overdueCount = tasks.filter((t) => t.scheduledFinishDate && new Date(t.scheduledFinishDate) < now && (t.currentPercentComplete ?? 0) < 100).length;

  if (loading) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">My Tasks</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading your tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-fade-in">
      <h1 className="page-title">My Tasks</h1>

      {/* Summary stats */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon bg-primary"><ClipboardList size={24} /></div>
          <div className="stat-card-value">{totalTasks}</div>
          <div className="stat-card-label">Total Assigned</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-success"><CheckCircle size={24} /></div>
          <div className="stat-card-value">{completedCount}</div>
          <div className="stat-card-label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-danger"><AlertTriangle size={24} /></div>
          <div className="stat-card-value">{overdueCount}</div>
          <div className="stat-card-label">Overdue</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All ({totalTasks})
        </button>
        <button className={`tab ${filter === 'incomplete' ? 'active' : ''}`} onClick={() => setFilter('incomplete')}>
          In Progress ({totalTasks - completedCount})
        </button>
        <button className={`tab ${filter === 'overdue' ? 'active' : ''}`} onClick={() => setFilter('overdue')}>
          Overdue ({overdueCount})
        </button>
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <ClipboardList size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ fontWeight: 600, marginBottom: 4 }}>
            {tasks.length === 0 ? 'No tasks assigned yet' : 'No tasks match this filter'}
          </p>
          <p className="text-light">
            {tasks.length === 0
              ? 'Ask your foreman to assign you to activities on a job.'
              : 'Try a different filter to see your tasks.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Job</th>
                  <th>Activity</th>
                  <th>Due Date</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const pct = task.currentPercentComplete ?? 0;
                  const isOverdue = task.scheduledFinishDate && new Date(task.scheduledFinishDate) < now && pct < 100;
                  return (
                    <tr key={task.id}>
                      <td style={{ fontWeight: 600 }}>{task.name}</td>
                      <td>
                        <Link to={`/jobs/${task.jobId}`}>{task.jobName}</Link>
                      </td>
                      <td className="text-light">{task.activityName}</td>
                      <td>
                        {task.scheduledFinishDate ? (
                          <span className={isOverdue ? 'badge badge-danger' : ''}>
                            {new Date(task.scheduledFinishDate).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted">--</span>
                        )}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <div className="progress-label">
                          <span>{pct >= 100 ? 'Done' : ''}</span>
                          <span>{Math.round(pct)}%</span>
                        </div>
                        <div className="progress-bar">
                          <div
                            className={`progress-bar-fill ${getProgressClass(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
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
    </div>
  );
}
