import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  analyzeCivicComplaint,
  answerCivicQuestion,
  findSimilarComplaints,
  getCivicDatabaseSnapshot,
  runUnifiedCivicAgent,
} from './server/aiAgent.ts';
import {
  type AuthenticatedRequest,
  createAuthToken,
  getAdminSetupState,
  getEnvAdminPasscode,
  getUserById,
  hashPassword,
  requireAdmin,
  requireAuth,
  requireCitizen,
  timingSafeStringMatch,
  verifyAuthToken,
  verifyPassword,
} from './server/auth.ts';
import { db, generateReferenceId, initializeDatabase } from './server/db.ts';
import {
  buildDepartmentDispatchReceipt,
  type DepartmentRecord,
} from './server/govIntegration.ts';

initializeDatabase();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '6mb' }));

const VALID_STATUSES = [
  'Submitted',
  'Forwarded',
  'Under Review',
  'In Progress',
  'Resolved',
  'Rejected',
] as const;

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
const VALID_LANGUAGES = ['English', 'Tamil', 'Tanglish'] as const;

function sanitizePhotoUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Allow generated local asset paths or validated base64 image data URIs up to 4.5MB
  if (trimmed.startsWith('/src/assets/images/') && !trimmed.includes('..')) {
    return trimmed;
  }
  if (
    /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed) &&
    trimmed.length <= 4_500_000
  ) {
    return trimmed;
  }
  return '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================================
// PUBLIC ROUTES (Non-PII aggregate stats, metadata, and reference tracking)
// ============================================================================

app.get('/api/meta', (_req, res) => {
  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.description, c.default_department_id, c.is_active,
              d.name as default_department_name
       FROM categories c
       JOIN departments d ON d.id = c.default_department_id
       WHERE c.is_active = 1
       ORDER BY c.id ASC`
    )
    .all();

  const departments = db
    .prepare(
      `SELECT id, code, name, description, official_channel, contact_email, sla_hours, api_integration_status
       FROM departments
       ORDER BY id ASC`
    )
    .all();

  const adminSetup = getAdminSetupState();

  res.json({
    categories,
    departments,
    adminSetup,
    aiConfigured: Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    ),
  });
});

app.get('/api/public/stats', (_req, res) => {
  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('Submitted', 'Forwarded', 'Under Review') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected
       FROM complaints`
    )
    .get() as {
    total: number;
    pending: number;
    inProgress: number;
    resolved: number;
    rejected: number;
  };

  const deptCount = (
    db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }
  ).count;

  const total = counts.total || 0;
  const resolved = counts.resolved || 0;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  res.json({
    total,
    pending: counts.pending || 0,
    inProgress: counts.inProgress || 0,
    resolved,
    rejected: counts.rejected || 0,
    resolutionRate,
    departments: deptCount,
  });
});

