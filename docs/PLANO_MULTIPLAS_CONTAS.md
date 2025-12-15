# 🏢 PLANO: GERENCIAMENTO DE MÚLTIPLAS CONTAS + ENDPOINTS

**Data:** 15 de dezembro de 2025  
**Objetivo:** Permitir usuário trocar entre contas (Pessoal, PJ, Empresa A, etc.) e implementar endpoints faltantes  
**Prioridade:** 🔴 CRÍTICA - Requisito fundamental para sistema funcionar

---

## 🎯 PROBLEMA ATUAL

### Situação
- ✅ Usuário pode ter **múltiplas contas** no Gasto Certo:
  - **Pessoal** (pessoa física)
  - **PJ** (empresa)
  - **Empresa A** (outra empresa)
  - **Empresa B** (mais uma empresa)

- ❌ Sistema **NÃO sabe qual conta usar** ao:
  - Registrar transação
  - Listar transações
  - Consultar saldo
  - Pagar conta
  - Buscar categorias

### Exemplo do Problema
```
👤 Usuário: "Gastei 100 de almoço"

🤖 Bot registra em: ??? (Pessoal ou PJ?)
```

**Resultado:** Transação registrada na conta errada! 😱

---

## ✅ SOLUÇÃO: CONTA ATIVA

### Conceito
- Cada usuário tem uma **conta ativa** por vez
- Todas operações usam a **conta ativa automaticamente**
- Usuário pode **trocar de conta** quando quiser via mensagem

### Fluxo
```
1. Onboarding:
   - Busca contas do usuário na API
   - Salva lista de contas no UserCache
   - Define activeAccountId = conta primária (isPrimary: true)

2. Uso Normal:
   - "Gastei 100 de almoço" → Registra na conta ativa
   - "Listar transações" → Mostra da conta ativa
   - "Qual meu saldo?" → Saldo da conta ativa

3. Trocar Conta:
   - "mudar conta" → Lista contas → Usuário escolhe → Atualiza activeAccountId
   - "/conta pj" → Troca direto para conta "PJ"
   - "usar empresa A" → Troca para conta "Empresa A"
```

---

## 📊 SCHEMA - ATUALIZAÇÃO NECESSÁRIA

### 1. UserCache - Adicionar Campos

**Arquivo:** `src/prisma/schema.prisma`

```prisma
model UserCache {
  id                       String                    @id @default(uuid())
  phoneNumber              String                    @unique
  gastoCertoId             String                    @unique
  whatsappId               String?
  telegramId               String?
  email                    String
  name                     String
  hasActiveSubscription    Boolean                   @default(false)
  
  // 🆕 NOVOS CAMPOS
  activeAccountId          String?                   // ID da conta ativa no momento
  accounts                 Json                      @default("[]") // Array de contas disponíveis
  
  categories               Json                      @default("[]")
  preferences              Json?
  lastSyncAt               DateTime                  @default(now())
  createdAt                DateTime                  @default(now())
  updatedAt                DateTime                  @updatedAt
  unrecognizedMessages     UnrecognizedMessage[]
  transactionConfirmations TransactionConfirmation[]

  @@index([phoneNumber])
  @@index([gastoCertoId])
  @@index([whatsappId])
  @@index([telegramId])
  @@index([activeAccountId]) // 🆕 NOVO ÍNDICE
  @@map("user_cache")
}
```

### 2. Estrutura de `accounts` (JSON)

```typescript
interface UserAccount {
  id: string;           // ID da conta na API GastoCerto
  name: string;         // Nome da conta: "Pessoal", "PJ", "Empresa A"
  type: 'PERSONAL' | 'BUSINESS'; // Tipo de conta
  isPrimary: boolean;   // Se é a conta principal (padrão)
  createdAt: string;    // Data de criação
}

// Exemplo salvo no UserCache.accounts:
[
  { id: "acc-123", name: "Pessoal", type: "PERSONAL", isPrimary: true, createdAt: "2024-01-01" },
  { id: "acc-456", name: "PJ", type: "BUSINESS", isPrimary: false, createdAt: "2024-06-01" },
  { id: "acc-789", name: "Empresa A - Importação", type: "BUSINESS", isPrimary: false, createdAt: "2024-10-01" }
]
```

---

## 🔧 IMPLEMENTAÇÃO - FASE 1: MIGRATIONS E SERVICES

### Sprint 1.1: Migration Prisma (1 hora)

**Arquivo:** `prisma/migrations/XXX_add_active_account_to_user_cache.sql`

```sql
-- AlterTable
ALTER TABLE "user_cache" 
ADD COLUMN "activeAccountId" TEXT,
ADD COLUMN "accounts" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "user_cache_activeAccountId_idx" ON "user_cache"("activeAccountId");
```

**Comandos:**
```bash
# Gerar migration
npx prisma migrate dev --name add_active_account_to_user_cache

# Aplicar
npx prisma migrate deploy

# Gerar Prisma Client
npx prisma generate
```

---

### Sprint 1.2: UserCacheService - Métodos de Conta (2 horas)

**Arquivo:** `src/features/users/user-cache.service.ts`

**Adicionar métodos:**

