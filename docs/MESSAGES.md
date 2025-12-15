# 📨 Fluxo de Processamento de Mensagens

## Visão Geral

O sistema processa mensagens de WhatsApp e Telegram de forma unificada, extraindo informações de transações usando IA e gerenciando confirmações através de uma arquitetura modular baseada em contextos.

## 🏗️ Arquitetura

### Camadas do Sistema

```
┌─────────────────────────────────────────┐
│  WhatsApp / Telegram (Entrada)          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  MessageFilterService                    │
│  - Valida mensagem                       │
│  - Normaliza telefone                    │
│  - Extrai mídia                          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  MessagesProcessor (Queue)               │
│  - Fila Bull (Redis)                     │
│  - Retry automático                      │
│  - Processamento assíncrono              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  UserCacheService                        │
│  - Verifica onboarding                   │
│  - Carrega dados do usuário              │
└─────────────────┬───────────────────────┘
                  │
     ┌────────────┴────────────┐
     │                         │
     ▼                         ▼
┌─────────────┐      ┌─────────────────┐
│ Onboarding  │      │ TransactionsService │
│   Service   │      │   (Orchestrator)    │
└─────────────┘      └────────┬────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────────┐ ┌──────────┐ ┌──────────┐
    │ Registration    │ │ Listing  │ │ Payment  │
    │   Service       │ │ Service  │ │ Service  │
    └────────┬────────┘ └──────────┘ └──────────┘
             │
    ┌────────▼────────┐
    │  AIProvider     │
    │  - OpenAI       │
    │  - Gemini       │
    │  - Groq         │
    │  - DeepSeek     │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ GastoCerto API  │
    └─────────────────┘
```

---

## 🔄 Fluxo Principal

### 1️⃣ Recebimento da Mensagem

```typescript
// WhatsApp: Baileys
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    await messageFilter.extractMessageData(msg);
  }
});

// Telegram: Telegraf
bot.on('text', async (ctx) => {
  await messageFilter.extractMessageData({
    phoneNumber: ctx.from.id,
    text: ctx.message.text,
    platform: 'telegram'
  });
});
```

---

### 2️⃣ Filtragem e Normalização

**MessageFilterService** faz:

✅ **Validações**:
- Ignora mensagens próprias (`fromMe: true`)
- Ignora grupos (`@g.us`)
- Ignora broadcasts
- Ignora mensagens de protocolo

✅ **Normalização**:
```typescript
// WhatsApp: 5566996285154@s.whatsapp.net
// Telegram: 123456789
// Normalizado: 66996285154 (sem código do país)
```

✅ **Extração de Mídia**:
```typescript
interface IFilteredMessage {
  phoneNumber: string;
  messageId: string;
  text?: string;
  caption?: string;
  type: MessageType; // TEXT, IMAGE, AUDIO, VIDEO
  media?: {
    buffer: Buffer;
    mimeType: string;
  };
  platform: 'whatsapp' | 'telegram';
  timestamp: number;
}
```

---

### 3️⃣ Verificação de Onboarding

```typescript
// Verifica se usuário completou cadastro
const user = await userCache.getUser(phoneNumber);

if (!user || !user.onboardingCompleted) {
  // ➡️ Redireciona para OnboardingService
  await onboardingService.handleMessage(message);
  return;
}

// ✅ Usuário autenticado - processa normalmente
```

---

### 4️⃣ Análise de Intenção (NLP)

**IntentAnalyzerService** detecta o que o usuário quer:

```typescript
const intentResult = await intentAnalyzer.analyzeIntent(text, phoneNumber);

/*
{
  intent: 'REGISTER_TRANSACTION',  // ou LIST, PAYMENT, SUMMARY, etc
  confidence: 0.85,
  shouldProcess: true,
  suggestedResponse: null
}
*/
```

**Intents Suportadas**:
- `REGISTER_TRANSACTION` - "Gastei R$50 no mercado"
- `CONFIRMATION_RESPONSE` - "sim", "confirmar", "ok"
- `LIST_PENDING` - "pendentes", "aguardando"
- `LIST_TRANSACTIONS` - "minhas compras", "histórico"
- `PAYMENT` - "pagar conta", "quitar fatura"
- `SUMMARY` - "resumo do mês", "gastos totais"
- `HELP` - "ajuda", "como usar"
- `GREETING` - "oi", "olá"

---

### 5️⃣ Bloqueio de Contexto (Confirmação Pendente)

