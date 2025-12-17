# Novos Endpoints Implementados - GastoCertoApiService

## 📋 Resumo

Implementados novos métodos no `GastoCertoApiService` para integração completa com a API externa do GastoCerto, incluindo listagem de cartões de crédito e detalhes de faturas.

---

## 🆕 Endpoints Adicionados

### 1. `listCreditCards()` - Listar Cartões de Crédito

**Endpoint da API**: `POST /external/cards`

**Arquivo**: `src/shared/gasto-certo-api.service.ts:879-925`

**Descrição**: Lista todos os cartões de crédito vinculados a uma conta do usuário.

**Parâmetros**:
```typescript
accountId: string  // ID da conta do usuário
```

**Retorno**:
```typescript
{
  success: boolean;
  data?: Array<{
    id: string;
    name: string;
    limit: number;              // Limite em centavos
    closingDay: number;         // Dia do fechamento (1-31)
    dueDay: number;             // Dia do vencimento (1-31)
    bankName: string;           // Nome do banco emissor
    createdAt: string;          // Data de criação (ISO 8601)
  }>;
  error?: string;
}
```

**Exemplo de Uso**:
```typescript
const result = await gastoCertoApi.listCreditCards(user.activeAccountId);

if (result.success && result.data) {
  console.log(`Encontrados ${result.data.length} cartão(ões)`);

  result.data.forEach((card) => {
    console.log(`
      ${card.name}
      Limite: R$ ${(card.limit / 100).toFixed(2)}
      Fecha: dia ${card.closingDay}
      Vence: dia ${card.dueDay}
      Banco: ${card.bankName}
    `);
  });
}
```

**Casos de Uso**:
- Listar cartões disponíveis para o usuário escolher
- Exibir resumo de todos os cartões e seus limites
- Permitir seleção de cartão para registro de transação
- Verificar cartões cadastrados antes de criar fatura

---

### 2. `getInvoiceDetails()` - Detalhes da Fatura

**Endpoint da API**: `POST /external/cards/invoices/details`

**Arquivo**: `src/shared/gasto-certo-api.service.ts:927-1000`

**Descrição**: Busca todos os detalhes de uma fatura específica, incluindo todas as transações vinculadas.

**Parâmetros**:
```typescript
accountId: string   // ID da conta do usuário
invoiceId: string   // ID da fatura
```

**Retorno**:
```typescript
{
  success: boolean;
  data?: {
    id: string;
    yearMonth: string;                          // Formato: "YYYY-MM"
    status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE';
    closingDate: string;                        // Data de fechamento (ISO 8601)
    dueDate: string;                            // Data de vencimento (ISO 8601)
    grossAmount: number;                        // Valor bruto em centavos
    totalAmount: number;                        // Valor líquido em centavos
    refundAmount: number;                       // Estornos em centavos
    advanceAmount: number;                      // Adiantamentos em centavos
    paidAmount: number;                         // Valor já pago em centavos
    creditCardName: string;                     // Nome do cartão
    transactions: Array<{
      id: string;
      description: string;
      amount: number;                           // Valor em centavos
      date: string;                             // Data da transação (ISO 8601)
      type: 'EXPENSES' | 'INCOME';
      categoryName: string;
      subCategoryName?: string;
      note?: string;
    }>;
  };
  error?: string;
}
```

**Fórmula de Cálculo**:
```
totalAmount = grossAmount - refundAmount - advanceAmount
```

**Exemplo de Uso**:
```typescript
const result = await gastoCertoApi.getInvoiceDetails(
  user.activeAccountId,
  invoiceId
);

if (result.success && result.data) {
  const invoice = result.data;

  console.log(`
    💳 Fatura - ${invoice.creditCardName}
    📅 ${invoice.yearMonth}

    💵 Total: R$ ${(invoice.totalAmount / 100).toFixed(2)}
    📊 ${invoice.transactions.length} transação(ões)
    📅 Vencimento: ${new Date(invoice.dueDate).toLocaleDateString('pt-BR')}
    ⚡ Status: ${invoice.status}
  `);

  // Listar transações
  invoice.transactions.forEach((tx, index) => {
    console.log(`
      ${index + 1}. ${tx.description}
      💸 R$ ${(tx.amount / 100).toFixed(2)}
      📂 ${tx.categoryName}${tx.subCategoryName ? ` • ${tx.subCategoryName}` : ''}
      📅 ${new Date(tx.date).toLocaleDateString('pt-BR')}
    `);
  });
}
```

