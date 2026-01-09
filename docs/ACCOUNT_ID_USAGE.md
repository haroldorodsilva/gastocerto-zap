# Uso de AccountId nas Transações - Documentação (Contextual por Canal)

## Visão Geral

Este documento descreve como o sistema gerencia o `accountId` (ID do perfil/conta ativo) em cada plataforma e como ele é utilizado nas transações de forma **contextual por canal**, permitindo que o usuário utilize diferentes accountIds simultaneamente em diferentes plataformas sem interferência.

## 🎯 Conceito Principal: AccountId Contextual

**O accountId é identificado no provider (handler) e passado através de todo o fluxo sem alterar o banco de dados.**

Isso permite:
- 🔵 **Telegram**: usando accountId 1
- 🟢 **WebChat**: usando accountId 3
- 🟡 **WhatsApp**: usando accountId 2

Todos **simultaneamente**, sem que um interfira no outro, pois o accountId é **contextual da sessão/canal**.

## Como Funciona por Plataforma

### 1. WebChat 🌐

#### Recebimento do AccountId
- O `accountId` é enviado via **header HTTP** `x-account` em toda requisição
- O backend **NÃO** altera o `activeAccountId` no banco de dados
- O accountId é usado **diretamente** para aquela transação específica

```typescript
// Em: webchat.controller.ts
@Headers('x-account') accountId?: string

// Em: webchat.service.ts (processMessage)
const result = await this.transactionsService.processTextMessage(
  user,
  messageText,
  messageId,
  'webchat',
  undefined, // platformId
  accountId, // accountId contextual do header - NÃO altera banco
);
```

#### Uso nas Transações
- AccountId do header é passado diretamente para o `TransactionsService`
- **NÃO** altera o `activeAccountId` no banco de dados
- Permite que o usuário use diferentes contas simultaneamente em diferentes abas/dispositivos
- O usuário **NÃO PODE** usar comandos de texto para mudar perfil no webchat
- Mudança de perfil deve ser feita via interface gráfica do frontend

#### Comandos Bloqueados no WebChat
Os seguintes comandos são **bloqueados** e retornam mensagem informativa:
- "listar perfis" / "meus perfis" / "minhas contas"
- "mudar perfil" / "trocar perfil" / "mudar conta"
- "usar perfil" / "selecionar perfil"

**Mensagem retornada:**
```
💡 Para gerenciar seus perfis, utilize o menu de seleção de perfis na interface.

Você pode alternar entre seus perfis diretamente na tela, sem precisar enviar comandos.
```

---

### 2. WhatsApp & Telegram 📱

#### Busca do AccountId
- O `accountId` é **buscado automaticamente** do `user.activeAccountId` (cache/banco de dados)
- Quando o usuário é validado, o objeto completo é retornado incluindo `activeAccountId`
- Este `activeAccountId` é passado para todas as transações do canal

```typescript
// Em: telegram-message.handler.ts / whatsapp-message.handler.ts
const user = validation.user!; // Objeto user completo do cache
const accountId = user.activeAccountId; // AccountId ativo no banco

// Passar para transações
await this.transactionsService.processTextMessage(
  user,
  message.text,
  message.id,
  platform,
  userId,
  accountId, // AccountId do cache/banco - contextual para esse canal
);
```

#### Mudança de Conta
- Usuário pode usar **comandos de texto** para listar e mudar perfil:
  - "meus perfis" → Lista todos os perfis
  - "mudar perfil [nome]" → Troca para o perfil especificado
  - Número (1, 2, 3) → Seleciona perfil da lista

- Quando o perfil é trocado, o `activeAccountId` é atualizado no banco/cache
- Próximas transações usarão automaticamente o novo `activeAccountId`
- Este `activeAccountId` é **independente** do WebChat - não afeta transações feitas via web

#### Uso nas Transações
- O `accountId` do cache é passado diretamente para todas as operações do canal
- Cada canal mantém seu contexto de `accountId` independente
- WhatsApp e Telegram usam o `activeAccountId` gravado no banco de dados

