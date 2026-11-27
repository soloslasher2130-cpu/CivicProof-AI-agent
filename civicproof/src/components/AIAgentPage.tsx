import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { apiRequest, formatDateTime } from '../lib/api';
import type {
  AuthSession,
  CategoryItem,
  CivicDatabaseSnapshot,
  ComplaintPriority,
  ComplaintRecord,
  DepartmentItem,
  DispatchReceipt,
  SimilarComplaintMatch,
  SupportedLanguage,
  UnifiedAgentResponse,
} from '../types';
import {
  CivicLogoMark,
  PriorityLabel,
  ResilientImage,
  StatusLabel,
} from './StatusIndicator';

interface AIAgentPageProps {
  categories: CategoryItem[];
  departments: DepartmentItem[];
  citizenSession: AuthSession | null;
  onDataChanged: () => void;
  onGoHome: () => void;
  onOpenCitizenPortal: () => void;
  onOpenAdminPortal: () => void;
}

interface AgentTurn {
  id: string;
  role: 'user' | 'agent';
  text: string;
  photoPreview?: string;
  intent?: UnifiedAgentResponse['intent'];
  detectedLanguage?: SupportedLanguage;
  aiMode?: 'gemini' | 'fallback';
  modelUsed?: string;
  aiNotice?: string;
  dataInsights?: string[];
  photoObservation?: string;
  similarComplaints?: SimilarComplaintMatch[];
}

const QUICK_PROMPTS: Array<{
  label: string;
  lang: 'Auto-detect' | SupportedLanguage;
  text: string;
}> = [
  {
    label: 'Analyze Live Civic Data',
    lang: 'English',
    text: 'Analyze the live civic complaint data across areas, categories, and departments. Highlight the main hotspots and bottlenecks.',
  },
  {
    label: 'Report Garbage (Tanglish)',
    lang: 'Tanglish',
    text: 'Enga street-la kuppai romba naala clear pannala.',
  },
  {
    label: 'Report Pothole (Tamil)',
    lang: 'Tamil',
    text: 'அடையாறு 2வது மெயின் ரோட்டில் பெரிய குழி ஏற்பட்டு மழைநீர் தேங்கியுள்ளது.',
  },
  {
    label: 'Ask Department & SLA',
    lang: 'English',
    text: 'Which government department handles broken streetlights, what is their target SLA, and how does CivicProof route it?',
  },
];

const CHENNAI_AREAS = [
  'Adyar',
  'Anna Nagar',
  'T. Nagar',
  'Velachery',
  'Mylapore',
  'Tambaram',
  'Besant Nagar',
  'Guindy',
  'Kodambakkam',
  'Nungambakkam',
  'Porur',
  'Thiruvanmiyur',
];

