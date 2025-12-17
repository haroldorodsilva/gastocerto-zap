# Diferença entre "Pendentes" no Sistema

O sistema detecta **dois tipos diferentes** de "pendentes":

## 1. LIST_PENDING (Confirmações)
**Transações aguardando confirmação (sim/não)**

### Palavras-chave:
- "pendentes de confirmação"
- "aguardando confirmação"
- "falta confirmar"
- "confirmar transação"
- "transações para confirmar"

### Exemplo:
```
👤 "pendentes de confirmação"

🤖 📋 Transações Pendentes de Confirmação

   Você tem 2 transação(ões) aguardando:

   1. 💸 R$ 50,00
      📂 Alimentação
      🏪 Supermercado XYZ
      📅 17/12/2025

   2. 💸 R$ 120,00
      📂 Transporte
      📅 16/12/2025

   💡 Digite "sim" para confirmar a primeira, ou "não" para cancelar.
```

---

## 2. LIST_PENDING_PAYMENTS (Pagamentos)
**Contas pendentes de pagamento**

### Palavras-chave:
- "pendentes" (sozinho)
- "ver pendentes"
- "contas pendentes"
- "contas a pagar"
- "pagamentos pendentes"
- "o que tenho que pagar"
- "minhas contas"

### Exemplo:
```
👤 "pendentes"

🤖 📋 Contas Pendentes

   💵 Total: R$ 450,00
   📊 Quantidade: 3

   ───────────────────

   1. 💸 R$ 150,00
      📂 Contas Básicas • Conta de luz
      📅 Vencimento: 20/12/2025

   2. 💸 R$ 200,00
      📂 Cartão de Crédito
      📅 Vencimento: 15/12/2025

   3. 💸 R$ 100,00
      📂 Assinaturas • Netflix
      📅 Vencimento: 10/12/2025

   💡 Para pagar, responda: "pagar 1" ou "pagar 5"
```

---

## 🎯 Como o Sistema Decide

### Lógica de Priorização:

```typescript
// 1. Verifica CONFIRMAÇÕES primeiro (mais específico)
if (text.includes('confirmação') || text.includes('confirmar transação')) {
  return LIST_PENDING; // ✅ Lista transações aguardando sim/não
}

// 2. Se não, verifica PAGAMENTOS (mais genérico)
if (text === 'pendentes' || text.includes('contas pendentes')) {
  return LIST_PENDING_PAYMENTS; // ✅ Lista contas a pagar
}
```

### Casos de Uso:

| Mensagem | Intent Detectado | O que mostra |
|----------|------------------|--------------|
| `"pendentes"` | `LIST_PENDING_PAYMENTS` | Contas a pagar ✅ |
| `"ver pendentes"` | `LIST_PENDING_PAYMENTS` | Contas a pagar ✅ |
| `"contas pendentes"` | `LIST_PENDING_PAYMENTS` | Contas a pagar ✅ |
| `"pendentes de confirmação"` | `LIST_PENDING` | Transações aguardando sim/não ✅ |
| `"falta confirmar"` | `LIST_PENDING` | Transações aguardando sim/não ✅ |

---

## 🔄 Fluxo Completo

### Cenário 1: Listar e Pagar Contas

```
👤 "pendentes"
🤖 [Lista 3 contas pendentes de pagamento]

👤 "pagar 2"
🤖 ✅ Transação marcada como paga!
```

### Cenário 2: Listar e Confirmar Transações

```
👤 "pendentes de confirmação"
🤖 [Lista 2 transações aguardando confirmação]

👤 "sim"
🤖 ✅ Transação confirmada e enviada para a API!
```

---

## 🛡️ Prevenção de Conflitos

O sistema **prioriza termos específicos** sobre termos genéricos:

1. ✅ **Específico vence**: "pendentes de confirmação" → `LIST_PENDING`
2. ✅ **Genérico como fallback**: "pendentes" → `LIST_PENDING_PAYMENTS`
3. ✅ **Sem ambiguidade**: Cada intent tem palavras-chave únicas

Isso garante que o usuário sempre receba a lista correta! 🎯
