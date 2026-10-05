import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { InventoryStock, StockAlertSettings } from '../types';

export const DEFAULT_ALERT_EMAIL = 'verticeiapoa@gmail.com';

export function defaultStockAlertSettings(companyId: string): StockAlertSettings {
  const now = new Date().toISOString();
  return {
    id: companyId,
    companyId,
    recipientEmail: DEFAULT_ALERT_EMAIL,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: '',
  };
}

export async function getStockAlertSettings(companyId: string) {
  const snapshot = await getDoc(doc(db, 'stockAlertSettings', companyId));
  return snapshot.exists()
    ? snapshot.data() as StockAlertSettings
    : defaultStockAlertSettings(companyId);
}

export async function saveStockAlertSettings(settings: StockAlertSettings) {
  await setDoc(doc(db, 'stockAlertSettings', settings.companyId), settings);
}

export async function ensureStockAlertSettings(companyId: string, adminUid: string) {
  const reference = doc(db, 'stockAlertSettings', companyId);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) return;
  await setDoc(reference, { ...defaultStockAlertSettings(companyId), updatedBy: adminUid });
}

export async function queueLowStockAlert(
  companyId: string,
  stock: InventoryStock,
  requestedBy: string,
) {
  const settings = await getStockAlertSettings(companyId);
  const quantity = stock.quantity;
  const minimum = stock.minimumStock;
  if (!settings.enabled || !settings.recipientEmail || minimum <= 0 || quantity > minimum || stock.lowStockAlertSent) {
    return false;
  }

  if (!settings.updatedBy) {
    settings.updatedBy = requestedBy;
    await saveStockAlertSettings(settings);
  }

  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== requestedBy) throw new Error('Sessão inválida para envio do alerta.');
  const token = await currentUser.getIdToken();
  const response = await fetch('/api/stock-alert', {
    signal: AbortSignal.timeout(15_000),
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ companyId, stockId: stock.id }),
  });
  const result = await response.json().catch(() => ({})) as { sent?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error || 'Não foi possível enviar o alerta.');
  return Boolean(result.sent);
}
