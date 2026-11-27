import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db.ts';

export interface CategoryOption {
  id: number;
  name: string;
  description: string;
  default_department_id: number;
}

export interface DepartmentOption {
  id: number;
  code: string;
  name: string;
  description: string;
  official_channel: string;
  sla_hours: number;
}

export interface SimilarComplaintMatch {
  id: number;
  reference_id: string;
  ai_summary: string;
  category_name: string;
  area: string;
  street_landmark: string;
  status: string;
  endorsement_count: number;
  created_at: string;
  similarity_score: number;
  match_reasons: string[];
}

export interface AIAnalysisResult {
  aiMode: 'gemini' | 'fallback_keyword';
  modelUsed?: string;
  aiNotice: string;
  detectedLanguage: 'Tamil' | 'Tanglish' | 'English';
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
  suggestedPriority: 'Low' | 'Medium' | 'High' | 'Urgent';
  priorityReason: string;
  missingFields: string[];
  needsFollowUp: boolean;
  followUpQuestion: string;
  nextActionAdvice: string;
  similarComplaints: SimilarComplaintMatch[];
}

const GEMINI_TEXT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|timeout/i.test(msg);
}

async function generateWithResilience(
  ai: GoogleGenAI,
  requestFactory: (model: string) => Parameters<GoogleGenAI['models']['generateContent']>[0]
): Promise<{ text: string; modelUsed: string }> {
  let lastError: unknown = null;

  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const response = await ai.models.generateContent(requestFactory(model));
      const text = (response.text ?? '').trim();
      if (!text) {
        throw new Error(`Empty response from ${model}`);
      }
      return { text, modelUsed: model };
    } catch (err) {
      lastError = err;
      if (isTransientError(err)) {
        await sleep(250);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini API request failed.');
}

function parseDataUrlImage(
  photoUrl?: string
): { mimeType: string; data: string } | null {
  if (!photoUrl) return null;
  const match = photoUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  return { mimeType, data: match[2] };
}

function detectLanguageHeuristic(text: string): 'Tamil' | 'Tanglish' | 'English' {
  if (/[\u0B80-\u0BFF]/.test(text)) {
    return 'Tamil';
  }
  const tanglishMarkers =
    /\b(enga|engal|kuppai|romba|naala|pannala|irukku|varudhu|illa|illai|thanni|saalai|theru|pothole-la|street-la|road-la|kudikka|eriyala|light-la|drainage-la|vara|maatingudhu|aagi|nadakka|kashtama|bayama|konjam|parunga|clear pannala)\b/i;
  if (tanglishMarkers.test(text)) {
    return 'Tanglish';
  }
  return 'English';
}

function tokenizeText(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'is', 'in', 'at', 'of', 'on', 'and', 'for', 'to', 'a', 'an', 'has', 'been',
    'not', 'very', 'from', 'near', 'our', 'my', 'this', 'that', 'with', 'are', 'was',
    'enga', 'romba', 'naala', 'irukku', 'varudhu', 'la', 'oru',
  ]);
  const normalized = text
    .toLowerCase()
    .replace(/kuppai|குப்பை/g, 'garbage waste trash')
    .replace(/thanni|தண்ணீர்|குடிநீர்/g, 'water supply pipeline')
    .replace(/saalai|சாலை|pothole|குழி/g, 'road pothole damage')
    .replace(/eriyala|மின்விளக்கு|தெருவிளக்கு|vilakku/g, 'streetlight light pole dark')
    .replace(/கழிவுநீர்|வடிகால்|saakkadai/g, 'drainage sewage drain');

  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  return new Set(tokens);
}

export function findSimilarComplaints(params: {
  categoryId: number;
  area: string;
  streetLandmark: string;
  description: string;
  summary: string;
}): SimilarComplaintMatch[] {
  const candidates = db
    .prepare(
      `SELECT c.id, c.reference_id, c.original_description, c.ai_summary,
              c.category_id, cat.name as category_name, c.area, c.street_landmark,
              c.status, c.endorsement_count, c.created_at
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       WHERE c.status NOT IN ('Resolved', 'Rejected')
       ORDER BY c.created_at DESC
       LIMIT 60`
    )
    .all() as Array<{
    id: number;
    reference_id: string;
    original_description: string;
    ai_summary: string;
    category_id: number;
    category_name: string;
    area: string;
    street_landmark: string;
    status: string;
    endorsement_count: number;
    created_at: string;
  }>;

  const queryTokens = tokenizeText(`${params.description} ${params.summary} ${params.streetLandmark}`);
  const normArea = params.area.trim().toLowerCase();

  const matches: SimilarComplaintMatch[] = [];

  for (const row of candidates) {
    let score = 0;
    const reasons: string[] = [];

    if (row.category_id === params.categoryId) {
      score += 0.4;
      reasons.push(`Same category (${row.category_name})`);
    }

    const rowArea = row.area.trim().toLowerCase();
    if (normArea && rowArea && (rowArea.includes(normArea) || normArea.includes(rowArea))) {
      score += 0.3;
      reasons.push(`Same area (${row.area})`);
    }

    const candidateTokens = tokenizeText(
      `${row.original_description} ${row.ai_summary} ${row.street_landmark}`
    );
    let overlap = 0;
    for (const token of queryTokens) {
      if (candidateTokens.has(token)) overlap++;
    }
    const denom = Math.max(1, Math.min(queryTokens.size, candidateTokens.size));
    const textSim = overlap / denom;
    if (textSim >= 0.15) {
      score += Math.min(0.3, textSim * 0.45);
      reasons.push('Similar issue description & location terms');
    }

    if (score >= 0.45) {
      matches.push({
        id: row.id,
        reference_id: row.reference_id,
        ai_summary: row.ai_summary,
        category_name: row.category_name,
        area: row.area,
        street_landmark: row.street_landmark,
        status: row.status,
        endorsement_count: row.endorsement_count,
        created_at: row.created_at,
        similarity_score: Math.min(0.98, Number(score.toFixed(2))),
        match_reasons: reasons,
      });
    }
  }

  return matches
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, 3);
}

