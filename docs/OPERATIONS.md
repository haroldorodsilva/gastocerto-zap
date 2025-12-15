# 💼 Operações com Transações

## Visão Geral

Este documento descreve as operações disponíveis para gerenciar transações após o onboarding: listagem, filtros, consulta de saldo e processamento de pagamentos.

## 🎯 Funcionalidades

### 1️⃣ Listar Transações
- Histórico completo ou filtrado
- Paginação automática
- Filtros por período, categoria, tipo

### 2️⃣ Consultar Saldo
- Saldo geral da conta
- Saldo por categoria
- Resumo mensal

### 3️⃣ Processar Pagamentos
- Registrar pagamento de contas
- Quitação de faturas
- Confirmação de transferências

---

## 📋 Listagem de Transações

### Comandos Suportados

```
// Listar todas
"minhas transações"
"histórico"
"ver gastos"

// Filtro por período
"transações do mês"
"gastos de maio"
"compras da semana"

// Filtro por categoria
"gastos de alimentação"
"transações de transporte"
"compras no mercado"

// Filtro por tipo
"minhas despesas"
"minhas receitas"
```

---

### Fluxo de Listagem

```typescript
async listTransactions(phoneNumber, filters) {
  // 1. Buscar usuário
  const user = await userCache.getUser(phoneNumber);
  
  // 2. Buscar conta padrão
  const accountId = await getDefaultAccountId(user.id);
  
  // 3. Aplicar filtros
  const queryParams = {
    accountId,
    startDate: filters.startDate || null,
    endDate: filters.endDate || null,
    categoryId: filters.categoryId || null,
    type: filters.type || null, // EXPENSES ou INCOME
    page: filters.page || 1,
    limit: filters.limit || 10
  };
  
  // 4. Buscar na API
  const response = await gastoCertoApi.getTransactions(user.id, queryParams);
  
  // 5. Formatar resposta
  return formatTransactionList(response);
}
```

---

### Exemplo de Resposta

**Comando**: `"minhas transações do mês"`

**API Call**:
```typescript
GET /users/:userId/transactions?
  accountId=uuid&
  startDate=2025-05-01&
  endDate=2025-05-31&
  page=1&
  limit=10
```

**Resposta Formatada**:
```
📊 *Suas transações de Maio/2025*

📅 *21/05 (Hoje)*
🍔 Almoço restaurante - R$ 45,00
🚗 Uber - R$ 18,50

📅 *20/05 (Ontem)*
⚡ Conta de luz - R$ 150,00
🛒 Supermercado - R$ 127,35

📅 *19/05*
💊 Farmácia - R$ 32,80

📄 Página 1 de 3
💰 Total: R$ 373,65

➡️ Digite "próxima página" para ver mais
```

---

### Paginação

```typescript
// Primeira página (automática)
const page1 = await listTransactions(phoneNumber, { page: 1 });

// Usuário pede mais
if (userMessage.includes('próxima página')) {
  const context = await messageContext.getContext(phoneNumber);
  const nextPage = context.listingPage + 1;
  
  const pageN = await listTransactions(phoneNumber, { page: nextPage });
  
  // Atualizar contexto
  await messageContext.updateContext(phoneNumber, { listingPage: nextPage });
}
```

---

### Filtros Avançados

#### Por Período

```typescript
// Filtros predefinidos
const PERIOD_FILTERS = {
  'hoje': { startDate: startOfDay(), endDate: endOfDay() },
  'ontem': { startDate: startOfYesterday(), endDate: endOfYesterday() },
  'semana': { startDate: startOfWeek(), endDate: endOfWeek() },
  'mês': { startDate: startOfMonth(), endDate: endOfMonth() },
  'ano': { startDate: startOfYear(), endDate: endOfYear() }
};

// Filtro customizado
const extractDateRange = (text) => {
  // "transações de 10 a 20 de maio"
  // "gastos entre 01/05 e 15/05"
  const match = text.match(/(\d{1,2})\/(\d{1,2})/g);
  
  if (match && match.length === 2) {
    return {
      startDate: parseDate(match[0]),
      endDate: parseDate(match[1])
    };
  }
};
```

#### Por Categoria

```typescript
// Buscar categoria por nome (fuzzy match)
const findCategoryByName = (categories, searchTerm) => {
  return categories.find(cat => 
    cat.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
};

// Exemplo
const category = findCategoryByName(userCategories, 'alimentação');
// → { id: 'uuid', name: 'Alimentação', ... }
```

#### Por Tipo