#### Exemplo de Independência entre Canais
```
Usuário Maria (telefone +5511999999999):
- No WhatsApp: activeAccountId = 1 (conta pessoal) - gravado no banco
- No Telegram: activeAccountId = 1 (mesma conta) - gravado no banco
- No WebChat: usa header x-account: 3 (conta empresarial) - NÃO grava no banco

Resultado:
- Transações via WhatsApp/Telegram → vão para conta 1
- Transações via WebChat → vão para conta 3
- NENHUMA interferência entre os canais
- activeAccountId no banco permanece = 1 (usado por WhatsApp/Telegram)
```

---

## 🔄 Fluxo Completo por Plataforma

### WebChat Flow

```
1. Frontend envia POST /webchat/send-message
   Headers: { x-account: "3" }
   
2. WebchatController extrai accountId do header
   const accountId = req.headers['x-account'];
   
3. WebchatService valida usuário e passa accountId
   await this.transactionsService.processTextMessage(
     user, message, ..., accountId // ← accountId do header
   );
   
4. TransactionsService usa accountId passado
   const activeAccountId = accountId || user.activeAccountId;
   
5. RegistrationService recebe e usa accountId
   await this.processTextTransaction(..., accountId);
   
6. Transação criada com accountId = 3
   Banco de dados user.activeAccountId permanece inalterado
```

### WhatsApp/Telegram Flow

```
1. Mensagem recebida via webhook/polling
   
2. MessageHandler valida usuário
   const validation = await this.messageValidation.validateMessage(...);
   const user = validation.user!;
   
3. Extrai accountId do cache
   const accountId = user.activeAccountId; // ← Do banco de dados
   
4. Passa accountId para TransactionsService
   await this.transactionsService.processTextMessage(
     user, text, ..., accountId // ← accountId do banco
   );
   
5. TransactionsService usa accountId passado
   const activeAccountId = accountId || user.activeAccountId;
   
6. RegistrationService recebe e usa accountId
   await this.processTextTransaction(..., accountId);
   
7. Transação criada com accountId = 1 (do banco)
```

---

## Fluxo de Transações

### Registro de Transação (Novo Modelo)

```typescript
// TransactionsService
async processTextMessage(
  user: any,
  text: string,
  messageId: string,
  platform: string,
  userId: string,
  accountId?: string, // ← AccountId contextual (header ou cache)
) {
  // Usa accountId passado ou fallback para user.activeAccountId
  const activeAccountId = accountId || user.activeAccountId;
  
  // Passa para RegistrationService
  await this.registrationService.processTextTransaction(
    phoneNumber,
    text,
    messageId,
    user,
    platform,
    activeAccountId, // ← AccountId contextual
  );
}

// RegistrationService
async processTextTransaction(
  phoneNumber: string,
  text: string,
  messageId: string,
  user: any,
  platform: string,
  accountId?: string, // ← AccountId contextual
) {
  let activeAccountId: string;
  
  if (accountId) {
    // Usa accountId passado (contexto da plataforma)
    activeAccountId = accountId;
  } else {
    // Fallback: valida conta ativa do banco
    const accountValidation = await this.validateAccountBeforeTransaction(phoneNumber);
    activeAccountId = accountValidation.accountId;
  }
  
  // Busca categorias da conta contextual
  const categoriesData = await this.userCache.getUserCategories(
    phoneNumber,
    activeAccountId, // ← Conta contextual da plataforma
  );
  
  // Cria transação na API com conta contextual
  await this.gastoCertoApi.createTransaction(
    user.gastoCertoId,
    activeAccountId, // ← AccountId contextual (não necessariamente user.activeAccountId)
    transactionData,
  );
}
```

**Observações Importantes:**
- O `activeAccountId` usado na transação pode ser diferente de `user.activeAccountId` no banco
- No WebChat: `activeAccountId` vem do header, `user.activeAccountId` permanece inalterado
- No WhatsApp/Telegram: `activeAccountId` vem de `user.activeAccountId` do banco
- Cada canal opera com seu contexto independente

---

## 📊 Exemplos Práticos

### Exemplo 1: Usuário Simultâneo em Múltiplas Plataformas