function runKeywordFallback(params: {
  complaintText: string;
  preferredLanguage: string;
  areaHint: string;
  streetHint: string;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  notice: string;
}): AIAnalysisResult {
  const combined = `${params.complaintText} ${params.areaHint} ${params.streetHint}`.toLowerCase();
  const detectedLanguage = detectLanguageHeuristic(params.complaintText);
  const responseLang =
    params.preferredLanguage && params.preferredLanguage !== 'Auto-detect'
      ? (params.preferredLanguage as 'Tamil' | 'Tanglish' | 'English')
      : detectedLanguage;

  let matchedCategory =
    params.categories.find((c) => c.name === 'Other Civic Issues') || params.categories[0];

  const rules: Array<{
    pattern: RegExp;
    catName: string;
    summaryPrefix: string;
    priority: 'Low' | 'Medium' | 'High' | 'Urgent';
    reason: string;
  }> = [
    {
      pattern: /kuppai|garbage|waste|trash|bin|dump|sanitation|smell|குப்பை|தொட்டி/i,
      catName: 'Garbage / Waste Management',
      summaryPrefix: 'Uncollected garbage or waste management issue reported',
      priority: 'High',
      reason: 'Accumulated municipal waste poses immediate public hygiene and sanitation risks.',
    },
    {
      pattern: /pothole|road|asphalt|footpath|crater|saalai|சாலை|குழி/i,
      catName: 'Road Damage / Potholes',
      summaryPrefix: 'Road surface damage or pothole hazard reported',
      priority: 'High',
      reason: 'Damaged roadways increase accident risks for commuters and two-wheelers.',
    },
    {
      pattern: /drain|sewage|waterlog|manhole|gutter|flood|வடிகால்|கழிவுநீர்/i,
      catName: 'Drainage Problems',
      summaryPrefix: 'Blocked drainage or wastewater overflow reported',
      priority: 'High',
      reason: 'Drainage blockages lead to stagnant water, road obstruction, and sanitation hazards.',
    },
    {
      pattern: /streetlight|street light|lamp|eriyala|dark|pole|மின்விளக்கு|தெருவிளக்கு/i,
      catName: 'Streetlight Issues',
      summaryPrefix: 'Non-functioning municipal streetlight reported',
      priority: 'Medium',
      reason: 'Poor street illumination reduces nighttime pedestrian and road visibility.',
    },
    {
      pattern: /water|pipe|leak|muddy|pressure|thanni|தண்ணீர்|குடிநீர்/i,
      catName: 'Water Supply Problems',
      summaryPrefix: 'Drinking water supply disruption or pipeline leak reported',
      priority: 'Urgent',
      reason: 'Water supply disruptions or contamination directly impact essential household needs.',
    },
    {
      pattern: /park|bus shelter|toilet|bench|railing|sign|bridge|building/i,
      catName: 'Public Infrastructure',
      summaryPrefix: 'Public civic infrastructure maintenance issue reported',
      priority: 'Medium',
      reason: 'Public infrastructure damage requires scheduled maintenance for commuter safety.',
    },
  ];

  let suggestedPriority: 'Low' | 'Medium' | 'High' | 'Urgent' = 'Medium';
  let priorityReason = 'Assigned standard civic response priority pending zonal inspection.';
  let issueSummary = `Civic issue reported: ${params.complaintText.trim()}`;

  for (const r of rules) {
    if (r.pattern.test(combined)) {
      const found = params.categories.find((c) => c.name === r.catName);
      if (found) matchedCategory = found;
      suggestedPriority = r.priority;
      priorityReason = r.reason;
      issueSummary = `${r.summaryPrefix}: "${params.complaintText.trim()}"`;
      break;
    }
  }

  const knownAreas = [
    'Adyar', 'Anna Nagar', 'T. Nagar', 'Velachery', 'Mylapore', 'Tambaram',
    'Guindy', 'Kodambakkam', 'Besant Nagar', 'Thiruvanmiyur', 'Porur', 'Ambattur',
    'Nungambakkam', 'Chromepet', 'Sholinganallur', 'OMR', 'Perungudi',
  ];
  let extractedArea = params.areaHint.trim();
  if (!extractedArea) {
    for (const a of knownAreas) {
      if (combined.includes(a.toLowerCase())) {
        extractedArea = a;
        break;
      }
    }
  }
  const extractedStreetLandmark = params.streetHint.trim();

  const dept =
    params.departments.find((d) => d.id === matchedCategory.default_department_id) ||
    params.departments[0];

  const missingFields: string[] = [];
  if (!extractedArea) missingFields.push('Area / Neighborhood');
  if (!extractedStreetLandmark) missingFields.push('Street name or nearby landmark');

  const needsFollowUp = missingFields.length > 0;
  let followUpQuestion = '';
  let replyInPreferredLanguage = '';

  if (responseLang === 'Tamil') {
    followUpQuestion = needsFollowUp
      ? `உங்கள் புகாரை சரியான துறைக்கு அனுப்ப, எந்த பகுதி மற்றும் தெரு / அருகிலுள்ள அடையாளம் (${missingFields.join(', ')}) என்பதை குறிப்பிட முடியுமா?`
      : '';
    replyInPreferredLanguage = `உங்கள் புகார் "${matchedCategory.name}" பிரிவாக அடையாளம் காணப்பட்டு ${dept.name} துறைக்கு பரிந்துரைக்கப்பட்டுள்ளது.`;
  } else if (responseLang === 'Tanglish') {
    followUpQuestion = needsFollowUp
      ? `Unga complaint-a correct department-ku route panna, area name matrum street / nearby landmark (${missingFields.join(', ')}) konjam sollunga.`
      : '';
    replyInPreferredLanguage = `Purinjiduchu! Unga issue "${matchedCategory.name}" category-la classify panniyachu. Idhuku ${dept.name} correct department.`;
  } else {
    followUpQuestion = needsFollowUp
      ? `To route this complaint accurately, could you please share the ${missingFields.join(' and ')}?`
      : '';
    replyInPreferredLanguage = `Understood. Your complaint has been classified under ${matchedCategory.name} and matched with the ${dept.name}.`;
  }

  const similarComplaints = findSimilarComplaints({
    categoryId: matchedCategory.id,
    area: extractedArea,
    streetLandmark: extractedStreetLandmark,
    description: params.complaintText,
    summary: issueSummary,
  });

  return {
    aiMode: 'fallback_keyword',
    aiNotice: params.notice,
    detectedLanguage,
    replyInPreferredLanguage,
    photoObservation: '',
    categoryId: matchedCategory.id,
    categoryName: matchedCategory.name,
    issueSummary,
    extractedArea,
    extractedStreetLandmark,
    departmentId: dept.id,
    departmentName: dept.name,
    officialChannel: dept.official_channel,
    routingExplanation: `Recommended ${dept.name} based on the "${matchedCategory.name}" issue classification${extractedArea ? ` in ${extractedArea}` : ''}.`,
    suggestedPriority,
    priorityReason,
    missingFields,
    needsFollowUp,
    followUpQuestion,
    nextActionAdvice: `Review the structured draft below and confirm to log a Demo Submission, or file officially via ${dept.official_channel}.`,
    similarComplaints,
  };
}

