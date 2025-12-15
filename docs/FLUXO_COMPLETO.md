# 🔄 FLUXO COMPLETO - MENSAGEM → RESPOSTA

## 📍 Arquitetura Multi-Plataforma

O sistema suporta **WhatsApp (Baileys)** e **Telegram** com arquitetura unificada baseada em eventos.

---

## 📨 PARTE 1: RECEPÇÃO DA MENSAGEM

### WhatsApp Flow

```
1. WhatsApp (Baileys) → messages.upsert event
   📂 src/infrastructure/whatsapp/sessions/whatsapp/session.ts
   
2. SessionManager.setupEventHandlers()
   • Escuta evento 'messages.upsert'
   • Extrai dados da mensagem
   • Emite evento 'whatsapp.message'
   
3. EventEmitter.emit('whatsapp.message')
   payload: { sessionId, message }
```

### Telegram Flow

```
1. Telegram Bot API → polling/webhook
   📂 src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts
   
2. TelegramProvider.setupEventHandlers()
   • bot.on('text')
   • bot.on('photo')
   • bot.on('voice')
   
3. handleIncomingMessage(msg, messageType)
   • Normaliza mensagem Telegram
   • Extrai phoneNumber do contact ou cache
   • Emite evento 'telegram.message'
   
4. EventEmitter.emit('telegram.message')
   payload: { sessionId, message }
```

---

## 🔄 PARTE 2: PROCESSAMENTO UNIFICADO

### Step 1: Message Handler (Event Listener)

```typescript
📂 src/infrastructure/whatsapp/messages/whatsapp-message.handler.ts

@OnEvent('whatsapp.message')  // ou 'telegram.message'
async handleIncomingMessage(payload) {
  
  // 1️⃣ Filtrar mensagem (ignorar grupos, bots, etc)
  const filtered = await messageFilter.extractMessageData(message);
  if (!filtered) return; // Mensagem ignorada
  
  // 2️⃣ Registrar contexto para roteamento de resposta
  contextService.registerContext(
    phoneNumber,
    sessionId,
    MessagingPlatform.WHATSAPP // ou TELEGRAM
  );
  
  // 3️⃣ Enfileirar para processamento assíncrono (Bull Queue)
  await messageQueue.add('process-message', {
    sessionId,
    message: filtered,
    timestamp: Date.now()
  });
}
```

**Cache de Contexto** (Redis):
```json
{
  "66996285154": {
    "sessionId": "5566996285154@s.whatsapp.net",
    "platform": "whatsapp",
    "lastActivity": "2024-12-15T10:30:00Z"
  }
}
```

### Step 2: Message Queue Processor

```typescript
📂 src/infrastructure/whatsapp/messages/messages.processor.ts

@Processor('whatsapp-messages')
export class MessagesProcessor {
  
  @Process('process-message')
  async processMessage(job) {
    const { message, sessionId } = job.data;
    
    // 1️⃣ Verificar se usuário está em onboarding
    const isOnboarding = await onboardingService.isUserOnboarding(phoneNumber);
    
    if (isOnboarding) {
      // Rotear para onboarding
      return await onboardingService.handleMessage(phoneNumber, message.text);
    }
    
    // 2️⃣ Buscar usuário no cache (Redis → DB → API)
    const user = await userCacheService.getUser(phoneNumber);
    
    if (!user) {
      // Usuário novo → iniciar onboarding
      return await onboardingService.startOnboarding(phoneNumber, platform);
    }
    
    // 3️⃣ Verificar assinatura ativa
    if (!user.hasActiveSubscription) {
      return await sendMessage('Sua assinatura expirou...');
    }
    
    // 4️⃣ Verificar se é confirmação de transação pendente
    const pending = await checkPendingConfirmation(phoneNumber);
    
    if (pending) {
      // Enfileirar confirmação
      return await transactionQueue.add('process-confirmation', {
        phoneNumber,
        response: message.text,
        confirmationId: pending.id
      });
    }
    
    // 5️⃣ Nova transação → Enfileirar para extração IA
    await transactionQueue.add('extract-transaction', {
      userId: user.gastoCertoId,
      phoneNumber,
      message
    });
  }
}
```

---

## 🤖 PARTE 3: PROCESSAMENTO IA + RAG

### Step 3: Transaction Extraction