```typescript
const TYPE_KEYWORDS = {
  EXPENSES: ['despesa', 'gasto', 'pagamento', 'compra'],
  INCOME: ['receita', 'entrada', 'ganho', 'salário']
};

const detectType = (text) => {
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return type;
    }
  }
  return null;
};
```

---

## 💰 Consulta de Saldo

### Comandos Suportados

```
// Saldo geral
"meu saldo"
"quanto tenho"
"saldo da conta"

// Saldo por categoria
"quanto gastei em alimentação"
"gastos de transporte"

// Resumo mensal
"resumo do mês"
"total de gastos"
```

---

### Fluxo de Consulta

```typescript
async getBalance(phoneNumber, filters) {
  // 1. Buscar usuário
  const user = await userCache.getUser(phoneNumber);
  
  // 2. Buscar conta padrão
  const accountId = await getDefaultAccountId(user.id);
  
  // 3. Buscar saldo na API
  const balance = await gastoCertoApi.getAccountBalance(user.id, accountId);
  
  // 4. Buscar resumo de gastos (opcional)
  const summary = await gastoCertoApi.getTransactionSummary(
    user.id, 
    accountId,
    filters
  );
  
  // 5. Formatar resposta
  return formatBalanceResponse(balance, summary);
}
```

---

### Exemplo de Resposta

**Comando**: `"meu saldo"`

**API Calls**:
```typescript
GET /users/:userId/accounts/:accountId/balance
GET /users/:userId/transactions/summary?accountId=uuid&month=5
```

**Resposta Formatada**:
```
💰 *Saldo da Conta*

🏦 Saldo atual: R$ 3.247,85

📊 *Resumo de Maio/2025*

📉 Despesas: R$ 2.450,30
  🍔 Alimentação: R$ 850,00
  🏠 Moradia: R$ 1.200,00
  🚗 Transporte: R$ 250,30
  🎮 Lazer: R$ 150,00

📈 Receitas: R$ 5.698,15
  💼 Salário: R$ 5.500,00
  💰 Freelance: R$ 198,15

➖➖➖➖➖➖➖➖➖
💵 Resultado: +R$ 3.247,85

📈 Você economizou 57% da sua renda!
```

---

### Saldo por Categoria

**Comando**: `"quanto gastei em alimentação este mês"`

**Resposta**:
```
🍔 *Gastos em Alimentação*
📅 Período: Maio/2025

💰 Total: R$ 850,00

📋 Detalhamento:
  🛒 Supermercado: R$ 450,00 (53%)
  🍽️ Restaurantes: R$ 280,00 (33%)
  ☕ Cafeteria: R$ 120,00 (14%)

📊 Média diária: R$ 40,48

⚠️ Isso representa 15% do seu salário
```

---

## 💳 Processamento de Pagamentos

### Comandos Suportados

```
// Registrar pagamento
"paguei a conta de luz"
"quitei o cartão"
"paguei R$ 150 de internet"

// Confirmar transferência
"transferi R$ 500 para João"
"enviei R$ 200 por Pix"
```

---

### Fluxo de Pagamento

```typescript
async processPayment(phoneNumber, text) {
  // 1. Extrair dados do pagamento via IA
  const paymentData = await aiFactory.extractTransaction(text, {
    ...userContext,
    intentHint: 'PAYMENT'
  });
  
  // 2. Validar dados
  const validation = validator.validate(paymentData);
  
  if (!validation.isValid) {
    return { success: false, message: validation.errors };
  }
  
  // 3. Buscar conta padrão
  const accountId = await getDefaultAccountId(user.id);
  
  // 4. Verificar se há fatura pendente relacionada
  const pendingBill = await gastoCertoApi.findPendingBill(
    user.id,
    accountId,
    {
      category: paymentData.category,
      approximateAmount: paymentData.amount
    }
  );
  
  if (pendingBill) {
    // 4a. Vincular pagamento à fatura
    await gastoCertoApi.payBill(user.id, pendingBill.id, {
      amount: paymentData.amount,
      date: paymentData.date,
      paymentMethod: paymentData.paymentMethod
    });
    
    return {
      success: true,
      message: formatBillPaymentConfirmation(pendingBill, paymentData)
    };
  } else {
    // 4b. Registrar como transação comum
    return await registrationService.processTextTransaction(
      phoneNumber,
      text,
      messageId,
      user
    );
  }
}
```

---

### Exemplo: Pagamento de Conta

**Comando**: `"Paguei R$ 150 de luz hoje"`