export async function analyzeCivicComplaint(params: {
  complaintText: string;
  preferredLanguage?: string;
  followUpAnswer?: string;
  areaHint?: string;
  streetHint?: string;
  photoUrl?: string;
}): Promise<AIAnalysisResult> {
  const categories = db
    .prepare(
      'SELECT id, name, description, default_department_id FROM categories WHERE is_active = 1 ORDER BY id ASC'
    )
    .all() as CategoryOption[];

  const departments = db
    .prepare(
      'SELECT id, code, name, description, official_channel, sla_hours FROM departments ORDER BY id ASC'
    )
    .all() as DepartmentOption[];

  const fullText = params.followUpAnswer?.trim()
    ? `${params.complaintText.trim()}\nAdditional citizen detail: ${params.followUpAnswer.trim()}`
    : params.complaintText.trim();

  const ai = getGeminiClient();
  if (!ai) {
    return runKeywordFallback({
      complaintText: fullText,
      preferredLanguage: params.preferredLanguage || 'Auto-detect',
      areaHint: params.areaHint || '',
      streetHint: params.streetHint || '',
      categories,
      departments,
      notice:
        'GEMINI_API_KEY is not configured in Settings > Secrets; CivicProof used its modular keyword-based classification fallback.',
    });
  }

  const categoryCatalog = categories.map((c) => `- "${c.name}": ${c.description}`).join('\n');
  const departmentCatalog = departments
    .map((d) => `- "${d.name}" (code: ${d.code}, SLA: ${d.sla_hours}h): ${d.description}`)
    .join('\n');

  const inlineImage = parseDataUrlImage(params.photoUrl);

  const prompt = `You are CivicProof's Multilingual Civic Issue Triage Agent serving Indian citizens who write in Tamil, Tanglish (Tamil written in Latin script like "Enga street-la kuppai romba naala clear pannala"), or English.

Citizen's complaint message:
"""
${fullText}
"""
Preferred response language: ${params.preferredLanguage || 'Auto-detect'}
Area field already provided by user (may be empty): "${params.areaHint || ''}"
Street/Landmark field already provided by user (may be empty): "${params.streetHint || ''}"
${inlineImage ? 'The citizen also attached a photograph of the civic issue—inspect the photo carefully and incorporate what you see into issueSummary, priorityReason, and photoObservation.' : 'No photograph was attached.'}

Available complaint categories (pick the exact name from this list):
${categoryCatalog}

Available government departments (pick the exact name from this list):
${departmentCatalog}

Tasks:
1. Detect whether the complaint is in "Tamil", "Tanglish", or "English".
2. Understand the civic problem accurately—even colloquial Tanglish or Tamil.
3. Produce a clear, formal English "issueSummary" (1-2 concise sentences) suitable for a municipal work order.
4. If an image was attached, summarize what is visible in "photoObservation" (1 sentence); otherwise set "photoObservation" to "".
5. Pick the single best exact "categoryName" from the list above.
6. Pick the single best exact "departmentName" from the list above, and write a plain 1-2 sentence "routingExplanation" explaining why this department handles it.
7. Extract "extractedArea" (neighborhood/ward/locality, e.g., "Adyar", "Anna Nagar") and "extractedStreetLandmark" (specific street or landmark) ONLY if actually mentioned by the citizen or already provided in the fields above. Leave empty string "" if missing—never fabricate a location!
8. Determine "missingFields": list missing critical fields (e.g. "Area / Neighborhood", "Street name or nearby landmark") if empty.
9. Set "needsFollowUp" to true if Area or Street/Landmark is missing or the issue is too vague; write a short, polite, helpful "followUpQuestion" IN THE CITIZEN'S PREFERRED/DETECTED LANGUAGE (Tamil script if Tamil, natural Tanglish if Tanglish, English if English). If nothing is missing, set "needsFollowUp" to false and "followUpQuestion" to "".
10. Write a brief empathetic 1-sentence "replyInPreferredLanguage" in the citizen's preferred/detected language confirming what you understood.
11. Suggest "suggestedPriority" ("Low", "Medium", "High", or "Urgent") with a transparent 1-sentence "priorityReason" based on public health, safety hazard, or essential service impact.
12. Provide a concise "nextActionAdvice" reminding the citizen to verify details before submitting in Demo Mode.`;

  const contents = inlineImage
    ? {
        parts: [
          {
            inlineData: {
              mimeType: inlineImage.mimeType,
              data: inlineImage.data,
            },
          },
          { text: prompt },
        ],
      }
    : prompt;

  try {
    const { text: rawText, modelUsed } = await generateWithResilience(ai, (model) => ({
      model,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING },
            replyInPreferredLanguage: { type: Type.STRING },
            photoObservation: { type: Type.STRING },
            categoryName: { type: Type.STRING },
            issueSummary: { type: Type.STRING },
            extractedArea: { type: Type.STRING },
            extractedStreetLandmark: { type: Type.STRING },
            departmentName: { type: Type.STRING },
            routingExplanation: { type: Type.STRING },
            suggestedPriority: { type: Type.STRING },
            priorityReason: { type: Type.STRING },
            missingFields: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            needsFollowUp: { type: Type.BOOLEAN },
            followUpQuestion: { type: Type.STRING },
            nextActionAdvice: { type: Type.STRING },
          },
          required: [
            'detectedLanguage',
            'replyInPreferredLanguage',
            'photoObservation',
            'categoryName',
            'issueSummary',
            'extractedArea',
            'extractedStreetLandmark',
            'departmentName',
            'routingExplanation',
            'suggestedPriority',
            'priorityReason',
            'missingFields',
            'needsFollowUp',
            'followUpQuestion',
            'nextActionAdvice',
          ],
        },
      },
    }));

    const parsed = JSON.parse(rawText) as {
      detectedLanguage: string;
      replyInPreferredLanguage: string;
      photoObservation: string;
      categoryName: string;
      issueSummary: string;
      extractedArea: string;
      extractedStreetLandmark: string;
      departmentName: string;
      routingExplanation: string;
      suggestedPriority: string;
      priorityReason: string;
      missingFields: string[];
      needsFollowUp: boolean;
      followUpQuestion: string;
      nextActionAdvice: string;
    };

    const matchedCategory =
      categories.find((c) => c.name.toLowerCase() === parsed.categoryName?.toLowerCase()) ||
      categories.find((c) => c.name === 'Other Civic Issues') ||
      categories[0];

    const matchedDept =
      departments.find((d) => d.name.toLowerCase() === parsed.departmentName?.toLowerCase()) ||
      departments.find((d) => d.id === matchedCategory.default_department_id) ||
      departments[0];

    const validLangs = new Set(['Tamil', 'Tanglish', 'English']);
    const detectedLanguage = (
      validLangs.has(parsed.detectedLanguage)
        ? parsed.detectedLanguage
        : detectLanguageHeuristic(fullText)
    ) as 'Tamil' | 'Tanglish' | 'English';

    const validPriorities = new Set(['Low', 'Medium', 'High', 'Urgent']);
    const suggestedPriority = (
      validPriorities.has(parsed.suggestedPriority) ? parsed.suggestedPriority : 'Medium'
    ) as 'Low' | 'Medium' | 'High' | 'Urgent';

    const extractedArea = (parsed.extractedArea || params.areaHint || '').trim();
    const extractedStreetLandmark = (
      parsed.extractedStreetLandmark ||
      params.streetHint ||
      ''
    ).trim();

    const similarComplaints = findSimilarComplaints({
      categoryId: matchedCategory.id,
      area: extractedArea,
      streetLandmark: extractedStreetLandmark,
      description: fullText,
      summary: parsed.issueSummary || fullText,
    });

    return {
      aiMode: 'gemini',
      modelUsed,
      aiNotice: `Analyzed live using Gemini multilingual AI (${modelUsed}).`,
      detectedLanguage,
      replyInPreferredLanguage:
        parsed.replyInPreferredLanguage ||
        `Classified under ${matchedCategory.name} for ${matchedDept.name}.`,
      photoObservation: (parsed.photoObservation || '').trim(),
      categoryId: matchedCategory.id,
      categoryName: matchedCategory.name,
      issueSummary: parsed.issueSummary || fullText,
      extractedArea,
      extractedStreetLandmark,
      departmentId: matchedDept.id,
      departmentName: matchedDept.name,
      officialChannel: matchedDept.official_channel,
      routingExplanation:
        parsed.routingExplanation ||
        `Routed to ${matchedDept.name} based on issue category "${matchedCategory.name}".`,
      suggestedPriority,
      priorityReason:
        parsed.priorityReason || 'Priority evaluated from safety, hygiene, and service impact.',
      missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
      needsFollowUp: Boolean(parsed.needsFollowUp && parsed.followUpQuestion?.trim()),
      followUpQuestion: parsed.followUpQuestion || '',
      nextActionAdvice:
        parsed.nextActionAdvice ||
        `Review and confirm to record in Demo Mode, or file officially via ${matchedDept.official_channel}.`,
      similarComplaints,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown upstream AI error';
    return runKeywordFallback({
      complaintText: fullText,
      preferredLanguage: params.preferredLanguage || 'Auto-detect',
      areaHint: params.areaHint || '',
      streetHint: params.streetHint || '',
      categories,
      departments,
      notice: `Gemini AI service temporarily unavailable (${errMsg.slice(0, 100)}). Switched transparently to keyword-based classification fallback.`,
    });
  }
}

