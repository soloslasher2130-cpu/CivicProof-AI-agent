export type ComplaintStatus =
  | 'Submitted'
  | 'Forwarded'
  | 'Under Review'
  | 'In Progress'
  | 'Resolved'
  | 'Rejected';

export type ComplaintPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export type SupportedLanguage = 'English' | 'Tamil' | 'Tanglish';

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  phone: string;
  ward: string;
  preferred_language: SupportedLanguage;
  role: 'citizen' | 'admin';
  is_demo: number;
  created_at: string;
}

export interface CategoryItem {
  id: number;
  name: string;
  description: string;
  default_department_id: number;
  default_department_name?: string;
  is_active: number;
}

export interface DepartmentItem {
  id: number;
  code: string;
  name: string;
  description: string;
  official_channel: string;
  contact_email: string;
  sla_hours: number;
  api_integration_status: string;
  complaint_count?: number;
  resolved_count?: number;
}

export interface AdminSetupState {
  hasEnvPasscode: boolean;
  hasClaimedAdmin: boolean;
  requiresFirstRunSetup: boolean;
}

export interface AppMeta {
  categories: CategoryItem[];
  departments: DepartmentItem[];
  adminSetup: AdminSetupState;
  aiConfigured: boolean;
}

export interface PublicStats {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  rejected: number;
  resolutionRate: number;
  departments: number;
}

export interface ComplaintRecord {
  id: number;
  reference_id: string;
  citizen_id: number;
  original_description: string;
  ai_summary: string;
  language: SupportedLanguage;
  category_id: number;
  category_name: string;
  area: string;
  street_landmark: string;
  photo_url: string;
  department_id: number;
  department_name: string;
  department_code?: string;
  official_channel?: string;
  sla_hours?: number;
  routing_explanation: string;
  priority: ComplaintPriority;
  priority_reason: string;
  status: ComplaintStatus;
  endorsement_count: number;
  submission_mode: 'DEMO_SUBMISSION' | 'OFFICIAL_VERIFIED';
  is_sample: number;
  incident_datetime: string;
  created_at: string;
  updated_at: string;
  citizen_name?: string;
  citizen_email?: string;
  citizen_phone?: string;
  citizen_ward?: string;
}

export interface StatusHistoryItem {
  id: number;
  previous_status: ComplaintStatus | null;
  new_status: ComplaintStatus;
  note: string;
  updated_by_name: string;
  created_at: string;
}

export interface SimilarComplaintMatch {
  id: number;
  reference_id: string;
  ai_summary: string;
  category_name: string;
  area: string;
  street_landmark: string;
  status: ComplaintStatus;
  endorsement_count: number;
  created_at: string;
  similarity_score: number;
  match_reasons: string[];
}

export interface SimilarLinkItem {
  similarity_score: number;
  relationship_type: string;
  related_id: number;
  reference_id: string;
  ai_summary: string;
  area: string;
  status: ComplaintStatus;
}

export interface AIAnalysisResult {
  aiMode: 'gemini' | 'fallback_keyword';
  modelUsed?: string;
  aiNotice: string;
  detectedLanguage: SupportedLanguage;
  replyInPreferredLanguage: string;
  photoObservation?: string;
  categoryId: number;
  categoryName: string;
  issueSummary: string;
  extractedArea: string;
  extractedStreetLandmark: string;
  departmentId: number;
  departmentName: string;
  officialChannel: string;
  routingExplanation: string;
  suggestedPriority: ComplaintPriority;
  priorityReason: string;
  missingFields: string[];
  needsFollowUp: boolean;
  followUpQuestion: string;
  nextActionAdvice: string;
  similarComplaints: SimilarComplaintMatch[];
}

export interface DispatchReceipt {
  submissionMode: 'DEMO_SUBMISSION' | 'OFFICIAL_VERIFIED';
  externalStatusLabel: string;
  disclaimer: string;
  recommendedDepartment: string;
  officialChannel: string;
  expectedSlaHours: number;
  nextActions: string[];
  integrationReadyPayload: {
    schemaVersion: string;
    departmentCode: string;
    referenceId: string;
    category: string;
    area: string;
    priority: string;
  };
}

export interface AdminAnalytics {
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    resolved: number;
    rejected: number;
    sampleCount: number;
    resolutionPercentage: number;
  };
  byCategory: Array<{ name: string; count: number }>;
  byArea: Array<{ name: string; count: number }>;
  byDepartment: Array<{
    name: string;
    code: string;
    total: number;
    resolved: number;
    openCount: number;
  }>;
  byStatus: Array<{ name: string; count: number }>;
  byPriority: Array<{ name: string; count: number }>;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export interface CivicDatabaseSnapshot {
  totals: {
    total: number;
    pending: number;
    inProgress: number;
    resolved: number;
    rejected: number;
    resolutionRate: number;
  };
  byCategory: Array<{ name: string; count: number }>;
  byArea: Array<{ name: string; count: number }>;
  byDepartment: Array<{
    id: number;
    code: string;
    name: string;
    official_channel: string;
    sla_hours: number;
    total: number;
    openCount: number;
    resolved: number;
  }>;
  recentOpen: Array<{
    reference_id: string;
    category: string;
    area: string;
    priority: string;
    status: string;
    summary: string;
  }>;
}

export interface UnifiedAgentResponse {
  aiMode: 'gemini' | 'fallback';
  modelUsed?: string;
  aiNotice: string;
  intent: 'complaint_intake' | 'data_analysis' | 'civic_question';
  detectedLanguage: SupportedLanguage;
  agentReply: string;
  dataInsights: string[];
  photoObservation: string;
  readyToDraftRequest: boolean;
  draftRequest: {
    originalDescription: string;
    issueSummary: string;
    language: SupportedLanguage;
    categoryId: number;
    categoryName: string;
    departmentId: number;
    departmentName: string;
    departmentCode: string;
    officialChannel: string;
    slaHours: number;
    routingExplanation: string;
    area: string;
    streetLandmark: string;
    priority: ComplaintPriority;
    priorityReason: string;
    missingFields: string[];
    followUpQuestion: string;
  } | null;
  similarComplaints: SimilarComplaintMatch[];
}