export function AIAgentPage({
  categories,
  departments,
  citizenSession,
  onDataChanged,
  onGoHome,
  onOpenCitizenPortal,
  onOpenAdminPortal,
}: AIAgentPageProps) {
  const [snapshot, setSnapshot] = useState<CivicDatabaseSnapshot | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<'Auto-detect' | SupportedLanguage>(
    citizenSession?.user.preferred_language || 'Auto-detect'
  );
  const [inputText, setInputText] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState('');
  const [pendingPhotoName, setPendingPhotoName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [turns, setTurns] = useState<AgentTurn[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: 'Welcome to the CivicProof AI Agent. Ask me to analyze live municipal complaint data, answer questions about government departments and SLAs in Tamil, Tanglish, or English, or describe a neighborhood issue and I will prepare a structured request ready to dispatch.',
      intent: 'civic_question',
    },
  ]);

  // Editable Government Request Dispatch State
  const [draftOpen, setDraftOpen] = useState(false);
  const [originalDescription, setOriginalDescription] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [draftLanguage, setDraftLanguage] = useState<SupportedLanguage>('English');
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id || 1);
  const [departmentId, setDepartmentId] = useState<number>(departments[0]?.id || 1);
  const [area, setArea] = useState('');
  const [streetLandmark, setStreetLandmark] = useState('');
  const [priority, setPriority] = useState<ComplaintPriority>('Medium');
  const [priorityReason, setPriorityReason] = useState('');
  const [routingExplanation, setRoutingExplanation] = useState('');
  const [draftPhoto, setDraftPhoto] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState('');
  const [receipt, setReceipt] = useState<{
    complaint: ComplaintRecord;
    dispatchReceipt: DispatchReceipt;
  } | null>(null);
  const [copiedLetter, setCopiedLetter] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await apiRequest<{ snapshot: CivicDatabaseSnapshot }>('/api/agent/snapshot');
      setSnapshot(data.snapshot);
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPG, PNG, or WEBP photographs are supported.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Please upload a photograph smaller than 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPendingPhoto(reader.result);
        setPendingPhotoName(file.name);
      }
    };
    reader.readAsDataURL(file);
  }

  async function sendToAgent(
    overrideText?: string,
    overrideLang?: 'Auto-detect' | SupportedLanguage
  ) {
    const text = (overrideText ?? inputText).trim();
    const langToUse = overrideLang ?? preferredLanguage;
    if (text.length < 3) {
      setError('Please enter at least a few words for the AI agent.');
      return;
    }

    setError('');
    setDispatchError('');
    const attachedPhoto = pendingPhoto;
    const userTurn: AgentTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      photoPreview: attachedPhoto || undefined,
    };

    const conversationHistory = turns
      .filter((t) => t.id !== 'welcome')
      .slice(-6)
      .map((t) => ({ role: t.role, text: t.text }));

    setTurns((prev) => [...prev, userTurn]);
    setInputText('');
    setPendingPhoto('');
    setPendingPhotoName('');
    setSending(true);

    try {
      const data = await apiRequest<{
        result: UnifiedAgentResponse;
        snapshot: CivicDatabaseSnapshot;
      }>('/api/agent/interact', {
        method: 'POST',
        token: citizenSession?.token || null,
        body: {
          message: text,
          preferredLanguage: langToUse,
          conversationHistory,
          photoUrl: attachedPhoto,
        },
      });

      const res = data.result;
      setSnapshot(data.snapshot);

      const agentTurn: AgentTurn = {
        id: `a-${Date.now()}`,
        role: 'agent',
        text: res.agentReply,
        intent: res.intent,
        detectedLanguage: res.detectedLanguage,
        aiMode: res.aiMode,
        modelUsed: res.modelUsed,
        aiNotice: res.aiNotice,
        dataInsights: res.dataInsights,
        photoObservation: res.photoObservation,
        similarComplaints: res.similarComplaints,
      };
      setTurns((prev) => [...prev, agentTurn]);

      if (res.readyToDraftRequest && res.draftRequest) {
        const d = res.draftRequest;
        setDraftOpen(true);
        setReceipt(null);
        setOriginalDescription(d.originalDescription);
        setAiSummary(d.issueSummary);
        setDraftLanguage(d.language);
        setCategoryId(d.categoryId);
        setDepartmentId(d.departmentId);
        setRoutingExplanation(d.routingExplanation);
        setPriority(d.priority);
        setPriorityReason(d.priorityReason);
        if (d.area) setArea(d.area);
        if (d.streetLandmark) setStreetLandmark(d.streetLandmark);
        if (attachedPhoto) setDraftPhoto(attachedPhoto);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach CivicProof AI Agent.');
    } finally {
      setSending(false);
    }
  }

  function handleCategoryChange(nextId: number) {
    setCategoryId(nextId);
    const cat = categories.find((c) => c.id === nextId);
    if (cat) {
      setDepartmentId(cat.default_department_id);
      const dept = departments.find((d) => d.id === cat.default_department_id);
      if (dept) {
        setRoutingExplanation(
          `Assigned to ${dept.name} based on category "${cat.name}"${area ? ` in ${area}` : ''}.`
        );
      }
    }
  }

  async function handleDispatchRequest(e: React.FormEvent) {
    e.preventDefault();
    setDispatchError('');

    if (originalDescription.trim().length < 5) {
      setDispatchError('Please enter a brief description of the issue.');
      return;
    }
    if (area.trim().length < 2) {
      setDispatchError('Location / Area is required to route the government request.');
      return;
    }
    if (streetLandmark.trim().length < 3) {
      setDispatchError('Street name or nearby landmark is required.');
      return;
    }
    if (!confirmed) {
      setDispatchError('Please check the confirmation box before sending the request.');
      return;
    }

    setDispatching(true);
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        dispatchReceipt: DispatchReceipt;
        snapshot: CivicDatabaseSnapshot;
      }>('/api/agent/dispatch', {
        method: 'POST',
        token: citizenSession?.token || null,
        body: {
          originalDescription: originalDescription.trim(),
          aiSummary: aiSummary.trim() || originalDescription.trim(),
          language: draftLanguage,
          categoryId,
          departmentId,
          area: area.trim(),
          streetLandmark: streetLandmark.trim(),
          photoUrl: draftPhoto,
          routingExplanation: routingExplanation.trim(),
          priority,
          priorityReason: priorityReason.trim(),
          confirmed: true,
        },
      });

      setReceipt({ complaint: data.complaint, dispatchReceipt: data.dispatchReceipt });
      setSnapshot(data.snapshot);
      onDataChanged();

      setTurns((prev) => [
        ...prev,
        {
          id: `dispatch-${Date.now()}`,
          role: 'agent',
          intent: 'complaint_intake',
          text: `Government request recorded under Demo Submission Mode with Reference ID ${data.complaint.reference_id} and routed to ${data.dispatchReceipt.recommendedDepartment}. For official external filing, use: ${data.dispatchReceipt.officialChannel}.`,
        },
      ]);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Unable to dispatch request.');
    } finally {
      setDispatching(false);
    }
  }

  function handleResetSession() {
    setTurns([
      {
        id: 'welcome',
        role: 'agent',
        text: 'Session cleared. Ask me to analyze live civic data, answer questions about government departments and SLAs, or describe a civic problem to prepare a government request.',
        intent: 'civic_question',
      },
    ]);
    setDraftOpen(false);
    setReceipt(null);
    setOriginalDescription('');
    setAiSummary('');
    setArea('');
    setStreetLandmark('');
    setDraftPhoto('');
    setConfirmed(false);
    setError('');
    setDispatchError('');
  }

  function copyOfficialLetter() {
    if (!receipt) return;
    const c = receipt.complaint;
    const d = receipt.dispatchReceipt;
    const letter = [
      `To: ${d.recommendedDepartment}`,
      `Official Channel: ${d.officialChannel}`,
      `CivicProof Reference ID: ${c.reference_id}`,
      `Category: ${c.category_name} | Priority: ${c.priority}`,
      `Location: ${c.street_landmark}, ${c.area}`,
      `Date Recorded: ${formatDateTime(c.created_at)}`,
      '',
      `Summary: ${c.ai_summary}`,
      `Original Citizen Statement (${c.language}): ${c.original_description}`,
      '',
      `Routing Rationale: ${c.routing_explanation}`,
    ].join('\n');
    navigator.clipboard?.writeText(letter).then(() => {
      setCopiedLetter(true);
      setTimeout(() => setCopiedLetter(false), 2500);
    });
  }

  const selectedDept = departments.find((d) => d.id === departmentId) || departments[0];
  const topHotspot = snapshot?.byArea[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <button type="button" onClick={onGoHome} className="cursor-pointer">
            <CivicLogoMark />
          </button>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={onGoHome}
              className="hover:text-[#0F2D5C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Home
            </button>
            <span className="text-[#0F2D5C] font-semibold border-b-2 border-[#0F2D5C] py-5 whitespace-nowrap shrink-0">
              AI Agent
            </span>
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
              onClick={handleResetSession}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Session</span>
            </button>
          </div>
        </div>
      </header>

      {/* Live Database Context Strip */}
      <section className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight">
              CivicProof AI Agent — Data Analysis, Q&amp;A &amp; Government Dispatch
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Connected to live SQLite complaint records · Supports Tamil, Tanglish, English &amp; Photo Inspection
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs">
            <div>
              <p className="text-slate-400">Live Records</p>
              <p className="font-mono tabular-nums font-semibold text-base">
                {snapshot ? snapshot.totals.total : '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Open Queue</p>
              <p className="font-mono tabular-nums font-semibold text-base text-amber-300">
                {snapshot ? snapshot.totals.pending + snapshot.totals.inProgress : '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Resolution Rate</p>
              <p className="font-mono tabular-nums font-semibold text-base text-emerald-400">
                {snapshot ? `${snapshot.totals.resolutionRate}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Top Hotspot</p>
              <p className="font-semibold text-base">
                {topHotspot ? `${topHotspot.name} (${topHotspot.count})` : '—'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main 2-Column Agent + Government Dispatch Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (7 cols): Conversational AI Agent + Data Analysis */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden">
          {/* Quick-Start Capabilities Bar */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Try an Agent Action
              </span>
              <div className="flex items-center gap-2">
                <label htmlFor="agent-lang" className="text-xs text-slate-600">
                  Language:
                </label>
                <select
                  id="agent-lang"
                  value={preferredLanguage}
                  onChange={(e) =>
                    setPreferredLanguage(e.target.value as 'Auto-detect' | SupportedLanguage)
                  }
                  className="px-2 py-1 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-800"
                >
                  <option value="Auto-detect">Auto-detect</option>
                  <option value="Tanglish">Tanglish</option>
                  <option value="Tamil">Tamil (தமிழ்)</option>
                  <option value="English">English</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setPreferredLanguage(qp.lang);
                    sendToAgent(qp.text, qp.lang);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-blue-50 hover:text-[#0F2D5C] border border-slate-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation Transcript */}
          <div className="p-5 space-y-4 overflow-y-auto min-h-[420px] max-h-[560px]">
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={`max-w-[92%] rounded-xl px-4 py-3 text-sm leading-relaxed space-y-2.5 ${
                    turn.role === 'user'
                      ? 'bg-[#0F2D5C] text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-900'
                  }`}
                >
                  {turn.role === 'agent' && turn.intent && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-b border-slate-200 pb-1.5">
                      <span>
                        {turn.intent === 'data_analysis'
                          ? 'Civic Data Analysis'
                          : turn.intent === 'complaint_intake'
                          ? 'Complaint Triage & Dispatch Draft'
                          : 'Civic Advisory Response'}
                        {turn.detectedLanguage ? ` · ${turn.detectedLanguage}` : ''}
                      </span>
                      {turn.aiMode && (
                        <span>
                          {turn.aiMode === 'gemini' ? 'Live Gemini AI' : 'Database Fallback'}
                        </span>
                      )}
                    </div>
                  )}

                  {turn.photoPreview && (
                    <ResilientImage
                      src={turn.photoPreview}
                      alt="Citizen uploaded issue photo"
                      className="w-48 h-32 object-cover rounded-lg border border-white/20"
                    />
                  )}

                  <p className="whitespace-pre-line">{turn.text}</p>

                  {turn.photoObservation && (
                    <p className="text-xs text-slate-700 pt-2 border-t border-slate-200">
                      <strong>Photo Analysis:</strong> {turn.photoObservation}
                    </p>
                  )}

                  {turn.dataInsights && turn.dataInsights.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                        <span>Key Findings from Live Database</span>
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700">
                        {turn.dataInsights.map((ins, i) => (
                          <li key={i}>{ins}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {turn.similarComplaints && turn.similarComplaints.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      <p className="text-xs font-semibold text-amber-900">
                        Similar Active Complaints Found ({turn.similarComplaints.length})
                      </p>
                      <ul className="space-y-1 text-xs text-slate-700">
                        {turn.similarComplaints.map((m) => (
                          <li key={m.id}>
                            <span className="font-mono font-semibold text-slate-900">
                              {m.reference_id}
                            </span>{' '}
                            ({Math.round(m.similarity_score * 100)}% match · {m.area}) — {m.ai_summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {turn.aiMode === 'fallback' && turn.aiNotice && (
                    <p className="text-xs text-amber-800 pt-1">{turn.aiNotice}</p>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0F2D5C]" aria-hidden="true" />
                  <span>CivicProof AI Agent is analyzing live data and preparing a response...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Composer */}
          <div className="p-4 border-t border-slate-200 bg-white space-y-2.5">
            {error && (
              <div className="p-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {pendingPhoto && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span className="text-slate-700 truncate">Attached photo: {pendingPhotoName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPhoto('');
                    setPendingPhotoName('');
                  }}
                  className="text-red-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendToAgent();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer shrink-0">
                <ImagePlus className="w-4 h-4 text-slate-500" aria-hidden="true" />
                <span className="sm:hidden">Attach Photo</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoSelect}
                  className="sr-only"
                />
              </label>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask a civic data question, or describe a local issue in Tamil / Tanglish / English..."
                className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
              />

              <button
                type="submit"
                disabled={sending || inputText.trim().length < 3}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </section>

        {/* RIGHT COLUMN (5 cols): Government Department Request Builder & Dispatch Console */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-950 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#0F2D5C]" aria-hidden="true" />
                <span>Government Request Dispatch</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Review AI-prepared department routing and send a confirmed request.
              </p>
            </div>
            {!draftOpen && !receipt && (
              <button
                type="button"
                onClick={() => setDraftOpen(true)}
                className="px-3 py-1.5 text-xs font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                Open Form
              </button>
            )}
          </div>

          {receipt ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Request Logged: {receipt.complaint.reference_id}</span>
                </div>
                <p className="text-xs text-amber-900 font-medium">
                  DEMO SUBMISSION · Official Municipal API Ready (Not Externally Transmitted)
                </p>
                <p className="text-xs text-emerald-900 leading-relaxed">
                  {receipt.dispatchReceipt.disclaimer}
                </p>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status</span>
                  <StatusLabel status={receipt.complaint.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Department</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {receipt.dispatchReceipt.recommendedDepartment}
                  </span>
                </div>
                <div>
                  <p className="text-slate-500">Official Reporting Channel</p>
                  <p className="font-medium text-slate-900 mt-0.5">
                    {receipt.dispatchReceipt.officialChannel}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Official API Integration Payload</p>
                  <pre className="mt-1 p-2.5 bg-slate-950 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto">
                    {JSON.stringify(receipt.dispatchReceipt.integrationReadyPayload, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={copyOfficialLetter}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  {copiedLetter ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>Copied Official Draft</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy Official Letter</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onOpenAdminPortal}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg cursor-pointer"
                >
                  View in Admin Console
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReceipt(null);
                    setConfirmed(false);
                    setOriginalDescription('');
                    setAiSummary('');
                    setStreetLandmark('');
                  }}
                  className="text-xs text-blue-700 hover:underline ml-auto cursor-pointer"
                >
                  New Request
                </button>
              </div>
            </div>
          ) : draftOpen ? (
            <form onSubmit={handleDispatchRequest} className="space-y-4">
              {dispatchError && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
                  {dispatchError}
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Recommended Priority</span>
                <PriorityLabel priority={priority} />
              </div>

              <div>
                <label htmlFor="ag-dept" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Government Department *
                </label>
                <select
                  id="ag-dept"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
                {selectedDept && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Channel: {selectedDept.official_channel} · SLA: {selectedDept.sla_hours}h
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ag-cat" className="block text-xs font-medium text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    id="ag-cat"
                    value={categoryId}
                    onChange={(e) => handleCategoryChange(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ag-prio" className="block text-xs font-medium text-slate-700 mb-1">
                    Priority *
                  </label>
                  <select
                    id="ag-prio"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ag-area" className="block text-xs font-medium text-slate-700 mb-1">
                    Area / Neighborhood *
                  </label>
                  <input
                    id="ag-area"
                    type="text"
                    required
                    list="agent-areas"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="e.g. Adyar"
                    className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg"
                  />
                  <datalist id="agent-areas">
                    {CHENNAI_AREAS.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="ag-street" className="block text-xs font-medium text-slate-700 mb-1">
                    Street / Landmark *
                  </label>
                  <input
                    id="ag-street"
                    type="text"
                    required
                    value={streetLandmark}
                    onChange={(e) => setStreetLandmark(e.target.value)}
                    placeholder="e.g. 2nd Main Road"
                    className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ag-summary" className="block text-xs font-medium text-slate-700 mb-1">
                  Formal Request Summary *
                </label>
                <textarea
                  id="ag-summary"
                  rows={3}
                  required
                  value={aiSummary}
                  onChange={(e) => {
                    setAiSummary(e.target.value);
                    if (!originalDescription) setOriginalDescription(e.target.value);
                  }}
                  placeholder="Structured formal request drafted by the AI agent..."
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {routingExplanation && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <strong>Routing Rationale:</strong> {routingExplanation}
                </p>
              )}

              {draftPhoto && (
                <ResilientImage
                  src={draftPhoto}
                  alt="Attached request evidence"
                  className="w-full h-32 object-cover rounded-lg border border-slate-200"
                />
              )}

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
                <FileCheck2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>Demo Submission:</strong> Records this request in CivicProof’s persistent
                  database with a Reference ID and generates an official-channel filing draft.
                </span>
              </div>

              <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-800">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0F2D5C]"
                />
                <span>
                  I confirm the location, department, and issue summary are accurate and ready to
                  dispatch.
                </span>
              </label>

              <button
                type="submit"
                disabled={dispatching}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
              >
                {dispatching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Sending Government Request...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" aria-hidden="true" />
                    <span>Send Request to Government (Demo)</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-slate-600 leading-relaxed text-xs">
                Describe any civic problem in the AI Agent chat on the left—or click{' '}
                <strong>Report Garbage (Tanglish)</strong>—and the agent will automatically draft a
                complete, department-routed government request right here for your review.
              </p>

              {snapshot && (
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <p className="text-xs font-semibold text-slate-800">
                    Live Category Breakdown (Database)
                  </p>
                  <div className="space-y-2">
                    {snapshot.byCategory.slice(0, 5).map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 truncate pr-2">{cat.name}</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {cat.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
