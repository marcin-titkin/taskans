import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/app/AppShell';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MyWorkPage } from '@/features/mywork/MyWorkPage';
import { TeamBoardPage } from '@/features/board/TeamBoardPage';
import { NewWorkOrderPage } from '@/features/workorders/NewWorkOrderPage';
import { UnrequestedWorkPage } from '@/features/workorders/UnrequestedWorkPage';
import { TaskDetailPage } from '@/features/workorders/TaskDetailPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { ReportDayPage } from '@/features/reports/ReportDayPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { SyncPage } from '@/features/sync/SyncPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { EmptyState } from '@/components/EmptyState';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p role="status" className="text-lg text-slate-600">
          Wczytywanie aplikacji…
        </p>
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RequireManager({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role === 'WORKER') {
    return (
      <EmptyState
        title="Brak uprawnień"
        description="Ten ekran jest przeznaczony dla dyrektora i koordynatora. Powrót do listy zadań: „Moja praca”."
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route
            path="/"
            element={
              <RoleHome />
            }
          />
          <Route path="/pulpit" element={<RequireManager><DashboardPage /></RequireManager>} />
          <Route path="/moja-praca" element={<MyWorkPage />} />
          <Route path="/zespol" element={<TeamBoardPage />} />
          <Route path="/zlecenia/nowe" element={<NewWorkOrderPage />} />
          <Route path="/zlecenia/:id" element={<TaskDetailPage />} />
          <Route path="/praca-bez-zlecenia" element={<UnrequestedWorkPage />} />
          <Route path="/raporty" element={<RequireManager><ReportsPage /></RequireManager>} />
          <Route path="/raporty/:date" element={<RequireManager><ReportDayPage /></RequireManager>} />
          <Route path="/powiadomienia" element={<NotificationsPage />} />
          <Route path="/synchronizacja" element={<SyncPage />} />
          <Route path="/ustawienia/*" element={<SettingsPage />} />
          <Route path="*" element={<EmptyState title="Nie znaleziono strony" description="Sprawdź adres lub wróć na ekran główny." />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function RoleHome() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <Navigate to={profile.role === 'WORKER' ? '/moja-praca' : '/pulpit'} replace />;
}
