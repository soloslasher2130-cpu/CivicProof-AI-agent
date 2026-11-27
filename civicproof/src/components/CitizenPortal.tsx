import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  Home,
  LogOut,
  MapPin,
  Search,
  Shield,
  User,
} from 'lucide-react';
import { apiRequest, formatDateTime, formatShortDate } from '../lib/api';
import type {
  AuthSession,
  CategoryItem,
  ComplaintRecord,
  ComplaintStatus,
  DepartmentItem,
  SimilarLinkItem,
  StatusHistoryItem,
  SupportedLanguage,
  UserProfile,
} from '../types';
import { AIComplaintStudio } from './AIComplaintStudio';
import {
  CivicLogoMark,
  ComplaintProgressTimeline,
  PriorityLabel,
  ResilientImage,
  StatusLabel,
} from './StatusIndicator';

type CitizenTab = 'dashboard' | 'report' | 'history' | 'profile';

interface CitizenPortalProps {
  session: AuthSession;
  categories: CategoryItem[];
  departments: DepartmentItem[];
  initialTab?: CitizenTab;
  onUpdateUser: (user: UserProfile) => void;
  onDataChanged: () => void;
  onLogout: () => void;
  onGoHome: () => void;
  onOpenAIAgent: () => void;
  onSwitchToAdmin: () => void;
}

const FILTER_STATUSES: Array<'All' | ComplaintStatus> = [
  'All',
  'Submitted',
  'Forwarded',
  'Under Review',
  'In Progress',
  'Resolved',
  'Rejected',
];