```typescript
/**
 * Atualiza lista de contas do usuário
 */
async updateAccounts(
  phoneNumber: string,
  accounts: UserAccount[],
): Promise<void> {
  this.logger.log(`📋 Atualizando contas para ${phoneNumber}`);

  // Define conta ativa = primeira conta primária
  const primaryAccount = accounts.find(acc => acc.isPrimary);
  const activeAccountId = primaryAccount?.id || accounts[0]?.id || null;

  await this.prisma.userCache.update({
    where: { phoneNumber },
    data: {
      accounts: JSON.stringify(accounts),
      activeAccountId,
    },
  });

  this.logger.log(`✅ Conta ativa definida: ${activeAccountId}`);
}

/**
 * Troca conta ativa do usuário
 */
async switchAccount(
  phoneNumber: string,
  accountId: string,
): Promise<{ success: boolean; message: string; account?: UserAccount }> {
  this.logger.log(`🔄 Trocando conta ativa para ${accountId}`);

  const user = await this.getUser(phoneNumber);
  if (!user) {
    return {
      success: false,
      message: '❌ Usuário não encontrado.',
    };
  }

  const accounts = JSON.parse(user.accounts as string) as UserAccount[];
  const account = accounts.find(acc => acc.id === accountId);

  if (!account) {
    return {
      success: false,
      message: '❌ Conta não encontrada.',
    };
  }

  await this.prisma.userCache.update({
    where: { phoneNumber },
    data: { activeAccountId: accountId },
  });

  this.logger.log(`✅ Conta trocada: ${account.name}`);

  return {
    success: true,
    message: `✅ Conta alterada para: ${account.name}`,
    account,
  };
}

/**
 * Lista contas do usuário
 */
async listAccounts(phoneNumber: string): Promise<UserAccount[]> {
  const user = await this.getUser(phoneNumber);
  if (!user || !user.accounts) {
    return [];
  }

  return JSON.parse(user.accounts as string) as UserAccount[];
}

/**
 * Busca conta ativa do usuário
 */
async getActiveAccount(phoneNumber: string): Promise<UserAccount | null> {
  const user = await this.getUser(phoneNumber);
  if (!user || !user.activeAccountId || !user.accounts) {
    return null;
  }

  const accounts = JSON.parse(user.accounts as string) as UserAccount[];
  return accounts.find(acc => acc.id === user.activeAccountId) || null;
}
```

---

### Sprint 1.3: OnboardingService - Buscar Contas na Criação (1 hora)

**Arquivo:** `src/features/onboarding/onboarding.service.ts`

**Atualizar método `createUser()`:**

```typescript
async createUser(phoneNumber: string) {
  // ... código existente de criação

  // 🆕 BUSCAR CONTAS DO USUÁRIO
  const accountsResult = await this.gastoCertoApi.getAccounts(createdUser.id);
  
  if (accountsResult.success && accountsResult.accounts.length > 0) {
    const accounts: UserAccount[] = accountsResult.accounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      isPrimary: acc.isPrimary,
      createdAt: acc.createdAt,
    }));

    // Salvar contas no cache
    await this.userCache.updateAccounts(phoneNumber, accounts);

    this.logger.log(`✅ ${accounts.length} contas sincronizadas para ${phoneNumber}`);
  }

  // ... resto do código
}
```

---

## 🔧 IMPLEMENTAÇÃO - FASE 2: INTENTS E COMANDOS

### Sprint 2.1: MessageIntent - Adicionar Novos Intents (30 min)

**Arquivo:** `src/features/intent/intent-analyzer.service.ts`

```typescript
export enum MessageIntent {
  REGISTER_TRANSACTION = 'REGISTER_TRANSACTION',
  CONFIRMATION_RESPONSE = 'CONFIRMATION_RESPONSE',
  LIST_PENDING = 'LIST_PENDING',
  CHECK_BALANCE = 'CHECK_BALANCE',
  LIST_TRANSACTIONS = 'LIST_TRANSACTIONS',
  
  // 🆕 NOVOS INTENTS
  SWITCH_ACCOUNT = 'SWITCH_ACCOUNT',       // Trocar conta ativa
  LIST_ACCOUNTS = 'LIST_ACCOUNTS',         // Listar minhas contas
  SHOW_ACTIVE_ACCOUNT = 'SHOW_ACTIVE_ACCOUNT', // Mostrar conta ativa atual
  PAY_BILL = 'PAY_BILL',                   // Pagar conta/fatura
  
  HELP = 'HELP',
  GREETING = 'GREETING',
  UNKNOWN = 'UNKNOWN',
  IRRELEVANT = 'IRRELEVANT',
}
```

---

### Sprint 2.2: IntentAnalyzer - Detectar Novos Intents (1 hora)

**Arquivo:** `src/features/intent/intent-analyzer.service.ts`

**Adicionar no método `analyzeIntent()`:**

