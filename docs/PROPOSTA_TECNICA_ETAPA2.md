# Proposta técnica — Expansão operacional, Etapa 2

Branch: `feature/expansao-operacional-etapa2` (sobre `feature/expansao-operacional-10x`, que já contém a Etapa 1).
Status: **PROPOSTA — nenhum código de Etapa 2 foi escrito. Nenhuma regra foi alterada.** Depende das decisões da seção 9.

## 1. Estado verificado do repositório

- Etapa 1 aplicada na cópia local (`b7a2811`): `Movements.tsx`, `Reports.tsx`, `lib/csv.ts`, painel e estoque ampliado existem. Não será reaplicada.
- O repositório real do usuário não foi inspecionado (só o ZIP). Antes de aplicar, confirmar se a Etapa 1 já está nele (`git log --grep="painel por obra"`).
- O prompt da Etapa 2 chegou **truncado** na seção 14 (protótipo HTML, termina em "Sem depe"). Será assumido: arquivo único, dados fictícios, sem rede.

## 2. Divergências e restrições encontradas (que moldam o desenho)

| # | Achado (confirmado em `firestore.rules`) | Consequência |
|---|---|---|
| 1 | `inventoryStock`: não-admin só pode **diminuir** `quantity`; `create` é só admin; `validInventory` usa `hasOnly` (sem campos extras). | Aumentar saldo (recebimento, destino de transferência, devolução, sobra de inventário) por almoxarife exige **regra nova**. Quarentena não pode virar campo do estoque: precisa de coleção própria. |
| 2 | `stockMovements`: não-admin só cria `EPI_DELIVERY`; admin cria qualquer tipo exceto `EPI_DELIVERY`; chaves com `hasOnly`; `balanceAfter == balanceBefore + quantity` e `getAfter(estoque).quantity == balanceAfter`. | Para referenciar a operação de origem é preciso incluir campos **opcionais** (`operationType`, `operationId`) em `validStockMovement`. |
| 3 | Tipos de movimentação existentes: `ENTRY, EPI_DELIVERY, TRANSFER, ADJUSTMENT, RETURN`. | Reutilizar: ENTRADA=`ENTRY`; TRANSFERÊNCIA_ENTRADA/SAÍDA=`TRANSFER` (sinal da quantidade + `operationType`); AJUSTE_INVENTÁRIO=`ADJUSTMENT`+`operationType:'INVENTORY'`; DEVOLUÇÃO=`RETURN`. **Nenhum tipo novo.** |
| 4 | Tipo TS `StockMovement.reason` ≠ regra `notes`. O app atual nunca grava `reason` (por isso não quebra). Formato antigo usa `reason`. | Corrigir o **tipo** para `notes` (e manter leitura de `reason` no histórico). Sem mudança de dados. |
| 5 | Limites de regra: estoque ≤ 999999; item de entrega ≤ 9999; máx. 5 itens por entrega. | Recebimento/transferência: quantidade ≥ 1 e saldo final ≤ 999999. Limite de entrega não é alterado. |
| 6 | Regras limitam acessos a documentos (`get/exists/getAfter`): 10 por operação e 20 por transação/batch. | **Inventário não cabe em uma transação única** com muitos itens (1 acesso por estoque). Ver 6.4. Precisa ser medido no emulador. |
| 7 | Entregas são imutáveis; itens guardam `materialId`, `stockId`, `quantity`. | Devolução não pode editar a entrega: usa um **livro de devoluções** separado (6.3). |
| 8 | Coleção nova sem regra cai em `match /{document=**} → false`. | Toda coleção nova exige bloco de regra (aditivo). Não há como evitar alteração de `firestore.rules`. |
| 9 | O formulário atual de saldo (admin) gera `ENTRY`/`ADJUSTMENT` **sem justificativa**. | Fora do escopo; recomendo exigir justificativa depois. Não será alterado agora. |
| 10 | `validInventory`/`inventoryStock` não comportam lote/validade. | Lote, validade, fornecedor e NF ficam **no documento de recebimento**, sem saldo por lote. Relatório de vencimento será informativo (recebimentos com validade próxima), não por saldo restante. |

## 3. Novas coleções (todas aditivas; nenhuma existente é renomeada ou apagada)

Todas têm `id` = ID da operação (gerado uma vez no cliente), `companyId`, `createdAt` (ISO), `createdBy` (uid) e são **imutáveis após conclusão** (`allow delete: if false`).

**`receipts/{id}`** — recebimento
`obraId, obraName, materialId, materialDescription, quantity(int 1..999999), unit, receivedAt, supplier?, invoiceNumber?, lot?, expiresAt?, notes?, balanceBefore, balanceAfter, movementId, status:'CONCLUIDA'`
Criado na mesma transação que o estoque e a movimentação. Sem update/delete.