**Casos de Uso**:
- Exibir fatura completa com todas as transações
- Permitir usuário revisar gastos antes de pagar
- Mostrar detalhamento de categorias da fatura
- Validar transações antes de confirmação de pagamento
- Gerar relatórios de gastos por cartão

---

## 🔄 Endpoints Existentes Atualizados

### 3. `listCreditCardInvoices()` - Lista Faturas

**Nota Importante**: Endpoint da documentação externa diverge do endpoint real.

- **Documentação Externa**: `POST /external/cards/invoices`
- **Endpoint Real (implementado)**: `POST /external/credit-card/invoices/list`

**Localização**: `src/shared/gasto-certo-api.service.ts:1002-1044`

**Comentário Adicionado**:
```typescript
/**
 * Lista faturas de cartão de crédito
 * Endpoint: POST /external/credit-card/invoices/list
 * Nota: Documentação usa /external/cards/invoices mas endpoint real é /external/credit-card/invoices/list
 */
```

---

## 📊 Resumo de Todos os Endpoints Relacionados a Cartões

### Endpoints Implementados:

| Método | Endpoint | Propósito |
|--------|----------|-----------|
| `listCreditCards()` | `POST /external/cards` | Lista cartões do usuário |
| `getInvoiceDetails()` | `POST /external/cards/invoices/details` | Detalhes completos de uma fatura |
| `listCreditCardInvoices()` | `POST /external/credit-card/invoices/list` | Lista faturas de um cartão |
| `payCreditCardInvoice()` | `POST /external/credit-card/invoices/pay` | Marca fatura como paga |

### Fluxo Típico de Uso:

1. **Listar Cartões**:
   ```typescript
   const cards = await gastoCertoApi.listCreditCards(accountId);
   ```

2. **Listar Faturas do Cartão**:
   ```typescript
   const invoices = await gastoCertoApi.listCreditCardInvoices(userId, 'CLOSED');
   ```

3. **Ver Detalhes da Fatura**:
   ```typescript
   const details = await gastoCertoApi.getInvoiceDetails(accountId, invoiceId);
   ```

4. **Pagar Fatura**:
   ```typescript
   const result = await gastoCertoApi.payCreditCardInvoice(
     userId,
     invoiceId,
     bankId,
     amount
   );
   ```

---

## 🎯 Casos de Uso no WhatsApp

### Cenário 1: Listar Cartões
```
👤 "Meus cartões"

🤖 💳 Seus Cartões de Crédito

   1. Nubank
      💵 Limite: R$ 5.000,00
      📅 Fecha dia 10 | Vence dia 20

   2. C6 Bank
      💵 Limite: R$ 3.000,00
      📅 Fecha dia 5 | Vence dia 15
```

**Implementação**:
```typescript
const cards = await this.gastoCertoApi.listCreditCards(user.activeAccountId);

let message = '💳 *Seus Cartões de Crédito*\n\n';
cards.data.forEach((card, index) => {
  message += `${index + 1}. *${card.name}*\n`;
  message += `   💵 Limite: R$ ${(card.limit / 100).toFixed(2)}\n`;
  message += `   📅 Fecha dia ${card.closingDay} | Vence dia ${card.dueDay}\n\n`;
});
```

### Cenário 2: Ver Fatura Detalhada
```
👤 "Fatura do Nubank"

🤖 💳 Fatura - Nubank
   📅 Dezembro/2025

   💵 Total: R$ 1.200,00
   📊 12 transações
   📅 Vencimento: 20/12/2025

   ───────────────────

   1. 💸 R$ 450,00
      📂 Alimentação • iFood
      📅 05/12

   2. 💸 R$ 200,00
      📂 Transporte • Uber
      📅 08/12

   💡 Para pagar: "pagar fatura Nubank"
```

