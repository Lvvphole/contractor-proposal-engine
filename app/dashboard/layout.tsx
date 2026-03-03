import { UserButton } from '@clerk/nextjs';
import { NavLink } from './_components/nav-link';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/quotes', label: 'Quotes' },
  { href: '/dashboard/proposals', label: 'Proposals' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r flex flex-col shrink-0">
        <div className="px-4 py-3 border-b">
          <span className="text-sm font-semibold text-gray-800">Proposal Engine</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label }) => (
            <NavLink key={href} href={href} label={label} />
          ))}
        </nav>
        <div className="p-4 border-t">
          <UserButton afterSignOutUrl="/" />
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