**Processamento**:
```typescript
// 1. Extrair dados
{
  type: 'EXPENSES',
  amount: 150.00,
  description: 'Conta de luz',
  category: 'Moradia',
  subCategory: 'Energia Elétrica',
  date: '2025-05-21',
  paymentMethod: null
}

// 2. Buscar fatura pendente
GET /users/:userId/bills?
  accountId=uuid&
  status=PENDING&
  category=Moradia&
  minAmount=140&
  maxAmount=160

// 3. Encontrou fatura: { id: 'bill-123', amount: 150, dueDate: '2025-05-20' }

// 4. Registrar pagamento
POST /users/:userId/bills/bill-123/pay
{
  amount: 150.00,
  date: '2025-05-21',
  paymentMethod: 'PIX'
}
```

**Resposta**:
```
✅ *Pagamento registrado!*

💡 Conta de Luz - R$ 150,00
📅 Vencimento: 20/05/2025
✅ Pago em: 21/05/2025

⏰ 1 dia de atraso
⚠️ Pode haver multa de R$ 2,50

💰 Saldo atualizado: R$ 3.097,85

🎯 Você tem mais 3 contas a vencer este mês
```

---

### Exemplo: Transferência Pix

**Comando**: `"Transferi R$ 500 para Maria por Pix"`

**Processamento**:
```typescript
// 1. Extrair dados
{
  type: 'EXPENSES',
  amount: 500.00,
  description: 'Transferência Pix para Maria',
  category: 'Transferências',
  subCategory: 'Pix',
  date: '2025-05-21',
  paymentMethod: 'PIX',
  recipient: 'Maria'
}

// 2. Registrar transação
POST /users/:userId/transactions
{
  accountId: 'uuid',
  type: 'EXPENSES',
  amount: 500.00,
  description: 'Transferência Pix para Maria',
  categoryId: 'uuid',
  subCategoryId: 'uuid',
  date: '2025-05-21',
  metadata: {
    paymentMethod: 'PIX',
    recipient: 'Maria'
  }
}
```

**Resposta**:
```
✅ *Transferência registrada!*

💸 Valor: R$ 500,00
👤 Para: Maria
💳 Método: Pix
📅 Data: 21/05/2025

💰 Novo saldo: R$ 2.597,85
```

---

## 🔍 API Endpoints Utilizadas

### Transações

```typescript
// Listar transações
GET /users/:userId/transactions
Query params:
  - accountId (required)
  - startDate (optional)
  - endDate (optional)
  - categoryId (optional)
  - type (optional): EXPENSES | INCOME
  - page (optional, default: 1)
  - limit (optional, default: 10)

Response:
{
  data: [
    {
      id: 'uuid',
      amount: 50.00,
      description: 'Almoço',
      date: '2025-05-21',
      category: { id: 'uuid', name: 'Alimentação' },
      subCategory: { id: 'uuid', name: 'Restaurante' },
      type: 'EXPENSES'
    }
  ],
  pagination: {
    page: 1,
    limit: 10,
    total: 45,
    totalPages: 5
  }
}

// Buscar por ID
GET /users/:userId/transactions/:transactionId

// Atualizar transação
PUT /users/:userId/transactions/:transactionId
Body:
{
  amount?: number,
  description?: string,
  categoryId?: string,
  subCategoryId?: string,
  date?: string
}

// Deletar transação
DELETE /users/:userId/transactions/:transactionId
```

---

### Contas

```typescript
// Listar contas do usuário
GET /users/:userId/accounts

Response:
{
  accounts: [
    {
      id: 'uuid',
      name: 'Conta Principal',
      balance: 3247.85,
      currency: 'BRL',
      isPrimary: true
    },
    {
      id: 'uuid2',
      name: 'Conta Poupança',
      balance: 5000.00,
      currency: 'BRL',
      isPrimary: false
    }
  ]
}

// Buscar saldo de conta
GET /users/:userId/accounts/:accountId/balance

Response:
{
  accountId: 'uuid',
  balance: 3247.85,
  currency: 'BRL',
  lastUpdate: '2025-05-21T14:30:00Z'
}
```

---

### Resumos e Análises