```typescript
📂 src/features/transactions/contexts/registration/registration.service.ts

async processTextTransaction(phoneNumber, text, messageId, user) {
  
  // 1️⃣ Buscar categorias do usuário (Cache → DB → API)
  const categories = await userCache.getUserCategories(phoneNumber);
  
  // 2️⃣ Indexar categorias no RAG (se habilitado)
  const aiSettings = await aiConfigService.getSettings();
  
  if (aiSettings.ragEnabled && ragService) {
    await ragService.indexUserCategories(user.gastoCertoId, categories);
    // Cache em memória: Map<userId, Category[]>
  }
  
  // 3️⃣ Extrair transação via IA (OpenAI/Gemini/Groq)
  const extracted = await aiFactory.extractTransaction(text, {
    name: user.name,
    categories
  });
  
  // Retorno da IA:
  {
    type: 'EXPENSES',
    amount: 11.00,
    category: 'rotativo',  // ← Termo genérico do usuário
    description: 'Cartão rotativo',
    confidence: 0.85,
    date: '2024-12-14'
  }
  
  // 4️⃣ Melhorar categoria usando RAG (BM25)
  if (aiSettings.ragEnabled && extracted.category) {
    const ragMatches = await ragService.findSimilarCategories(
      extracted.category,  // 'rotativo'
      user.gastoCertoId,
      { minScore: 0.6, maxResults: 1 }
    );
    
    // RAG retorna:
    [
      {
        categoryName: 'Cartão Rotativo',
        subCategoryName: 'Crédito',
        score: 0.92,
        matchedTerms: ['rotativo', 'cartao']
      }
    ]
    
    if (ragMatches[0].score >= aiSettings.ragThreshold) {
      extracted.category = 'Cartão Rotativo';      // ✅ Categoria exata
      extracted.subCategory = 'Crédito';           // ✅ Subcategoria exata
      extracted.confidence = 0.95;                 // ⬆️ Confiança aumentada
    }
  }
  
  // 5️⃣ Buscar conta padrão do usuário
  const defaultAccountId = await getDefaultAccountId(user.gastoCertoId);
  
  // 6️⃣ Resolver categoria/subcategoria no sistema
  const resolved = await resolveCategoryAndSubcategory(
    extracted.category,
    extracted.subCategory,
    defaultAccountId,
    categories
  );
  
  // Se não encontrou → tentar conta default
  if (!resolved.categoryId) {
    const defaultAccount = await getDefaultAccountCategories();
    resolved = await resolveCategoryAndSubcategory(
      extracted.category,
      extracted.subCategory,
      defaultAccount.id,
      defaultAccount.categories
    );
  }
  
  // 7️⃣ Decisão: Auto-registrar ou pedir confirmação?
  const highConfidence = extracted.confidence >= 0.8;
  const foundCategory = !!resolved.categoryId;
  
  if (highConfidence && foundCategory) {
    // ✅ AUTO-REGISTRAR
    const transaction = await gastoCertoApi.createTransaction({
      userId: user.gastoCertoId,
      type: extracted.type,
      amount: extracted.amount,
      categoryId: resolved.categoryId,
      subCategoryId: resolved.subCategoryId,
      description: extracted.description,
      date: extracted.date
    });
    
    // Retornar resumo formatado
    const summary = formatTransactionSummary(transaction);
    await sendMessage(phoneNumber, summary);
    
    return { success: true, autoRegistered: true };
  } else {
    // ❓ PEDIR CONFIRMAÇÃO
    const confirmation = await confirmationService.create({
      userId: user.gastoCertoId,
      phoneNumber,
      extractedData: extracted,
      resolvedData: resolved,
      messageId
    });
    
    await sendMessage(phoneNumber, formatConfirmationMessage(confirmation));
    
    return { success: true, requiresConfirmation: true };
  }
}
```

---

## ✅ PARTE 4: ENVIO DA RESPOSTA

### Step 4: Send Message (Platform-Agnostic)

```typescript
📂 src/infrastructure/whatsapp/messages/message-sender.service.ts

async sendMessage(phoneNumber: string, text: string) {
  
  // 1️⃣ Buscar contexto da plataforma (Redis cache)
  const context = await contextService.getContext(phoneNumber);
  
  if (!context) {
    throw new Error('No messaging context found');
  }
  
  // 2️⃣ Rotear para plataforma correta
  if (context.platform === MessagingPlatform.WHATSAPP) {
    const session = await sessionManager.getSession(context.sessionId);
    await session.sendTextMessage(phoneNumber, text);
    
  } else if (context.platform === MessagingPlatform.TELEGRAM) {
    const provider = await sessionManager.getTelegramProvider(context.sessionId);
    await provider.sendTextMessage(context.sessionId, text);
  }
  
  // 3️⃣ Log da mensagem enviada
  logger.log(`✅ Mensagem enviada via ${context.platform}: ${phoneNumber}`);
}
```