```
Contexto:
- Usuário: João (+5511988887777)
- activeAccountId no banco: "1" (Conta Pessoal)

Ações:
1. João envia mensagem no WhatsApp: "café 5 reais"
   → Usa accountId = 1 (do banco)
   → Transação criada na conta 1
   
2. Simultaneamente, João usa WebChat com header x-account: "3"
   → Usa accountId = 3 (do header)
   → Transação criada na conta 3
   → activeAccountId no banco permanece = 1
   
3. João envia outra mensagem no WhatsApp: "almoço 25 reais"
   → Usa accountId = 1 (do banco, ainda inalterado)
   → Transação criada na conta 1

Resultado:
✅ Transações no WhatsApp: todas na conta 1
✅ Transações no WebChat: todas na conta 3
✅ Nenhuma interferência entre canais
```

### Exemplo 2: Mudança de Perfil via WhatsApp

```
Contexto:
- Usuário: Maria (+5511977776666)
- activeAccountId no banco: "1"

Ações:
1. Maria envia no WhatsApp: "meus perfis"
   → Sistema lista: 1. Pessoal, 2. Trabalho
   
2. Maria envia: "2"
   → Sistema atualiza banco: activeAccountId = "2"
   
3. Maria envia: "uber 30 reais"
   → Usa accountId = 2 (agora do banco)
   → Transação criada na conta 2
   
4. Maria acessa WebChat com header x-account: "1"
   → Usa accountId = 1 (do header)
   → Transação criada na conta 1
   → activeAccountId no banco permanece = 2
   
5. Maria volta ao WhatsApp: "taxi 15 reais"
   → Usa accountId = 2 (do banco, ainda = 2)
   → Transação criada na conta 2

Resultado:
✅ Mudança no WhatsApp afetou apenas WhatsApp/Telegram
✅ WebChat continuou usando accountId do header
✅ Independência total entre canais
```

---

## 🔍 Validação e Segurança

### Validação de AccountId no WebChat

```typescript
// WebchatService
async sendMessage(userId: string, message: string, accountId?: string) {
  // 1. Valida usuário
  const user = await this.validateUserAndLoadCache(userId);
  
  // 2. Se accountId fornecido, valida se pertence ao usuário
  if (accountId) {
    const accounts = await this.getUserAccounts(user.phoneNumber);
    const accountExists = accounts.some(acc => acc.id === accountId);
    
    if (!accountExists) {
      throw new UnauthorizedException('Conta não encontrada ou não pertence ao usuário');
    }
  }
  
  // 3. Passa accountId validado (ou undefined para usar padrão)
  await this.transactionsService.processTextMessage(
    user,
    message,
    ...,
    accountId, // ← Pode ser diferente de user.activeAccountId
  );
}
```

### Validação de AccountId no WhatsApp/Telegram

```typescript
// WhatsappMessageHandler / TelegramMessageHandler
async handleMessage(msg: any) {
  // 1. Valida usuário
  const validation = await this.messageValidation.validateMessage(...);
  const user = validation.user!;
  
  // 2. Usa activeAccountId do cache (já validado)
  const accountId = user.activeAccountId;
  
  // 3. Passa accountId do banco para transações
  await this.transactionsService.processTextMessage(
    user,
    text,
    ...,
    accountId, // ← Do banco, sempre válido
  );
}
```

---

## ⚙️ Outras Operações com AccountId Contextual

### Listagem de Transações

**Modelo Atual:**
```typescript
// TransactionListingService
async listTransactions(user, options) {
  const result = await this.gastoCertoApi.listTransactions(
    user.gastoCertoId,
    user.activeAccountId, // ← Usa sempre do banco
    filters,
  );
}
```

**Consideração para Futura Atualização:**
- No WebChat, poderia aceitar `accountId` como parâmetro do header para listar transações de conta específica
- Manteria compatibilidade com WhatsApp/Telegram que usam `user.activeAccountId`

### Pagamento de Contas

**Modelo Atual:**
```typescript
// TransactionPaymentService
async processPayment(user, request) {
  const pendingBills = await this.gastoCertoApi.listPendingBills(
    user.gastoCertoId,
    user.activeAccountId, // ← Usa do banco
  );
}
```

