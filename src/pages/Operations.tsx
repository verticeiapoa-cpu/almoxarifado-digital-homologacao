import { Link } from 'react-router-dom';
import { ClipboardCheck, PackagePlus, Repeat, Undo2, ArrowLeftRight } from 'lucide-react';
import { PageHeader } from '../components/OperationUi';

const ACTIONS = [
  { to: '/receipts', icon: PackagePlus, title: 'Chegou material', text: 'Registrar o que chegou na obra: quantidade, nota fiscal e fornecedor.' },
  { to: '/transfers', icon: Repeat, title: 'Mandar para outra obra', text: 'Passar material de uma obra para outra, com confirmação de quem recebe.' },
  { to: '/returns', icon: Undo2, title: 'Funcionário devolveu EPI', text: 'Dar baixa na devolução e dizer se o item está bom, danificado ou inservível.' },
  { to: '/inventory-count', icon: ClipboardCheck, title: 'Contar o estoque', text: 'Conferir o que existe na prateleira e corrigir diferenças, com justificativa.' },
  { to: '/movements', icon: ArrowLeftRight, title: 'Ver o que já foi feito', text: 'Lista de tudo que entrou, saiu ou foi corrigido, com data e responsável.' },
];

export default function Operations() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="O que você quer fazer?" text="Escolha uma opção. Cada tela guia você passo a passo e pede confirmação antes de gravar." />
      <div className="op-hub">
        {ACTIONS.map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="op-hub-card"><Icon /><div><strong>{title}</strong><span>{text}</span></div></Link>
        ))}
      </div>
    </div>
  );
}
