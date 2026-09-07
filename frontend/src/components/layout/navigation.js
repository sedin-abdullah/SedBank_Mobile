/**
 * Navigation model for both portals.
 *
 * Each item declares the roles that may see it, so menu visibility and route
 * guards are driven from one place. The `key` becomes the testid suffix:
 * `sidebar-nav-{key}` on desktop and `mobile-nav-{key}` in the drawer.
 */
import {
  LayoutDashboard,
  FilePlus2,
  FileText,
  Wallet,
  Receipt,
  Calculator,
  UserCircle,
  ClipboardCheck,
  FileCheck2,
  Landmark,
  Users,
  Settings,
  ScrollText,
  PhoneCall,
} from 'lucide-react';
import { ROLES } from '../../lib/constants.js';

const ALL_STAFF = [ROLES.ADMIN, ROLES.CREDIT_OFFICER, ROLES.OPS_OFFICER, ROLES.COLLECTIONS_OFFICER];

export const CUSTOMER_NAV = [
  { key: 'dashboard', label: 'Dashboard', to: '/app', icon: LayoutDashboard, end: true },
  { key: 'apply-loan', label: 'Apply for a loan', to: '/app/apply', icon: FilePlus2 },
  { key: 'applications', label: 'My applications', to: '/app/applications', icon: FileText },
  { key: 'loans', label: 'My loans', to: '/app/loans', icon: Wallet },
  { key: 'payments', label: 'Payments', to: '/app/payments', icon: Receipt },
  { key: 'eligibility', label: 'Eligibility calculator', to: '/app/eligibility', icon: Calculator },
  { key: 'profile', label: 'Profile', to: '/app/profile', icon: UserCircle },
];

export const ADMIN_NAV = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    to: '/admin',
    icon: LayoutDashboard,
    end: true,
    roles: ALL_STAFF,
  },
  {
    key: 'applications',
    label: 'Applications',
    to: '/admin/applications',
    icon: ClipboardCheck,
    roles: [ROLES.ADMIN, ROLES.CREDIT_OFFICER, ROLES.OPS_OFFICER],
    group: 'Origination',
  },
  {
    key: 'documents',
    label: 'Document queue',
    to: '/admin/documents',
    icon: FileCheck2,
    roles: [ROLES.ADMIN, ROLES.OPS_OFFICER, ROLES.CREDIT_OFFICER],
    group: 'Origination',
  },
  {
    key: 'loans',
    label: 'Loan accounts',
    to: '/admin/loans',
    icon: Wallet,
    roles: [ROLES.ADMIN, ROLES.OPS_OFFICER, ROLES.COLLECTIONS_OFFICER],
    group: 'Servicing',
  },
  {
    key: 'collections',
    label: 'Collections',
    to: '/admin/collections',
    icon: PhoneCall,
    roles: [ROLES.ADMIN, ROLES.COLLECTIONS_OFFICER],
    group: 'Servicing',
  },
  {
    key: 'users',
    label: 'Users & roles',
    to: '/admin/users',
    icon: Users,
    roles: [ROLES.ADMIN],
    group: 'Administration',
  },
  {
    key: 'banks',
    label: 'Partner banks',
    to: '/admin/banks',
    icon: Landmark,
    roles: [ROLES.ADMIN],
    group: 'Administration',
  },
  {
    key: 'settings',
    label: 'Product & rules',
    to: '/admin/settings',
    icon: Settings,
    roles: [ROLES.ADMIN],
    group: 'Administration',
  },
  {
    key: 'audit',
    label: 'Audit trail',
    to: '/admin/audit',
    icon: ScrollText,
    roles: [ROLES.ADMIN],
    group: 'Administration',
  },
  {
    key: 'profile',
    label: 'Profile',
    to: '/admin/profile',
    icon: UserCircle,
    roles: ALL_STAFF,
    group: 'Administration',
  },
];

/** Nav items the given role may see, in declaration order. */
export function navForRole(role) {
  if (role === ROLES.CUSTOMER) return CUSTOMER_NAV;
  return ADMIN_NAV.filter((item) => !item.roles || item.roles.includes(role));
}

/** Groups a nav list into `[{ group, items }]`, preserving order. */
export function groupNav(items) {
  const groups = [];
  items.forEach((item) => {
    const name = item.group ?? '';
    const existing = groups.find((group) => group.group === name);
    if (existing) existing.items.push(item);
    else groups.push({ group: name, items: [item] });
  });
  return groups;
}

export default { CUSTOMER_NAV, ADMIN_NAV, navForRole, groupNav };

/**
 * The destinations that get a bottom tab on a phone.
 *
 * A bottom bar can hold four before the labels stop being readable, and the
 * fifth slot is always "More", which opens the same drawer that holds the
 * full role-filtered list. Everything remains reachable — the tabs are a
 * shortcut to the frequent screens, not a reduced feature set.
 */
const TAB_PRIORITY = {
  customer: ['dashboard', 'applications', 'loans', 'payments'],
  admin: ['dashboard', 'applications', 'documents', 'loans'],
  credit_officer: ['dashboard', 'applications', 'documents', 'loans'],
  ops_officer: ['dashboard', 'applications', 'documents', 'loans'],
  collections_officer: ['dashboard', 'collections', 'loans', 'profile'],
};

/** Up to four tab items for this role, in priority order, from its own nav. */
export function tabsForRole(role, items) {
  const wanted = TAB_PRIORITY[role] || TAB_PRIORITY.admin;
  const byKey = new Map(items.map((item) => [item.key, item]));
  const picked = wanted.map((key) => byKey.get(key)).filter(Boolean);

  // A role whose nav is shorter than the priority list falls back to its own
  // first few items, so the bar is never half-empty.
  if (picked.length < 4) {
    for (const item of items) {
      if (picked.length >= 4) break;
      if (!picked.includes(item)) picked.push(item);
    }
  }
  return picked.slice(0, 4);
}