```typescript
async analyzeIntent(text: string, phoneNumber: string, userId?: string): Promise<IntentAnalysisResult> {
  const normalizedText = text.toLowerCase().trim();

  // ... intents existentes

  // 🆕 TROCAR CONTA
  const switchAccountKeywords = [
    'mudar conta',
    'trocar conta',
    'mudar empresa',
    'trocar empresa',
    'usar conta',
    'usar empresa',
    'mudar para',
    'trocar para',
  ];
  if (switchAccountKeywords.some(kw => normalizedText.includes(kw))) {
    return {
      intent: MessageIntent.SWITCH_ACCOUNT,
      confidence: 0.95,
      shouldProcess: true,
      metadata: { query: text },
    };
  }

  // 🆕 LISTAR CONTAS
  const listAccountsKeywords = [
    'minhas contas',
    'listar contas',
    'ver contas',
    'mostrar contas',
    'quais contas',
  ];
  if (listAccountsKeywords.some(kw => normalizedText.includes(kw))) {
    return {
      intent: MessageIntent.LIST_ACCOUNTS,
      confidence: 0.95,
      shouldProcess: true,
    };
  }

  // 🆕 MOSTRAR CONTA ATIVA
  if (
    normalizedText === '/conta' ||
    normalizedText === 'conta' ||
    normalizedText === 'conta ativa' ||
    normalizedText === 'qual conta'
  ) {
    return {
      intent: MessageIntent.SHOW_ACTIVE_ACCOUNT,
      confidence: 0.98,
      shouldProcess: true,
    };
  }

  // 🆕 PAGAR CONTA/FATURA
  const payBillKeywords = [
    'pagar',
    'quitar',
    'pagamento',
    'fatura',
    'conta pendente',
    'contas a pagar',
    'pagar fatura',
    'quitar fatura',
    'pagar conta',
  ];
  if (payBillKeywords.some(kw => normalizedText.includes(kw))) {
    return {
      intent: MessageIntent.PAY_BILL,
      confidence: 0.9,
      shouldProcess: true,
      metadata: { query: text },
    };
  }

  // 🆕 AJUDA
  if (
    normalizedText === '/ajuda' ||
    normalizedText === '/help' ||
    normalizedText === 'ajuda' ||
    normalizedText === 'help' ||
    normalizedText === 'comandos' ||
    normalizedText === 'o que posso fazer'
  ) {
    return {
      intent: MessageIntent.HELP,
      confidence: 0.99,
      shouldProcess: false,
      suggestedResponse: this.getHelpMessage(),
    };
  }

  // ... resto do código
}

/**
 * Mensagem de ajuda com todos os comandos
 */
private getHelpMessage(): string {
  return `
📖 **Comandos Disponíveis:**

💰 **Transações:**
• "Gastei 50 de almoço" - Registrar gasto
• "Recebi 100 de freela" - Registrar receita
• "Listar transações" - Ver transações do mês
• "Transações da semana" - Filtrar por período
• "Ver pendentes" - Transações aguardando confirmação

💳 **Pagamentos:**
• "Pagar fatura" - Pagar fatura do cartão
• "Ver contas a pagar" - Listar contas pendentes
• "Quitar conta de luz" - Pagar conta específica

💼 **Contas:**
• "/conta" - Ver conta ativa atual
• "Minhas contas" - Listar todas as contas
• "Mudar conta" - Trocar para outra conta
• "Usar PJ" - Trocar para conta PJ

💰 **Consultas:**
• "Qual meu saldo?" - Ver saldo da conta ativa
• "Resumo do mês" - Relatório mensal

❓ **Ajuda:**
• "/ajuda" ou "help" - Ver esta mensagem

🎯 **Dica:** Envie uma mensagem natural! Eu entendo contexto. 😊
  `.trim();
}
```

---

### Sprint 2.3: WhatsApp/Telegram Handler - Implementar Comandos de Conta (2 horas)

**Arquivo:** `src/infrastructure/whatsapp/messages/whatsapp-message.handler.ts`

**Adicionar no método `handleMessage()`:**

