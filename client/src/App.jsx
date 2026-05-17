/**
 * @file Root application component. Provides auth, API, toast, and page title
 * contexts. Renders the sidebar navigation layout with role-based menu items,
 * a global search dropdown in the header, toast notification system, dynamic
 * breadcrumbs via PageTitleContext, and defines all client-side routes.
 * @module client/App
 */

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  HardHat,
  ClipboardList,
  Clock,
  CheckSquare,
  BarChart3,
  Users,
  LogOut,
  Menu,
  ChevronLeft,
  FileText,
  Search,
  ListChecks,
  Bell,
  Calendar,
  Settings,
  DollarSign,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ApiProvider, useApi } from './context/ApiContext';

/** @type {React.Context} Context for dynamic breadcrumb page titles */
const PageTitleContext = createContext({ pageTitle: '', setPageTitle: () => {} });

/**
 * Hook to set the page title displayed in the header breadcrumb.
 * Automatically clears the title on unmount.
 * @param {string} title - Page title to display (e.g. job name)
 */
export function usePageTitle(title) {
  const { setPageTitle } = useContext(PageTitleContext);
  useEffect(() => {
    if (title) setPageTitle(title);
    return () => setPageTitle('');
  }, [title, setPageTitle]);
}

/** @type {React.Context} Context for global toast notifications */
const ToastContext = createContext({ showToast: () => {} });

/**
 * Hook to access the toast notification system.
 * @returns {{ showToast: (message: string, type?: 'success'|'error'|'info') => void }}
 */
export function useToast() { return useContext(ToastContext); }
import Dashboard from './pages/Dashboard';
import LoginPage from './pages/LoginPage';
import JobsList from './pages/JobsList';
import JobDetail from './pages/JobDetail';
import GanttView from './pages/GanttView';
import DailyEntry from './pages/DailyEntry';
import TimesheetEntry from './pages/TimesheetEntry';
import ApprovalQueue from './pages/ApprovalQueue';
import Reports from './pages/Reports';
import UserManagement from './pages/UserManagement';
import TemplateManagement from './pages/TemplateManagement';
import MyTasks from './pages/MyTasks';
import CrewSchedule from './pages/CrewSchedule';
import AppSettings from './pages/AppSettings';
import BudgetTracking from './pages/BudgetTracking';
import './App.css';

/**
 * ProtectedRoute - Route guard that checks if the current user's role is
 * in the allowed roles list. Redirects to dashboard if unauthorized.
 * @component
 * @param {Object} props
 * @param {string[]} props.roles - Allowed role names
 * @param {JSX.Element} props.children - Child component to render if authorized
 * @returns {JSX.Element} Children if authorized, Navigate to "/" if not
 */
