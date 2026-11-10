// Leituras de estoque e movimentações para painel, histórico e relatórios.
// SOMENTE LEITURA: nenhuma função aqui escreve no Firestore.
// As consultas seguem o mesmo padrão já usado pelo app e exigido por firestore.rules:
// sempre filtram por companyId e, para almoxarifes, por uma obra por consulta.
import { collection, getDocs, limit, orderBy, query, where, type Firestore, type QueryConstraint } from 'firebase/firestore';
import type { InventoryStock } from '../types';
import { filterMovements, normalizeMovement, sortMovementsDesc, type MovementView } from './movements';
import { resolveObraTargets, restrictToScope, type DataScope } from './reports';

export interface MovementResult {
  rows: MovementView[];
  // Alguma consulta atingiu o limite: podem existir registros mais antigos não carregados.
  truncated: boolean;
  // O índice composto não existe: a consulta foi refeita sem ordenação do servidor.
  // Nesse caso o conjunto pode estar incompleto e a ordem é aplicada só no navegador.
  unordered: boolean;
}

export async function fetchStocks(db: Firestore, scope: DataScope, selection: string): Promise<InventoryStock[]> {
  const targets = resolveObraTargets(scope, selection);
  const snapshots = await Promise.all(targets.map(obraId => {
    const constraints: QueryConstraint[] = [where('companyId', '==', scope.companyId)];
    if (obraId) constraints.push(where('obraId', '==', obraId));
    return getDocs(query(collection(db, 'inventoryStock'), ...constraints));
  }));
  const rows = snapshots.flatMap(snapshot => snapshot.docs.map(item => ({ ...item.data(), id: item.id } as InventoryStock)));
  return restrictToScope(rows, scope);
}

export interface MovementQuery {
  fromIso?: string;
  toIso?: string;
  max?: number;
}

const isMissingIndex = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error
  && String((error as { code: unknown }).code).replace('firestore/', '') === 'failed-precondition');

export async function fetchMovements(db: Firestore, scope: DataScope, selection: string, options: MovementQuery = {}): Promise<MovementResult> {
  const max = options.max ?? 500;
  const targets = resolveObraTargets(scope, selection);

  const run = async (ordered: boolean) => {
    const snapshots = await Promise.all(targets.map(obraId => {
      const constraints: QueryConstraint[] = [where('companyId', '==', scope.companyId)];
      if (obraId) constraints.push(where('obraId', '==', obraId));
      if (ordered) {
        if (options.fromIso) constraints.push(where('createdAt', '>=', options.fromIso));
        if (options.toIso) constraints.push(where('createdAt', '<=', options.toIso));
        constraints.push(orderBy('createdAt', 'desc'));
      }
      constraints.push(limit(max));
      return getDocs(query(collection(db, 'stockMovements'), ...constraints));
    }));
    return snapshots;
  };

  let unordered = false;
  let snapshots;
  try {
    snapshots = await run(true);
  } catch (error) {
    if (!isMissingIndex(error)) throw error;
    unordered = true;
    snapshots = await run(false);
  }

  const truncated = snapshots.some(snapshot => snapshot.size >= max);
  const normalized = snapshots
    .flatMap(snapshot => snapshot.docs.map(item => normalizeMovement(item.id, item.data() as Record<string, unknown>)))
    .filter((row): row is MovementView => row !== null);
  let rows: MovementView[] = restrictToScope<MovementView>(normalized, scope);
  if (unordered) rows = filterMovements(rows, { fromIso: options.fromIso, toIso: options.toIso });
  rows = sortMovementsDesc(rows).slice(0, max);
  return { rows, truncated, unordered };
}

// Nomes dos responsáveis: só o administrador pode listar usuários da empresa (regra do Firestore).
// Falha de leitura não é crítica: o histórico mostra o UID parcial.
export async function fetchUserNames(db: Firestore, scope: DataScope): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!scope.isAdmin) return names;
  try {
    const snapshot = await getDocs(query(collection(db, 'users'), where('companyId', '==', scope.companyId)));
    snapshot.docs.forEach(item => {
      const data = item.data();
      if (typeof data.name === 'string' && data.name) names.set(item.id, data.name);
    });
  } catch {
    /* mantém o mapa vazio */
  }
  return names;
}
