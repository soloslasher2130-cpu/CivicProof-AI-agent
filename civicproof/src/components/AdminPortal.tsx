import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ClipboardList,
  Home,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest, formatDateTime, formatShortDate } from '../lib/api';
import type {
  AdminAnalytics,
  AuthSession,
  CategoryItem,
  ComplaintPriority,
  ComplaintRecord,
  ComplaintStatus,
  DepartmentItem,
  SimilarLinkItem,
  StatusHistoryItem,
} from '../types';
import {
  CivicLogoMark,
  ComplaintProgressTimeline,
  ConfirmDialog,
  PriorityLabel,
  ResilientImage,
  StatusLabel,
} from './StatusIndicator';

type AdminSection = 'analytics' | 'complaints' | 'detail' | 'departments' | 'profile';

interface AdminPortalProps {
  session: AuthSession;
  categories: CategoryItem[];
  departments: DepartmentItem[];
  onMetaRefresh: () => void;
  onDataChanged: () => void;
  onLogout: () => void;
  onGoHome: () => void;
  onOpenAIAgent: () => void;
  onSwitchToCitizen: () => void;
}

const ALL_STATUSES: ComplaintStatus[] = [
  'Submitted',
  'Forwarded',
  'Under Review',
  'In Progress',
  'Resolved',
  'Rejected',
];

const STATUS_BAR_COLORS: Record<string, string> = {
  Submitted: '#64748b',
  Forwarded: '#2563eb',
  'Under Review': '#d97706',
  'In Progress': '#4f46e5',
  Resolved: '#16a34a',
  Rejected: '#dc2626',
};

