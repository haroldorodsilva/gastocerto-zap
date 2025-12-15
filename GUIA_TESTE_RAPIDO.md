# 🚀 Guia Rápido de Testes - Sistema Multi-Contas

## 📋 Pré-requisitos

✅ **Testes:** 27/27 passando  
✅ **Compilação:** OK  
✅ **Servidor:** Pronto para iniciar  

---

## 🎬 Como Iniciar

### 1. Iniciar o servidor
```bash
npm run start:dev
```

### 2. Aguardar logs de sucesso
Você deve ver:
```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG WhatsApp conectado: 5511999999999
```

---

## 💬 Fluxos de Teste (Enviar via WhatsApp)

### 🏦 **FLUXO 1: Visualizar Contas**

**1.1 Listar todas as contas**
```
minhas contas
```

**Resposta esperada:**
```
🏦 *Suas Contas:*

✅ 1. *Pessoal* (PERSONAL) 🌟
⚪ 2. *PJ* (BUSINESS)

💡 Para trocar de conta, digite: "mudar conta" ou "usar [nome]"
```

**1.2 Ver conta ativa**
```
conta ativa
```

**Resposta esperada:**
```
🏦 *Conta Ativa:*

✅ *Pessoal*
📋 Tipo: PERSONAL 🌟

💡 Para trocar de conta, digite: "mudar conta"
```

---

### 🔄 **FLUXO 2: Trocar de Conta**

**2.1 Trocar por nome direto**
```
usar PJ
```

**Resposta esperada:**
```
✅ Conta alterada com sucesso!

🏦 Agora usando: *PJ* (BUSINESS)
```

**2.2 Trocar via menu interativo**

**Passo 1:** Solicitar menu
```
mudar conta
```

**Resposta esperada:**
```
🏦 *Selecione a conta:*

⚪ 1. *Pessoal* (PERSONAL) 🌟
✅ 2. *PJ* (BUSINESS)

💡 Digite o número ou nome da conta
```

**Passo 2:** Responder com número
```
1
```

**Resposta esperada:**
```
✅ Conta alterada com sucesso!

🏦 Agora usando: *Pessoal* (PERSONAL)
```

---

### 💰 **FLUXO 3: Registrar Transação**

**3.1 Garantir que está na conta correta**
```
conta ativa
```

**3.2 Registrar despesa**
```
Gastei R$ 150 no mercado
```

**Resposta esperada:**
```
🔄 *Confirme a transação:*

💰 Valor: R$ 150,00
📂 Categoria: Supermercado
📅 Data: 15/12/2025
📝 Descrição: mercado

🏦 Conta: *Pessoal* (PERSONAL)

Responda:
✅ *sim* para confirmar
❌ *não* para cancelar
```

**3.3 Confirmar**
```
sim
```

**Resposta esperada:**
```
✅ *Transação registrada com sucesso!*

💰 R$ 150,00 em Supermercado
🏦 Conta: Pessoal
📅 15/12/2025
```

---

### 🖼️ **FLUXO 4: Enviar Nota Fiscal**

**4.1 Verificar conta ativa**
```
qual conta?
```

**4.2 Enviar foto da nota fiscal**
> Envie uma imagem de nota fiscal pelo WhatsApp

**Resposta esperada:**
```
📸 *Analisando imagem...*

🔍 Extraindo dados da nota fiscal...
```

**Depois:**
```
🔄 *Confirme a transação:*

💰 Valor: R$ 89,90
📂 Categoria: Supermercado
📅 Data: 14/12/2025
📝 Descrição: Carrefour
🏪 Estabelecimento: Carrefour

🏦 Conta: *Pessoal* (PERSONAL)

Responda:
✅ *sim* para confirmar
❌ *não* para cancelar
```

---

### 🔐 **FLUXO 5: Validação de Conta**

**5.1 Tentar operação sem conta ativa** *(se possível simular)*

```
gastei R$ 50 no cinema
```

**Resposta esperada (SE não tiver conta ativa):**
```
⚠️ Você não tem uma conta ativa.

💡 Use *"minhas contas"* para ver suas contas e *"usar [nome]"* para ativar uma.
```

---

### 🚫 **FLUXO 6: Bloqueio de Confirmação**

**6.1 Registrar primeira transação**
```
Gastei R$ 80 no restaurante
```

**6.2 SEM confirmar, tentar registrar outra**
```
Gastei R$ 30 no Uber
```

**Resposta esperada:**
```
⏸️ *Você tem uma transação aguardando confirmação!*

Por favor, primeiro responda:
✅ Digite *"sim"* para confirmar
❌ Digite *"não"* para cancelar

💡 Ou digite *"pendentes"* para ver detalhes
```

**6.3 Ver pendentes**
```
pendentes
```

**6.4 Confirmar ou cancelar**
```
não
```

**Resposta esperada:**
```
❌ Transação cancelada.
```

---