app.get('/api/public/track/:refId', (req, res) => {
  const refId = String(req.params.refId || '').trim().toUpperCase();
  if (!refId || refId.length > 40) {
    res.status(400).json({ error: 'Please enter a valid Complaint Reference ID.' });
    return;
  }

  const complaint = db
    .prepare(
      `SELECT c.id, c.reference_id, c.ai_summary, c.language, c.area, c.street_landmark,
              c.priority, c.status, c.endorsement_count, c.submission_mode, c.is_sample,
              c.routing_explanation, c.created_at, c.updated_at,
              cat.name as category_name,
              d.name as department_name, d.official_channel, d.sla_hours
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       WHERE UPPER(c.reference_id) = ?`
    )
    .get(refId) as Record<string, unknown> | undefined;

  if (!complaint) {
    res.status(404).json({ error: `No complaint found with reference ID "${refId}".` });
    return;
  }

  const history = db
    .prepare(
      `SELECT id, previous_status, new_status, note, updated_by_name, created_at
       FROM complaint_status_history
       WHERE complaint_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(complaint.id);

  res.json({ complaint, history });
});

// ============================================================================
// DEDICATED AI AGENT PAGE ROUTES (Analyze Data, Answer Questions, Dispatch Gov Request)
// ============================================================================

app.get('/api/agent/snapshot', (_req, res) => {
  res.json({ snapshot: getCivicDatabaseSnapshot() });
});

app.post('/api/agent/interact', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const preferredLanguage = String(req.body?.preferredLanguage || 'Auto-detect');
  const photoUrl = sanitizePhotoUrl(req.body?.photoUrl);
  const rawHistory = Array.isArray(req.body?.conversationHistory)
    ? req.body.conversationHistory
    : [];

  const conversationHistory = rawHistory
    .slice(-6)
    .filter(
      (m: unknown): m is { role: 'user' | 'agent'; text: string } =>
        Boolean(
          m &&
            typeof m === 'object' &&
            ((m as { role?: string }).role === 'user' ||
              (m as { role?: string }).role === 'agent') &&
            typeof (m as { text?: string }).text === 'string'
        )
    )
    .map((m: { role: 'user' | 'agent'; text: string }) => ({
      role: m.role,
      text: m.text.slice(0, 500),
    }));

  if (message.length < 3 || message.length > 1500) {
    res.status(400).json({ error: 'Please enter a message or question (3–1500 characters).' });
    return;
  }

  try {
    const result = await runUnifiedCivicAgent({
      message,
      preferredLanguage,
      conversationHistory,
      photoUrl,
    });
    res.json({ result, snapshot: getCivicDatabaseSnapshot() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach CivicProof AI Agent.';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/agent/dispatch', (req, res) => {
  // Optional authenticated citizen link; falls back cleanly to seeded demo citizen for public agent walkthrough
  let submitterUserId = 0;
  let submitterName = String(req.body?.citizenName || '').trim().slice(0, 80);

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyAuthToken(authHeader.slice(7).trim());
    if (payload) {
      const u = getUserById(payload.uid);
      if (u) {
        submitterUserId = u.id;
        submitterName = u.name;
      }
    }
  }

  if (!submitterUserId) {
    const demoCitizen = db
      .prepare("SELECT id, name FROM users WHERE role = 'citizen' AND is_demo = 1 ORDER BY id ASC LIMIT 1")
      .get() as { id: number; name: string } | undefined;
    if (!demoCitizen) {
      res.status(400).json({ error: 'Please sign in to the Citizen Portal before dispatching.' });
      return;
    }
    submitterUserId = demoCitizen.id;
    submitterName = submitterName || `${demoCitizen.name} (AI Agent Dispatch)`;
  }

  const originalDescription = String(req.body?.originalDescription || '').trim();
  const aiSummary = String(req.body?.aiSummary || '').trim() || originalDescription;
  const language = VALID_LANGUAGES.includes(req.body?.language) ? req.body.language : 'English';
  const categoryId = Number(req.body?.categoryId);
  const area = String(req.body?.area || '').trim();
  const streetLandmark = String(req.body?.streetLandmark || '').trim();
  const photoUrl = sanitizePhotoUrl(req.body?.photoUrl);
  const requestedDeptId = Number(req.body?.departmentId);
  const routingExplanation = String(req.body?.routingExplanation || '').trim();
  const priority = VALID_PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'Medium';
  const priorityReason =
    String(req.body?.priorityReason || '').trim() ||
    'Priority evaluated by CivicProof AI Agent.';
  const confirmed = Boolean(req.body?.confirmed);

  if (!confirmed) {
    res.status(400).json({ error: 'Please confirm the request details before sending.' });
    return;
  }
  if (originalDescription.length < 5) {
    res.status(400).json({ error: 'Complaint description is required (minimum 5 characters).' });
    return;
  }
  if (area.length < 2) {
    res.status(400).json({ error: 'Area / Neighborhood is required to route the government request.' });
    return;
  }
  if (streetLandmark.length < 3) {
    res.status(400).json({ error: 'Street name or nearby landmark is required.' });
    return;
  }

  const category = db
    .prepare('SELECT id, name, default_department_id FROM categories WHERE id = ? AND is_active = 1')
    .get(categoryId) as { id: number; name: string; default_department_id: number } | undefined;
  if (!category) {
    res.status(400).json({ error: 'Please select a valid complaint category.' });
    return;
  }

  const departmentId =
    Number.isInteger(requestedDeptId) && requestedDeptId > 0
      ? requestedDeptId
      : category.default_department_id;
  const department = db
    .prepare('SELECT * FROM departments WHERE id = ?')
    .get(departmentId) as DepartmentRecord | undefined;
  if (!department) {
    res.status(400).json({ error: 'Selected government department was not found.' });
    return;
  }

  const referenceId = generateReferenceId();
  const now = new Date().toISOString();
  const finalRouting =
    routingExplanation ||
    `Assigned to ${department.name} based on category "${category.name}" in ${area}.`;

  let newComplaintId = 0;

  db.transaction(() => {
    const insertRes = db
      .prepare(
        `INSERT INTO complaints (
          reference_id, citizen_id, original_description, ai_summary, language,
          category_id, area, street_landmark, photo_url, department_id,
          routing_explanation, priority, priority_reason, status, endorsement_count,
          submission_mode, is_sample, incident_datetime, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', 1, 'DEMO_SUBMISSION', 0, ?, ?, ?)`
      )
      .run(
        referenceId,
        submitterUserId,
        originalDescription,
        aiSummary,
        language,
        category.id,
        area,
        streetLandmark,
        photoUrl,
        department.id,
        finalRouting,
        priority,
        priorityReason,
        now,
        now,
        now
      );
    newComplaintId = Number(insertRes.lastInsertRowid);

    db.prepare(
      `INSERT INTO complaint_status_history (
        complaint_id, previous_status, new_status, note, updated_by_user_id, updated_by_name, created_at
      ) VALUES (?, NULL, 'Submitted', ?, ?, ?, ?)`
    ).run(
      newComplaintId,
      `Structured government request dispatched via CivicProof AI Agent (Demo Submission) for ${department.name}.`,
      submitterUserId,
      submitterName,
      now
    );
  })();

  const created = db
    .prepare(
      `SELECT c.*, cat.name as category_name, d.name as department_name,
              d.code as department_code, d.official_channel, d.sla_hours
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       WHERE c.id = ?`
    )
    .get(newComplaintId);

  const dispatchReceipt = buildDepartmentDispatchReceipt({
    referenceId,
    categoryName: category.name,
    area,
    priority,
    department,
  });

  res.status(201).json({
    complaint: created,
    dispatchReceipt,
    snapshot: getCivicDatabaseSnapshot(),
  });
});

