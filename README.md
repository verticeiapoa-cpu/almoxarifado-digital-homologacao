# Almoxarifado Digital — Wselent Empreendimentos

Aplicativo responsivo para registrar entregas de EPI, coletar assinatura eletrônica manuscrita, consultar o histórico por colaborador e gerar fichas em PDF.

## Módulos

1. Nova ficha de EPI com até cinco itens vinculados ao estoque, CA, quantidade, revisão, aceite e assinatura.
2. Histórico imutável com pesquisa por nome, CPF, cargo ou obra e PDF separado pela obra de vínculo.
3. Funcionários próprios/terceirizados, vínculo permanente com CNO e alocação temporária em outra obra.
4. Catálogo de EPIs global com saldo e estoque mínimo independentes por obra.
5. Obras e canteiros com endereço, CNO e status ativo/inativo.
6. Convites, usuários, perfis e obras autorizadas.
7. Seletor global de obra e navegação responsiva.
8. Login Google, RBAC e isolamento por empresa/obra nas regras do Firestore.
9. Alertas de estoque baixo por obra, enviados por API autenticada com Brevo configurado.

## Funcionário flutuante

A alocação temporária não altera a obra de vínculo nem o CNO do funcionário. Cada entrega registra separadamente:

- obra de vínculo permanente;
- obra onde o funcionário foi atendido;
- obra cujo estoque forneceu o material;
- autorização temporária, período e motivo.

O almoxarife só consegue selecionar estoques das obras autorizadas no próprio perfil. A baixa e a movimentação de auditoria são gravadas juntas em uma transação.

## Rodar localmente

Requisitos: Node.js 24 (mesma versão usada no deploy e na integração contínua).

```bash
npm install
npm run dev
```

## Verificações

```bash
npm run lint
npm run test:unit
npm run build
npm audit --omit=dev
```

Os testes das regras exigem Java 21+ e o download inicial do emulador do Firestore:

```bash
npm run test:rules
```

## Configuração Firebase

- Projeto: `gen-lang-client-0038131539`
- Banco nomeado: `ai-studio-docbrief-694b79f8-8d07-4aec-ab6b-3d02339ff834`
- Provedor: Google Authentication
- Administrador principal: `verticeiapoa@gmail.com`

No Firebase Authentication, mantenha somente os domínios reais do aplicativo em **Authorized domains**. Restrinja a chave pública do Firebase às APIs e aos domínios utilizados pelo projeto.

## Atenção antes de publicar as regras

Faça backup/exportação do Firestore. Registros antigos de `materials` criados pela versão original podem não ter `companyId`; eles precisam receber `companyId: "wselent-default"` antes da ativação das novas regras. Pré-cadastros antigos com IDs iniciados por `pre_` devem ser recriados como documentos da coleção `invitations`, usando o e-mail em minúsculas como ID.

Além dos registros legados descritos acima, os saldos antigos do catálogo devem ser migrados para `inventoryStock`, usando um documento por combinação de obra e material (`{obraId}__{materialId}`). Depois da migração e dos testes:

```bash
npm run deploy:rules
```

O arquivo `firebase.json` aponta explicitamente para o banco nomeado. Não publique as regras em outro banco sem revisar a configuração.

## Ativação dos alertas pelo Brevo

O destinatário é configurável pelo administrador em **Mais > Alertas de estoque**. Configure no ambiente de servidor da Vercel:

- `BREVO_API_KEY`: chave do serviço (segredo; nunca use prefixo `VITE_`).
- `BREVO_SENDER_EMAIL`: remetente validado no Brevo.
- `BREVO_SENDER_NAME`: nome opcional, padrão `WSELENT`.

Após configurar as variáveis, faça um novo deploy. `GET /api/stock-alert/status` informa apenas se as variáveis obrigatórias existem. `POST /api/stock-alert` exige token Firebase válido e verificado, lê o estoque e as configurações com as permissões do usuário e envia somente alertas devidos. Os testes usam transporte simulado e não enviam mensagens reais.

Sem essas variáveis, a entrega e a baixa de estoque continuam funcionando; os e-mails ficam indisponíveis. Esta versão não mantém uma fila de reenvio automático dos alertas que falharem.

## Implantação da interface e da API

```bash
npm run build
```

O build da interface fica em `dist/client`. Os arquivos `api/stock-alert.ts` e `api/stock-alert/status.ts` são Vercel Functions; o fallback da interface exclui `/api/`. O Worker de desenvolvimento reutiliza a mesma implementação do servidor.

Os testes de regressão cobrem cadastro, seleção por código, quantidade, revisão, assinatura, envio simulado e PDF. A validação real após login depende de uma sessão Google autorizada; os testes simulados não substituem essa confirmação.

## Observação sobre assinatura

O sistema registra uma assinatura eletrônica manuscrita na tela e mantém evidências técnicas de integridade. Ele não realiza autenticação biométrica nem usa certificado ICP-Brasil. A política jurídica e de retenção documental da empresa deve ser validada por profissional responsável antes do uso definitivo.
