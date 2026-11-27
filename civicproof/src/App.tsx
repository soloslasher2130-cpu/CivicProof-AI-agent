import { useCallback, useEffect, useState } from 'react';
import { AdminAuth } from './components/AdminAuth';
import { AdminPortal } from './components/AdminPortal';
import { AIAgentPage } from './components/AIAgentPage';
import { CitizenAuth } from './components/CitizenAuth';
import { CitizenPortal } from './components/CitizenPortal';
import { LandingPage } from './components/LandingPage';
import { apiRequest } from './lib/api';
import type { AppMeta, AuthSession, PublicStats, UserProfile } from './types';

type ActiveView = 'landing' | 'agent' | 'citizen' | 'admin';

export default function App() {
  const [view, setView] = useState<ActiveView>('landing');
  const [citizenInitialTab, setCitizenInitialTab] = useState<'dashboard' | 'report'>('dashboard');

  // Sessions held strictly in React memory (never localStorage/sessionStorage)
  const [citizenSession, setCitizenSession] = useState<AuthSession | null>(null);
  const [adminSession, setAdminSession] = useState<AuthSession | null>(null);

  const [meta, setMeta] = useState<AppMeta>({
    categories: [],
    departments: [],
    adminSetup: {
      hasEnvPasscode: false,
      hasClaimedAdmin: false,
      requiresFirstRunSetup: true,
    },
    aiConfigured: false,
  });
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);

  const loadMetaAndStats = useCallback(async () => {
    try {
      const [metaData, statsData] = await Promise.all([
        apiRequest<AppMeta>('/api/meta'),
        apiRequest<PublicStats>('/api/public/stats'),
      ]);
      setMeta(metaData);
      setPublicStats(statsData);
    } catch {
      // Keep graceful UI if server is restarting
    }
  }, []);

  useEffect(() => {
    loadMetaAndStats();
  }, [loadMetaAndStats]);

  function openReportFlow() {
    setCitizenInitialTab('report');
    setView('citizen');
  }

  function openCitizenDashboard() {
    setCitizenInitialTab('dashboard');
    setView('citizen');
  }

  function openAdminPortal() {
    loadMetaAndStats();
    setView('admin');
  }

  function openAIAgentPage() {
    loadMetaAndStats();
    setView('agent');
  }

  if (view === 'landing') {
    return (
      <LandingPage
        stats={publicStats}
        onReportIssue={openReportFlow}
        onOpenAIAgent={openAIAgentPage}
        onOpenCitizenPortal={openCitizenDashboard}
        onOpenAdminPortal={openAdminPortal}
      />
    );
  }

  if (view === 'agent') {
    return (
      <AIAgentPage
        categories={meta.categories}
        departments={meta.departments}
        citizenSession={citizenSession}
        onDataChanged={loadMetaAndStats}
        onGoHome={() => {
          loadMetaAndStats();
          setView('landing');
        }}
        onOpenCitizenPortal={openCitizenDashboard}
        onOpenAdminPortal={openAdminPortal}
      />
    );
  }

  if (view === 'citizen') {
    if (!citizenSession) {
      return (
        <CitizenAuth
          onSuccess={(session) => {
            setCitizenSession(session);
          }}
          onBackHome={() => {
            loadMetaAndStats();
            setView('landing');
          }}
          onSwitchToAdmin={openAdminPortal}
        />
      );
    }

    return (
      <CitizenPortal
        key={citizenInitialTab}
        session={citizenSession}
        categories={meta.categories}
        departments={meta.departments}
        initialTab={citizenInitialTab}
        onUpdateUser={(user: UserProfile) =>
          setCitizenSession((prev) => (prev ? { ...prev, user } : null))
        }
        onDataChanged={loadMetaAndStats}
        onLogout={() => {
          setCitizenSession(null);
          loadMetaAndStats();
          setView('landing');
        }}
        onGoHome={() => {
          loadMetaAndStats();
          setView('landing');
        }}
        onOpenAIAgent={openAIAgentPage}
        onSwitchToAdmin={openAdminPortal}
      />
    );
  }

  // Admin Portal View
  if (!adminSession) {
    return (
      <AdminAuth
        adminSetup={meta.adminSetup}
        onSuccess={(session) => {
          setAdminSession(session);
        }}
        onBackHome={() => {
          loadMetaAndStats();
          setView('landing');
        }}
        onSwitchToCitizen={openCitizenDashboard}
        onAdminClaimed={loadMetaAndStats}
      />
    );
  }

  return (
    <AdminPortal
      session={adminSession}
      categories={meta.categories}
      departments={meta.departments}
      onMetaRefresh={loadMetaAndStats}
      onDataChanged={loadMetaAndStats}
      onLogout={() => {
        setAdminSession(null);
        loadMetaAndStats();
        setView('landing');
      }}
      onGoHome={() => {
        loadMetaAndStats();
        setView('landing');
      }}
      onOpenAIAgent={openAIAgentPage}
      onSwitchToCitizen={openCitizenDashboard}
    />
  );
}
