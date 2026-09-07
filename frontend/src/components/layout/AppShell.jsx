/**
 * Application shell: persistent left sidebar + top bar, shared by both portals.
 *
 * Responsive behaviour:
 *  - >= lg : the sidebar is always visible and can be collapsed to icons.
 *  - <  lg : the sidebar is hidden and a hamburger opens a drawer instead.
 *
 * The drawer is a genuinely different DOM node from the desktop sidebar, so its
 * items carry `mobile-nav-{key}` while the desktop ones carry `sidebar-nav-{key}`
 * — the one documented exception to the "same testid everywhere" rule.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  UserCircle,
  ChevronDown,
  Wifi,
  WifiOff,
  MoreHorizontal,
  ChevronLeft,
} from 'lucide-react';
import { TESTIDS, navId, tabId } from '@shared/testIds.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { ROLE_LABELS, ROLES } from '../../lib/constants.js';
import { initials } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import { pushBackHandler } from '../../lib/backHandler.js';
import { navForRole, groupNav, tabsForRole } from './navigation.js';
import NotificationBell from './NotificationBell.jsx';

function Brand({ collapsed = false }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-white shadow-glow-brand">
        S
      </span>
      {!collapsed ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">SedBank</span>
          <span className="block truncate text-[10px] uppercase tracking-wider text-slate-400">
            Digital Lending
          </span>
        </span>
      ) : null}
    </div>
  );
}

function NavItems({ items, mobile = false, collapsed = false, onNavigate }) {
  const groups = groupNav(items);

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scrollbar-thin">
      {groups.map(({ group, items: groupItems }) => (
        <div key={group || 'root'}>
          {group && !collapsed ? (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </p>
          ) : null}

          <ul className="space-y-0.5">
            {groupItems.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  data-testid={navId(item.key, mobile)}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                      collapsed && 'justify-center px-2',
                      isActive
                        ? 'bg-gold-gradient text-ink shadow-glow-gold'
                        : 'text-slate-500 hover:bg-white/[0.07] hover:text-slate-900'
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function PortalFooter({ user, collapsed }) {
  if (collapsed) return null;
  return (
    <div className="border-t border-white/10 px-4 py-3">
      <p className="text-[11px] text-slate-400">
        Signed in as <span className="font-medium text-slate-900">{ROLE_LABELS[user.role]}</span>
      </p>
      {user.isDemo ? (
        <p className="mt-1 inline-flex rounded bg-warning-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning-500">
          DEMO ACCOUNT
        </p>
      ) : null}
    </div>
  );
}

/**
 * Bottom tab bar, phones only.
 *
 * A shrunken desktop sidebar is not a mobile nav: the targets end up small
 * and at the top of a screen held at the bottom. Four frequent destinations
 * live here at 56px tall, thumb-height, and "More" opens the drawer with the
 * complete role-filtered list — so nothing is unreachable.
 */