// ============================================================================
// AUTHENTICATION ROUTES (Citizen Register/Login, Demo Citizen, Admin Claim/Login)
// ============================================================================

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const phone = String(req.body?.phone || '').trim();
  const ward = String(req.body?.ward || '').trim();
  const preferredLanguage = VALID_LANGUAGES.includes(req.body?.preferredLanguage)
    ? req.body.preferredLanguage
    : 'English';

  if (name.length < 2 || name.length > 80) {
    res.status(400).json({ error: 'Please provide your full name (2–80 characters).' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    return;
  }

  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO users (name, email, phone, ward, preferred_language, role, password_hash, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, 'citizen', ?, 0, ?)`
    )
    .run(name, email, phone, ward, preferredLanguage, passwordHash, now);

  const user = getUserById(Number(result.lastInsertRowid))!;
  const token = createAuthToken(user.id, 'citizen');

  res.status(201).json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const expectedRole = req.body?.role === 'admin' ? 'admin' : 'citizen';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, name, email, phone, ward, preferred_language, role, password_hash, is_demo, created_at
       FROM users WHERE email = ?`
    )
    .get(email) as
    | (Record<string, unknown> & { id: number; role: 'citizen' | 'admin'; password_hash: string })
    | undefined;

  if (!row || row.role !== expectedRole || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials for this portal.' });
    return;
  }

  const user = getUserById(row.id)!;
  const token = createAuthToken(user.id, user.role);
  res.json({ token, user });
});

app.post('/api/auth/demo-citizen', (_req, res) => {
  const demoUser = db
    .prepare("SELECT id FROM users WHERE role = 'citizen' AND is_demo = 1 ORDER BY id ASC LIMIT 1")
    .get() as { id: number } | undefined;

  if (!demoUser) {
    res.status(404).json({ error: 'Demo citizen account not found.' });
    return;
  }

  const user = getUserById(demoUser.id)!;
  const token = createAuthToken(user.id, 'citizen');
  res.json({ token, user });
});

// One-time atomic first-run Admin setup (locks once claimed or whenever ADMIN_PASSCODE is configured)
app.post('/api/auth/admin/claim', (req, res) => {
  const setup = getAdminSetupState();
  if (!setup.requiresFirstRunSetup) {
    res.status(403).json({
      error: 'Administrator account is already configured. Please sign in with your admin credentials.',
    });
    return;
  }

  const name = String(req.body?.name || '').trim() || 'Municipal Administrator';
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid administrator email address.' });
    return;
  }
  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Administrator password must be at least 8 characters long.' });
    return;
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) {
    res.status(409).json({ error: 'This email is already registered to another user.' });
    return;
  }

  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  const createAdminTx = db.transaction(() => {
    const check = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (check) return null;
    const result = db
      .prepare(
        `INSERT INTO users (name, email, phone, ward, preferred_language, role, password_hash, is_demo, created_at)
         VALUES (?, ?, '', 'Central Municipal Command', 'English', 'admin', ?, 0, ?)`
      )
      .run(name, email, passwordHash, now);
    return Number(result.lastInsertRowid);
  });

  const adminId = createAdminTx();
  if (!adminId) {
    res.status(403).json({ error: 'Administrator account has already been claimed.' });
    return;
  }

  const user = getUserById(adminId)!;
  const token = createAuthToken(user.id, 'admin');
  res.status(201).json({ token, user });
});

