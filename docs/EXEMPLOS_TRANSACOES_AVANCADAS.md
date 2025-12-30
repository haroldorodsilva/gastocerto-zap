# 💬 Exemplos de Conversação - Transações Avançadas

## 📱 Cenários de Uso Real

---

## Cenário 1: Compra Parcelada Simples

**👤 Usuário:**
```
Comprei um tênis de R$ 320 em 4x
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 320.00
📂 Categoria: Vestuário > Calçados
📝 Descrição: tênis
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
💳 Parcelamento: 4x de R$ 80,00 (parcela 1/4)
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 32000,
  "category": "Vestuário",
  "subCategoryName": "Calçados",
  "description": "tênis",
  "installments": 4,
  "installmentNumber": 1,
  "paymentStatus": "PENDING",
  "confidence": 0.49
}
```

---

## Cenário 2: Assinatura Mensal

**👤 Usuário:**
```
Pago R$ 89,90 todo mês no Netflix
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 89.90
📂 Categoria: Entretenimento > Streaming
📝 Descrição: Netflix
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
🔄 Recorrência: Mensal
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 8990,
  "category": "Entretenimento",
  "subCategoryName": "Streaming",
  "description": "Netflix",
  "isFixed": true,
  "fixedFrequency": "MONTHLY",
  "paymentStatus": "PENDING",
  "confidence": 0.49
}
```

---

## Cenário 3: Compra no Cartão de Crédito

**👤 Usuário:**
```
Gastei R$ 45 no cartão com almoço
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 45.00
📂 Categoria: Alimentação > Restaurante
📝 Descrição: almoço
📅 Data: 25/01/2025
🏪 Local: Restaurante
👤 Perfil: Conta Principal
💳 Cartão de Crédito
📅 Fatura: Fevereiro/2025
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 4500,
  "category": "Alimentação",
  "subCategoryName": "Restaurante",
  "description": "almoço",
  "merchant": "Restaurante",
  "creditCardId": "card_abc123",
  "paymentStatus": "PENDING",
  "invoiceMonth": "2025-02",
  "confidence": 0.49
}
```

**💡 Cálculo da Fatura:**
```typescript
// Assumindo:
// - Data da compra: 25/01/2025
// - Dia de fechamento do cartão: 15
// 
// Lógica:
// 25 > 15 → Compra DEPOIS do fechamento
// Portanto: Fatura do mês SEGUINTE (Fevereiro/2025)
```

---

## Cenário 4: Compra Parcelada no Cartão

**👤 Usuário:**
```
Comprei celular de R$ 3000 em 10x no cartão
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 3000.00
📂 Categoria: Eletrônicos > Celulares
📝 Descrição: celular
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
💳 Parcelamento: 10x de R$ 300,00 (parcela 1/10)
💳 Cartão de Crédito
📅 Fatura: Fevereiro/2025
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 300000,
  "category": "Eletrônicos",
  "subCategoryName": "Celulares",
  "description": "celular",
  "installments": 10,
  "installmentNumber": 1,
  "creditCardId": "card_abc123",
  "paymentStatus": "PENDING",
  "invoiceMonth": "2025-02",
  "confidence": 0.49
}
```

---

## Cenário 5: Transação Normal (Sem Flags)

**👤 Usuário:**
```
Gastei R$ 50 com almoço
```

**🤖 Sistema (esperado):**
```
✅ SE CONFIANÇA >= 90% (AUTO-REGISTER):

💸 Transação registrada com sucesso!

💵 Valor: R$ 50.00
📂 Categoria: Alimentação > Restaurante
📝 almoço
📅 Data: 25/01/2025 (Hoje)
👤 Perfil: Conta Principal


❌ SE CONFIANÇA < 90% (CONFIRMAÇÃO):

💸 Confirmar Gasto?

💵 Valor: R$ 50.00
📂 Categoria: Alimentação > Restaurante
📝 Descrição: almoço
📅 Data: 25/01/2025
👤 Perfil: Conta Principal

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 5000,
  "category": "Alimentação",
  "subCategoryName": "Restaurante",
  "description": "almoço",
  "paymentStatus": "DONE",
  "confidence": 0.95
}
```

**💡 Diferença:**
- Transação NORMAL → `paymentStatus: 'DONE'`
- Transação ESPECIAL → `paymentStatus: 'PENDING'` + `confidence: 0.49`

---

## Cenário 6: Assinatura Semanal

**👤 Usuário:**
```
Pago R$ 200 toda semana na academia
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 200.00
📂 Categoria: Saúde > Academia
📝 Descrição: academia
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
🔄 Recorrência: Semanal
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Dados salvos no banco:**
```json
{
  "type": "EXPENSES",
  "amount": 20000,
  "category": "Saúde",
  "subCategoryName": "Academia",
  "description": "academia",
  "isFixed": true,
  "fixedFrequency": "WEEKLY",
  "paymentStatus": "PENDING",
  "confidence": 0.49
}
```

---

## Cenário 7: Parcelas com Números por Extenso

**👤 Usuário:**
```
Comprei sofá de R$ 2400 em doze vezes
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 2400.00
📂 Categoria: Casa > Móveis
📝 Descrição: sofá
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
💳 Parcelamento: 12x de R$ 200,00 (parcela 1/12)
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Detecção NLP:**
```typescript
// InstallmentParserService reconhece:
"doze vezes" → 12 parcelas

// Mapa de números por extenso:
{
  'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
  'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9,
  'dez': 10, 'onze': 11, 'doze': 12, ...
}
```