### WhatsApp Send

```typescript
📂 src/infrastructure/whatsapp/sessions/whatsapp/session.ts

async sendTextMessage(to: string, text: string) {
  await this.sock.sendMessage(to, {
    text: text
  });
}
```

### Telegram Send

```typescript
📂 src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts

async sendTextMessage(chatId: string, text: string) {
  await this.bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown'
  });
}
```

---

## 📊 RESUMO DO FLUXO COMPLETO

```
┌─────────────────┐
│  1. RECEPÇÃO    │
│  WhatsApp/Tele  │
└────────┬────────┘
         │
         │ Event: whatsapp.message / telegram.message
         ↓
┌─────────────────┐
│  2. HANDLER     │
│  Filter + Queue │
└────────┬────────┘
         │
         │ Bull Queue: process-message
         ↓
┌─────────────────┐
│  3. PROCESSOR   │
│  User/Onboard   │
└────────┬────────┘
         │
         ├─→ Onboarding? → OnboardingService
         │
         ├─→ Confirmação? → ConfirmationProcessor
         │
         └─→ Nova Transação ↓
         
┌─────────────────┐
│  4. IA + RAG    │
│  Extract + Match│
└────────┬────────┘
         │
         │ 1. Extract via IA: tipo, valor, categoria genérica
         │ 2. RAG improve: categoria genérica → categoria exata (BM25)
         │ 3. Resolve: categoria + conta padrão
         │ 4. Decision: auto-register vs confirmation
         ↓
┌─────────────────┐
│  5. DECISÃO     │
└────────┬────────┘
         │
         ├─→ Alta confiança + Categoria → AUTO-REGISTER
         │                                  ↓
         │                            GastoCerto API
         │                                  ↓
         │                            formatSummary()
         │                                  
         └─→ Baixa confiança → CONFIRMAÇÃO
                                  ↓
                            createConfirmation()
                                  ↓
                          formatConfirmationMsg()
         
┌─────────────────┐
│  6. RESPOSTA    │
│  Send Message   │
└────────┬────────┘
         │
         │ 1. Get context (platform + sessionId)
         │ 2. Route to correct provider
         │ 3. Send via WhatsApp/Telegram
         ↓
┌─────────────────┐
│   USUÁRIO       │
│   Recebe msg    │
└─────────────────┘
```

---

## 🕐 Tempos Aproximados

| Etapa | Tempo |
|-------|-------|
| 1. Recepção + Filter | ~10ms |
| 2. Queue + Context | ~50ms |
| 3. User lookup (cache) | ~5ms |
| 4. IA Extract | ~800ms |
| 5. RAG Match (BM25) | ~10ms |
| 6. Resolve + Decision | ~50ms |
| 7. API Call (se auto-register) | ~200ms |
| 8. Send Response | ~100ms |
| **TOTAL** | **~1.2s** |

---

## 🎯 Pontos de Observabilidade

### Logs Importantes

```typescript
// 1. Mensagem recebida
[WhatsAppMessageHandler] ✅ Processing message from 66996285154

// 2. RAG indexado
[RAGService] 📚 Indexando 15 categorias para usuário userId-123

// 3. IA extraction
[TransactionRegistrationService] 🤖 Chamando IA para extrair transação...
[AIProviderFactory] Using OpenAI GPT-4o-mini

// 4. RAG match
[RAGService] 🧠 RAG melhorou categoria: "rotativo" → "Cartão Rotativo" (92.0%)

// 5. Decision
[TransactionRegistrationService] ✅ Auto-registrando (confiança: 0.95)

// 6. Resposta enviada
[MessageSender] ✅ Mensagem enviada via whatsapp: 66996285154
```

### Métricas (Redis/Prometheus)

- `transaction.extract.duration_ms`
- `rag.match.duration_ms`
- `rag.match.score` (histogram)
- `transaction.auto_register_rate`
- `transaction.confirmation_rate`

---

## ✅ Status Atual

- ✅ Multi-plataforma (WhatsApp + Telegram)
- ✅ Event-driven architecture
- ✅ Bull Queue para processamento assíncrono
- ✅ Context caching (Redis)
- ✅ RAG BM25 para matching
- ✅ Fallback para conta default
- ✅ Auto-register inteligente
- ✅ Resumo formatado