export async function answerCivicQuestion(params: {
  question: string;
  preferredLanguage?: string;
  complaintContext?: string;
}): Promise<{ answer: string; aiMode: 'gemini' | 'fallback'; modelUsed?: string }> {
  const departments = db
    .prepare('SELECT name, code, official_channel, sla_hours, description FROM departments ORDER BY id ASC')
    .all() as DepartmentOption[];

  const ai = getGeminiClient();
  if (!ai) {
    return {
      aiMode: 'fallback',
      answer:
        'CivicProof routes complaints across Roads, Solid Waste & Sanitation, Drainage, Street Lighting, Water Supply, and Public Infrastructure. Configure GEMINI_API_KEY in Settings > Secrets to enable live conversational civic guidance.',
    };
  }

  const deptList = departments
    .map((d) => `- ${d.name} (${d.code}, SLA ${d.sla_hours}h): ${d.official_channel}`)
    .join('\n');

  const prompt = `You are CivicProof's helpful multilingual civic guide. Reply concisely in 2-4 plain sentences in the citizen's language (${params.preferredLanguage || 'match the language of the question — Tamil, Tanglish, or English'}).
Never falsely claim a complaint was submitted to a live external government API—always clarify CivicProof uses Demo Submission Mode while showing the real official municipal channel.

CivicProof Departments:
${deptList}

${params.complaintContext ? `Current draft context: ${params.complaintContext}` : ''}

Citizen's question: ${params.question.trim()}`;

  try {
    const { text, modelUsed } = await generateWithResilience(ai, (model) => ({
      model,
      contents: prompt,
    }));
    return { answer: text, aiMode: 'gemini', modelUsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI service unavailable';
    return {
      aiMode: 'fallback',
      answer: `Live AI guidance is temporarily unavailable (${msg.slice(0, 80)}). You can still complete and submit your structured complaint draft below.`,
    };
  }
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

export function getCivicDatabaseSnapshot(): CivicDatabaseSnapshot {
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

  const total = counts.total || 0;
  const resolved = counts.resolved || 0;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  const byCategory = db
    .prepare(
      `SELECT cat.name as name, COUNT(c.id) as count
       FROM categories cat
       LEFT JOIN complaints c ON c.category_id = cat.id
       WHERE cat.is_active = 1
       GROUP BY cat.id
       ORDER BY count DESC, cat.name ASC`
    )
    .all() as Array<{ name: string; count: number }>;

  const byArea = db
    .prepare(
      `SELECT area as name, COUNT(*) as count
       FROM complaints
       GROUP BY area
       ORDER BY count DESC, area ASC`
    )
    .all() as Array<{ name: string; count: number }>;

  const byDepartment = db
    .prepare(
      `SELECT d.id, d.code, d.name, d.official_channel, d.sla_hours,
              COUNT(c.id) as total,
              SUM(CASE WHEN c.status = 'Resolved' THEN 1 ELSE 0 END) as resolved,
              SUM(CASE WHEN c.status NOT IN ('Resolved', 'Rejected') THEN 1 ELSE 0 END) as openCount
       FROM departments d
       LEFT JOIN complaints c ON c.department_id = d.id
       GROUP BY d.id
       ORDER BY total DESC, d.name ASC`
    )
    .all() as CivicDatabaseSnapshot['byDepartment'];

  const recentOpen = db
    .prepare(
      `SELECT c.reference_id, cat.name as category, c.area, c.priority, c.status, c.ai_summary as summary
       FROM complaints c
       JOIN categories cat ON cat.id = c.category_id
       WHERE c.status NOT IN ('Resolved', 'Rejected')
       ORDER BY c.created_at DESC
       LIMIT 8`
    )
    .all() as CivicDatabaseSnapshot['recentOpen'];

  return {
    totals: {
      total,
      pending: counts.pending || 0,
      inProgress: counts.inProgress || 0,
      resolved,
      rejected: counts.rejected || 0,
      resolutionRate,
    },
    byCategory,
    byArea,
    byDepartment,
    recentOpen,
  };
}

export interface UnifiedAgentResponse {
  aiMode: 'gemini' | 'fallback';
  modelUsed?: string;
  aiNotice: string;
  intent: 'complaint_intake' | 'data_analysis' | 'civic_question';
  detectedLanguage: 'Tamil' | 'Tanglish' | 'English';
  agentReply: string;
  dataInsights: string[];
  photoObservation: string;
  readyToDraftRequest: boolean;
  draftRequest: {
    originalDescription: string;
    issueSummary: string;
    language: 'Tamil' | 'Tanglish' | 'English';
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
    priority: 'Low' | 'Medium' | 'High' | 'Urgent';
    priorityReason: string;
    missingFields: string[];
    followUpQuestion: string;
  } | null;
  similarComplaints: SimilarComplaintMatch[];
}

export async function runUnifiedCivicAgent(params: {
  message: string;
  preferredLanguage?: string;
  conversationHistory?: Array<{ role: 'user' | 'agent'; text: string }>;
  photoUrl?: string;
}): Promise<UnifiedAgentResponse> {
  const snapshot = getCivicDatabaseSnapshot();
  const categories = db
    .prepare(
      'SELECT id, name, description, default_department_id FROM categories WHERE is_active = 1 ORDER BY id ASC'
    )
    .all() as CategoryOption[];
  const departments = db
    .prepare(
      'SELECT id, code, name, description, official_channel, sla_hours FROM departments ORDER BY id ASC'
    )
    .all() as DepartmentOption[];

  const historyTranscript = (params.conversationHistory || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'CivicProof Agent'}: ${m.text}`)
    .join('\n');

  const isDataQueryHeuristic =
    /\b(analy[sz]e|analytics|data|stats|statistics|trend|hotspot|most complaints|how many|count|resolution rate|backlog|bottleneck|summary of complaints|report overview|dashboard)\b/i.test(
      params.message
    );
  const isQuestionHeuristic =
    /\?|^(which|what|how|who|when|where|can i|evlo|epdi|endha|yaar)\b/i.test(
      params.message.trim()
    );

  const ai = getGeminiClient();
  if (!ai) {
    return buildUnifiedFallback({
      message: params.message,
      preferredLanguage: params.preferredLanguage || 'Auto-detect',
      snapshot,
      categories,
      departments,
      isDataQuery: isDataQueryHeuristic,
      isQuestion: isQuestionHeuristic,
      notice:
        'GEMINI_API_KEY is not configured in Settings > Secrets; CivicProof Agent used its live-database analytical and keyword fallback.',
    });
  }

  const inlineImage = parseDataUrlImage(params.photoUrl);

  const prompt = `You are the CivicProof AI Agent—an intelligent, multilingual civic operations assistant that can:
(A) Analyze live municipal complaint data from the database and report real statistics, hotspots, and department bottlenecks;
(B) Answer citizen questions about civic complaint processes, SLA timelines, tracking, and government departments in Tamil, Tanglish, or English;
(C) Intake civic complaints (in Tamil, Tanglish, or English, with optional photos), ask polite follow-up questions if area or street/landmark is missing, and draft a structured government department request for user confirmation.

IMPORTANT INTEGRITY RULE: Never claim a request was already transmitted to an external live government API. Always frame dispatching as CivicProof Demo Submission Mode (Official Municipal API Ready) with the real official reporting channel listed.

LIVE CIVICPROOF DATABASE SNAPSHOT:
- Totals: ${snapshot.totals.total} total, ${snapshot.totals.pending} pending, ${snapshot.totals.inProgress} in progress, ${snapshot.totals.resolved} resolved (${snapshot.totals.resolutionRate}% resolution rate), ${snapshot.totals.rejected} rejected.
- By Category: ${snapshot.byCategory.map((c) => `${c.name}: ${c.count}`).join('; ')}
- By Area: ${snapshot.byArea.map((a) => `${a.name}: ${a.count}`).join('; ')}
- By Department: ${snapshot.byDepartment.map((d) => `${d.name} (${d.code}, SLA ${d.sla_hours}h): ${d.total} total, ${d.openCount || 0} open, ${d.resolved || 0} resolved, channel: ${d.official_channel}`).join(' | ')}
- Recent Open Complaints: ${snapshot.recentOpen.map((r) => `${r.reference_id} [${r.status}, ${r.priority}] ${r.area} (${r.category}): ${r.summary}`).join(' || ')}

AVAILABLE CATEGORIES (use exact name when drafting):
${categories.map((c) => `- "${c.name}": ${c.description}`).join('\n')}

AVAILABLE DEPARTMENTS (use exact name when drafting):
${departments.map((d) => `- "${d.name}" (${d.code}, SLA ${d.sla_hours}h)`).join('\n')}

${historyTranscript ? `RECENT CONVERSATION:\n${historyTranscript}\n` : ''}
PREFERRED LANGUAGE: ${params.preferredLanguage || 'Auto-detect'}
${inlineImage ? 'PHOTO ATTACHED: Inspect the image and include a 1-sentence photoObservation.' : 'NO PHOTO ATTACHED.'}
CURRENT USER MESSAGE:
"""
${params.message.trim()}
"""

Decide the primary "intent":
- "data_analysis": user wants analysis of complaint data, trends, areas, departments, or counts. Populate "dataInsights" with 2-4 crisp bullet findings using exact numbers from the snapshot above, and set "readyToDraftRequest" to false.
- "civic_question": user is asking how CivicProof works, which department handles an issue, SLAs, or status tracking. Answer clearly in the user's language, and set "readyToDraftRequest" to false unless they are also reporting an actual problem.
- "complaint_intake": user is describing a local civic problem or providing location/follow-up details to send a request to the government. Set "readyToDraftRequest" to true, fill all draft fields accurately (never invent a street/area if not mentioned in the current message or recent conversation), and if area or street/landmark is missing, politely ask for it inside "agentReply" AND "followUpQuestion" in the user's language (Tamil, Tanglish, or English).`;

  const contents = inlineImage
    ? {
        parts: [
          {
            inlineData: {
              mimeType: inlineImage.mimeType,
              data: inlineImage.data,
            },
          },
          { text: prompt },
        ],
      }
    : prompt;

  try {
    const { text: rawText, modelUsed } = await generateWithResilience(ai, (model) => ({
      model,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING },
            detectedLanguage: { type: Type.STRING },
            agentReply: { type: Type.STRING },
            dataInsights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            photoObservation: { type: Type.STRING },
            readyToDraftRequest: { type: Type.BOOLEAN },
            categoryName: { type: Type.STRING },
            departmentName: { type: Type.STRING },
            issueSummary: { type: Type.STRING },
            routingExplanation: { type: Type.STRING },
            extractedArea: { type: Type.STRING },
            extractedStreetLandmark: { type: Type.STRING },
            suggestedPriority: { type: Type.STRING },
            priorityReason: { type: Type.STRING },
            missingFields: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            followUpQuestion: { type: Type.STRING },
          },
          required: [
            'intent',
            'detectedLanguage',
            'agentReply',
            'dataInsights',
            'photoObservation',
            'readyToDraftRequest',
            'categoryName',
            'departmentName',
            'issueSummary',
            'routingExplanation',
            'extractedArea',
            'extractedStreetLandmark',
            'suggestedPriority',
            'priorityReason',
            'missingFields',
            'followUpQuestion',
          ],
        },
      },
    }));

    const parsed = JSON.parse(rawText) as {
      intent: string;
      detectedLanguage: string;
      agentReply: string;
      dataInsights: string[];
      photoObservation: string;
      readyToDraftRequest: boolean;
      categoryName: string;
      departmentName: string;
      issueSummary: string;
      routingExplanation: string;
      extractedArea: string;
      extractedStreetLandmark: string;
      suggestedPriority: string;
      priorityReason: string;
      missingFields: string[];
      followUpQuestion: string;
    };

    const validIntents = new Set(['complaint_intake', 'data_analysis', 'civic_question']);
    const intent = (
      validIntents.has(parsed.intent) ? parsed.intent : 'civic_question'
    ) as UnifiedAgentResponse['intent'];

    const validLangs = new Set(['Tamil', 'Tanglish', 'English']);
    const detectedLanguage = (
      validLangs.has(parsed.detectedLanguage)
        ? parsed.detectedLanguage
        : detectLanguageHeuristic(params.message)
    ) as 'Tamil' | 'Tanglish' | 'English';

    let draftRequest: UnifiedAgentResponse['draftRequest'] = null;
    let similarComplaints: SimilarComplaintMatch[] = [];

    if (parsed.readyToDraftRequest || intent === 'complaint_intake') {
      const matchedCategory =
        categories.find((c) => c.name.toLowerCase() === parsed.categoryName?.toLowerCase()) ||
        categories.find((c) => c.name === 'Other Civic Issues') ||
        categories[0];

      const matchedDept =
        departments.find((d) => d.name.toLowerCase() === parsed.departmentName?.toLowerCase()) ||
        departments.find((d) => d.id === matchedCategory.default_department_id) ||
        departments[0];

      const validPriorities = new Set(['Low', 'Medium', 'High', 'Urgent']);
      const priority = (
        validPriorities.has(parsed.suggestedPriority) ? parsed.suggestedPriority : 'Medium'
      ) as 'Low' | 'Medium' | 'High' | 'Urgent';

      const combinedUserText = [
        ...(params.conversationHistory || [])
          .filter((m) => m.role === 'user')
          .slice(-2)
          .map((m) => m.text),
        params.message.trim(),
      ].join(' ');

      similarComplaints = findSimilarComplaints({
        categoryId: matchedCategory.id,
        area: parsed.extractedArea || '',
        streetLandmark: parsed.extractedStreetLandmark || '',
        description: combinedUserText,
        summary: parsed.issueSummary || params.message,
      });

      draftRequest = {
        originalDescription: combinedUserText,
        issueSummary: parsed.issueSummary || params.message.trim(),
        language: detectedLanguage,
        categoryId: matchedCategory.id,
        categoryName: matchedCategory.name,
        departmentId: matchedDept.id,
        departmentName: matchedDept.name,
        departmentCode: matchedDept.code,
        officialChannel: matchedDept.official_channel,
        slaHours: matchedDept.sla_hours,
        routingExplanation:
          parsed.routingExplanation ||
          `Recommended ${matchedDept.name} for "${matchedCategory.name}".`,
        area: (parsed.extractedArea || '').trim(),
        streetLandmark: (parsed.extractedStreetLandmark || '').trim(),
        priority,
        priorityReason:
          parsed.priorityReason || 'Evaluated from civic safety and service impact.',
        missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
        followUpQuestion: (parsed.followUpQuestion || '').trim(),
      };
    }

    return {
      aiMode: 'gemini',
      modelUsed,
      aiNotice: `Live Gemini AI Agent (${modelUsed})`,
      intent,
      detectedLanguage,
      agentReply: parsed.agentReply,
      dataInsights: Array.isArray(parsed.dataInsights) ? parsed.dataInsights.slice(0, 5) : [],
      photoObservation: (parsed.photoObservation || '').trim(),
      readyToDraftRequest: Boolean(draftRequest),
      draftRequest,
      similarComplaints,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Upstream AI error';
    return buildUnifiedFallback({
      message: params.message,
      preferredLanguage: params.preferredLanguage || 'Auto-detect',
      snapshot,
      categories,
      departments,
      isDataQuery: isDataQueryHeuristic,
      isQuestion: isQuestionHeuristic,
      notice: `Gemini service temporarily unavailable (${errMsg.slice(0, 90)}). Switched transparently to live-database fallback.`,
    });
  }
}

