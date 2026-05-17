# Construction Management Application

A lightweight construction management application for small construction businesses. Track production, manage timesheets, approve daily updates, and visualize schedules with Gantt charts.

## Features

- **Job Management** — Create and manage jobs with 3-tier hierarchy (Scope → Activities → Tasks), property specs (sqft, bedrooms, bathrooms, stories, garage), and job type classification
- **Template System** — Reusable scope/activity templates (3 residential + 3 commercial). Apply to jobs with budget validation preview, sqft-based scaling, and one-click duplication
- **Daily Production Tracking** — Workers submit % complete + photos for tasks or activities (configurable). Jobs/activities are filtered by schedule and assignment. Foreman+ can override with force-available toggle. Pre-fills yesterday's %, remembers last selection.
- **Timesheet Entry** — Log hours against filtered activities with approval workflow. Same job/activity filtering, foreman toggles, and localStorage persistence as daily entry.
- **Approval Queue** — Foreman/Admin approve/reject daily updates (task and activity level) and timesheets, with full approval history tab and type badges
- **Interactive Gantt Chart** — Visualize task schedules with dependencies, critical path analysis (forward/backward pass), baseline comparison, drag-to-reschedule, and auto-scroll to active tasks
- **Rejection & Resubmit Workflow** — Rejection notes with reason, worker notifications, and one-click resubmit for both daily updates and timesheets
- **Safe Job Archival** — Cascade impact preview showing all affected records (scopes, tasks, timesheets, photos) before archiving
- **Worker Dashboard** — Personalized home page for workers showing assigned tasks, hours this week, rejected items needing attention, and upcoming deadlines
- **Photo Progress Journal** — Job photos grouped by date with task filtering, worker attribution, and lightbox viewer
- **Payroll Export** — CSV export of approved timesheets grouped by worker + date for payroll processing
- **Bulk Task Scheduling** — Auto-schedule all tasks from a start date respecting dependency order and sort position
- **Activity Hours Tracking** — Workers see estimated vs. actual hours per activity before submitting timesheets
- **Dashboards & Reports** — Real-time progress, labor analytics, production rates, CSV export, quick action buttons
- **Dashboard Charts** — Interactive bar charts for job completion, 8-week labor hours trend (approved vs pending), and budget utilization per job
- **My Tasks View** — Workers see all their assigned tasks across all jobs with progress, due dates, and overdue tracking
- **Global Search** — Search jobs and tasks from the header bar with instant results dropdown
- **Toast Notifications** — Success/error feedback on all CRUD operations throughout the app
- **Inline Progress Editing** — Foremen/admins can update task progress directly from the job detail tree
- **Smart Breadcrumbs** — Dynamic page titles showing job names instead of UUIDs
- **In-App Notifications** — Bell icon with unread count, notification dropdown, and mark-all-read
- **Role-Based Access** — Worker, Foreman, Project Manager, Admin roles with defense-in-depth (frontend route guards + backend role middleware)
- **Mobile-First Design** — Touch-friendly interface for field use
- **Pending Approvals Badge** — Sidebar notification badge with real-time count for foreman/admin
- **Crew Scheduling** — Weekly calendar grid with drag-and-drop assignment of crews to jobs, enhanced with Alt+drag to copy assignments between days
- **Bulk Assignment** — Assign a worker or crew to a job for multiple days at once with day picker and configurable hours
- **Time Tracking Integration** — Compare scheduled hours vs logged timesheet hours with summary stats and detailed per-worker variance table
- **Named Crew Management** — Create and manage named crews with member assignment
- **Conflict Detection** — Automatic detection of double-booked workers across overlapping assignments
- **Worker Availability Tracking** — Track time off, sick days, and other availability constraints
- **Configurable Scheduling Permissions** — App-level settings for scheduling RBAC with per-job overrides
- **Budget Tracking** — Budget tracking with line items by category, change order workflow (create/approve/reject), budget vs actual variance tracking, WBS rollup, earned value analysis (PV/EV/AC/CPI/SPI), and dashboard integration
- **Labor Rates** — Per-worker/trade hourly rates with effective dates, used for automatic labor cost calculation in budget reports
- **Job Health Alerts** — Automatic detection of overdue tasks, behind-schedule work (>20% gap), cost overruns, and stalled tasks
- **Destructive Action Confirmations** — All destructive operations (delete, archive, unassign, bulk schedule) require confirmation via modal dialogs
- **Configurable Task Tracking** — Task-level tracking can be enabled/disabled app-wide (Settings) or per-job (Job Detail). When disabled, workers track % at activity level.
- **App Settings Page** — Admin configuration page for application-wide settings (schedule permissions, task tracking)

