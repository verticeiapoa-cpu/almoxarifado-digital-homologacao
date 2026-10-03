import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Package, History, LogOut, Users, Shield, Building2, UserCog, Home, Menu, HardHat, BellRing, UserRoundCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '../lib/AuthContext';

// Helper for tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Layout() {
  const location = useLocation();
  const { user, profile, isAdmin, userObras, activeObraId, setActiveObraId, signOut, accessError, refreshProfile } = useAuth();
  
  const responsibleName = profile?.name || user?.displayName || user?.email || "Responsável";
  const roleLabel = isAdmin ? "Administrador" : "Almoxarife";
  const firstName = responsibleName.split(' ')[0];

  const navItems = [
    { path: '/', label: 'Início', icon: Home },
    { path: '/delivery', label: 'Entregar EPI', icon: HardHat },
    { path: '/history', label: 'Histórico', icon: History },
    { path: '/employees', label: 'Funcionários', icon: Users },
    { path: '/materials', label: 'Estoque', icon: Shield },
    ...(isAdmin ? [
      { path: '/obras', label: 'Obras', icon: Building2 },
      { path: '/users', label: 'Almoxarifes', icon: UserCog },
      { path: '/settings/stock-alerts', label: 'Alertas', icon: BellRing },
    ] : []),
  ];

  const mobileNavItems = [
    { path: '/', label: 'Início', icon: Home },
    { path: '/delivery', label: 'Entregar', icon: Package },
    { path: '/history', label: 'Histórico', icon: History },
    { path: '/employees', label: 'Pessoas', icon: Users },
    { path: '/more', label: 'Mais', icon: Menu },
  ];

  return (
    <div className="app-shell min-h-screen flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="brand-header relative z-20">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center text-[#24bfd0]">
              <svg viewBox="0 0 32 24" className="w-10 h-8" fill="currentColor">
                <path d="M 2 4 L 11 20 L 16 13 L 21 20 L 30 4 L 25 4 L 19 14 L 16 10 L 13 14 L 7 4 Z" />
              </svg>
            </div>
            <div className="hidden sm:block">
              <h1 className="font-black text-xl tracking-wide text-white leading-none">
                WSELENT
              </h1>
              <span className="text-[9px] uppercase font-bold text-cyan-200 tracking-[0.22em]">
                Pessoas seguras
              </span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return <Link key={item.path} to={item.path} className={cn('desktop-nav-link', isActive && 'desktop-nav-link-active')}><Icon />{item.label}</Link>;
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end"><span className="text-sm font-semibold text-white">{responsibleName}</span><span className="text-[10px] uppercase text-cyan-200">{roleLabel}</span></div>
            <div className="user-avatar">{firstName.slice(0, 2).toUpperCase()}</div>
            <button onClick={signOut} className="header-exit" title="Sair da Conta"><LogOut /></button>
          </div>
          </div>

          <div className="mobile-greeting lg:hidden"><strong>Olá, {firstName}!</strong><span>Segurança em primeiro lugar.</span></div>

          <div className="work-switcher-wrap">
            {isAdmin || userObras.length > 1 ? (
              <div className="work-switcher">
                <Building2 className="w-6 h-6 text-[#0d9fb6] shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="text-[9px] uppercase font-bold text-slate-500 leading-none">Obra atual</span>
                  <select
                    value={activeObraId}
                    onChange={(e) => setActiveObraId(e.target.value)}
                    className="bg-transparent text-sm font-bold text-slate-900 focus:outline-none cursor-pointer pr-1 max-w-[260px]"
                  >
                    {isAdmin && <option value="ALL">🏢 Todas as Obras</option>}
                    {userObras.map(obra => (
                      <option key={obra.id} value={obra.id}>
                        {obra.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : userObras.length === 1 ? (
              <div className="work-switcher">
                <Building2 className="w-4 h-4 text-[#2bb2c8] shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="text-[9px] uppercase font-bold text-cyan-600 leading-none">Seu Canteiro</span>
                  <span className="text-xs font-semibold">{userObras[0].name}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-amber-800 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200">
                Sem obra vinculada
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 pb-24 sm:pb-6">
        {accessError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 text-sm"><strong className="block">Não foi possível carregar todos os dados</strong><span>{accessError}</span></div>
            <button type="button" onClick={refreshProfile} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-400 bg-white px-3 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Tentar</button>
          </div>
        )}
        <Outlet />
      </main>

      {/* Bottom Navigation (Mobile) */}
      <nav className="mobile-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 pb-safe z-30">
        <div className="flex justify-around items-center h-16">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
                  isActive ? "text-[#2bb2c8]" : "text-slate-500 hover:text-slate-900"
                )}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
