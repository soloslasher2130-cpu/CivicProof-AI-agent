export interface DepartmentRecord {
  id: number;
  code: string;
  name: string;
  description: string;
  official_channel: string;
  contact_email: string;
  sla_hours: number;
  api_integration_status: string;
}

export interface SubmissionDispatchResult {
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

/**
 * Modular Government Integration Adapter.
 * Clearly distinguishes DEMO_SUBMISSION from future verified municipal API submissions.
 * Never falsely claims an official government submission occurred when no official API is connected.
 */
export function buildDepartmentDispatchReceipt(params: {
  referenceId: string;
  categoryName: string;
  area: string;
  priority: string;
  department: DepartmentRecord;
}): SubmissionDispatchResult {
  const { referenceId, categoryName, area, priority, department } = params;

  return {
    submissionMode: 'DEMO_SUBMISSION',
    externalStatusLabel: 'Demo Mode — Official Municipal API Integration Ready (Not Externally Transmitted)',
    disclaimer:
      'This complaint is permanently recorded in the CivicProof demonstration database. No external government API is connected in this hackathon prototype; use the official reporting channel below to submit a real municipal grievance.',
    recommendedDepartment: department.name,
    officialChannel: department.official_channel,
    expectedSlaHours: department.sla_hours,
    nextActions: [
      `Save your CivicProof Reference ID (${referenceId}) to track status updates in the Citizen Portal.`,
      `For official civic filing in ${area}, forward this structured complaint draft via: ${department.official_channel}.`,
      `Target municipal response window for ${department.name}: within ${department.sla_hours} hours once officially filed.`,
    ],
    integrationReadyPayload: {
      schemaVersion: 'civicproof-gov-v1',
      departmentCode: department.code,
      referenceId,
      category: categoryName,
      area,
      priority,
    },
  };
}