---

## Cenário 8: Compra no Cartão ANTES do Fechamento

**👤 Usuário (data: 10/02/2025, fechamento: 15):**
```
Gastei R$ 120 no cartão
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 120.00
📂 Categoria: Compras > Diversos
📅 Data: 10/02/2025
👤 Perfil: Conta Principal
💳 Cartão de Crédito
📅 Fatura: Fevereiro/2025  ← Mesma fatura
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**💡 Cálculo:**
```typescript
// Data da compra: 10/02/2025
// Dia de fechamento: 15
// 10 < 15 → Compra ANTES do fechamento
// Portanto: Fatura do PRÓPRIO mês (Fevereiro/2025)
```

---

## Cenário 9: Compra no Cartão DEPOIS do Fechamento

**👤 Usuário (data: 20/02/2025, fechamento: 15):**
```
Gastei R$ 85 no crédito
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 85.00
📂 Categoria: Compras > Diversos
📅 Data: 20/02/2025
👤 Perfil: Conta Principal
💳 Cartão de Crédito
📅 Fatura: Março/2025  ← Próxima fatura
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**💡 Cálculo:**
```typescript
// Data da compra: 20/02/2025
// Dia de fechamento: 15
// 20 > 15 → Compra DEPOIS do fechamento
// Portanto: Fatura do MÊS SEGUINTE (Março/2025)
```

---

## Cenário 10: Múltiplas Detecções

**👤 Usuário:**
```
Comprei notebook de R$ 5000 parcelado em 12x no crédito, vou pagar todo mês
```

**🤖 Sistema (esperado):**
```
💸 Confirmar Gasto?

💵 Valor: R$ 5000.00
📂 Categoria: Eletrônicos > Computadores
📝 Descrição: notebook
📅 Data: 25/01/2025
👤 Perfil: Conta Principal
💳 Parcelamento: 12x de R$ 416,67 (parcela 1/12)
💳 Cartão de Crédito
📅 Fatura: Fevereiro/2025
⏳ Status: Pendente

✅ Digite "sim" para confirmar
❌ Digite "não" para cancelar
```

**🔍 Detectado:**
- ✅ Parcelas: "parcelado em 12x"
- ✅ Cartão: "no crédito"
- ⚠️ Nota: "vou pagar todo mês" redundante com parcelas (parcelas tem prioridade)

**💡 Prioridade:**
1. Se detecta PARCELAS → usa installments (mais específico)
2. Se detecta CARTÃO → adiciona creditCardId + invoiceMonth
3. "todo mês" neste contexto não cria isFixed separado

---

## 🎯 Resumo dos Comportamentos

| Tipo de Transação | Status | Confidence | Confirmação | Campos Especiais |
|-------------------|--------|-----------|-------------|------------------|
| Normal | DONE | Original (0.5-1.0) | Opcional (se >= 0.9 auto-registra) | - |
| Parcelada | PENDING | 0.49 (forçada) | **Obrigatória** | installments, installmentNumber |
| Fixa/Recorrente | PENDING | 0.49 (forçada) | **Obrigatória** | isFixed, fixedFrequency |
| Cartão | PENDING | 0.49 (forçada) | **Obrigatória** | creditCardId, invoiceMonth |
| Parcelada + Cartão | PENDING | 0.49 (forçada) | **Obrigatória** | Todos os acima |

---

## 🔍 Logs Esperados

```log
[TransactionRegistrationService] 🔍 Detectando características especiais da transação...

[InstallmentParserService] ✅ Parcelas detectadas: 4x (confidence: 0.95)

[FixedTransactionParserService] ❌ Nenhuma recorrência detectada

[CreditCardParserService] ✅ Cartão de crédito detectado (keywords: "no cartão")

[CreditCardInvoiceCalculatorService] 📅 Calculando mês da fatura...
[CreditCardInvoiceCalculatorService] 📊 Data: 2025-01-25, Fechamento: 15
[CreditCardInvoiceCalculatorService] ✅ Fatura: 2025-02 (Fevereiro/2025)

[PaymentStatusResolverService] 🔍 Resolvendo status de pagamento...
[PaymentStatusResolverService] 📦 Transação PARCELADA detectada
[PaymentStatusResolverService] 💳 Transação com CARTÃO detectada
[PaymentStatusResolverService] ✅ Status: PENDING (requer confirmação)

[TransactionRegistrationService] ⚠️ Transação requer confirmação obrigatória
[TransactionRegistrationService] 🔽 Reduzindo confidence: 0.87 → 0.49
```

---

**Documento criado:** Janeiro/2025  
**Status:** Pronto para uso  
**Casos cobertos:** 10 cenários reais
