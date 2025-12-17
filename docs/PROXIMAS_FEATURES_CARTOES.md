# Próximas Funcionalidades - Gestão de Cartões de Crédito

## Status Atual ✅

### Intents Implementados:
1. ✅ REGISTER_TRANSACTION - Registrar gastos e receitas
2. ✅ CONFIRMATION_RESPONSE - Confirmar/rejeitar transações
3. ✅ LIST_PENDING - Listar transações pendentes de confirmação
4. ✅ LIST_PENDING_PAYMENTS - Listar contas a pagar
5. ✅ CHECK_BALANCE - Consultar saldo
6. ✅ LIST_TRANSACTIONS - Listar transações
7. ✅ SWITCH_ACCOUNT - Trocar conta ativa
8. ✅ LIST_ACCOUNTS - Listar contas
9. ✅ SHOW_ACTIVE_ACCOUNT - Mostrar conta ativa
10. ✅ PAY_BILL - Pagar contas (lista pendentes)
11. ✅ HELP - Ajuda
12. ✅ GREETING - Saudações

### Funcionalidades Disponíveis:
- ✅ Registrar gastos e receitas (texto, áudio, imagem)
- ✅ Consultar saldo e transações
- ✅ Listar contas pendentes
- ✅ Pagar contas por número ("pagar 5")
- ✅ Contexto de lista com referências numéricas
- ✅ Gerenciar múltiplas contas
- ✅ Confirmações de transações
- ✅ Feedback em tempo real para processamentos
- ✅ Registro de uso de IA (texto, áudio, imagem)

---

## 🔜 Funcionalidades Futuras

### 1. Gestão de Cartões de Crédito 💳

> **⚠️ Importante:** Cartões serão gerenciados apenas pela API web.
> O WhatsApp permite apenas **listar**, **ver faturas** e **pagar faturas**.

#### 1.1. Listar Cartões
```
👤 "Meus cartões"
🤖 💳 Seus Cartões de Crédito

   1. Nubank
      💵 Limite: R$ 5.000,00
      💸 Usado: R$ 1.200,00
      ✅ Disponível: R$ 3.800,00
      📅 Fecha dia 10 | Vence dia 20

   2. C6 Bank
      💵 Limite: R$ 3.000,00
      💸 Usado: R$ 500,00
      ✅ Disponível: R$ 2.500,00
      📅 Fecha dia 5 | Vence dia 15
```

**Intent:** `LIST_CREDIT_CARDS`
**Serviço:** `CreditCardQueryService`

#### 1.2. Ver Fatura do Cartão (Aberta ou Fechada)
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

   3. 💸 R$ 150,00
      📂 Streaming • Netflix
      📅 10/12

   💡 Para pagar: "pagar fatura Nubank"
```

**Intent:** `VIEW_CREDIT_CARD_INVOICE`
**Serviço:** `CreditCardQueryService`

**Detalhamento:**
- Pode ver faturas abertas (período atual) ou fechadas (meses anteriores)
- Mostra todas as transações da fatura com detalhes
- Indica status (aberta, fechada, paga, vencida)

```
👤 "Fatura fechada do Nubank"
🤖 💳 Faturas Fechadas - Nubank

   1. 📅 Novembro/2025
      💵 R$ 850,00 | ✅ Paga
      📅 Vencimento: 20/11/2025

   2. 📅 Outubro/2025
      💵 R$ 920,00 | ✅ Paga
      📅 Vencimento: 20/10/2025

   💡 Para ver detalhes: "fatura Nubank novembro"
```

#### 1.3. Pagar Fatura do Cartão
```
👤 "Pagar fatura Nubank"
🤖 ✅ Fatura do Nubank marcada como paga!
   💵 Valor: R$ 1.200,00
   📅 Data: 17/12/2025
```

**Intent:** `PAY_CREDIT_CARD_INVOICE`
**Serviço:** `CreditCardPaymentService`

**Detalhamento:**
- Marca fatura como paga na API
- Pode usar referências numéricas se houver lista de faturas
- Integra com sistema de lista de contexto

---

### 2. Novos Intents Necessários

```typescript
export enum MessageIntent {
  // ... intents atuais ...