```typescript
async handleMessage(message: Message): Promise<void> {
  // ... código existente

  // Analisar intent
  const intentResult = await this.intentAnalyzer.analyzeIntent(
    message.body,
    phoneNumber,
    user?.id,
  );

  switch (intentResult.intent) {
    // ... cases existentes

    // 🆕 TROCAR CONTA
    case MessageIntent.SWITCH_ACCOUNT:
      await this.handleSwitchAccount(message.from, phoneNumber, message.body);
      break;

    // 🆕 LISTAR CONTAS
    case MessageIntent.LIST_ACCOUNTS:
      await this.handleListAccounts(message.from, phoneNumber);
      break;

    // 🆕 MOSTRAR CONTA ATIVA
    case MessageIntent.SHOW_ACTIVE_ACCOUNT:
      await this.handleShowActiveAccount(message.from, phoneNumber);
      break;

    // 🆕 PAGAR CONTA
    case MessageIntent.PAY_BILL:
      await this.handlePayBill(message.from, phoneNumber, message.body);
      break;

    // 🆕 AJUDA
    case MessageIntent.HELP:
      await this.emitReply(
        message.from,
        intentResult.suggestedResponse || 'Use /ajuda para ver comandos.',
        'HELP',
      );
      break;

    // ... resto do switch
  }
}

/**
 * Listar contas do usuário
 */
private async handleListAccounts(platformId: string, phoneNumber: string): Promise<void> {
  this.logger.log(`📋 [LIST_ACCOUNTS] Listando contas para ${phoneNumber}`);

  const accounts = await this.userCache.listAccounts(phoneNumber);

  if (accounts.length === 0) {
    await this.emitReply(
      platformId,
      '❌ Nenhuma conta encontrada. Entre em contato com o suporte.',
      'ACCOUNT_LIST',
    );
    return;
  }

  const user = await this.userCache.getUser(phoneNumber);
  const activeAccountId = user?.activeAccountId;

  let message = '📋 **Suas Contas:**\n\n';

  accounts.forEach((acc, index) => {
    const isActive = acc.id === activeAccountId;
    const icon = acc.type === 'PERSONAL' ? '💼' : '🏢';
    const activeTag = isActive ? ' ✅ (ativa)' : '';
    
    message += `${index + 1}. ${icon} ${acc.name}${activeTag}\n`;
  });

  message += '\n💡 Para trocar, digite: "mudar conta" ou "usar <nome>"';

  await this.emitReply(platformId, message, 'ACCOUNT_LIST');
}

/**
 * Mostrar conta ativa atual
 */
private async handleShowActiveAccount(platformId: string, phoneNumber: string): Promise<void> {
  this.logger.log(`📋 [SHOW_ACTIVE_ACCOUNT] Mostrando conta ativa para ${phoneNumber}`);

  const activeAccount = await this.userCache.getActiveAccount(phoneNumber);

  if (!activeAccount) {
    await this.emitReply(
      platformId,
      '❌ Nenhuma conta ativa. Use "minhas contas" para ver suas contas.',
      'ACTIVE_ACCOUNT',
    );
    return;
  }

  const icon = activeAccount.type === 'PERSONAL' ? '💼' : '🏢';
  const message = `
✅ **Conta Ativa:**

${icon} ${activeAccount.name}

Todas as transações serão registradas nesta conta.

Para trocar, digite: "mudar conta"
  `.trim();

  await this.emitReply(platformId, message, 'ACTIVE_ACCOUNT');
}

/**
 * Trocar conta ativa
 */
private async handleSwitchAccount(
  platformId: string,
  phoneNumber: string,
  messageText: string,
): Promise<void> {
  this.logger.log(`🔄 [SWITCH_ACCOUNT] Trocando conta para ${phoneNumber}`);

  // Buscar contas
  const accounts = await this.userCache.listAccounts(phoneNumber);

  if (accounts.length === 0) {
    await this.emitReply(
      platformId,
      '❌ Nenhuma conta encontrada.',
      'ACCOUNT_SWITCH',
    );
    return;
  }

  // Se mensagem contém nome da conta, trocar direto
  const normalizedText = messageText.toLowerCase();
  const matchedAccount = accounts.find(acc =>
    normalizedText.includes(acc.name.toLowerCase()),
  );

  if (matchedAccount) {
    // Trocar direto
    const result = await this.userCache.switchAccount(phoneNumber, matchedAccount.id);
    await this.emitReply(platformId, result.message, 'ACCOUNT_SWITCH');
    return;
  }

  // Se não, mostrar lista de contas para escolher
  const user = await this.userCache.getUser(phoneNumber);
  const activeAccountId = user?.activeAccountId;

  let message = '📋 **Escolha a conta:**\n\n';

  accounts.forEach((acc, index) => {
    const isActive = acc.id === activeAccountId;
    const icon = acc.type === 'PERSONAL' ? '💼' : '🏢';
    const activeTag = isActive ? ' ✅' : '';
    
    message += `${index + 1}. ${icon} ${acc.name}${activeTag}\n`;
  });

  message += '\n💡 Digite o número da conta ou o nome.';

  await this.emitReply(platformId, message, 'ACCOUNT_SWITCH_MENU');

  // TODO: Implementar resposta numérica (1, 2, 3) - requer contexto de conversa
}

/**
 * Processar pagamento
 */
private async handlePayBill(
  platformId: string,
  phoneNumber: string,
  messageText: string,
): Promise<void> {
  this.logger.log(`💳 [PAY_BILL] Processando pagamento para ${phoneNumber}`);

  const result = await this.transactionsService.processPayment(phoneNumber, messageText);

  await this.emitReply(platformId, result.message, 'PAYMENT_RESULT');
}
```

---

## 🔧 IMPLEMENTAÇÃO - FASE 3: ENDPOINTS COM accountId

### Sprint 3.1: GastoCertoApiService - Adicionar accountId (3 horas)

**Arquivo:** `src/shared/gasto-certo-api.service.ts`

#### 3.1.1 Atualizar listTransactions()

```typescript
async listTransactions(
  userId: string,
  accountId: string, // 🆕 NOVO PARÂMETRO
  filters: {
    startDate?: Date;
    endDate?: Date;
    category?: string;
    type?: 'EXPENSES' | 'INCOME';
    limit?: number;
  }
): Promise<{
  success: boolean;
  data: TransactionListItem[];
}> {
  try {
    this.logger.log(`📋 Listando transações - userId: ${userId}, accountId: ${accountId}`);

    const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
      userId,
      accountId,
      ...filters,
    });

    // Query string com accountId
    const params = new URLSearchParams({
      userId,
      accountId, // 🆕 NOVO
      startDate: filters.startDate?.toISOString() || '',
      endDate: filters.endDate?.toISOString() || '',
      ...(filters.category && { category: filters.category }),
      ...(filters.type && { type: filters.type }),
      ...(filters.limit && { limit: filters.limit.toString() }),
    });

    const response = await firstValueFrom(
      this.httpService.get<TransactionListResponseDto>(
        `${this.baseUrl}/external/transactions?${params.toString()}`,
        {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      ),
    );

    return {
      success: true,
      data: response.data.transactions || [],
    };
  } catch (error) {
    this.logger.error(`❌ Erro ao listar transações:`, error);
    return {
      success: false,
      data: [],
    };
  }
}
```

