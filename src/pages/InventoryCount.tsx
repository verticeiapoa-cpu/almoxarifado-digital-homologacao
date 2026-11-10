import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { confirmInventoryCount } from '../lib/inventoryCount';
import type { InventoryStock } from '../types';
import { logError } from '../lib/logger';

export default function InventoryCountPage() {
  const { profile, user, isAdmin, activeObraId, userObras } = useAuth();
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!profile || activeObraId === 'ALL') return;
    setLoading(true); setError('');
    try {
      const snapshot = await getDocs(query(collection(db, 'inventoryStock'),
        where('companyId', '==', profile.companyId), where('obraId', '==', activeObraId)));
      const rows = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock));
      setStocks(rows);
      setCounts(Object.fromEntries(rows.map(row => [row.id, String(row.quantity)])));
      setReasons({});
    } catch (e) {
      logError('inventory-count-load-failed', e);
      setError('Não foi possível carregar os saldos desta obra.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [profile?.companyId, activeObraId]);

  const submit = async (stock: InventoryStock) => {
    if (!profile || !user || !isAdmin || savingId) return;
    setError(''); setMessage('');
    const raw = counts[stock.id] ?? '';
    if (!/^\d{1,6}$/.test(raw) || Number(raw) > 999999) {
      setError('Informe uma quantidade inteira entre 0 e 999999.'); return;
    }
    const reason = (reasons[stock.id] ?? '').trim();
    if (reason.length < 5 || reason.length > 300) {
      setError('Informe o motivo da contagem (de 5 a 300 caracteres).'); return;
    }
    setSavingId(stock.id);
    try {
      const result = await confirmInventoryCount(db, {
        companyId: profile.companyId, obraId: stock.obraId, obraName: stock.obraName,
        materialId: stock.materialId, materialDescription: stock.materialDescription,
        ca: stock.ca, countedQuantity: Number(raw), reason, userId: user.uid,
      });
      setMessage(result.difference === 0
        ? `Contagem de ${stock.materialDescription} conferida. Nenhuma divergência.`
        : `Inventário registrado: ${stock.materialDescription}. Saldo ajustado de ${result.systemQuantity} para ${result.countedQuantity} (${result.difference > 0 ? '+' : ''}${result.difference}).`);
      await load();
    } catch (e) {
      logError('inventory-count-save-failed', e);
      setError(e instanceof Error ? e.message : 'Não foi possível confirmar a contagem.');
    } finally { setSavingId(''); }
  };

  if (!isAdmin) return <div className="empty-card"><ClipboardCheck /><strong>Acesso restrito</strong><span>Somente administradores podem confirmar inventários físicos nesta versão.</span></div>;

  return <div className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Inventário físico</h2>
        <p className="mt-1 text-sm text-slate-500">Confira o saldo contado no canteiro. Divergências geram ajuste e histórico auditável.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || activeObraId === 'ALL'} className="secondary-action"><RefreshCw />Atualizar</button>
    </div>
    {activeObraId === 'ALL' && <div className="work-required-card"><ClipboardCheck /><div><strong>Selecione uma obra no topo</strong><span>O inventário é realizado por canteiro.</span></div></div>}
    {message && <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {activeObraId !== 'ALL' && (loading ? <div className="py-10 text-center">Carregando estoque…</div> : stocks.length === 0 ? <div className="empty-card"><ClipboardCheck /><strong>Nenhum saldo cadastrado</strong><span>Cadastre materiais no estoque antes de realizar o inventário.</span></div> :
      <div className="flex flex-col gap-3">{stocks.map(stock => <section key={stock.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-slate-900">{stock.materialDescription}</strong><p className="text-xs text-slate-500">C.A. {stock.ca || 'não informado'} · Saldo no sistema: <b>{stock.quantity} {stock.unit}</b></p></div>
          <span className="text-xs text-slate-500">Contagem por item</span></div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">Quantidade física<input aria-label={`Quantidade física de ${stock.materialDescription}`} type="number" min="0" max="999999" step="1" inputMode="numeric" value={counts[stock.id] ?? ''} onChange={e => setCounts(current => ({ ...current, [stock.id]: e.target.value }))} className="field-control mt-1" /></label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Motivo / observação<input maxLength={300} value={reasons[stock.id] ?? ''} onChange={e => setReasons(current => ({ ...current, [stock.id]: e.target.value }))} placeholder="Ex.: conferência mensal do almoxarifado" className="field-control mt-1" /></label>
        </div>
        <div className="mt-3 flex justify-end"><button type="button" disabled={Boolean(savingId)} onClick={() => void submit(stock)} className="primary-action">{savingId === stock.id ? 'Registrando…' : 'Confirmar contagem'}</button></div>
      </section>)}</div>)}
  </div>;
}
