# 🧪 Roteiro de Testes - Sistema Multi-Contas

## ✅ Implementações Completas

### 1. **AccountManagementService**
- Listar contas do usuário
- Mostrar conta ativa
- Trocar conta (por nome, tipo ou número)
- Validar conta ativa antes de operações

### 2. **Validação em Todos os Contextos**
- ✅ TransactionRegistrationService (texto, imagem, áudio)
- ✅ TransactionListingService (listar transações)
- ✅ TransactionPaymentService (pagar contas)

### 3. **Seleção Interativa**
- Menu numerado de contas
- Resposta com número (1, 2, 3)
- Resposta com nome/tipo da conta

### 4. **Intents Implementados**
- `LIST_ACCOUNTS` - "minhas contas", "listar contas"
- `SHOW_ACTIVE_ACCOUNT` - "conta ativa", "qual conta"
- `SWITCH_ACCOUNT` - "mudar conta", "trocar conta", "usar PJ"

---

## 🧪 Roteiro de Testes

### **Teste 1: Listar Contas**

**Mensagens para testar:**
```
minhas contas
listar contas
mostrar contas
```

**Resultado esperado:**
```
🏦 *Suas Contas:*

✅ 1. *Pessoal* (PERSONAL) 🌟
⚪ 2. *PJ* (BUSINESS)

💡 Para trocar de conta, digite: *"mudar conta"* ou *"usar [nome]"*
```

---

### **Teste 2: Ver Conta Ativa**

**Mensagens para testar:**
```
conta ativa
qual conta estou usando
qual minha conta
```

**Resultado esperado:**
```
🏦 *Conta Ativa:*

✅ *Pessoal*
📋 Tipo: PERSONAL 🌟

💡 Para trocar de conta, digite: *"mudar conta"*
```

---

### **Teste 3: Trocar Conta (Nome Direto)**

**Mensagens para testar:**
```
usar PJ
mudar para PJ
trocar para PJ
usar conta PJ
```

**Resultado esperado:**
```
✅ Conta alterada com sucesso!

🏦 Agora usando: *PJ* (BUSINESS)
```

---

### **Teste 4: Trocar Conta (Menu Interativo)**

**Passo 1 - Mensagem:**
```
mudar conta
trocar conta
```

**Resultado esperado:**
```
🏦 *Selecione a conta:*

✅ 1. *Pessoal* (PERSONAL) 🌟
⚪ 2. *PJ* (BUSINESS)

💡 Digite o número ou nome da conta
```

**Passo 2 - Responder com número:**
```
2
```

**Resultado esperado:**
```
✅ Conta alterada com sucesso!

🏦 Agora usando: *PJ* (BUSINESS)
```

---

### **Teste 5: Registrar Transação (com validação de conta)**

**Passo 1 - Trocar para conta PJ:**
```
usar PJ
```

**Passo 2 - Registrar transação:**
```
Gastei R$ 350 no aluguel da loja
```

**Resultado esperado:**
```
🔄 *Confirme a transação:*

💰 Valor: R$ 350,00
📂 Categoria: Casa
📅 Data: 15/12/2025
📝 Descrição: aluguel da loja

🏦 Conta: *PJ* (BUSINESS)

Responda:
✅ *sim* para confirmar
❌ *não* para cancelar
```

---

### **Teste 6: Validação de Conta Ativa**

**Passo 1 - Desativar conta (simular sem conta ativa):**
> Isso depende do fluxo do seu sistema. Se conseguir desativar todas as contas no cache.

**Passo 2 - Tentar registrar transação:**
```
Gastei R$ 50 no mercado
```

**Resultado esperado:**
```
⚠️ Você não tem uma conta ativa.

💡 Use *"minhas contas"* para ver suas contas e *"usar [nome]"* para ativar uma.
```

---

### **Teste 7: Listar Transações (com validação de conta)**

**Mensagens para testar:**
```
minhas transações
listar transações
transações de hoje
```

**Resultado esperado (se tem conta ativa):**
```
[Lista de transações da conta ativa]
```

**Resultado esperado (se NÃO tem conta ativa):**
```
⚠️ Você não tem uma conta ativa.

💡 Use *"minhas contas"* para ver suas contas e *"usar [nome]"* para ativar uma.
```

---

### **Teste 8: Trocar Conta e Ver Transações Diferentes**

**Passo 1 - Usar conta Pessoal:**
```
usar Pessoal
```

**Passo 2 - Listar transações:**
```
minhas transações
```
> Deve mostrar transações da conta Pessoal

**Passo 3 - Trocar para PJ:**
```
usar PJ
```

**Passo 4 - Listar transações:**
```
minhas transações
```
> Deve mostrar transações da conta PJ (diferentes)

---

### **Teste 9: Enviar Imagem de Nota Fiscal (com validação de conta)**

**Passo 1 - Garantir que está na conta certa:**
```
conta ativa
```

**Passo 2 - Enviar imagem de nota fiscal**

**Resultado esperado:**
```
📸 *Analisando imagem...*
[...]
🔄 *Confirme a transação:*
[detalhes extraídos da nota]
🏦 Conta: *[Conta Ativa]*
```

---

### **Teste 10: Contexto de Confirmação (bloqueio)**

**Passo 1 - Registrar transação:**
```
Gastei R$ 100 no restaurante
```

**Passo 2 - SEM confirmar, tentar registrar outra:**
```
Gastei R$ 50 no cinema
```

**Resultado esperado:**
```
⏸️ *Você tem uma transação aguardando confirmação!*

Por favor, primeiro responda:
✅ Digite *"sim"* para confirmar
❌ Digite *"não"* para cancelar

💡 Ou digite *"pendentes"* para ver detalhes
```

---

## 🎯 Checklist de Validação

Marque ✅ conforme testar:

- [ ] **Teste 1:** Listar contas funciona
- [ ] **Teste 2:** Ver conta ativa funciona
- [ ] **Teste 3:** Trocar conta por nome funciona
- [ ] **Teste 4:** Menu interativo + seleção numérica funciona
- [ ] **Teste 5:** Transação registrada na conta correta
- [ ] **Teste 6:** Validação bloqueia sem conta ativa
- [ ] **Teste 7:** Listar transações valida conta ativa
- [ ] **Teste 8:** Transações diferentes por conta
- [ ] **Teste 9:** Imagem registrada na conta ativa
- [ ] **Teste 10:** Contexto de confirmação bloqueia novas transações

---

## 🐛 Reportar Problemas

Se encontrar bugs, anote aqui:

### Problema 1:
**Teste:** [qual teste falhou]
**Esperado:** [o que deveria acontecer]
**Obtido:** [o que aconteceu]
**Logs:** [copiar logs relevantes]

---

## 📊 Status de Implementação

### ✅ Completo
- [x] AccountManagementService
- [x] Validação em Registration
- [x] Validação em Listing
- [x] Validação em Payment
- [x] Seleção interativa (menu + número)
- [x] Intents (LIST_ACCOUNTS, SHOW_ACTIVE_ACCOUNT, SWITCH_ACCOUNT)

### 🚀 Próximos Passos (se necessário)
- [ ] Adicionar filtro por conta na listagem
- [ ] Dashboard por conta (resumos separados)
- [ ] Transferência entre contas
- [ ] Configurações avançadas por conta

---

## 🎉 Pronto para Testar!

**Como iniciar:**
```bash
npm run start:dev
```

**Enviar mensagem de teste via WhatsApp:**
Mande uma das mensagens acima para o número conectado.

**Observar logs:**
Os logs mostrarão o fluxo completo com emojis e contextos.
