# Fluxo Completo do Sistema de Transações

## 📋 Índice
1. [Fluxo de Registro de Transação](#fluxo-de-registro)
2. [Confirmação Automática vs Manual](#confirmação-automática-vs-manual)
3. [RAG e IA](#rag-e-ia)
4. [Segurança e Validações](#segurança-e-validações)
5. [Reenvio de Transações Pendentes](#reenvio-de-transações-pendentes)

---

## 1. Fluxo de Registro de Transação

### Passo a Passo Completo

```
1️⃣ RECEBIMENTO DA MENSAGEM
   ├─ WhatsApp ou Telegram
   ├─ Tipo: Texto, Imagem, Áudio ou Documento
   └─ MessageId gerado

2️⃣ VALIDAÇÃO DE SEGURANÇA ⚠️
   ├─ Tamanho da mensagem (máx configurável)
   ├─ Detecção de Prompt Injection
   ├─ Palavras suspeitas
   ├─ Rate Limiting
   └─ ✅ Se SAFE: continua | ❌ Se UNSAFE: bloqueia

3️⃣ ANÁLISE DE INTENÇÃO (NLP)
   ├─ Intent Analyzer classifica a mensagem
   ├─ Intents: REGISTER_TRANSACTION, LIST_PENDING, HELP, etc
   └─ Verifica se há confirmação pendente (bloqueia novas transações)

4️⃣ VERIFICAÇÃO DE CONTA ATIVA
   ├─ Busca conta ativa do usuário
   └─ Se não tem: solicita configuração

5️⃣ EXTRAÇÃO DE DADOS (IA)
   ├─ Texto: AIProviderFactory.extractTransaction()
   ├─ Imagem: AIProviderFactory.analyzeImage()
   ├─ Áudio: Transcrição → extractTransaction()
   └─ Retorna: TransactionData {
         type, amount, category, subCategory, 
         description, date, merchant, confidence
      }

6️⃣ MELHORIA COM RAG (se habilitado) 🧠
   ├─ Indexa categorias do usuário no vetor DB
   ├─ Busca similaridade: texto da categoria → categorias do usuário
   ├─ Se score >= 0.75: substitui categoria e subcategoria
   └─ Aumenta confiança em +10% (máx 1.0)

7️⃣ VALIDAÇÃO DOS DADOS
   ├─ Valor: >= 0.01 e <= 1.000.000
   ├─ Categoria: não vazia
   ├─ Data: válida ou null
   └─ Se inválido: retorna erro formatado

8️⃣ VERIFICAÇÃO DE CONFIANÇA MÍNIMA
   ├─ Threshold: 0.5 (50%)
   └─ Se < 0.5: pede para reformular mensagem

9️⃣ DECISÃO: AUTO-REGISTRO OU CONFIRMAÇÃO
   ├─ Se confidence >= 0.8 E config.requireConfirmation = false
   │  └─ ⚡ REGISTRO AUTOMÁTICO (pula confirmação)
   │
   └─ Senão
      └─ 💬 CRIA CONFIRMAÇÃO PENDENTE

🔟 RESOLUÇÃO DE IDs DE CATEGORIA
   ├─ resolveCategoryAndSubcategory()
   ├─ Busca nas categorias da conta ativa
   ├─ Match por nome (case-insensitive) ou ID
   └─ Salva categoryId e subCategoryId na confirmação

1️⃣1️⃣ CRIAÇÃO DA CONFIRMAÇÃO
   ├─ Salva no banco: transaction_confirmations
   ├─ Campos salvos:
   │  ├─ phoneNumber, userId, accountId
   │  ├─ type, amount, category
   │  ├─ categoryId ✅, subCategoryId ✅
   │  ├─ description, date, extractedData
   │  ├─ status: PENDING
   │  └─ expiresAt: now + 10 minutos
   └─ Retorna mensagem de confirmação ao usuário

1️⃣2️⃣ USUÁRIO RESPONDE "SIM" ou "NÃO"
   ├─ "sim" → processConfirmation()
   │  ├─ Marca status: CONFIRMED
   │  └─ Chama sendTransactionToApi()
   │
   └─ "não" → rejectConfirmation()
      ├─ Marca status: REJECTED
      └─ Deleta da fila

1️⃣3️⃣ ENVIO PARA API GASTOCERTO
   ├─ Busca conta: usa accountId SALVO (não busca atual)
   ├─ Busca IDs: usa categoryId e subCategoryId SALVOS
   │  └─ Fallback: resolve pelo nome se não tiver IDs
   ├─ Monta DTO: CreateGastoCertoTransactionDto
   ├─ POST /external/transactions
   └─ Resposta:
      ├─ ✅ Success: marca apiSent=true, salva apiTransactionId
      └─ ❌ Error: salva apiError, incrementa apiRetryCount

1️⃣4️⃣ JOB DE RETRY (Background)
   ├─ Busca confirmações: CONFIRMED + apiSent=false
   ├─ Filtra por tentativas < 5
   ├─ Reexecuta sendTransactionToApi()
   └─ Backoff exponencial: 3s, 9s, 27s, 81s, 243s
```

---

## 2. Confirmação Automática vs Manual

### Configurações

```typescript
// .env ou config
REQUIRE_CONFIRMATION=true           // Sempre pede confirmação
AUTO_REGISTER_THRESHOLD=0.8         // Se confidence >= 80%
MIN_CONFIDENCE_THRESHOLD=0.5        // Mínimo 50% para aceitar
```

### Fluxo de Decisão

```typescript
if (confidence < MIN_CONFIDENCE_THRESHOLD) {
  // ❌ REJEITA - confiança muito baixa
  return "Não entendi bem, seja mais específico"
}

if (!REQUIRE_CONFIRMATION && confidence >= AUTO_REGISTER_THRESHOLD) {
  // ⚡ REGISTRO AUTOMÁTICO
  // - Confiança >= 80%
  // - Pula confirmação
  // - Envia direto para API
  return autoRegisterTransaction()
}

// 💬 CONFIRMAÇÃO MANUAL
// - Qualquer confiança entre 50% e 100%
// - Pede "sim" ou "não"
return createConfirmation()
```

### Como Funciona o Auto-Registro

```typescript
async autoRegisterTransaction(data: TransactionData) {
  // 1. Cria confirmação temporária (não salva no banco)
  const tempConfirmation = {
    ...data,
    accountId: activeAccount.id,
    categoryId: resolvedCategoryId,
    subCategoryId: resolvedSubCategoryId,
    status: 'CONFIRMED'
  }

  // 2. Envia direto para API (pula banco)
  const result = await sendTransactionToApi(tempConfirmation, data)

  // 3. Retorna sucesso/erro
  if (result.success) {
    return "✅ Transação registrada automaticamente!"
  } else {
    return `❌ Erro: ${result.error}`
  }
}
```

**⚠️ IMPORTANTE**: No auto-registro, **NÃO salva no banco** `transaction_confirmations`. Vai direto para API. Isso significa que transações auto-registradas não aparecem no painel de pendentes.

---

## 3. RAG e IA

### Como o RAG Funciona

```typescript
// 1. INDEXAÇÃO (uma vez por usuário)
await ragService.indexUserCategories(userId, [
  { 
    categoryId: "abc-123",
    categoryName: "Alimentação",
    subCategoryId: "def-456", 
    subCategoryName: "Supermercado",
    accountId: "account-1"
  },
  // ... outras categorias
])

// 2. BUSCA SEMÂNTICA (a cada transação)
const matches = await ragService.findSimilarCategories(
  "feira",           // Texto extraído pela IA
  userId,
  { minScore: 0.6, maxResults: 1 }
)

// Resultado:
[{
  categoryId: "abc-123",
  categoryName: "Alimentação",
  subCategoryId: "def-456",
  subCategoryName: "Supermercado",
  score: 0.87  // 87% de similaridade
}]

// 3. APLICAÇÃO (se score >= 0.75)
if (matches[0].score >= 0.75) {
  extractedData.category = "Alimentação"      // ✅ Substitui
  extractedData.subCategory = "Supermercado"  // ✅ Adiciona subcategoria
  extractedData.confidence += 0.087           // Aumenta 8.7%
}
```

### Quando RAG é Usado

```typescript
// Configuração de IA do usuário
const aiSettings = await aiConfigService.getUserAISettings(userId)

if (aiSettings.ragEnabled) {
  // ✅ RAG ativo
  // - Busca similaridade nas categorias do usuário
  // - Melhora sugestão de categoria/subcategoria
  // - Aumenta confiança
} else {
  // ❌ RAG desligado
  // - IA extrai categoria sem ajuda do histórico
  // - Pode não sugerir subcategorias
}
```

### Limitação Atual do RAG

**❌ NÃO sugere subcategorias novas**
- RAG só encontra categorias que o usuário **já tem cadastradas**
- Se IA extrai "feira" mas usuário nunca usou "Supermercado" → RAG não ajuda
- Solução futura: dicionário de subcategorias padrão por categoria

**Exemplo**:
```typescript
// Usuário tem:
categories: [
  { name: "Alimentação", subCategories: [] }  // ❌ Sem subcategorias
]

// Mensagem: "gastei 40 reais na feira com queijo"
// IA extrai: { category: "Alimentação", subCategory: null }
// RAG busca: encontra "Alimentação" (score 0.95)
// RAG aplica: { category: "Alimentação", subCategory: null } ❌ AINDA null

// Para funcionar, usuário precisa TER a subcategoria:
categories: [
  { name: "Alimentação", subCategories: [
    { name: "Supermercado" },  // ✅ Agora tem
    { name: "Restaurante" }
  ]}
]

// Agora RAG pode sugerir "Supermercado" para "feira"
```

---

## 4. Segurança e Validações

### SecurityService - Proteção Anti-Injection

```typescript
// SIM, está funcionando! ✅

async validateUserMessage(phoneNumber, message, platform) {
  const settings = await getSecuritySettings()
  
  if (!settings.enabled) {
    return { safe: true }  // Segurança OFF
  }

  // 1️⃣ Tamanho máximo
  if (message.length > settings.maxMessageLength) {
    logSecurityEvent(phoneNumber, 'message_too_long', 'low')
    return { 
      safe: false, 
      reason: "Mensagem muito longa" 
    }
  }

  // 2️⃣ Prompt Injection
  const patterns = [
    /ignore\s+(previous|all|above|prior)/i,
    /disregard\s+(previous|all|instructions)/i,
    /forget\s+(everything|all|previous)/i,
    /<\s*script\s*>/i,  // XSS
    /union\s+select/i,  // SQL Injection
    /eval\s*\(/i,       // Code Injection
    // ... mais 30+ padrões
  ]
  
  if (detectInjection(message)) {
    logSecurityEvent(phoneNumber, 'injection_attempt', 'high')
    return { 
      safe: false, 
      reason: "Desculpe, só posso processar transações financeiras 🤖" 
    }
  }

  // 3️⃣ Palavras suspeitas
  const suspicious = ['hack', 'exploit', 'bypass', 'admin', ...]
  if (detectSuspiciousContent(message)) {
    logSecurityEvent(phoneNumber, 'suspicious_content', 'medium')
    return { 
      safe: false, 
      reason: "Mensagem contém conteúdo suspeito" 
    }
  }

  // 4️⃣ Rate Limiting (Redis)
  const key = `rate_limit:${phoneNumber}`
  const count = await redis.incr(key)
  await redis.expire(key, settings.windowSeconds)  // 60s
  
  if (count > settings.maxMessages) {  // 20 msg/min
    logSecurityEvent(phoneNumber, 'rate_limit_exceeded', 'medium')
    return { 
      safe: false, 
      reason: "⏰ Muitas mensagens em pouco tempo" 
    }
  }

  // ✅ Tudo OK
  return { safe: true }
}
```

### Onde é Aplicado

**❌ PROBLEMA**: SecurityService existe mas **NÃO está integrado** no fluxo de transações!

```typescript
// ATUAL (sem segurança):
async processTextMessage(phoneNumber, text, messageId) {
  // ❌ NÃO valida segurança antes
  const user = await userCache.getUser(phoneNumber)
  const intent = await intentAnalyzer.analyzeIntent(text)
  // ... continua processamento
}

// DEVERIA SER:
async processTextMessage(phoneNumber, text, messageId) {
  // ✅ Validar segurança PRIMEIRO
  const validation = await securityService.validateUserMessage(
    phoneNumber, 
    text, 
    'whatsapp'
  )
  
  if (!validation.safe) {
    return {
      success: false,
      message: validation.reason,
      requiresConfirmation: false
    }
  }
  
  // Agora sim, processar...
  const user = await userCache.getUser(phoneNumber)
  // ...
}
```

**🔧 AÇÃO NECESSÁRIA**: Integrar SecurityService no início do `processTextMessage()`

---

## 5. Reenvio de Transações Pendentes

### Como Funciona Agora ✅

```typescript
// 1. ENDPOINT DE REENVIO
POST /admin/transactions/resend
Body: {
  transactionIds: ["conf-1", "conf-2"]  // IDs específicos
  // OU filtros:
  userId: "user-uuid",
  accountId: "account-uuid",
  dateFrom: "2025-12-01",
  dateTo: "2025-12-31"
}

// 2. BUSCA TRANSAÇÕES PENDENTES
const confirmations = await prisma.transactionConfirmation.findMany({
  where: {
    status: 'CONFIRMED',
    apiSent: false,
    ...filters
  },
  take: 100  // Limite de segurança
})

// 3. REENVIA CADA UMA
for (const confirmation of confirmations) {
  const result = await registrationService.resendTransaction(confirmation.id)
  
  if (result.success) {
    // ✅ Marcou apiSent=true, salvou apiTransactionId
  } else {
    // ❌ Salvou apiError, incrementou apiRetryCount
  }
}
```

### Método resendTransaction()

```typescript
async resendTransaction(confirmationId: string) {
  // 1. Busca confirmação
  const confirmation = await confirmationService.getById(confirmationId)
  
  // 2. Verifica se já foi enviada
  if (confirmation.apiSent) {
    return { success: true, transactionId: confirmation.apiTransactionId }
  }
  
  // 3. Reenvia usando DADOS SALVOS ✅
  const result = await sendTransactionToApi(confirmation)
  //    ↓
  //    Usa: accountId, categoryId, subCategoryId SALVOS
  //    NÃO busca conta ativa atual
  //    NÃO resolve categoria novamente
  
  // 4. Atualiza status
  if (result.success) {
    await confirmationService.markAsSent(confirmationId, result.transactionId)
  } else {
    await confirmationService.markAsError(confirmationId, result.error)
  }
  
  return result
}
```

### Por Que Usar Dados Salvos?

```typescript
// CENÁRIO:
// 1. Usuário cria transação na Conta A
//    → Salva: accountId="conta-a", categoryId="cat-123"
// 
// 2. Usuário muda para Conta B
//    → activeAccountId agora é "conta-b"
//
// 3. API falha, precisa reenviar

// ❌ SE BUSCASSE CONTA ATUAL:
const activeAccount = await getActiveAccount(phoneNumber)
// → activeAccount.id = "conta-b"  ❌ ERRADO!
// → Envia para conta errada
// → Categoria não existe na Conta B
// → ERRO: "Categoria não encontrada"

// ✅ USANDO DADOS SALVOS:
const accountId = confirmation.accountId  // "conta-a" ✅
const categoryId = confirmation.categoryId  // "cat-123" ✅
// → Envia para conta correta
// → Usa IDs corretos
// → SUCCESS!
```

### Benefícios da Solução Atual

1. **Consistência**: Transação sempre vai para a conta original
2. **Performance**: Não precisa re-resolver categorias
3. **Confiabilidade**: Retry funciona mesmo após mudança de contexto
4. **Rastreabilidade**: Sabe exatamente qual conta/categoria foram usadas
5. **Dados completos**: Tudo salvo na tabela, não precisa reprocessar

---

## 🎯 Resumo do Fluxo Atual

```
REGISTRO:
✅ Validação de segurança (SecurityService existe, mas NÃO integrado)
✅ Análise de intenção (NLP)
✅ Verificação de conta ativa
✅ Extração via IA (texto, imagem, áudio)
✅ Melhoria com RAG (se habilitado)
✅ Resolução de IDs (categoryId, subCategoryId)
✅ Salvamento completo no banco
✅ Confirmação manual OU auto-registro

CONFIRMAÇÃO:
✅ Usuário responde "sim"/"não"
✅ Envio para API com dados salvos
✅ Marcação de status (apiSent, apiTransactionId, apiError)
✅ Job de retry automático (5 tentativas, backoff exponencial)

REENVIO MANUAL:
✅ Endpoint /admin/transactions/resend
✅ Filtros: userId, accountId, dateFrom, dateTo
✅ Usa dados salvos (não reprocessa)
✅ Atualiza status corretamente
✅ Retorna erros detalhados
```

## 🔧 Melhorias Sugeridas

1. **Integrar SecurityService** no início do processamento de mensagens
2. **Adicionar dicionário de subcategorias padrão** para RAG sugerir melhor
3. **Dashboard de monitoramento** de transações pendentes/falhadas
4. **Notificações** quando retry atingir limite máximo
5. **Logs estruturados** para análise de falhas