#### 3.1.2 Implementar getBalance() 🆕

```typescript
export interface BalanceResponseDto {
  success: boolean;
  balance: {
    accountId: string;
    accountName: string;
    total: number;
    currency: string;
    lastUpdated: string;
  };
}

async getBalance(
  userId: string,
  accountId: string, // 🆕 REQUERIDO
): Promise<BalanceResponseDto> {
  try {
    this.logger.log(`💰 Consultando saldo - userId: ${userId}, accountId: ${accountId}`);

    const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ userId, accountId });

    const response = await firstValueFrom(
      this.httpService.get<BalanceResponseDto>(
        `${this.baseUrl}/external/balance/${userId}?accountId=${accountId}`,
        {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      ),
    );

    if (response.data.success) {
      this.logger.log(`✅ Saldo: R$ ${response.data.balance.total} (${response.data.balance.accountName})`);
      return response.data;
    } else {
      this.logger.warn(`⚠️ Falha ao consultar saldo`);
      return {
        success: false,
        balance: {
          accountId,
          accountName: '',
          total: 0,
          currency: 'BRL',
          lastUpdated: new Date().toISOString(),
        },
      };
    }
  } catch (error) {
    this.logger.error(`❌ Erro ao consultar saldo:`, error);
    return {
      success: false,
      balance: {
        accountId,
        accountName: '',
        total: 0,
        currency: 'BRL',
        lastUpdated: new Date().toISOString(),
      },
    };
  }
}
```

#### 3.1.3 Implementar payTransaction() 🆕

```typescript
export interface PaymentRequestDto {
  userId: string;
  accountId: string;
  transactionId: string;
  paymentMethod?: 'DEBIT' | 'CREDIT' | 'PIX' | 'CASH';
  paymentDate?: Date;
  notes?: string;
}

export interface PaymentResponseDto {
  success: boolean;
  payment?: {
    id: string;
    transactionId: string;
    accountId: string;
    amount: number;
    paidAt: Date;
    paymentMethod: string;
  };
  message: string;
}

async payTransaction(
  data: PaymentRequestDto,
): Promise<PaymentResponseDto> {
  try {
    this.logger.log(
      `💳 Pagando transação ${data.transactionId} - userId: ${data.userId}, accountId: ${data.accountId}`
    );

    const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

    const response = await firstValueFrom(
      this.httpService.post<PaymentResponseDto>(
        `${this.baseUrl}/external/transactions/${data.transactionId}/pay`,
        {
          userId: data.userId,
          accountId: data.accountId,
          paymentMethod: data.paymentMethod || 'DEBIT',
          paymentDate: data.paymentDate || new Date(),
          notes: data.notes,
        },
        {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      ),
    );

    if (response.data.success) {
      this.logger.log(`✅ Transação paga com sucesso: ${data.transactionId}`);
      return response.data;
    } else {
      this.logger.warn(`⚠️ Falha ao pagar transação: ${response.data.message}`);
      return response.data;
    }
  } catch (error) {
    this.logger.error(`❌ Erro ao pagar transação:`, error);
    return {
      success: false,
      message: 'Erro ao processar pagamento. Tente novamente.',
    };
  }
}
```

#### 3.1.4 Implementar getCreditCardInvoice() 🆕

```typescript
export interface CreditCardInvoiceDto {
  success: boolean;
  invoice?: {
    accountId: string;
    monthReference: string; // "2024-12"
    totalAmount: number;
    dueDate: Date;
    isPaid: boolean;
    transactions: Array<{
      id: string;
      date: Date;
      description: string;
      amount: number;
      category: string;
    }>;
  };
}

async getCreditCardInvoice(
  userId: string,
  accountId: string,
  monthReference: string, // "2024-12"
): Promise<CreditCardInvoiceDto> {
  try {
    this.logger.log(
      `💳 Buscando fatura do cartão - userId: ${userId}, accountId: ${accountId}, month: ${monthReference}`
    );

    const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
      userId,
      accountId,
      monthReference,
    });

    const response = await firstValueFrom(
      this.httpService.get<CreditCardInvoiceDto>(
        `${this.baseUrl}/external/credit-card/invoice?userId=${userId}&accountId=${accountId}&month=${monthReference}`,
        {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      ),
    );

    if (response.data.success) {
      this.logger.log(`✅ Fatura encontrada: R$ ${response.data.invoice?.totalAmount}`);
      return response.data;
    } else {
      this.logger.warn(`⚠️ Fatura não encontrada`);
      return {
        success: false,
      };
    }
  } catch (error) {
    this.logger.error(`❌ Erro ao buscar fatura:`, error);
    return {
      success: false,
    };
  }
}
```