## Tech Stack

- **Frontend**: React 18, Vite, React Router, Lucide Icons
- **Backend**: Node.js, Express, better-sqlite3
- **Auth**: JWT with bcrypt password hashing
- **Database**: SQLite (better-sqlite3) with WAL mode, UUID primary keys

## Quick Start

### Prerequisites
- Node.js 18+ and npm

### Installation

```bash
# Clone the repo
git clone https://github.com/dsansom-cell/constructionmanagement-website.git
cd constructionmanagement-website

# Install all dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Seed the database with demo data
cd server && node seed.js && cd ..

# Seed commercial templates (optional)
cd server && node seed-commercial-templates.js && cd ..

# Seed schedule demo data (optional)
cd server && node seed-schedule.js && cd ..

# Seed additional demo jobs with crews (optional)
cd server && node seed-new-jobs.js && cd ..

# Start both server and client
npm run dev
```

The app will be available at **http://localhost:5173**

### Demo Login Credentials

**Core users** (seed.js):

| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | password123 | Admin |
| pm@demo.com | password123 | Project Manager |
| foreman@demo.com | password123 | Foreman |
| worker@demo.com | password123 | Worker |

**Additional crew** (seed-new-jobs.js — 2 jobs, 2 crews):

| Email | Password | Role | Crew |
|-------|----------|------|------|
| lisa@demo.com | password123 | Foreman | — |
| sam@demo.com | password123 | Worker | Kitchen Specialists |
| derek@demo.com | password123 | Worker | Kitchen Specialists |
| elena@demo.com | password123 | Worker | Finishing & Paint |
| amber@demo.com | password123 | Worker | Finishing & Paint |

### Pre-built Templates

| Template | Scopes | Est. Value | Base Sqft |
|----------|--------|------------|-----------|
| Residential - New Build | 10 | $318,000 | 2,000 |
| Residential - Remodel | 9 | $208,000 | 1,800 |
| Residential - Addition | 10 | $190,000 | 800 |
| Commercial - Office Fit-Out | 10 | $400,000 | 5,000 |
| Commercial - Retail Build-Out | 9 | $305,000 | 3,000 |
| Commercial - Warehouse | 10 | $550,000 | 15,000 |

## Project Structure