function ProtectedRoute({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

/**
 * AppLayout - Main authenticated layout with collapsible sidebar, top header
 * with dynamic breadcrumb, global search dropdown, user info, and routed page
 * content area. Provides ToastContext and PageTitleContext to child routes.
 * Filters navigation items based on the current user's role. Polls for pending
 * approval count to display sidebar badge.
 * @component
 * @returns {JSX.Element} Full app layout with sidebar + header + routes + toast overlay
 */
function AppLayout() {
  const { user, logout } = useAuth();
  const api = useApi();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [pageTitle, setPageTitle] = useState('');
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(data);
      } catch { setSearchResults(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, api]);

  // Close search on navigation
  useEffect(() => { setSearchOpen(false); setSearchQuery(''); }, [location.pathname]);

  // Close search on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const role = user?.role || 'worker';

  const fetchPendingApprovals = useCallback(async () => {
    if (role !== 'foreman' && role !== 'admin') return;
    try {
      const [dailyUpdates, timesheets] = await Promise.all([
        api.get('/api/daily-updates/pending'),
        api.get('/api/timesheets/pending'),
      ]);
      const dailyCount = Array.isArray(dailyUpdates) ? dailyUpdates.length : 0;
      const timesheetCount = Array.isArray(timesheets) ? timesheets.length : 0;
      setPendingApprovalCount(dailyCount + timesheetCount);
    } catch {
      // Silently ignore fetch errors for badge count
    }
  }, [api, role]);

  useEffect(() => {
    fetchPendingApprovals();
    const interval = setInterval(fetchPendingApprovals, 60000);
    return () => clearInterval(interval);
  }, [fetchPendingApprovals]);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await api.get('/api/notifications/unread-count');
      setUnreadCount(data.count || 0);
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const openNotifications = async () => {
    if (notifOpen) { setNotifOpen(false); return; }
    setNotifOpen(true);
    try {
      const data = await api.get('/api/notifications');
      setNotifications(Array.isArray(data) ? data : []);
    } catch { setNotifications([]); }
  };

  const markAllRead = async () => {
    try {
      await api.put('/api/notifications/read-all');
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })));
    } catch { /* ignore */ }
  };

  const markOneRead = async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`);
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: 1 } : n));
    } catch { /* ignore */ }
  };

  // Close notifications on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close notifications on navigation
  useEffect(() => { setNotifOpen(false); }, [location.pathname]);

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard', roles: ['worker', 'foreman', 'project_manager', 'admin'] },
    { to: '/jobs', icon: <HardHat size={20} />, label: 'Jobs', roles: ['worker', 'foreman', 'project_manager', 'admin'] },
    { to: '/my-tasks', icon: <ListChecks size={20} />, label: 'My Tasks', roles: ['worker', 'foreman', 'admin'] },
    { to: '/schedule', icon: <Calendar size={20} />, label: 'Schedule', roles: ['worker', 'foreman', 'project_manager', 'admin'] },
    { to: '/budget', icon: <DollarSign size={20} />, label: 'Budget', roles: ['project_manager', 'admin'] },
    { to: '/templates', icon: <FileText size={20} />, label: 'Templates', roles: ['project_manager', 'admin'] },
    { to: '/daily-entry', icon: <ClipboardList size={20} />, label: 'Daily Entry', roles: ['worker', 'foreman', 'admin'] },
    { to: '/timesheets', icon: <Clock size={20} />, label: 'Timesheets', roles: ['worker', 'foreman', 'admin'] },
    { to: '/approvals', icon: <CheckSquare size={20} />, label: 'Approvals', roles: ['foreman', 'admin'] },
    { to: '/reports', icon: <BarChart3 size={20} />, label: 'Reports', roles: ['project_manager', 'admin'] },
    { to: '/users', icon: <Users size={20} />, label: 'Users', roles: ['admin'] },
    { to: '/settings', icon: <Settings size={20} />, label: 'Settings', roles: ['admin'] },
  ];

  const filteredNav = navItems.filter((item) => item.roles.includes(role));

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
        <div className="sidebar-header">
          {!collapsed && <span className="sidebar-brand">CM Pro</span>}
          <button className="sidebar-toggle" onClick={() => { setCollapsed(!collapsed); setMobileOpen(false); }}>
            <ChevronLeft size={20} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {!collapsed && (
                <span className="sidebar-link-label">
                  {item.label}
                  {item.label === 'Approvals' && pendingApprovalCount > 0 && (
                    <span className="sidebar-badge">{pendingApprovalCount}</span>
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="main-wrapper">
        <header className="top-header">
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
            <Menu size={24} />
          </button>
          <div className="header-breadcrumb">
            {(() => {
              const path = location.pathname;
              if (path === '/') return 'Dashboard';
              const routeLabels = { jobs: 'Jobs', 'my-tasks': 'My Tasks', schedule: 'Schedule', budget: 'Budget', templates: 'Templates', 'daily-entry': 'Daily Entry', timesheets: 'Timesheets', approvals: 'Approvals', reports: 'Reports', users: 'Users', settings: 'Settings' };
              const segments = path.slice(1).split('/');
              const base = routeLabels[segments[0]] || segments[0];
              if (segments.length === 1) return base;
              if (segments[0] === 'jobs' && segments.length >= 2) {
                const suffix = segments[2] === 'gantt' ? ' / Gantt' : '';
                return pageTitle ? `${base} / ${pageTitle}${suffix}` : `${base}${suffix}`;
              }
              return pageTitle || base;
            })()}
          </div>
          <div className="header-right">
            <div className="header-search" ref={searchRef}>
              <button className="header-search-toggle" onClick={() => setSearchOpen(!searchOpen)}>
                <Search size={18} />
              </button>
              {searchOpen && (
                <div className="header-search-dropdown">
                  <input
                    type="text"
                    className="header-search-input"
                    placeholder="Search jobs, tasks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchResults && (
                    <div className="header-search-results">
                      {searchResults.jobs?.length > 0 && (
                        <>
                          <div className="search-results-label">Jobs</div>
                          {searchResults.jobs.map((job) => (
                            <div key={job.id} className="search-result-item" onClick={() => navigate(`/jobs/${job.id}`)}>
                              <HardHat size={14} />
                              <div>
                                <div className="search-result-name">{job.name}</div>
                                <div className="search-result-meta">{job.address} &middot; {job.status}</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                      {searchResults.tasks?.length > 0 && (
                        <>
                          <div className="search-results-label">Tasks</div>
                          {searchResults.tasks.map((task) => (
                            <div key={task.id} className="search-result-item" onClick={() => navigate(`/jobs/${task.jobId}`)}>
                              <ClipboardList size={14} />
                              <div>
                                <div className="search-result-name">{task.name}</div>
                                <div className="search-result-meta">{task.jobName} &middot; {task.currentPercentComplete}%</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                      {searchResults.jobs?.length === 0 && searchResults.tasks?.length === 0 && (
                        <div className="search-result-empty">No results found</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="header-notifications" ref={notifRef}>
              <button className="header-notif-toggle" onClick={openNotifications}>
                <Bell size={18} />
                {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
              </button>
              {notifOpen && (
                <div className="header-notif-dropdown">
                  <div className="notif-dropdown-header">
                    <strong>Notifications</strong>
                    {unreadCount > 0 && (
                      <button className="notif-mark-read" onClick={markAllRead}>Mark all read</button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div className="notif-empty">No notifications</div>
                  ) : (
                    <div className="notif-list">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`notif-item ${n.isRead ? '' : 'notif-unread'}`}
                          onClick={() => { if (!n.isRead) markOneRead(n.id); }}
                        >
                          <div className="notif-item-title">{n.title}</div>
                          <div className="notif-item-message">{n.message}</div>
                          <div className="notif-item-time">{new Date(n.createdAt).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="header-user">
              <span className="header-user-name">{user?.name || 'User'}</span>
              <span className="badge badge-primary">{role.replace('_', ' ')}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={16} />
              <span className="btn-label-desktop">Logout</span>
            </button>
          </div>
        </header>

        <main className="main-content">
          <ToastContext.Provider value={{ showToast }}>
          <PageTitleContext.Provider value={{ pageTitle, setPageTitle }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<JobsList />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/jobs/:id/gantt" element={<GanttView />} />
            <Route path="/my-tasks" element={<ProtectedRoute roles={['worker', 'foreman', 'admin']}><MyTasks /></ProtectedRoute>} />
            <Route path="/daily-entry" element={<ProtectedRoute roles={['worker', 'foreman', 'admin']}><DailyEntry /></ProtectedRoute>} />
            <Route path="/timesheets" element={<ProtectedRoute roles={['worker', 'foreman', 'admin']}><TimesheetEntry /></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute roles={['foreman', 'admin']}><ApprovalQueue /></ProtectedRoute>} />
            <Route path="/budget" element={<ProtectedRoute roles={['project_manager', 'admin']}><BudgetTracking /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute roles={['project_manager', 'admin']}><TemplateManagement /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute roles={['project_manager', 'admin']}><Reports /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute roles={['admin']}><UserManagement /></ProtectedRoute>} />
            <Route path="/schedule" element={<CrewSchedule />} />
            <Route path="/settings" element={<ProtectedRoute roles={['admin']}><AppSettings /></ProtectedRoute>} />
          </Routes>
          </PageTitleContext.Provider>
          </ToastContext.Provider>
        </main>

        {/* Toast notifications */}
        {toasts.length > 0 && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {toasts.map((t) => (
              <div key={t.id} className={`toast-notification toast-${t.type}`}>
                {t.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * App - Root component that wraps the entire application in AuthProvider
 * and ApiProvider context. Renders AppContent which handles auth gating.
 * @component
 * @returns {JSX.Element} Provider-wrapped application
 */
export default function App() {
  return (
    <AuthProvider>
      <ApiProvider>
        <AppContent />
      </ApiProvider>
    </AuthProvider>
  );
}

/**
 * AppContent - Auth gate component. Shows a loading spinner while checking
 * auth state, renders AppLayout for authenticated users, or LoginPage otherwise.
 * @component
 * @returns {JSX.Element} Loading screen, login page, or main layout
 */
function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return user ? <AppLayout /> : <LoginPage />;
}
