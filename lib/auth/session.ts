import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export type UserRole = 'CITIZEN' | 'ADMIN' | 'DEPARTMENT';

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  municipalityId: string;
  municipalitySlug: string;
  municipalityName: string;
  departmentName?: string | null;
  preferredLang?: string;
}

export const SESSION_COOKIE_NAME = 'almeriacerca_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getJwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET || 'almeriacerca_jwt_secret_key_almeria_2026';
  return new TextEncoder().encode(raw);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.municipalityId !== 'string'
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      role: payload.role as UserRole,
      municipalityId: payload.municipalityId,
      municipalitySlug:
        typeof payload.municipalitySlug === 'string' ? payload.municipalitySlug : 'lucainena',
      municipalityName:
        typeof payload.municipalityName === 'string' ? payload.municipalityName : 'Almería',
      departmentName:
        typeof payload.departmentName === 'string' ? payload.departmentName : null,
      preferredLang:
        typeof payload.preferredLang === 'string' ? payload.preferredLang : 'es',
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const token = cookies().get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}
