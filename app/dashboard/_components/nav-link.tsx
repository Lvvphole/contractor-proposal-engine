'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`block px-3 py-2 rounded-md text-sm ${
        active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  );
}