export function CitizenPortal({
  session,
  categories,
  departments,
  initialTab = 'dashboard',
  onUpdateUser,
  onDataChanged,
  onLogout,
  onGoHome,
  onOpenAIAgent,
  onSwitchToAdmin,
}: CitizenPortalProps) {
  const [activeTab, setActiveTab] = useState<CitizenTab>(initialTab);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ComplaintStatus>('All');

  // Detail View
  const [selectedDetail, setSelectedDetail] = useState<{
    complaint: ComplaintRecord;
    history: StatusHistoryItem[];
    similarLinks: SimilarLinkItem[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Profile Form
  const [profileName, setProfileName] = useState(session.user.name);
  const [profilePhone, setProfilePhone] = useState(session.user.phone || '');
  const [profileWard, setProfileWard] = useState(session.user.ward || '');
  const [profileLang, setProfileLang] = useState<SupportedLanguage>(
    session.user.preferred_language || 'English'
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  const loadComplaints = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{
        complaints: ComplaintRecord[];
        stats: {
          total: number;
          pending: number;
          inProgress: number;
          resolved: number;
          rejected: number;
        };
      }>('/api/citizen/complaints', { token: session.token });
      setComplaints(data.complaints);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your complaints.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  async function openComplaintDetail(complaintId: number) {
    setDetailLoading(true);
    setError('');
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        history: StatusHistoryItem[];
        similarLinks: SimilarLinkItem[];
      }>(`/api/citizen/complaints/${complaintId}`, { token: session.token });
      setSelectedDetail(data);
      setActiveTab('history');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load complaint details.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMessage('');
    try {
      const data = await apiRequest<{ user: UserProfile }>('/api/citizen/profile', {
        method: 'PATCH',
        token: session.token,
        body: {
          name: profileName,
          phone: profilePhone,
          ward: profileWard,
          preferredLanguage: profileLang,
        },
      });
      onUpdateUser(data.user);
      setProfileMessage('Profile updated successfully.');
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  const filteredComplaints = complaints.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.reference_id.toLowerCase().includes(q) ||
      c.category_name.toLowerCase().includes(q) ||
      c.area.toLowerCase().includes(q) ||
      c.street_landmark.toLowerCase().includes(q) ||
      c.ai_summary.toLowerCase().includes(q) ||
      c.department_name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Citizen Portal Horizontal Top Shell (Distinct from Admin Sidebar Layout) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6 min-w-0">
            <button type="button" onClick={onGoHome} className="cursor-pointer">
              <CivicLogoMark />
            </button>

            <nav className="hidden md:flex items-center gap-1" aria-label="Citizen portal tabs">
              {(
                [
                  { id: 'dashboard', label: 'Dashboard' },
                  { id: 'report', label: 'Report an Issue' },
                  { id: 'history', label: 'My Complaints' },
                  { id: 'profile', label: 'Profile' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id !== 'history') setSelectedDetail(null);
                  }}
                  className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-[#0F2D5C] font-semibold'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenAIAgent}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap cursor-pointer"
            >
              <span>AI Agent</span>
            </button>
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Admin Portal</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-red-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden border-t border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto bg-white">
          {(
            [
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'report', label: 'Report Issue' },
              { id: 'history', label: 'My Complaints' },
              { id: 'profile', label: 'Profile' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id !== 'history') setSelectedDetail(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'bg-[#0F2D5C] text-white'
                  : 'text-slate-600 bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Citizen Account Context Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{session.user.name}</span>
            <span aria-hidden="true">·</span>
            <span>{session.user.email}</span>
            {session.user.ward && (
              <>
                <span aria-hidden="true">·</span>
                <span>{session.user.ward}</span>
              </>
            )}
            {session.user.is_demo === 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-700 font-medium">Demo Citizen Account</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onGoHome}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" aria-hidden="true" />
            <span>CivicProof Home</span>
          </button>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}

        {/* TAB 1: CITIZEN DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
                  Citizen Dashboard
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Viewing only complaints filed under your account. Statistics update automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                <span>Report New Issue</span>
              </button>
            </div>

            {/* 4 Live Citizen KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Submitted', value: stats.total, sub: 'All complaints filed by you', color: 'text-slate-950' },
                { label: 'Pending Review', value: stats.pending, sub: 'Submitted, Forwarded, or Under Review', color: 'text-amber-700' },
                { label: 'In Progress', value: stats.inProgress, sub: 'Assigned to field crew', color: 'text-blue-700' },
                { label: 'Resolved', value: stats.resolved, sub: 'Completed civic repairs', color: 'text-emerald-700' },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="bg-white border border-slate-200 rounded-xl p-5"
                >
                  <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                  <p className={`mt-2 text-3xl font-display font-bold font-mono tabular-nums ${kpi.color}`}>
                    {loading ? '—' : kpi.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{kpi.sub}</p>
                </div>
              ))}
            </div>

            {/* Search + Status Filter + Recent Complaints Table */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by Reference ID, area, category, or department..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                  {FILTER_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Loading your complaint records...
                </div>
              ) : filteredComplaints.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <p className="text-sm font-medium text-slate-800">
                    {complaints.length === 0
                      ? 'You have not submitted any civic complaints yet.'
                      : 'No complaints match your current filter.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (complaints.length === 0) {
                        setActiveTab('report');
                      } else {
                        setSearchQuery('');
                        setStatusFilter('All');
                      }
                    }}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg cursor-pointer"
                  >
                    {complaints.length === 0 ? 'Report Your First Issue' : 'Reset Filters'}
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-3 px-4">Reference ID</th>
                        <th className="py-3 px-4">Issue &amp; Location</th>
                        <th className="py-3 px-4">Department</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Submitted</th>
                        <th className="py-3 px-4 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredComplaints.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => openComplaintDetail(c.id)}
                          className="hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                            {c.reference_id}
                          </td>
                          <td className="py-3.5 px-4 max-w-md">
                            <p className="font-medium text-slate-900 line-clamp-1">{c.ai_summary}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {c.category_name} · {c.area} · {c.language}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-700">
                            {c.department_name}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <StatusLabel status={c.status} />
                          </td>
                          <td className="py-3.5 px-4 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {formatShortDate(c.created_at)}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                              Track <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: MULTILINGUAL AI COMPLAINT REGISTRATION */}
        {activeTab === 'report' && (
          <AIComplaintStudio
            token={session.token}
            categories={categories}
            departments={departments}
            defaultLanguage={session.user.preferred_language}
            defaultWard={session.user.ward}
            onComplaintCreated={() => {
              loadComplaints();
              onDataChanged();
            }}
            onViewComplaint={(id) => openComplaintDetail(id)}
          />
        )}

        {/* TAB 3: COMPLAINT HISTORY & FULL STATUS TRACKING DETAIL */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {detailLoading ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                Loading complaint status timeline...
              </div>
            ) : selectedDetail ? (
              <div className="space-y-6">
                <button
                  type="button"
                  onClick={() => setSelectedDetail(null)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  <span>Back to My Complaints</span>
                </button>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left: Full Complaint Dossier */}
                  <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <div className="border-b border-slate-200 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-900 text-sm">
                          {selectedDetail.complaint.reference_id}
                        </span>
                        <PriorityLabel priority={selectedDetail.complaint.priority} />
                      </div>
                      <h2 className="mt-2 font-display text-xl font-bold text-slate-950">
                        {selectedDetail.complaint.ai_summary}
                      </h2>
                      <p className="mt-2 text-xs text-slate-500">
                        {selectedDetail.complaint.category_name} · Filed in{' '}
                        {selectedDetail.complaint.language} ·{' '}
                        <span className="font-mono tabular-nums">
                          {formatDateTime(selectedDetail.complaint.created_at)}
                        </span>
                      </p>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 mb-1">
                        Original Citizen Description
                      </h3>
                      <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                        {selectedDetail.complaint.original_description}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Location
                        </p>
                        <p className="font-semibold text-slate-900 mt-1">
                          {selectedDetail.complaint.area}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {selectedDetail.complaint.street_landmark}
                        </p>
                      </div>
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-xs text-slate-500">Recommended Department</p>
                        <p className="font-semibold text-slate-900 mt-1">
                          {selectedDetail.complaint.department_name}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {selectedDetail.complaint.official_channel}
                        </p>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1.5 border-t border-slate-200 pt-4">
                      <p>
                        <strong className="text-slate-800">Routing Explanation:</strong>{' '}
                        {selectedDetail.complaint.routing_explanation}
                      </p>
                      <p>
                        <strong className="text-slate-800">Priority Rationale:</strong>{' '}
                        {selectedDetail.complaint.priority_reason}
                      </p>
                      <p className="text-amber-800 font-medium pt-1">
                        Submission Mode: Demo Submission (Official Municipal API Integration Ready)
                      </p>
                    </div>

                    {selectedDetail.complaint.photo_url && (
                      <div className="pt-2">
                        <p className="text-xs font-medium text-slate-600 mb-2">
                          Attached Photographic Evidence
                        </p>
                        <ResilientImage
                          src={selectedDetail.complaint.photo_url}
                          alt={`Evidence photo for ${selectedDetail.complaint.reference_id}`}
                          className="w-full max-h-72 object-cover rounded-lg border border-slate-200"
                        />
                      </div>
                    )}

                    {selectedDetail.similarLinks.length > 0 && (
                      <div className="pt-3 border-t border-slate-200">
                        <p className="text-xs font-semibold text-slate-700 mb-2">
                          Linked Similar Neighborhood Reports
                        </p>
                        <ul className="space-y-1.5 text-xs text-slate-600">
                          {selectedDetail.similarLinks.map((link) => (
                            <li key={link.related_id}>
                              <span className="font-mono font-semibold text-slate-900">
                                {link.reference_id}
                              </span>{' '}
                              ({link.area}) — {link.ai_summary} [{link.status}]
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Right: Visual Timeline & Audit History */}
                  <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
                    <ComplaintProgressTimeline
                      currentStatus={selectedDetail.complaint.status}
                      history={selectedDetail.history}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-bold text-slate-950">
                      My Complaint History
                    </h2>
                    <p className="text-sm text-slate-600 mt-0.5">
                      Select any complaint to inspect its progress timeline and department notes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadComplaints}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    Refresh Statuses
                  </button>
                </div>

                {complaints.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                    <p className="text-sm text-slate-600">No complaints registered yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {complaints.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => openComplaintDetail(c.id)}
                        className="text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-5 transition-colors space-y-3 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="font-mono font-semibold text-slate-900">
                            {c.reference_id}
                          </span>
                          <StatusLabel status={c.status} />
                        </div>
                        <p className="text-sm font-semibold text-slate-900 line-clamp-2">
                          {c.ai_summary}
                        </p>
                        <div className="text-xs text-slate-500 flex flex-wrap gap-x-2 gap-y-1">
                          <span>{c.category_name}</span>
                          <span aria-hidden="true">·</span>
                          <span>{c.area}</span>
                          <span aria-hidden="true">·</span>
                          <span>{c.department_name}</span>
                        </div>
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                          <span className="font-mono tabular-nums">
                            Updated {formatShortDate(c.updated_at)}
                          </span>
                          <span className="font-semibold text-blue-700">View Timeline →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CITIZEN PROFILE */}
        {activeTab === 'profile' && (
          <div className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#0F2D5C] flex items-center justify-center">
                <User className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold text-slate-950">Citizen Profile</h2>
                <p className="text-xs text-slate-500">
                  Account Email: {session.user.email} · Role: Citizen
                </p>
              </div>
            </div>

            {profileMessage && (
              <div className="p-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                {profileMessage}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="prof-name"
                  type="text"
                  required
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prof-phone" className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    id="prof-phone"
                    type="tel"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="prof-ward" className="block text-xs font-medium text-slate-700 mb-1">
                    Default Area / Ward
                  </label>
                  <input
                    id="prof-ward"
                    type="text"
                    value={profileWard}
                    onChange={(e) => setProfileWard(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="prof-lang" className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred Language for AI Responses
                </label>
                <select
                  id="prof-lang"
                  value={profileLang}
                  onChange={(e) => setProfileLang(e.target.value as SupportedLanguage)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Tanglish">Tanglish</option>
                  <option value="Tamil">Tamil (தமிழ்)</option>
                  <option value="English">English</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={profileSaving}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
              >
                {profileSaving ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