Se usuário tem transação pendente, bloqueia novos registros:

```typescript
const hasPending = await confirmationService.getPendingConfirmation(phoneNumber);

if (hasPending) {
  // ⏸️ BLOQUEIA novos registros
  // ✅ PERMITE apenas: confirmação, consulta, ajuda
  
  if (intent !== 'CONFIRMATION_RESPONSE') {
    return {
      message: '⏸️ Você tem uma transação aguardando confirmação!\n\n' +
               'Digite "sim" para confirmar ou "não" para cancelar.'
    };
  }
}
```

---

## 📝 Registro de Transações

### Fluxo de Extração via IA

```
Mensagem → AI Provider → Validação → Decisão
                                        │
                   ┌────────────────────┴────────────────────┐
                   │                                         │
            Confiança ≥ 80%?                          Confiança < 80%?
                   │                                         │
                   ▼                                         ▼
         🚀 AUTO-REGISTRO                            💬 CONFIRMAÇÃO
         (registro imediato)                         (aguarda sim/não)
```

### 1️⃣ Extração de Dados

**Entrada** (texto do usuário):
```
"Paguei R$ 150 de luz hoje"
```

**Processamento**:
```typescript
const extractedData = await aiFactory.extractTransaction(text, {
  name: user.name,
  email: user.email,
  categories: user.categories
});
```

**Saída** (dados estruturados):
```json
{
  "type": "EXPENSES",
  "amount": 150.00,
  "description": "Conta de luz",
  "date": "2025-05-21",
  "category": "Moradia",
  "subCategory": "Energia Elétrica",
  "confidence": 0.92,
  "paymentMethod": null
}
```

---

### 2️⃣ Validação

**TransactionValidatorService** verifica:

✅ **Campos Obrigatórios**:
- `type` (EXPENSES ou INCOME)
- `amount` (> 0)
- `description` (não vazio)
- `date` (válida)

✅ **Regras de Negócio**:
- Valor máximo: R$ 1.000.000
- Data não pode ser futura
- Categoria deve existir no sistema

✅ **Thresholds**:
```typescript
MIN_CONFIDENCE = 0.5   // Abaixo disso, rejeita
AUTO_REGISTER = 0.8    // Acima disso, auto-registra
```

---

### 3️⃣ Decisão: Auto-Registro vs Confirmação

#### Auto-Registro (Alta Confiança)

**Quando**: `confidence >= 0.8`

**Fluxo**:
```typescript
async autoRegisterTransaction(data) {
  // 1. Buscar conta padrão do usuário
  const accountId = await getDefaultAccountId(userId);
  
  // 2. Resolver categoria e subcategoria
  const { categoryId, subCategoryId } = 
    await resolveCategoryAndSubcategory(userId, accountId, data);
  
  // 3. Enviar para API
  const dto = {
    accountId,
    categoryId,
    subCategoryId,
    amount: data.amount,
    description: data.description,
    type: data.type,
    date: data.date
  };
  
  await gastoCertoApi.createTransaction(dto);
  
  return {
    success: true,
    message: '✅ *Transação registrada!*\n\n' +
             `💰 Valor: R$ ${amount}\n` +
             `📂 Categoria: ${category} > ${subCategory}\n` +
             `📅 Data: ${date}`,
    autoRegistered: true
  };
}
```

**Resposta ao Usuário**:
```
✅ *Transação registrada!*

💰 Valor: R$ 150,00
📂 Categoria: Moradia > Energia Elétrica
📅 Data: 21/05/2025
📝 Descrição: Conta de luz

🚀 Registrado automaticamente (confiança: 92%)
```

---

#### Confirmação (Confiança Média)

**Quando**: `0.5 <= confidence < 0.8`

**Fluxo**:
```typescript
async createConfirmation(data) {
  // 1. Criar registro na tabela transaction_confirmations
  const confirmation = await prisma.transactionConfirmation.create({
    data: {
      userId: user.id,
      phoneNumber,
      messageId,
      transactionData: data,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    }
  });
  
  // 2. Formatar mensagem de confirmação
  return {
    success: true,
    message: formatConfirmationMessage(data),
    requiresConfirmation: true,
    confirmationId: confirmation.id
  };
}
```

