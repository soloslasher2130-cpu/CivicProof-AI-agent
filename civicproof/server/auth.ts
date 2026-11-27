import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

// Session signing secret: reads process.env.SESSION_SECRET with an in-memory random fallback
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  ward: string;
  preferred_language: string;
  role: 'citizen' | 'admin';
  is_demo: number;
  created_at: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function timingSafeStringMatch(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

interface TokenPayload {
  uid: number;
  role: 'citizen' | 'admin';
  exp: number;
}

export function createAuthToken(userId: number, role: 'citizen' | 'admin'): string {
  const payload: TokenPayload = {
    uid: userId,
    role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  if (!timingSafeStringMatch(providedSig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!parsed || typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    if (parsed.role !== 'citizen' && parsed.role !== 'admin') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getEnvAdminPasscode(): string {
  return (process.env.ADMIN_PASSCODE || '').trim();
}

export function getAdminSetupState(): {
  hasEnvPasscode: boolean;
  hasClaimedAdmin: boolean;
  requiresFirstRunSetup: boolean;
} {
  const hasEnvPasscode = getEnvAdminPasscode().length > 0;
  const adminRow = db
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { id: number } | undefined;
  const hasClaimedAdmin = Boolean(adminRow);
  return {
    hasEnvPasscode,
    hasClaimedAdmin,
    requiresFirstRunSetup: !hasEnvPasscode && !hasClaimedAdmin,
  };
}

export function getUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      `SELECT id, name, email, phone, ward, preferred_language, role, is_demo, created_at
       FROM users WHERE id = ?`
    )
    .get(userId) as AuthUser | undefined;
  return row ?? null;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  const user = getUserById(payload.uid);
  if (!user || user.role !== payload.role) {
    res.status(401).json({ error: 'Account session is no longer valid.' });
    return;
  }
  req.user = user;
  next();
}

export function requireCitizen(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'citizen') {
      res.status(403).json({ error: 'Citizen portal access is restricted to citizen accounts.' });
      return;
    }
    next();
  });
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator privileges are required for this action.' });
      return;
    }
    next();
  });
}
