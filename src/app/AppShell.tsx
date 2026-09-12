import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, Boxes, ClipboardPlus, HardHat, LayoutDashboard, LogOut, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { SyncPill } from '@/components/SyncPill';
import { Button } from '@/components/ui/button';
import { roleLabels } from '@/lib/labels';
import { cn, initials } from '@/lib/utils';
import { getSyncManager, appMode } from '@/data/repository';
import { setOfflineMode } from '@/data/repository';
import { useMyNotifications } from '@/data/queries';

function NavItem({ to, icon, label, badge, className }: { to: string; icon: React.ReactNode; label: string; badge?: number; className?: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'tap-target flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[13px] font-semibold no-underline md:flex-row md:gap-3 md:px-4 md:text-base',
          isActive ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-200/60',
          className
        )
      }
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-700 px-1 text-[10px] font-bold text-white" aria-label={`${badge} nieprzeczytane`}>
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isWorker = profile?.role === 'WORKER';
  const isManager = !isWorker;
  const notifications = useMyNotifications(profile?.id ?? null);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;

  if (!profile) return null;

  return (
    <div className="min-h-dvh">
      <a href="#tresc" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold">
        Przejdź do treści
      </a>
      <header className="app-header sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print-hide">
        <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-3 py-2 md:px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white" aria-hidden="true">
              <HardHat className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="m-0 text-base font-extrabold tracking-tight">Taskans</p>
              <p className="m-0 hidden text-xs text-slate-500 sm:block">dziennik zleceń</p>
            </div>
          </div>
          <nav aria-label="Główna nawigacja" className="mx-4 hidden flex-1 items-center gap-1 md:flex">
            {isManager ? <NavItem to="/pulpit" icon={<LayoutDashboard className="h-5 w-5" />} label="Pulpit" /> : null}
            <NavItem to="/moja-praca" icon={<ClipboardPlus className="h-5 w-5" />} label="Moja praca" />
            <NavItem to="/zespol" icon={<Boxes className="h-5 w-5" />} label="Tablica zespołu" />
            {isManager ? <NavItem to="/raporty" icon={<HardHat className="h-5 w-5" />} label="Raporty" /> : null}
            <NavItem to="/powiadomienia" icon={<Bell className="h-5 w-5" />} label="Powiadomienia" badge={unread} />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill />
            {appMode() === 'demo' ? (
              <DemoOfflineToggle />
            ) : null}
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 md:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-700" aria-hidden="true">
                {initials(profile.display_name)}
              </span>
              <span className="text-sm leading-tight">
                <span className="block font-bold">{profile.display_name}</span>
                <span className="block text-slate-600">{roleLabels[profile.role]}</span>
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Wyloguj"
              onClick={() => {
                void signOut().then(() => navigate('/login'));
              }}
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-screen-xl gap-6 px-3 pb-24 pt-4 md:px-6 md:pb-10">
        <aside className="hidden w-60 shrink-0 flex-col gap-1 md:flex">
          {isManager ? (
            <NavItem className="md:justify-start" to="/pulpit" icon={<LayoutDashboard className="h-5 w-5" />} label="Pulpit" />
          ) : null}
          <NavItem className="md:justify-start" to="/moja-praca" icon={<ClipboardPlus className="h-5 w-5" />} label="Moja praca" />
          <NavItem className="md:justify-start" to="/zespol" icon={<Boxes className="h-5 w-5" />} label="Tablica zespołu" />
          <NavItem className="md:justify-start" to="/praca-bez-zlecenia" icon={<HardHat className="h-5 w-5" />} label="Dodaj wykonaną pracę" />
          {isManager ? <NavItem className="md:justify-start" to="/raporty" icon={<UserRound className="h-5 w-5" />} label="Raporty" /> : null}
          <NavItem className="md:justify-start" to="/powiadomienia" icon={<Bell className="h-5 w-5" />} label="Powiadomienia" badge={unread} />
          <NavItem className="md:justify-start" to="/ustawienia" icon={<Settings className="h-5 w-5" />} label="Ustawienia" />
        </aside>
        <main id="tresc" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Nawigacja dolna"
        className="app-footer fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden print-hide"
      >
        {isManager ? <NavItem to="/pulpit" icon={<LayoutDashboard className="h-5 w-5" />} label="Pulpit" /> : <NavItem to="/moja-praca" icon={<ClipboardPlus className="h-5 w-5" />} label="Moja praca" />}
        <NavItem to="/zespol" icon={<Boxes className="h-5 w-5" />} label="Zespół" />
        <NavItem to="/zlecenia/nowe" icon={<ClipboardPlus className="h-5 w-5" />} label="Nowe" />
        <NavItem to="/powiadomienia" icon={<Bell className="h-5 w-5" />} label="Dzwonek" badge={unread} />
        <NavItem to="/ustawienia" icon={<Settings className="h-5 w-5" />} label="Ustawienia" />
      </nav>
    </div>
  );
}

/** Przełącznik symulacji offline w trybie demo (do nauki obsługi i do testów E2E). */
function DemoOfflineToggle() {
  const mgr = getSyncManager();
  const offline = !mgr.online;
  return (
    <Button
      variant={offline ? 'destructive' : 'ghost'}
      size="sm"
      onClick={() => void setOfflineMode(!offline)}
      aria-pressed={offline}
      title="Symulacja pracy offline (tylko tryb demo)"
    >
      {offline ? 'Tryb offline' : 'Połączono'}
    </Button>
  );
}
