/** @type {Object.<string, string>} Maps jobType enum values to display labels */
export const JOB_TYPE_LABELS = {
  residential_new: 'Residential - New Build',
  residential_remodel: 'Residential - Remodel',
  residential_addition: 'Residential - Addition',
  commercial_office: 'Commercial - Office Fit-Out',
  commercial_retail: 'Commercial - Retail',
  commercial_warehouse: 'Commercial - Warehouse',
  industrial: 'Industrial',
  infrastructure: 'Infrastructure',
  renovation: 'Renovation',
  demolition: 'Demolition',
  other: 'Other',
};

/**
 * Maps a job status string to its corresponding CSS badge class name.
 * @param {string} status - Job status (active, on_hold, completed, archived)
 * @returns {string} CSS class name for the badge
 */
export function getStatusBadge(status) {
  switch (status) {
    case 'active': return 'badge-success';
    case 'on_hold': return 'badge-warning';
    case 'completed': return 'badge-primary';
    case 'archived': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

/**
 * Converts a job status slug to a human-readable label.
 * @param {string} status - Job status slug (e.g. 'on_hold')
 * @returns {string} Display label (e.g. 'On Hold') or '--' if null
 */
export function formatStatus(status) {
  switch (status) {
    case 'active': return 'Active';
    case 'on_hold': return 'On Hold';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
    default: return status || '--';
  }
}

/**
 * Formats a number as USD currency with no decimal places, or '--' if null.
 * @param {number|null} amount - Dollar amount to format
 * @returns {string} Formatted currency string (e.g. '$200,000') or '--'
 */
export function formatCurrency(amount) {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Returns CSS class for progress bar color based on percentage.
 * @param {number} pct - Completion percentage (0-100)
 * @returns {string} 'progress-high' (>=70%), 'progress-mid' (>=40%), or 'progress-low'
 */
export function getProgressClass(pct) {
  return pct >= 70 ? 'progress-high' : pct >= 40 ? 'progress-mid' : 'progress-low';
}

/**
 * Formats a date string as a human-friendly relative time.
 * Returns "Today", "Yesterday", "N days ago", "N weeks ago", "1 month ago",
 * or falls back to toLocaleDateString() for dates older than 60 days.
 * @param {string|null} dateStr - ISO date string to format
 * @returns {string} Relative date string or '--' if null
 */
export function formatRelativeDate(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday - startOfDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return date.toLocaleDateString();
}

/**
 * Flattens a job's nested scopes into a flat activity list with scope metadata.
 * Used by DailyEntry and TimesheetEntry for activity dropdowns.
 * @param {Object} job - Job object with nested scopes[].activities[] arrays
 * @returns {Object[]} Flat array of activities with scopeName and scopeId added
 */
export function buildActivityList(job) {
  const activities = [];
  if (job?.scopes) {
    job.scopes.forEach((scope) => {
      (scope.activities || []).forEach((activity) => {
        activities.push({
          ...activity,
          scopeName: scope.name,
          scopeId: scope.id,
        });
      });
    });
  }
  return activities;
}