**`transfers/{id}`**
`fromObraId, fromObraName, toObraId, toObraName, materialId, materialDescription, quantity, unit, status:'PENDENTE'|'CONCLUIDA'|'CANCELADA', requestedBy, requestedAt, notes?, confirmedBy?, confirmedAt?, cancelledBy?, cancelledAt?, cancelReason?, outMovementId?, inMovementId?`
Update permitido apenas: `PENDENTE→CONCLUIDA` (na transação de estoque) ou `PENDENTE→CANCELADA` (com `cancelReason` ≥ 5 caracteres). `CONCLUIDA/CANCELADA` são terminais. Correção de transferência concluída = **nova transferência corretiva** (campo opcional `correctsTransferId` + justificativa), nunca edição.

**`returns/{id}`** — devolução
`obraId, employeeId, employeeName, deliveryId?, materialId, materialDescription, quantity, condition:'BOM_ESTADO'|'DANIFICADO'|'INSERVIVEL'|'PENDENTE_INSPECAO', status:'REGISTRADA'|'INSPECIONADA', returnedAt, receivedBy, notes?, resolution?, resolvedBy?, resolvedAt?, resolutionNotes?, movementId?`
Regra de negócio:
- `BOM_ESTADO` → entra no estoque disponível (movimentação `RETURN`) após confirmação do recebimento.
- `PENDENTE_INSPECAO` → não toca o saldo; depois um usuário autorizado resolve para `BOM_ESTADO` (entra no estoque), `DANIFICADO` (quarentena) ou `INSERVIVEL` (descarte, justificativa obrigatória).
- `DANIFICADO` → quarentena; `INSERVIVEL` → descarte. Nenhum dos dois altera o saldo disponível.

**`returnLedger/{deliveryId__materialId}`** — controle de quantidade devolvida
`companyId, deliveryId, materialId, delivered, returned`. Criado/atualizado na transação de devolução; a regra exige `returned <= delivered` (lendo a entrega imutável com `get`). Impede devolução acima do entregue e duplicidade concorrente.

**`quarantineStock/{obraId__materialId}`** — itens fora do saldo disponível
`companyId, obraId, materialId, damaged, inspectionPending, discarded` (contadores). Atualizado junto com a devolução/inspeção. Descartes ficam registrados em `returns` (justificativa); **não há movimentação de estoque para descarte**, pois o saldo disponível não muda e a regra exige `quantity != 0`. O histórico geral lê `returns` para exibir DESCARTE.

**`inventoryCounts/{id}`** (cabeçalho) e **`inventoryCountItems/{countId__materialId}`**
Cabeçalho: `obraId, countedAt, countedBy, status:'EM_CONTAGEM'|'CONFIRMADA'|'CANCELADA', itemsTotal, itemsAdjusted`.
Item: `materialId, systemQty (referência da contagem), countedQty, difference, justification (obrigatória se difference≠0), adjusted:bool, balanceBefore?, balanceAfter?, movementId?`.
Confirmação por item, cada uma numa transação pequena (ver 6.4).

**Alterações em coleções existentes (somente campos opcionais):**
- `stockMovements`: `operationType?` (`'RECEIPT'|'TRANSFER'|'RETURN'|'INVENTORY'`) e `operationId?` em `validStockMovement`.
- `inventoryStock`: **um único campo opcional novo, `lastMovementId` (string ≤ 200)**, em `validInventory`. Revisão desta proposta: a regra de estoque não tem como descobrir qual movimentação acompanha um aumento de saldo sem esse ponteiro (ela não enumera documentos). Hoje a regra liga movimentação → estoque (`getAfter`), mas não estoque → movimentação; para **aumentos** feitos por almoxarife essa ligação inversa é indispensável. Estoques antigos sem o campo continuam válidos.
- `users`: campo opcional `canAdjustStock` (bool), definido pelo admin. Já é aceito pela regra de update de admin; ausência = `false`.

## 4. Tipos TypeScript

Novos: `Receipt`, `Transfer`, `ReturnRecord`, `ReturnLedger`, `QuarantineStock`, `InventoryCount`, `InventoryCountItem`. Alterados: `StockMovement` (`reason` → `notes`; `operationType?`, `operationId?`), `UserProfile` (`canAdjustStock?`). `normalizeMovement` (Etapa 1) já lê `notes` e `reason`.

## 5. Alterações em `firestore.rules` (a justificar e testar; nada é publicado)

Princípio: manter o padrão que já existe para entregas — **a operação é um documento validado, e estoque/movimentação só mudam se baterem com ele via `getAfter`**.

