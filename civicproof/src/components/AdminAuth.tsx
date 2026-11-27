import { useState } from 'react';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AdminSetupState, AuthSession } from '../types';
import { CivicLogoMark } from './StatusIndicator';

interface AdminAuthProps {
  adminSetup: AdminSetupState;
  onSuccess: (session: AuthSession) => void;
  onBackHome: () => void;
  onSwitchToCitizen: () => void;
  onAdminClaimed: () => void;
}

export function AdminAuth({
  adminSetup,
  onSuccess,
  onBackHome,
  onSwitchToCitizen,
  onAdminClaimed,
}: AdminAuthProps) {
  const [name, setName] = useState('Municipal Operations Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleFirstRunClaim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await apiRequest<AuthSession>('/api/auth/admin/claim', {
        method: 'POST',
        body: { name, email, password },
      });
      onAdminClaimed();
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to claim administrator account.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await apiRequest<AuthSession>('/api/auth/admin/login', {
        method: 'POST',
        body: adminSetup.hasEnvPasscode ? { passcode } : { email, password },
      });
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Administrator sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <button type="button" onClick={onBackHome} className="cursor-pointer">
            <CivicLogoMark light />
          </button>
          <div className="flex items-center gap-5 text-sm">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to Home</span>
            </button>
            <button
              type="button"
              onClick={onSwitchToCitizen}
              className="text-slate-300 hover:text-white font-medium whitespace-nowrap cursor-pointer"
            >
              Citizen Portal
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 py-12 flex flex-col justify-center">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-medium mb-2">
            {adminSetup.requiresFirstRunSetup ? (
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Lock className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Role-Protected Municipal Operations Console</span>
          </div>

          {adminSetup.requiresFirstRunSetup ? (
            <>
              <h1 className="font-display text-2xl font-bold text-white tracking-tight">
                First-Run Admin Setup
              </h1>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                No administrator credential is configured yet. Create the initial Admin account
                below (stored securely with scrypt password hashing). Once claimed, this setup route
                locks automatically.
              </p>

              {error && (
                <div className="mt-4 p-3 text-sm text-red-200 bg-red-950/60 border border-red-800 rounded-lg">
                  {error}
                </div>
              )}

              <form onSubmit={handleFirstRunClaim} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="admin-claim-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Administrator Name
                  </label>
                  <input
                    id="admin-claim-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="admin-claim-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Administrator Email
                  </label>
                  <input
                    id="admin-claim-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@city.gov.in"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="admin-claim-password" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Set Administrator Password (min. 8 characters)
                  </label>
                  <input
                    id="admin-claim-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Choose a strong password"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {loading ? 'Creating Admin Account...' : 'Claim Admin Console & Sign In'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-white tracking-tight">
                Administrator Sign In
              </h1>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                {adminSetup.hasEnvPasscode
                  ? 'Enter the configured server administrator passcode to manage civic complaints and analytics.'
                  : 'Sign in with your administrator email and password. Citizen accounts cannot access this portal.'}
              </p>

              {error && (
                <div className="mt-4 p-3 text-sm text-red-200 bg-red-950/60 border border-red-800 rounded-lg">
                  {error}
                </div>
              )}

              <form onSubmit={handleAdminLogin} className="mt-6 space-y-4">
                {adminSetup.hasEnvPasscode ? (
                  <div>
                    <label htmlFor="admin-passcode" className="block text-xs font-medium text-slate-300 mb-1.5">
                      Administrator Passcode
                    </label>
                    <input
                      id="admin-passcode"
                      type="password"
                      required
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter server admin passcode"
                      className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label htmlFor="admin-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Administrator Email
                      </label>
                      <input
                        id="admin-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@city.gov.in"
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="admin-password" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Password
                      </label>
                      <input
                        id="admin-password"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter administrator password"
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-950 text-white border border-slate-700 rounded-lg focus:border-blue-500"
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Sign In to Admin Console'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
