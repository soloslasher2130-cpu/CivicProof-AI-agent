import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

function resolveDataDir(): string {
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    fs.accessSync(localDir, fs.constants.W_OK);
    return localDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), 'civicproof-data');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  }
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'civicproof.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT DEFAULT '',
      ward TEXT DEFAULT '',
      preferred_language TEXT NOT NULL DEFAULT 'English',
      role TEXT NOT NULL CHECK (role IN ('citizen', 'admin')),
      password_hash TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      official_channel TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      sla_hours INTEGER NOT NULL DEFAULT 48,
      api_integration_status TEXT NOT NULL DEFAULT 'READY_FOR_OFFICIAL_API',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      default_department_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (default_department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      citizen_id INTEGER NOT NULL,
      original_description TEXT NOT NULL,
      ai_summary TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English',
      category_id INTEGER NOT NULL,
      area TEXT NOT NULL,
      street_landmark TEXT NOT NULL,
      photo_url TEXT DEFAULT '',
      department_id INTEGER NOT NULL,
      routing_explanation TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
      priority_reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Submitted', 'Forwarded', 'Under Review', 'In Progress', 'Resolved', 'Rejected')),
      endorsement_count INTEGER NOT NULL DEFAULT 1,
      submission_mode TEXT NOT NULL DEFAULT 'DEMO_SUBMISSION' CHECK (submission_mode IN ('DEMO_SUBMISSION', 'OFFICIAL_VERIFIED')),
      is_sample INTEGER NOT NULL DEFAULT 0,
      incident_datetime TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (citizen_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS complaint_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      note TEXT NOT NULL,
      updated_by_user_id INTEGER,
      updated_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS similar_complaint_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      related_complaint_id INTEGER NOT NULL,
      similarity_score REAL NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'similar_reference',
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
      FOREIGN KEY (related_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaint_endorsements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (complaint_id, user_id),
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_citizen ON complaints(citizen_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
    CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_area ON complaints(area);
    CREATE INDEX IF NOT EXISTS idx_status_history_complaint ON complaint_status_history(complaint_id);
  `);

  seedInitialDemoData();
}

function seedInitialDemoData(): void {
  const deptCount = (db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }).count;
  if (deptCount > 0) return;

  const now = new Date();
  const isoDaysAgo = (days: number, hoursOffset = 0) =>
    new Date(now.getTime() - days * 86400000 - hoursOffset * 3600000).toISOString();

  const insertDept = db.prepare(`
    INSERT INTO departments (code, name, description, official_channel, contact_email, sla_hours, api_integration_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const depts = [
    [
      'DEPT-ROADS',
      'Municipal Roads & Highways Wing',
      'Responsible for asphalt repair, pothole patching, speed breakers, footpath restoration, and arterial road safety.',
      'City Roads Helpline 1913 / Official Municipal Roads Portal (Demo Mode)',
      'roads-grievance@municipal.demo.gov',
      72,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-SWM',
      'Solid Waste & Sanitation Department',
      'Manages daily door-to-door garbage collection, street sweeping, bin clearance, and neighborhood waste transfer stations.',
      'Swachhatta & Municipal Sanitation Desk 1913 (Demo Mode)',
      'sanitation-desk@municipal.demo.gov',
      24,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-DRAIN',
      'Stormwater & Underground Drainage Board',
      'Handles clogged stormwater drains, sewage overflow, manhole cover replacement, and monsoon waterlogging clearance.',
      'Metro Drainage Control Room 044-45674567 (Demo Mode)',
      'drainage-ops@municipal.demo.gov',
      24,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-ELEC',
      'Street Lighting & Electrical Wing',
      'Maintains LED streetlamps, feeder pillars, timer switches, dark-spot illumination, and municipal pole safety.',
      'Municipal Electrical Wing & TANGEDCO Streetlight Cell (Demo Mode)',
      'streetlights@municipal.demo.gov',
      48,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-WATER',
      'Metropolitan Water Supply & Sewerage Board',
      'Oversees drinking water pipeline leaks, low pressure zones, contamination testing, and scheduled tanker supply.',
      'Metro Water Citizen Portal & Helpline 1916 (Demo Mode)',
      'water-supply@municipal.demo.gov',
      24,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-INFRA',
      'Public Infrastructure & Civic Works Division',
      'Maintains public parks, bus shelters, community halls, public toilets, signage boards, and pedestrian crossings.',
      'Civic Works & Zonal Engineer Office (Demo Mode)',
      'civic-works@municipal.demo.gov',
      96,
      'READY_FOR_OFFICIAL_API',
    ],
    [
      'DEPT-GEN',
      'General Municipal Grievance Cell',
      'Coordinates cross-departmental civic complaints, stray hazard referrals, noise/encroachment notices, and ward escalations.',
      'Integrated Citizen Grievance Redressal Cell 1913 (Demo Mode)',
      'grievance-cell@municipal.demo.gov',
      72,
      'READY_FOR_OFFICIAL_API',
    ],
  ] as const;

  const deptIds: Record<string, number> = {};
  for (const d of depts) {
    const res = insertDept.run(d[0], d[1], d[2], d[3], d[4], d[5], d[6], isoDaysAgo(30));
    deptIds[d[0]] = Number(res.lastInsertRowid);
  }

  const insertCat = db.prepare(`
    INSERT INTO categories (name, description, default_department_id, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);

  const cats = [
    ['Road Damage / Potholes', 'Broken roads, deep potholes, cave-ins, damaged footpaths, and eroded asphalt.', deptIds['DEPT-ROADS']],
    ['Garbage / Waste Management', 'Uncollected garbage, overflowing bins, illegal dumping, and missed sanitation trucks.', deptIds['DEPT-SWM']],
    ['Drainage Problems', 'Blocked stormwater drains, sewage stagnation, broken drain slabs, and waterlogging.', deptIds['DEPT-DRAIN']],
    ['Streetlight Issues', 'Non-working streetlights, flickering LED poles, dark residential stretches, and exposed wiring.', deptIds['DEPT-ELEC']],
    ['Water Supply Problems', 'Burst water pipelines, irregular drinking water supply, low pressure, or muddy water.', deptIds['DEPT-WATER']],
    ['Public Infrastructure', 'Damaged bus shelters, park benches, public restrooms, community signage, and railings.', deptIds['DEPT-INFRA']],
    ['Other Civic Issues', 'General local civic concerns requiring zonal inspection or multi-department routing.', deptIds['DEPT-GEN']],
  ] as const;

  const catIds: Record<string, number> = {};
  for (const c of cats) {
    const res = insertCat.run(c[0], c[1], c[2], isoDaysAgo(30));
    catIds[c[0]] = Number(res.lastInsertRowid);
  }

  // Seed two demo citizen records with non-login sentinel hash (demo citizen signs in via dedicated scoped demo endpoint)
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, ward, preferred_language, role, password_hash, is_demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoCitizenRes = insertUser.run(
    'Ananya Krishnan',
    'ananya.demo@civicproof.local',
    '+91 98401 22410',
    'Ward 172 - Adyar',
    'Tanglish',
    'citizen',
    'DEMO_ACCOUNT_NO_PASSWORD_LOGIN',
    1,
    isoDaysAgo(25)
  );
  const ananyaId = Number(demoCitizenRes.lastInsertRowid);

  const sampleCitizenRes = insertUser.run(
    'Karthik Subramanian',
    'karthik.sample@civicproof.local',
    '+91 98409 88312',
    'Ward 142 - Anna Nagar',
    'Tamil',
    'citizen',
    'DEMO_ACCOUNT_NO_PASSWORD_LOGIN',
    1,
    isoDaysAgo(22)
  );
  const karthikId = Number(sampleCitizenRes.lastInsertRowid);

  const insertComplaint = db.prepare(`
    INSERT INTO complaints (
      reference_id, citizen_id, original_description, ai_summary, language,
      category_id, area, street_landmark, photo_url, department_id,
      routing_explanation, priority, priority_reason, status, endorsement_count,
      submission_mode, is_sample, incident_datetime, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEMO_SUBMISSION', 1, ?, ?, ?)
  `);

  const insertHistory = db.prepare(`
    INSERT INTO complaint_status_history (
      complaint_id, previous_status, new_status, note, updated_by_user_id, updated_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleComplaints = [
    {
      ref: 'CP-2026-1001',
      citizenId: ananyaId,
      desc: 'Enga street-la 2nd Main Road corner-la kuppai 4 naala clear pannala. Overflow aagi romba bad smell varudhu.',
      summary: 'Uncollected household garbage overflowing at the 2nd Main Road corner bin for four consecutive days, causing foul odor and hygiene risk.',
      lang: 'Tanglish',
      cat: 'Garbage / Waste Management',
      area: 'Adyar',
      street: '2nd Main Road, near Gandhi Nagar Bus Stop',
      photo: '/src/assets/images/civic_issue_waste_1795712427563.jpg',
      dept: 'DEPT-SWM',
      routing: 'Assigned to Solid Waste & Sanitation Department because the issue involves missed municipal garbage collection and bin overflow in Adyar.',
      priority: 'High',
      priorityReason: 'Multi-day waste accumulation near a busy residential bus stop poses a public sanitation and vector-breeding concern.',
      status: 'In Progress',
      endorsements: 5,
      daysAgo: 4,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint registered via CivicProof AI Assistant (Demo Submission).', by: 'Ananya Krishnan', days: 4, hrs: 0 },
        { prev: 'Submitted', next: 'Forwarded', note: 'Routed to Zone 13 Solid Waste & Sanitation Supervisor.', by: 'CivicProof Dispatch', days: 3, hrs: 18 },
        { prev: 'Forwarded', next: 'Under Review', note: 'Sanitation inspector verified overflow at 2nd Main Road corner.', by: 'Zonal Admin', days: 2, hrs: 10 },
        { prev: 'Under Review', next: 'In Progress', note: 'Compactor vehicle TN-09-G-4412 dispatched for clearance and lime spraying.', by: 'Zonal Admin', days: 1, hrs: 4 },
      ],
    },
    {
      ref: 'CP-2026-1002',
      citizenId: ananyaId,
      desc: 'Large rainwater-filled pothole right outside Indira Nagar 3rd Cross Street junction. Two-wheelers are skidding during evening traffic.',
      summary: 'Deep rainwater-filled asphalt pothole at Indira Nagar 3rd Cross Street creating an immediate accident hazard for two-wheelers.',
      lang: 'English',
      cat: 'Road Damage / Potholes',
      area: 'Adyar',
      street: 'Indira Nagar 3rd Cross Street Junction',
      photo: '/src/assets/images/civic_issue_road_1795712427725.jpg',
      dept: 'DEPT-ROADS',
      routing: 'Assigned to Municipal Roads & Highways Wing for urgent asphalt patching on an urban commuter street in Adyar.',
      priority: 'Urgent',
      priorityReason: 'Water-filled pothole actively causing two-wheeler skids poses an immediate road safety hazard.',
      status: 'Under Review',
      endorsements: 8,
      daysAgo: 3,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint registered with photographic evidence (Demo Submission).', by: 'Ananya Krishnan', days: 3, hrs: 0 },
        { prev: 'Submitted', next: 'Forwarded', note: 'Forwarded to Assistant Executive Engineer (Roads - Zone 13).', by: 'CivicProof Dispatch', days: 2, hrs: 12 },
        { prev: 'Forwarded', next: 'Under Review', note: 'Site measurement scheduled for cold-mix asphalt patching.', by: 'Zonal Admin', days: 1, hrs: 8 },
      ],
    },
    {
      ref: 'CP-2026-1003',
      citizenId: ananyaId,
      desc: 'LB Road side lane-la 3 streetlight poles last week-la irundhu eriyala. Night-la nadakka bayama irukku.',
      summary: 'Three consecutive municipal LED streetlight poles on the LB Road side lane have been non-functional for a week, leaving pedestrians in darkness.',
      lang: 'Tanglish',
      cat: 'Streetlight Issues',
      area: 'Adyar',
      street: 'LB Road Side Lane, behind Kasturba Nagar Library',
      photo: '/src/assets/images/civic_issue_streetlight_1795712429177.jpg',
      dept: 'DEPT-ELEC',
      routing: 'Assigned to Street Lighting & Electrical Wing because three contiguous streetlamp poles require feeder and luminaire inspection.',
      priority: 'High',
      priorityReason: 'Complete darkness along a pedestrian residential lane raises nighttime safety risks.',
      status: 'Resolved',
      endorsements: 4,
      daysAgo: 9,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint submitted via Citizen Portal (Demo Submission).', by: 'Ananya Krishnan', days: 9, hrs: 0 },
        { prev: 'Submitted', next: 'Forwarded', note: 'Forwarded to Electrical Maintenance Crew - Adyar.', by: 'CivicProof Dispatch', days: 8, hrs: 12 },
        { prev: 'Forwarded', next: 'In Progress', note: 'Faulty timer relay identified in feeder box #AD-19.', by: 'Electrical Supervisor', days: 7, hrs: 6 },
        { prev: 'In Progress', next: 'Resolved', note: 'Relay replaced and all 3 LED fixtures tested operational at 18:45 IST.', by: 'Electrical Supervisor', days: 6, hrs: 2 },
      ],
    },
    {
      ref: 'CP-2026-1004',
      citizenId: karthikId,
      desc: 'அண்ணா நகர் 4வது அவென்யூவில் மழைநீர் வடிகால் அடைத்துக்கொண்டு சாலையில் கழிவுநீர் தேங்குகிறது.',
      summary: 'Blocked stormwater drain along Anna Nagar 4th Avenue causing stagnant wastewater overflow onto the roadway.',
      lang: 'Tamil',
      cat: 'Drainage Problems',
      area: 'Anna Nagar',
      street: '4th Avenue, opposite Tower Park East Gate',
      photo: '',
      dept: 'DEPT-DRAIN',
      routing: 'Assigned to Stormwater & Underground Drainage Board because the complaint involves drain silt blockage and roadway water stagnation.',
      priority: 'High',
      priorityReason: 'Stagnant drain water on a major avenue creates public health hazards and traffic obstruction.',
      status: 'In Progress',
      endorsements: 6,
      daysAgo: 5,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint filed in Tamil via CivicProof AI Agent (Demo Submission).', by: 'Karthik Subramanian', days: 5, hrs: 0 },
        { prev: 'Submitted', next: 'Forwarded', note: 'Routed to Zone 8 Drainage Maintenance Team.', by: 'CivicProof Dispatch', days: 4, hrs: 14 },
        { prev: 'Forwarded', next: 'In Progress', note: 'Desilting jet-rodding vehicle scheduled for 4th Avenue stretch.', by: 'Zonal Admin', days: 2, hrs: 5 },
      ],
    },
    {
      ref: 'CP-2026-1005',
      citizenId: karthikId,
      desc: 'Drinking water supply in Velachery 100 Feet Bypass side street has been muddy with very low pressure since yesterday morning.',
      summary: 'Contaminated muddy drinking water and severe low water pressure reported in a Velachery residential street.',
      lang: 'English',
      cat: 'Water Supply Problems',
      area: 'Velachery',
      street: 'Vijayanagar 2nd Street, off 100 Feet Bypass Road',
      photo: '',
      dept: 'DEPT-WATER',
      routing: 'Assigned to Metropolitan Water Supply & Sewerage Board for water quality testing and pipeline pressure restoration.',
      priority: 'Urgent',
      priorityReason: 'Potential drinking water contamination directly threatens household health and requires immediate testing.',
      status: 'Forwarded',
      endorsements: 7,
      daysAgo: 2,
      history: [
        { prev: null, next: 'Submitted', note: 'Urgent water quality complaint recorded (Demo Submission).', by: 'Karthik Subramanian', days: 2, hrs: 0 },
        { prev: 'Submitted', next: 'Forwarded', note: 'Escalated to Metro Water Area XIII Engineer for sample testing.', by: 'CivicProof Dispatch', days: 1, hrs: 16 },
      ],
    },
    {
      ref: 'CP-2026-1006',
      citizenId: ananyaId,
      desc: 'T. Nagar Usman Road pedestrian bus shelter roof sheet is loose and rusted near the corner seat.',
      summary: 'Loose rusted roofing sheet at the Usman Road pedestrian bus shelter posing a falling-debris risk to waiting commuters.',
      lang: 'English',
      cat: 'Public Infrastructure',
      area: 'T. Nagar',
      street: 'North Usman Road, near Panagal Park Stop',
      photo: '',
      dept: 'DEPT-INFRA',
      routing: 'Assigned to Public Infrastructure & Civic Works Division which manages municipal bus shelters and commuter amenities.',
      priority: 'Medium',
      priorityReason: 'Structural wear on a public transit shelter should be bolted and repaired before heavy winds.',
      status: 'Submitted',
      endorsements: 3,
      daysAgo: 1,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint registered via Citizen Portal (Demo Submission).', by: 'Ananya Krishnan', days: 1, hrs: 0 },
      ],
    },
    {
      ref: 'CP-2026-1007',
      citizenId: karthikId,
      desc: 'மயிலாப்பூர் கபாலீஸ்வரர் கோவில் தெற்கு மாட வீதியில் குப்பை தொட்டி உடைந்து குப்பை சிதறி கிடக்கிறது.',
      summary: 'Damaged municipal garbage bin spilling waste onto South Mada Street in Mylapore.',
      lang: 'Tamil',
      cat: 'Garbage / Waste Management',
      area: 'Mylapore',
      street: 'South Mada Street, near East Tank Corner',
      photo: '/src/assets/images/civic_issue_waste_1795712427563.jpg',
      dept: 'DEPT-SWM',
      routing: 'Assigned to Solid Waste & Sanitation Department for bin replacement and immediate street sweeping.',
      priority: 'Medium',
      priorityReason: 'Spilled waste in a high-footfall heritage neighborhood requires timely sanitation clearance.',
      status: 'Resolved',
      endorsements: 5,
      daysAgo: 11,
      history: [
        { prev: null, next: 'Submitted', note: 'Submitted in Tamil (Demo Submission).', by: 'Karthik Subramanian', days: 11, hrs: 0 },
        { prev: 'Submitted', next: 'In Progress', note: 'Replacement 1100L green bin dispatched.', by: 'Zonal Admin', days: 10, hrs: 4 },
        { prev: 'In Progress', next: 'Resolved', note: 'Damaged bin replaced and street swept clean.', by: 'Zonal Admin', days: 9, hrs: 3 },
      ],
    },
    {
      ref: 'CP-2026-1008',
      citizenId: karthikId,
      desc: 'Tambaram East Station Road-la drainage cover slab broken aagi open-la irukku, pedestrian nadakka kashtama irukku.',
      summary: 'Broken stormwater drain slab leaving an open hazard along the Tambaram East Station Road footpath.',
      lang: 'Tanglish',
      cat: 'Drainage Problems',
      area: 'Tambaram',
      street: 'Tambaram East Station Road, near Railway Footbridge',
      photo: '',
      dept: 'DEPT-DRAIN',
      routing: 'Assigned to Stormwater & Underground Drainage Board for precast concrete slab replacement.',
      priority: 'Urgent',
      priorityReason: 'An uncovered drain opening along a busy station walkway creates high risk of pedestrian injury.',
      status: 'Resolved',
      endorsements: 9,
      daysAgo: 8,
      history: [
        { prev: null, next: 'Submitted', note: 'Reported in Tanglish via CivicProof (Demo Submission).', by: 'Karthik Subramanian', days: 8, hrs: 0 },
        { prev: 'Submitted', next: 'Under Review', note: 'Zonal engineer confirmed broken 900mm precast slab.', by: 'Zonal Admin', days: 7, hrs: 8 },
        { prev: 'Under Review', next: 'In Progress', note: 'Safety barricade placed; new reinforced slab brought to site.', by: 'Zonal Admin', days: 6, hrs: 12 },
        { prev: 'In Progress', next: 'Resolved', note: 'New concrete slab installed and footpath levelled.', by: 'Zonal Admin', days: 5, hrs: 10 },
      ],
    },
    {
      ref: 'CP-2026-1009',
      citizenId: ananyaId,
      desc: 'Private apartment interior plumbing leak inside Flat 4B bathroom ceiling.',
      summary: 'Interior residential apartment plumbing leak reported within private property premises.',
      lang: 'English',
      cat: 'Other Civic Issues',
      area: 'Velachery',
      street: 'Park View Apartments, Tansi Nagar',
      photo: '',
      dept: 'DEPT-GEN',
      routing: 'Reviewed by General Municipal Grievance Cell to verify municipal jurisdiction.',
      priority: 'Low',
      priorityReason: 'Internal private apartment plumbing falls outside public civic infrastructure maintenance.',
      status: 'Rejected',
      endorsements: 1,
      daysAgo: 6,
      history: [
        { prev: null, next: 'Submitted', note: 'Submitted via Citizen Portal (Demo Submission).', by: 'Ananya Krishnan', days: 6, hrs: 0 },
        { prev: 'Submitted', next: 'Rejected', note: 'Outside municipal jurisdiction: internal private flat plumbing should be handled by the apartment association.', by: 'Zonal Admin', days: 5, hrs: 14 },
      ],
    },
    {
      ref: 'CP-2026-1010',
      citizenId: karthikId,
      desc: 'Anna Nagar West Extension main road resurfacing left loose gravel near the school crossing.',
      summary: 'Loose asphalt gravel remaining after resurfacing near a school pedestrian crossing in Anna Nagar West.',
      lang: 'English',
      cat: 'Road Damage / Potholes',
      area: 'Anna Nagar',
      street: 'Anna Nagar West Extension, near DAV School Gate',
      photo: '/src/assets/images/civic_issue_road_1795712427725.jpg',
      dept: 'DEPT-ROADS',
      routing: 'Assigned to Municipal Roads & Highways Wing for post-resurfacing sweeping and compaction near a school zone.',
      priority: 'High',
      priorityReason: 'Loose gravel at a school pedestrian crossing increases slip hazards for students and cyclists.',
      status: 'Under Review',
      endorsements: 4,
      daysAgo: 2,
      history: [
        { prev: null, next: 'Submitted', note: 'Complaint filed via CivicProof (Demo Submission).', by: 'Karthik Subramanian', days: 2, hrs: 0 },
        { prev: 'Submitted', next: 'Under Review', note: 'Contractor notified to inspect compaction and sweep loose aggregate.', by: 'Zonal Admin', days: 1, hrs: 6 },
      ],
    },
  ];

  for (const sc of sampleComplaints) {
    const createdAt = isoDaysAgo(sc.daysAgo);
    const lastHist = sc.history[sc.history.length - 1];
    const updatedAt = isoDaysAgo(lastHist.days, lastHist.hrs);
    const res = insertComplaint.run(
      sc.ref,
      sc.citizenId,
      sc.desc,
      sc.summary,
      sc.lang,
      catIds[sc.cat],
      sc.area,
      sc.street,
      sc.photo,
      deptIds[sc.dept],
      sc.routing,
      sc.priority,
      sc.priorityReason,
      sc.status,
      sc.endorsements,
      createdAt,
      createdAt,
      updatedAt
    );
    const complaintId = Number(res.lastInsertRowid);
    for (const h of sc.history) {
      insertHistory.run(
        complaintId,
        h.prev,
        h.next,
        h.note,
        null,
        h.by,
        isoDaysAgo(h.days, h.hrs)
      );
    }
  }
}

export function generateReferenceId(): string {
  const year = new Date().getFullYear();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM complaints')
    .get() as { count: number };
  const seq = 1001 + row.count;
  const candidate = `CP-${year}-${seq}`;
  const existing = db
    .prepare('SELECT id FROM complaints WHERE reference_id = ?')
    .get(candidate);
  if (!existing) return candidate;
  return `CP-${year}-${seq}-${Math.floor(100 + Math.random() * 900)}`;
}