---

### Sprint 3.2: TransactionsService - Usar accountId (2 horas)

**Arquivo:** `src/features/transactions/transactions.service.ts`

#### 3.2.1 Atualizar getBalance()

```typescript
async getBalance(phoneNumber: string) {
  try {
    const user = await this.userCache.getUser(phoneNumber);
    if (!user) {
      return {
        success: false,
        message: '❌ Usuário não encontrado.',
      };
    }

    // 🆕 BUSCAR CONTA ATIVA
    const activeAccount = await this.userCache.getActiveAccount(phoneNumber);
    if (!activeAccount) {
      return {
        success: false,
        message: '❌ Nenhuma conta ativa. Use "minhas contas" para selecionar uma conta.',
      };
    }

    // ✅ BUSCAR SALDO REAL NA API COM accountId
    const balanceResult = await this.gastoCertoApi.getBalance(
      user.gastoCertoId,
      activeAccount.id, // 🆕 USANDO CONTA ATIVA
    );

    if (!balanceResult.success) {
      return {
        success: false,
        message: '❌ Erro ao consultar saldo. Tente novamente.',
      };
    }

    // ✅ FORMATAR MENSAGEM
    const { balance } = balanceResult;
    const message = `
💰 **Saldo - ${balance.accountName}**

**Saldo Atual:** R$ ${balance.total.toFixed(2)}

_Última atualização: ${new Date(balance.lastUpdated).toLocaleString('pt-BR')}_
    `.trim();

    return {
      success: true,
      message,
      balance: balance.total,
    };
  } catch (error) {
    this.logger.error('Erro ao buscar saldo:', error);
    return {
      success: false,
      message: '❌ Erro ao buscar saldo.',
    };
  }
}
```

#### 3.2.2 Atualizar listTransactions()

```typescript
async listTransactions(phoneNumber: string, filters?: any) {
  try {
    const user = await this.userCache.getUser(phoneNumber);
    if (!user) {
      return {
        success: false,
        message: '❌ Usuário não encontrado.',
      };
    }

    // 🆕 BUSCAR CONTA ATIVA
    const activeAccount = await this.userCache.getActiveAccount(phoneNumber);
    if (!activeAccount) {
      return {
        success: false,
        message: '❌ Nenhuma conta ativa. Use "minhas contas" para selecionar uma conta.',
      };
    }

    // ✅ CHAMAR LISTING SERVICE COM accountId
    return await this.listingService.listTransactions(
      user,
      activeAccount.id, // 🆕 USANDO CONTA ATIVA
      filters,
    );
  } catch (error) {
    this.logger.error('Erro ao listar transações:', error);
    return {
      success: false,
      message: '❌ Erro ao listar transações.',
    };
  }
}
```

#### 3.2.3 Atualizar processPayment()

```typescript
async processPayment(phoneNumber: string, message: string) {
  try {
    const user = await this.userCache.getUser(phoneNumber);
    if (!user) {
      return {
        success: false,
        message: '❌ Usuário não encontrado.',
      };
    }

    // 🆕 BUSCAR CONTA ATIVA
    const activeAccount = await this.userCache.getActiveAccount(phoneNumber);
    if (!activeAccount) {
      return {
        success: false,
        message: '❌ Nenhuma conta ativa. Use "minhas contas" para selecionar uma conta.',
      };
    }

    // TODO: Extrair intenção da mensagem e criar PaymentRequest apropriado
    // Por ora, retorna lista de pendentes da conta ativa
    return await this.paymentService.processPayment(
      user,
      activeAccount.id, // 🆕 USANDO CONTA ATIVA
      { paymentType: 'pending_list' },
    );
  } catch (error) {
    this.logger.error('Erro ao processar pagamento:', error);
    return {
      success: false,
      message: '❌ Erro ao processar pagamento.',
    };
  }
}
```

---

### Sprint 3.3: Atualizar TransactionListingService (1 hora)

**Arquivo:** `src/features/transactions/contexts/listing/listing.service.ts`

```typescript
async listTransactions(
  user: UserCache,
  accountId: string, // 🆕 NOVO PARÂMETRO
  filters: ListingFilters,
): Promise<{
  success: boolean;
  message: string;
  transactions?: TransactionListItem[];
}> {
  try {
    this.logger.log(
      `📋 [Listing] Buscando transações - userId: ${user.gastoCertoId}, accountId: ${accountId}`
    );

    // 1. Calcular datas baseado no período
    const dateRange = this.calculateDateRange(filters.period, filters.startDate, filters.endDate);

    // 2. Buscar transações na API COM accountId
    const result = await this.gastoCertoApi.listTransactions(
      user.gastoCertoId,
      accountId, // 🆕 USANDO accountId
      {
        startDate: new Date(dateRange.startDate),
        endDate: new Date(dateRange.endDate),
        category: filters.category,
        type: filters.type,
        limit: filters.limit || 20,
      },
    );

    // ... resto do código igual
  }
}
```

---

### Sprint 3.4: Atualizar TransactionPaymentService (1 hora)

**Arquivo:** `src/features/transactions/contexts/payment/payment.service.ts`