function TabBar({ items, role, onMore }) {
  const tabs = tabsForRole(role, items);

  return (
    <nav
      data-testid={TESTIDS.shell.tabBar}
      aria-label="Primary"
      className="tabbar fixed inset-x-0 bottom-0 z-40 flex lg:hidden"
    >
      {tabs.map((item) => (
        <NavLink
          key={item.key}
          to={item.to}
          end={item.end}
          data-testid={tabId(item.key)}
          className={({ isActive }) =>
            cn(
              // 56px tall: comfortably past the 44px minimum touch target.
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'text-gold-400' : 'text-slate-500 active:text-slate-800'
            )
          }
        >
          <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          {/*
            `tabLabel`, not the first word of `label`: "My applications" and
            "My loans" both reduced to "My", giving two tabs a person could
            not tell apart — and nothing for automation to address either.
          */}
          <span className="max-w-full truncate">{item.tabLabel || item.label}</span>
        </NavLink>
      ))}

      <button
        type="button"
        onClick={onMore}
        data-testid={TESTIDS.shell.tabMore}
        aria-label="More navigation"
        className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium text-slate-500 transition-colors active:text-slate-800"
      >
        <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}

export default function AppShell({ portal }) {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sedbank.sidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  const items = navForRole(user?.role);
  const profilePath = portal === 'admin' ? '/admin/profile' : '/app/profile';

  /*
   * A nav destination is a root; anything else was reached from one and needs
   * a way back. Comparing against the nav rather than counting path segments
   * keeps this correct as routes are added.
   */
  const isSubPage = !items.some((item) => item.to === location.pathname);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  /*
   * Android's back gesture should close the drawer, not leave the app. The
   * handler is only registered while it is open, so back falls through to
   * history the rest of the time.
   */
  useEffect(() => {
    if (!drawerOpen) return undefined;
    return pushBackHandler(() => setDrawerOpen(false));
  }, [drawerOpen]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem('sedbank.sidebarCollapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div data-testid={TESTIDS.shell.root} className="relative min-h-screen">
      {/* Depth: two large, very soft gradient orbs drifting behind all content. */}
      {/*
        Ambient glow layer. Sits above the flat base and BELOW the glass
        panels, so their backdrop-filter has something to pick up — a blur
        over a single flat colour looks like no blur at all.

        `-z-10` is deliberate: the main content is not positioned, so a
        `z-0` layer would paint on top of it. A negative index puts this
        behind the content while staying above the body background.
      */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="orb orb-wine -left-28 top-[-12rem] h-[44rem] w-[44rem] animate-drift" />
        <div
          className="orb orb-rose right-[4%] top-[12%] h-[36rem] w-[36rem] animate-drift-slow"
          style={{ animationDelay: '-14s' }}
        />
        <div
          className="orb orb-gold bottom-[-12rem] left-[28%] h-[32rem] w-[32rem] animate-drift"
          style={{ animationDelay: '-26s' }}
        />
      </div>
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        data-testid={TESTIDS.shell.sidebar}
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.08] bg-white/[0.06] backdrop-blur-heavy lg:flex',
          collapsed ? 'w-[72px]' : 'w-64'
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center border-b border-white/10 px-4',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          <Brand collapsed={collapsed} />
          {!collapsed ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              data-testid={TESTIDS.shell.sidebarToggle}
              aria-label="Collapse sidebar"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-900"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid={TESTIDS.shell.sidebarToggle}
            aria-label="Expand sidebar"
            className="mx-auto mt-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-900"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : null}

        <NavItems items={items} collapsed={collapsed} />
        <PortalFooter user={user} collapsed={collapsed} />
      </aside>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-canvas-deep/70 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            data-testid={TESTIDS.shell.mobileNavDrawer}
            className="safe-top safe-bottom absolute inset-y-0 left-0 flex w-[min(84vw,17rem)] flex-col border-r border-white/10 bg-canvas-raised/90 shadow-panel backdrop-blur-heavy"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                data-testid={TESTIDS.shell.mobileNavClose}
                aria-label="Close navigation menu"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <NavItems items={items} mobile onNavigate={() => setDrawerOpen(false)} />
            <PortalFooter user={user} collapsed={false} />
          </aside>
        </div>
      ) : null}

      {/* ---------------- Main column ---------------- */}
      <div className={cn('flex min-h-screen flex-col', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header
          data-testid={TESTIDS.shell.topbar}
          className="safe-top safe-x sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-white/[0.08] bg-white/[0.06] px-4 backdrop-blur-heavy sm:px-6"
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            data-testid={TESTIDS.shell.mobileNavOpen}
            aria-label="Open navigation menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/10 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/*
            * A phone has no persistent sidebar to orient you, so sub-pages
            * need a way back that does not depend on knowing the hardware
            * gesture. Shown only where there is somewhere to go: the tab
            * destinations are roots.
            */}
          {isSubPage ? (
            <button
              type="button"
              onClick={() => navigate(-1)}
              data-testid={TESTIDS.shell.back}
              aria-label="Go back"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/10 lg:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}

          <div className="lg:hidden">
            <span className="text-sm font-semibold text-slate-900">SedBank</span>
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {/* Live-connection indicator: proves the realtime channel is up. */}
            <span
              data-testid={TESTIDS.shell.connectionStatus}
              data-connected={connected ? 'true' : 'false'}
              title={connected ? 'Live updates connected' : 'Live updates reconnecting…'}
              className={cn(
                'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:flex',
                connected
                  ? 'bg-success-500/15 text-success-500 ring-1 ring-inset ring-success-500/25'
                  : 'bg-white/[0.07] text-slate-500 ring-1 ring-inset ring-white/10'
              )}
            >
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? 'Live' : 'Offline'}
            </span>

            <NotificationBell />

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  data-testid={TESTIDS.shell.profileMenu}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-white/10"
                  aria-label="Account menu"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-xs font-semibold text-brand-300 ring-1 ring-inset ring-brand-500/25">
                    {initials(user?.name)}
                  </span>
                  <span className="hidden min-w-0 text-left sm:block">
                    <span
                      data-testid={TESTIDS.shell.profileName}
                      className="block max-w-[140px] truncate text-sm font-medium text-slate-900"
                    >
                      {user?.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {ROLE_LABELS[user?.role] ?? user?.role}
                    </span>
                  </span>
                  <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 w-56 animate-slide-up overflow-hidden rounded-card border border-white/10 bg-canvas-raised/95 p-1 shadow-panel backdrop-blur-heavy"
                >
                  <div className="border-b border-white/10 px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  </div>

                  <DropdownMenu.Item asChild>
                    <button
                      type="button"
                      data-testid={TESTIDS.shell.profileLink}
                      onClick={() => navigate(profilePath)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none transition data-[highlighted]:bg-white/10"
                    >
                      <UserCircle className="h-4 w-4" />
                      My profile
                    </button>
                  </DropdownMenu.Item>

                  <DropdownMenu.Item asChild>
                    <button
                      type="button"
                      data-testid={TESTIDS.shell.logout}
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger-500 outline-none transition data-[highlighted]:bg-danger-500/15"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main className="safe-x flex-1 px-4 py-6 pb-[calc(var(--tabbar-height)+var(--safe-bottom)+1rem)] sm:px-6 sm:py-8 lg:px-10 lg:pb-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>

        <TabBar items={items} role={user?.role} onMore={() => setDrawerOpen(true)} />

        <footer className="safe-x border-t border-white/10 px-4 py-4 text-center text-[11px] text-slate-500 lg:pb-4">
          SedBank is a demonstration platform. All integrations are simulated and no real financial
          data is processed.
        </footer>
      </div>
    </div>
  );
}

/** Page header used at the top of every screen inside the shell. */
export function PageHeader({ title, subtitle, actions, breadcrumb, className }) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb ? (
          <div data-testid={TESTIDS.shell.breadcrumb} className="mb-1 text-xs text-slate-500">
            {breadcrumb}
          </div>
        ) : null}
        <h1
          data-testid={TESTIDS.shell.pageTitle}
          className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl"
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { ROLES };