app.post('/api/auth/admin/login', (req, res) => {
  const envPasscode = getEnvAdminPasscode();
  const passcode = String(req.body?.passcode || '');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  // If ADMIN_PASSCODE env var is configured, it overrides claimed credentials
  if (envPasscode.length > 0) {
    const candidate = passcode || password;
    if (!candidate || !timingSafeStringMatch(candidate, envPasscode)) {
      res.status(401).json({ error: 'Invalid administrator passcode.' });
      return;
    }

    let adminRow = db
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;

    if (!adminRow) {
      const now = new Date().toISOString();
      const inserted = db
        .prepare(
          `INSERT INTO users (name, email, phone, ward, preferred_language, role, password_hash, is_demo, created_at)
           VALUES ('CivicProof Municipal Admin', 'admin@civicproof.local', '', 'Central Municipal Command', 'English', 'admin', 'ENV_PASSCODE_MANAGED', 0, ?)`
        )
        .run(now);
      adminRow = { id: Number(inserted.lastInsertRowid) };
    }

    const user = getUserById(adminRow.id)!;
    const token = createAuthToken(user.id, 'admin');
    res.json({ token, user });
    return;
  }

  // Otherwise authenticate against the claimed scrypt-hashed admin record
  if (!email || !password) {
    res.status(400).json({ error: 'Administrator email and password are required.' });
    return;
  }

  const adminRow = db
    .prepare(
      `SELECT id, password_hash FROM users WHERE email = ? AND role = 'admin'`
    )
    .get(email) as { id: number; password_hash: string } | undefined;

  if (!adminRow || !verifyPassword(password, adminRow.password_hash)) {
    res.status(401).json({ error: 'Invalid administrator email or password.' });
    return;
  }

  const user = getUserById(adminRow.id)!;
  const token = createAuthToken(user.id, 'admin');
  res.json({ token, user });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

// ============================================================================
// CITIZEN PORTAL ROUTES (Strictly scoped to req.user.id)
// ============================================================================

app.patch('/api/citizen/profile', requireCitizen, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim().slice(0, 30);
  const ward = String(req.body?.ward || '').trim().slice(0, 80);
  const preferredLanguage = VALID_LANGUAGES.includes(req.body?.preferredLanguage)
    ? req.body.preferredLanguage
    : req.user!.preferred_language;

  if (name.length < 2 || name.length > 80) {
    res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    return;
  }

  db.prepare(
    `UPDATE users SET name = ?, phone = ?, ward = ?, preferred_language = ? WHERE id = ?`
  ).run(name, phone, ward, preferredLanguage, userId);

  res.json({ user: getUserById(userId) });
});

app.get('/api/citizen/complaints', requireCitizen, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;

  const complaints = db
    .prepare(
      `SELECT c.id, c.reference_id, c.original_description, c.ai_summary, c.language,
              c.category_id, cat.name as category_name, c.area, c.street_landmark,
              c.photo_url, c.department_id, d.name as department_name, d.official_channel,
              d.sla_hours, c.routing_explanation, c.priority, c.priority_reason,
              c.status, c.endorsement_count, c.submission_mode, c.is_sample,
              c.incident_datetime, c.created_at, c.updated_at
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       WHERE c.citizen_id = ?
       ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(userId) as Array<{ status: string }>;

  const stats = {
    total: complaints.length,
    pending: complaints.filter((c) =>
      ['Submitted', 'Forwarded', 'Under Review'].includes(c.status)
    ).length,
    inProgress: complaints.filter((c) => c.status === 'In Progress').length,
    resolved: complaints.filter((c) => c.status === 'Resolved').length,
    rejected: complaints.filter((c) => c.status === 'Rejected').length,
  };

  res.json({ complaints, stats });
});

app.get('/api/citizen/complaints/:id', requireCitizen, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const complaintId = Number(req.params.id);
  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    res.status(400).json({ error: 'Invalid complaint ID.' });
    return;
  }

  const complaint = db
    .prepare(
      `SELECT c.*, cat.name as category_name, d.name as department_name,
              d.code as department_code, d.official_channel, d.sla_hours
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       WHERE c.id = ? AND c.citizen_id = ?`
    )
    .get(complaintId, userId);

  if (!complaint) {
    res.status(404).json({ error: 'Complaint not found in your account.' });
    return;
  }

  const history = db
    .prepare(
      `SELECT id, previous_status, new_status, note, updated_by_name, created_at
       FROM complaint_status_history
       WHERE complaint_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(complaintId);

  const similarLinks = db
    .prepare(
      `SELECT s.similarity_score, s.relationship_type, r.id as related_id,
              r.reference_id, r.ai_summary, r.area, r.status
       FROM similar_complaint_links s
       JOIN complaints r ON r.id = s.related_complaint_id
       WHERE s.complaint_id = ?`
    )
    .all(complaintId);

  res.json({ complaint, history, similarLinks });
});

app.post('/api/citizen/ai/analyze', requireCitizen, async (req: AuthenticatedRequest, res) => {
  const complaintText = String(req.body?.complaintText || '').trim();
  const preferredLanguage = String(req.body?.preferredLanguage || 'Auto-detect');
  const followUpAnswer = String(req.body?.followUpAnswer || '').trim();
  const areaHint = String(req.body?.areaHint || '').trim();
  const streetHint = String(req.body?.streetHint || '').trim();
  const photoUrl = sanitizePhotoUrl(req.body?.photoUrl);

  if (complaintText.length < 5) {
    res.status(400).json({
      error: 'Please describe your civic issue in at least a few words so the AI agent can analyze it.',
    });
    return;
  }

  try {
    const analysis = await analyzeCivicComplaint({
      complaintText,
      preferredLanguage,
      followUpAnswer,
      areaHint,
      streetHint,
      photoUrl,
    });
    res.json({ analysis });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to analyze complaint right now.';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/citizen/ai/chat', requireCitizen, async (req: AuthenticatedRequest, res) => {
  const question = String(req.body?.question || '').trim();
  const preferredLanguage = String(req.body?.preferredLanguage || 'Auto-detect');
  const complaintContext = String(req.body?.complaintContext || '').trim().slice(0, 600);

  if (question.length < 3 || question.length > 500) {
    res.status(400).json({ error: 'Please enter a short question (3–500 characters).' });
    return;
  }

  try {
    const reply = await answerCivicQuestion({
      question,
      preferredLanguage,
      complaintContext,
    });
    res.json(reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to answer right now.';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/citizen/complaints/check-similar', requireCitizen, (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.body?.categoryId || 0);
  const area = String(req.body?.area || '').trim();
  const streetLandmark = String(req.body?.streetLandmark || '').trim();
  const description = String(req.body?.description || '').trim();
  const summary = String(req.body?.summary || '').trim();

  const matches = findSimilarComplaints({
    categoryId,
    area,
    streetLandmark,
    description,
    summary,
  });
  res.json({ similarComplaints: matches });
});

app.post('/api/citizen/complaints/:id/endorse', requireCitizen, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const complaintId = Number(req.params.id);
  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    res.status(400).json({ error: 'Invalid complaint ID.' });
    return;
  }

  const target = db
    .prepare('SELECT id, reference_id, endorsement_count FROM complaints WHERE id = ?')
    .get(complaintId) as { id: number; reference_id: string; endorsement_count: number } | undefined;

  if (!target) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM complaint_endorsements WHERE complaint_id = ? AND user_id = ?')
    .get(complaintId, userId);

  if (existing) {
    res.json({
      alreadyEndorsed: true,
      referenceId: target.reference_id,
      endorsementCount: target.endorsement_count,
      message: `You have already supported complaint ${target.reference_id}.`,
    });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO complaint_endorsements (complaint_id, user_id, created_at) VALUES (?, ?, ?)'
    ).run(complaintId, userId, now);
    db.prepare(
      'UPDATE complaints SET endorsement_count = endorsement_count + 1, updated_at = ? WHERE id = ?'
    ).run(now, complaintId);
  })();

  res.json({
    alreadyEndorsed: false,
    referenceId: target.reference_id,
    endorsementCount: target.endorsement_count + 1,
    message: `Thank you! Your support has been added to ${target.reference_id} to help prioritize resolution.`,
  });
});

app.post('/api/citizen/complaints', requireCitizen, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const originalDescription = String(req.body?.originalDescription || '').trim();
  const aiSummary = String(req.body?.aiSummary || '').trim() || originalDescription;
  const language = VALID_LANGUAGES.includes(req.body?.language) ? req.body.language : 'English';
  const categoryId = Number(req.body?.categoryId);
  const area = String(req.body?.area || '').trim();
  const streetLandmark = String(req.body?.streetLandmark || '').trim();
  const photoUrl = sanitizePhotoUrl(req.body?.photoUrl);
  const requestedDeptId = Number(req.body?.departmentId);
  const routingExplanation = String(req.body?.routingExplanation || '').trim();
  const priority = VALID_PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'Medium';
  const priorityReason =
    String(req.body?.priorityReason || '').trim() ||
    'Priority confirmed by citizen during complaint review.';
  const incidentDatetime =
    String(req.body?.incidentDatetime || '').trim() || new Date().toISOString();
  const confirmed = Boolean(req.body?.confirmed);
  const relatedComplaintIds = Array.isArray(req.body?.relatedComplaintIds)
    ? req.body.relatedComplaintIds
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0)
    : [];

  if (!confirmed) {
    res.status(400).json({ error: 'Please confirm that the complaint details are accurate before submitting.' });
    return;
  }
  if (originalDescription.length < 5) {
    res.status(400).json({ error: 'Complaint description must be at least 5 characters.' });
    return;
  }
  if (!area || area.length < 2) {
    res.status(400).json({ error: 'Location / Area is required.' });
    return;
  }
  if (!streetLandmark || streetLandmark.length < 3) {
    res.status(400).json({ error: 'Street name or nearby landmark is required.' });
    return;
  }

  const category = db
    .prepare('SELECT id, name, default_department_id FROM categories WHERE id = ? AND is_active = 1')
    .get(categoryId) as { id: number; name: string; default_department_id: number } | undefined;
  if (!category) {
    res.status(400).json({ error: 'Please select a valid complaint category.' });
    return;
  }

  const departmentId = Number.isInteger(requestedDeptId) && requestedDeptId > 0
    ? requestedDeptId
    : category.default_department_id;

  const department = db
    .prepare('SELECT * FROM departments WHERE id = ?')
    .get(departmentId) as DepartmentRecord | undefined;

  if (!department) {
    res.status(400).json({ error: 'Selected department does not exist.' });
    return;
  }

  const referenceId = generateReferenceId();
  const now = new Date().toISOString();
  const finalRouting =
    routingExplanation ||
    `Assigned to ${department.name} based on category "${category.name}" in ${area}.`;

  let newComplaintId = 0;

  db.transaction(() => {
    const insertRes = db
      .prepare(
        `INSERT INTO complaints (
          reference_id, citizen_id, original_description, ai_summary, language,
          category_id, area, street_landmark, photo_url, department_id,
          routing_explanation, priority, priority_reason, status, endorsement_count,
          submission_mode, is_sample, incident_datetime, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', 1, 'DEMO_SUBMISSION', 0, ?, ?, ?)`
      )
      .run(
        referenceId,
        user.id,
        originalDescription,
        aiSummary,
        language,
        category.id,
        area,
        streetLandmark,
        photoUrl,
        department.id,
        finalRouting,
        priority,
        priorityReason,
        incidentDatetime,
        now,
        now
      );

    newComplaintId = Number(insertRes.lastInsertRowid);

    db.prepare(
      `INSERT INTO complaint_status_history (
        complaint_id, previous_status, new_status, note, updated_by_user_id, updated_by_name, created_at
      ) VALUES (?, NULL, 'Submitted', ?, ?, ?, ?)`
    ).run(
      newComplaintId,
      `Complaint registered in CivicProof Demo System and recommended for ${department.name}.`,
      user.id,
      user.name,
      now
    );

    const linkStmt = db.prepare(
      `INSERT INTO similar_complaint_links (complaint_id, related_complaint_id, similarity_score, relationship_type, created_at)
       VALUES (?, ?, ?, 'similar_reference', ?)`
    );
    for (const relatedId of relatedComplaintIds.slice(0, 3)) {
      const exists = db.prepare('SELECT id FROM complaints WHERE id = ?').get(relatedId);
      if (exists && relatedId !== newComplaintId) {
        linkStmt.run(newComplaintId, relatedId, 0.75, now);
      }
    }
  })();

  const created = db
    .prepare(
      `SELECT c.*, cat.name as category_name, d.name as department_name,
              d.code as department_code, d.official_channel, d.sla_hours
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       WHERE c.id = ?`
    )
    .get(newComplaintId);

  const dispatchReceipt = buildDepartmentDispatchReceipt({
    referenceId,
    categoryName: category.name,
    area,
    priority,
    department,
  });

  res.status(201).json({ complaint: created, dispatchReceipt });
});