**Consideração para Futura Atualização:**
- Similar à listagem, poderia aceitar `accountId` contextual no WebChat
- Manteria uso de `user.activeAccountId` em WhatsApp/Telegram

### Resumos e Saldos

**Modelo Atual:**
```typescript
// TransactionSummaryService
async generateSummary(user, options) {
  const result = await this.gastoCertoApi.getMonthlySummary(
    user.activeAccountId, // ← Usa do banco
    month,
    year,
  );
}
```

**Consideração para Futura Atualização:**
- Estas operações ainda usam `user.activeAccountId` do banco
- Para consistência total, poderiam ser atualizadas para aceitar `accountId` contextual
- Prioridade menor pois não criam novos dados, apenas consultam

---

## 🔒 Validação de Conta Ativa

### Antes de Processar Transações (Fallback)

```typescript
// Em: registration.service.ts
async processTextTransaction(..., accountId?: string) {
  let activeAccountId: string;
  
  if (accountId) {
    // Usa accountId contextual passado
    activeAccountId = accountId;
  } else {
    // Fallback: valida conta ativa do banco
    const accountValidation = await this.validateAccountBeforeTransaction(phoneNumber);
    
    if (!accountValidation.valid) {
      return {
        success: false,
        message: accountValidation.message || '❌ Você não possui um perfil ativo.',
      };
    }
    
    activeAccountId = accountValidation.accountId;
  }
  
  // Continua processamento com activeAccountId definido...
}
```

### Operações que NÃO Requerem Conta Ativa

Estas operações podem ser executadas sem `activeAccountId`:
- `LIST_ACCOUNTS` - Listar contas disponíveis
- `SHOW_ACTIVE_ACCOUNT` - Mostrar conta ativa
- `SWITCH_ACCOUNT` - Trocar de conta (altera banco em WhatsApp/Telegram)
- `CONFIRMATION_RESPONSE` - Confirmar transação pendente
- `HELP` - Ajuda
- `GREETING` - Saudações

---

## 📦 Estrutura do Objeto User

```typescript
interface UserCache {
  id: string;
  gastoCertoId: string;
  phoneNumber: string;
  name: string;
  email?: string;
  telegramId?: string;
  
  // ← CAMPO USADO POR WHATSAPP/TELEGRAM
  activeAccountId: string | null; // Gravado no banco
  
  isActive: boolean;
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## ✅ Checklist de Implementação

### ✅ WebChat
- [x] AccountId recebido via header `x-account`
- [x] **NÃO sincroniza** com banco de dados (`activeAccountId` não é alterado)
- [x] Comandos de gerenciamento de perfil bloqueados
- [x] Mensagem informativa direcionando para interface gráfica
- [x] AccountId passado como parâmetro contextual para transações
- [x] Transações criadas com `accountId` do header (independente do banco)

### ✅ WhatsApp & Telegram  
- [x] AccountId buscado automaticamente do cache/banco (`user.activeAccountId`)
- [x] Comandos de texto para gerenciar perfis funcionam
- [x] `user.activeAccountId` atualizado ao trocar perfil (persiste no banco)
- [x] AccountId passado como parâmetro contextual para transações
- [x] Transações usam `accountId` do banco (independente do WebChat)

### ✅ TransactionsService
- [x] Aceita parâmetro opcional `accountId` em todos os métodos
- [x] Usa `accountId || user.activeAccountId` (fallback)
- [x] Passa `accountId` para RegistrationService e outros serviços
- [x] Validação de conta ativa quando `accountId` não fornecido

### ✅ RegistrationService
- [x] Aceita parâmetro opcional `accountId` em métodos de processamento
- [x] Usa `accountId` passado prioritariamente
- [x] Fallback para validação de conta ativa se `accountId` não fornecido
- [x] Categorias e transações criadas com `accountId` contextual

---

## 📝 Exemplos de Uso

### WebChat - Frontend

```javascript
// Enviar mensagem com accountId no header
const response = await fetch('https://api.gastocerto.com.br/webchat/message', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'x-account': selectedAccountId, // ← accountId selecionado na UI
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'Gastei 50 reais no mercado',
  }),
});