### 📊 **FLUXO 7: Listar Transações por Conta**

**7.1 Trocar para conta Pessoal**
```
usar Pessoal
```

**7.2 Listar transações**
```
minhas transações
```

**Resposta esperada:**
```
📋 *Transações - Pessoal*

💸 R$ 150,00 - Supermercado
📅 15/12/2025
📝 mercado

💸 R$ 89,90 - Supermercado
📅 14/12/2025
📝 Carrefour

---
💰 Total: R$ 239,90
```

**7.3 Trocar para conta PJ**
```
usar PJ
```

**7.4 Listar transações da PJ**
```
minhas transações
```

**Resposta esperada:**
```
📋 *Transações - PJ*

💸 R$ 3.500,00 - Aluguel
📅 10/12/2025
📝 aluguel da loja

---
💰 Total: R$ 3.500,00
```

> **Observação:** As transações devem ser DIFERENTES entre as contas!

---

### 🎯 **FLUXO 8: Cenário Completo**

**8.1 Listar contas**
```
minhas contas
```

**8.2 Trocar para PJ**
```
2
```

**8.3 Registrar despesa empresarial**
```
Gastei R$ 2.500 em equipamentos de informática
```

**8.4 Confirmar**
```
sim
```

**8.5 Trocar para Pessoal**
```
usar Pessoal
```

**8.6 Registrar despesa pessoal**
```
Gastei R$ 120 no Uber do mês
```

**8.7 Confirmar**
```
sim
```

**8.8 Ver transações da conta Pessoal**
```
minhas transações
```

**8.9 Ver transações da conta PJ**
```
usar PJ
```
```
minhas transações
```

> **Validar:** Cada conta deve mostrar APENAS suas próprias transações!

---

## ✅ Checklist de Validação

Marque conforme testar:

### Básico
- [ ] ✅ Listar contas funciona
- [ ] ✅ Ver conta ativa funciona
- [ ] ✅ Trocar conta por nome funciona
- [ ] ✅ Trocar conta por número funciona

### Transações
- [ ] ✅ Registrar transação texto na conta ativa
- [ ] ✅ Registrar transação imagem na conta ativa
- [ ] ✅ Confirmação mostra conta correta
- [ ] ✅ Transação é salva na conta ativa

### Validação
- [ ] ✅ Bloqueia operação sem conta ativa
- [ ] ✅ Bloqueia nova transação com confirmação pendente
- [ ] ✅ Listagem de transações valida conta ativa

### Isolamento
- [ ] ✅ Transações da conta Pessoal são isoladas
- [ ] ✅ Transações da conta PJ são isoladas
- [ ] ✅ Trocar conta muda as transações listadas

---

## 🐛 Como Reportar Problemas

Se algo não funcionar:

### 1. Anotar detalhes
```
**Teste:** [Fluxo X - Passo Y]
**Mensagem enviada:** "usar PJ"
**Esperado:** Conta alterada para PJ
**Obtido:** [erro ou comportamento diferente]
```

### 2. Copiar logs do servidor
Procure por linhas com:
- `[Account]` - logs de conta
- `[Registration]` - logs de registro
- `❌` - erros

### 3. Verificar conta ativa no banco
```bash
# Se tiver acesso ao Prisma Studio
npx prisma studio
```

Verificar tabela `UserCache`:
- Campo `activeAccountId` deve estar preenchido
- Campo `accounts` deve ter lista de contas

---

## 📊 Logs Úteis

Durante os testes, observe no terminal:

### ✅ Logs de sucesso
```
[Account] 📋 Listando contas para 5511999999999
[Account] ✅ 2 conta(s) encontrada(s)
[Account] 🔄 Processando troca de conta para 5511999999999
[Account] ✅ Conta trocada: PJ (BUSINESS)
[Registration] ✅ Usando conta ativa: PJ (account-123)
```

### ❌ Logs de erro a investigar
```
[Account] ❌ Erro ao listar contas
[Registration] ⚠️ Conta ativa não encontrada
[UserCache] ❌ Erro ao buscar activeAccount
```

---

## 🎉 Tudo Funcionando?

Se todos os fluxos passarem:

✅ Sistema multi-contas **100% operacional**  
✅ Validações implementadas  
✅ Isolamento de dados por conta  
✅ Conversação natural funcionando  

### Próximos passos (opcional):
1. Teste com usuários reais
2. Monitore logs de produção
3. Ajuste UX baseado em feedback
4. Implemente melhorias futuras (ver `STATUS_MULTICONTAS.md`)

---

## 📞 Dúvidas?

- **Comandos não reconhecidos?** → Verificar `IntentAnalyzerService`
- **Conta não muda?** → Verificar `AccountManagementService`
- **Transação na conta errada?** → Verificar `activeAccountId` no cache
- **Erro ao listar?** → Verificar `validateActiveAccount`

**Dica:** Use `conta ativa` frequentemente para confirmar qual conta está usando!