```typescript
// Resumo de transações
GET /users/:userId/transactions/summary
Query params:
  - accountId (required)
  - month (optional, default: current)
  - year (optional, default: current)

Response:
{
  period: { month: 5, year: 2025 },
  totalExpenses: 2450.30,
  totalIncome: 5698.15,
  balance: 3247.85,
  expensesByCategory: [
    { categoryId: 'uuid', name: 'Alimentação', amount: 850.00 },
    { categoryId: 'uuid', name: 'Moradia', amount: 1200.00 }
  ],
  incomeByCategory: [
    { categoryId: 'uuid', name: 'Salário', amount: 5500.00 }
  ]
}

// Comparação mensal
GET /users/:userId/analytics/comparison
Query params:
  - accountId (required)
  - months (default: 3)

Response:
{
  months: [
    { month: 'Março', expenses: 2100.00, income: 5500.00 },
    { month: 'Abril', expenses: 2300.00, income: 5500.00 },
    { month: 'Maio', expenses: 2450.30, income: 5698.15 }
  ],
  trend: 'INCREASING_EXPENSES',
  recommendation: 'Seus gastos aumentaram 7% este mês...'
}
```

---

### Contas a Pagar

```typescript
// Listar contas pendentes
GET /users/:userId/bills
Query params:
  - accountId (required)
  - status (optional): PENDING | PAID | OVERDUE
  - category (optional)

Response:
{
  bills: [
    {
      id: 'uuid',
      description: 'Conta de Luz',
      amount: 150.00,
      dueDate: '2025-05-20',
      status: 'PENDING',
      category: 'Moradia'
    }
  ]
}

// Registrar pagamento de conta
POST /users/:userId/bills/:billId/pay
Body:
{
  amount: number,
  date: string,
  paymentMethod?: string
}

Response:
{
  id: 'uuid',
  status: 'PAID',
  paidAt: '2025-05-21',
  paidAmount: 150.00,
  lateFee: 2.50
}
```

---

## 🎨 Formatação de Respostas

### Emojis por Categoria

```typescript
const CATEGORY_EMOJIS = {
  'Alimentação': '🍔',
  'Transporte': '🚗',
  'Moradia': '🏠',
  'Saúde': '💊',
  'Educação': '📚',
  'Lazer': '🎮',
  'Vestuário': '👕',
  'Transferências': '💸',
  'Investimentos': '📈',
  'Salário': '💼'
};
```

### Formatação de Valores

```typescript
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
};

// formatCurrency(1234.56) → "R$ 1.234,56"
```

### Formatação de Datas

```typescript
const formatDate = (date: string) => {
  const d = new Date(date);
  const today = new Date();
  
  if (isSameDay(d, today)) return 'Hoje';
  if (isSameDay(d, subDays(today, 1))) return 'Ontem';
  
  return format(d, "dd/MM/yyyy", { locale: ptBR });
};
```

---

## 🔧 Configurações

### Variáveis de Ambiente

```env
# Paginação
DEFAULT_PAGE_SIZE=10
MAX_PAGE_SIZE=50

# Limites
MAX_TRANSACTIONS_PER_QUERY=1000
TRANSACTION_CACHE_TTL=300  # 5 minutos

# Filtros
DEFAULT_PERIOD_DAYS=30
MAX_DATE_RANGE_DAYS=365
```

---

## 🧪 Testes

### Casos de Teste

1. **Listar Transações - Sem Filtros**:
   - Input: `"minhas transações"`
   - Output: Lista últimas 10 transações

2. **Listar Transações - Filtro de Período**:
   - Input: `"transações do mês"`
   - Output: Lista transações de maio/2025

3. **Listar Transações - Filtro de Categoria**:
   - Input: `"gastos de alimentação"`
   - Output: Lista apenas categoria alimentação

4. **Consultar Saldo**:
   - Input: `"meu saldo"`
   - Output: Saldo + resumo mensal

5. **Registrar Pagamento**:
   - Input: `"paguei a conta de luz R$ 150"`
   - Output: Confirmação + atualização de saldo

6. **Paginação**:
   - Input: `"minhas transações"` → `"próxima página"`
   - Output: Página 2 da lista

---

## 📊 Métricas

### KPIs Monitorados

- **Tempo de Resposta de Listagem**: < 500ms
- **Taxa de Uso de Filtros**: % usuários que usam filtros
- **Consultas de Saldo por Dia**: Média de consultas
- **Taxa de Pagamentos vs Transações**: Relação percentual

---

## 📚 Referências de Código

- `src/modules/transactions/contexts/listing/listing.service.ts`
- `src/modules/transactions/contexts/payment/payment.service.ts`
- `src/modules/transactions/contexts/summary/summary.service.ts`
- `src/modules/shared/gasto-certo-api.service.ts`
- `src/utils/date.util.ts`
- `src/utils/currency.util.ts`
