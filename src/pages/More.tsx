import { Link } from 'react-router-dom';
import { BellRing, Building2, ChevronRight, Shield, UserCog, UserRoundCheck } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export default function More() {
  const { isAdmin } = useAuth();
  const links = [
    { to: '/materials', label: 'Estoque de EPIs', description: 'Catálogo e certificados de aprovação', icon: Shield },
    ...(isAdmin ? [
      { to: '/obras', label: 'Obras e Canteiros', description: 'Cadastro e situação das obras', icon: Building2 },
      { to: '/users', label: 'Almoxarifes e Usuários', description: 'Perfis, convites e permissões', icon: UserCog },
      { to: '/settings/stock-alerts', label: 'Alertas de estoque', description: 'Estoque mínimo e e-mail da gestão', icon: BellRing },
    ] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Mais opções</h2><p className="text-sm text-slate-500 mt-1">Administração e configurações operacionais.</p></div>
      <div className="more-list">
        {links.map(({ to, label, description, icon: Icon }) => (
          <Link key={to} to={to} className="more-link">
            <span><Icon /></span><div><strong>{label}</strong><small>{description}</small></div><ChevronRight />
          </Link>
        ))}
      </div>
    </div>
  );
}