**Resposta ao Usuário**:
```
📋 *Confirme a transação:*

💰 Valor: R$ 150,00
📂 Categoria: Moradia > Energia Elétrica
📅 Data: 21/05/2025
📝 Descrição: Conta de luz

✅ Está correto? Digite:
• *"sim"* para confirmar
• *"não"* para cancelar
• *"editar"* para modificar

⏱️ Expira em 24 horas
```

---

### 4️⃣ Processamento de Confirmação

**Usuário responde**: `"sim"`

```typescript
async processConfirmation(phoneNumber, response) {
  // 1. Buscar confirmação pendente
  const pending = await confirmationService.getPendingConfirmation(phoneNumber);
  
  if (!pending) {
    return { success: false, message: '❌ Nenhuma transação pendente' };
  }
  
  // 2. Analisar resposta (NLP)
  const isConfirmed = /^(sim|confirmar|ok|yes|confirmo)/i.test(response);
  const isCanceled = /^(não|nao|cancelar|no)/i.test(response);
  
  if (isConfirmed) {
    // 3. Registrar transação
    await registerConfirmedTransaction(pending);
    await confirmationService.updateStatus(pending.id, 'CONFIRMED');
    
    return {
      success: true,
      message: '✅ Transação confirmada e registrada!'
    };
  }
  
  if (isCanceled) {
    await confirmationService.updateStatus(pending.id, 'REJECTED');
    
    return {
      success: true,
      message: '❌ Transação cancelada'
    };
  }
}
```

---

## 🖼️ Processamento de Imagens

### Fluxo de Análise de Nota Fiscal

```
Imagem → Download → Base64 → AI Vision → Extração
```

**Entrada**: Foto de cupom fiscal

**Processamento**:
```typescript
async processImageTransaction(phoneNumber, imageBuffer, mimeType) {
  // 1. Analisar imagem com IA
  const extractedData = await aiFactory.analyzeImage(imageBuffer, mimeType);
  
  // 2. Validar dados extraídos
  const validation = validator.validate(extractedData);
  
  // 3. Sempre requer confirmação (imagens têm mais incerteza)
  return await createConfirmation(phoneNumber, extractedData);
}
```

**Dados Extraídos**:
```json
{
  "type": "EXPENSES",
  "amount": 127.35,
  "description": "Compra Supermercado Extra",
  "date": "2025-05-21",
  "category": "Alimentação",
  "subCategory": "Supermercado",
  "items": [
    { "name": "Arroz 5kg", "price": 25.90 },
    { "name": "Feijão 1kg", "price": 8.50 },
    { "name": "Óleo 900ml", "price": 7.20 }
  ],
  "merchant": "Supermercado Extra",
  "confidence": 0.75
}
```

**Resposta**:
```
🖼️ *Nota fiscal analisada!*

🏪 Estabelecimento: Supermercado Extra
💰 Total: R$ 127,35
📅 Data: 21/05/2025

📦 Itens identificados:
• Arroz 5kg - R$ 25,90
• Feijão 1kg - R$ 8,50
• Óleo 900ml - R$ 7,20
• (mais 8 itens)

✅ Confirmar registro? (sim/não)
```

---

## 🎤 Processamento de Áudio

### Fluxo de Transcrição

```
Áudio → Download → Transcrição (Whisper) → Extração
```

**Processamento**:
```typescript
async processAudioTransaction(phoneNumber, audioBuffer, mimeType) {
  // 1. Transcrever áudio
  const transcript = await aiFactory.transcribeAudio(audioBuffer, mimeType);
  
  // 2. Extrair transação do texto transcrito
  const extractedData = await aiFactory.extractTransaction(transcript, userContext);
  
  // 3. Criar confirmação
  return await createConfirmation(phoneNumber, extractedData);
}
```

**Exemplo**:
- Usuário: 🎤 _"Gastei cinquenta reais no mercado hoje"_
- Transcrição: `"Gastei cinquenta reais no mercado hoje"`
- Extração: `{ amount: 50, category: "Alimentação", ... }`

---

## 🔄 Resolução de Categorias

### Cache-First Strategy