```typescript
async processPayment(
  user: UserCache,
  accountId: string, // 🆕 NOVO PARÂMETRO
  paymentRequest: PaymentRequest,
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    this.logger.log(
      `💳 [Payment] Processando pagamento - userId: ${user.gastoCertoId}, accountId: ${accountId}`
    );

    switch (paymentRequest.paymentType) {
      case 'credit_card':
        return await this.payCreditCardInvoice(user, accountId, paymentRequest.monthReference);

      case 'transaction_id':
        if (!paymentRequest.transactionId) {
          return {
            success: false,
            message: '❌ ID da transação não informado.',
          };
        }
        return await this.paySpecificTransaction(user, accountId, paymentRequest.transactionId);

      case 'bill':
        return await this.payBillByCategory(user, accountId, paymentRequest.category);

      case 'pending_list':
        return await this.listPendingPayments(user, accountId);

      default:
        return {
          success: false,
          message: '❓ Tipo de pagamento não reconhecido.',
        };
    }
  } catch (error) {
    this.logger.error(`❌ Erro ao processar pagamento:`, error);
    return {
      success: false,
      message: '❌ Erro ao processar pagamento. Tente novamente.',
    };
  }
}

private async payCreditCardInvoice(
  user: UserCache,
  accountId: string, // 🆕 NOVO PARÂMETRO
  monthReference?: string,
): Promise<{ success: boolean; message: string }> {
  const targetMonth = monthReference || this.getCurrentMonthReference();

  const result = await this.gastoCertoApi.getCreditCardInvoice(
    user.gastoCertoId,
    accountId, // 🆕 USANDO accountId
    targetMonth,
  );

  // ... resto do código
}

private async paySpecificTransaction(
  user: UserCache,
  accountId: string, // 🆕 NOVO PARÂMETRO
  transactionId: string,
): Promise<{ success: boolean; message: string }> {
  const result = await this.gastoCertoApi.payTransaction({
    userId: user.gastoCertoId,
    accountId, // 🆕 USANDO accountId
    transactionId,
  });

  // ... resto do código
}
```

---

### Sprint 3.5: Atualizar TransactionRegistrationService (1 hora)

**Arquivo:** `src/features/transactions/contexts/registration/registration.service.ts`

**Atualizar método `registerTransactionInAPI()`:**

```typescript
private async registerTransactionInAPI(
  user: UserCache,
  transactionData: any,
): Promise<{ success: boolean; transaction?: any }> {
  try {
    // 🆕 BUSCAR CONTA ATIVA
    const activeAccount = await this.userCache.getActiveAccount(user.phoneNumber);
    if (!activeAccount) {
      this.logger.error(`❌ Usuário ${user.phoneNumber} sem conta ativa`);
      return { success: false };
    }

    // Registrar transação COM accountId
    const dto: CreateGastoCertoTransactionDto = {
      userId: user.gastoCertoId,
      accountId: activeAccount.id, // 🆕 USANDO CONTA ATIVA
      type: transactionData.type,
      amount: transactionData.amount,
      category: transactionData.category,
      description: transactionData.description,
      date: transactionData.date,
      // ... outros campos
    };

    const result = await this.gastoCertoApi.createTransaction(dto);

    if (result.success) {
      this.logger.log(
        `✅ Transação registrada na conta: ${activeAccount.name} (${activeAccount.id})`
      );
      return {
        success: true,
        transaction: result.transaction,
      };
    }

    return { success: false };
  } catch (error) {
    this.logger.error('❌ Erro ao registrar transação na API:', error);
    return { success: false };
  }
}
```

---

## 📋 CHECKLIST COMPLETO

### 🗄️ Database & Schema
- [ ] Migration: Adicionar `activeAccountId` e `accounts` no UserCache
- [ ] Aplicar migration: `npx prisma migrate dev`
- [ ] Gerar Prisma Client: `npx prisma generate`

### 🔧 Services & Business Logic
- [ ] UserCacheService: Adicionar métodos de conta
  - [ ] `updateAccounts(phoneNumber, accounts)`
  - [ ] `switchAccount(phoneNumber, accountId)`
  - [ ] `listAccounts(phoneNumber)`
  - [ ] `getActiveAccount(phoneNumber)`
- [ ] OnboardingService: Buscar e salvar contas na criação de usuário
- [ ] IntentAnalyzer: Adicionar novos intents (SWITCH_ACCOUNT, LIST_ACCOUNTS, etc.)
- [ ] IntentAnalyzer: Adicionar detecção de comandos de conta
- [ ] IntentAnalyzer: Implementar mensagem de help

### 📡 API Integration
- [ ] GastoCertoApiService: Atualizar `listTransactions()` com accountId
- [ ] GastoCertoApiService: Implementar `getBalance(userId, accountId)`
- [ ] GastoCertoApiService: Implementar `payTransaction(data)`
- [ ] GastoCertoApiService: Implementar `getCreditCardInvoice(userId, accountId, month)`
- [ ] Criar DTOs: BalanceResponseDto, PaymentRequestDto, PaymentResponseDto, CreditCardInvoiceDto

