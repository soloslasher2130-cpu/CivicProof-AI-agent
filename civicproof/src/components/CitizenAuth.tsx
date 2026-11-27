import { useState } from 'react';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthSession, SupportedLanguage } from '../types';
import { CivicLogoMark } from './StatusIndicator';

interface CitizenAuthProps {
  onSuccess: (session: AuthSession) => void;
  onBackHome: () => void;
  onSwitchToAdmin: () => void;
}

export function CitizenAuth({
  onSuccess,
  onBackHome,
  onSwitchToAdmin,
}: CitizenAuthProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [ward, setWard] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>('Tanglish');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const session = await apiRequest<AuthSession>('/api/auth/login', {
          method: 'POST',
          body: { email, password, role: 'citizen' },
        });
        onSuccess(session);
      } else {
        const session = await apiRequest<AuthSession>('/api/auth/register', {
          method: 'POST',
          body: { name, email, password, phone, ward, preferredLanguage },
        });
        onSuccess(session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoCitizenLogin() {
    setError('');
    setLoading(true);
    try {
      const session = await apiRequest<AuthSession>('/api/auth/demo-citizen', {
        method: 'POST',
      });
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start demo citizen session.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <button type="button" onClick={onBackHome} className="cursor-pointer">
            <CivicLogoMark />
          </button>
          <div className="flex items-center gap-5 text-sm">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 whitespace-nowrap cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to Home</span>
            </button>
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="text-slate-600 hover:text-[#0F2D5C] font-medium whitespace-nowrap cursor-pointer"
            >
              Admin Portal
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Context & Hackathon Demo Shortcut */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <p className="text-xs font-medium text-blue-800">Citizen Service Portal</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-slate-950 tracking-tight">
              Your neighborhood issues, documented and tracked.
            </h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Sign in or register a citizen account to file complaints in Tamil, Tanglish, or
              English, check duplicate neighborhood issues, and follow every department update.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <UserCheck className="w-4 h-4 text-blue-700" aria-hidden="true" />
              <span>Hackathon Demo Citizen Access</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Evaluating CivicProof? Launch the pre-seeded Demo Citizen account{' '}
              <span className="font-mono text-slate-800">Ananya Krishnan</span> (Ward 172 - Adyar)
              with existing sample complaints across multiple statuses.
            </p>
            <button
              type="button"
              onClick={handleDemoCitizenLogin}
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-[#0F2D5C] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
            >
              Continue as Demo Citizen (Ananya Krishnan)
            </button>
          </div>
        </div>

        {/* Right Login / Registration Form */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Citizen Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-5 p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="citizen-name" className="block text-sm font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="citizen-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya Venkatesh"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
                />
              </div>
            )}

            <div>
              <label htmlFor="citizen-email" className="block text-sm font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <input
                id="citizen-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="citizen-password" className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="citizen-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter your password'}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
              />
            </div>

            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="citizen-phone" className="block text-sm font-medium text-slate-700 mb-1">
                    Phone (Optional)
                  </label>
                  <input
                    id="citizen-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98400..."
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="citizen-ward" className="block text-sm font-medium text-slate-700 mb-1">
                    Area / Ward
                  </label>
                  <input
                    id="citizen-ward"
                    type="text"
                    value={ward}
                    onChange={(e) => setWard(e.target.value)}
                    placeholder="e.g. Adyar"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="citizen-lang" className="block text-sm font-medium text-slate-700 mb-1">
                    Preferred Language
                  </label>
                  <select
                    id="citizen-lang"
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value as SupportedLanguage)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-700"
                  >
                    <option value="Tanglish">Tanglish</option>
                    <option value="Tamil">Tamil (தமிழ்)</option>
                    <option value="English">English</option>
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#0F2D5C] hover:bg-blue-900 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                ? 'Sign In to Citizen Portal'
                : 'Register Citizen Account'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