  // Cartões de Crédito (apenas consulta e pagamento)
  LIST_CREDIT_CARDS = 'LIST_CREDIT_CARDS',
  VIEW_CREDIT_CARD_INVOICE = 'VIEW_CREDIT_CARD_INVOICE',
  PAY_CREDIT_CARD_INVOICE = 'PAY_CREDIT_CARD_INVOICE',
}
```

**Observação:** Criação, edição e exclusão de cartões serão feitas apenas pela API web.

---

### 3. Novos Serviços a Criar

#### 3.1. CreditCardQueryService
**Localização:** `src/features/credit-cards/credit-card-query.service.ts`

**Responsabilidades:**
- Listar cartões do usuário (via API)
- Buscar faturas abertas e fechadas
- Buscar detalhes de fatura específica
- Calcular disponível (limite - usado)
- Formatar mensagens de exibição

**Métodos principais:**
```typescript
async listCreditCards(user: User): Promise<CreditCardListResult>
async getInvoice(user: User, cardName: string, month?: string): Promise<InvoiceResult>
async listClosedInvoices(user: User, cardName: string): Promise<InvoiceListResult>
```

#### 3.2. CreditCardPaymentService
**Localização:** `src/features/credit-cards/credit-card-payment.service.ts`

**Responsabilidades:**
- Marcar fatura como paga (via API)
- Validar se fatura existe e está pendente
- Registrar pagamento de fatura
- Integração com lista de contexto para referências numéricas

**Métodos principais:**
```typescript
async payInvoice(user: User, cardName: string, month?: string): Promise<PaymentResult>
async payInvoiceByNumber(user: User, itemNumber: number): Promise<PaymentResult>
```

---

### 4. Palavras-chave para Detecção

#### Listar Cartões:
- "meus cartões"
- "cartões"
- "listar cartões"
- "ver cartões"

#### Ver Fatura:
- "fatura do [nome]"
- "fatura [nome]"
- "fatura aberta [nome]"
- "fatura fechada [nome]"
- "faturas [nome]"

#### Pagar Fatura:
- "pagar fatura [nome]"
- "pagar cartão [nome]"
- "quitar fatura [nome]"

---

### 5. Priorização de Implementação

1. **Fase 1 - Consulta:**
   - [ ] Adicionar intents `LIST_CREDIT_CARDS`, `VIEW_CREDIT_CARD_INVOICE`
   - [ ] Criar `CreditCardQueryService`
   - [ ] Implementar detecção de palavras-chave
   - [ ] Integrar com intent analyzer

2. **Fase 2 - Pagamento:**
   - [ ] Adicionar intent `PAY_CREDIT_CARD_INVOICE`
   - [ ] Criar `CreditCardPaymentService`
   - [ ] Integrar com lista de contexto para referências numéricas
   - [ ] Adicionar roteamento em `transactions.service.ts`

3. **Fase 3 - Endpoints API:**
   - [ ] Verificar/implementar endpoints de cartões na API
   - [ ] Verificar/implementar endpoints de faturas na API
   - [ ] Verificar/implementar endpoint de pagamento de fatura na API

---

### 6. Endpoints da API Necessários

A integração com WhatsApp requer os seguintes endpoints na GastoCerto API:

#### 6.1. Listar Cartões
```
GET /api/credit-cards?accountId={accountId}
Response: [
  {
    id: string,
    name: string,
    limit: number,
    usedAmount: number,
    availableAmount: number,
    closingDay: number,
    dueDay: number
  }
]
```

#### 6.2. Buscar Fatura
```
GET /api/credit-cards/{cardId}/invoices/current
GET /api/credit-cards/{cardId}/invoices?month=2025-12
Response: {
  id: string,
  cardId: string,
  cardName: string,
  month: string,
  totalAmount: number,
  status: 'open' | 'closed' | 'paid' | 'overdue',
  dueDate: string,
  transactions: [
    {
      id: string,
      description: string,
      amount: number,
      category: string,
      date: string
    }
  ]
}
```

#### 6.3. Listar Faturas Fechadas
```
GET /api/credit-cards/{cardId}/invoices/history
Response: [
  {
    id: string,
    month: string,
    totalAmount: number,
    status: string,
    dueDate: string,
    paidDate?: string
  }
]
```

#### 6.4. Pagar Fatura
```
POST /api/credit-cards/{cardId}/invoices/{invoiceId}/pay
Body: {
  paymentDate: string,
  amount: number
}
Response: {
  success: boolean,
  message: string
}
```

---

## 📝 Notas Importantes

- **Cartões são gerenciados apenas pela API web** (criar, editar, deletar)
- WhatsApp permite apenas **consultar** e **pagar** faturas
- Faturas têm status: aberta, fechada, paga, vencida
- Integração com sistema de lista de contexto para referências numéricas
- Suporte a faturas abertas (mês atual) e fechadas (histórico)

---

## 🎯 Objetivo

**Permitir consulta e pagamento de faturas de cartões via WhatsApp:**
- ✅ Listar todos os cartões cadastrados
- ✅ Ver fatura aberta (mês atual)
- ✅ Ver faturas fechadas (histórico)
- ✅ Pagar fatura por nome ou número de referência
- ✅ UX conversacional com linguagem natural