// IMPORTANTE: O backend NÃO altera user.activeAccountId no banco
// A transação será criada com o accountId do header
// Outras abas/dispositivos não são afetados
```

### WebChat - Tentativa de Comando Bloqueado

```
Usuário (no WebChat): "listar perfis"

Bot responde:
💡 Para gerenciar seus perfis, utilize o menu de seleção de perfis na interface.

Você pode alternar entre seus perfis diretamente na tela, sem precisar enviar comandos.
```

### WhatsApp/Telegram - Comandos de Perfil

```
Usuário: "meus perfis"
Bot: 
🏦 Seus Perfis:

✅ 1. Pessoal 🌟
⚪ 2. Trabalho
⚪ 3. Freelance

💡 Para trocar de perfil, digite: "mudar perfil" ou "usar [nome]"

---

Usuário: "mudar perfil Trabalho"
Bot:
✅ Perfil alterado com sucesso!

Agora você está usando: Trabalho

Todas as transações serão registradas neste perfil.
(activeAccountId no banco foi atualizado para "2")

---

Usuário: "gastei 100 reais em almoço"
Bot: [Registra transação na conta "Trabalho" (id=2)]
```

---

## 🎯 Resumo da Arquitetura

### Princípio Fundamental
**AccountId Contextual por Canal** - Cada plataforma mantém seu próprio contexto de `accountId` sem interferir nas outras.

### Comportamento por Plataforma

| Plataforma | Origem do AccountId | Altera Banco? | Suporta Troca? |
|------------|---------------------|---------------|----------------|
| **WebChat** | Header `x-account` | ❌ NÃO | ✅ Via UI Frontend |
| **WhatsApp** | `user.activeAccountId` (banco) | ✅ SIM | ✅ Via Comandos |
| **Telegram** | `user.activeAccountId` (banco) | ✅ SIM | ✅ Via Comandos |

### Fluxo de Dados

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  WebChat    │         │   WhatsApp       │         │   Telegram       │
│             │         │                  │         │                  │
│ accountId=3 │         │ activeAccountId=1│         │ activeAccountId=1│
│ (do header) │         │ (do banco)       │         │ (do banco)       │
└──────┬──────┘         └────────┬─────────┘         └────────┬─────────┘
       │                         │                            │
       │ accountId: 3            │ accountId: 1              │ accountId: 1
       ▼                         ▼                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                    TransactionsService                              │
│                                                                     │
│  processTextMessage(user, text, ..., accountId?)                   │
│  → const activeAccountId = accountId || user.activeAccountId       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    RegistrationService                              │
│                                                                     │
│  processTextTransaction(..., accountId?)                           │
│  → Uses accountId for categories and transaction creation          │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                       API GastoCerto                                │
│                                                                     │
│  createTransaction(gastoCertoId, accountId, data)                  │
│  → Transação criada na conta contextual                            │
└────────────────────────────────────────────────────────────────────┘
```

### Vantagens da Arquitetura

✅ **Independência Total**: Cada canal opera com seu próprio `accountId`  
✅ **Sem Conflitos**: Transações simultâneas em diferentes canais não interferem  
✅ **Flexibilidade**: WebChat pode usar qualquer conta via header  
✅ **Persistência**: WhatsApp/Telegram mantêm conta ativa no banco  
✅ **Segurança**: Validação de permissões em cada canal  

---

## 🔧 Conclusão

O sistema implementa **AccountId Contextual por Canal** permitindo:

1. **WebChat**: Usa `accountId` do header sem alterar banco de dados
2. **WhatsApp/Telegram**: Usa `activeAccountId` do banco com suporte a mudança via comandos
3. **Independência Total**: Nenhum canal interfere no outro
4. **Flexibilidade**: Usuário pode usar contas diferentes simultaneamente

**Status**: ✅ **Implementação Completa e Funcional**

Todas as transações (texto, imagem, áudio) seguem o mesmo padrão de `accountId` contextual, garantindo consistência em toda a aplicação.
