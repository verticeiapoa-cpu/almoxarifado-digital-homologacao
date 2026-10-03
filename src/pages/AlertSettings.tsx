import { useEffect, useState } from 'react';
import { BellRing, Mail, Save, ShieldAlert } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { defaultStockAlertSettings, getStockAlertSettings, saveStockAlertSettings } from '../lib/stockAlerts';
import { logError } from '../lib/logger';

export default function AlertSettings() {
  const { profile, user, isAdmin } = useAuth();
  const [recipientEmail, setRecipientEmail] = useState('verticeiapoa@gmail.com');
  const [enabled, setEnabled] = useState(true);
  const [createdAt, setCreatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailServiceReady, setEmailServiceReady] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/stock-alert/status').then(response => response.json()).then(result => setEmailServiceReady(Boolean(result.configured))).catch(() => setEmailServiceReady(false));
    const load = async () => {
      if (!profile || !isAdmin) return;
      try {
        const settings = await getStockAlertSettings(profile.companyId);
        setRecipientEmail(settings.recipientEmail);
        setEnabled(settings.enabled);
        setCreatedAt(settings.createdAt);
      } catch (error) {
        logError('stock-alert-settings-load-failed', error);
        setMessage('Não foi possível carregar as configurações.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile, isAdmin]);

  if (!isAdmin) {
    return <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center"><ShieldAlert className="w-12 h-12 text-slate-300 mx-auto mb-3" /><h3 className="text-lg font-semibold text-slate-800">Acesso restrito</h3><p className="text-sm text-slate-500 mt-1">Apenas administradores podem configurar os alertas.</p></div>;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
    setMessage('');
    try {
      const defaults = defaultStockAlertSettings(profile.companyId);
      await saveStockAlertSettings({
        ...defaults,
        recipientEmail: recipientEmail.trim().toLowerCase(),
        enabled,
        createdAt: createdAt || defaults.createdAt,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
      });
      setCreatedAt(createdAt || defaults.createdAt);
      setMessage('Configuração salva com sucesso.');
    } catch (error) {
      logError('stock-alert-settings-save-failed', error);
      setMessage('Não foi possível salvar a configuração.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#2bb2c8] rounded-full animate-spin" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Alertas de estoque</h2><p className="text-sm text-slate-500 mt-1">Defina quem recebe o aviso quando um EPI atingir o limite mínimo.</p></div>
      <form onSubmit={handleSubmit} className="alert-settings-card">
        <div className="alert-settings-heading"><span><BellRing /></span><div><strong>Alerta automático de estoque baixo</strong><small>Um aviso é preparado quando o saldo fica igual ou abaixo do mínimo definido no EPI.</small></div></div>
        <label className="settings-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Ativar alertas automáticos</strong><small>Desative para suspender novos avisos sem perder os limites cadastrados.</small></span></label>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="recipientEmail">E-mail da gestão</label>
          <div className="email-input-wrap"><Mail /><input id="recipientEmail" type="email" required value={recipientEmail} onChange={event => setRecipientEmail(event.target.value)} placeholder="gestao@empresa.com.br" /></div>
          <p className="text-xs text-slate-500 mt-2">Somente administradores podem alterar este endereço.</p>
        </div>
        <div className="email-service-note"><ShieldAlert /><p><strong>{emailServiceReady ? 'Envio automático pelo Brevo ativo' : emailServiceReady === false ? 'Envio de e-mail pendente de configuração' : 'Verificando o serviço de e-mail...'}</strong><span>{emailServiceReady ? 'Quando um item atingir o estoque mínimo, o aviso será enviado automaticamente ao endereço acima.' : 'O destinatário já pode ser salvo. A entrega começa após conectar uma conta Brevo e validar o remetente.'}</span></p></div>
        {message && <p className={message.includes('sucesso') ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>{message}</p>}
        <button type="submit" disabled={saving} className="settings-save-button"><Save />{saving ? 'Salvando...' : 'Salvar configuração'}</button>
      </form>
    </div>
  );
}
