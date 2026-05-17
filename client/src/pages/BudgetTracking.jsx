import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  PieChart,
  ChevronDown,
  ChevronRight,
  Activity,
} from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../App';
import { formatCurrency } from '../utils/formatting';

const CATEGORIES = [
  { value: 'labor', label: 'Labor' },
  { value: 'materials', label: 'Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'permits', label: 'Permits & Fees' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'estimated', label: 'Estimated' },
  { value: 'committed', label: 'Committed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
];

function statusBadge(status) {
  const map = { estimated: 'badge-neutral', committed: 'badge-primary', invoiced: 'badge-warning', paid: 'badge-success' };
  return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
}

function evMetricCard(label, value, isGood) {
  const color = value == null ? 'var(--text-light)' : value >= 0 ? 'var(--success)' : 'var(--danger)';
  return (
    <div className="ev-card">
      <div className="ev-card-label">{label}</div>
      <div className="ev-card-value" style={{ color: isGood !== undefined ? color : 'var(--text)' }}>
        {value != null ? (typeof value === 'number' && label !== 'CPI' && label !== 'SPI' ? formatCurrency(value) : value?.toFixed(2) ?? '—') : '—'}
      </div>
    </div>
  );
}

export default function BudgetTracking() {
  const api = useApi();
  const { user } = useAuth();
  const { showToast } = useToast();
  const canEdit = ['project_manager', 'admin'].includes(user?.role);
  const isAdmin = user?.role === 'admin';

  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [data, setData] = useState(null);
  const [rollupData, setRollupData] = useState(null);
  const [evData, setEvData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('items');

  // Item modal state
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemForm, setItemForm] = useState({ scopeId: '', activityId: '', category: 'materials', description: '', estimatedAmount: '', actualAmount: '', vendor: '', notes: '', status: 'estimated' });
  const [itemSaving, setItemSaving] = useState(false);

  // Change order modal state
  const [showCOModal, setShowCOModal] = useState(false);
  const [coForm, setCOForm] = useState({ title: '', description: '', amount: '', scopeId: '', activityId: '' });
  const [coSaving, setCOSaving] = useState(false);

  // Scopes and activities for the selected job
  const [scopes, setScopes] = useState([]);
  const [activitiesByScope, setActivitiesByScope] = useState({});

  // WBS rollup collapsed state
  const [collapsedScopes, setCollapsedScopes] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      try {
        const res = await api.get('/api/jobs?status=active');
        if (!cancelled) {
          setJobs(res);
          if (res.length > 0 && !selectedJobId) setSelectedJobId(res[0].id);
        }
      } catch { /* ignore */ }
    }
    fetchJobs();
    return () => { cancelled = true; };
  }, [api]);

  const fetchBudget = useCallback(async () => {
    if (!selectedJobId) return;
    setLoading(true);
    try {
      const [budgetData, jobData] = await Promise.all([
        api.get(`/api/budget/${selectedJobId}`),
        api.get(`/api/jobs/${selectedJobId}`),
      ]);
      setData(budgetData);
      const jobScopes = jobData.scopes || [];
      setScopes(jobScopes);

      // Build activities map from job data
      const actMap = {};
      for (const scope of jobScopes) {
        actMap[scope.id] = (scope.activities || []);
      }
      setActivitiesByScope(actMap);

      // Fetch rollup and EV in parallel (non-blocking)
      Promise.all([
        api.get(`/api/budget/${selectedJobId}/rollup`),
        api.get(`/api/budget/${selectedJobId}/earned-value`),
      ]).then(([rollup, ev]) => {
        setRollupData(rollup);
        setEvData(ev);
      }).catch(() => {});
    } catch (err) {
      showToast(err.message || 'Failed to load budget', 'error');
    } finally {
      setLoading(false);
    }
  }, [api, selectedJobId, showToast]);

  useEffect(() => { fetchBudget(); }, [fetchBudget]);

  // Get activities for selected scope in form
  const formActivities = itemForm.scopeId ? (activitiesByScope[itemForm.scopeId] || []) : [];
  const coFormActivities = coForm.scopeId ? (activitiesByScope[coForm.scopeId] || []) : [];

  // ── Item CRUD ──

  function openAddItem() {
    setEditingItem(null);
    setItemForm({ scopeId: '', activityId: '', category: 'materials', description: '', estimatedAmount: '', actualAmount: '', vendor: '', notes: '', status: 'estimated' });
    setShowItemModal(true);
  }

  function openEditItem(item) {
    setEditingItem(item);
    setItemForm({
      scopeId: item.scopeId || '',
      activityId: item.activityId || '',
      category: item.category,
      description: item.description,
      estimatedAmount: item.estimatedAmount,
      actualAmount: item.actualAmount,
      vendor: item.vendor || '',
      notes: item.notes || '',
      status: item.status,
    });
    setShowItemModal(true);
  }

  async function saveItem() {
    if (!itemForm.description.trim()) { showToast('Description is required', 'error'); return; }
    setItemSaving(true);
    try {
      const body = {
        ...itemForm,
        estimatedAmount: parseFloat(itemForm.estimatedAmount) || 0,
        actualAmount: parseFloat(itemForm.actualAmount) || 0,
        scopeId: itemForm.scopeId || null,
        activityId: itemForm.activityId || null,
      };
      if (editingItem) {
        await api.put(`/api/budget/items/${editingItem.id}`, body);
        showToast('Budget item updated');
      } else {
        await api.post(`/api/budget/${selectedJobId}/items`, body);
        showToast('Budget item added');
      }
      setShowItemModal(false);
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setItemSaving(false);
    }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.description}"?`)) return;
    try {
      await api.del(`/api/budget/items/${item.id}`);
      showToast('Budget item deleted');
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'error');
    }
  }

  // ── Change Order CRUD ──

  function openAddCO() {
    setCOForm({ title: '', description: '', amount: '', scopeId: '', activityId: '' });
    setShowCOModal(true);
  }

  async function saveCO() {
    if (!coForm.title.trim()) { showToast('Title is required', 'error'); return; }
    setCOSaving(true);
    try {
      await api.post(`/api/budget/${selectedJobId}/change-orders`, {
        ...coForm,
        amount: parseFloat(coForm.amount) || 0,
        scopeId: coForm.scopeId || null,
        activityId: coForm.activityId || null,
      });
      showToast('Change order created');
      setShowCOModal(false);
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to create', 'error');
    } finally {
      setCOSaving(false);
    }
  }

  async function approveCO(id) {
    try {
      await api.put(`/api/budget/change-orders/${id}/approve`);
      showToast('Change order approved');
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to approve', 'error');
    }
  }

  async function rejectCO(id) {
    try {
      await api.put(`/api/budget/change-orders/${id}/reject`);
      showToast('Change order rejected');
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to reject', 'error');
    }
  }

  async function deleteCO(id) {
    if (!confirm('Delete this change order?')) return;
    try {
      await api.del(`/api/budget/change-orders/${id}`);
      showToast('Change order deleted');
      fetchBudget();
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'error');
    }
  }

  const s = data?.summary || {};
  const variancePercent = s.adjustedBudget ? ((s.variance / s.adjustedBudget) * 100).toFixed(1) : 0;
  const spentPercent = s.adjustedBudget ? ((s.totalActual / s.adjustedBudget) * 100).toFixed(1) : 0;

  function toggleScope(scopeId) {
    setCollapsedScopes(prev => ({ ...prev, [scopeId]: !prev[scopeId] }));
  }

  return (
    <div className="page-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Budget Tracking</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ minWidth: 220 }}
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-light" style={{ marginTop: 12 }}>Loading budget data...</p>
        </div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid-4">
            <div className="stat-card">
              <div className="stat-card-icon bg-primary"><DollarSign size={24} /></div>
              <div className="stat-card-value">{formatCurrency(s.adjustedBudget)}</div>
              <div className="stat-card-label">
                Adjusted Budget
                {s.approvedChanges !== 0 && (
                  <span className="text-muted" style={{ fontSize: '0.75rem', display: 'block' }}>
                    {formatCurrency(s.originalBudget)} + {formatCurrency(s.approvedChanges)} COs
                  </span>
                )}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon bg-warning"><TrendingUp size={24} /></div>
              <div className="stat-card-value">{formatCurrency(s.totalActual)}</div>
              <div className="stat-card-label">
                Total Spent ({spentPercent}%)
                {s.laborCost > 0 && (
                  <span className="text-muted" style={{ fontSize: '0.75rem', display: 'block' }}>
                    Labor: {formatCurrency(s.laborCost)} ({s.laborHours}h)
                  </span>
                )}
              </div>
            </div>
            <div className="stat-card">
              <div className={`stat-card-icon ${s.variance >= 0 ? 'bg-success' : 'bg-danger'}`}>
                {s.variance >= 0 ? <TrendingDown size={24} /> : <AlertTriangle size={24} />}
              </div>
              <div className="stat-card-value" style={{ color: s.variance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {formatCurrency(Math.abs(s.variance))}
              </div>
              <div className="stat-card-label">{s.variance >= 0 ? 'Under Budget' : 'Over Budget'} ({variancePercent}%)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon bg-success"><PieChart size={24} /></div>
              <div className="stat-card-value">{formatCurrency(s.totalCommitted)}</div>
              <div className="stat-card-label">Committed Costs</div>
            </div>
          </div>

          {/* Budget Progress Bar */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.875rem' }}>
                <span>Budget Usage</span>
                <span>{spentPercent}% of {formatCurrency(s.adjustedBudget)}</span>
              </div>
              <div className="budget-progress-bar">
                <div
                  className={`budget-progress-fill ${parseFloat(spentPercent) > 100 ? 'over' : parseFloat(spentPercent) > 80 ? 'warning' : ''}`}
                  style={{ width: `${Math.min(parseFloat(spentPercent), 100)}%` }}
                />
              </div>
              {s.pendingChanges > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.8125rem', color: 'var(--warning)' }}>
                  {formatCurrency(s.pendingChanges)} in pending change orders
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs" style={{ marginTop: 20 }}>
            <button className={`tab ${activeTab === 'items' ? 'active' : ''}`} onClick={() => setActiveTab('items')}>
              Budget Items ({data.items.length})
            </button>
            <button className={`tab ${activeTab === 'wbs' ? 'active' : ''}`} onClick={() => setActiveTab('wbs')}>
              WBS Rollup
            </button>
            <button className={`tab ${activeTab === 'ev' ? 'active' : ''}`} onClick={() => setActiveTab('ev')}>
              Variance{evData?.mismatchCount > 0 && <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: '0.6875rem' }}>{evData.mismatchCount}</span>}
            </button>
            <button className={`tab ${activeTab === 'changes' ? 'active' : ''}`} onClick={() => setActiveTab('changes')}>
              Change Orders ({data.changeOrders.length})
            </button>
          </div>

          {/* Budget Items Tab */}
          {activeTab === 'items' && (
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {canEdit && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <button className="btn btn-primary btn-sm" onClick={openAddItem}>
                    <Plus size={14} /> Add Budget Item
                  </button>
                </div>
              )}
              {data.items.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <DollarSign size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                  <p className="text-light">No budget items yet. Add items to start tracking costs.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Category</th>
                        <th>Activity</th>
                        <th style={{ textAlign: 'right' }}>Estimated</th>
                        <th style={{ textAlign: 'right' }}>Actual</th>
                        <th style={{ textAlign: 'right' }}>Variance</th>
                        <th style={{ textAlign: 'center' }}>Complete</th>
                        <th>Status</th>
                        {canEdit && <th style={{ width: 80 }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item) => {
                        const itemVar = item.estimatedAmount - item.actualAmount;
                        return (
                          <tr key={item.id} className={item.mismatchFlag ? 'mismatch-row' : ''}>
                            <td style={{ fontWeight: 500 }}>
                              {item.description}
                              {item.mismatchFlag && (
                                <span className="mismatch-flag" title={`Budget ${item.spentPercent}% spent vs ${item.completionPercent}% complete`}>
                                  <AlertTriangle size={13} />
                                </span>
                              )}
                            </td>
                            <td><span className="badge badge-neutral">{item.category}</span></td>
                            <td className="text-light" style={{ fontSize: '0.8125rem' }}>
                              {item.activityName || item.scopeName || '—'}
                              {item.activityName && item.scopeName && (
                                <span className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>{item.scopeName}</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(item.estimatedAmount)}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(item.actualAmount)}</td>
                            <td style={{ textAlign: 'right', color: itemVar >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                              {itemVar >= 0 ? '' : '-'}{formatCurrency(Math.abs(itemVar))}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {item.completionPercent != null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                                  <div className="progress-bar" style={{ width: 50, height: 6 }}>
                                    <div
                                      className={`progress-fill ${item.completionPercent > 70 ? 'progress-high' : item.completionPercent > 40 ? 'progress-mid' : 'progress-low'}`}
                                      style={{ width: `${item.completionPercent}%` }}
                                    />
                                  </div>
                                  <span style={{ fontSize: '0.75rem' }}>{item.completionPercent}%</span>
                                </div>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td>{statusBadge(item.status)}</td>
                            {canEdit && (
                              <td>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="btn btn-sm btn-outline" onClick={() => openEditItem(item)} title="Edit">
                                    <Edit2 size={14} />
                                  </button>
                                  <button className="btn btn-sm btn-danger" onClick={() => deleteItem(item)} title="Delete">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                        <td colSpan={3}>Totals</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(s.totalEstimated)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(s.totalActual)}</td>
                        <td style={{ textAlign: 'right', color: s.totalEstimated - s.totalActual >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {formatCurrency(Math.abs(s.totalEstimated - s.totalActual))}
                        </td>
                        <td colSpan={canEdit ? 3 : 2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* WBS Rollup Tab */}
          {activeTab === 'wbs' && (
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {!rollupData ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </div>
              ) : rollupData.scopes.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <Activity size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                  <p className="text-light">No scopes/activities found. Add WBS structure in Job Detail first.</p>
                </div>
              ) : (
                <div className="card-body" style={{ padding: 0 }}>
                  {/* Header row */}
                  <div className="wbs-header">
                    <div className="wbs-name">Scope / Activity</div>
                    <div className="wbs-col">Estimated</div>
                    <div className="wbs-col">Actual</div>
                    <div className="wbs-col">Variance</div>
                    <div className="wbs-col">Labor Cost</div>
                    <div className="wbs-col-wide">Completion</div>
                  </div>
                  {rollupData.scopes.map(scope => {
                    const isCollapsed = collapsedScopes[scope.scopeId];
                    const scopeVar = scope.estimatedTotal - scope.actualTotal;
                    return (
                      <div key={scope.scopeId}>
                        <div className="wbs-scope-row" onClick={() => toggleScope(scope.scopeId)}>
                          <div className="wbs-name">
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            <span style={{ fontWeight: 600 }}>{scope.scopeName}</span>
                            <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>
                              {scope.activities.length} activities
                            </span>
                          </div>
                          <div className="wbs-col">{formatCurrency(scope.estimatedTotal)}</div>
                          <div className="wbs-col">{formatCurrency(scope.actualTotal)}</div>
                          <div className="wbs-col" style={{ color: scopeVar >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                            {scopeVar >= 0 ? '+' : ''}{formatCurrency(scopeVar)}
                          </div>
                          <div className="wbs-col text-muted">—</div>
                          <div className="wbs-col-wide">
                            <div className="progress-bar" style={{ width: 60, height: 6, display: 'inline-block', verticalAlign: 'middle' }}>
                              <div
                                className={`progress-fill ${scope.completionPercent > 70 ? 'progress-high' : scope.completionPercent > 40 ? 'progress-mid' : 'progress-low'}`}
                                style={{ width: `${scope.completionPercent}%` }}
                              />
                            </div>
                            <span style={{ marginLeft: 6, fontSize: '0.8125rem' }}>{scope.completionPercent}%</span>
                          </div>
                        </div>
                        {!isCollapsed && scope.activities.map(act => {
                          const actVar = act.estimatedTotal - act.actualTotal;
                          return (
                            <div key={act.activityId} className={`wbs-activity-row ${act.mismatchFlag ? 'mismatch-row' : ''}`}>
                              <div className="wbs-name" style={{ paddingLeft: 36 }}>
                                {act.activityName}
                                {act.mismatchFlag && (
                                  <span className="mismatch-flag" title={`${act.spentPercent}% spent vs ${act.completionPercent}% complete`}>
                                    <AlertTriangle size={12} />
                                  </span>
                                )}
                                <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 6 }}>
                                  {act.itemCount} items
                                </span>
                              </div>
                              <div className="wbs-col">{formatCurrency(act.estimatedTotal)}</div>
                              <div className="wbs-col">{formatCurrency(act.actualTotal)}</div>
                              <div className="wbs-col" style={{ color: actVar >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500, fontSize: '0.8125rem' }}>
                                {actVar >= 0 ? '+' : ''}{formatCurrency(actVar)}
                              </div>
                              <div className="wbs-col" style={{ fontSize: '0.8125rem' }}>
                                {act.laborCost > 0 ? formatCurrency(act.laborCost) : <span className="text-muted">—</span>}
                              </div>
                              <div className="wbs-col-wide">
                                <div className="progress-bar" style={{ width: 60, height: 6, display: 'inline-block', verticalAlign: 'middle' }}>
                                  <div
                                    className={`progress-fill ${act.completionPercent > 70 ? 'progress-high' : act.completionPercent > 40 ? 'progress-mid' : 'progress-low'}`}
                                    style={{ width: `${act.completionPercent}%` }}
                                  />
                                </div>
                                <span style={{ marginLeft: 6, fontSize: '0.8125rem' }}>{act.completionPercent}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {/* Unassigned items */}
                  {rollupData.unassignedItems?.length > 0 && (
                    <div>
                      <div className="wbs-scope-row" style={{ opacity: 0.7 }}>
                        <div className="wbs-name">
                          <span style={{ fontWeight: 600, fontStyle: 'italic' }}>Unassigned Items</span>
                          <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>
                            {rollupData.unassignedItems.length} items
                          </span>
                        </div>
                        <div className="wbs-col">{formatCurrency(rollupData.unassignedItems.reduce((s, i) => s + i.estimatedAmount, 0))}</div>
                        <div className="wbs-col">{formatCurrency(rollupData.unassignedItems.reduce((s, i) => s + i.actualAmount, 0))}</div>
                        <div className="wbs-col" />
                        <div className="wbs-col" />
                        <div className="wbs-col-wide text-muted">—</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Earned Value / Variance Tab */}
          {activeTab === 'ev' && (
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {!evData ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </div>
              ) : (
                <div className="card-body">
                  {/* Job-level EV summary */}
                  <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: '1rem' }}>Job Earned Value Summary</h3>
                  <div className="ev-grid">
                    {evMetricCard('Planned Value (PV)', evData.jobLevel.PV)}
                    {evMetricCard('Earned Value (EV)', evData.jobLevel.EV)}
                    {evMetricCard('Actual Cost (AC)', evData.jobLevel.AC)}
                    {evMetricCard('Cost Variance (CV)', evData.jobLevel.CV, evData.jobLevel.CV >= 0)}
                    {evMetricCard('Schedule Variance (SV)', evData.jobLevel.SV, evData.jobLevel.SV >= 0)}
                    {evMetricCard('CPI', evData.jobLevel.CPI, evData.jobLevel.CPI != null && evData.jobLevel.CPI >= 1)}
                    {evMetricCard('SPI', evData.jobLevel.SPI, evData.jobLevel.SPI != null && evData.jobLevel.SPI >= 1)}
                  </div>

                  {evData.mismatchCount > 0 && (
                    <div className="alert alert-warning" style={{ marginTop: 16 }}>
                      <AlertTriangle size={16} />
                      <span>{evData.mismatchCount} activit{evData.mismatchCount === 1 ? 'y has' : 'ies have'} a budget/completion mismatch (&gt;20% gap)</span>
                    </div>
                  )}

                  {/* Per-activity breakdown */}
                  <h3 style={{ marginTop: 24, marginBottom: 12, fontSize: '1rem' }}>Activity Variance Detail</h3>
                  {evData.byActivity.length === 0 ? (
                    <p className="text-light">No activities with budget items.</p>
                  ) : (
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Activity</th>
                            <th>Scope</th>
                            <th style={{ textAlign: 'right' }}>Budgeted</th>
                            <th style={{ textAlign: 'right' }}>EV</th>
                            <th style={{ textAlign: 'right' }}>AC</th>
                            <th style={{ textAlign: 'right' }}>CV</th>
                            <th style={{ textAlign: 'right' }}>SV</th>
                            <th style={{ textAlign: 'center' }}>Complete</th>
                            <th style={{ textAlign: 'center' }}>Spent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evData.byActivity.map(a => (
                            <tr key={a.activityId} className={a.mismatchFlag ? 'mismatch-row' : ''}>
                              <td style={{ fontWeight: 500 }}>
                                {a.activityName}
                                {a.mismatchFlag && (
                                  <span className="mismatch-flag">
                                    <AlertTriangle size={12} />
                                  </span>
                                )}
                              </td>
                              <td className="text-light" style={{ fontSize: '0.8125rem' }}>{a.scopeName}</td>
                              <td style={{ textAlign: 'right' }}>{formatCurrency(a.budgeted)}</td>
                              <td style={{ textAlign: 'right' }}>{formatCurrency(a.EV)}</td>
                              <td style={{ textAlign: 'right' }}>{formatCurrency(a.AC)}</td>
                              <td style={{ textAlign: 'right', color: a.CV >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                                {formatCurrency(a.CV)}
                              </td>
                              <td style={{ textAlign: 'right', color: a.SV >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                                {formatCurrency(a.SV)}
                              </td>
                              <td style={{ textAlign: 'center', fontSize: '0.8125rem' }}>{a.completionPercent}%</td>
                              <td style={{ textAlign: 'center', fontSize: '0.8125rem' }}>{a.spentPercent}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Change Orders Tab */}
          {activeTab === 'changes' && (
            <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {canEdit && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <button className="btn btn-primary btn-sm" onClick={openAddCO}>
                    <Plus size={14} /> New Change Order
                  </button>
                </div>
              )}
              {data.changeOrders.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <FileText size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                  <p className="text-light">No change orders yet.</p>
                </div>
              ) : (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.changeOrders.map((co) => (
                    <div key={co.id} style={{
                      padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      borderLeft: `3px solid ${co.status === 'approved' ? 'var(--success)' : co.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{co.title}</div>
                          {co.description && <div className="text-light" style={{ fontSize: '0.8125rem', marginTop: 4 }}>{co.description}</div>}
                          <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                            Requested by {co.requestedByName || 'Unknown'}
                            {co.approvedByName && ` · Approved by ${co.approvedByName}`}
                          </div>
                          {(co.scopeName || co.activityName) && (
                            <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                              Scope: {co.scopeName || '—'}{co.activityName && ` → ${co.activityName}`}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '1.125rem', color: co.amount >= 0 ? 'var(--danger)' : 'var(--success)' }}>
                            {co.amount >= 0 ? '+' : ''}{formatCurrency(co.amount)}
                          </div>
                          <div style={{ marginTop: 4 }}>
                            {co.status === 'pending' && <span className="badge badge-warning">Pending</span>}
                            {co.status === 'approved' && <span className="badge badge-success">Approved</span>}
                            {co.status === 'rejected' && <span className="badge badge-danger">Rejected</span>}
                          </div>
                        </div>
                      </div>
                      {co.status === 'pending' && isAdmin && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button className="btn btn-sm btn-success" onClick={() => approveCO(co.id)}>
                            <CheckCircle size={14} /> Approve
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => rejectCO(co.id)}>
                            <XCircle size={14} /> Reject
                          </button>
                          <button className="btn btn-sm btn-outline" onClick={() => deleteCO(co.id)} style={{ marginLeft: 'auto' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      {/* Add/Edit Budget Item Modal */}
      {showItemModal && (
        <div className="modal-overlay" onClick={() => setShowItemModal(false)}>
          <div className="modal" style={{ padding: 24, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingItem ? 'Edit Budget Item' : 'Add Budget Item'}</h2>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Description *</label>
                <input className="form-input" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-input" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Estimated Amount</label>
                  <input type="number" className="form-input" value={itemForm.estimatedAmount} onChange={(e) => setItemForm({ ...itemForm, estimatedAmount: e.target.value })} step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Actual Amount</label>
                  <input type="number" className="form-input" value={itemForm.actualAmount} onChange={(e) => setItemForm({ ...itemForm, actualAmount: e.target.value })} step="0.01" />
                </div>
              </div>

              {/* Scope → Activity cascading selects */}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Scope</label>
                  <select className="form-input" value={itemForm.scopeId} onChange={(e) => {
                    setItemForm({ ...itemForm, scopeId: e.target.value, activityId: '' });
                  }}>
                    <option value="">— No scope —</option>
                    {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Activity</label>
                  <select className="form-input" value={itemForm.activityId} onChange={(e) => setItemForm({ ...itemForm, activityId: e.target.value })} disabled={!itemForm.scopeId}>
                    <option value="">— No activity —</option>
                    {formActivities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Vendor</label>
                <input className="form-input" value={itemForm.vendor} onChange={(e) => setItemForm({ ...itemForm, vendor: e.target.value })} placeholder="Vendor name" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowItemModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveItem} disabled={itemSaving}>
                {itemSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Change Order Modal */}
      {showCOModal && (
        <div className="modal-overlay" onClick={() => setShowCOModal(false)}>
          <div className="modal" style={{ padding: 24, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Change Order</h2>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-input" value={coForm.title} onChange={(e) => setCOForm({ ...coForm, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount ($)</label>
                <input type="number" className="form-input" value={coForm.amount} onChange={(e) => setCOForm({ ...coForm, amount: e.target.value })} step="0.01" placeholder="Positive = budget increase" />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Scope</label>
                  <select className="form-input" value={coForm.scopeId} onChange={(e) => setCOForm({ ...coForm, scopeId: e.target.value, activityId: '' })}>
                    <option value="">— Job level —</option>
                    {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Activity</label>
                  <select className="form-input" value={coForm.activityId} onChange={(e) => setCOForm({ ...coForm, activityId: e.target.value })} disabled={!coForm.scopeId}>
                    <option value="">— Scope level —</option>
                    {coFormActivities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input" rows={3} value={coForm.description} onChange={(e) => setCOForm({ ...coForm, description: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCOModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCO} disabled={coSaving}>
                {coSaving ? 'Creating...' : 'Create Change Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