// ============================================================================
// ADMIN PORTAL ROUTES (Strictly protected by requireAdmin RBAC guard)
// ============================================================================

app.get('/api/admin/analytics', requireAdmin, (_req, res) => {
  const summary = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('Submitted', 'Forwarded', 'Under Review') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN is_sample = 1 THEN 1 ELSE 0 END) as sampleCount
       FROM complaints`
    )
    .get() as {
    total: number;
    pending: number;
    inProgress: number;
    resolved: number;
    rejected: number;
    sampleCount: number;
  };

  const total = summary.total || 0;
  const resolved = summary.resolved || 0;
  const resolutionPercentage = total > 0 ? Number(((resolved / total) * 100).toFixed(1)) : 0;

  const byCategory = db
    .prepare(
      `SELECT cat.name as name, COUNT(c.id) as count
       FROM categories cat
       LEFT JOIN complaints c ON c.category_id = cat.id
       WHERE cat.is_active = 1
       GROUP BY cat.id
       ORDER BY count DESC, cat.name ASC`
    )
    .all();

  const byArea = db
    .prepare(
      `SELECT area as name, COUNT(*) as count
       FROM complaints
       GROUP BY area
       ORDER BY count DESC, area ASC`
    )
    .all();

  const byDepartment = db
    .prepare(
      `SELECT d.name as name, d.code as code,
              COUNT(c.id) as total,
              SUM(CASE WHEN c.status = 'Resolved' THEN 1 ELSE 0 END) as resolved,
              SUM(CASE WHEN c.status NOT IN ('Resolved', 'Rejected') THEN 1 ELSE 0 END) as openCount
       FROM departments d
       LEFT JOIN complaints c ON c.department_id = d.id
       GROUP BY d.id
       ORDER BY total DESC, d.name ASC`
    )
    .all();

  const byStatus = db
    .prepare(
      `SELECT status as name, COUNT(*) as count
       FROM complaints
       GROUP BY status`
    )
    .all();

  const byPriority = db
    .prepare(
      `SELECT priority as name, COUNT(*) as count
       FROM complaints
       GROUP BY priority`
    )
    .all();

  res.json({
    summary: {
      total,
      pending: summary.pending || 0,
      inProgress: summary.inProgress || 0,
      resolved,
      rejected: summary.rejected || 0,
      sampleCount: summary.sampleCount || 0,
      resolutionPercentage,
    },
    byCategory,
    byArea,
    byDepartment,
    byStatus,
    byPriority,
  });
});

app.get('/api/admin/complaints', requireAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  const categoryId = Number(req.query.categoryId || 0);
  const departmentId = Number(req.query.departmentId || 0);
  const priority = String(req.query.priority || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (status && status !== 'All') {
    conditions.push('c.status = ?');
    values.push(status);
  }
  if (Number.isInteger(categoryId) && categoryId > 0) {
    conditions.push('c.category_id = ?');
    values.push(categoryId);
  }
  if (Number.isInteger(departmentId) && departmentId > 0) {
    conditions.push('c.department_id = ?');
    values.push(departmentId);
  }
  if (priority && priority !== 'All') {
    conditions.push('c.priority = ?');
    values.push(priority);
  }
  if (search) {
    conditions.push(
      '(LOWER(c.reference_id) LIKE ? OR LOWER(c.area) LIKE ? OR LOWER(c.street_landmark) LIKE ? OR LOWER(c.ai_summary) LIKE ? OR LOWER(u.name) LIKE ?)'
    );
    const like = `%${search}%`;
    values.push(like, like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const complaints = db
    .prepare(
      `SELECT c.id, c.reference_id, c.original_description, c.ai_summary, c.language,
              c.category_id, cat.name as category_name, c.area, c.street_landmark,
              c.photo_url, c.department_id, d.name as department_name, d.code as department_code,
              c.priority, c.status, c.endorsement_count, c.submission_mode, c.is_sample,
              c.created_at, c.updated_at,
              u.name as citizen_name, u.email as citizen_email
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       JOIN users u ON u.id = c.citizen_id
       ${whereClause}
       ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(...values);

  res.json({ complaints });
});

