"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

export default function Sidebar({ user, onSignOut }: { user: any, onSignOut: () => Promise<void> }) {
  const pathname = usePathname();

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', href: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: 'library', name: 'Tools Library', href: '/dashboard/library', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M14 6a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z' },
    { id: 'recent', name: 'Recent Files', href: '/dashboard/recent', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'documents', name: 'My Documents', href: '/dashboard/documents', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2z M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2' }
  ];

  const settingsItems = [
    { id: 'preferences', name: 'Preferences', href: '/dashboard/preferences', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'help', name: 'Help & Support', href: '/dashboard/help', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
  ];

  const handleSignOutClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onSignOut();
  };

  return (
    <aside className="w-64 bg-white rounded-2xl border border-[#eaedf3] shadow-[0_2px_12px_-3px_rgba(0,0,0,0.03)] flex flex-col justify-between p-5">
      <div>
        <div className="flex items-center gap-2 mb-8 px-1">
          <div className="w-8 h-8 bg-[#6366f1] rounded-lg flex items-center justify-center text-white font-bold text-lg">
            V
          </div>
          <span className="text-xl font-bold text-[#1f2937]">Vellum</span>
        </div>

        <nav className="space-y-1">
          <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2 px-2">Menu</p>
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`w-full h-10 px-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-[#eef2ff] text-[#4f46e5]' 
                    : 'text-[#4b5563] hover:bg-[#f3f4f6]'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.name}
              </Link>
            );
          })}

          <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mt-6 mb-2 px-2">Settings</p>
          {settingsItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`w-full h-10 px-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-[#eef2ff] text-[#4f46e5]' 
                    : 'text-[#4b5563] hover:bg-[#f3f4f6]'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Profile Card / Logout Container */}
      <div className="border-t border-[#eaedf3] pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#f3f4ff] flex items-center justify-center font-bold text-[#4f46e5] border border-[#e0e7ff] overflow-hidden relative">
            {user?.image ? (
              <Image 
                src={user.image} 
                alt="Profile" 
                fill 
                className="object-cover" 
                sizes="36px"
              />
            ) : (
              user?.name?.[0]?.toUpperCase() || 'U'
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold truncate max-w-[120px] text-[#111827]">{user?.name || 'User'}</span>
            <span className="text-[10px] font-semibold text-[#6b7280]">{user?.plan || 'Free'} Plan</span>
          </div>
        </div>
        <button 
          onClick={handleSignOutClick}
          className="p-2 rounded-xl text-[#ef4444] hover:bg-[#fef2f2] transition-colors"
          title="Sign Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
