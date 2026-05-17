/**
 * @file Reports and analytics page with four sections:
 * (1) Company Dashboard Metrics — stat cards for active jobs, avg completion, total labor hours.
 * (2) Job Progress Report — select a job to see scope/activity breakdown with progress bars.
 * (3) Production Rates — activity-level metrics for estimation feedback.
 * (4) Payroll Export — date range picker to load and export approved timesheets grouped by worker + date.
 * All sections support CSV and PDF export (print-to-PDF via styled HTML in hidden iframe).
 * Payroll data fetched from GET /api/timesheets/payroll.
 * @module client/pages/Reports
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Briefcase,
  Clock,
  Download,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { getProgressClass } from '../utils/formatting';

/**
 * Reports - Analytics and reporting page for Project Managers and Admins.
 * Sections: Company Dashboard Metrics, Job Progress Report (with collapsible
 * scope/activity table and labor vs budget visualization), and Production Rates.
 * CSV export available for each section.
 * @component
 * @returns {JSX.Element} Reports page with metrics, progress, and production data
 */
export default function Reports() {
  const api = useApi();

  // Job progress state
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [jobProgress, setJobProgress] = useState(null);
  const [loadingJobProgress, setLoadingJobProgress] = useState(false);

  // Production rates state
  const [productionRates, setProductionRates] = useState([]);
  const [loadingProduction, setLoadingProduction] = useState(true);

  // Dashboard metrics state
  const [dashboardMetrics, setDashboardMetrics] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  // Expanded scopes in the progress report
  const [expandedScopes, setExpandedScopes] = useState({});

  // Payroll export state
  const [payrollStartDate, setPayrollStartDate] = useState('');
  const [payrollEndDate, setPayrollEndDate] = useState('');
  const [payrollData, setPayrollData] = useState(null);
  const [loadingPayroll, setLoadingPayroll] = useState(false);

  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Fetch jobs list for dropdown
  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      try {
        const data = await api.get('/api/jobs');
        if (!cancelled) {
          setJobs(Array.isArray(data) ? data : data?.jobs || []);
        }
      } catch {
        // Non-critical
      }
    }
    fetchJobs();
    return () => { cancelled = true; };
  }, [api]);

  // Fetch production rates
  useEffect(() => {
    let cancelled = false;
    async function fetchRates() {
      setLoadingProduction(true);
      try {
        const data = await api.get('/api/reports/production-rates');
        if (!cancelled) {
          setProductionRates(Array.isArray(data) ? data : data?.rates || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load production rates');
      } finally {
        if (!cancelled) setLoadingProduction(false);
      }
    }
    fetchRates();
    return () => { cancelled = true; };
  }, [api]);

  // Fetch dashboard metrics
  useEffect(() => {
    let cancelled = false;
    async function fetchDashboard() {
      setLoadingDashboard(true);
      try {
        const data = await api.get('/api/reports/dashboard');
        if (!cancelled) setDashboardMetrics(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load dashboard metrics');
      } finally {
        if (!cancelled) setLoadingDashboard(false);
      }
    }
    fetchDashboard();
    return () => { cancelled = true; };
  }, [api]);

  // Fetch job progress when selection changes
  useEffect(() => {
    if (!selectedJobId) {
      setJobProgress(null);
      return;
    }
    let cancelled = false;
    async function fetchProgress() {
      setLoadingJobProgress(true);
      setError('');
      try {
        const data = await api.get(`/api/reports/job/${selectedJobId}/progress`);
        if (!cancelled) setJobProgress(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load job progress');
      } finally {
        if (!cancelled) setLoadingJobProgress(false);
      }
    }
    fetchProgress();
    return () => { cancelled = true; };
  }, [api, selectedJobId]);

  function toggleScope(scopeId) {
    setExpandedScopes((prev) => ({ ...prev, [scopeId]: !prev[scopeId] }));
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  /**
   * Generates a CSV file from headers and rows data and triggers a download.
   * Handles CSV escaping for commas, quotes, and newlines.
   * @param {string[]} headers - Column header names
   * @param {Array<Array<string|number>>} rows - 2D array of cell values
   * @param {string} filename - Download filename (e.g., 'report.csv')
   */
  function exportTableToCsv(headers, rows, filename) {
    const escape = (val) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const lines = [
      headers.map(escape).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Generates a styled PDF report by opening a print dialog with formatted HTML
   * content rendered in a hidden iframe. Zero external dependencies — uses the
   * browser's native print-to-PDF functionality.
   * @param {string} title - Report title shown at top of PDF
   * @param {string[]} headers - Column header names
   * @param {Array<Array<string|number>>} rows - 2D array of cell values
   * @param {Object} [options] - Optional configuration
   * @param {string} [options.subtitle] - Subtitle or description line below title
   * @param {Array<{label:string, value:string|number}>} [options.summaryCards] - Summary stat cards above the table
   * @param {Array<Array<string|number>>} [options.footerRow] - Optional totals row rendered in <tfoot>
   */
  function exportTableToPdf(title, headers, rows, options = {}) {
    const { subtitle, summaryCards, footerRow } = options;
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const summaryHtml = summaryCards && summaryCards.length > 0
      ? `<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">${summaryCards.map(c =>
          `<div style="flex:1;min-width:140px;background:#f0f4ff;border-radius:8px;padding:14px 18px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#2563eb">${c.value}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px">${c.label}</div>
          </div>`
        ).join('')}</div>`
      : '';

    const footerHtml = footerRow
      ? `<tfoot><tr style="font-weight:700;border-top:2px solid #334155">${footerRow.map(v =>
          `<td style="padding:8px 12px">${v ?? ''}</td>`).join('')}</tr></tfoot>`
      : '';

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #64748b; margin-bottom: 4px; }
  .date { font-size: 11px; color: #94a3b8; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; border-bottom: 2px solid #cbd5e1; }
  td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  @media print { body { padding: 16px; } @page { size: landscape; margin: 12mm; } }
</style></head><body>
  <h1>${title}</h1>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  <div class="date">Generated ${now}</div>
  ${summaryHtml}
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
    ${footerHtml}
  </table>
</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for content to render before printing
    iframe.contentWindow.onafterprint = () => {
      document.body.removeChild(iframe);
    };
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Fallback cleanup if onafterprint doesn't fire (e.g. Safari)
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 5000);
    }, 300);
  }

  /** PDF export: Company Dashboard Metrics */
  function handleExportDashboardPdf() {
    if (!dashboardMetrics) return;
    exportTableToPdf(
      'Company Dashboard Metrics',
      ['Metric', 'Value'],
      [
        ['Active Jobs', dashboardMetrics.totalActiveJobs ?? dashboardMetrics.activeJobs ?? '--'],
        ['Average Completion', `${Math.round(dashboardMetrics.averageCompletion ?? dashboardMetrics.avgCompletion ?? 0)}%`],
        ['Total Labor Hours', dashboardMetrics.totalLaborHours ?? dashboardMetrics.totalLaborHoursThisWeek ?? '--'],
      ],
      {
        summaryCards: [
          { label: 'Active Jobs', value: dashboardMetrics.totalActiveJobs ?? dashboardMetrics.activeJobs ?? 0 },
          { label: 'Avg Completion', value: `${Math.round(dashboardMetrics.averageCompletion ?? dashboardMetrics.avgCompletion ?? 0)}%` },
          { label: 'Labor Hours', value: dashboardMetrics.totalLaborHours ?? dashboardMetrics.totalLaborHoursThisWeek ?? 0 },
        ],
      }
    );
    showToast('PDF opening in print dialog');
  }

  /** PDF export: Job Progress Report */
  function handleExportJobProgressPdf() {
    if (!jobProgress) return;
    const scopes = jobProgress.scopes || [];
    const jobName = jobs.find(j => (j._id || j.id) === selectedJobId)?.name || 'Job';
    const headers = ['Scope / Activity', '% Complete', 'Est. Hours', 'Actual Hours', 'Status'];
    const rows = [];
    scopes.forEach((scope) => {
      const scopePct = scope.percentComplete ?? 0;
      const estH = scope.estimatedHours ?? '--';
      const actH = scope.actualHours ?? '--';
      const status = typeof estH === 'number' && typeof actH === 'number' && estH > 0
        ? (actH > estH ? '⚠ Over budget' : '✓ On track')
        : '';
      rows.push([`<strong>${scope.name}</strong>`, `${Math.round(scopePct)}%`, estH, actH, status]);
      (scope.activities || []).forEach((act) => {
        rows.push([`&nbsp;&nbsp;&nbsp;&nbsp;${act.name}`, `${Math.round(act.percentComplete ?? 0)}%`, act.estimatedHours ?? '--', act.actualHours ?? '--', '']);
      });
    });
    exportTableToPdf('Job Progress Report', headers, rows, {
      subtitle: `${jobName} — ${Math.round(jobProgress.overallPercentComplete ?? jobProgress.overallPercent ?? 0)}% overall`,
    });
    showToast('PDF opening in print dialog');
  }

  /** PDF export: Production Rates */
  function handleExportProductionRatesPdf() {
    if (productionRates.length === 0) return;
    const headers = ['Activity', 'Tasks', 'Avg Completion', 'Labor Hours', 'Tasks/Hour'];
    const rows = productionRates.map((r) => [
      r.activityName || r.name || '',
      r.taskCount ?? '--',
      r.avgCompletion != null ? `${Math.round(r.avgCompletion)}%` : '--',
      formatNumber(r.totalLaborHours),
      formatNumber(r.tasksCompletedPerHour),
    ]);
    exportTableToPdf('Production Rates', headers, rows);
    showToast('PDF opening in print dialog');
  }

  function handleExportJobProgress() {
    if (!jobProgress) return;
    const scopes = jobProgress.scopes || [];
    const headers = ['Scope', 'Activity', '% Complete', 'Estimated Hours', 'Actual Hours'];
    const rows = [];
    scopes.forEach((scope) => {
      rows.push([scope.name, '', scope.percentComplete ?? 0, scope.estimatedHours ?? '', scope.actualHours ?? '']);
      (scope.activities || []).forEach((act) => {
        rows.push(['', act.name, act.percentComplete ?? 0, act.estimatedHours ?? '', act.actualHours ?? '']);
      });
    });
    exportTableToCsv(headers, rows, `job-progress-${selectedJobId}.csv`);
  }

  function handleExportProductionRates() {
    const headers = ['Activity', 'Tasks', 'Avg Completion %', 'Labor Hours', 'Tasks/Hour'];
    const rows = productionRates.map((r) => [
      r.activityName || r.name || '',
      r.taskCount ?? '',
      r.avgCompletion != null ? `${Math.round(r.avgCompletion)}%` : '',
      r.totalLaborHours ?? '',
      r.tasksCompletedPerHour != null ? parseFloat(r.tasksCompletedPerHour).toFixed(2) : '',
    ]);
    exportTableToCsv(headers, rows, 'production-rates.csv');
  }

  function handleExportDashboard() {
    if (!dashboardMetrics) return;
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Active Jobs', dashboardMetrics.totalActiveJobs ?? dashboardMetrics.activeJobs ?? ''],
      ['Average Completion', `${Math.round(dashboardMetrics.averageCompletion ?? dashboardMetrics.avgCompletion ?? 0)}%`],
      ['Total Labor Hours', dashboardMetrics.totalLaborHours ?? dashboardMetrics.totalLaborHoursThisWeek ?? ''],
    ];
    exportTableToCsv(headers, rows, 'dashboard-metrics.csv');
  }

  /**
   * Fetches approved timesheet data for payroll processing within the selected date range.
   * Groups results by worker + date via GET /api/timesheets/payroll.
   */
  async function fetchPayrollData() {
    if (!payrollStartDate || !payrollEndDate) {
      setError('Select both start and end dates for payroll export.');
      return;
    }
    setLoadingPayroll(true);
    setError('');
    try {
      const data = await api.get(`/api/timesheets/payroll?startDate=${payrollStartDate}&endDate=${payrollEndDate}`);
      setPayrollData(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load payroll data');
    } finally {
      setLoadingPayroll(false);
    }
  }

  /**
   * Exports the loaded payroll data as a CSV file with worker name, email,
   * date, total hours, jobs, and activity breakdown. Includes a totals row.
   */
  function handleExportPayroll() {
    if (!payrollData || payrollData.length === 0) return;
    const headers = ['Worker Name', 'Email', 'Date', 'Total Hours', 'Jobs', 'Activity Breakdown'];
    const rows = payrollData.map(r => [
      r.workerName, r.workerEmail, r.date, r.totalHours, r.jobs, r.activities,
    ]);
    // Add a totals row
    const totalHrs = payrollData.reduce((s, r) => s + r.totalHours, 0);
    rows.push(['', '', 'TOTAL', Math.round(totalHrs * 100) / 100, '', '']);
    exportTableToCsv(headers, rows, `payroll-${payrollStartDate}-to-${payrollEndDate}.csv`);
    showToast('Payroll CSV exported');
  }

  const overallPercent = jobProgress?.overallPercentComplete ?? jobProgress?.overallPercent ?? jobProgress?.percentComplete ?? 0;
  const progressClass = getProgressClass(overallPercent);

  return (
    <div className="page-fade-in">
      <h1 className="page-title">Reports & Analytics</h1>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--text)',
            color: 'var(--bg, #fff)',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: '0.875rem',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {toast}
        </div>
      )}

      {/* ===== Company Dashboard Metrics ===== */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Company Dashboard Metrics</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExportDashboard} disabled={!dashboardMetrics}>
              <Download size={14} />
              CSV
            </button>
            <button className="btn btn-secondary" onClick={handleExportDashboardPdf} disabled={!dashboardMetrics}>
              <FileText size={14} />
              PDF
            </button>
          </div>
        </div>
        {loadingDashboard ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <p className="text-light" style={{ marginTop: 12 }}>Loading metrics...</p>
          </div>
        ) : dashboardMetrics ? (
          <div className="card-body">
            <div className="grid-3">
              <div className="stat-card">
                <div className="stat-card-icon bg-primary">
                  <Briefcase size={24} />
                </div>
                <div className="stat-card-value">{dashboardMetrics.totalActiveJobs ?? dashboardMetrics.activeJobs ?? 0}</div>
                <div className="stat-card-label">Active Jobs</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-icon bg-success">
                  <TrendingUp size={24} />
                </div>
                <div className="stat-card-value">{Math.round(dashboardMetrics.averageCompletion ?? dashboardMetrics.avgCompletion ?? 0)}%</div>
                <div className="stat-card-label">Average Completion</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-icon bg-warning">
                  <Clock size={24} />
                </div>
                <div className="stat-card-value">
                  {dashboardMetrics.totalLaborHours ?? dashboardMetrics.totalLaborHoursThisWeek ?? 0}
                </div>
                <div className="stat-card-label">Total Labor Hours</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card-body">
            <p className="text-light">No dashboard data available.</p>
          </div>
        )}
      </div>

      {/* ===== Job Progress Report ===== */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2>Job Progress Report</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-input"
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">Select a job...</option>
              {jobs.map((job) => (
                <option key={job._id || job.id} value={job._id || job.id}>
                  {job.name || job.jobName}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={handleExportJobProgress} disabled={!jobProgress}>
              <Download size={14} />
              CSV
            </button>
            <button className="btn btn-secondary" onClick={handleExportJobProgressPdf} disabled={!jobProgress}>
              <FileText size={14} />
              PDF
            </button>
          </div>
        </div>

        {!selectedJobId ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <BarChart3 size={40} style={{ color: 'var(--text-light)', marginBottom: 12 }} />
            <p className="text-light">Select a job to view its progress report.</p>
          </div>
        ) : loadingJobProgress ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <p className="text-light" style={{ marginTop: 12 }}>Loading progress report...</p>
          </div>
        ) : jobProgress ? (
          <div className="card-body">
            {/* Overall progress */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>Overall Progress</span>
                <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>{Math.round(overallPercent)}%</span>
              </div>
              <div className="progress-bar" style={{ height: 24, borderRadius: 12 }}>
                <div
                  className={`progress-bar-fill ${progressClass}`}
                  style={{ width: `${overallPercent}%`, borderRadius: 12, transition: 'width 0.6s ease' }}
                />
              </div>
            </div>

            {/* Scope breakdown */}
            {(jobProgress.scopes || []).length > 0 && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}></th>
                      <th>Scope / Activity</th>
                      <th>% Complete</th>
                      <th>Estimated Hours</th>
                      <th>Actual Hours</th>
                      <th>Labor Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobProgress.scopes || []).map((scope) => {
                      const scopeId = scope._id || scope.id || scope.name;
                      const isExpanded = expandedScopes[scopeId];
                      const activities = scope.activities || [];
                      const scopePct = scope.percentComplete ?? 0;
                      const estHours = scope.estimatedHours ?? 0;
                      const actHours = scope.actualHours ?? 0;

                      return (
                        <ScopeRows
                          key={scopeId}
                          scope={scope}
                          scopeId={scopeId}
                          isExpanded={isExpanded}
                          activities={activities}
                          scopePct={scopePct}
                          estHours={estHours}
                          actHours={actHours}
                          onToggle={() => toggleScope(scopeId)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Labor hours vs budget - simple bar visualization */}
            {(jobProgress.scopes || []).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ marginBottom: 12 }}>Labor Hours vs Budget</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(jobProgress.scopes || []).map((scope) => {
                    const scopeId = scope._id || scope.id || scope.name;
                    const est = scope.estimatedHours ?? 0;
                    const act = scope.actualHours ?? 0;
                    const max = Math.max(est, act, 1);
                    const isOver = act > est && est > 0;
                    return (
                      <div key={scopeId}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>{scope.name}</span>
                          <span className={isOver ? 'text-danger' : 'text-light'}>
                            {act}h / {est}h budgeted
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, height: 20 }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${(est / max) * 100}%`,
                              background: 'var(--primary-light, #cce0ff)',
                              borderRadius: 4,
                              minWidth: est > 0 ? 4 : 0,
                            }}
                            title={`Estimated: ${est}h`}
                          />
                          <div
                            style={{
                              height: '100%',
                              width: `${(act / max) * 100}%`,
                              background: isOver ? 'var(--danger, #dc3545)' : 'var(--success, #28a745)',
                              borderRadius: 4,
                              minWidth: act > 0 ? 4 : 0,
                            }}
                            title={`Actual: ${act}h`}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem', marginTop: 2 }}>
                          <span style={{ color: 'var(--primary, #0066cc)' }}>Estimated</span>
                          <span style={{ color: isOver ? 'var(--danger, #dc3545)' : 'var(--success, #28a745)' }}>Actual</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="card-body">
            <p className="text-light">No progress data available for this job.</p>
          </div>
        )}
      </div>

      {/* ===== Production Rates ===== */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Production Rates</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExportProductionRates} disabled={productionRates.length === 0}>
              <Download size={14} />
              CSV
            </button>
            <button className="btn btn-secondary" onClick={handleExportProductionRatesPdf} disabled={productionRates.length === 0}>
              <FileText size={14} />
              PDF
            </button>
          </div>
        </div>

        {loadingProduction ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <p className="text-light" style={{ marginTop: 12 }}>Loading production rates...</p>
          </div>
        ) : productionRates.length === 0 ? (
          <div className="card-body">
            <p className="text-light">No production rate data available yet.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Tasks</th>
                  <th>Avg Completion</th>
                  <th>Labor Hours</th>
                  <th>Tasks/Hour</th>
                </tr>
              </thead>
              <tbody>
                {productionRates.map((rate, idx) => (
                  <tr key={rate._id || rate.id || idx}>
                    <td style={{ fontWeight: 600 }}>{rate.activityName || rate.name || '--'}</td>
                    <td>{formatNumber(rate.taskCount)}</td>
                    <td>{formatNumber(rate.avgCompletion)}%</td>
                    <td>{formatNumber(rate.totalLaborHours)}</td>
                    <td>{formatNumber(rate.tasksCompletedPerHour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== Payroll Export ===== */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2>Payroll Export</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="form-input"
              value={payrollStartDate}
              onChange={(e) => setPayrollStartDate(e.target.value)}
              style={{ fontSize: '0.875rem', padding: '6px 10px' }}
            />
            <span className="text-light">to</span>
            <input
              type="date"
              className="form-input"
              value={payrollEndDate}
              onChange={(e) => setPayrollEndDate(e.target.value)}
              style={{ fontSize: '0.875rem', padding: '6px 10px' }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={fetchPayrollData}
              disabled={!payrollStartDate || !payrollEndDate || loadingPayroll}
            >
              {loadingPayroll ? 'Loading...' : 'Load'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportPayroll}
              disabled={!payrollData || payrollData.length === 0}
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>

        {!payrollData ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <Clock size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <p className="text-light">Select a date range and click Load to view approved timesheet data for payroll.</p>
          </div>
        ) : loadingPayroll ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : payrollData.length === 0 ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
            <p className="text-light">No approved timesheet entries found for this date range.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Date</th>
                    <th>Hours</th>
                    <th>Jobs</th>
                    <th>Activities</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollData.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 600 }}>{row.workerName}</td>
                      <td>{new Date(row.date + 'T12:00:00').toLocaleDateString()}</td>
                      <td>{row.totalHours}</td>
                      <td>{row.jobs}</td>
                      <td style={{ fontSize: '0.8125rem' }}>{row.activities}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td></td>
                    <td>{Math.round(payrollData.reduce((s, r) => s + r.totalHours, 0) * 100) / 100}h</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * ScopeRows - Renders a scope row with expand/collapse toggle and its
 * child activity rows when expanded. Used in the Job Progress Report table.
 * @component
 * @param {Object} props
 * @param {Object} props.scope - Scope object with name
 * @param {string} props.scopeId - Scope identifier
 * @param {boolean} props.isExpanded - Whether child activities are visible
 * @param {Object[]} props.activities - Child activity objects
 * @param {number} props.scopePct - Scope percent complete
 * @param {number} props.estHours - Total estimated hours for scope
 * @param {number} props.actHours - Total actual hours for scope
 * @param {Function} props.onToggle - Called to toggle expand/collapse
 * @returns {JSX.Element} Table rows for scope and its activities
 */
function ScopeRows({ scope, scopeId, isExpanded, activities, scopePct, estHours, actHours, onToggle }) {
  return (
    <>
      <tr
        style={{ cursor: activities.length > 0 ? 'pointer' : 'default', fontWeight: 600 }}
        onClick={activities.length > 0 ? onToggle : undefined}
      >
        <td>
          {activities.length > 0 && (
            isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          )}
        </td>
        <td>{scope.name}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="progress-bar" style={{ flex: 1, height: 8 }}>
              <div
                className={`progress-bar-fill ${getProgressClass(scopePct)}`}
                style={{ width: `${scopePct}%` }}
              />
            </div>
            <span style={{ fontSize: '0.875rem', minWidth: 40, textAlign: 'right' }}>{Math.round(scopePct)}%</span>
          </div>
        </td>
        <td>{estHours}</td>
        <td>{actHours}</td>
        <td>
          {estHours > 0 && actHours > estHours && (
            <span className="badge badge-danger">Over budget</span>
          )}
          {estHours > 0 && actHours <= estHours && (
            <span className="badge badge-success">On track</span>
          )}
        </td>
      </tr>
      {isExpanded && activities.map((act, idx) => {
        const actPct = act.percentComplete ?? 0;
        return (
          <tr key={act._id || act.id || idx} style={{ background: 'var(--bg-secondary, #f9fafb)' }}>
            <td></td>
            <td style={{ paddingLeft: 32 }}>{act.name}</td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="progress-bar" style={{ flex: 1, height: 6 }}>
                  <div
                    className={`progress-bar-fill ${getProgressClass(actPct)}`}
                    style={{ width: `${actPct}%` }}
                  />
                </div>
                <span style={{ fontSize: '0.8125rem', minWidth: 40, textAlign: 'right' }}>{Math.round(actPct)}%</span>
              </div>
            </td>
            <td>{act.estimatedHours ?? '--'}</td>
            <td>{act.actualHours ?? '--'}</td>
            <td></td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * Formats a numeric value for display. Returns '--' for null/NaN,
 * integers as locale strings, and decimals to 2 places.
 * @param {number|string|null} val - Value to format
 * @returns {string} Formatted number or '--'
 */
function formatNumber(val) {
  if (val == null) return '--';
  const num = parseFloat(val);
  if (isNaN(num)) return '--';
  return Number.isInteger(num) ? num.toLocaleString() : num.toFixed(2);
}