1. `stockMovements`: novo ramo de `create` para não-admin com `type ∈ {ENTRY, TRANSFER, RETURN, ADJUSTMENT}` e `operationType/operationId` válidos, exigindo que o documento da operação exista (`getAfter`), pertença à mesma empresa e obra, tenha o mesmo `createdBy` e a mesma quantidade. Admin mantém o ramo atual.
2. `inventoryStock`: ramo de **aumento** para não-admin, permitido apenas quando a mesma transação grava a movimentação correspondente. O estoque grava `lastMovementId` (ID determinístico `{operationId}__{obraId}__{materialId}`) e a regra confere, via `getAfter(stockMovements/lastMovementId)`: mesma empresa, obra e material; `balanceBefore == resource.data.quantity`; `balanceAfter == request.resource.data.quantity`; `createdBy == request.auth.uid`; tipo permitido. Redução continua como hoje.
   - **Lacuna já existente (informativa):** a regra atual permite ao almoxarife *reduzir* `quantity` sem exigir movimentação (só a entrega a grava, por convenção do cliente). Não será alterada nesta etapa; fechar essa lacuna é uma decisão separada (seção 9, item 7).
3. Criação de estoque de destino inexistente: permitida a não-admin somente com `quantity == quantidade da transferência/recebimento` e movimentação associada; caso contrário, exige-se que o estoque exista (criado pelo catálogo, saldo zero).
4. Blocos novos para `receipts`, `transfers`, `returns`, `returnLedger`, `quarantineStock`, `inventoryCounts`, `inventoryCountItems`: leitura por empresa + `canAccessObra`; criação só com empresa/obra/uid corretos e obra pertencente à empresa (`get(obras/..).companyId`); `update` restrito às transições listadas; `delete: false`.
5. Permissão de ajuste: `canAdjustStock` lida com `profile().data.get('canAdjustStock', false)`.
6. Nenhuma regra existente é afrouxada; testes de regressão da suíte atual (`firestore.rules.test.ts`) devem continuar passando sem alteração.

## 6. Operações atômicas e idempotência

**Idempotência (todas):** o ID da operação é gerado **uma vez** quando o formulário abre (padrão de `newMaterialId` em `Materials.tsx`); a regra permite apenas `create` (nunca sobrescrever) e a transação aborta se o documento já existir; botão com `useRef` de envio em andamento. Reenvio, duplo clique e confirmação repetida resultam em "já registrado", não em novo lançamento.

**6.1 Recebimento** — `runTransaction`: lê estoque → cria `receipts/{id}` → atualiza estoque (+q) → cria movimentação `ENTRY` (`operationId`).
**6.2 Transferência** — Solicitação: cria `transfers/{id}` `PENDENTE` (checa saldo para feedback, sem reservar). Confirmação: `runTransaction` relê transferência (`PENDENTE`), relê **os dois** saldos, revalida `saldo ≥ q` → atualiza transferência (`CONCLUIDA`, `confirmedBy/At`) → origem −q → destino +q → duas movimentações `TRANSFER` (negativa e positiva). Cancelamento: update `PENDENTE→CANCELADA` com justificativa. Duas confirmações concorrentes: a segunda relê `status != PENDENTE` e aborta.
**6.3 Devolução** — `runTransaction`: lê entrega, ledger e estoque → valida `returned + q ≤ delivered` → cria `returns` → atualiza ledger → se `BOM_ESTADO`: estoque +q e movimentação `RETURN`; senão atualiza `quarantineStock`.
**6.4 Inventário** — cabeçalho criado em `EM_CONTAGEM` com `systemQty` de cada item. Confirmação **item a item**: transação relê o estoque e compara com `systemQty`; se diferente, **não ajusta** e marca "saldo mudou — recontar"; se igual, grava ajuste (`ADJUSTMENT`), `balanceBefore/After` e `adjusted:true`. Quando `itemsAdjusted == itemsTotal` o cabeçalho passa a `CONFIRMADA`. Motivo do desenho: limite de 20 acessos a documentos por transação nas regras.

## 7. Matriz de permissões proposta

| Operação | Admin | Almoxarife |
|---|---|---|
| Receber materiais | Sim | Obras atribuídas |
| Consultar recebimentos | Todas da empresa | Obras atribuídas |
| Solicitar transferência | Sim | Origem atribuída (destino: qualquer da empresa para solicitar) ⚠ |
| Confirmar transferência | Sim | **Origem e destino atribuídos** ⚠ |
| Cancelar transferência pendente | Sim | Quem solicitou, ou com acesso à origem |
| Registrar devolução | Sim | Obras atribuídas |
| Inspecionar devolução | Sim | Obras atribuídas |
| Iniciar inventário / registrar contagem | Sim | Obras atribuídas |
| Confirmar ajustes de inventário | Sim | Somente com `canAdjustStock = true` (definido pelo admin) |

