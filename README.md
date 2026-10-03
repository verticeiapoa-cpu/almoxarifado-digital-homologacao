# Almoxarifado Digital — Wselent Empreendimentos

Aplicativo responsivo para registrar entregas de EPI, coletar assinatura eletrônica manuscrita, consultar o histórico por colaborador e gerar fichas em PDF.

## Módulos

1. Nova ficha de EPI com vários itens, item avulso, CA, quantidade, aceite e assinatura.
2. Histórico imutável com pesquisa por nome, CPF, cargo ou obra e PDF separado pela obra de vínculo.
3. Funcionários próprios/terceirizados, vínculo permanente com CNO e alocação temporária em outra obra.
4. Catálogo de EPIs global com saldo e estoque mínimo independentes por obra.
5. Obras e canteiros com endereço, CNO e status ativo/inativo.
6. Convites, usuários, perfis e obras autorizadas.
7. Seletor global de obra e navegação responsiva.
8. Login Google, RBAC e isolamento por empresa/obra nas regras do Firestore.
9. Fila de alertas de estoque baixo por obra, preparada para envio seguro pelo Brevo.

## Funcionário flutuante

A alocação temporária não altera a obra de vínculo nem o CNO do funcionário. Cada entrega registra separadamente:

- obra de vínculo permanente;
- obra onde o funcionário foi atendido;
- obra cujo estoque forneceu o material;
- autorização temporária, período e motivo.

O almoxarife só consegue selecionar estoques das obras autorizadas no próprio perfil. A baixa e a movimentação de auditoria são gravadas juntas em uma transação.

## Rodar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

## Verificações

```bash
npm run lint
npm run build
npm audit --omit=dev
```

Os testes das regras exigem Java 11+ e o download inicial do emulador do Firestore:

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

A aplicação grava cada aviso autorizado na coleção `mail`. O envio deve ser processado em um ambiente de servidor, usando a chave do Brevo como segredo; nunca inclua essa chave no código do navegador. O destinatário é configurável pelo administrador em **Mais > Alertas de estoque**.

Enquanto o processador seguro do Brevo não estiver ativo, os avisos ficam registrados na fila, mas nenhum e-mail é transmitido.

## Implantação da interface

O build gera a pasta `dist`:

```bash
npm run build
```

O `vercel.json` contém o redirecionamento necessário para que rotas como `/history` e `/employees` continuem funcionando após atualizar a página.

## Observação sobre assinatura

O sistema registra uma assinatura eletrônica manuscrita na tela e mantém evidências técnicas de integridade. Ele não realiza autenticação biométrica nem usa certificado ICP-Brasil. A política jurídica e de retenção documental da empresa deve ser validada por profissional responsável antes do uso definitivo.