**Implementação**:
```typescript
const details = await this.gastoCertoApi.getInvoiceDetails(
  user.activeAccountId,
  invoiceId
);

let message = `💳 *Fatura - ${details.data.creditCardName}*\n`;
message += `📅 ${details.data.yearMonth}\n\n`;
message += `💵 Total: R$ ${(details.data.totalAmount / 100).toFixed(2)}\n`;
message += `📊 ${details.data.transactions.length} transações\n`;
message += `📅 Vencimento: ${formatDate(details.data.dueDate)}\n\n`;

details.data.transactions.forEach((tx, i) => {
  message += `${i + 1}. 💸 R$ ${(tx.amount / 100).toFixed(2)}\n`;
  message += `   📂 ${tx.categoryName}${tx.subCategoryName ? ` • ${tx.subCategoryName}` : ''}\n`;
  message += `   📅 ${formatDate(tx.date)}\n\n`;
});
```

---

## 🔐 Autenticação HMAC

Ambos os novos métodos utilizam autenticação HMAC SHA-256 através do `ServiceAuthService`:

```typescript
const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ accountId });

const response = await firstValueFrom(
  this.httpService.post(
    `${this.baseUrl}/external/cards`,
    { accountId },
    {
      headers: {
        ...hmacHeaders,
        'Content-Type': 'application/json',
      },
      timeout: this.timeout,
    },
  ),
);
```

**Header Format**:
```
Authorization: Bearer {accountId}:{timestamp}:{signature}
```

---

## 🚀 Próximos Passos

### 1. Criar Serviços de Cartões

**CreditCardQueryService** (`src/features/credit-cards/credit-card-query.service.ts`):
```typescript
@Injectable()
export class CreditCardQueryService {
  async listCards(user: User): Promise<CreditCardListResult> {
    return await this.gastoCertoApi.listCreditCards(user.activeAccountId);
  }

  async getInvoice(user: User, cardName: string): Promise<InvoiceResult> {
    // 1. Buscar cartão por nome
    // 2. Buscar fatura atual
    // 3. Buscar detalhes da fatura
  }

  async listInvoices(user: User, cardName: string): Promise<InvoiceListResult> {
    // Listar todas as faturas do cartão
  }
}
```

### 2. Implementar Intents

Adicionar ao `MessageIntent`:
```typescript
export enum MessageIntent {
  // ...
  LIST_CREDIT_CARDS = 'LIST_CREDIT_CARDS',
  VIEW_CREDIT_CARD_INVOICE = 'VIEW_CREDIT_CARD_INVOICE',
  PAY_CREDIT_CARD_INVOICE = 'PAY_CREDIT_CARD_INVOICE',
}
```

### 3. Adicionar Palavras-chave

```typescript
private isListCreditCardsRequest(text: string): boolean {
  const keywords = [
    'meus cartões',
    'cartões',
    'listar cartões',
    'ver cartões',
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

private isViewInvoiceRequest(text: string): boolean {
  const keywords = [
    'fatura do',
    'fatura',
    'fatura aberta',
    'fatura fechada',
  ];
  return keywords.some((keyword) => text.includes(keyword));
}
```

---

## 📝 Arquivos Modificados

- ✅ `src/shared/gasto-certo-api.service.ts` - Adicionados métodos `listCreditCards()` e `getInvoiceDetails()`
- ✅ `src/shared/gasto-certo-api.service.ts` - Adicionada nota sobre divergência de endpoints

---

## ✅ Status

**Endpoints Implementados**: ✅ Completo
**Documentação**: ✅ Completa
**Testes Manuais**: ⏳ Pendente
**Integração com Intent Analyzer**: ⏳ Pendente
**Serviços de Cartões**: ⏳ Pendente

---

## 💡 Notas Importantes

1. **Valores Monetários**: Todos os valores estão em centavos (ex: 15000 = R$ 150,00)

2. **Formato de Datas**: ISO 8601 (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm:ss.sssZ`)

3. **Divergência de Endpoints**:
   - Documentação externa usa `/external/cards/`
   - Implementação real usa `/external/credit-card/` para faturas
   - Manter atenção ao integrar novos endpoints

4. **Autenticação**:
   - Todos os endpoints requerem HMAC SHA-256
   - Signature válida por 60 segundos
   - Headers gerados por `ServiceAuthService`

5. **Erro Handling**:
   - Todos os métodos retornam `{ success: boolean, data?, error? }`
   - Logs automáticos de sucesso e erro
   - Não lançam exceções, retornam `success: false`