```
├── client/                  # React frontend
│   ├── src/
│   │   ├── utils/           # Shared utilities (formatting, constants)
│   │   ├── context/         # Auth and API contexts
│   │   ├── pages/           # Page components
│   │   │   ├── Dashboard.jsx
│   │   │   ├── JobsList.jsx
│   │   │   ├── JobDetail.jsx
│   │   │   ├── GanttView.jsx
│   │   │   ├── DailyEntry.jsx
│   │   │   ├── TimesheetEntry.jsx
│   │   │   ├── ApprovalQueue.jsx
│   │   │   ├── Reports.jsx
│   │   │   ├── UserManagement.jsx
│   │   │   ├── TemplateManagement.jsx
│   │   │   ├── MyTasks.jsx
│   │   │   ├── CrewSchedule.jsx
│   │   │   ├── BudgetTracking.jsx
│   │   │   └── AppSettings.jsx
│   │   ├── App.jsx          # Main app with routing, layout, search, toast system
│   │   └── App.css          # All styles
│   └── index.html
├── server/                  # Express backend
│   ├── routes/              # API route handlers (auth, jobs, scopes, activities, tasks, dailyUpdates, timesheets, reports, users, templates, search, notifications, crews, schedule, budget, laborRates, settings)
│   ├── helpers/             # Shared helpers (template nesting, cascade delete, settings)
│   ├── middleware/           # Auth middleware (JWT, requireRole, requireSchedulePermission)
│   ├── db.js                # SQLite database setup (25 tables)
│   ├── seed.js              # Demo data seeder
│   ├── seed-commercial-templates.js  # Commercial template seeder
│   ├── seed-schedule.js     # Schedule demo data seeder
│   ├── seed-new-jobs.js     # Additional jobs seeder (2 jobs, 5 users, 2 crews)
│   └── index.js             # Express server entry
└── package.json             # Root scripts
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Get current user |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | /api/jobs | List/create jobs |
| GET/PUT | /api/jobs/:id | Get/update job detail |
| PUT | /api/jobs/:id/archive | Archive job (Admin) |
| GET | /api/jobs/:id/alerts | Health alerts (overdue, behind schedule, cost overruns, stalled) |
| GET | /api/jobs/:id/cascade-info | Preview cascade impact before archiving |

### WBS (Scopes, Activities, Tasks)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST/PUT/DELETE | /api/scopes | Scope CRUD with cascade |
| POST/PUT/DELETE | /api/activities | Activity CRUD + worker assignments |
| POST/PUT/DELETE | /api/tasks | Task CRUD + dependencies |
| GET | /api/tasks/my | Tasks assigned to current user (active jobs) |
| GET | /api/tasks/job/:jobId/gantt | Gantt chart data |
| PUT | /api/tasks/bulk-schedule | Batch-schedule tasks (auto or manual mode) |
| GET | /api/tasks/job/:jobId/photos | All job photos with task/worker context |

### Daily Updates
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/daily-updates | Submit daily task update + photos |
| GET | /api/daily-updates/pending | Pending updates for approval |
| GET | /api/daily-updates/history | Approved/rejected history (last 50) |
| PUT | /api/daily-updates/:id/approve | Approve update (Foreman/Admin) |
| GET | /api/daily-updates/worker/:workerId | Worker's recent updates (optional ?date filter) |
| PUT | /api/daily-updates/:id/reject | Reject update with note (Foreman/Admin) |

### Timesheets
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/timesheets | Submit timesheet |
| PUT | /api/timesheets/:id | Edit pending/rejected entry (resubmit) |
| DELETE | /api/timesheets/:id | Delete pending/rejected entry |
| GET | /api/timesheets/pending | Pending timesheets |
| GET | /api/timesheets/history | Approved/rejected history (last 50) |
| GET | /api/timesheets/worker/:workerId | Worker's timesheet entries |
| PUT | /api/timesheets/:id/approve | Approve timesheet (Foreman/Admin) |
| PUT | /api/timesheets/:id/reject | Reject timesheet with note (Foreman/Admin) |
| GET | /api/timesheets/summary | Aggregated hours by date range |
| GET | /api/timesheets/payroll | Payroll export: approved hours by worker + date |

### Templates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | /api/templates | List/create templates (PM/Admin) |
| GET/PUT/DELETE | /api/templates/:id | Template CRUD (PM/Admin) |
| POST | /api/templates/:id/duplicate | Clone template (PM/Admin) |
| POST | /api/templates/:id/apply/:jobId | Apply template to job (PM/Admin) |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/reports/dashboard | Dashboard KPIs, pending approvals, delayed tasks, recent activity |
| GET | /api/reports/worker-dashboard | Worker-specific dashboard (assigned tasks, hours, rejections) |
| GET | /api/reports/job/:jobId/progress | Job progress report (scope hours rolled up from activities) |
| GET | /api/reports/production-rates | Production rate data |
| GET | /api/reports/charts | Chart data (job completion, weekly labor, budget utilization) |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | List users (PM/Admin) |
| GET/PUT | /api/users/:id | Get/update user (Admin) |

### Search
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/search?q=term | Search jobs and tasks (top 5 each) |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/notifications | List notifications for current user (last 50) |
| GET | /api/notifications/unread-count | Unread notification count |
| PUT | /api/notifications/:id/read | Mark notification as read |
| PUT | /api/notifications/read-all | Mark all notifications as read |

### Crews
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | /api/crews | List/create crews |
| GET/PUT/DELETE | /api/crews/:id | Crew CRUD with cascade |
| POST | /api/crews/:id/members | Add member to crew |
| DELETE | /api/crews/:id/members/:workerId | Remove member |

### Schedule
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/schedule | Assignments for date range |
| GET | /api/schedule/week | Assignments + availability for a week |
| POST/PUT/DELETE | /api/schedule/:id | Assignment CRUD with conflict detection |
| POST | /api/schedule/check-conflicts | Check double-booking + availability conflicts |
| GET | /api/schedule/available-workers | Workers not booked on a date |
| POST | /api/schedule/bulk | Bulk assign worker/crew to multiple dates |
| GET | /api/schedule/time-tracking | Scheduled vs logged hours comparison |
| GET/POST/DELETE | /api/schedule/availability | Worker unavailability CRUD |

### Budget
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/budget/:jobId | Budget data + summary for a job |
| GET | /api/budget/:jobId/rollup | WBS rollup: budget by scope → activity |
| GET | /api/budget/:jobId/earned-value | Earned value metrics (PV, EV, AC, CPI, SPI) |
| POST | /api/budget/:jobId/items | Create budget item (PM, Admin) |
| PUT | /api/budget/items/:id | Update budget item (PM, Admin) |
| DELETE | /api/budget/items/:id | Delete budget item (PM, Admin) |
| POST | /api/budget/:jobId/change-orders | Create change order (PM, Admin) |
| PUT | /api/budget/change-orders/:id/approve | Approve change order (Admin) |
| PUT | /api/budget/change-orders/:id/reject | Reject change order (Admin) |
| DELETE | /api/budget/change-orders/:id | Delete change order (Admin) |

### Labor Rates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/labor-rates | List all labor rates (PM/Admin) |
| GET | /api/labor-rates/trades | Distinct trade names for autocomplete |
| GET | /api/labor-rates/worker/:workerId | Rates for a specific worker |
| POST | /api/labor-rates | Create labor rate (PM/Admin) |
| PUT | /api/labor-rates/:id | Update labor rate (PM/Admin) |
| DELETE | /api/labor-rates/:id | Delete labor rate (PM/Admin) |

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings | All app settings |
| PUT | /api/settings/:key | Update setting (Admin) |
| GET/PUT/DELETE | /api/settings/jobs/:jobId/:key | Job-level setting overrides |

## Architecture Notes

- **Single CSS file** — All styles centralized in `client/src/App.css` (~2,350 lines). No CSS modules, CSS-in-JS, or Tailwind.
- **No external Gantt library** — Custom-built Gantt chart using pure React + HTML divs for task bars and SVG for dependency arrows.
- **Context API** — `AuthContext` manages JWT auth state; `ApiContext` wraps fetch with auth headers and auto-logout on 401; `ToastContext` provides global toast notifications; `PageTitleContext` enables dynamic breadcrumbs.
- **Global Search** — Debounced header search queries jobs and tasks via `/api/search`, with instant dropdown results.
- **3-tier hierarchy** — All work follows Scope → Activities → Tasks, mirroring construction estimation workflows.
- **Defense-in-depth security** — `ProtectedRoute` (frontend) + `requireRole()` middleware (backend) enforce RBAC at both layers.
- **Mobile-first** — Designed for field workers using phones with gloves. Touch-friendly controls, collapsible sidebar at 900px.
- **All IDs are UUIDs** — UUID v4 strings used for all database primary keys.
- **Atomic transactions** — `db.transaction()` ensures multi-table inserts (templates, apply-to-job) are all-or-nothing.
- **Configurable RBAC** — Schedule permissions stored in `app_settings` table with per-job overrides via `job_settings`. `requireSchedulePermission()` middleware reads allowed roles at runtime.
- **JSDoc documented** — All source files include JSDoc comments for functions, components, and module descriptions.
