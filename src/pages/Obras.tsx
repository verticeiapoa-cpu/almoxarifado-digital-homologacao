import React, { useEffect, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, getDocsFromServer, doc, setDoc, updateDoc, where } from 'firebase/firestore';
import { Obra } from '../types';
import { Building2, Plus, CircleOff, CircleCheck, Edit2, ShieldAlert } from 'lucide-react';
import { cn } from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { logError } from '../lib/logger';
import { obraError, validateObraDraft } from '../lib/obraForm';

export default function Obras() {
  const { isAdmin, profile, user, refreshObras } = useAuth();
  const [obras, setObras] = useState<Obra[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listError, setListError] = useState<ReturnType<typeof obraError> | null>(null);
  const [saveError, setSaveError] = useState<ReturnType<typeof obraError> | null>(null);
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const newObraId = useRef<string | null>(null);
  const saving = useRef(false);
  const loadSequence = useRef(0);

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    cno: '',
  });

  const fetchObras = async () => {
    if (!profile || !isAdmin) { setLoading(false); return; }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setListError(null);
    try {
      if (!profile.companyId) throw new Error('Seu cadastro não possui uma empresa vinculada. O administrador precisa revisar seu acesso.');
      const q = query(collection(db, 'obras'), where('companyId', '==', profile.companyId));
      const snapshot = await getDocsFromServer(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Obra));
      if (sequence === loadSequence.current) setObras(data);
    } catch (err) {
      logError('obras-load-failed', err);
      if (sequence === loadSequence.current) setListError(obraError(err, 'list'));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchObras();
  }, [profile?.companyId, isAdmin]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value.toUpperCase() }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving.current) return;
    setSaveError(null);
    setSuccess('');
    setCopied(false);
    if (!user || !profile || !isAdmin) {
      setSaveError(obraError(new Error('O cadastro exige uma sessão administrativa válida.'), 'save'));
      return;
    }
    setIsSubmitting(true);
    saving.current = true;
    try {
      const validated = validateObraDraft(formData, profile.companyId);
      if (!editingId && !newObraId.current) newObraId.current = doc(collection(db, 'obras')).id;
      const docRef = doc(db, 'obras', editingId || newObraId.current!);
      const obraData = {
        ...validated,
        id: docRef.id,
        updatedAt: new Date().toISOString(),
      };
      if (editingId) {
        await updateDoc(docRef, obraData);
      } else {
        await setDoc(docRef, {
          ...obraData,
          isActive: true,
          createdAt: new Date().toISOString(),
        });
      }
      
      setSuccess(`Obra ${validated.name} salva com sucesso.`);
      resetForm();
      await fetchObras();
      try { await refreshObras(); } catch (refreshError) {
        setListError(obraError(refreshError, 'list'));
      }
    } catch (err) {
      logError('obra-save-failed', err);
      setSaveError(obraError(err, 'save'));
    } finally {
      setIsSubmitting(false);
      saving.current = false;
    }
  };

  const openForm = () => {
    setSaveError(null);
    setSuccess('');
    setIsFormOpen(true);
    window.history.pushState(
      { ...(window.history.state || {}), wselentForm: 'obras' },
      '',
      window.location.href,
    );
  };

  const closeForm = () => {
    const shouldReturn = window.history.state?.wselentForm === 'obras';
    setIsFormOpen(false);
    setEditingId(null);
    if (shouldReturn) window.history.back();
  };

  useEffect(() => {
    const onPopState = () => {
      if (window.history.state?.wselentForm !== 'obras' && isFormOpen) {
        setIsFormOpen(false);
        setEditingId(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isFormOpen]);

  const handleEdit = (obra: Obra) => {
    if (saving.current) return;
    setFormData({
      name: obra.name,
      address: obra.address,
      cno: obra.cno || '',
    });
    setEditingId(obra.id);
    openForm();
  };

  const handleToggleActive = async (obra: Obra) => {
    const nextStatus = !obra.isActive;
    if (!window.confirm(`${nextStatus ? 'Reativar' : 'Inativar'} esta obra? O histórico será preservado.`)) return;
    try {
      await updateDoc(doc(db, 'obras', obra.id), {
        isActive: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await fetchObras();
      await refreshObras();
    } catch (err) {
      logError('obra-status-update-failed', err);
      setSaveError(obraError(err, 'status'));
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      cno: '',
    });
    closeForm();
    newObraId.current = null;
  };

  const error = saveError || listError;
  const diagnostic = error ? [
    'WSELENT — diagnóstico de obras',
    `Operação: ${saveError ? 'gravação' : 'consulta'}`,
    `Código: ${error.code}`,
    `Detalhe: ${error.detail}`,
    `Conta: ${user?.email || 'não identificada'}`,
    `Perfil: ${profile?.role || 'não identificado'}`,
    `Empresa: ${profile?.companyId || 'não vinculada'}`,
    `Cadastro: ${editingId || newObraId.current || 'lista'}`,
  ].join('\n') : '';

  const copyDiagnostic = async () => {
    try { await navigator.clipboard.writeText(diagnostic); setCopied(true); }
    catch { setCopied(false); }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <ShieldAlert className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-800">Acesso Restrito</h3>
        <p className="text-sm text-slate-500 mt-1">Apenas administradores podem gerenciar obras.</p>
      </div>

    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Obras</h2>
          <p className="text-sm text-slate-500 mt-1">Gerencie os canteiros de obras ou frentes de trabalho.</p>
        </div>
        {!isFormOpen && (
          <button 
            onClick={openForm}
            className="flex items-center gap-2 px-4 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Obra
          </button>
        )}
      </div>

      {success && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{success}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
        <p className="font-semibold">{error.message}</p>
        <p className="mt-2 text-sm">Código: <strong>{error.code}</strong></p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Detalhes para suporte</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans">{diagnostic}</pre></details>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={copyDiagnostic} className="secondary-action">{copied ? 'Detalhes copiados' : 'Copiar detalhes'}</button>
          {listError && <button type="button" disabled={loading} onClick={fetchObras} className="secondary-action">Tentar carregar obras</button>}
        </div>
      </div>}

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-medium text-slate-900 mb-4">
            {editingId ? 'Editar Obra' : 'Cadastrar Obra'}
          </h3>
          <fieldset disabled={isSubmitting} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Obra *</label>
              <input required maxLength={120} autoComplete="off" name="name" value={formData.name} onChange={handleInputChange} placeholder="Ex: OBRA RESIDENCIAL ALPHAVILLE" className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CNO da Obra</label>
              <input maxLength={30} autoComplete="off" name="cno" value={formData.cno} onChange={handleInputChange} placeholder="Ex: 90.012.34567/89" className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Endereço da Obra</label>
              <input maxLength={200} autoComplete="off" name="address" value={formData.address} onChange={handleInputChange} placeholder="Ex: RUA DAS FLORES, 123" className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
            </div>
          </fieldset>
          <div className="flex justify-end gap-3">
            <button type="button" disabled={isSubmitting} onClick={resetForm} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors disabled:opacity-70">
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#2bb2c8] rounded-full animate-spin" />
        </div>
      ) : listError ? null : obras.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Nenhuma obra cadastrada.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 whitespace-nowrap">Nome da Obra</th>
                  <th className="px-6 py-4 whitespace-nowrap">Endereço</th>
                  <th className="px-6 py-4 whitespace-nowrap">CNO</th>
                  <th className="px-6 py-4 whitespace-nowrap">Status</th>
                  <th className="px-6 py-4 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {obras.map(obra => (
                  <tr key={obra.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{obra.name}</td>
                    <td className="px-6 py-4 text-slate-600">{obra.address || '-'}</td>
                    <td className="px-6 py-4 font-mono text-slate-600">{obra.cno || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={cn('inline-flex px-2 py-1 rounded text-[10px] font-semibold', obra.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600')}>
                        {obra.isActive ? 'ATIVA' : 'INATIVA'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleEdit(obra)} className="p-2 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleToggleActive(obra)} className={cn('p-2 rounded-lg transition-colors', obra.isActive ? 'text-slate-500 hover:text-red-600' : 'text-emerald-600 hover:text-emerald-700')} title={obra.isActive ? 'Inativar' : 'Reativar'}>
                        {obra.isActive ? <CircleOff className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