### 🎯 Transaction Services
- [ ] TransactionsService: Atualizar `getBalance()` para usar conta ativa
- [ ] TransactionsService: Atualizar `listTransactions()` para usar conta ativa
- [ ] TransactionsService: Atualizar `processPayment()` para usar conta ativa
- [ ] TransactionListingService: Adicionar parâmetro `accountId`
- [ ] TransactionPaymentService: Adicionar parâmetro `accountId`
- [ ] TransactionRegistrationService: Usar conta ativa ao registrar

### 📱 Message Handlers
- [ ] WhatsAppMessageHandler: Implementar `handleListAccounts()`
- [ ] WhatsAppMessageHandler: Implementar `handleShowActiveAccount()`
- [ ] WhatsAppMessageHandler: Implementar `handleSwitchAccount()`
- [ ] WhatsAppMessageHandler: Implementar `handlePayBill()`
- [ ] WhatsAppMessageHandler: Adicionar case para HELP
- [ ] TelegramMessageHandler: Implementar mesmos métodos acima
- [ ] Adicionar todos os cases no switch de intent

### ✅ Testes
- [ ] Testar onboarding: Verifica se contas são salvas
- [ ] Testar listagem de contas: "minhas contas"
- [ ] Testar conta ativa: "/conta"
- [ ] Testar troca de conta: "mudar conta" → escolher
- [ ] Testar troca direta: "usar PJ"
- [ ] Testar registro de transação: Verifica se vai para conta ativa
- [ ] Testar listagem: "listar transações" → Filtra por conta ativa
- [ ] Testar saldo: "qual meu saldo?" → Mostra saldo da conta ativa
- [ ] Testar pagamento: "pagar fatura" → Processa na conta ativa
- [ ] Testar help: "/ajuda" → Mostra todos comandos

---

## 🚀 PLANO DE EXECUÇÃO (7 DIAS)

### **DIA 1 (Segunda) - Database & Cache (4h)**
- ✅ Sprint 1.1: Migration Prisma (1h)
- ✅ Sprint 1.2: UserCacheService métodos (2h)
- ✅ Sprint 1.3: OnboardingService buscar contas (1h)

### **DIA 2 (Terça) - Intents & Detection (4h)**
- ✅ Sprint 2.1: Adicionar novos intents (30min)
- ✅ Sprint 2.2: IntentAnalyzer detecção (1h)
- ✅ Sprint 2.3: Message Handlers comandos de conta (2h 30min)

### **DIA 3 (Quarta) - API Endpoints Parte 1 (4h)**
- ✅ Sprint 3.1.1: Atualizar listTransactions() (1h)
- ✅ Sprint 3.1.2: Implementar getBalance() (1h 30min)
- ✅ Sprint 3.1.3: Implementar payTransaction() (1h 30min)

### **DIA 4 (Quinta) - API Endpoints Parte 2 (4h)**
- ✅ Sprint 3.1.4: Implementar getCreditCardInvoice() (2h)
- ✅ Sprint 3.2.1: TransactionsService.getBalance() (1h)
- ✅ Sprint 3.2.2: TransactionsService.listTransactions() (1h)

### **DIA 5 (Sexta) - Services Integration (4h)**
- ✅ Sprint 3.2.3: TransactionsService.processPayment() (1h)
- ✅ Sprint 3.3: TransactionListingService (1h)
- ✅ Sprint 3.4: TransactionPaymentService (1h)
- ✅ Sprint 3.5: TransactionRegistrationService (1h)

### **DIA 6 (Sábado) - Testes Manuais (6h)**
- ✅ Testar fluxo completo de onboarding
- ✅ Testar todos comandos de conta
- ✅ Testar registro de transações
- ✅ Testar listagem e saldo
- ✅ Testar pagamentos
- ✅ Testar help e comandos
- ✅ Corrigir bugs encontrados

### **DIA 7 (Domingo) - Refinamento & Deploy (4h)**
- ✅ Melhorar mensagens de erro
- ✅ Adicionar logs detalhados
- ✅ Documentação final
- ✅ Deploy em produção
- ✅ Monitoramento 24h

**Total:** ~30 horas (~4 dias úteis de trabalho full-time)

---

## 📊 MÉTRICAS DE SUCESSO

### Funcionalidade
- ✅ Usuário pode listar suas contas
- ✅ Usuário pode ver conta ativa atual
- ✅ Usuário pode trocar de conta
- ✅ Todas operações usam conta ativa automaticamente
- ✅ Contas sincronizadas no onboarding

### Performance
- ✅ Troca de conta: < 500ms
- ✅ Listagem de contas: < 200ms
- ✅ Endpoints com accountId: < 2s

### UX
- ✅ Comandos intuitivos ("mudar conta", "usar PJ")
- ✅ Feedback claro sobre conta ativa
- ✅ Help completo com todos comandos
- ✅ Mensagens de erro claras

---

## 🎯 PRÓXIMA AÇÃO IMEDIATA

**COMEÇAR AGORA: DIA 1 - Sprint 1.1**

1. Criar migration Prisma
2. Aplicar migration
3. Gerar Prisma Client
4. Implementar métodos UserCacheService

**Comando:**
```bash
cd src/prisma
# Criar migration
npx prisma migrate dev --name add_active_account_to_user_cache
```

🚀 **Vamos começar?**
