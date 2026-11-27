import { useState } from 'react';
import {
  ArrowRight,
  Building2,
  FileCheck2,
  Languages,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiRequest, formatDateTime } from '../lib/api';
import type { ComplaintRecord, PublicStats, StatusHistoryItem } from '../types';
import {
  CivicLogoMark,
  ComplaintProgressTimeline,
  PriorityLabel,
  ResilientImage,
  StatusLabel,
} from './StatusIndicator';

const HERO_IMAGE_PATH = '/src/assets/images/hero_civic_cityscape_1795712429127.jpg';

interface LandingPageProps {
  stats: PublicStats | null;
  onReportIssue: () => void;
  onOpenAIAgent: () => void;
  onOpenCitizenPortal: () => void;
  onOpenAdminPortal: () => void;
}

export function LandingPage({
  stats,
  onReportIssue,
  onOpenAIAgent,
  onOpenCitizenPortal,
  onOpenAdminPortal,
}: LandingPageProps) {
  const [trackQuery, setTrackQuery] = useState('');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [trackedResult, setTrackedResult] = useState<{
    complaint: ComplaintRecord;
    history: StatusHistoryItem[];
  } | null>(null);

  async function handleTrackLookup(refOverride?: string) {
    const query = (refOverride ?? trackQuery).trim().toUpperCase();
    if (!query) {
      setTrackingError('Enter a complaint reference ID such as CP-2026-1001.');
      return;
    }
    setTrackQuery(query);
    setTrackingLoading(true);
    setTrackingError('');
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        history: StatusHistoryItem[];
      }>(`/api/public/track/${encodeURIComponent(query)}`);
      setTrackedResult(data);
    } catch (err) {
      setTrackedResult(null);
      setTrackingError(
        err instanceof Error ? err.message : 'Unable to find a complaint with that reference ID.'
      );
    } finally {
      setTrackingLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a href="#top" className="focus-visible:outline-2 rounded">
            <CivicLogoMark />
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={onOpenAIAgent}
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              AI Agent
            </button>
            <a
              href="#how-it-works"
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#track-complaint"
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0"
            >
              Track Complaint
            </a>
            <button
              type="button"
              onClick={onOpenCitizenPortal}
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Citizen Portal
            </button>
            <button
              type="button"
              onClick={onOpenAdminPortal}
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Admin Portal
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onReportIssue}
              className="px-4 py-2 text-sm font-medium text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Report an Issue
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Section: Balanced 2-Column Editorial Split */}
        <section className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center">
                <p className="text-sm font-medium text-blue-800 mb-3">
                  Your Voice. Your City. Your Proof.
                </p>
                <h1
                  className="font-display font-bold tracking-tight text-slate-950 leading-[1.12] max-w-xl"
                  style={{
                    fontSize: 'clamp(2.25rem, 4vw, 3.35rem)',
                    textWrap: 'balance',
                  }}
                >
                  Report local civic issues in Tamil, Tanglish, or English—and track every step.
                </h1>
                <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-xl">
                  CivicProof turns everyday neighborhood descriptions into structured municipal
                  complaints, detects duplicate filings before they pile up, recommends the right
                  government department, and maintains a transparent resolution audit trail.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onReportIssue}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Report an Issue</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <a
                    href="#track-complaint"
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Search className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    <span>Track Complaint</span>
                  </a>
                </div>

                {/* Mobile quick portal access */}
                <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-slate-500 md:hidden">
                  <button
                    type="button"
                    onClick={onOpenAIAgent}
                    className="underline font-semibold text-[#0F2D5C]"
                  >
                    Open AI Agent
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onOpenCitizenPortal}
                    className="underline font-medium text-slate-700"
                  >
                    Citizen Portal
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onOpenAdminPortal}
                    className="underline font-medium text-slate-700"
                  >
                    Admin Portal
                  </button>
                </div>

                <div className="mt-7 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                  <span>Multilingual AI Triage</span>
                  <span aria-hidden="true">·</span>
                  <span>Duplicate Issue Detection</span>
                  <span aria-hidden="true">·</span>
                  <span>Demo Submission Mode (Official API Ready)</span>
                </div>
              </div>

              <div className="lg:col-span-6 flex">
                <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 min-h-[280px] lg:min-h-[400px]">
                  <ResilientImage
                    src={HERO_IMAGE_PATH}
                    alt="Modern South Indian municipal avenue and civic center in morning light"
                    className="w-full h-full object-cover"
                    fallbackLabel="CivicProof Metropolitan Civic Plaza"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/45 to-transparent p-5 text-white">
                    <p className="text-xs font-mono tabular-nums text-slate-200">
                      Example Tanglish Intake · Auto-Translated &amp; Routed
                    </p>
                    <p className="text-sm font-medium mt-1">
                      “Enga street-la kuppai romba naala clear pannala.” → Solid Waste &amp; Sanitation Department
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Full-Width Live Complaint Statistics Row (Calculated from SQLite DB) */}
        <section className="bg-slate-900 text-white border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              <div>
                <p className="text-xs text-slate-300">Total Registered Complaints</p>
                <p className="mt-1 text-3xl font-display font-bold font-mono tabular-nums">
                  {stats ? stats.total : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-400">Live count from persistent database</p>
              </div>
              <div>
                <p className="text-xs text-slate-300">In Progress &amp; Under Review</p>
                <p className="mt-1 text-3xl font-display font-bold font-mono tabular-nums">
                  {stats ? stats.pending + stats.inProgress : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-400">Active municipal work orders</p>
              </div>
              <div>
                <p className="text-xs text-slate-300">Verified Resolutions</p>
                <p className="mt-1 text-3xl font-display font-bold font-mono tabular-nums text-emerald-400">
                  {stats ? stats.resolved : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {stats ? `${stats.resolutionRate}% overall resolution rate` : 'Calculating...'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-300">Mapped Civic Departments</p>
                <p className="mt-1 text-3xl font-display font-bold font-mono tabular-nums">
                  {stats ? stats.departments : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-400">Roads, Sanitation, Drainage, Water &amp; Power</p>
              </div>
            </div>
          </div>
        </section>

        {/* Public Complaint Reference Tracker */}
        <section id="track-complaint" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5">
                <h2 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
                  Track Complaint Status
                </h2>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Enter any CivicProof Reference ID to inspect its recommended department, current
                  status, and complete timestamped update history without logging in.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleTrackLookup();
                  }}
                  className="mt-5 flex flex-col sm:flex-row gap-2.5"
                >
                  <label htmlFor="public-track-input" className="sr-only">
                    Complaint Reference ID
                  </label>
                  <input
                    id="public-track-input"
                    type="text"
                    value={trackQuery}
                    onChange={(e) => setTrackQuery(e.target.value)}
                    placeholder="e.g. CP-2026-1001"
                    className="flex-1 px-3.5 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:border-blue-700"
                  />
                  <button
                    type="submit"
                    disabled={trackingLoading}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {trackingLoading ? 'Searching...' : 'Look Up'}
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Try sample IDs:</span>
                  {['CP-2026-1001', 'CP-2026-1002', 'CP-2026-1003'].map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleTrackLookup(id)}
                      className="font-mono text-blue-700 hover:underline cursor-pointer"
                    >
                      {id}
                    </button>
                  ))}
                </div>

                {trackingError && (
                  <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                    {trackingError}
                  </p>
                )}
              </div>

              <div className="lg:col-span-7">
                {trackedResult ? (
                  <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/70 space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono font-semibold text-slate-900">
                            {trackedResult.complaint.reference_id}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{trackedResult.complaint.category_name}</span>
                          <span aria-hidden="true">·</span>
                          <span>{trackedResult.complaint.area}</span>
                          {trackedResult.complaint.is_sample === 1 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 font-medium">Sample Demo Record</span>
                            </>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-900">
                          {trackedResult.complaint.ai_summary}
                        </p>
                      </div>
                      <PriorityLabel priority={trackedResult.complaint.priority} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-slate-500">Recommended Department</p>
                        <p className="font-semibold text-slate-900 mt-0.5">
                          {trackedResult.complaint.department_name}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Location &amp; Landmark</p>
                        <p className="font-medium text-slate-900 mt-0.5">
                          {trackedResult.complaint.street_landmark}, {trackedResult.complaint.area}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Submission Mode</p>
                        <p className="font-medium text-amber-800 mt-0.5">
                          Demo Submission (Official Municipal API Ready)
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Last Updated</p>
                        <p className="font-mono tabular-nums text-slate-800 mt-0.5">
                          {formatDateTime(trackedResult.complaint.updated_at)}
                        </p>
                      </div>
                    </div>

                    <ComplaintProgressTimeline
                      currentStatus={trackedResult.complaint.status}
                      history={trackedResult.history}
                    />
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50">
                    <p className="text-sm font-medium text-slate-700">
                      Real-time status timeline appears here
                    </p>
                    <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
                      Enter a Reference ID on the left or click one of the sample IDs to inspect how
                      CivicProof logs every status change from submission to resolution.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities: Asymmetric Bento Layout */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="max-w-2xl mb-8">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight">
              Built for real neighborhood workflows
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Every module addresses a concrete breakdown in conventional municipal portals—from
              language barriers to misrouted departments and opaque resolution queues.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
              <Languages className="w-5 h-5 text-[#0F2D5C] mb-3" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold text-slate-950">
                Tamil, Tanglish, and English AI Intake
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Citizens write naturally in Tamil script, colloquial Tanglish, or English. The AI
                agent detects language, extracts issue category, location, and urgency, asks simple
                follow-up questions in the citizen’s language when details are missing, and drafts an
                editable municipal complaint.
              </p>
              <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                <span>Structured JSON Extraction</span>
                <span aria-hidden="true">·</span>
                <span>Human-in-the-Loop Confirmation</span>
                <span aria-hidden="true">·</span>
                <span>Keyword Fallback Ready</span>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
              <Users className="w-5 h-5 text-[#0F2D5C] mb-3" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold text-slate-950">
                Duplicate Complaint Detection
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Before saving a complaint, CivicProof checks active issues by category, neighborhood,
                and description similarity. Citizens can support an existing complaint (+1) or proceed
                independently—never auto-rejected.
              </p>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
              <Building2 className="w-5 h-5 text-[#0F2D5C] mb-3" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold text-slate-950">
                Explainable Department Routing
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Every complaint includes a plain-language routing rationale, target SLA, and official
                municipal reporting channel—explicitly distinguishing Demo Submissions from future
                official API integrations.
              </p>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
              <ShieldCheck className="w-5 h-5 text-[#0F2D5C] mb-3" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold text-slate-950">
                Role-Based Citizen &amp; Admin Portals
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Citizens access a private portal for their own filings and real-time timelines.
                Municipal administrators operate a dedicated command console with live database
                analytics, category and area charts, department management, and immutable status
                update logs.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onOpenCitizenPortal}
                  className="px-4 py-2 text-xs font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Citizen Portal
                </button>
                <button
                  type="button"
                  onClick={onOpenAdminPortal}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Admin Console
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* How CivicProof Works: Editorial Numbered Workflow */}
        <section id="how-it-works" className="bg-white border-t border-b border-slate-200 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight">
                How CivicProof works
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Four transparent steps from a citizen’s first message to verifiable municipal
                resolution.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                {
                  num: '01.',
                  title: 'Describe in Your Language',
                  desc: 'Write the problem in Tamil, Tanglish, or English and optionally attach a street photo.',
                },
                {
                  num: '02.',
                  title: 'AI Triage & Follow-Up',
                  desc: 'The agent identifies category, priority, and missing location details, asking a simple follow-up if needed.',
                },
                {
                  num: '03.',
                  title: 'Duplicate Check & Confirm',
                  desc: 'Review similar open complaints, edit any field in the AI draft, and confirm before submission.',
                },
                {
                  num: '04.',
                  title: 'Track Every Update',
                  desc: 'Receive a unique Reference ID and follow department status transitions with admin notes in real time.',
                },
              ].map((step) => (
                <div key={step.num} className="pt-4 border-t border-slate-200">
                  <p className="font-mono text-sm font-semibold text-blue-800">{step.num}</p>
                  <h3 className="mt-2 font-display text-base font-semibold text-slate-950">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <FileCheck2 className="w-5 h-5 text-[#0F2D5C] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Hackathon Prototype Disclosure: Demo Submission Mode
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    All complaints are persisted in CivicProof’s SQLite database and include official
                    municipal reporting channel guidance. External government API submission is
                    clearly marked as Demo Mode until official agency API credentials are connected.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onReportIssue}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Start a Report
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Civic Footer */}
      <footer className="bg-slate-950 text-slate-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <CivicLogoMark light />
            <p className="mt-2 text-xs text-slate-400">
              Your Voice. Your City. Your Proof. — AI-Powered Civic Issue Management Prototype.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-400">
            <button
              type="button"
              onClick={onOpenAIAgent}
              className="hover:text-white transition-colors cursor-pointer"
            >
              AI Agent
            </button>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#track-complaint" className="hover:text-white transition-colors">
              Track Complaint
            </a>
            <button
              type="button"
              onClick={onOpenCitizenPortal}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Citizen Portal
            </button>
            <button
              type="button"
              onClick={onOpenAdminPortal}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Admin Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
