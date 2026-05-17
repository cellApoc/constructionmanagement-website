/**
 * @file Admin app settings page.
 * Configures org-level settings including scheduling permissions and task tracking.
 * @module client/pages/AppSettings
 */

import { useState, useEffect } from 'react';
import { Settings, Save, Shield, ClipboardList } from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useToast } from '../App';

/** @type {Array<{value: string, label: string, locked?: boolean}>} Role options for schedule permissions */
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', locked: true },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'foreman', label: 'Foreman' },
];

/**
 * Admin settings page for configuring application-wide options.
 * Currently manages schedule permissions (which roles can create/manage crew schedules).
 * Fetches settings from GET /api/settings and saves via PUT /api/settings/:key.
 * @returns {JSX.Element}
 */
export default function AppSettings() {
  const api = useApi();
  const { showToast } = useToast();

  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTasks, setSavingTasks] = useState(false);
  const [scheduleRoles, setScheduleRoles] = useState(['admin', 'project_manager', 'foreman']);
  const [tasksEnabled, setTasksEnabled] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get('/api/settings');
        setSettings(data);
        if (data.schedule_manage_roles) {
          setScheduleRoles(data.schedule_manage_roles);
        }
        if (data.tasks_enabled !== undefined) {
          const val = typeof data.tasks_enabled === 'string' ? JSON.parse(data.tasks_enabled) : data.tasks_enabled;
          setTasksEnabled(val);
        }
      } catch (err) {
        showToast('Failed to load settings', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, showToast]);

  async function saveScheduleRoles() {
    setSaving(true);
    try {
      await api.put('/api/settings/schedule_manage_roles', { value: scheduleRoles });
      showToast('Schedule permissions saved');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveTasksEnabled() {
    setSavingTasks(true);
    try {
      await api.put('/api/settings/tasks_enabled', { value: JSON.stringify(tasksEnabled) });
      showToast('Task tracking setting saved');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSavingTasks(false);
    }
  }

  function toggleRole(role) {
    setScheduleRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

  if (loading) {
    return (
      <div className="page-fade-in">
        <h1 className="page-title">Settings</h1>
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-fade-in">
      <h1 className="page-title">
        <Settings size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />
        Settings
      </h1>

      <div className="card" style={{ padding: 24 }}>
        <div className="settings-section">
          <h3>
            <Shield size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Schedule Permissions
          </h3>
          <p className="text-light" style={{ fontSize: '0.875rem', margin: '0 0 16px' }}>
            Select which roles can create and manage crew schedules. Workers are always read-only.
          </p>

          {ROLE_OPTIONS.map(opt => (
            <div key={opt.value} className={`settings-role-toggle ${opt.locked ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                id={`role-${opt.value}`}
                checked={scheduleRoles.includes(opt.value)}
                onChange={() => !opt.locked && toggleRole(opt.value)}
                disabled={opt.locked}
              />
              <label htmlFor={`role-${opt.value}`}>
                {opt.label}
                {opt.locked && <span className="text-muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>(always enabled)</span>}
              </label>
            </div>
          ))}

          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveScheduleRoles} disabled={saving}>
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
      </div>

      {/* Task Tracking */}
      <div className="card" style={{ padding: 24, marginTop: 16 }}>
        <div className="settings-section">
          <h3>
            <ClipboardList size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Task Tracking
          </h3>
          <p className="text-light" style={{ fontSize: '0.875rem', margin: '0 0 16px' }}>
            Controls whether the task level (Scope &rarr; Activity &rarr; Task) is used for tracking production.
            When disabled, workers submit completion percentages at the activity level instead.
            This is the app-wide default; individual jobs can override this in their settings.
          </p>

          <div className="settings-role-toggle">
            <input
              type="checkbox"
              id="tasks-enabled"
              checked={tasksEnabled}
              onChange={() => setTasksEnabled(!tasksEnabled)}
            />
            <label htmlFor="tasks-enabled">
              Enable task-level tracking
              {!tasksEnabled && <span className="text-muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>(activity-level only)</span>}
            </label>
          </div>

          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveTasksEnabled} disabled={savingTasks}>
            <Save size={16} />
            {savingTasks ? 'Saving...' : 'Save Task Setting'}
          </button>
        </div>
      </div>
    </div>
  );
}
