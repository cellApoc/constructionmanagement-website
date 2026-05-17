/**
 * @file Interactive Gantt chart view for a job's task schedule.
 * Renders a split-panel layout: left panel with task tree (grouped by scope/activity),
 * right panel with scrollable timeline showing task bars, dependency arrows,
 * critical path highlighting, baseline comparison, and drag-to-reschedule.
 * Implements forward/backward pass algorithm for critical path calculation.
 * Fetches from /api/tasks/job/:jobId/gantt.
 *
 * Features auto-schedule: bulk-assigns dates to all tasks via PUT /api/tasks/bulk-schedule
 * using topological dependency-aware sequencing from a configurable start date.
 *
 * Route: /jobs/:id/gantt — note the param is `id`, aliased to `jobId` in useParams().
 *
 * Data mapping: The API returns dependencies as an array of objects
 * ({id, taskId, predecessorTaskId, type}), which this component maps to a flat
 * `predecessorTaskIds` string array for internal use by the critical path algorithm.
 *
 * Task bars are rendered as HTML <div> elements (not SVG). Only dependency arrows
 * use an SVG overlay (<svg> with <path> elements).
 *
 * Auto-scrolls to the earliest task start date on initial load.
 *
 * @module client/pages/GanttView
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  FileDown,
  Layers,
  Activity,
  AlertTriangle,
  GripHorizontal,
  Info,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { usePageTitle } from '../App';

/** @constant {number} ROW_HEIGHT - Height of each task row in pixels */
const ROW_HEIGHT = 36;
/** @constant {number} HEADER_HEIGHT - Height of the timeline header in pixels */
const HEADER_HEIGHT = 50;
/** @constant {number} MIN_DAY_WIDTH - Minimum zoom level (pixels per day) */
const MIN_DAY_WIDTH = 15;
/** @constant {number} MAX_DAY_WIDTH - Maximum zoom level (pixels per day) */
const MAX_DAY_WIDTH = 60;
/** @constant {number} DEFAULT_DAY_WIDTH - Default zoom level (pixels per day) */
const DEFAULT_DAY_WIDTH = 30;
/** @constant {number} LEFT_PANEL_WIDTH - Width of the task list panel in pixels */
const LEFT_PANEL_WIDTH = 350;

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Safely parses an ISO date string into a Date object.
 * @param {string|null} str - ISO date string
 * @returns {Date|null} Parsed Date or null if invalid
 */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculates the number of days between two dates.
 * @param {Date} a - Start date
 * @param {Date} b - End date
 * @returns {number} Days between a and b (negative if b < a)
 */
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const msPerDay = 86400000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(d) {
  if (!d) return '';
  return d.toISOString().split('T')[0];
}

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function monthLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ── Critical path calculation (forward/backward pass) ─────────────────────────

/**
 * Computes critical path using forward and backward pass scheduling.
 * Tasks with zero total float are on the critical path.
 * @param {Object[]} tasks - Array of task objects with _start, _finish, and predecessorTaskIDs
 * @returns {Set<string>} Set of task IDs that are on the critical path
 */
function computeCriticalPath(tasks) {
  const taskMap = new Map();
  const validTasks = tasks.filter((t) => t._start && t._finish);
  validTasks.forEach((t) => taskMap.set(t.id, { ...t, es: 0, ef: 0, ls: Infinity, lf: Infinity, float: 0 }));

  // Build adjacency: predecessor -> successors
  const successors = new Map();
  const predecessors = new Map();
  validTasks.forEach((t) => {
    predecessors.set(t.id, []);
    if (!successors.has(t.id)) successors.set(t.id, []);
  });
  validTasks.forEach((t) => {
    (t.predecessorTaskIds || []).forEach((predId) => {
      if (taskMap.has(predId)) {
        if (!successors.has(predId)) successors.set(predId, []);
        successors.get(predId).push(t.id);
        predecessors.get(t.id).push(predId);
      }
    });
  });

  // Forward pass: ES, EF
  const visited = new Set();
  function forward(id) {
    if (visited.has(id)) return;
    const preds = predecessors.get(id) || [];
    preds.forEach((p) => forward(p));
    visited.add(id);
    const node = taskMap.get(id);
    const predFinishes = preds.map((p) => taskMap.get(p)?.ef || 0);
    node.es = predFinishes.length > 0 ? Math.max(...predFinishes) : 0;
    node.ef = node.es + node._duration;
  }
  validTasks.forEach((t) => forward(t.id));

  // Project end
  const projectEnd = Math.max(...[...taskMap.values()].map((n) => n.ef), 0);

  // Backward pass: LF, LS
  const visited2 = new Set();
  function backward(id) {
    if (visited2.has(id)) return;
    const succs = successors.get(id) || [];
    succs.forEach((s) => backward(s));
    visited2.add(id);
    const node = taskMap.get(id);
    const succStarts = succs.map((s) => taskMap.get(s)?.ls ?? Infinity);
    node.lf = succStarts.length > 0 ? Math.min(...succStarts) : projectEnd;
    node.ls = node.lf - node._duration;
    node.float = node.ls - node.es;
  }
  validTasks.forEach((t) => backward(t.id));

  const criticalSet = new Set();
  taskMap.forEach((node, id) => {
    if (Math.abs(node.float) < 0.001) criticalSet.add(id);
  });

  return criticalSet;
}