function buildUnifiedFallback(params: {
  message: string;
  preferredLanguage: string;
  snapshot: CivicDatabaseSnapshot;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  isDataQuery: boolean;
  isQuestion: boolean;
  notice: string;
}): UnifiedAgentResponse {
  const { snapshot, categories, departments } = params;
  const detectedLanguage = detectLanguageHeuristic(params.message);

  if (params.isDataQuery) {
    const topArea = snapshot.byArea[0];
    const topCat = snapshot.byCategory[0];
    const busiestDept = snapshot.byDepartment[0];
    const insights = [
      `Total database records: ${snapshot.totals.total} complaints (${snapshot.totals.pending} pending, ${snapshot.totals.inProgress} in progress, ${snapshot.totals.resolved} resolved — ${snapshot.totals.resolutionRate}% resolution rate).`,
      topArea ? `Highest volume neighborhood: ${topArea.name} with ${topArea.count} complaints.` : 'No area concentration yet.',
      topCat ? `Most frequent issue category: ${topCat.name} (${topCat.count} filings).` : 'No category data yet.',
      busiestDept ? `Highest department workload: ${busiestDept.name} (${busiestDept.openCount || 0} open, SLA ${busiestDept.sla_hours}h).` : 'No department load yet.',
    ];
    return {
      aiMode: 'fallback',
      aiNotice: params.notice,
      intent: 'data_analysis',
      detectedLanguage,
      agentReply: `Here is the live analysis from CivicProof's database: there are currently ${snapshot.totals.total} registered complaints with a ${snapshot.totals.resolutionRate}% resolution rate. ${topArea ? `${topArea.name} leads in complaint volume (${topArea.count})` : ''} and ${topCat ? `${topCat.name} is the top reported issue.` : ''}`,
      dataInsights: insights,
      photoObservation: '',
      readyToDraftRequest: false,
      draftRequest: null,
      similarComplaints: [],
    };
  }

  const triage = runKeywordFallback({
    complaintText: params.message,
    preferredLanguage: params.preferredLanguage,
    areaHint: '',
    streetHint: '',
    categories,
    departments,
    notice: params.notice,
  });

  const dept =
    departments.find((d) => d.id === triage.departmentId) || departments[0];

  if (params.isQuestion && !/kuppai|pothole|broken|leak|overflow|dark|eriyala|clear pannala/i.test(params.message)) {
    return {
      aiMode: 'fallback',
      aiNotice: params.notice,
      intent: 'civic_question',
      detectedLanguage,
      agentReply: `CivicProof routes civic issues across ${departments.length} departments (such as ${dept.name}, SLA ${dept.sla_hours}h, official channel: ${dept.official_channel}). Describe any local issue in Tamil, Tanglish, or English and I will draft a government request for your confirmation.`,
      dataInsights: [],
      photoObservation: '',
      readyToDraftRequest: false,
      draftRequest: null,
      similarComplaints: [],
    };
  }

  return {
    aiMode: 'fallback',
    aiNotice: params.notice,
    intent: 'complaint_intake',
    detectedLanguage: triage.detectedLanguage,
    agentReply: triage.needsFollowUp
      ? `${triage.replyInPreferredLanguage} ${triage.followUpQuestion}`
      : triage.replyInPreferredLanguage,
    dataInsights: [],
    photoObservation: '',
    readyToDraftRequest: true,
    draftRequest: {
      originalDescription: params.message.trim(),
      issueSummary: triage.issueSummary,
      language: triage.detectedLanguage,
      categoryId: triage.categoryId,
      categoryName: triage.categoryName,
      departmentId: dept.id,
      departmentName: dept.name,
      departmentCode: dept.code,
      officialChannel: dept.official_channel,
      slaHours: dept.sla_hours,
      routingExplanation: triage.routingExplanation,
      area: triage.extractedArea,
      streetLandmark: triage.extractedStreetLandmark,
      priority: triage.suggestedPriority,
      priorityReason: triage.priorityReason,
      missingFields: triage.missingFields,
      followUpQuestion: triage.followUpQuestion,
    },
    similarComplaints: triage.similarComplaints,
  };
}