Regras comuns: `companyId`, `obraId` e `userId` nunca são aceitos do cliente sem validação (empresa vem de `profile()`, obra é conferida em `obras/{id}` e `canAccessObra`, `createdBy == request.auth.uid`). Admin não perde nenhuma permissão atual.

## 8. Testes planejados

Cada módulo recebe testes **unitários** (cálculo/validação), de **transação** (adaptador simulado, como `inventory.test.ts`) e de **regras** (emulador). Cobertura exigida pelo prompt: recebimento (válido, quantidade inválida, sem permissão, obra não autorizada, duplicidade, falha, saldo e movimentação); transferência (válida, sem saldo, mesma obra, sem acesso a origem/destino, confirmação duplicada, cancelar pendente/concluída, concorrência, falha, consistência dos dois saldos); devolução (válida, acima do entregue, duplicada, danificado, inservível, pendente, sem permissão, estoque disponível, entrega original intacta); inventário (sem divergência, sobra, falta, quantidade inválida, sem justificativa, sem permissão, alteração concorrente, confirmação duplicada, saldos anterior/posterior). Mais a regressão completa existente. Testes de regras incluem um **medidor do número de acessos a documentos** por transação.

## 9. Decisões que precisam de aprovação

1. **Alteração de `firestore.rules`** conforme a seção 5 (aditiva), apenas nesta branch, com testes no emulador, sem publicar.
2. **Confirmação de transferência:** exigir acesso às duas obras (como na matriz) ou permitir que o almoxarife do destino confirme o recebimento? A segunda opção quebra o isolamento por obra para o débito da origem; se for desejada, o caminho seguro é um estado "em trânsito" (origem debita ao despachar, destino credita ao receber), que o prompt não incluiu.
3. **`canAdjustStock`** em `users` para controlar quem confirma ajustes de inventário (admin define). Aceita?
4. **Descarte e quarentena:** ficam em `returns`/`quarantineStock`, sem movimentação de estoque (saldo disponível não muda). Aceita? A alternativa é permitir movimentação de quantidade zero, o que exigiria afrouxar `quantity != 0`.
5. **Lote/validade** apenas informativos no recebimento (sem saldo por lote). Aceita para esta etapa?
7. **Lacuna atual de auditoria:** hoje um almoxarife consegue reduzir saldo direto no Firestore sem movimentação (a regra só valida o contrário). Quer que a Etapa 2 também passe a exigir `lastMovementId` nas reduções? Isso fecharia a brecha, mas muda o fluxo de entrega homologado (exigiria ajustar `NewDelivery`/`inventory.ts` e re-testar PDF/assinatura). Recomendo **não** mexer agora e tratar depois como correção própria.
6. **Ambiente de testes:** o emulador do Firestore e `npm ci` exigem rede, indisponível nesta sessão. Para entregar testes de regras **executados**, é preciso uma sessão com rede liberada (Configurações → Rede). Sem isso o código sai escrito e não verificado, o que considero inadequado para regras de segurança.

## 10. Plano de implementação após aprovação

1. Tipos + regras + testes de regras (emulador) — primeiro, antes de qualquer tela.
2. Serviços transacionais (`lib/receiving.ts`, `transfers.ts`, `returns.ts`, `inventoryCount.ts`) com testes.
3. Telas na ordem: Recebimentos → Transferências → Devoluções → Inventário, com rotas, menu e estados de carregamento/duplo clique.
4. Integração ao histórico (`Movements.tsx`) e relatórios CSV (6 tipos).
5. Protótipo HTML atualizado.
6. Regressão completa, relatório final e patch.

---

## Atualização (implementação) — desvios em relação a esta proposta

Decisões do usuário aplicadas na implementação; onde diferem do texto acima, valem estas:

1. **Sem `quarantineStock`:** itens danificados/inservíveis/pendentes ficam apenas na coleção `returns` (condição, responsável, data, referência à entrega, inspeção posterior). O relatório "fora do estoque" é derivado dela.
2. **Destino da transferência deve já ter saldo cadastrado** (não é criado pela operação).
3. **Campo `lastMovementId` em `inventoryStock`:** necessário para que as regras vinculem o aumento de saldo à movimentação (`getAfter`).
4. **`canAdjustStock` em `users`:** concedido só pelo administrador; o convidado não pode se auto-conceder na criação do perfil (regra).
5. **Transferência:** exige acesso às duas obras; sem `EM_TRANSITO`; confirmação atômica; concluída não cancela (correção = nova transferência com `correctsTransferId` e motivo).
6. **Não implementado:** transição DANIFICADO → descarte após inspeção; retomada de contagem abandonada além de cancelar.
7. **Regras NÃO publicadas** e testes de regras NÃO executados (sem emulador/rede).