export function AdminPortal({
  session,
  categories,
  departments,
  onMetaRefresh,
  onDataChanged,
  onLogout,
  onGoHome,
  onOpenAIAgent,
  onSwitchToCitizen,
}: AdminPortalProps) {
  const [section, setSection] = useState<AdminSection>('analytics');
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [adminDepts, setAdminDepts] = useState<DepartmentItem[]>(departments);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Complaint filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('0');
  const [departmentFilter, setDepartmentFilter] = useState('0');
  const [priorityFilter, setPriorityFilter] = useState('All');

  // Selected complaint detail & status editor
  const [selectedDetail, setSelectedDetail] = useState<{
    complaint: ComplaintRecord;
    history: StatusHistoryItem[];
    similarLinks: SimilarLinkItem[];
  } | null>(null);
  const [nextStatus, setNextStatus] = useState<ComplaintStatus>('Under Review');
  const [nextDeptId, setNextDeptId] = useState<number>(1);
  const [nextPriority, setNextPriority] = useState<ComplaintPriority>('Medium');
  const [updateNote, setUpdateNote] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusSuccess, setStatusSuccess] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Add Department & Add Category forms
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [deptChannel, setDeptChannel] = useState('');
  const [deptSla, setDeptSla] = useState('48');
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catDeptId, setCatDeptId] = useState<number>(departments[0]?.id || 1);
  const [mgmtMessage, setMgmtMessage] = useState('');

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'All') qs.set('status', statusFilter);
      if (categoryFilter !== '0') qs.set('categoryId', categoryFilter);
      if (departmentFilter !== '0') qs.set('departmentId', departmentFilter);
      if (priorityFilter !== 'All') qs.set('priority', priorityFilter);
      if (search.trim()) qs.set('search', search.trim());

      const [analyticsRes, complaintsRes, deptsRes] = await Promise.all([
        apiRequest<AdminAnalytics>('/api/admin/analytics', { token: session.token }),
        apiRequest<{ complaints: ComplaintRecord[] }>(
          `/api/admin/complaints?${qs.toString()}`,
          { token: session.token }
        ),
        apiRequest<{ departments: DepartmentItem[] }>('/api/admin/departments', {
          token: session.token,
        }),
      ]);

      setAnalytics(analyticsRes);
      setComplaints(complaintsRes.complaints);
      setAdminDepts(deptsRes.departments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console data.');
    } finally {
      setLoading(false);
    }
  }, [session.token, statusFilter, categoryFilter, departmentFilter, priorityFilter, search]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  async function openComplaintDossier(complaintId: number) {
    setError('');
    setStatusSuccess('');
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        history: StatusHistoryItem[];
        similarLinks: SimilarLinkItem[];
      }>(`/api/admin/complaints/${complaintId}`, { token: session.token });
      setSelectedDetail(data);
      setNextStatus(data.complaint.status);
      setNextDeptId(data.complaint.department_id);
      setNextPriority(data.complaint.priority);
      setUpdateNote('');
      setSection('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load complaint dossier.');
    }
  }

  async function commitStatusUpdate() {
    if (!selectedDetail) return;
    setConfirmOpen(false);
    setUpdatingStatus(true);
    setError('');
    setStatusSuccess('');
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        history: StatusHistoryItem[];
      }>(`/api/admin/complaints/${selectedDetail.complaint.id}/status`, {
        method: 'PATCH',
        token: session.token,
        body: {
          status: nextStatus,
          departmentId: nextDeptId,
          priority: nextPriority,
          note: updateNote.trim(),
        },
      });
      setSelectedDetail({
        complaint: data.complaint,
        history: data.history,
        similarLinks: selectedDetail.similarLinks,
      });
      setUpdateNote('');
      setStatusSuccess(
        `Status updated to "${data.complaint.status}" and recorded in the citizen-visible timeline.`
      );
      await loadAdminData();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update complaint status.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  function handleStatusFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (updateNote.trim().length < 3) {
      setError('Please enter a brief administrative note explaining this status update.');
      return;
    }
    if (nextStatus === 'Resolved' || nextStatus === 'Rejected') {
      setConfirmOpen(true);
    } else {
      commitStatusUpdate();
    }
  }

  async function handleAddDepartment(e: React.FormEvent) {
    e.preventDefault();
    setMgmtMessage('');
    setError('');
    try {
      await apiRequest('/api/admin/departments', {
        method: 'POST',
        token: session.token,
        body: {
          code: deptCode,
          name: deptName,
          description: deptDesc,
          officialChannel: deptChannel,
          slaHours: Number(deptSla) || 48,
        },
      });
      setDeptCode('');
      setDeptName('');
      setDeptDesc('');
      setDeptChannel('');
      setMgmtMessage('New government department added successfully.');
      await loadAdminData();
      onMetaRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add department.');
    }
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setMgmtMessage('');
    setError('');
    try {
      await apiRequest('/api/admin/categories', {
        method: 'POST',
        token: session.token,
        body: {
          name: catName,
          description: catDesc,
          defaultDepartmentId: catDeptId,
        },
      });
      setCatName('');
      setCatDesc('');
      setMgmtMessage('New complaint category added and enabled for AI classification.');
      await loadAdminData();
      onMetaRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category.');
    }
  }

  const breadcrumbLabel: Record<AdminSection, string> = {
    analytics: 'Operations / Analytics & Reports',
    complaints: 'Operations / All Complaints',
    detail: `Operations / Complaints / ${selectedDetail?.complaint.reference_id || 'Details'}`,
    departments: 'Operations / Departments & Categories',
    profile: 'Operations / Admin Profile',
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex">
      {/* Left Deep-Navy Sidebar (Distinct Operational Console Layout) */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-[#0B1E3D] text-slate-200 border-r border-slate-800">
        <div className="h-16 px-5 flex items-center border-b border-slate-800">
          <button type="button" onClick={onGoHome} className="cursor-pointer">
            <CivicLogoMark light />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-800/80 text-xs text-slate-400">
          Municipal Command Console
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Admin sidebar navigation">
          {(
            [
              { id: 'analytics', label: 'Dashboard & Analytics', icon: BarChart3 },
              { id: 'complaints', label: 'All Complaints', icon: ClipboardList },
              { id: 'departments', label: 'Departments & Categories', icon: Building2 },
              { id: 'profile', label: 'Admin Profile', icon: ShieldCheck },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = section === item.id || (section === 'detail' && item.id === 'complaints');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-600/25 text-white'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2 text-xs">
          <div className="pb-2">
            <p className="font-semibold text-white truncate">{session.user.name}</p>
            <p className="text-slate-400 truncate">{session.user.email}</p>
          </div>
          <button
            type="button"
            onClick={onOpenAIAgent}
            className="w-full flex items-center gap-2 px-3 py-2 text-blue-200 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Open AI Agent Page</span>
          </button>
          <button
            type="button"
            onClick={onSwitchToCitizen}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-200 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Switch to Citizen Portal</span>
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-300 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" aria-hidden="true" />
            <span>CivicProof Home</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-red-300 hover:bg-red-950/50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Operations Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Contextual Top Bar */}
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
          <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="lg:hidden">
                <CivicLogoMark />
              </span>
              <p className="text-sm font-medium text-slate-600 truncate">
                {breadcrumbLabel[section]}
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={loadAdminData}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={onSwitchToCitizen}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg whitespace-nowrap cursor-pointer"
              >
                Citizen View
              </button>
            </div>
          </div>

          {/* Mobile Section Tabs */}
          <div className="lg:hidden border-t border-slate-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto bg-slate-50">
            {(
              [
                { id: 'analytics', label: 'Analytics' },
                { id: 'complaints', label: 'Complaints' },
                { id: 'departments', label: 'Departments' },
                { id: 'profile', label: 'Profile' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  section === tab.id ? 'bg-[#0B1E3D] text-white' : 'bg-white text-slate-700 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-slate-200 rounded-md whitespace-nowrap shrink-0"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-7 max-w-7xl w-full mx-auto space-y-6">
          {error && (
            <div className="p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {/* SECTION 1: ADMIN ANALYTICS & DASHBOARD */}
          {section === 'analytics' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
                    Municipal Grievance Analytics
                  </h1>
                  <p className="text-sm text-slate-600 mt-1">
                    All figures and charts below are calculated live from the SQLite database
                    {analytics && analytics.summary.sampleCount > 0
                      ? ` (includes ${analytics.summary.sampleCount} clearly labelled initial sample records).`
                      : '.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('complaints')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  Manage All Complaints →
                </button>
              </div>

              {/* 6 Live KPI Tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: 'Total Complaints', value: analytics?.summary.total ?? '—', color: 'text-slate-950' },
                  { label: 'Pending', value: analytics?.summary.pending ?? '—', color: 'text-amber-700' },
                  { label: 'In Progress', value: analytics?.summary.inProgress ?? '—', color: 'text-indigo-700' },
                  { label: 'Resolved', value: analytics?.summary.resolved ?? '—', color: 'text-emerald-700' },
                  { label: 'Rejected', value: analytics?.summary.rejected ?? '—', color: 'text-red-700' },
                  {
                    label: 'Resolution Rate',
                    value: analytics ? `${analytics.summary.resolutionPercentage}%` : '—',
                    color: 'text-blue-800',
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="bg-white border border-slate-200 rounded-xl p-4"
                  >
                    <p className="text-xs text-slate-500">{k.label}</p>
                    <p className={`mt-1.5 text-2xl font-display font-bold font-mono tabular-nums ${k.color}`}>
                      {loading ? '—' : k.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Interactive Charts Grid */}
              {analytics && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Chart 1: Category-wise Complaints */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <h2 className="font-display text-base font-semibold text-slate-900 mb-4">
                      Complaints by Category
                    </h2>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analytics.byCategory}
                          layout="vertical"
                          margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={145}
                            tick={{ fontSize: 11, fill: '#334155' }}
                          />
                          <Tooltip />
                          <Bar dataKey="count" name="Complaints" fill="#0F2D5C" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 2: Area-wise Complaints */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <h2 className="font-display text-base font-semibold text-slate-900 mb-4">
                      Complaints by Neighborhood / Area
                    </h2>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analytics.byArea}
                          margin={{ top: 4, right: 16, left: 0, bottom: 20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: '#334155' }}
                            interval={0}
                            angle={-18}
                            textAnchor="end"
                          />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                          <Tooltip />
                          <Bar dataKey="count" name="Complaints" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 3: Status Breakdown */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <h2 className="font-display text-base font-semibold text-slate-900 mb-4">
                      Complaints by Lifecycle Status
                    </h2>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analytics.byStatus}
                          margin={{ top: 4, right: 16, left: 0, bottom: 16 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#334155' }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                          <Tooltip />
                          <Bar dataKey="count" name="Complaints" radius={[4, 4, 0, 0]}>
                            {analytics.byStatus.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={STATUS_BAR_COLORS[entry.name] || '#334155'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Table 4: Department Workload & Resolution */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <h2 className="font-display text-base font-semibold text-slate-900 mb-4">
                      Department-Wise Workload
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 pr-3 font-medium">Department</th>
                            <th className="py-2 px-2 text-right font-medium">Total</th>
                            <th className="py-2 px-2 text-right font-medium">Open</th>
                            <th className="py-2 pl-2 text-right font-medium">Resolved</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analytics.byDepartment.map((d) => (
                            <tr key={d.code}>
                              <td className="py-2.5 pr-3 font-medium text-slate-800">{d.name}</td>
                              <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-900">
                                {d.total}
                              </td>
                              <td className="py-2.5 px-2 text-right font-mono tabular-nums text-amber-700">
                                {d.openCount || 0}
                              </td>
                              <td className="py-2.5 pl-2 text-right font-mono tabular-nums text-emerald-700">
                                {d.resolved || 0}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Recent Queue Preview */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Latest Incoming Complaints
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSection('complaints')}
                    className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    View all ({complaints.length})
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Ref ID</th>
                        <th className="py-2.5 px-4">Summary</th>
                        <th className="py-2.5 px-4">Area</th>
                        <th className="py-2.5 px-4">Priority</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {complaints.slice(0, 6).map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                            {c.reference_id}
                          </td>
                          <td className="py-3 px-4 max-w-md">
                            <p className="text-slate-900 font-medium line-clamp-1">{c.ai_summary}</p>
                            <p className="text-xs text-slate-500">
                              {c.category_name} · {c.citizen_name}
                              {c.is_sample === 1 ? ' · Sample' : ''}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                            {c.area}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <PriorityLabel priority={c.priority} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusLabel status={c.status} />
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openComplaintDossier(c.id)}
                              className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                            >
                              Manage →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: ALL COMPLAINTS TABLE */}
          {section === 'complaints' && (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
                  All Civic Complaints
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Filter by status, category, department, or priority and select any row to update
                  progress.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative lg:col-span-2">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search Ref ID, area, citizen, description..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="All">All Statuses</option>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="0">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by department"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="0">All Departments</option>
                  {adminDepts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {loading ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Loading complaints...
                  </div>
                ) : complaints.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-800">
                      No complaints match these filter criteria.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setStatusFilter('All');
                        setCategoryFilter('0');
                        setDepartmentFilter('0');
                        setPriorityFilter('All');
                      }}
                      className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                          <th className="py-3 px-4">Reference ID</th>
                          <th className="py-3 px-4">Complaint &amp; Citizen</th>
                          <th className="py-3 px-4">Location</th>
                          <th className="py-3 px-4">Department</th>
                          <th className="py-3 px-4">Priority</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {complaints.map((c) => (
                          <tr
                            key={c.id}
                            onClick={() => openComplaintDossier(c.id)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-3.5 px-4 font-mono text-xs font-semibold text-blue-900 whitespace-nowrap">
                              {c.reference_id}
                            </td>
                            <td className="py-3.5 px-4 max-w-sm">
                              <p className="font-medium text-slate-900 line-clamp-1">
                                {c.ai_summary}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {c.category_name} · {c.citizen_name} · {c.language}
                                {c.is_sample === 1 ? ' · Sample' : ''}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                              {c.area}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-700">
                              {c.department_name}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <PriorityLabel priority={c.priority} />
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <StatusLabel status={c.status} />
                            </td>
                            <td className="py-3.5 px-4 text-right text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {formatShortDate(c.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: COMPLAINT DOSSIER & STATUS MANAGEMENT */}
          {section === 'detail' && selectedDetail && (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => setSection('complaints')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                <span>Back to All Complaints</span>
              </button>

              {statusSuccess && (
                <div className="p-3.5 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                  {statusSuccess}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Complete Dossier + Timeline */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <div className="border-b border-slate-200 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-900 text-sm">
                          {selectedDetail.complaint.reference_id}
                        </span>
                        <StatusLabel status={selectedDetail.complaint.status} />
                      </div>
                      <h2 className="mt-2 font-display text-xl font-bold text-slate-950">
                        {selectedDetail.complaint.ai_summary}
                      </h2>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {selectedDetail.complaint.category_name} · {selectedDetail.complaint.language} ·{' '}
                        <span className="font-mono tabular-nums">
                          {selectedDetail.complaint.endorsement_count} citizen supporters
                        </span>{' '}
                        · Filed {formatDateTime(selectedDetail.complaint.created_at)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        Original Citizen Input
                      </p>
                      <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                        {selectedDetail.complaint.original_description}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                        <p className="text-slate-500 font-medium">Location Details</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {selectedDetail.complaint.area}
                        </p>
                        <p className="text-slate-700">{selectedDetail.complaint.street_landmark}</p>
                      </div>
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                        <p className="text-slate-500 font-medium">Citizen Reporter</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {selectedDetail.complaint.citizen_name}
                        </p>
                        <p className="text-slate-700">{selectedDetail.complaint.citizen_email}</p>
                        {selectedDetail.complaint.citizen_phone && (
                          <p className="font-mono text-slate-600">
                            {selectedDetail.complaint.citizen_phone}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1.5">
                      <p>
                        <strong className="text-slate-800">Department Routing:</strong>{' '}
                        {selectedDetail.complaint.routing_explanation}
                      </p>
                      <p>
                        <strong className="text-slate-800">Official Channel:</strong>{' '}
                        {selectedDetail.complaint.official_channel}
                      </p>
                      <p>
                        <strong className="text-slate-800">Priority Basis:</strong>{' '}
                        {selectedDetail.complaint.priority_reason}
                      </p>
                    </div>

                    {selectedDetail.complaint.photo_url && (
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-2">Uploaded Photo</p>
                        <ResilientImage
                          src={selectedDetail.complaint.photo_url}
                          alt={`Evidence photo for ${selectedDetail.complaint.reference_id}`}
                          className="w-full max-h-72 object-cover rounded-lg border border-slate-200"
                        />
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-6">
                    <ComplaintProgressTimeline
                      currentStatus={selectedDetail.complaint.status}
                      history={selectedDetail.history}
                    />
                  </div>
                </div>

                {/* Right Column: Administrative Status Update Control Panel */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5 sticky top-24">
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-950">
                      Update Complaint Status
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Every update is appended to the permanent audit trail and reflected immediately
                      in the Citizen Portal and analytics.
                    </p>
                  </div>

                  <form onSubmit={handleStatusFormSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="admin-next-status" className="block text-xs font-medium text-slate-700 mb-1.5">
                        New Lifecycle Status
                      </label>
                      <select
                        id="admin-next-status"
                        value={nextStatus}
                        onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="admin-next-dept" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Assigned Department
                      </label>
                      <select
                        id="admin-next-dept"
                        value={nextDeptId}
                        onChange={(e) => setNextDeptId(Number(e.target.value))}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        {adminDepts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="admin-next-priority" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Priority Level
                      </label>
                      <select
                        id="admin-next-priority"
                        value={nextPriority}
                        onChange={(e) => setNextPriority(e.target.value as ComplaintPriority)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="admin-note" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Admin Update Note (Visible to Citizen) *
                      </label>
                      <textarea
                        id="admin-note"
                        rows={4}
                        required
                        value={updateNote}
                        onChange={(e) => setUpdateNote(e.target.value)}
                        placeholder="e.g. Field team dispatched to clear accumulated garbage and sanitize the street corner."
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={updatingStatus}
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {updatingStatus ? 'Saving Update...' : 'Apply Status Update'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: DEPARTMENTS & CATEGORIES MANAGEMENT */}
          {section === 'departments' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
                  Departments &amp; Complaint Categories
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Manage municipal routing departments, SLA targets, official channels, and active
                  AI complaint categories.
                </p>
              </div>

              {mgmtMessage && (
                <div className="p-3.5 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                  {mgmtMessage}
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-200">
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Registered Civic Departments ({adminDepts.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-3 px-4">Code</th>
                        <th className="py-3 px-4">Department</th>
                        <th className="py-3 px-4">Official Reporting Channel</th>
                        <th className="py-3 px-4 text-right">SLA</th>
                        <th className="py-3 px-4 text-right">Assigned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {adminDepts.map((d) => (
                        <tr key={d.id}>
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                            {d.code}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-900">{d.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{d.description}</p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">{d.official_channel}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            {d.sla_hours}h
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 whitespace-nowrap">
                            {d.complaint_count ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Add New Department */}
                <form
                  onSubmit={handleAddDepartment}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#0F2D5C]" aria-hidden="true" />
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Add Civic Department
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="new-dept-code" className="block text-xs font-medium text-slate-700 mb-1">
                        Department Code *
                      </label>
                      <input
                        id="new-dept-code"
                        type="text"
                        required
                        value={deptCode}
                        onChange={(e) => setDeptCode(e.target.value)}
                        placeholder="e.g. DEPT-PARKS"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-dept-sla" className="block text-xs font-medium text-slate-700 mb-1">
                        Target SLA (Hours)
                      </label>
                      <input
                        id="new-dept-sla"
                        type="number"
                        min={4}
                        max={720}
                        value={deptSla}
                        onChange={(e) => setDeptSla(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="new-dept-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Department Name *
                    </label>
                    <input
                      id="new-dept-name"
                      type="text"
                      required
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
                      placeholder="e.g. Urban Parks & Green Cover Division"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-dept-desc" className="block text-xs font-medium text-slate-700 mb-1">
                      Responsibilities *
                    </label>
                    <input
                      id="new-dept-desc"
                      type="text"
                      required
                      value={deptDesc}
                      onChange={(e) => setDeptDesc(e.target.value)}
                      placeholder="Fallen trees, neighborhood parks, median greenery"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-dept-channel" className="block text-xs font-medium text-slate-700 mb-1">
                      Official Reporting Channel *
                    </label>
                    <input
                      id="new-dept-channel"
                      type="text"
                      required
                      value={deptChannel}
                      onChange={(e) => setDeptChannel(e.target.value)}
                      placeholder="Municipal Parks Helpline 1913 (Demo Mode)"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg cursor-pointer"
                  >
                    Add Department
                  </button>
                </form>

                {/* Add New Category */}
                <form
                  onSubmit={handleAddCategory}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#0F2D5C]" aria-hidden="true" />
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Add Complaint Category
                    </h3>
                  </div>
                  <div>
                    <label htmlFor="new-cat-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Category Name *
                    </label>
                    <input
                      id="new-cat-name"
                      type="text"
                      required
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                      placeholder="e.g. Fallen Trees / Green Cover"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-cat-desc" className="block text-xs font-medium text-slate-700 mb-1">
                      Category Description (used by AI Classifier) *
                    </label>
                    <textarea
                      id="new-cat-desc"
                      rows={2}
                      required
                      value={catDesc}
                      onChange={(e) => setCatDesc(e.target.value)}
                      placeholder="Uprooted trees blocking roads, overhanging branches near power lines."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-cat-dept" className="block text-xs font-medium text-slate-700 mb-1">
                      Default Routing Department *
                    </label>
                    <select
                      id="new-cat-dept"
                      value={catDeptId}
                      onChange={(e) => setCatDeptId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {adminDepts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg cursor-pointer"
                  >
                    Add Category
                  </button>

                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-500 mb-2">
                      Active Categories ({categories.length})
                    </p>
                    <div className="text-xs text-slate-700 leading-relaxed">
                      {categories.map((c) => c.name).join(' · ')}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* SECTION 5: ADMIN PROFILE */}
          {section === 'profile' && (
            <div className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
                <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-bold text-slate-950">
                    Administrator Profile
                  </h1>
                  <p className="text-xs text-slate-500">Role-Based Access Control Verified</p>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Full Name</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">{session.user.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Administrator Email</dt>
                  <dd className="font-mono text-slate-900 mt-0.5">{session.user.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Assigned Jurisdiction</dt>
                  <dd className="text-slate-800 mt-0.5">{session.user.ward || 'Central Municipal Command'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Access Level</dt>
                  <dd className="font-semibold text-blue-800 mt-0.5">
                    Municipal Administrator (Full Grievance &amp; Department Controls)
                  </dd>
                </div>
              </dl>

              <div className="pt-4 border-t border-slate-200 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
                >
                  Sign Out of Admin Console
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Confirmation Dialog for Final Status Decisions */}
      <ConfirmDialog
        open={confirmOpen}
        title={`Confirm "${nextStatus}" Status`}
        message={`Are you sure you want to mark ${
          selectedDetail?.complaint.reference_id || 'this complaint'
        } as "${nextStatus}"? This action is recorded permanently in the citizen-visible status history.`}
        confirmLabel={`Confirm ${nextStatus}`}
        destructive={nextStatus === 'Rejected'}
        onConfirm={commitStatusUpdate}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
