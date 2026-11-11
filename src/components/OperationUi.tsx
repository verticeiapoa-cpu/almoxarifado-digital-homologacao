import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { fetchStocks } from '../lib/reportData';
import { buildDataScope } from '../lib/reports';
import { logError } from '../lib/logger';
import { friendlyOperationError } from '../lib/operationsService';
import type { InventoryStock } from '../types';
import type { Actor } from '../lib/operations';

export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Escopo, ator e obra selecionada comuns às telas de operação.
export function useOperationContext() {
  const { profile, user, obras, activeObraId } = useAuth();
  const scope = useMemo(() => (profile ? buildDataScope(profile, obras) : null), [profile, obras]);
  const accessibleObras = useMemo(() => obras.filter(obra => obra.isActive && scope?.obraIds.includes(obra.id)), [obras, scope]);
  const [obraId, setObraId] = useState('');
  useEffect(() => {
    if (obraId && accessibleObras.some(obra => obra.id === obraId)) return;
    setObraId(activeObraId !== 'ALL' && accessibleObras.some(obra => obra.id === activeObraId) ? activeObraId : accessibleObras[0]?.id ?? '');
  }, [accessibleObras, activeObraId, obraId]);
  const obra = accessibleObras.find(item => item.id === obraId);
  const actor: Actor | null = profile && user ? { uid: user.uid, name: profile.name || user.email || user.uid, companyId: profile.companyId } : null;
  const canAdjust = Boolean(profile && (profile.role === 'admin' || profile.canAdjustStock === true));
  return { profile, scope, obras, accessibleObras, obraId, setObraId, obra, actor, canAdjust, isAdmin: profile?.role === 'admin' };
}

export function useStocks(scope: ReturnType<typeof useOperationContext>['scope'], obraId: string, reloadKey: number) {
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!scope || !obraId) { setStocks([]); return; }
    let alive = true;
    setLoading(true); setError('');
    fetchStocks(db, scope, obraId).then(rows => { if (alive) setStocks([...rows].sort((a, b) => a.materialDescription.localeCompare(b.materialDescription, 'pt-BR'))); })
      .catch(e => { logError('stock-load-failed', e); if (alive) setError('Não foi possível carregar o estoque desta obra.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope, obraId, reloadKey]);
  return { stocks, loading, error };
}

// Protege contra toque duplo: uma operação por vez, com ID gerado uma vez por formulário.
export function useGuardedAction() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    try { await action(); setSuccess(message); return true; }
    catch (e) { logError('operation-failed', e); setError(friendlyOperationError(e)); return false; }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { busy, error, success, run, clear: () => { setError(''); setSuccess(''); } };
}

export function Feedback({ error, success }: { error: string; success: string }) {
  return <>{error && <div role="alert" className="notice notice-error">{error}</div>}{success && <div role="status" className="notice notice-ok">{success}</div>}</>;
}

export function ObraField({ ctx, label = 'Obra' }: { ctx: ReturnType<typeof useOperationContext>; label?: string }) {
  return <div><label className="field-label" htmlFor="op-obra">{label}</label>
    <select id="op-obra" className="field-control" value={ctx.obraId} onChange={e => ctx.setObraId(e.target.value)}>
      {ctx.accessibleObras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select></div>;
}

export function PageHeader({ title, text }: { title: string; text: string }) {
  return <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2><p className="text-sm text-slate-500 mt-1">{text}</p></div>;
}

export function NoAccess({ children }: { children?: ReactNode }) {
  return <div className="empty-card"><strong>Sem obra vinculada</strong><span>{children ?? 'Peça ao administrador para vincular uma obra ao seu perfil.'}</span></div>;
}

// Passo numerado: divide o formulário em blocos curtos, como uma ficha de papel.
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return <section className="op-step" aria-label={title}><h3><b>{n}</b>{title}</h3>{children}</section>;
}

// Confirmação antes de gravar: mostra em linguagem simples o que vai acontecer e permite voltar.
export function ConfirmPanel({ title, lines, busy, confirmLabel, onConfirm, onBack }: {
  title: string; lines: string[]; busy: boolean; confirmLabel: string; onConfirm: () => void; onBack: () => void;
}) {
  return (
    <div className="op-summary" role="group" aria-label="Confirmação">
      <strong>{title}</strong>
      <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>
      <p className="op-hint">Depois de confirmar, o registro fica no histórico e não pode ser apagado.</p>
      <div className="op-actions">
        <button type="button" className="primary-action" disabled={busy} onClick={onConfirm}>{busy ? 'Registrando…' : confirmLabel}</button>
        <button type="button" className="secondary-action" disabled={busy} onClick={onBack}>Voltar e corrigir</button>
      </div>
    </div>
  );
}

// Escolha de item com busca por nome: listas longas ficam fáceis no celular.
export function ItemPicker({ id, label, stocks, value, onChange }: {
  id: string; label: string; stocks: InventoryStock[]; value: string; onChange: (materialId: string) => void;
}) {
  const [term, setTerm] = useState('');
  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? stocks.filter(s => s.materialDescription.toLowerCase().includes(t) || (s.ca ?? '').toLowerCase().includes(t)) : stocks;
  }, [stocks, term]);
  return (
    <div className="flex flex-col gap-2">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input className="field-control" type="search" placeholder="Digite parte do nome ou do C.A. para achar" aria-label="Buscar item" value={term} onChange={e => setTerm(e.target.value)} />
      <select id={id} className="field-control" value={value} onChange={e => onChange(e.target.value)} size={list.length > 1 && list.length <= 6 ? list.length + 1 : undefined}>
        <option value="">{list.length === 0 ? 'Nenhum item encontrado' : 'Toque para escolher o item'}</option>
        {list.map(s => <option key={s.materialId} value={s.materialId}>{s.materialDescription} — tem {s.quantity} {s.unit}</option>)}
      </select>
    </div>
  );
}
