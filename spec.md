# 📋 GastoCerto ZAP — Especificação Técnica e Roadmap de Implementação

> **Documento consolidado** com análise completa do `gastocerto-zap` cobrindo: arquitetura de fluxo de mensagens, cascata NLP/RAG/IA, estrutura multi-provider/multi-account de IA e roadmap do assistente financeiro.
>
> **Data**: 28 de abril de 2026
> **Branch base**: `dev`
> **Status**: Pronto para implementação faseada

---

## Sumário

1. [Visão Geral & Princípios](#1-visão-geral--princípios)
2. [Arquitetura Atual](#2-arquitetura-atual)
3. [Análise 1 — Fluxo de Mensagens (WhatsApp / Telegram / WebChat)](#3-análise-1--fluxo-de-mensagens-whatsapp--telegram--webchat)
4. [Análise 2 — Cascata NLP / RAG / IA](#4-análise-2--cascata-nlp--rag--ia)
5. [Análise 3 — IA Multi-Provider e Multi-Account](#5-análise-3--ia-multi-provider-e-multi-account)
6. [Análise 4 — Roadmap do Assistente Financeiro](#6-análise-4--roadmap-do-assistente-financeiro)
7. [Plano de Implementação Priorizado](#7-plano-de-implementação-priorizado)
8. [Métricas de Sucesso](#8-métricas-de-sucesso)
9. [Anexos](#9-anexos)

---

## 1. Visão Geral & Princípios

### 1.1 Propósito do produto
O `gastocerto-zap` é o **gateway conversacional** do ecossistema GastoCerto. Funciona como assistente financeiro que processa mensagens (texto, áudio, imagem, PDF) em três canais (WhatsApp, Telegram, WebChat) e delega persistência ao serviço upstream `gastocerto-api`.

### 1.2 Princípios arquiteturais
- **API-first**: toda persistência vai para `gastocerto-api`; o zap mantém apenas cache, RAG, sessões e logs.
- **Custo IA mínimo**: cascata NLP → BM25/RAG → IA (último recurso); cache agressivo.
- **Multi-canal unificado**: mesmo orquestrador (`TransactionsService`) atende todos os canais.
- **Multi-account-per-provider**: maximizar free-tier rotacionando credenciais (ex: 5 contas Grok, 3 OpenAI).
- **Account-scoped data**: tudo (categorias, sinônimos, RAG) escopado por `userId + accountId`.

### 1.3 Stack
- NestJS 10 + Prisma + Redis + node-nlp + BM25 custom
- Providers IA: OpenAI, Google Gemini, Groq, DeepSeek (factory + circuit breaker)
- Canais: Baileys (WhatsApp), Telegraf (Telegram), HTTP/WebSocket (WebChat)

---

## 2. Arquitetura Atual

### 2.1 Diagrama macro de mensagens

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  WhatsApp    │  │  Telegram    │  │  WebChat     │
│  Baileys     │  │  Telegraf    │  │  HTTP/WS     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       │ MESSAGE_EVENTS  │                 │
       ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ WhatsAppMsg  │  │ TelegramMsg  │  │ Webchat      │
│ Handler      │  │ Handler      │  │ Service      │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────┬────────┴────────┬────────┘
                ▼                 │
        ┌────────────────────────┐
        │ MessageValidation      │ (rate-limit, subscription, lock)
        └─────────┬──────────────┘
                  ▼
        ┌────────────────────────┐
        │ TransactionsService    │ ◄── ORQUESTRADOR ÚNICO
        │ .processTextMessage()  │
        └─────────┬──────────────┘
                  ▼
        ┌────────────────────────┐
        │ IntentAnalyzer →       │
        │ Map<Intent, Handler>   │
        └─────────┬──────────────┘
                  ▼
        ┌────────────────────────┐
        │ Domain Services:       │
        │ - Registration         │
        │ - Listing              │
        │ - Payment              │
        │ - Summary              │
        │ - CreditCard           │
        │ - Account              │
        │ - Chart                │
        └─────────┬──────────────┘
                  ▼
        ┌────────────────────────┐
        │ PlatformReplyService   │ ◄── FUNIL ÚNICO DE RESPOSTA
        └─────────┬──────────────┘
                  ▼
        REPLY_EVENTS.{WHATSAPP|TELEGRAM} (WebChat = HTTP sync)
```

### 2.2 Componentes-chave (file:line)

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Entry WhatsApp | [src/infrastructure/messaging/messages/handlers/whatsapp-message.handler.ts](src/infrastructure/messaging/messages/handlers/whatsapp-message.handler.ts) | `@OnEvent(MESSAGE_EVENTS.WHATSAPP)` L53 |
| Entry Telegram | [src/infrastructure/messaging/messages/handlers/telegram-message.handler.ts](src/infrastructure/messaging/messages/handlers/telegram-message.handler.ts) | `@OnEvent(MESSAGE_EVENTS.TELEGRAM)` L39 |
| Entry WebChat | [src/features/webchat/webchat.service.ts](src/features/webchat/webchat.service.ts) | HTTP síncrono, JWT já validado |
| Validação | [src/features/messages/message-validation.service.ts](src/features/messages/message-validation.service.ts) | Rate-limit + subscription + lock |
| Orquestrador | [src/features/transactions/transactions.service.ts](src/features/transactions/transactions.service.ts) | `processTextMessage()` L151 |
| Reply funnel | [src/infrastructure/messaging/messages/platform-reply.service.ts](src/infrastructure/messaging/messages/platform-reply.service.ts) | Centraliza `sendReply()` |
| RAG | [src/infrastructure/rag/services/rag-search.service.ts](src/infrastructure/rag/services/rag-search.service.ts) | BM25 + sinônimos |
| AI Factory | [src/infrastructure/ai/ai-provider.factory.ts](src/infrastructure/ai/ai-provider.factory.ts) | Multi-provider + circuit breaker |
| API Client | [src/shared/gasto-certo-api.service.ts](src/shared/gasto-certo-api.service.ts) | Facade upstream |

---

## 3. Análise 1 — Fluxo de Mensagens (WhatsApp / Telegram / WebChat)

### 3.1 Pontos fortes
- ✅ Convergência limpa: 3 entradas → 1 orquestrador → 1 funil de resposta
- ✅ `PlatformReplyService` abstrai diferenças de canal
- ✅ Suporte a todas as mídias (text/audio/image/PDF)
- ✅ Eventos assíncronos (não bloqueia ingestão de mensagens)

### 3.2 Divergências identificadas

#### D1 — Resolução de usuário fragmentada (impacto MÉDIO)

Cada canal usa um lookup diferente em [user-cache.service.ts](src/features/users/user-cache.service.ts):

| Canal | Método | Chave |
|---|---|---|
| WhatsApp | `getUser(phoneNumber)` | telefone |
| Telegram | `getUserByTelegram(telegramId)` | telegram id |
| WebChat | `getUserByGastoCertoId(userId)` | gastoCertoId |

**Solução proposta** (Quick Win):
```typescript
// src/features/users/user-cache.service.ts
async resolveUserByPlatform(
  platform: MessagingPlatform,
  platformId: string,
): Promise<UserCache | null> {
  const strategies = {
    [MessagingPlatform.WHATSAPP]: () => this.getUser(platformId),
    [MessagingPlatform.TELEGRAM]: () => this.getUserByTelegram(platformId),
    [MessagingPlatform.WEBCHAT]:  () => this.getUserByGastoCertoId(platformId),
  };
  return strategies[platform]?.() ?? null;
}
```

#### D2 — Rate-limit por canal (impacto SEGURANÇA)

Hoje cada canal tem bucket separado → mesmo usuário pode estourar limite migrando entre canais.

- WhatsApp: chave = `phoneNumber` ([whatsapp-message.handler.ts L115](src/infrastructure/messaging/messages/handlers/whatsapp-message.handler.ts#L115))
- Telegram: chave = `telegramId` ([telegram-message.handler.ts L55](src/infrastructure/messaging/messages/handlers/telegram-message.handler.ts#L55))
- WebChat: chave = `webchat-${userId}` ([webchat.service.ts L77](src/features/webchat/webchat.service.ts#L77))

**Solução proposta** (Quick Win):
```typescript
const rateLimitKey = user?.gastoCertoId ?? `${platform}:${platformId}`;
await this.userRateLimiter.checkLimit(rateLimitKey);
```

#### D3 — Sincronização de subscription inconsistente (impacto MÉDIO)
- WhatsApp: cache miss + timer + flag inactive
- Telegram: cache miss apenas (sem retry)
- WebChat: sincroniza a cada request (custo)

**Solução**: extrair política única em `SubscriptionSyncService` aplicada uniformemente.

#### D4 — Overhead de context registration (impacto BAIXO)
`MessageContextService` é usado só para reply assíncrono. WebChat ignora. Pode ser unificado em flag `requiresAsyncReply`.

#### D5 — Mídia não unificada (impacto MÉDIO — ver §4)
- Texto: Intent → RAG → IA → RAG revalidação
- Áudio: transcrição → mesmo fluxo de texto
- **Imagem: pula RAG** (vai direto na IA)
- **PDF: pula RAG** (vai direto na IA)

### 3.3 Recomendações
| # | Ação | Esforço | ROI |
|---|---|---|---|
| R1 | `resolveUserByPlatform()` unificado | 4h | Alto |
| R2 | Rate-limit por `gastoCertoId` | 4h | Alto (segurança) |
| R3 | `SubscriptionSyncService` único | 1d | Médio |
| R4 | Padrão `PlatformProcessor` (refactor completo) | 2-3 semanas | Alto (escala) |

---

## 4. Análise 2 — Cascata NLP / RAG / IA

### 4.1 Pipeline atual completo

```
PHASE 1: Carregamento + Intent Analysis
  ├─ AIConfigService.getSettings()       [ms ~1, $0]
  ├─ getUserCategories(account-scoped)   [ms 5-50, $0]
  ├─ RAG.indexUserCategories(fire&forget)[ms ~10, $0]
  └─ IntentAnalyzerService.analyzeIntent [ms 1-2, $0, accuracy 85-95%]
       30 padrões keyword/regex

PHASE 2: Extração de transação
  ├─ 2b: Detect type (income/expense)    [ms <1, $0]
  ├─ 2c: RAG Phase 1 — BM25 matching     [ms 5-10, $0, accuracy 80-92%]
  │       ├─ tokenize + stop words
  │       ├─ BM25 scores
  │       ├─ boosts: query→subcategory (+8/+10), bigram (+1.5), synonym (+3/+5)
  │       └─ se score ≥ ragThreshold(0.6) → JUMP PHASE 3 (skip IA)
  │
  ├─ 2d: IA extraction (se RAG falhar)   [ms 500-2000, $0.001-$0.01]
  │       ├─ OpenAI GPT-4o:    ~95% accuracy
  │       ├─ Gemini 1.5 Pro:   ~90% accuracy
  │       ├─ Groq Llama 3.1:   ~88% accuracy
  │       └─ DeepSeek:         ~85% accuracy
  │
  └─ 2e: RAG Phase 3 — revalidação IA    [ms 5-10, $0]
          se RAG diverge da IA com score >0.6 → substitui categoria

PHASE 3: Enriquecimentos
  ├─ InstallmentParser.detect()          [ms <1, $0, accuracy 90%]
  ├─ FixedTransactionParser.detect()     [ms <1, $0, accuracy 85%]
  └─ TemporalParser.parseExpression()    [ms 10-50, $0, accuracy 75-90%]

PHASE 4: Category Resolver (account-scoped)
  └─ cache RAG → cache user → API        [ms 1-50, $0]

PHASE 5: Learning Detection
  └─ flag termos desconhecidos para sinônimos

PHASE 6/7: Auto-register OR Confirmation
```

### 4.2 GAPs identificados

| # | GAP | Localização | Impacto | Custo evitável |
|---|---|---|---|---|
| G1 | **Imagem pula RAG** | [registration.service.ts L446](src/features/transactions/contexts/registration/registration.service.ts#L446) | Alto | $50/mês/usuário ativo |
| G2 | **PDF pula RAG** | [registration.service.ts L672](src/features/transactions/contexts/registration/registration.service.ts#L672) | Médio | $100-200/mês |
| G3 | **Temporal não cacheado** | [registration.service.ts L290](src/features/transactions/contexts/registration/registration.service.ts#L290) | Baixo | -20-50ms |
| G4 | **Sinônimos não aplicados em imagem** | [rag-search.service.ts L1240](src/infrastructure/rag/services/rag-search.service.ts#L1240) | Médio | -15% confirmações |
| G5 | **Sem cache de respostas IA por similaridade** | (não existe) | Alto | $100-200/mês |
| G6 | **Sem base de merchants conhecidos** | (não existe) | Alto | $50-100/mês + 500ms |

### 4.3 Recomendações priorizadas

#### Quick Wins (< 1 semana)

**R5 — Base de merchants** (~2h efetivos)
```typescript
// src/common/constants/merchants.ts
export const COMMON_MERCHANTS = {
  'mercado': 'grocery', 'supermercado': 'grocery',
  'padaria': 'bakery', 'farmacia': 'pharmacy',
  'uber': 'transportation', 'ifood': 'food_delivery',
  // ~500 entries (extraível de transaction history)
};
```
- Aplicar antes do RAG: regex direto → `confidence: 0.95`
- **Impacto**: 40-50% do tráfego → $0 custo IA

**R6 — Cache de expressões temporais** (~3h)
```typescript
const cacheKey = `temporal:${normalize(text)}`;
let analysis = await cache.get(cacheKey);
if (!analysis) {
  analysis = this.temporalParser.parseTemporalExpression(text);
  await cache.set(cacheKey, analysis, 3600);
}
```

**R7 — Aplicar RAG em imagens** (~1d)
```typescript
const extracted = await this.aiFactory.analyzeImage(buffer, mimeType);
if (extracted.confidence < 0.7) {
  const ragMatch = await this.ragService.findSimilarCategories(
    extracted.description,
    userId,
    { accountId, minScore: 0.5 },
  );
  if (ragMatch[0]?.score > 0.6) {
    extracted.category = ragMatch[0].categoryName;
    extracted.confidence *= 1.2;
  }
}
```

#### Médio prazo (1-2 semanas)

**R8 — Cache IA por similaridade**
- Normalizar texto removendo números/datas
- Hash + lookup Redis com cosine similarity threshold 0.85
- TTL 30 dias, escopo `accountId`
- **Impacto**: 50-70% hit rate em usuários recorrentes

**R9 — RAG-first para PDF**
- Tentar RAG Phase 1 ANTES da IA quando PDF tem texto extraível
- Vendors recorrentes (NF supermercado, etc) = -30-40% custo

**R10 — Aplicar sinônimos em descrições de imagem** (G4)

#### Longo prazo (2-4 semanas)

**R11 — Merchant Learning System**: aprende novo merchant→categoria após confirmação
**R12 — node-nlp avançado para detecção de tipo**: model.nlp local com training expandido
**R13 — Refactor Platform Processor pattern** (D5)

### 4.4 Tabela consolidada Caching

| Item | Atual | Proposto | TTL | Ganho |
|---|---|---|---|---|
| RAG Index | on-demand | warm | sessão | -5-10ms/msg |
| User Categories | 5min | 15min | 15min | -DB hits |
| Temporal | sem cache | Redis | 1h | -20-50ms |
| AI Responses (similar) | sem cache | Redis+cosine | 30d | -$50-200/mês |
| Sinônimos | fresh | Redis | 7d | -3-5ms |
| Merchants | n/a | regex+dict | ∞ | -200ms, $0 |

---

## 5. Análise 3 — IA Multi-Provider e Multi-Account

### 5.1 Estado atual

**Factory** ([ai-provider.factory.ts](src/infrastructure/ai/ai-provider.factory.ts)):
- Seleção dinâmica por operação (text/image/audio/category)
- Circuit breaker: 3 falhas → `open` por 60s → `half-open` para teste
- Rate limit + cache + fallback chain configurável

**Modelo Prisma** (`AIProviderConfig`, schema.prisma L280-310):
```prisma
model AIProviderConfig {
  id           String  @id @default(uuid())
  provider     String  @unique   // ⚠️ BLOQUEIO: 1 conta por provider
  apiKey       String?           // criptografada AES-256-GCM
  enabled      Boolean
  priority     Int
  rpmLimit     Int?
  tpmLimit     Int?
  totalRequests Int
  totalErrors   Int
  // ... custos, modelos, cache flags
}
```

### 5.2 GAPs bloqueadores

| # | GAP | Severidade |
|---|---|---|
| AI-G1 | `provider` é `@unique` → impossível ter 2+ contas mesmo provider | 🔴 CRÍTICO |
| AI-G2 | `AIUsageLog` não rastreia qual conta foi usada | 🔴 CRÍTICO |
| AI-G3 | Circuit breaker é por provider, não por conta | 🟠 ALTO |
| AI-G4 | Sem round-robin / weighted entre contas | 🟠 ALTO |
| AI-G5 | Sem tracking de quota diária por conta (free-tier) | 🟡 MÉDIO |
| AI-G6 | Admin sem CRUD de contas | 🟠 ALTO |

### 5.3 Design proposto

#### 5.3.1 Schema (migration breaking)

```prisma
// NOVO: tabela de credenciais (1 provider → N contas)
model AIProviderCredential {
  id              String  @id @default(uuid())
  providerId      String  // FK → AIProviderConfig.id
  label           String  // ex: "grok-account-01", "openai-billing"
  apiKey          String  // criptografada AES-256-GCM
  baseUrl         String? // override opcional
  enabled         Boolean @default(true)
  weight          Int     @default(1)   // weighted round-robin
  priority        Int     @default(100) // ordem dentro do provider

  // Quota tracking (free-tier maximization)
  dailyTokenLimit    Int?    // null = ilimitado
  dailyRequestLimit  Int?
  monthlyTokenLimit  Int?
  rpmLimit           Int?    // por credencial

  // Métricas em tempo real
  tokensUsedToday    Int     @default(0)
  requestsUsedToday  Int     @default(0)
  tokensUsedMonth    Int     @default(0)
  lastResetDailyAt   DateTime?
  lastResetMonthAt   DateTime?

  // Circuit breaker por credencial
  consecutiveErrors  Int     @default(0)
  circuitOpenUntil   DateTime?
  lastUsedAt         DateTime?
  lastErrorAt        DateTime?
  lastErrorMessage   String?

  totalRequests      Int     @default(0)
  totalErrors        Int     @default(0)
  totalTokens        BigInt  @default(0)
  estimatedCostUsd   Decimal @default(0) @db.Decimal(12,6)

  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  provider AIProviderConfig @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId, enabled])
  @@index([priority])
}

// AJUSTE em AIProviderConfig
model AIProviderConfig {
  // ... campos existentes ...
  // REMOVE: apiKey (move para Credential)
  selectionStrategy  String  @default("round_robin")
  // valores: round_robin | weighted | priority | least_used | quota_aware
  credentials        AIProviderCredential[]
}

// AJUSTE em AIUsageLog
model AIUsageLog {
  // ... campos existentes ...
  credentialId       String?  // qual conta foi usada
  credentialLabel    String?  // snapshot do label (auditoria)

  @@index([credentialId])
}
```

#### 5.3.2 Estratégias de seleção (`AICredentialSelector`)

```typescript
// src/infrastructure/ai/ai-credential-selector.service.ts (NOVO)
export type SelectionStrategy =
  | 'round_robin'   // distribui igualmente
  | 'weighted'      // proporcional ao weight
  | 'priority'      // sempre a de menor priority disponível
  | 'least_used'    // a com menos requestsUsedToday
  | 'quota_aware';  // prioriza quem tem mais quota livre (default!)

@Injectable()
export class AICredentialSelector {
  async pickCredential(provider: string): Promise<AIProviderCredential> {
    const config = await this.configService.getProviderConfig(provider);
    const credentials = await this.listAvailable(provider); // filtra disabled, circuit open, quota esgotada

    if (credentials.length === 0) {
      throw new NoAvailableCredentialError(provider);
    }

    switch (config.selectionStrategy) {
      case 'round_robin': return this.roundRobin(provider, credentials);
      case 'weighted':    return this.weightedRandom(credentials);
      case 'priority':    return credentials[0]; // já ordenado
      case 'least_used':  return this.leastUsed(credentials);
      case 'quota_aware': return this.quotaAware(credentials);
    }
  }

  private async listAvailable(provider: string) {
    const now = new Date();
    return prisma.aIProviderCredential.findMany({
      where: {
        provider: { provider },
        enabled: true,
        OR: [
          { circuitOpenUntil: null },
          { circuitOpenUntil: { lt: now } },
        ],
      },
      orderBy: { priority: 'asc' },
    }).then(creds => creds.filter(c => this.hasQuotaAvailable(c)));
  }

  private hasQuotaAvailable(c: AIProviderCredential): boolean {
    if (c.dailyTokenLimit && c.tokensUsedToday >= c.dailyTokenLimit) return false;
    if (c.dailyRequestLimit && c.requestsUsedToday >= c.dailyRequestLimit) return false;
    if (c.monthlyTokenLimit && c.tokensUsedMonth >= c.monthlyTokenLimit) return false;
    return true;
  }
}
```

#### 5.3.3 Fluxo de chamada com failover em duas camadas

```
extractTransaction(text)
  ├─ provider = 'groq' (do AISettings.textProvider)
  │
  ├─ Loop nas credenciais do Groq (round-robin):
  │    cred = selector.pickCredential('groq')
  │    try:
  │      result = groqProvider.callWith(cred, text)
  │      selector.recordSuccess(cred, tokensUsed)
  │      return result
  │    catch (rateLimitError | quotaExceeded):
  │      selector.markQuotaExhausted(cred)
  │      continue → próxima credencial Groq
  │    catch (authError | apiError):
  │      selector.recordFailure(cred) // pode abrir circuit
  │      continue → próxima credencial Groq
  │
  ├─ Se TODAS as credenciais Groq falharem → fallback para próximo provider
  │    fallbackChain = AISettings.fallbackTextChain // ['groq','deepseek','gemini','openai']
  │    next = 'deepseek' → repetir loop
  │
  └─ Se todos providers falharem → throw AllProvidersExhaustedError
```

#### 5.3.4 Reset automático de quotas (job)

```typescript
// src/infrastructure/ai/jobs/quota-reset.job.ts (NOVO)
@Cron('0 0 * * *') // meia-noite UTC
async resetDailyQuotas() {
  await prisma.aIProviderCredential.updateMany({
    data: {
      tokensUsedToday: 0,
      requestsUsedToday: 0,
      lastResetDailyAt: new Date(),
    },
  });
}

@Cron('0 0 1 * *') // dia 1 de cada mês
async resetMonthlyQuotas() {
  await prisma.aIProviderCredential.updateMany({
    data: { tokensUsedMonth: 0, lastResetMonthAt: new Date() },
  });
}
```

#### 5.3.5 Endpoints admin novos

```
POST   /admin/ai-providers/:provider/credentials       # criar
GET    /admin/ai-providers/:provider/credentials       # listar (com quota usage %)
PATCH  /admin/ai-providers/:provider/credentials/:id   # editar (label, weight, limits, enabled)
DELETE /admin/ai-providers/:provider/credentials/:id   # remover
POST   /admin/ai-providers/:provider/credentials/:id/test       # testa apiKey
POST   /admin/ai-providers/:provider/credentials/:id/reset-circuit
GET    /admin/ai-providers/:provider/usage/today       # snapshot consumo dia
GET    /admin/ai-providers/usage/summary?from&to       # agregado por credencial
```

#### 5.3.6 Quotas free-tier sugeridas (defaults)

| Provider | dailyTokenLimit | dailyRequestLimit | monthlyTokenLimit | rpmLimit |
|---|---|---|---|---|
| Groq | 1.000.000 | 14.400 | 30M | 30 |
| Gemini Flash | 1.500.000 | 1.500 | 50M | 15 |
| OpenAI (free credits) | 200.000 | 1.000 | 5M | 3 |
| DeepSeek | (pay-as-you-go) | - | - | 60 |

> Defaults baseados em free-tier público de abril/2026 — valores **devem** ser configuráveis via admin.

### 5.4 Plano de migração (sem quebrar produção)

1. **Migration aditiva**: criar `AIProviderCredential`, manter `AIProviderConfig.apiKey` por enquanto.
2. **Backfill**: para cada `AIProviderConfig` existente, criar 1 credential `default` com a mesma `apiKey`.
3. **Feature flag** `AI_MULTI_CREDENTIAL_ENABLED`:
   - Off → factory continua usando `AIProviderConfig.apiKey` (comportamento atual)
   - On → factory usa `AICredentialSelector`
4. **Migration final** (após estabilizar): remover `AIProviderConfig.apiKey`.

### 5.5 Observabilidade necessária

- Métricas Prometheus por credencial: `ai_credential_requests_total`, `ai_credential_tokens_total`, `ai_credential_errors_total`, `ai_credential_quota_used_ratio`
- Alertas: credencial com circuit aberto > 5min, quota > 80% antes do reset
- Dashboard admin: card por credencial com gauge de quota + sparkline 24h

---

## 6. Análise 4 — Roadmap do Assistente Financeiro

### 6.1 Capacidades já implementadas

#### Transactions
| Feature | Método API | Handler |
|---|---|---|
| Criar (texto/imagem/áudio/PDF) | `createTransaction()` | `RegistrationIntentHandler` |
| Listar com filtros | `listTransactions()` | `ListingIntentHandler` |
| Recorrentes | `fixedParser.parse()` | Registration |
| Parceladas | `installmentParser.parse()` | Registration |
| Pagar | `payTransaction()` | `PaymentIntentHandler` |

#### Accounts
| Feature | Handler |
|---|---|
| Listar contas | `AccountIntentHandler` (LIST_ACCOUNTS) |
| Mostrar conta ativa | SHOW_ACTIVE_ACCOUNT |
| Trocar conta ativa | SWITCH_ACCOUNT |

#### Credit Cards
| Feature | Método | Handler |
|---|---|---|
| Listar cartões | `listCreditCards()` | `CreditCardIntentHandler` |
| Listar faturas | `listCreditCardInvoices()` | Summary/CreditCard |
| Detalhes da fatura | `getInvoiceDetails()` | CreditCard |
| Pagar fatura | `payCreditCardInvoice()` | Payment |
| Definir cartão padrão | `setDefault()` | CreditCard |

#### Reports / Analytics
| Feature | Método |
|---|---|
| Resumo mensal | `getMonthlySummary()` |
| Balanço geral | `getOverallBalance()` |
| Balanço mensal | `getMonthlyBalance()` |
| Gráfico de categorias (PNG) | `getCategoryChart()` |
| Gráfico overview mensal | `getMonthlyOverviewChart()` |

#### Auth / Onboarding
| Feature | Método |
|---|---|
| Registro | `createUser()` |
| Código de autenticação | `requestAuthCode()` / `validateAuthCode()` |
| Vincular telefone | `linkPhone()` |
| Verificar subscription | `getSubscriptionStatus()` |

### 6.2 Lacunas (não implementado)

| Categoria | Lacuna | API existe? |
|---|---|---|
| **Goals/Budget** | Criar meta por categoria | ❌ Precisa endpoint |
| **Goals/Budget** | Alertas ao ultrapassar | ❌ Precisa endpoint + job |
| **Recurring Mgmt** | Listar recorrências ativas | ❓ verificar API |
| **Recurring Mgmt** | Cancelar/modificar recorrência | ❓ verificar API |
| **Filtros** | Período custom, merchant, faixa de valor | ⚠️ Parcial (`listTransactions`) |
| **Multi-currency** | Transações em USD/EUR + conversão | ❌ Precisa API |
| **Notifications** | Lembrete contas a vencer | ❌ Job zap-side |
| **Notifications** | Relatório semanal automático | ❌ Job zap-side |
| **Analytics** | Forecast end-of-month | ❌ Cálculo zap-side |
| **Analytics** | Comparação MoM/YoY | ⚠️ Calcular zap-side com summary |
| **Analytics** | Detecção de gastos atípicos | ❌ Estatística zap-side |
| **Export** | CSV / PDF / Excel | ❌ Precisa endpoint |
| **Voice** | TTS de resposta | ❌ Provider novo (ElevenLabs/Polly) |
| **Shared accounts** | Compartilhar com família | ❌ Mudança grande no API |
| **Open Banking** | Importação automática | ❌ Iniciativa separada |

### 6.3 Roadmap faseado

#### 🟢 Fase 1 — MVP++ (4-6 semanas)
**Objetivo**: tornar o assistente proativo e completar gestão básica.

1. **Goals & Budget** (precisa coordenação com `gastocerto-api`)
   - Novo modelo `Budget` (api): `{ userId, accountId, categoryId, monthlyLimit, alertThreshold }`
   - Novos endpoints: `POST/GET/PATCH /external/budgets`
   - Novo intent zap: `SET_BUDGET`, `CHECK_BUDGET`, `LIST_BUDGETS`
   - Job zap diário: avalia % consumido do budget → notifica via canal

2. **Recurring Transaction Management**
   - Validar/expor endpoints na api: `GET /external/transactions/recurring`, `DELETE /:id`, `PATCH /:id`
   - Intents: `LIST_RECURRING`, `CANCEL_RECURRING`, `EDIT_RECURRING`

3. **Filtros avançados de listagem**
   - Estender `listTransactions` filtros: `merchantContains`, `valueMin`, `valueMax`, `dateFrom`, `dateTo`
   - Parser zap: "transações acima de 100 reais em março"

4. **Notificações ativas**
   - `BillReminderJob` (cron diário): consulta contas a vencer em 3 dias → envia mensagem WhatsApp/Telegram
   - `WeeklyReportJob` (cron domingo 20h): gera resumo semana → envia + gráfico PNG

#### 🟡 Fase 2 — Inteligência (6-8 semanas)
**Objetivo**: assistente proativo com analytics.

5. **Forecast end-of-month**
   - Algoritmo zap-side: média móvel diária + projeção linear até fim do mês
   - Intent: `FORECAST_BALANCE` ("como vou terminar o mês?")

6. **Comparação MoM/YoY**
   - Calcular zap-side a partir de `getMonthlySummary` históricos
   - Intent: `COMPARE_MONTHS`, `COMPARE_YEAR`

7. **Detecção de gastos atípicos**
   - Z-score por categoria/merchant
   - Notificação proativa: "gasto em ifood 300% acima da média"

8. **Export de dados**
   - Endpoint api `POST /external/transactions/export?format=csv|pdf|xlsx`
   - Intent: `EXPORT_TRANSACTIONS`

9. **Recomendações personalizadas**
   - LLM consulta histórico (com cache RAG) → sugere economias
   - Intent: `GET_RECOMMENDATIONS`

#### 🔵 Fase 3 — Plataforma (8+ semanas)
**Objetivo**: expandir produto.

10. **Multi-currency**: novo modelo no api + integração com câmbio
11. **Shared accounts**: permissões + split de despesas
12. **Voice responses (TTS)**: provider novo + opt-in por usuário
13. **Open Banking**: integração Pluggy/Belvo (iniciativa separada)
14. **Webhook integrations**: Zapier/IFTTT para automações de terceiros

### 6.4 Mapeamento intent → endpoint (novos)

| Novo Intent | Endpoint api requerido | Fase |
|---|---|---|
| `SET_BUDGET` | `POST /external/budgets` | 1 |
| `CHECK_BUDGET` | `GET /external/budgets?accountId&month` | 1 |
| `LIST_RECURRING` | `GET /external/transactions/recurring` | 1 |
| `CANCEL_RECURRING` | `DELETE /external/transactions/recurring/:id` | 1 |
| `FORECAST_BALANCE` | reusa `getMonthlySummary` (cálculo zap) | 2 |
| `COMPARE_MONTHS` | reusa `getMonthlySummary` × N (cálculo zap) | 2 |
| `EXPORT_TRANSACTIONS` | `POST /external/transactions/export` | 2 |
| `GET_RECOMMENDATIONS` | reusa `listTransactions` + LLM | 2 |

---

## 7. Plano de Implementação Priorizado

### 7.1 Visão consolidada (matriz esforço × impacto)

| # | Item | Categoria | Esforço | Impacto | Fase |
|---|---|---|---|---|---|
| **QW1** | `resolveUserByPlatform()` unificado | Fluxo | 4h | Médio | Imediato |
| **QW2** | Rate-limit por `gastoCertoId` | Segurança | 4h | Alto | Imediato |
| **QW3** | Base de merchants (~500 entries) | NLP/Custo | 2h | Alto ($50-100/mês) | Imediato |
| **QW4** | Cache temporal expressions | Performance | 3h | Médio | Imediato |
| **QW5** | Aplicar RAG em imagens | NLP/Custo | 1d | Alto ($30-50/mês) | Sprint 1 |
| **QW6** | Aplicar sinônimos em imagens | NLP/UX | 0.5d | Médio | Sprint 1 |
| **M1** | `SubscriptionSyncService` único | Fluxo | 1d | Médio | Sprint 1 |
| **M2** | Cache IA por similaridade | NLP/Custo | 1.5sem | Alto ($100-200/mês) | Sprint 2 |
| **M3** | RAG-first para PDF | NLP/Custo | 3d | Médio | Sprint 2 |
| **M4** | Merchant Learning System | NLP | 1sem | Médio (compõe) | Sprint 3 |
| **AI1** | Schema `AIProviderCredential` + migration | Multi-account | 2d | Bloqueia AI2-AI5 | Sprint 2 |
| **AI2** | `AICredentialSelector` (5 estratégias) | Multi-account | 4d | Crítico | Sprint 2 |
| **AI3** | Refactor providers para receber credential | Multi-account | 3d | Crítico | Sprint 2 |
| **AI4** | Job de reset de quotas | Multi-account | 0.5d | Médio | Sprint 2 |
| **AI5** | Endpoints admin CRUD credenciais | Multi-account | 2d | Alto | Sprint 3 |
| **AI6** | Dashboard admin (gauge + sparkline) | Observabilidade | 3d | Médio | Sprint 3 |
| **AI7** | Métricas Prometheus por credencial | Observabilidade | 1d | Médio | Sprint 3 |
| **R1** | Goals & Budget (api+zap) | Roadmap | 2sem | Alto | Sprint 4-5 |
| **R2** | Recurring Mgmt | Roadmap | 1sem | Médio | Sprint 5 |
| **R3** | Notificações ativas (jobs) | Roadmap | 1sem | Alto | Sprint 5 |
| **R4** | Filtros avançados | Roadmap | 4d | Médio | Sprint 5 |
| **R5** | Forecast + comparação MoM | Roadmap | 1sem | Alto | Sprint 6-7 |
| **R6** | Detecção atípica + recomendações | Roadmap | 1.5sem | Alto | Sprint 7 |
| **R7** | Export CSV/PDF/XLSX | Roadmap | 1sem | Médio | Sprint 7 |
| **L1** | Platform Processor pattern | Refactor | 2-3sem | Alto (escala) | Sprint 8+ |
| **L2** | Multi-currency | Roadmap | 3sem | Médio | Sprint 9+ |
| **L3** | Shared accounts | Roadmap | 4sem | Alto | Sprint 10+ |
| **L4** | Voice TTS | Roadmap | 2sem | Médio | Sprint 10+ |
| **L5** | Open Banking | Roadmap | 6sem+ | Alto | Iniciativa |

### 7.2 Sprint plan sugerido (sprints de 1 semana)

**Sprint 1 — Quick Wins de fluxo + custo IA**
- QW1, QW2, QW3, QW4, QW5, QW6, M1
- Entrega: -40-50% chamadas IA, segurança rate-limit, fluxo unificado

**Sprint 2 — Multi-account de IA (parte 1)**
- AI1, AI2, AI3, AI4, M2 (paralelo)
- Entrega: produção rodando com N contas/provider + cache IA

**Sprint 3 — Multi-account UI + merchant learning**
- AI5, AI6, AI7, M3, M4
- Entrega: admin completo + custo IA reduzido em ~70%

**Sprint 4-5 — Roadmap Fase 1 (Goals/Notif)**
- R1, R2, R3, R4
- Entrega: assistente proativo

**Sprint 6-7 — Roadmap Fase 2 (Inteligência)**
- R5, R6, R7
- Entrega: analytics + export

**Sprint 8+ — Refactors longos**
- L1, L2, L3, L4, L5

---

## 8. Métricas de Sucesso

### 8.1 KPIs técnicos

| Métrica | Baseline (hoje) | Meta Q3 | Meta Q4 |
|---|---|---|---|
| % mensagens resolvidas sem IA (RAG-only) | ~60% | 75% | 85% |
| Custo IA / usuário ativo / mês | ~$3-5 | <$2 | <$1 |
| Latência p95 mensagem → resposta | ~2.5s | <2s | <1.5s |
| Taxa de auto-register (sem confirmação) | ~40% | 55% | 70% |
| Erros IA / total chamadas | ~2% | <1% | <0.5% |
| Free-tier utilization (Groq) | ~30% | 80% | 95% |
| Free-tier utilization (Gemini) | ~20% | 70% | 90% |

### 8.2 KPIs de produto

| Métrica | Meta |
|---|---|
| % usuários usando budget/goals | 40% (3 meses pós-launch) |
| % usuários recebendo notificação semanal | 60% |
| NPS pós-implementação Fase 1 | +15pts |
| Retenção 30 dias | +10% |

### 8.3 Observabilidade

Painéis Grafana obrigatórios:
- **AI Pipeline**: cascata RAG/IA com taxas de hit por fase
- **Multi-credential**: quota usage por credencial, circuit status
- **Cost tracker**: $/dia por provider × credencial
- **Message flow**: throughput, p95/p99, erro por canal

---

## 9. Anexos

### 9.1 Glossário
- **RAG Phase 1**: BM25 direto na query, antes da IA
- **RAG Phase 3**: revalidação semântica do output da IA
- **Account-scoped**: dados isolados por `(userId, accountId)` — não vazam entre contas do mesmo usuário
- **Free-tier maximization**: rotacionar credenciais para usar quotas grátis até esgotar antes de pagar
- **Circuit breaker**: padrão que abre o "circuito" após N falhas consecutivas para evitar cascata de erros

### 9.2 Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Migration `AIProviderCredential` quebra produção | Feature flag + backfill + rollback documentado |
| Cache IA com falsos positivos (similaridade muito frouxa) | Threshold conservador 0.85 + monitoramento + opt-out por usuário |
| Round-robin com latência desigual entre contas | Estratégia `quota_aware` como default |
| Notificações virarem spam | Limite por usuário (max N/dia) + opt-out + janela de horário |
| Free-tier de provider muda sem aviso | Defaults configuráveis + alerta de quota próxima |
| Goals exigem novo schema na api | Coordenar com time api antes de iniciar Sprint 4 |

### 9.3 Decisões em aberto (precisam validação)

1. **Estratégia default de seleção** — proposta: `quota_aware` (maximiza free-tier)
2. **Cache IA TTL** — proposta: 30 dias, threshold cosine 0.85
3. **Limite de credenciais por provider** — proposta: 10 (configurável via env `MAX_CREDENTIALS_PER_PROVIDER`)
4. **Escopo de export** — formato prioritário: CSV (mais simples) ou PDF (mais útil)?
5. **Notificações cross-channel** — usuário com WhatsApp+Telegram recebe em qual?
6. **Onboarding de credenciais** — admin manual ou wizard guiado?

### 9.4 Referências de arquivos do projeto

- AI: [src/infrastructure/ai/](src/infrastructure/ai/) (factory, providers, config, fallback, usage logger)
- RAG: [src/infrastructure/rag/services/rag-search.service.ts](src/infrastructure/rag/services/rag-search.service.ts)
- API client: [src/shared/gasto-certo-api.service.ts](src/shared/gasto-certo-api.service.ts) + [src/shared/api/](src/shared/api/)
- Orquestrador: [src/features/transactions/transactions.service.ts](src/features/transactions/transactions.service.ts)
- Schema: [prisma/schema.prisma](prisma/schema.prisma) (L148-355 = modelos IA/RAG)
- Admin: [src/features/admin/controllers/](src/features/admin/controllers/)
- Handlers: [src/infrastructure/messaging/messages/handlers/](src/infrastructure/messaging/messages/handlers/)

---

**Documento gerado em**: 28 de abril de 2026
**Versão**: 1.0
**Próxima revisão sugerida**: após Sprint 3 (validar métricas de custo IA)
