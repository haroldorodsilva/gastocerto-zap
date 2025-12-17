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

#### 1.1. Criar Cartão
```
👤 "Criar cartão de crédito"
🤖 Qual o nome do cartão? (Ex: Nubank, C6, etc)

👤 "Nubank"
🤖 Qual o limite? (Ex: 5000)

👤 "5000"
🤖 Dia do fechamento? (1-31)

👤 "10"
🤖 Dia do vencimento? (1-31)

👤 "20"
🤖 ✅ Cartão Nubank criado!
   💳 Limite: R$ 5.000,00
   📅 Fecha dia 10 | Vence dia 20
```

**Intent:** `CREATE_CREDIT_CARD`
**Serviço:** `CreditCardManagementService`

#### 1.2. Listar Cartões
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

#### 1.3. Ver Fatura do Cartão
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

#### 1.4. Pagar Fatura do Cartão
```
👤 "Pagar fatura Nubank"
🤖 ✅ Fatura do Nubank marcada como paga!
   💵 Valor: R$ 1.200,00
   📅 Data: 17/12/2025
```

**Intent:** `PAY_CREDIT_CARD_INVOICE`

#### 1.5. Transação Parcelada
```
👤 "Gastei 1200 parcelado em 12x no notebook"
🤖 📋 Confirme a transação parcelada:

   💸 Valor Total: R$ 1.200,00
   📂 Categoria: Eletrônicos
   🔢 Parcelas: 12x de R$ 100,00
   💳 Cartão: [Selecionar]
   📅 Data: 17/12/2025

   ⚠️ Transação parcelada sempre requer confirmação!

   ✅ Está correto? Digite:
   • "sim" para confirmar
   • "não" para cancelar

👤 "sim"
🤖 ✅ Transação parcelada criada!
   💸 12x de R$ 100,00
   📅 Primeira parcela: Dezembro/2025
```

**Intent:** `REGISTER_INSTALLMENT_TRANSACTION`
**Regra:** Sempre requer confirmação (não auto-registra)

---

### 2. Novos Intents Necessários

```typescript
export enum MessageIntent {
  // ... intents atuais ...

  // Cartões de Crédito
  CREATE_CREDIT_CARD = 'CREATE_CREDIT_CARD',
  LIST_CREDIT_CARDS = 'LIST_CREDIT_CARDS',
  VIEW_CREDIT_CARD_INVOICE = 'VIEW_CREDIT_CARD_INVOICE',
  PAY_CREDIT_CARD_INVOICE = 'PAY_CREDIT_CARD_INVOICE',
  EDIT_CREDIT_CARD = 'EDIT_CREDIT_CARD',
  DELETE_CREDIT_CARD = 'DELETE_CREDIT_CARD',

  // Transações Parceladas
  REGISTER_INSTALLMENT_TRANSACTION = 'REGISTER_INSTALLMENT_TRANSACTION',
  LIST_INSTALLMENTS = 'LIST_INSTALLMENTS',

  // Análises Avançadas
  MONTHLY_REPORT = 'MONTHLY_REPORT', // Relatório mensal detalhado
  CATEGORY_ANALYSIS = 'CATEGORY_ANALYSIS', // Análise por categoria
  SPENDING_TRENDS = 'SPENDING_TRENDS', // Tendências de gastos
}
```

---

### 3. Novos Serviços a Criar

#### 3.1. CreditCardManagementService
**Localização:** `src/features/credit-cards/credit-card-management.service.ts`

**Responsabilidades:**
- Criar/editar/deletar cartões
- Listar cartões do usuário
- Calcular disponível (limite - usado)
- Buscar faturas
- Marcar fatura como paga

#### 3.2. InstallmentService
**Localização:** `src/features/transactions/contexts/installment/installment.service.ts`

**Responsabilidades:**
- Criar transação parcelada
- Listar parcelas
- Calcular próximas parcelas
- Sempre requer confirmação

#### 3.3. AnalyticsService
**Localização:** `src/features/analytics/analytics.service.ts`

**Responsabilidades:**
- Gerar relatórios mensais
- Análise por categoria
- Tendências de gastos
- Comparativos (mês a mês)
- Projeções

---

### 4. Palavras-chave para Detecção

#### Cartões:
- "criar cartão"
- "adicionar cartão"
- "novo cartão"
- "meus cartões"
- "fatura do [nome]"
- "pagar fatura [nome]"

#### Parcelado:
- "parcelado"
- "parcelada"
- "12x"
- "3x de"
- "em 6 parcelas"

---

### 5. Priorização de Implementação

1. **Alta Prioridade:**
   - [ ] CreditCardManagementService (criar, listar)
   - [ ] VIEW_CREDIT_CARD_INVOICE (ver fatura)
   - [ ] PAY_CREDIT_CARD_INVOICE (pagar fatura)

2. **Média Prioridade:**
   - [ ] REGISTER_INSTALLMENT_TRANSACTION (parcelado)
   - [ ] InstallmentService

3. **Baixa Prioridade:**
   - [ ] Analytics avançados
   - [ ] Relatórios automáticos
   - [ ] Notificações de vencimento

---

### 6. Impacto na API

Verificar se a GastoCerto API já suporta:
- ✅ Cartões de crédito
- ✅ Faturas de cartão
- ✅ Transações parceladas
- ❓ Análises avançadas

---

## 📝 Notas

- Transações parceladas **SEMPRE** requerem confirmação
- Cartões devem estar vinculados a uma conta
- Faturas têm datas de fechamento e vencimento
- Parcelas são criadas automaticamente
- Cada parcela é uma transação separada
- Usuário pode escolher cartão ao registrar gasto

---

## 🎯 Objetivo

**Permitir gestão completa de finanças via mensagens no WhatsApp**, incluindo:
- Cartões de crédito
- Faturas
- Parcelamentos
- Relatórios
- Análises

**UX Conversacional**: Tudo por linguagem natural, sem interfaces complexas.
