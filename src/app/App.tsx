import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/app/AppShell';
import { EmptyState } from '@/components/EmptyState';

/*
 * Trasy ładowane leniwie: ekran startowy (login) i powłoka pozostają w bundlu
 * initial, a każdy ekran idzie jako osobny chunk — pierwszy upload PWA jest
 * mały, a ekran, na który wchodzi użytkownik, doładowuje się w <50 ms z
 * precache'a service workera.
 */
function page<T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T & string): ComponentType {
  return lazy(async () => {
    const m = await loader();
    return { default: m[name] as ComponentType };
  });
}

const DashboardPage = page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const MyWorkPage = page(() => import('@/features/mywork/MyWorkPage'), 'MyWorkPage');
const TeamBoardPage = page(() => import('@/features/board/TeamBoardPage'), 'TeamBoardPage');
const NewWorkOrderPage = page(() => import('@/features/workorders/NewWorkOrderPage'), 'NewWorkOrderPage');
const UnrequestedWorkPage = page(() => import('@/features/workorders/UnrequestedWorkPage'), 'UnrequestedWorkPage');
const TaskDetailPage = page(() => import('@/features/workorders/TaskDetailPage'), 'TaskDetailPage');
const ReportsPage = page(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const ReportDayPage = page(() => import('@/features/reports/ReportDayPage'), 'ReportDayPage');
const NotificationsPage = page(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const SyncPage = page(() => import('@/features/sync/SyncPage'), 'SyncPage');
const SettingsPage = page(() => import('@/features/admin/SettingsPage'), 'SettingsPage');

function PageFallback() {
  return (
    <div className="grid min-h-[30vh] place-items-center">
      <p role="status" className="text-slate-600">
        Wczytywanie ekranu…
      </p>
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

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
          <Route path="/pulpit" element={<RequireManager><P><DashboardPage /></P></RequireManager>} />
          <Route path="/moja-praca" element={<P><MyWorkPage /></P>} />
          <Route path="/zespol" element={<P><TeamBoardPage /></P>} />
          <Route path="/zlecenia/nowe" element={<P><NewWorkOrderPage /></P>} />
          <Route path="/zlecenia/:id" element={<P><TaskDetailPage /></P>} />
          <Route path="/praca-bez-zlecenia" element={<P><UnrequestedWorkPage /></P>} />
          <Route path="/raporty" element={<RequireManager><P><ReportsPage /></P></RequireManager>} />
          <Route path="/raporty/:date" element={<RequireManager><P><ReportDayPage /></P></RequireManager>} />
          <Route path="/powiadomienia" element={<P><NotificationsPage /></P>} />
          <Route path="/synchronizacja" element={<P><SyncPage /></P>} />
          <Route path="/ustawienia/*" element={<P><SettingsPage /></P>} />
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