```typescript
async resolveCategoryAndSubcategory(userId, accountId, data) {
  // 1️⃣ TENTAR CACHE (user_cache.categories)
  const user = await userCache.getUser(phoneNumber);
  
  if (user.categories && user.categories.length > 0) {
    const accountCategories = user.categories.filter(
      cat => cat.accountId === accountId
    );
    
    const match = findCategoryMatch(accountCategories, data.category, data.subCategory);
    
    if (match) {
      return {
        categoryId: match.categoryId,
        subCategoryId: match.subCategoryId
      };
    }
  }
  
  // 2️⃣ FALLBACK: API
  const apiCategories = await gastoCertoApi.getAccountCategories(userId, accountId);
  
  // Atualizar cache
  await userCache.updateCategories(phoneNumber, apiCategories);
  
  const match = findCategoryMatch(apiCategories, data.category, data.subCategory);
  
  if (!match) {
    throw new Error('Categoria não encontrada');
  }
  
  return {
    categoryId: match.categoryId,
    subCategoryId: match.subCategoryId
  };
}
```

**Benefícios**:
- ⚡ **Performance**: 90% dos casos resolvidos em cache
- 📉 **Redução de API calls**: De ~100/dia para ~10/dia
- 🔄 **Sincronização**: Cache atualizado a cada 1 hora

---

## 📊 Providers de IA Suportados

### OpenAI (GPT-4)
- **Uso**: Extração de transações complexas
- **Custo**: $0.03 / 1K tokens
- **Precisão**: 95%+

### Google Gemini
- **Uso**: Análise de imagens (Gemini Vision)
- **Custo**: Gratuito (quota)
- **Precisão**: 92%+

### Groq (Llama 3)
- **Uso**: Extração rápida de texto
- **Custo**: Gratuito (beta)
- **Velocidade**: 200 tokens/s

### DeepSeek
- **Uso**: Análise de contexto avançado
- **Custo**: $0.14 / 1M tokens
- **Precisão**: 90%+

**Seleção Automática**:
```typescript
// Texto simples → Groq (rápido)
// Imagem → Gemini (melhor OCR)
// Contexto complexo → GPT-4 (mais preciso)
```

---

## 🔐 Segurança e Rate Limiting

### Proteções Implementadas

1. **Rate Limiting por Usuário**:
   ```typescript
   MAX_MESSAGES_PER_MINUTE = 10
   MAX_TRANSACTIONS_PER_DAY = 100
   ```

2. **Validação de Entrada**:
   - Sanitização de texto
   - Validação de MIME types
   - Limite de tamanho de mídia (10MB)

3. **Timeout de Confirmações**:
   - Expira em 24 horas
   - Limpeza automática de pendentes

4. **Cache de AI Responses**:
   - Evita chamadas duplicadas
   - TTL de 5 minutos

---

## 📈 Métricas e Logs

### Logs Estruturados

```typescript
// Entrada de mensagem
this.logger.log(`📨 Mensagem recebida: ${phoneNumber} | Tipo: ${type}`);

// Análise de IA
this.logger.log(`🤖 IA processou em ${responseTime}ms | Confiança: ${confidence}%`);

// Auto-registro
this.logger.log(`🚀 Auto-registrado: ${transactionId} | ${amount}`);

// Confirmação criada
this.logger.log(`💬 Confirmação criada: ${confirmationId}`);

// Erro
this.logger.error(`❌ Erro ao processar: ${error.message}`);
```

### KPIs Monitorados

- **Taxa de Auto-Registro**: % transações com confiança ≥ 80%
- **Tempo de Resposta**: Latência média de processamento
- **Taxa de Confirmação**: % usuários que confirmam vs rejeitam
- **Precisão de IA**: Comparação entre extração e confirmação
- **Custo de IA**: Gastos por usuário/mês

---

## 🧪 Testes

### Casos de Teste

1. **Texto Simples**:
   - Input: `"Gastei R$ 50 no mercado"`
   - Output: Auto-registro com confiança 95%

2. **Texto Ambíguo**:
   - Input: `"Paguei conta"`
   - Output: Solicita mais detalhes

3. **Imagem de Cupom**:
   - Input: Foto de nota fiscal
   - Output: Extração de itens + confirmação

4. **Confirmação Pendente**:
   - Input: Nova transação com pending ativa
   - Output: Bloqueio + aviso

5. **Timeout de Sessão**:
   - Input: Confirmação após 24h
   - Output: Mensagem de expiração

---

## 📚 Referências de Código

- `src/modules/messages/message-filter.service.ts`
- `src/modules/messages/messages.processor.ts`
- `src/modules/transactions/transactions.service.ts` (Orchestrator)
- `src/modules/transactions/contexts/registration/registration.service.ts`
- `src/modules/transactions/transaction-confirmation.service.ts`
- `src/modules/ai/ai-provider.factory.ts`
- `src/modules/intent/intent-analyzer.service.ts`