app.get('/api/admin/complaints/:id', requireAdmin, (req, res) => {
  const complaintId = Number(req.params.id);
  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    res.status(400).json({ error: 'Invalid complaint ID.' });
    return;
  }

  const complaint = db
    .prepare(
      `SELECT c.*, cat.name as category_name, d.name as department_name,
              d.code as department_code, d.official_channel, d.sla_hours,
              u.name as citizen_name, u.email as citizen_email, u.phone as citizen_phone,
              u.ward as citizen_ward
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       JOIN users u ON u.id = c.citizen_id
       WHERE c.id = ?`
    )
    .get(complaintId);

  if (!complaint) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  const history = db
    .prepare(
      `SELECT id, previous_status, new_status, note, updated_by_name, created_at
       FROM complaint_status_history
       WHERE complaint_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(complaintId);

  const similarLinks = db
    .prepare(
      `SELECT s.similarity_score, s.relationship_type, r.id as related_id,
              r.reference_id, r.ai_summary, r.area, r.status
       FROM similar_complaint_links s
       JOIN complaints r ON r.id = s.related_complaint_id
       WHERE s.complaint_id = ?`
    )
    .all(complaintId);

  res.json({ complaint, history, similarLinks });
});

app.patch('/api/admin/complaints/:id/status', requireAdmin, (req: AuthenticatedRequest, res) => {
  const complaintId = Number(req.params.id);
  const newStatus = String(req.body?.status || '').trim();
  const note = String(req.body?.note || '').trim();
  const newDepartmentId = req.body?.departmentId ? Number(req.body.departmentId) : null;
  const newPriority = req.body?.priority ? String(req.body.priority).trim() : null;

  if (!Number.isInteger(complaintId) || complaintId <= 0) {
    res.status(400).json({ error: 'Invalid complaint ID.' });
    return;
  }
  if (!VALID_STATUSES.includes(newStatus as (typeof VALID_STATUSES)[number])) {
    res.status(400).json({ error: 'Invalid complaint status value.' });
    return;
  }
  if (note.length < 3) {
    res.status(400).json({ error: 'Please include a short administrative update note (at least 3 characters).' });
    return;
  }

  const existing = db
    .prepare('SELECT id, status, department_id, priority FROM complaints WHERE id = ?')
    .get(complaintId) as
    | { id: number; status: string; department_id: number; priority: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  let deptIdToSave = existing.department_id;
  if (newDepartmentId && Number.isInteger(newDepartmentId) && newDepartmentId > 0) {
    const deptExists = db.prepare('SELECT id FROM departments WHERE id = ?').get(newDepartmentId);
    if (!deptExists) {
      res.status(400).json({ error: 'Selected department does not exist.' });
      return;
    }
    deptIdToSave = newDepartmentId;
  }

  const priorityToSave =
    newPriority && VALID_PRIORITIES.includes(newPriority as (typeof VALID_PRIORITIES)[number])
      ? newPriority
      : existing.priority;

  const now = new Date().toISOString();
  const admin = req.user!;

  db.transaction(() => {
    db.prepare(
      `UPDATE complaints SET status = ?, department_id = ?, priority = ?, updated_at = ? WHERE id = ?`
    ).run(newStatus, deptIdToSave, priorityToSave, now, complaintId);

    db.prepare(
      `INSERT INTO complaint_status_history (
        complaint_id, previous_status, new_status, note, updated_by_user_id, updated_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(complaintId, existing.status, newStatus, note, admin.id, admin.name, now);
  })();

  const updated = db
    .prepare(
      `SELECT c.*, cat.name as category_name, d.name as department_name,
              d.code as department_code, d.official_channel, d.sla_hours,
              u.name as citizen_name, u.email as citizen_email, u.phone as citizen_phone,
              u.ward as citizen_ward
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       JOIN departments d ON d.id = c.department_id
       JOIN users u ON u.id = c.citizen_id
       WHERE c.id = ?`
    )
    .get(complaintId);

  const history = db
    .prepare(
      `SELECT id, previous_status, new_status, note, updated_by_name, created_at
       FROM complaint_status_history
       WHERE complaint_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(complaintId);

  res.json({ complaint: updated, history });
});

app.get('/api/admin/departments', requireAdmin, (_req, res) => {
  const departments = db
    .prepare(
      `SELECT d.*,
              COUNT(c.id) as complaint_count,
              SUM(CASE WHEN c.status = 'Resolved' THEN 1 ELSE 0 END) as resolved_count
       FROM departments d
       LEFT JOIN complaints c ON c.department_id = d.id
       GROUP BY d.id
       ORDER BY d.id ASC`
    )
    .all();
  res.json({ departments });
});

app.post('/api/admin/departments', requireAdmin, (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const officialChannel = String(req.body?.officialChannel || '').trim();
  const contactEmail = String(req.body?.contactEmail || '').trim();
  const slaHours = Math.max(4, Math.min(720, Number(req.body?.slaHours || 48)));

  if (!code || code.length < 3 || !name || !description || !officialChannel) {
    res.status(400).json({ error: 'Department code, name, description, and official channel are required.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM departments WHERE code = ?').get(code);
  if (existing) {
    res.status(409).json({ error: `Department code "${code}" already exists.` });
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO departments (code, name, description, official_channel, contact_email, sla_hours, api_integration_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'READY_FOR_OFFICIAL_API', ?)`
    )
    .run(code, name, description, officialChannel, contactEmail || 'desk@municipal.demo.gov', slaHours, now);

  const created = db
    .prepare('SELECT * FROM departments WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  res.status(201).json({ department: created });
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const defaultDepartmentId = Number(req.body?.defaultDepartmentId);

  if (name.length < 3 || description.length < 5) {
    res.status(400).json({ error: 'Category name and description are required.' });
    return;
  }

  const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(defaultDepartmentId);
  if (!dept) {
    res.status(400).json({ error: 'Please select a valid default department.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)')
    .get(name);
  if (existing) {
    res.status(409).json({ error: 'A complaint category with this name already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO categories (name, description, default_department_id, is_active, created_at)
       VALUES (?, ?, ?, 1, ?)`
    )
    .run(name, description, defaultDepartmentId, now);

  const created = db
    .prepare(
      `SELECT c.*, d.name as default_department_name
       FROM categories c
       JOIN departments d ON d.id = c.default_department_id
       WHERE c.id = ?`
    )
    .get(Number(result.lastInsertRowid));
  res.status(201).json({ category: created });
});

// ============================================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
// ============================================================================

async function startServer(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CivicProof server running at http://localhost:${PORT}`);
  });
}

startServer();
