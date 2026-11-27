import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileCheck2,
  ImagePlus,
  Loader2,
  MessageSquare,
  Send,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { apiRequest, formatDateTime } from '../lib/api';
import type {
  AIAnalysisResult,
  CategoryItem,
  ComplaintPriority,
  ComplaintRecord,
  DepartmentItem,
  DispatchReceipt,
  SimilarComplaintMatch,
  SupportedLanguage,
} from '../types';
import { PriorityLabel, ResilientImage, StatusLabel } from './StatusIndicator';

interface AIComplaintStudioProps {
  token: string;
  categories: CategoryItem[];
  departments: DepartmentItem[];
  defaultLanguage: SupportedLanguage;
  defaultWard: string;
  onComplaintCreated: (complaint: ComplaintRecord) => void;
  onViewComplaint: (complaintId: number) => void;
}

const SAMPLE_PROMPTS: Array<{ label: string; lang: SupportedLanguage; text: string }> = [
  {
    label: 'Tanglish (Garbage)',
    lang: 'Tanglish',
    text: 'Enga street-la kuppai romba naala clear pannala.',
  },
  {
    label: 'Tamil (Road Pothole)',
    lang: 'Tamil',
    text: 'வேளச்சேரி மெயின் ரோட்டில் பெரிய குழி ஏற்பட்டு மழைநீர் தேங்கியுள்ளது. இருசக்கர வாகனங்கள் விபத்துக்குள்ளாகின்றன.',
  },
  {
    label: 'English (Streetlight)',
    lang: 'English',
    text: 'Four streetlights near Adyar Besant Avenue Bus Stop have been completely dark for 5 nights.',
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

export function AIComplaintStudio({
  token,
  categories,
  departments,
  defaultLanguage,
  defaultWard,
  onComplaintCreated,
  onViewComplaint,
}: AIComplaintStudioProps) {
  const [complaintText, setComplaintText] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'Auto-detect' | SupportedLanguage>(
    defaultLanguage || 'Auto-detect'
  );
  const [followUpAnswer, setFollowUpAnswer] = useState('');

  // Structured editable form fields
  const [language, setLanguage] = useState<SupportedLanguage>(defaultLanguage || 'English');
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id || 1);
  const [area, setArea] = useState<string>(defaultWard.split('-').pop()?.trim() || '');
  const [streetLandmark, setStreetLandmark] = useState<string>('');
  const [incidentDatetime, setIncidentDatetime] = useState<string>(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [photoName, setPhotoName] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<number>(departments[0]?.id || 1);
  const [routingExplanation, setRoutingExplanation] = useState<string>('');
  const [priority, setPriority] = useState<ComplaintPriority>('Medium');
  const [priorityReason, setPriorityReason] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(false);

  // Agent & similarity states
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [similarMatches, setSimilarMatches] = useState<SimilarComplaintMatch[]>([]);
  const [endorsedIds, setEndorsedIds] = useState<Record<number, string>>({});
  const [dismissedDuplicates, setDismissedDuplicates] = useState(false);

  // Interactive Civic AI Guide Q&A state
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'citizen' | 'agent'; text: string; modelUsed?: string }>
  >([]);

  // Submission states
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{
    complaint: ComplaintRecord;
    dispatchReceipt: DispatchReceipt;
  } | null>(null);

  async function runAIAnalysis(withFollowUp = false) {
    setError('');
    if (complaintText.trim().length < 5) {
      setError('Please describe your civic issue in at least a few words before analyzing.');
      return;
    }

    setAnalyzing(true);
    try {
      const data = await apiRequest<{ analysis: AIAnalysisResult }>('/api/citizen/ai/analyze', {
        method: 'POST',
        token,
        body: {
          complaintText,
          preferredLanguage,
          followUpAnswer: withFollowUp ? followUpAnswer : '',
          areaHint: area,
          streetHint: streetLandmark,
          photoUrl: photoDataUrl,
        },
      });

      const res = data.analysis;
      setAnalysis(res);
      setLanguage(res.detectedLanguage);
      setCategoryId(res.categoryId);
      setDepartmentId(res.departmentId);
      setAiSummary(res.issueSummary);
      setRoutingExplanation(res.routingExplanation);
      setPriority(res.suggestedPriority);
      setPriorityReason(res.priorityReason);
      if (res.extractedArea) setArea(res.extractedArea);
      if (res.extractedStreetLandmark) setStreetLandmark(res.extractedStreetLandmark);
      setSimilarMatches(res.similarComplaints || []);
      setDismissedDuplicates(false);
      if (withFollowUp && followUpAnswer.trim()) {
        setComplaintText((prev) => `${prev.trim()} (${followUpAnswer.trim()})`);
        setFollowUpAnswer('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze complaint right now.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAskCivicAgent(e: React.FormEvent) {
    e.preventDefault();
    const q = chatQuestion.trim();
    if (q.length < 3) return;
    setChatHistory((prev) => [...prev, { role: 'citizen', text: q }]);
    setChatQuestion('');
    setChatLoading(true);
    try {
      const data = await apiRequest<{
        answer: string;
        aiMode: 'gemini' | 'fallback';
        modelUsed?: string;
      }>('/api/citizen/ai/chat', {
        method: 'POST',
        token,
        body: {
          question: q,
          preferredLanguage,
          complaintContext: aiSummary
            ? `Category: ${analysis?.categoryName || ''}, Area: ${area}, Summary: ${aiSummary}`
            : complaintText.slice(0, 300),
        },
      });
      setChatHistory((prev) => [
        ...prev,
        { role: 'agent', text: data.answer, modelUsed: data.modelUsed },
      ]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: err instanceof Error ? err.message : 'Unable to reach the AI assistant right now.',
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleRefreshDuplicates(nextCategoryId: number, nextArea: string) {
    try {
      const res = await apiRequest<{ similarComplaints: SimilarComplaintMatch[] }>(
        '/api/citizen/complaints/check-similar',
        {
          method: 'POST',
          token,
          body: {
            categoryId: nextCategoryId,
            area: nextArea,
            streetLandmark,
            description: complaintText,
            summary: aiSummary,
          },
        }
      );
      setSimilarMatches(res.similarComplaints || []);
    } catch {
      // Non-blocking check
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
          `Assigned to ${dept.name} based on selected category "${cat.name}"${area ? ` in ${area}` : ''}.`
        );
      }
    }
    handleRefreshDuplicates(nextId, area);
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
        setPhotoDataUrl(reader.result);
        setPhotoName(file.name);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleEndorseExisting(match: SimilarComplaintMatch) {
    setError('');
    try {
      const res = await apiRequest<{
        referenceId: string;
        endorsementCount: number;
        message: string;
      }>(`/api/citizen/complaints/${match.id}/endorse`, {
        method: 'POST',
        token,
      });
      setEndorsedIds((prev) => ({ ...prev, [match.id]: res.message }));
      setSimilarMatches((prev) =>
        prev.map((m) =>
          m.id === match.id ? { ...m, endorsement_count: res.endorsementCount } : m
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to endorse existing complaint.');
    }
  }

  async function handleSubmitComplaint(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (complaintText.trim().length < 5) {
      setError('Please enter a clear complaint description.');
      return;
    }
    if (!area.trim()) {
      setError('Location / Area is required before submitting.');
      return;
    }
    if (!streetLandmark.trim()) {
      setError('Street name or nearby landmark is required so crews can locate the issue.');
      return;
    }
    if (!confirmed) {
      setError('Please check the citizen confirmation box to confirm the draft details.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiRequest<{
        complaint: ComplaintRecord;
        dispatchReceipt: DispatchReceipt;
      }>('/api/citizen/complaints', {
        method: 'POST',
        token,
        body: {
          originalDescription: complaintText.trim(),
          aiSummary: aiSummary.trim() || complaintText.trim(),
          language,
          categoryId,
          area: area.trim(),
          streetLandmark: streetLandmark.trim(),
          photoUrl: photoDataUrl,
          departmentId,
          routingExplanation: routingExplanation.trim(),
          priority,
          priorityReason: priorityReason.trim(),
          incidentDatetime: incidentDatetime
            ? new Date(incidentDatetime).toISOString()
            : new Date().toISOString(),
          confirmed: true,
          relatedComplaintIds: similarMatches.map((m) => m.id),
        },
      });

      setReceipt(data);
      onComplaintCreated(data.complaint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register complaint.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetStudio() {
    setComplaintText('');
    setFollowUpAnswer('');
    setAnalysis(null);
    setSimilarMatches([]);
    setEndorsedIds({});
    setDismissedDuplicates(false);
    setAiSummary('');
    setStreetLandmark('');
    setPhotoDataUrl('');
    setPhotoName('');
    setConfirmed(false);
    setReceipt(null);
    setError('');
  }

  const selectedDept = departments.find((d) => d.id === departmentId) || departments[0];

  // Confirmation Receipt Screen (Clearly Labelled DEMO SUBMISSION)
  if (receipt) {
    const { complaint, dispatchReceipt } = receipt;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 max-w-4xl">
        <div className="flex items-start gap-3.5 pb-5 border-b border-slate-200">
          <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-amber-800">
              DEMO SUBMISSION REGISTERED · NOT TRANSMITTED TO EXTERNAL GOVERNMENT API
            </p>
            <h2 className="font-display text-2xl font-bold text-slate-950 mt-1">
              Complaint Recorded: <span className="font-mono">{complaint.reference_id}</span>
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              {dispatchReceipt.disclaimer}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-500">Complaint Reference ID</p>
              <p className="font-mono font-semibold text-slate-950 text-base">
                {complaint.reference_id}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Recommended Department</p>
              <p className="font-semibold text-slate-900">{dispatchReceipt.recommendedDepartment}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Suggested Official Reporting Channel</p>
              <p className="text-slate-800">{dispatchReceipt.officialChannel}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">External Government API Status</p>
              <p className="text-amber-800 font-medium">{dispatchReceipt.externalStatusLabel}</p>
            </div>
          </div>

          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-900">Structured Complaint Draft</p>
            <p className="text-sm text-slate-800 leading-relaxed">{complaint.ai_summary}</p>
            <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-200">
              <p>
                <span className="text-slate-500">Category:</span> {complaint.category_name}
              </p>
              <p>
                <span className="text-slate-500">Location:</span> {complaint.street_landmark},{' '}
                {complaint.area}
              </p>
              <p>
                <span className="text-slate-500">Priority:</span> {complaint.priority}
              </p>
              <p>
                <span className="text-slate-500">Recorded At:</span>{' '}
                <span className="font-mono tabular-nums">{formatDateTime(complaint.created_at)}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-blue-950 mb-2">Recommended Next Actions</p>
          <ul className="space-y-1.5 text-sm text-blue-900 list-disc pl-5">
            {dispatchReceipt.nextActions.map((act) => (
              <li key={act}>{act}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onViewComplaint(complaint.id)}
            className="px-4 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Track This Complaint
          </button>
          <button
            type="button"
            onClick={resetStudio}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Register Another Issue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-950 tracking-tight">
          Multilingual AI Complaint Registration
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Describe your civic issue naturally in Tamil, Tanglish, or English. CivicProof’s AI agent
          will classify the problem, ask if location details are missing, check for similar
          neighborhood reports, and prepare an editable draft for your confirmation.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Natural Language Input & AI Agent Processing */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              01. Describe the civic problem in your preferred language
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Supports Tamil (தமிழ்), Tanglish, and English
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="pref-lang-select" className="text-xs font-medium text-slate-600">
              Reply Language:
            </label>
            <select
              id="pref-lang-select"
              value={preferredLanguage}
              onChange={(e) =>
                setPreferredLanguage(e.target.value as 'Auto-detect' | SupportedLanguage)
              }
              className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800"
            >
              <option value="Auto-detect">Auto-detect</option>
              <option value="Tanglish">Tanglish</option>
              <option value="Tamil">Tamil (தமிழ்)</option>
              <option value="English">English</option>
            </select>
          </div>
        </div>

        {/* Quick-try Hackathon Sample Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Try an example:</span>
          {SAMPLE_PROMPTS.map((sp) => (
            <button
              key={sp.label}
              type="button"
              onClick={() => {
                setComplaintText(sp.text);
                setPreferredLanguage(sp.lang);
                setError('');
              }}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {sp.label}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="complaint-description" className="sr-only">
            Complaint Description
          </label>
          <textarea
            id="complaint-description"
            rows={4}
            value={complaintText}
            onChange={(e) => setComplaintText(e.target.value)}
            placeholder='Example: "Enga street-la kuppai romba naala clear pannala." or describe any road, drainage, streetlight, or water issue...'
            className="w-full px-3.5 py-3 text-sm border border-slate-300 rounded-lg focus:border-blue-700 resize-y"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            The AI agent extracts category, priority, and department without submitting until you
            confirm.
          </p>
          <button
            type="button"
            onClick={() => runAIAnalysis(false)}
            disabled={analyzing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Analyzing Complaint...</span>
              </>
            ) : (
              <>
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
                <span>Analyze with AI Agent</span>
              </>
            )}
          </button>
        </div>

        {/* AI Response & Follow-Up Question Panel */}
        {analysis && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Detected Language: <strong className="text-slate-800">{analysis.detectedLanguage}</strong>
                  {' · '}
                  Category: <strong className="text-slate-800">{analysis.categoryName}</strong>
                </span>
                <span className="text-slate-600 font-medium">
                  {analysis.aiMode === 'gemini'
                    ? 'Live Gemini Multilingual Agent'
                    : 'Keyword Classification Fallback'}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-900 leading-relaxed">
                {analysis.replyInPreferredLanguage}
              </p>
              {analysis.photoObservation && (
                <p className="text-xs text-slate-700 pt-1 border-t border-slate-200">
                  <strong>Photo Observation:</strong> {analysis.photoObservation}
                </p>
              )}
              {analysis.aiMode === 'fallback_keyword' && (
                <p className="text-xs text-amber-800">{analysis.aiNotice}</p>
              )}
            </div>

            {analysis.needsFollowUp && analysis.followUpQuestion && (
              <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-lg space-y-3">
                <div>
                  <p className="text-xs font-semibold text-amber-900">
                    Follow-Up Question ({analysis.missingFields.join(', ') || 'Additional Detail Needed'})
                  </p>
                  <p className="text-sm text-amber-950 mt-1">{analysis.followUpQuestion}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={followUpAnswer}
                    onChange={(e) => setFollowUpAnswer(e.target.value)}
                    placeholder="Reply with your area & street/landmark (e.g. Adyar, 2nd Main Road near Bus Stop)"
                    className="flex-1 px-3 py-2 text-sm bg-white border border-amber-300 rounded-lg focus:border-blue-700"
                  />
                  <button
                    type="button"
                    onClick={() => runAIAnalysis(true)}
                    disabled={analyzing || !followUpAnswer.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-amber-800 hover:bg-amber-900 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Update Draft with Answer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive Multilingual Civic Process Q&A */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <p className="text-xs font-semibold text-slate-700">
            Ask CivicProof AI Agent about departments, SLA timelines, or complaint steps (Tamil, Tanglish, or English)
          </p>

          {chatHistory.length > 0 && (
            <div className="space-y-2.5 max-h-56 overflow-y-auto p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={
                    msg.role === 'citizen'
                      ? 'text-right'
                      : 'text-left'
                  }
                >
                  <div
                    className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'citizen'
                        ? 'bg-[#0F2D5C] text-white'
                        : 'bg-white border border-slate-200 text-slate-800'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAskCivicAgent} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              placeholder='Ask e.g. "Indha complaint-ku evlo hours-la action eduppanga?" or "Which department handles water leaks?"'
              className="flex-1 px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:border-blue-700"
            />
            <button
              type="submit"
              disabled={chatLoading || chatQuestion.trim().length < 3}
              className="px-4 py-2 text-xs font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {chatLoading ? 'Thinking...' : 'Ask Agent'}
            </button>
          </form>
        </div>
      </section>

      {/* Step 2: Duplicate / Similar Complaint Detection Panel */}
      {similarMatches.length > 0 && !dismissedDuplicates && (
        <section className="bg-white border border-amber-300 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-950">
                Similar Active Complaints Detected ({similarMatches.length})
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Before filing a duplicate report, check if one of these open complaints matches your
                street. You can endorse an existing report (+1) or continue filing if yours is a
                separate issue.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedDuplicates(true)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap cursor-pointer"
            >
              My issue is different — Continue
            </button>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {similarMatches.map((match) => (
              <div
                key={match.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-900">
                      {match.reference_id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{Math.round(match.similarity_score * 100)}% match</span>
                    <span aria-hidden="true">·</span>
                    <StatusLabel status={match.status} />
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {match.endorsement_count} citizen supporters
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900">{match.ai_summary}</p>
                  <p className="text-xs text-slate-600">
                    {match.street_landmark}, {match.area} · {match.match_reasons.join('; ')}
                  </p>
                  {endorsedIds[match.id] && (
                    <p className="text-xs font-medium text-emerald-700 pt-1">
                      {endorsedIds[match.id]}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleEndorseExisting(match)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Support Existing (+1)</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step 3: Complete Editable Structured Complaint Review & Confirmation Form */}
      <form
        onSubmit={handleSubmitComplaint}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="border-b border-slate-200 pb-4">
          <h3 className="font-display text-base font-semibold text-slate-950">
            02. Review, Edit &amp; Confirm Structured Complaint
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            All AI-extracted fields remain fully editable before you submit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="form-category" className="block text-xs font-medium text-slate-700 mb-1.5">
              Issue Category *
            </label>
            <select
              id="form-category"
              required
              value={categoryId}
              onChange={(e) => handleCategoryChange(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-700"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="form-language" className="block text-xs font-medium text-slate-700 mb-1.5">
              Complaint Language *
            </label>
            <select
              id="form-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-700"
            >
              <option value="Tanglish">Tanglish</option>
              <option value="Tamil">Tamil (தமிழ்)</option>
              <option value="English">English</option>
            </select>
          </div>

          <div>
            <label htmlFor="form-area" className="block text-xs font-medium text-slate-700 mb-1.5">
              Location / Area *
            </label>
            <input
              id="form-area"
              type="text"
              list="civic-areas-list"
              required
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onBlur={() => handleRefreshDuplicates(categoryId, area)}
              placeholder="e.g. Adyar, Anna Nagar, Velachery"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
            />
            <datalist id="civic-areas-list">
              {CHENNAI_AREAS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="form-street" className="block text-xs font-medium text-slate-700 mb-1.5">
              Street Name or Nearby Landmark *
            </label>
            <input
              id="form-street"
              type="text"
              required
              value={streetLandmark}
              onChange={(e) => setStreetLandmark(e.target.value)}
              placeholder="e.g. 2nd Main Road, near Gandhi Nagar Bus Stop"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
            />
          </div>

          <div>
            <label htmlFor="form-datetime" className="block text-xs font-medium text-slate-700 mb-1.5">
              Date &amp; Time Observed *
            </label>
            <input
              id="form-datetime"
              type="datetime-local"
              required
              value={incidentDatetime}
              onChange={(e) => setIncidentDatetime(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:border-blue-700"
            />
          </div>

          <div>
            <label htmlFor="form-priority" className="block text-xs font-medium text-slate-700 mb-1.5">
              Suggested Priority *
            </label>
            <select
              id="form-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-700"
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
            {priorityReason && (
              <p className="text-xs text-slate-500 mt-1">{priorityReason}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="form-summary" className="block text-xs font-medium text-slate-700 mb-1.5">
            AI-Generated Structured Complaint Summary (Editable)
          </label>
          <textarea
            id="form-summary"
            rows={2}
            value={aiSummary}
            onChange={(e) => setAiSummary(e.target.value)}
            placeholder="Formal summary of the issue for municipal department routing..."
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
          />
        </div>

        {/* Department Routing Explanation Block */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Building2 className="w-4 h-4 text-[#0F2D5C]" aria-hidden="true" />
              <span>Recommended Government Department</span>
            </div>
            <PriorityLabel priority={priority} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="form-dept" className="block text-xs font-medium text-slate-600 mb-1">
                Assigned Department
              </label>
              <select
                id="form-dept"
                value={departmentId}
                onChange={(e) => setDepartmentId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-600 space-y-1">
              <p className="font-medium text-slate-800">Official Reporting Channel</p>
              <p>{selectedDept?.official_channel || 'Municipal Grievance Desk'}</p>
              <p className="text-slate-500">
                Target municipal SLA: <span className="font-mono tabular-nums">{selectedDept?.sla_hours || 48}h</span>
              </p>
            </div>
          </div>

          {routingExplanation && (
            <p className="text-xs text-slate-700 leading-relaxed pt-2 border-t border-slate-200">
              <strong>Routing Rationale:</strong> {routingExplanation}
            </p>
          )}
        </div>

        {/* Optional Issue Photograph Upload */}
        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-700">
            Optional Issue Photograph (JPG, PNG, WEBP up to 3 MB)
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
              <ImagePlus className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>{photoDataUrl ? 'Replace Photograph' : 'Upload Issue Photo'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoUpload}
                className="sr-only"
              />
            </label>
            {photoName && <span className="text-xs text-slate-600">{photoName}</span>}
            {photoDataUrl && (
              <button
                type="button"
                onClick={() => {
                  setPhotoDataUrl('');
                  setPhotoName('');
                }}
                className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Remove</span>
              </button>
            )}
          </div>
          {photoDataUrl && (
            <div className="mt-2 max-w-xs">
              <ResilientImage
                src={photoDataUrl}
                alt="Uploaded civic issue preview"
                className="w-full h-36 object-cover rounded-lg border border-slate-200"
              />
            </div>
          )}
        </div>

        {/* Citizen Confirmation & Demo Submission Disclosure */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <div className="flex items-start gap-2.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <FileCheck2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong>Demo Submission Workflow:</strong> Submitting saves this complaint in the
              CivicProof database with a verifiable Reference ID and shows the official municipal
              channel. It does not falsely claim external submission to a live government API.
            </span>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0F2D5C]"
            />
            <span className="text-sm text-slate-800">
              I have reviewed the AI-generated complaint summary, category, location, and
              recommended department, and confirm these details are accurate.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Submitting Demo Complaint...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>Confirm &amp; Submit Complaint</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
