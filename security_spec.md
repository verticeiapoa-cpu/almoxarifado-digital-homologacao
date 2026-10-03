# Especificação de segurança

## Identidade e entrada

- O administrador principal é `verticeiapoa@gmail.com`.
- Outros usuários somente criam o próprio perfil se existir convite pendente com o mesmo e-mail autenticado pelo Google.
- O perfil criado deve reproduzir exatamente empresa, função e obras do convite.
- O administrador principal não pode ser rebaixado.

## Autorização

- Administrador: acesso aos dados de sua empresa e gestão de usuários, convites, obras e catálogo.
- Almoxarife: acesso somente às obras atribuídas; pode registrar entregas e gerenciar colaboradores nessas obras.
- Nenhum perfil pode ler dados cujo `companyId` seja diferente do seu.
- O frontend filtra dados por usabilidade, mas a autorização efetiva é feita em `firestore.rules`.

## Histórico

- Entregas são append-only: não podem ser alteradas nem apagadas por clientes.
- Funcionários, EPIs e obras são inativados, nunca excluídos pelo aplicativo.
- Cada entrega contém snapshot do colaborador, obra, itens, operador, consentimento, assinatura e hash SHA-256.
- `serverCreatedAt` usa o horário confiável do Firestore e deve ser igual a `request.time` na criação.

## Validação

- A assinatura e o aceite são obrigatórios.
- Cada entrega aceita de 1 a 25 itens.
- Todos os itens têm descrição, CA textual e quantidade inteira positiva.
- O UID e o e-mail da auditoria devem corresponder à autenticação.

## Testes

Execute `npm run test:rules`. A suíte cobre usuário não convidado, bootstrap do administrador, convite, RBAC, isolamento entre empresas, imutabilidade e validação de entregas.