// ── Build grouped tree ────────────────────────────────────────────────────────

function buildGroupedTasks(rawTasks) {
  const scopeMap = new Map();

  rawTasks.forEach((t) => {
    const scopeId = t.scopeId || 'unscoped';
    const scopeName = t.scopeName || 'Unscoped';
    const actId = t.activityId || 'unassigned';
    const actName = t.activityName || 'Unassigned';

    if (!scopeMap.has(scopeId)) {
      scopeMap.set(scopeId, { id: scopeId, name: scopeName, activities: new Map() });
    }
    const scope = scopeMap.get(scopeId);
    if (!scope.activities.has(actId)) {
      scope.activities.set(actId, { id: actId, name: actName, tasks: [] });
    }
    scope.activities.get(actId).tasks.push(t);
  });

  return [...scopeMap.values()].map((s) => ({
    ...s,
    activities: [...s.activities.values()],
  }));
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * GanttView component — interactive Gantt chart for a single job.
 * Extracts jobId from route params (route is /jobs/:id/gantt, so param is `id`).
 * Fetches tasks from the Gantt API endpoint, maps dependency data, computes
 * critical path, and renders a split-panel timeline with auto-scroll.
 * @returns {React.ReactElement} The Gantt chart view
 */
export default function GanttView() {
  /** @type {string} Job UUID extracted from route param `:id` */
  const { id: jobId } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { user } = useAuth();

  const [tasks, setTasks] = useState([]);
  const [jobName, setJobName] = useState('');
  usePageTitle(jobName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // View controls
  const [dayWidth, setDayWidth] = useState(DEFAULT_DAY_WIDTH);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showCriticalPath, setShowCriticalPath] = useState(true);

  // Expand/collapse
  const [collapsedScopes, setCollapsedScopes] = useState({});
  const [collapsedActivities, setCollapsedActivities] = useState({});

  // Selection & detail
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  // Drag state
  const [dragState, setDragState] = useState(null);

  // Bulk schedule modal
  const [bulkScheduleModal, setBulkScheduleModal] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkDuration, setBulkDuration] = useState(5);
  const [bulkScheduling, setBulkScheduling] = useState(false);

  // Scroll sync refs
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const timelineHeaderRef = useRef(null);
  const syncingScroll = useRef(false);

  // ── Fetch data ────────────────────────────────────────────────────────────

  /**
   * Fetches Gantt task data and job metadata from the API.
   * Processes raw tasks: parses dates, computes durations, and maps API dependency
   * objects ({id, taskId, predecessorTaskId, type}) to a flat predecessorTaskIds
   * string array for use by the critical path algorithm.
   */
  const fetchGanttData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.get(`/api/tasks/job/${jobId}/gantt`);
      const jobRes = await api.get(`/api/jobs/${jobId}`);
      setJobName(jobRes?.name || jobRes?.jobNumber || `Job ${jobId}`);

      const processed = (data || []).map((t) => {
        const start = parseDate(t.scheduledStartDate);
        const finish = parseDate(t.scheduledFinishDate);
        const blStart = parseDate(t.baselineStartDate);
        const blFinish = parseDate(t.baselineFinishDate);
        const duration = start && finish ? Math.max(daysBetween(start, finish), 1) : 0;
        // Map dependencies array (API format) to flat predecessorTaskIds array (component format)
        const predecessorTaskIds = (t.dependencies || []).map((d) => d.predecessorTaskId);
        return {
          ...t,
          predecessorTaskIds,
          _start: start,
          _finish: finish,
          _blStart: blStart,
          _blFinish: blFinish,
          _duration: duration,
          _percent: t.currentPercentComplete || 0,
        };
      });

      setTasks(processed);
    } catch (err) {
      setError(err.message || 'Failed to load Gantt data');
    } finally {
      setLoading(false);
    }
  }, [api, jobId]);

  useEffect(() => {
    fetchGanttData();
  }, [fetchGanttData]);

  // ── Computed values ───────────────────────────────────────────────────────

  const criticalSet = useMemo(() => {
    if (!showCriticalPath) return new Set();
    return computeCriticalPath(tasks);
  }, [tasks, showCriticalPath]);

  const groupedScopes = useMemo(() => buildGroupedTasks(tasks), [tasks]);

  // Flat row list for rendering (respecting collapsed state)
  const flatRows = useMemo(() => {
    const rows = [];
    groupedScopes.forEach((scope) => {
      rows.push({ type: 'scope', id: scope.id, name: scope.name });
      if (collapsedScopes[scope.id]) return;
      scope.activities.forEach((act) => {
        rows.push({ type: 'activity', id: act.id, name: act.name, scopeId: scope.id });
        if (collapsedActivities[act.id]) return;
        act.tasks.forEach((t) => {
          rows.push({ type: 'task', ...t });
        });
      });
    });
    return rows;
  }, [groupedScopes, collapsedScopes, collapsedActivities]);

  // Timeline range: earliest start to latest finish with padding
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    const starts = tasks.map((t) => t._start).filter(Boolean);
    const finishes = tasks.map((t) => t._finish).filter(Boolean);
    const blStarts = tasks.map((t) => t._blStart).filter(Boolean);
    const blFinishes = tasks.map((t) => t._blFinish).filter(Boolean);
    const all = [...starts, ...finishes, ...blStarts, ...blFinishes];

    if (all.length === 0) {
      const now = startOfDay(new Date());
      return { timelineStart: now, timelineEnd: addDays(now, 90), totalDays: 90 };
    }

    const minDate = startOfMonth(new Date(Math.min(...all.map((d) => d.getTime()))));
    const maxDate = endOfMonth(new Date(Math.max(...all.map((d) => d.getTime()))));
    const padStart = addDays(minDate, -7);
    const padEnd = addDays(maxDate, 14);
    const days = daysBetween(padStart, padEnd);
    return { timelineStart: padStart, timelineEnd: padEnd, totalDays: Math.max(days, 30) };
  }, [tasks]);

  /**
   * Auto-scroll effect: scrolls the right timeline panel to the earliest task
   * start date on initial load, so bars are immediately visible.
   * Must be declared AFTER the timelineStart useMemo to avoid temporal dead zone.
   * Scrolls 2 days before the first task for visual padding.
   */
  useEffect(() => {
    if (tasks.length === 0 || !rightPanelRef.current) return;
    const firstStart = tasks.map((t) => t._start).filter(Boolean).sort((a, b) => a - b)[0];
    const scrollTarget = firstStart || new Date();
    const offsetDays = daysBetween(timelineStart, scrollTarget);
    const scrollX = Math.max((offsetDays - 2) * dayWidth, 0);
    rightPanelRef.current.scrollLeft = scrollX;
    if (timelineHeaderRef.current) timelineHeaderRef.current.scrollLeft = scrollX;
  }, [tasks, timelineStart, dayWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Month headers
  const monthHeaders = useMemo(() => {
    const months = [];
    let cursor = startOfMonth(timelineStart);
    while (cursor < timelineEnd) {
      const mStart = cursor < timelineStart ? timelineStart : cursor;
      const mEnd = endOfMonth(cursor);
      const mEndClamped = mEnd > timelineEnd ? timelineEnd : mEnd;
      const offsetDays = daysBetween(timelineStart, mStart);
      const widthDays = daysBetween(mStart, mEndClamped) + 1;
      months.push({
        label: monthLabel(cursor),
        left: offsetDays * dayWidth,
        width: widthDays * dayWidth,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return months;
  }, [timelineStart, timelineEnd, dayWidth]);

  // Day columns (for grid lines)
  const dayColumns = useMemo(() => {
    const cols = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(timelineStart, i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      cols.push({ left: i * dayWidth, date: d, isWeekend, dayOfMonth: d.getDate() });
    }
    return cols;
  }, [timelineStart, totalDays, dayWidth]);

  // Today line position
  const todayOffset = useMemo(() => {
    const today = startOfDay(new Date());
    const offset = daysBetween(timelineStart, today);
    if (offset < 0 || offset > totalDays) return null;
    return offset * dayWidth;
  }, [timelineStart, totalDays, dayWidth]);

  // Task row index map (for dependency arrows)
  const taskRowMap = useMemo(() => {
    const map = new Map();
    flatRows.forEach((row, idx) => {
      if (row.type === 'task') map.set(row.id, idx);
    });
    return map;
  }, [flatRows]);

  // ── Scroll sync ───────────────────────────────────────────────────────────

  const handleLeftScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (rightPanelRef.current && leftPanelRef.current) {
      rightPanelRef.current.scrollTop = leftPanelRef.current.scrollTop;
    }
    requestAnimationFrame(() => { syncingScroll.current = false; });
  }, []);

  const handleRightScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (leftPanelRef.current && rightPanelRef.current) {
      leftPanelRef.current.scrollTop = rightPanelRef.current.scrollTop;
    }
    if (timelineHeaderRef.current && rightPanelRef.current) {
      timelineHeaderRef.current.scrollLeft = rightPanelRef.current.scrollLeft;
    }
    requestAnimationFrame(() => { syncingScroll.current = false; });
  }, []);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const zoomIn = () => setDayWidth((w) => Math.min(w + 5, MAX_DAY_WIDTH));
  const zoomOut = () => setDayWidth((w) => Math.max(w - 5, MIN_DAY_WIDTH));

  // ── Bulk auto-schedule ──────────────────────────────────────────────────

  /**
   * Sends a bulk auto-schedule request to the server. All tasks in the job are
   * assigned dates based on dependency order starting from bulkStartDate, with
   * each task getting bulkDuration days. Refreshes the Gantt data on success.
   */
  const handleBulkSchedule = async () => {
    if (!bulkStartDate) return;
    setBulkScheduling(true);
    try {
      await api.put('/api/tasks/bulk-schedule', {
        mode: 'auto',
        jobId,
        startDate: bulkStartDate,
        defaultDuration: parseInt(bulkDuration) || 5,
      });
      setBulkScheduleModal(false);
      await fetchGanttData();
    } catch (err) {
      setError('Auto-schedule failed: ' + (err.message || 'Unknown error'));
    } finally {
      setBulkScheduling(false);
    }
  };

  // ── Collapse toggles ─────────────────────────────────────────────────────

  const toggleScope = (id) =>
    setCollapsedScopes((s) => ({ ...s, [id]: !s[id] }));
  const toggleActivity = (id) =>
    setCollapsedActivities((s) => ({ ...s, [id]: !s[id] }));

  // ── Drag to reschedule ────────────────────────────────────────────────────

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const handleBarMouseDown = useCallback(
    (e, task) => {
      if (isMobile) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const origStart = task._start;
      const origFinish = task._finish;

      setDragState({ taskId: task.id, startX, origStart, origFinish, deltaDays: 0 });

      const handleMove = (moveE) => {
        const dx = moveE.clientX - startX;
        const deltaDays = Math.round(dx / dayWidth);
        setDragState((prev) => (prev ? { ...prev, deltaDays } : null));
      };

      const handleUp = async (upE) => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);

        const dx = upE.clientX - startX;
        const deltaDays = Math.round(dx / dayWidth);

        setDragState(null);

        if (deltaDays === 0) return;

        const newStart = addDays(origStart, deltaDays);
        const newFinish = addDays(origFinish, deltaDays);

        try {
          await api.put(`/api/tasks/${task.id}`, {
            scheduledStartDate: formatDateFull(newStart),
            scheduledFinishDate: formatDateFull(newFinish),
          });
          await fetchGanttData();
        } catch (err) {
          setError('Failed to update task dates: ' + err.message);
        }
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [dayWidth, api, fetchGanttData, isMobile]
  );

  // ── Get bar position for a task ───────────────────────────────────────────

  const getBarPosition = useCallback(
    (task) => {
      if (!task._start || !task._finish) return null;

      let start = task._start;
      let finish = task._finish;

      // Apply drag offset
      if (dragState && dragState.taskId === task.id) {
        start = addDays(start, dragState.deltaDays);
        finish = addDays(finish, dragState.deltaDays);
      }

      const offsetDays = daysBetween(timelineStart, start);
      const durationDays = Math.max(daysBetween(start, finish), 1);

      return {
        left: offsetDays * dayWidth,
        width: durationDays * dayWidth,
        finishLeft: (offsetDays + durationDays) * dayWidth,
      };
    },
    [timelineStart, dayWidth, dragState]
  );

  // ── Dependency arrows SVG ─────────────────────────────────────────────────

  const dependencyPaths = useMemo(() => {
    if (!showDependencies) return [];
    const paths = [];

    flatRows.forEach((row) => {
      if (row.type !== 'task' || !row.predecessorTaskIds?.length) return;
      const succIdx = taskRowMap.get(row.id);
      if (succIdx === undefined) return;
      const succPos = getBarPosition(row);
      if (!succPos) return;

      row.predecessorTaskIds.forEach((predId) => {
        const predIdx = taskRowMap.get(predId);
        if (predIdx === undefined) return;
        const predTask = flatRows[predIdx];
        if (!predTask || predTask.type !== 'task') return;
        const predPos = getBarPosition(predTask);
        if (!predPos) return;

        // Finish-to-Start: arrow from pred finish to succ start
        const x1 = predPos.finishLeft;
        const y1 = predIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x2 = succPos.left;
        const y2 = succIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

        // Route: right from pred, down/up, then right to succ
        const midX = Math.max(x1 + 10, (x1 + x2) / 2);

        const pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        paths.push({ key: `${predId}-${row.id}`, d: pathD, x2, y2 });
      });
    });

    return paths;
  }, [showDependencies, flatRows, taskRowMap, getBarPosition]);

  // ── Selected task detail ──────────────────────────────────────────────────

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <div className="spinner" style={{ margin: '0 auto 12px', width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p>Loading Gantt chart...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
        <h2 style={{ color: '#1f2937', marginBottom: 8 }}>Failed to Load Gantt Chart</h2>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>{error}</p>
        <button onClick={fetchGanttData} style={btnStyle}>Retry</button>
        <button onClick={() => navigate(`/jobs/${jobId}`)} style={{ ...btnStyle, marginLeft: 8, background: '#6b7280' }}>
          Back to Job
        </button>
      </div>
    );
  }

  const timelineWidth = totalDays * dayWidth;
  const contentHeight = flatRows.length * ROW_HEIGHT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-height, 60px) - 32px)', background: '#f9fafb', overflow: 'hidden', maxWidth: '100%' }}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={toolbarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => navigate(`/jobs/${jobId}`)} style={toolBtnStyle} title="Back to Job">
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#1f2937', margin: 0, whiteSpace: 'nowrap' }}>
            {jobName} — Gantt Chart
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Zoom */}
          <button onClick={zoomOut} style={toolBtnStyle} title="Zoom Out" disabled={dayWidth <= MIN_DAY_WIDTH}>
            <ZoomOut size={16} />
          </button>
          <span style={{ fontSize: 12, color: '#6b7280', minWidth: 32, textAlign: 'center' }}>
            {dayWidth}px
          </span>
          <button onClick={zoomIn} style={toolBtnStyle} title="Zoom In" disabled={dayWidth >= MAX_DAY_WIDTH}>
            <ZoomIn size={16} />
          </button>

          <div style={dividerStyle} />

          {/* Toggles */}
          <button
            onClick={() => setShowCriticalPath((v) => !v)}
            style={{ ...toolBtnStyle, ...(showCriticalPath ? activeToggleStyle : {}) }}
            title="Toggle Critical Path"
          >
            <Activity size={14} />
            <span style={{ fontSize: 12, marginLeft: 4 }}>Critical</span>
          </button>
          <button
            onClick={() => setShowDependencies((v) => !v)}
            style={{ ...toolBtnStyle, ...(showDependencies ? activeToggleStyle : {}) }}
            title="Toggle Dependencies"
          >
            {showDependencies ? <Eye size={14} /> : <EyeOff size={14} />}
            <span style={{ fontSize: 12, marginLeft: 4 }}>Deps</span>
          </button>
          <button
            onClick={() => setShowBaseline((v) => !v)}
            style={{ ...toolBtnStyle, ...(showBaseline ? activeToggleStyle : {}) }}
            title="Toggle Baseline"
          >
            <Layers size={14} />
            <span style={{ fontSize: 12, marginLeft: 4 }}>Baseline</span>
          </button>

          <div style={dividerStyle} />

          <button
            onClick={() => { setBulkStartDate(new Date().toISOString().split('T')[0]); setBulkScheduleModal(true); }}
            style={toolBtnStyle}
            title="Auto-schedule all tasks based on dependencies"
          >
            <GripHorizontal size={14} />
            <span style={{ fontSize: 12, marginLeft: 4 }}>Auto Schedule</span>
          </button>

          <button onClick={() => alert('PDF export coming soon')} style={toolBtnStyle} title="Export PDF">
            <FileDown size={14} />
            <span style={{ fontSize: 12, marginLeft: 4 }}>PDF</span>
          </button>
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────────── */}
      <div style={legendBarStyle}>
        <LegendItem color="#ef4444" label="Critical Path" />
        <LegendItem color="#3b82f6" label="Normal" />
        <LegendItem color="#10b981" label="Complete" />
        {showBaseline && <LegendItem color="#9ca3af" label="Baseline" dashed />}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#b91c1c', fontSize: 13, borderBottom: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      {tasks.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
          <div style={{ textAlign: 'center' }}>
            <GripHorizontal size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ fontSize: 16, fontWeight: 500 }}>No tasks scheduled yet</p>
            <p style={{ fontSize: 13 }}>Add tasks with dates in the Job Detail view to see them here.</p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* ── Left Panel: Task List ──────────────────────────────────────── */}
          <div style={{ width: LEFT_PANEL_WIDTH, minWidth: LEFT_PANEL_WIDTH, borderRight: '2px solid #e5e7eb', display: 'flex', flexDirection: 'column', background: '#fff' }}>
            {/* Table header */}
            <div style={tableHeaderStyle}>
              <div style={{ flex: 1, paddingLeft: 8 }}>Task</div>
              <div style={{ width: 70, textAlign: 'center', fontSize: 11 }}>Start</div>
              <div style={{ width: 70, textAlign: 'center', fontSize: 11 }}>Finish</div>
              <div style={{ width: 36, textAlign: 'center', fontSize: 11 }}>%</div>
            </div>

            {/* Scrollable task list */}
            <div ref={leftPanelRef} onScroll={handleLeftScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              <div style={{ height: contentHeight }}>
                {flatRows.map((row, idx) => {
                  if (row.type === 'scope') {
                    return (
                      <div
                        key={`scope-${row.id}`}
                        onClick={() => toggleScope(row.id)}
                        style={{ ...rowBaseStyle, height: ROW_HEIGHT, background: '#f3f4f6', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
                      >
                        {collapsedScopes[row.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <Layers size={12} style={{ marginLeft: 4, color: '#6b7280' }} />
                        <span style={{ marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {row.name}
                        </span>
                      </div>
                    );
                  }

                  if (row.type === 'activity') {
                    return (
                      <div
                        key={`act-${row.id}`}
                        onClick={() => toggleActivity(row.id)}
                        style={{ ...rowBaseStyle, height: ROW_HEIGHT, background: '#f9fafb', cursor: 'pointer', paddingLeft: 20, fontWeight: 500, fontSize: 12, color: '#4b5563' }}
                      >
                        {collapsedActivities[row.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Activity size={11} style={{ marginLeft: 4, color: '#9ca3af' }} />
                        <span style={{ marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {row.name}
                        </span>
                      </div>
                    );
                  }

                  // Task row
                  const isSelected = selectedTaskId === row.id;
                  const isCritical = criticalSet.has(row.id);
                  return (
                    <div
                      key={`task-${row.id}`}
                      onClick={() => setSelectedTaskId(isSelected ? null : row.id)}
                      style={{
                        ...rowBaseStyle,
                        height: ROW_HEIGHT,
                        paddingLeft: 36,
                        fontSize: 12,
                        color: '#1f2937',
                        cursor: 'pointer',
                        background: isSelected ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#fafafa',
                        borderLeft: isCritical ? '3px solid #ef4444' : '3px solid transparent',
                      }}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.name}
                      </span>
                      <span style={{ width: 70, textAlign: 'center', fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
                        {formatDate(row._start)}
                      </span>
                      <span style={{ width: 70, textAlign: 'center', fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
                        {formatDate(row._finish)}
                      </span>
                      <span style={{ width: 36, textAlign: 'center', fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
                        {row._percent}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right Panel: Timeline ─────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Timeline header (month + day labels) */}
            <div
              ref={timelineHeaderRef}
              style={{ height: HEADER_HEIGHT, borderBottom: '1px solid #e5e7eb', overflow: 'hidden', background: '#fff', flexShrink: 0 }}
            >
              <div style={{ width: timelineWidth, position: 'relative', height: '100%' }}>
                {/* Month row */}
                {monthHeaders.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: m.left,
                      width: m.width,
                      top: 0,
                      height: 24,
                      borderRight: '1px solid #d1d5db',
                      borderBottom: '1px solid #e5e7eb',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#374151',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 6,
                      background: '#f9fafb',
                    }}
                  >
                    {m.label}
                  </div>
                ))}
                {/* Day numbers (only shown when zoom is large enough) */}
                {dayWidth >= 22 &&
                  dayColumns.map((col, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: col.left,
                        width: dayWidth,
                        top: 24,
                        height: 26,
                        fontSize: 9,
                        color: col.isWeekend ? '#9ca3af' : '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRight: '1px solid #f3f4f6',
                      }}
                    >
                      {col.dayOfMonth}
                    </div>
                  ))}
              </div>
            </div>

            {/* Scrollable chart area */}
            <div
              ref={rightPanelRef}
              onScroll={handleRightScroll}
              style={{ flex: 1, overflow: 'auto', position: 'relative', WebkitOverflowScrolling: 'touch' }}
            >
              <div style={{ width: timelineWidth, height: contentHeight, position: 'relative' }}>
                {/* Grid background: weekend shading and day lines */}
                {dayColumns.map((col, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: col.left,
                      top: 0,
                      width: dayWidth,
                      height: contentHeight,
                      background: col.isWeekend ? 'rgba(243,244,246,0.6)' : 'transparent',
                      borderRight: '1px solid #f3f4f6',
                    }}
                  />
                ))}

                {/* Row backgrounds */}
                {flatRows.map((row, idx) => {
                  if (row.type === 'scope') {
                    return (
                      <div key={`bg-scope-${row.id}`} style={{ position: 'absolute', top: idx * ROW_HEIGHT, left: 0, width: '100%', height: ROW_HEIGHT, background: '#f3f4f6' }} />
                    );
                  }
                  if (row.type === 'activity') {
                    return (
                      <div key={`bg-act-${row.id}`} style={{ position: 'absolute', top: idx * ROW_HEIGHT, left: 0, width: '100%', height: ROW_HEIGHT, background: '#f9fafb' }} />
                    );
                  }
                  return (
                    <div
                      key={`bg-task-${row.id}`}
                      style={{
                        position: 'absolute',
                        top: idx * ROW_HEIGHT,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        background: selectedTaskId === row.id ? '#eff6ff' : 'transparent',
                      }}
                    />
                  );
                })}

                {/* Task bars */}
                {flatRows.map((row, idx) => {
                  if (row.type !== 'task') return null;
                  const pos = getBarPosition(row);
                  if (!pos) return null;

                  const isCritical = criticalSet.has(row.id);
                  const barColor = isCritical ? '#ef4444' : '#3b82f6';
                  const barBg = isCritical ? '#fecaca' : '#dbeafe';
                  const progressColor = row._percent >= 100 ? '#10b981' : barColor;
                  const barTop = idx * ROW_HEIGHT + 8;
                  const barHeight = 20;

                  return (
                    <div key={`bar-${row.id}`}>
                      {/* Baseline bar (below main bar) */}
                      {showBaseline && row._blStart && row._blFinish && (
                        <div
                          style={{
                            position: 'absolute',
                            top: barTop + barHeight + 1,
                            left: daysBetween(timelineStart, row._blStart) * dayWidth,
                            width: Math.max(daysBetween(row._blStart, row._blFinish), 1) * dayWidth,
                            height: 4,
                            background: '#9ca3af',
                            borderRadius: 2,
                            opacity: 0.6,
                          }}
                        />
                      )}

                      {/* Main bar */}
                      <div
                        onMouseDown={(e) => handleBarMouseDown(e, row)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTaskId(selectedTaskId === row.id ? null : row.id);
                        }}
                        style={{
                          position: 'absolute',
                          top: barTop,
                          left: pos.left,
                          width: Math.max(pos.width, dayWidth * 0.5),
                          height: barHeight,
                          background: barBg,
                          borderRadius: 3,
                          cursor: isMobile ? 'pointer' : 'ew-resize',
                          border: selectedTaskId === row.id ? `2px solid ${barColor}` : '1px solid ' + (isCritical ? '#f87171' : '#93c5fd'),
                          overflow: 'hidden',
                          transition: dragState?.taskId === row.id ? 'none' : 'left 0.15s ease',
                          boxShadow: selectedTaskId === row.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                          zIndex: selectedTaskId === row.id ? 10 : 1,
                        }}
                        title={`${row.name}\n${formatDate(row._start)} — ${formatDate(row._finish)}\n${row._percent}% complete`}
                      >
                        {/* Progress fill */}
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(row._percent, 100)}%`,
                            background: progressColor,
                            borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }}
                        />
                        {/* Label on bar (if wide enough) */}
                        {pos.width > 60 && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 6,
                              right: 6,
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              fontSize: 10,
                              fontWeight: 500,
                              color: '#1f2937',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              pointerEvents: 'none',
                            }}
                          >
                            {row.name}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Dependency arrows SVG */}
                {dependencyPaths.length > 0 && (
                  <svg
                    style={{ position: 'absolute', top: 0, left: 0, width: timelineWidth, height: contentHeight, pointerEvents: 'none', zIndex: 5 }}
                  >
                    <defs>
                      <marker id="gantt-arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
                      </marker>
                    </defs>
                    {dependencyPaths.map((p) => (
                      <path
                        key={p.key}
                        d={p.d}
                        fill="none"
                        stroke="#6b7280"
                        strokeWidth={1.5}
                        markerEnd="url(#gantt-arrowhead)"
                        opacity={0.6}
                      />
                    ))}
                  </svg>
                )}

                {/* Today line */}
                {todayOffset !== null && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: todayOffset,
                      width: 0,
                      height: contentHeight,
                      borderLeft: '2px dashed #ef4444',
                      zIndex: 15,
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: -2,
                        left: -16,
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#ef4444',
                        background: '#fff',
                        padding: '1px 4px',
                        borderRadius: 3,
                        border: '1px solid #fecaca',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Today
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Detail side panel ─────────────────────────────────────────── */}
          {selectedTask && (
            <div style={detailPanelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#1f2937', margin: 0 }}>Task Details</h3>
                <button onClick={() => setSelectedTaskId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 2 }}>
                  &times;
                </button>
              </div>
              <DetailRow label="Name" value={selectedTask.name} />
              <DetailRow label="Scope" value={selectedTask.scopeName} />
              <DetailRow label="Activity" value={selectedTask.activityName} />
              <DetailRow label="Start" value={formatDate(selectedTask._start)} />
              <DetailRow label="Finish" value={formatDate(selectedTask._finish)} />
              <DetailRow label="Duration" value={`${selectedTask._duration} day${selectedTask._duration !== 1 ? 's' : ''}`} />
              <DetailRow label="% Complete" value={`${selectedTask._percent}%`} />
              {showBaseline && selectedTask._blStart && (
                <>
                  <DetailRow label="BL Start" value={formatDate(selectedTask._blStart)} />
                  <DetailRow label="BL Finish" value={formatDate(selectedTask._blFinish)} />
                </>
              )}
              {selectedTask.predecessorTaskIds?.length > 0 && (
                <DetailRow
                  label="Predecessors"
                  value={selectedTask.predecessorTaskIds
                    .map((pid) => {
                      const pt = tasks.find((t) => t.id === pid);
                      return pt?.name || `#${pid}`;
                    })
                    .join(', ')}
                />
              )}
              {criticalSet.has(selectedTask.id) && (
                <div style={{ marginTop: 8, padding: '4px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#b91c1c' }}>
                  This task is on the critical path
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk Schedule Modal */}
      {bulkScheduleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setBulkScheduleModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 16 }}>Auto-Schedule Tasks</h2>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: 12 }}>
              Automatically assign dates to all {tasks.length} tasks based on their dependency order and sort position. Tasks with dependencies will start after their predecessors finish.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#fef3c7', borderRadius: 8, marginBottom: 16, border: '1px solid #fbbf24' }}>
              <AlertTriangle size={16} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: '0.8rem', color: '#92400e', margin: 0 }}>
                This will overwrite all existing task dates. Any manually set schedules will be replaced.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>Project Start Date</label>
                <input
                  type="date"
                  value={bulkStartDate}
                  onChange={e => setBulkStartDate(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.875rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>Default Task Duration (days)</label>
                <input
                  type="number"
                  value={bulkDuration}
                  onChange={e => setBulkDuration(e.target.value)}
                  min="1"
                  max="90"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.875rem' }}
                />
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>Each task without dependencies gets this duration. Dependent tasks start after their predecessors.</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setBulkScheduleModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
              <button onClick={handleBulkSchedule} disabled={!bulkStartDate || bulkScheduling} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: (!bulkStartDate || bulkScheduling) ? 0.5 : 1 }}>
                {bulkScheduling ? 'Scheduling...' : 'Auto Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LegendItem({ color, label, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 16 }}>
      <div
        style={{
          width: 14,
          height: 8,
          borderRadius: 2,
          background: dashed ? 'transparent' : color,
          border: dashed ? `2px dashed ${color}` : 'none',
        }}
      />
      <span style={{ fontSize: 11, color: '#6b7280' }}>{label}</span>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', marginBottom: 6, fontSize: 12 }}>
      <span style={{ width: 90, color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#1f2937', fontWeight: 500, wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const btnStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#3b82f6',
  color: '#fff',
  fontWeight: 500,
  cursor: 'pointer',
  fontSize: 14,
};

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  borderBottom: '1px solid #e5e7eb',
  background: '#fff',
  flexWrap: 'wrap',
  gap: 8,
  flexShrink: 0,
};

const toolBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 8px',
  borderRadius: 5,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  transition: 'background 0.15s',
};

const activeToggleStyle = {
  background: '#eff6ff',
  borderColor: '#93c5fd',
  color: '#2563eb',
};

const dividerStyle = {
  width: 1,
  height: 20,
  background: '#e5e7eb',
  margin: '0 4px',
};

const legendBarStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 16px',
  borderBottom: '1px solid #e5e7eb',
  background: '#fff',
  flexShrink: 0,
};

const tableHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  height: HEADER_HEIGHT,
  borderBottom: '1px solid #e5e7eb',
  padding: '0 8px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  background: '#f9fafb',
  flexShrink: 0,
};

const rowBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  borderBottom: '1px solid #f3f4f6',
  boxSizing: 'border-box',
};

const detailPanelStyle = {
  width: 260,
  minWidth: 260,
  borderLeft: '1px solid #e5e7eb',
  background: '#fff',
  padding: 16,
  overflowY: 'auto',
  flexShrink: 0,
};
