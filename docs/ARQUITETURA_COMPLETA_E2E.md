# GastoCerto-Zap — Arquitetura Completa & Análise End-to-End

> **Data**: 05/03/2026 | **Atualizado**: 05/03/2026  
> **Versão**: 2.0  
> **Objetivo**: Documentar fluxos ponta-a-ponta de cada provider, mapear toda a arquitetura, identificar falhas estruturais e preparar para expansão.  
> **Changelog v2.0**: Roadmap executado — 14 correções aplicadas (CRIT-01→04, HIGH-01→06, MED-09, C3, C5, D1). Detalhes marcados com ✅ ao longo do documento.

---

## Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Stack Tecnológica](#2-stack-tecnológica)
3. [Mapa de Módulos e Dependências](#3-mapa-de-módulos-e-dependências)
4. [Fluxo E2E: WhatsApp](#4-fluxo-e2e-whatsapp)
5. [Fluxo E2E: Telegram](#5-fluxo-e2e-telegram)
6. [Fluxo E2E: WebChat](#6-fluxo-e2e-webchat)
7. [Pipeline de Processamento de Transações (Compartilhado)](#7-pipeline-de-processamento-de-transações-compartilhado)
8. [Arquitetura de AI Multi-Provider](#8-arquitetura-de-ai-multi-provider)
9. [Sistema RAG (Retrieval-Augmented Generation)](#9-sistema-rag)
10. [Gestão de Sessões](#10-gestão-de-sessões)
11. [Schema do Banco de Dados](#11-schema-do-banco-de-dados)
12. [Grafo de Dependências](#12-grafo-de-dependências)
13. [Análise de Falhas Estruturais](#13-análise-de-falhas-estruturais)
14. [Riscos de Dependências NPM](#14-riscos-de-dependências-npm)
15. [Roadmap de Correções Prioritárias](#15-roadmap-de-correções-prioritárias)
16. [Guia de Expansão](#16-guia-de-expansão)

---

## 1. Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CAMADA DE APRESENTAÇÃO                        │
│                                                                         │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐ │
│   │ WhatsApp │    │ Telegram │    │  WebChat │    │  Admin Dashboard │ │
│   │ (Baileys)│    │ (Bot API)│    │  (HTTP)  │    │  (REST + WS)    │ │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘    └────────┬─────────┘ │
└────────┼───────────────┼───────────────┼───────────────────┼───────────┘
         │               │               │                   │
         ▼               ▼               ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CAMADA DE MENSAGERIA / GATEWAY                    │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │            MessageContextService (Redis-backed)        ✅   │     │
│   │            MessageFilterService (validação/filtro)           │     │
│   │            MessageResponseService (retry + DLQ)        ✅   │     │
│   │            PlatformReplyService (event routing unificado) ✅ │     │
│   │            Bull Queue: whatsapp-messages + telegram-messages ✅│   │
│   └──────────────────────────────────────────────────────────────┘     │
│   ┌──────────────────────┐  ┌──────────────────────────────────┐      │
│   │ WebSocket Gateway    │  │ MultiPlatformSessionService      │      │
│   │ (Socket.IO /ws)      │  │ (canonical: sessions/core/) ✅   │      │
│   └──────────────────────┘  └──────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE FEATURES / NEGÓCIO                    │
│                                                                         │
│   ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐    │
│   │ Onboarding  │  │  TransactionsService │  │  IntentAnalyzerService│  │
│   │ (cadastro   │  │  (orquestrador:      │  │  (NLP regra + 20+   │  │
│   │  multi-step)│  │   1102 linhas)       │  │   intents)          │  │
│   └─────────────┘  └──────────────────┘  └───────────────────────┘    │
│                            │                                            │
│   Serviços especializados: │                                            │
│   ┌────────────────────────┼────────────────────────────────────┐      │
│   │ TransactionRegistration│Service (2108 linhas)               │      │
│   │ TransactionConfirmationService                              │      │
│   │ TransactionListingService                                   │      │
│   │ TransactionPaymentService                                   │      │
│   │ TransactionSummaryService                                   │      │
│   │ AccountManagementService                                    │      │
│   │ CreditCardService                                           │      │
│   │ SecurityService (prompt injection, rate limit, detecção)    │      │
│   │ MessageLearningService                                      │      │
│   └─────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CAMADA DE INFRAESTRUTURA / AI                      │
│                                                                         │
│   ┌──────────────────────┐  ┌──────────────────────────────────┐      │
│   │  AIProviderFactory   │  │  RAG Engine (BM25 keyword)       │      │
│   │  ┌────────────────┐  │  │  ├─ TextProcessingService   ✅   │      │
│   │  │ OpenAI Provider│  │  │  ├─ UserSynonymService      ✅   │      │
│   │  │ Gemini Provider│  │  │  ├─ RAGLearningService           │      │
│   │  │ Groq Provider  │  │  │  └─ CategoryResolutionService   │      │
│   │  │ DeepSeek Prov. │  │  └──────────────────────────────────┘      │
│   │  └────────────────┘  │                                            │
│   │  Circuit Breaker     │  ┌──────────────────────────────────┐      │
│   │  Rate Limiter        │  │  NLP Module (@nlpjs)             │      │
│   │  AI Usage Logger  ✅ │  │  (secundário/legado)             │      │
│   │  (gastoCertoId +     │  └──────────────────────────────────┘      │
│   │   platform tracking) │                                            │
│   └──────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CAMADA DE DADOS / PERSISTÊNCIA                    │
│                                                                         │
│   ┌──────────────────────┐  ┌──────────────────────────────────┐      │
│   │  PostgreSQL (Prisma) │  │  Redis                           │      │
│   │  12 modelos          │  │  - Cache (UserCache, Categories) │      │
│   │  8 enums             │  │  - Bull Queue (whatsapp-messages)│      │
│   │  @Global PrismaModule│  │  - Rate Limiting                 │      │
│   └──────────────────────┘  │  - Session Context               │      │
│                              └──────────────────────────────────┘      │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  GastoCerto API (externa) — fonte de verdade para:          │    │
│   │  • Usuários    • Contas    • Categorias    • Transações     │    │
│   │  • Assinaturas • Faturas   • Cartões de crédito             │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Stack Tecnológica

| Componente | Tecnologia | Versão | Papel |
|---|---|---|---|
| **Runtime** | Node.js | ≥20.0.0 | Ambiente de execução |
| **Framework** | NestJS | 11.x | Backend framework (DI, modules, guards) |
| **ORM** | Prisma | 6.18.x | Schema-first ORM, migrations |
| **DB** | PostgreSQL | 16 (Alpine) | Persistência de sessões, cache, AI logs |
| **Cache/Queue** | Redis | 7 (Alpine) | Cache distribuído, Bull queue, rate limiting |
| **WhatsApp** | @whiskeysockets/baileys | 7.0.0-rc.6 | Conexão WhatsApp Web (não-oficial) |
| **Telegram** | node-telegram-bot-api | 0.66.0 | Telegram Bot API (polling) |
| **AI - OpenAI** | openai SDK | 4.73.x | GPT-4o, Whisper, embeddings |
| **AI - Gemini** | REST API (axios) | - | gemini-2.0-flash (texto + visão) |
| **AI - Groq** | REST API (axios) | - | llama-3.3-70b, whisper-large-v3 |
| **AI - DeepSeek** | REST API (axios) | - | deepseek-chat |
| **WebSocket** | Socket.IO | 4.8.x | Admin dashboard real-time |
| **NLP** | @nlpjs/basic | 5.0.0-alpha.5 | Intent matching (legado) |
| **Segurança** | AES-256-GCM + scrypt | nativo | Criptografia de API keys |
| **Deploy** | Nixpacks / Docker | - | Container build |

---

## 3. Mapa de Módulos e Dependências

```
AppModule
├── PrismaModule (@Global) ─── singleton PrismaClient
├── ConfigModule (@Global) ─── validação env vars
├── EventEmitterModule ─── EventEmitter2
├── ScheduleModule ─── @nestjs/schedule (cron jobs)
├── BullModule ─── Redis-backed queues
│
├── CommonModule (@Global)
│   ├── ServiceAuthGuard ─── HMAC + Bearer auth
│   ├── AdminGuard ─── admin endpoints
│   ├── CryptoService ─── AES-256-GCM
│   ├── UserRateLimiterService ─── Redis-based
│   └── RedisService ─── ioredis wrapper
│
├── SharedModule (@Global)
│   ├── GastoCertoApiService ─── HttpModule (axios)
│   └── CacheModule ─── cache-manager-redis-yet
│
├── MessagingModule
│   ├── MultiPlatformSessionModule → TelegramModule
│   ├── MessageContextService
│   ├── MessageFilterService
│   ├── WhatsAppMessageHandler
│   ├── TelegramMessageHandler
│   ├── MessagesProcessor (Bull Worker)
│   └── MessageResponseService
│
├── WhatsAppModule
│   ├── WhatsAppSessionManager
│   └── WhatsAppIntegrationService
│
├── TelegramModule
│   ├── TelegramSessionsService
│   └── TelegramProvider
│
├── AiModule
│   ├── AIProviderFactory
│   ├── AIConfigService ─── DB settings
│   ├── AINormalizationService
│   ├── AIUsageLoggerService
│   ├── AIUsageTrackerService (DUPLICADO)
│   ├── AICacheService
│   ├── RateLimiterService
│   └── Providers: OpenAI, Gemini, Groq, DeepSeek
│
├── RAGModule
│   ├── BM25SearchEngine
│   ├── RAGLearningService
│   ├── CategoryResolutionService
│   └── SynonymService
│
├── NlpModule ─── IntentMatcherService (legado)
├── IntentModule ─── IntentAnalyzerService (1027 linhas)
│
├─── FEATURES ─────────────
├── UsersModule ─── UserCacheService
├── AccountsModule ─── AccountManagementService
├── SecurityModule ─── SecurityService, SecurityLogService
├── TransactionsModule ─ forwardRef ↔ MessagesModule
│   ├── TransactionsService (orquestrador)
│   ├── TransactionRegistrationService
│   ├── TransactionConfirmationService
│   ├── TransactionListingService
│   ├── TransactionPaymentService
│   ├── TransactionSummaryService
│   ├── ConfirmationExpirationJob (cron)
│   └── Parsers: Installment, Fixed, CreditCard, Temporal
├── OnboardingModule ─ forwardRef ↔ MessagesModule
├── WebChatModule ─── WebChatService, WebChatController
├── SubscriptionsModule
├── CreditCardsModule
├── AdminModule ─── AdminController (3635 linhas!)
└── AdminControllersModule ─── RAG admin endpoints
```

### Dependências Circulares (via forwardRef)

```
   MessagesModule ←──forwardRef──→ TransactionsModule
   MessagesModule ←──forwardRef──→ OnboardingModule
   TransactionRegistrationService → MessageLearningService (forwardRef + @Optional)
```

---

## 4. Fluxo E2E: WhatsApp

### 4.1 Diagrama Completo

```
User envia mensagem no WhatsApp
     │
     ▼
┌─ FASE 1: RECEPÇÃO (Baileys WebSocket) ──────────────────────────────────┐
│                                                                          │
│  WASocket (makeWASocket) recebe evento 'messages.upsert'                │
│  WhatsAppSessionManager captura e emite EventEmitter2:                   │
│     'whatsapp.message' { message, sessionId }                           │
│                                                                          │
│  OU WhatsAppIntegrationService (simple-whatsapp-init) faz o mesmo       │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─ FASE 2: FILTRAGEM E ENFILEIRAMENTO ────────────────────────────────────┐
│                                                                          │
│  WhatsAppMessageHandler (@OnEvent('whatsapp.message'))                   │
│                                                                          │
│  1. MessageFilterService.filterMessage()                                 │
│     ├── Rejeita: mensagens próprias (fromMe)                            │
│     ├── Rejeita: grupos e broadcasts                                     │
│     ├── Rejeita: mensagens de protocolo (status@broadcast)              │
│     ├── Extrai: texto, imagem, áudio via Baileys helpers                │
│     └── Retorna: IFilteredMessage { platformId, text, type, session }   │
│                                                                          │
│  2. UserRateLimiterService.checkLimit(phoneNumber)                       │
│     └── Redis: incrementa contador, verifica limite/minuto e /hora      │
│                                                                          │
│  3. MessageContextService.registerContext({                               │
│        platformId, sessionId, platform: 'whatsapp', userId              │
│     })                                                                   │
│     └── Armazena em Map<string, MessageContext> (in-memory, TTL 1h)     │
│                                                                          │
│  4. Bull Queue: adiciona job 'whatsapp-messages' com payload             │
│     { phoneNumber, text, type, sessionId, platform, metadata }          │
│     └── Configuração: attempts=3, backoff=exponential, timeout=60s      │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼  (assíncrono via Bull Worker)
┌─ FASE 3: PROCESSAMENTO (MessagesProcessor) ─────────────────────────────┐
│                                                                          │
│  @Process('whatsapp-messages')                                           │
│                                                                          │
│  5. MessageValidationService.validateAndRouteMessage()                   │
│     ├── UserCacheService.getUser(phoneNumber)                           │
│     │   └── Fluxo: Redis cache → DB → GastoCertoApi → cria UserCache   │
│     ├── Verifica: isBlocked, isActive, hasActiveSubscription            │
│     ├── Sincroniza categorias → RAG se necessário                       │
│     └── Roteia:                                                          │
│         ├── SEM usuário → OnboardingService.startOnboarding()           │
│         └── COM usuário → TransactionsService.processTextMessage()      │
│                                                                          │
│  6. [Ver Seção 7: Pipeline de Transações]                               │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼  (EventEmitter2: 'whatsapp.reply')
┌─ FASE 4: RESPOSTA ──────────────────────────────────────────────────────┐
│                                                                          │
│  MessageResponseService (@OnEvent('whatsapp.reply'))                     │
│                                                                          │
│  7. Resolve sessionId:                                                   │
│     ├── Do payload do evento OU                                         │
│     └── MessageContextService.getContext(platformId)                     │
│                                                                          │
│  8. WhatsAppSessionManager.sendTextMessage(sessionId, jid, message)     │
│     └── sock.sendMessage(jid, { text: message })                        │
│                                                                          │
│  9. Emite WebSocket 'message:sent' para admin dashboard                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Particularidades WhatsApp

| Aspecto | Detalhe |
|---|---|
| **Conexão** | WebSocket persistente via Baileys (não-oficial) |
| **Auth** | Credenciais salvas em `.auth_sessions/{sessionId}/` + JSON backup no DB |
| **QR Code** | Emitido via WebSocket (`qr` event) para admin dashboard |
| **Reconexão** | Automática com backoff; `stoppingSessions` Set previne reconexão em parada intencional |
| **Tipos suportados** | Texto, Imagem (base64), Áudio (ogg) |
| **Queue** | Bull queue `whatsapp-messages` — 3 retries, backoff exponencial |
| **Rate limit** | Redis-based, configurable via AISettings |
| **Multi-sessão** | Suporta múltiplas sessões WhatsApp simultâneas |

### 4.3 Problemas Específicos do WhatsApp

- **Baileys é RC (release candidate)** — API instável, WhatsApp pode bloquear a qualquer momento
- **Auth file-based** — não escala horizontalmente, preso à máquina/container
- **`forceRestartActiveSessions` com setTimeout 5s** — timing frágil em cold start
- **`simple-whatsapp-init.ts` usa variáveis globais mutáveis** — fora do padrão NestJS DI

---

## 5. Fluxo E2E: Telegram

### 5.1 Diagrama Completo

```
User envia mensagem no Telegram
     │
     ▼
┌─ FASE 1: RECEPÇÃO (Polling) ────────────────────────────────────────────┐
│                                                                          │
│  TelegramProvider (node-telegram-bot-api)                                │
│  bot.on('message', callback)                                             │
│                                                                          │
│  1. Normaliza mensagem → IncomingMessage {                               │
│       chatId, text, from, type, platform: 'telegram'                    │
│     }                                                                    │
│                                                                          │
│  2. Invoca MessagingCallbacks.onMessage()                                │
│     └── Emite EventEmitter2: 'telegram.message'                         │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─ FASE 2: PROCESSAMENTO ─ ⚠️ SÍNCRONO (SEM QUEUE) ─────────────────────┐
│                                                                          │
│  TelegramMessageHandler (@OnEvent('telegram.message'))                   │
│                                                                          │
│  3. Converte IncomingMessage → IFilteredMessage                          │
│                                                                          │
│  4. UserRateLimiterService.checkLimit(chatId)                            │
│                                                                          │
│  5. MessageContextService.registerContext({                               │
│        platformId: chatId, sessionId, platform: 'telegram'              │
│     })                                                                   │
│                                                                          │
│  6. ❌ NÃO USA Bull Queue → PROCESSA DIRETAMENTE                       │
│                                                                          │
│  7. MessageValidationService.validateAndRouteMessage()                   │
│     ├── UserCacheService.getUser() via telegramId                       │
│     ├── Verifica status do usuário                                      │
│     └── Roteia para Onboarding ou Transactions                          │
│                                                                          │
│  8. [Ver Seção 7: Pipeline de Transações]                               │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼  (EventEmitter2: 'telegram.reply')
┌─ FASE 3: RESPOSTA ──────────────────────────────────────────────────────┐
│                                                                          │
│  MessageResponseService (@OnEvent('telegram.reply'))                     │
│                                                                          │
│  9. MultiPlatformSessionService.sendMessage(sessionId, chatId, msg)     │
│     └── TelegramProvider.sendTextMessage(chatId, message)               │
│         └── bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })   │
│                                                                          │
│  10. ❌ SEM retry se envio falhar                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Particularidades Telegram

| Aspecto | Detalhe |
|---|---|
| **Conexão** | Long polling via `node-telegram-bot-api` |
| **Auth** | Bot token armazenado em `TelegramSession.token` |
| **Reconexão** | Circuit breaker: max 3 reconexões em 5min, max 2 por erro |
| **Conflito 409** | Detecta e desativa sessões duplicadas com mesmo token |
| **Queue** | **NÃO TEM** — processamento síncrono no event handler |
| **Tipos suportados** | Texto (imagem/áudio parcial) |
| **Multi-sessão** | Suporta múltiplos bots simultâneos |

### 5.3 Problemas Específicos do Telegram

- **Sem Bull Queue** — se o processamento falhar, mensagem perdida; sem retry
- **Polling mode** — apenas 1 instância pode fazer polling por token (não escala horizontalmente)
- **Sem dead letter queue** — falhas de envio são silenciosas
- **Markdown parsing errors** — `parse_mode: 'Markdown'` pode falhar com caracteres especiais

---

## 6. Fluxo E2E: WebChat

### 6.1 Diagrama Completo

```
Frontend web envia mensagem
     │
     ▼
┌─ FASE 1: RECEPÇÃO (HTTP) ───────────────────────────────────────────────┐
│                                                                          │
│  POST /webchat/message                                                   │
│  Headers:                                                                │
│    Authorization: Bearer <JWT do GastoCerto>                            │
│    x-account: <accountId>                                               │
│  Body: { message: "..." }                                               │
│                                                                          │
│  1. JwtUserGuard valida JWT via chamada à GastoCerto API                │
│     └── Extrai userId, email, name do token                             │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─ FASE 2: PROCESSAMENTO (Síncrono, HTTP Request/Response) ──────────────┐
│                                                                          │
│  WebChatService.processMessage(userId, message, accountId)               │
│                                                                          │
│  2. Rate limiting local: Map<userId, { count, resetAt }>                │
│     └── webchat-${userId}, limite configurável                          │
│                                                                          │
│  3. UserCacheService.getUserByGastoCertoId(userId)                       │
│     └── Se não encontrado → cria UserCache automaticamente              │
│                                                                          │
│  4. Verifica: isBlocked, hasActiveSubscription                           │
│                                                                          │
│  5. Se MessageLearningService tem contexto pendente → processa          │
│                                                                          │
│  6. TransactionsService.processTextMessage(user, text, 'webchat', ...)  │
│     └── accountId do header x-account é passado                         │
│                                                                          │
│  7. [Ver Seção 7: Pipeline de Transações]                               │
│                                                                          │
│  8. Formata resposta JSON estruturada                                    │
│  9. Remove emojis para exibição limpa na web                            │
└──────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─ FASE 3: RESPOSTA (HTTP Response) ──────────────────────────────────────┐
│                                                                          │
│  {                                                                       │
│    success: true,                                                        │
│    messageType: "transaction" | "confirmation" | "info" | "error",      │
│    message: "Transação registrada...",                                   │
│    formatting: { hasTable: false, hasList: true, ... },                 │
│    transaction?: { ... },  // dados da transação se aplicável           │
│    actions?: [{ type: "confirm", label: "Confirmar" }]                  │
│  }                                                                       │
│                                                                          │
│  ⚠️ WebChat TAMBÉM emite 'whatsapp.reply' para rastreabilidade          │
│     (eventNameMap mapeia 'webchat' → 'whatsapp.reply')                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Particularidades WebChat

| Aspecto | Detalhe |
|---|---|
| **Auth** | JWT validado via GastoCerto API (não local) |
| **Resposta** | JSON estruturado (não texto plano) |
| **Rate limiting** | ✅ Via Redis (UserRateLimiterService) |
| **accountId** | Recebido via header `x-account` |
| **Queue** | **NÃO TEM** — request/response síncrono |
| **Onboarding** | **NÃO TEM** — usuário já autenticado no GastoCerto |

### 6.3 Problemas Específicos do WebChat

- **WebChat emite `whatsapp.reply`** — mapeamento incorreto no `eventNameMap`, causa disparo fantasma
- ~~**Rate limiting in-memory** — não persiste entre restarts, não compartilha entre instâncias~~ ✅ Corrigido: WebChat já usa Redis via `UserRateLimiterService`
- **Sem suporte a imagem/áudio** — apenas texto
- **Sem WebSocket real-time** — polling do frontend (sem push notifications)

---

## 7. Pipeline de Processamento de Transações (Compartilhado)

### 7.1 Orquestrador (TransactionsService — 1102 linhas)

```
processTextMessage(user, text, platform, options)
     │
     ├── 1. SecurityService.validateUserMessage(text, userId)
     │      ├── Detecção de prompt injection
     │      ├── Rate limiting por minuto/hora
     │      └── Detecção de conteúdo suspeito
     │
     ├── 2. ListContextService.detectListReference(text)
     │      └── "pagar 5", "ver fatura 2" → extrai referência numérica
     │
     ├── 3. IntentAnalyzerService.analyzeIntent(text)
     │      ├── 1027 linhas de keyword matching em português
     │      └── Retorna: { intent, confidence, entities }
     │
     └── 4. Roteamento por Intent (if-else sequencial):
            │
            ├── GREETING ──────────────→ resposta estática
            ├── HELP ──────────────────→ resposta estática  
            ├── THANK_YOU ─────────────→ resposta estática
            ├── CONFIRMATION_RESPONSE ─→ TransactionConfirmationService
            ├── LIST_ACCOUNTS ─────────→ AccountManagementService
            ├── SWITCH_ACCOUNT ────────→ AccountManagementService
            ├── SHOW_ACTIVE_ACCOUNT ───→ AccountManagementService
            ├── LIST_PENDING ──────────→ TransactionConfirmationService
            ├── LIST_PENDING_PAYMENTS ─→ TransactionPaymentService
            ├── CHECK_BALANCE ─────────→ TransactionSummaryService
            ├── LIST_TRANSACTIONS ─────→ TransactionListingService
            ├── LIST_CREDIT_CARDS ─────→ CreditCardService
            ├── SET_DEFAULT_CARD ──────→ CreditCardService
            ├── SHOW_DEFAULT_CARD ─────→ CreditCardService
            ├── LIST_INVOICES ─────────→ CreditCardService
            ├── SHOW_INVOICE_DETAILS ──→ CreditCardService
            ├── PAY_INVOICE ───────────→ CreditCardService
            └── DEFAULT (REGISTER) ────→ TransactionRegistrationService
```

### 7.2 Registro de Transação (TransactionRegistrationService — 2108 linhas)

```
processTransaction(user, text, platform, options)
     │
     ├── 1. Obter categorias do usuário (por accountId)
     │      └── GastoCertoApiService.getCategories(userId, accountId)
     │
     ├── 2. RAG BM25 pré-busca
     │      └── BM25SearchEngine.search(text, userCategories)
     │          → retorna hints de categoria (se score ≥ threshold)
     │
     ├── 3. AI Provider — Extração de dados da transação
     │      └── AIProviderFactory.getProvider(operation)
     │          │
     │          ├── TEXT → prompt com contexto: categorias, hints RAG
     │          │   └── JSON response: { amount, description, category, date, type }
     │          │
     │          ├── IMAGE → visão computacional
     │          │   └── Analisa recibos, notas fiscais, comprovantes
     │          │
     │          └── AUDIO → transcrição + extração
     │              └── Whisper → transcrição → prompt texto
     │
     ├── 4. AINormalizationService.normalize(extracted)
     │      ├── Normaliza amount (R$ → number)
     │      ├── Normaliza date (relativo → absoluto)
     │      └── Valida campos obrigatórios
     │
     ├── 5. CategoryResolutionService.resolve(text, aiCategory, userCategories)
     │      ├── Tenta RAG BM25 primeiro
     │      ├── Se falha → tenta UserSynonym match
     │      ├── Se falha → AI fallback (provider de categoria)
     │      └── Retorna: { categoryId, categoryName, confidence }
     │
     ├── 6. RAGLearningService.detectUnknown(text, resolved)
     │      └── Se termo não reconhecido → cria UnrecognizedMessage
     │          → pode iniciar fluxo de aprendizado interativo
     │
     ├── 7. Parsers especializados:
     │      ├── InstallmentParser — "3x de 50", "parcela 2/6"
     │      ├── FixedTransactionParser — "fixo mensal", "recorrente"
     │      ├── CreditCardParser — "no crédito", "cartão X"
     │      └── TemporalParser — "ontem", "dia 15", "semana passada"
     │
     ├── 8. Validação final
     │      ├── Valor mínimo/máximo
     │      ├── Campos obrigatórios preenchidos
     │      └── Categoria válida encontrada
     │
     ├── 9. Decisão de confiança:
     │      │
     │      ├── confidence ≥ autoRegisterThreshold (0.90)
     │      │   └── AUTO-REGISTRO via GastoCertoApiService.createTransaction()
     │      │
     │      └── confidence < autoRegisterThreshold
     │          └── CONFIRMAÇÃO: cria TransactionConfirmation (PENDING)
     │              → Envia mensagem de confirmação ao usuário
     │              → TTL de expiração (ConfirmationExpirationJob)
     │
     └── 10. Emite reply event para MessageResponseService
```

### 7.3 Fluxo de Confirmação

```
Usuário recebe: "Registrar R$150 em Alimentação? (SIM/NÃO)"
     │
     ├── "sim" / "s" / "confirmar"
     │      └── TransactionConfirmationService.confirmTransaction()
     │          ├── GastoCertoApiService.createTransaction(data)
     │          ├── TransactionConfirmation.status = CONFIRMED
     │          └── Emit reply: "✅ Transação registrada!"
     │
     ├── "não" / "n" / "cancelar"
     │      └── TransactionConfirmationService.rejectTransaction()
     │          ├── TransactionConfirmation.status = REJECTED
     │          └── Emit reply: "❌ Transação cancelada."
     │
     └── Expiração (cron job a cada minuto)
            └── ConfirmationExpirationJob
                ├── Busca PENDING onde expiresAt < now()
                ├── Notifica via WhatsApp/Telegram: "⏰ Sua confirmação expirou"
                └── TransactionConfirmation.status = EXPIRED
```

---

## 8. Arquitetura de AI Multi-Provider

### 8.1 Factory Pattern

```
AIProviderFactory
     │
     ├── getProvider(operation: AIOperationType): IAIProvider
     │   │
     │   ├── 1. Consulta AISettings no DB para saber qual provider usar
     │   │      textProvider, imageProvider, audioProvider, categoryProvider
     │   │
     │   ├── 2. Tenta provider primário
     │   │      └── Verifica circuit breaker status
     │   │
     │   ├── 3. Se falha → percorre fallback chain
     │   │      fallbackTextChain: ["groq", "deepseek", "google_gemini", "openai"]
     │   │
     │   └── 4. Retorna instância do provider disponível
     │
     ├── Providers disponíveis:
     │   ├── OpenAIProvider    { text ✓, vision ✓, audio ✓, embeddings ✓ }
     │   ├── GoogleGeminiProvider { text ✓, vision ✓, audio ✗ }
     │   ├── GroqProvider      { text ✓, vision ✗, audio ✓ }
     │   └── DeepSeekProvider  { text ✓, vision ✗, audio ✗ }
     │
     └── Circuit Breaker (por provider):
         ├── Estado: CLOSED → OPEN (após 3 falhas) → HALF_OPEN (após 60s)
         ├── Em OPEN: rejeita imediatamente, vai para fallback
         └── Em HALF_OPEN: permite 1 request de teste
```

### 8.2 Pipeline de AI para Extração de Transação

```
Texto: "gastei 150 no mercado ontem"
     │
     ├── 1. AICacheService.get(hash(prompt))
     │      └── Se cache hit → retorna imediatamente
     │
     ├── 2. RateLimiterService.checkLimit(provider)
     │      └── Verifica RPM/TPM limits do AIProviderConfig
     │
     ├── 3. Provider.extractTransaction(text, categories, ragHints)
     │      │
     │      ├── Monta prompt com:
     │      │   ├── System prompt (src/infrastructure/ai/prompts/)
     │      │   ├── Lista de categorias do usuário
     │      │   ├── Hints do RAG (se disponíveis)
     │      │   └── Regras de extração (JSON schema)
     │      │
     │      └── Retorna JSON:
     │          {
     │            amount: 150,
     │            description: "mercado",
     │            category: "Alimentação",
     │            date: "2026-03-04",
     │            type: "EXPENSES",
     │            confidence: 0.95
     │          }
     │
     ├── 4. AIUsageLoggerService.log({
     │        provider, model, tokens, cost, responseTime
     │      })
     │
     └── 5. AICacheService.set(hash(prompt), result)
```

### 8.3 Gestão de API Keys

```
AIProviderConfig (DB)
     │
     ├── apiKey: encrypted string (AES-256-GCM)
     │   └── CryptoService.encrypt(plainKey) → iv:authTag:ciphertext
     │
     ├── Derivação da chave:
     │   └── scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, 32)
     │       ✅ Salt configurável via env var (default: 'gastocerto-salt-default')
     │
     └── Fallback: se key não no DB → usa env var (dev only)
```

### 8.4 Problema Crítico: PrismaService nos Providers

```
// ANTI-PATTERN encontrado em TODOS os 4 providers:
async getApiKey(): Promise<string> {
    const { PrismaService } = await import('@core/database/prisma.service');
    const prisma = new PrismaService();  // ⚠️ CRIA NOVA INSTÂNCIA
    // ... query
}

Problemas:
1. Bytepassa o singleton @Global PrismaModule
2. Cria nova conexão PostgreSQL a cada chamada
3. Sem lifecycle hooks (onModuleInit/onModuleDestroy)
4. Connection pool não gerenciado → pode exhaust connections
5. Não utiliza transaction isolation do Prisma global
```

---

## 9. Sistema RAG

### 9.1 Arquitetura de Serviços RAG (v2.0)

```
┌───────────────────────────────────────────────────────────┐
│                      RAG Module                           │
│                                                           │
│  ┌─────────────────────┐  ┌────────────────────────────┐  │
│  │ TextProcessingService│  │ UserSynonymService        │  │
│  │ (218 linhas)         │  │ (347 linhas)              │  │
│  │ • normalize()        │  │ • getUserSynonyms()       │  │
│  │ • tokenize() pt-BR   │  │ • addUserSynonym()        │  │
│  │ • extractMainTerm()  │  │ • listUserSynonyms()      │  │
│  │ • filterTokens()     │  │ • removeUserSynonym()     │  │
│  │   (pure functions)   │  │ • hasUserSynonym()        │  │
│  └──────────┬──────────┘  │ • confirmAndLearn()       │  │
│             │             │ • rejectAndCorrect()      │  │
│             │             └──────────┬─────────────────┘  │
│             ▼                        ▼                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │            RAGService (1205 linhas)                 │  │
│  │  • findSimilarCategories() — BM25 + sinônimos      │  │
│  │  • findSimilarCategoriesWithEmbeddings()            │  │
│  │  • detectUnknownTerm()                              │  │
│  │  • indexUserCategories() / getCachedCategories()    │  │
│  │  • logSearchWithContext() / recordSearchAttempt()   │  │
│  │  • getSearchAttempts() / deleteSearchLogs()         │  │
│  │  (delega normalize/tokenize → TextProcessingService)│  │
│  │  (delega synonym CRUD → UserSynonymService)         │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                 │
│  ┌──────────────────────┴──────────────────────────────┐  │
│  │      CategoryResolutionService (397 linhas)         │  │
│  │      • RAG → AI fallback orchestration              │  │
│  │      RAGLearningService (704 linhas)                │  │
│  │      • detectAndPrepareConfirmation()               │  │
│  │      • processResponse()                            │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 9.2 Fluxo BM25

```
Texto: "gastei no uber"
     │
     ├── 1. RAGService.findSimilarCategories(text, userId)
     │      ├── TextProcessingService.normalize() + tokenize()
     │      ├── UserSynonymService.getUserSynonyms() (user + global)
     │      ├── precomputeDocFrequencies() (cached 5min por userId)
     │      ├── calculateBM25Score() + checkSynonyms()
     │      └── Retorna: [{ category, score }] normalizado 0-1
     │
     ├── 2. Se score ≥ ragThreshold (0.6):
     │      └── Categoria encontrada via RAG
     │
     ├── 3. Se score < ragThreshold:
     │      └── Fallback para AI (CategoryResolutionService)
     │          ├── Usa categoryProvider (default: groq)
     │          └── Prompt: "Qual categoria melhor se encaixa para 'uber'?"
     │
     └── 4. Aprendizado:
            └── RAGLearningService.detectAndPrepareConfirmation()
                ├── Se novo termo → UserSynonymService.addUserSynonym()
                └── Se termo existente → incrementa usageCount
```

### 9.3 Fluxo de Aprendizado Interativo

```
Texto: "gastei no tio zé"  (termo desconhecido)
     │
     ├── RAG retorna score baixo
     ├── AI sugere "Alimentação" com confidence 0.7
     │
     ├── Se confidence < minConfidenceThreshold:
     │      └── Pergunta ao usuário: "O que é 'tio zé'?"
     │          └── Usuário: "restaurante perto de casa"
     │              └── MessageLearningService registra:
     │                  UserSynonym { keyword: "tio zé", category: "Alimentação" }
     │
     └── Se confidence ≥ minConfidence AND < autoRegister:
            └── Confirma com usuário antes de registrar
```

---

## 10. Gestão de Sessões

### 10.1 Ciclo de Vida — WhatsApp

```
           ┌─────────────┐
           │  INACTIVE    │ ← DB default
           └──────┬──────┘
                  │ createSession()
                  ▼
           ┌─────────────┐
           │ CONNECTING   │ ← Iniciando Baileys
           └──────┬──────┘
                  │ makeWASocket()
                  ▼
           ┌─────────────┐     QR expirado
           │ QR_PENDING   │ ────────────────→ retry (3x)
           └──────┬──────┘
                  │ QR escaneado
                  ▼
           ┌─────────────┐     'connection.update' close
           │  CONNECTED   │ ────────────────→ ┌─────────────┐
           └──────┬──────┘                    │DISCONNECTED │
                  │                           └──────┬──────┘
                  │ stopSession()                     │ auto-reconnect
                  ▼                                   │ (se não em stoppingSessions)
           ┌─────────────┐                           │
           │  INACTIVE    │ ←─────────────────────────┘
           └─────────────┘

Armazenamento:
  DB: WhatsAppSession { sessionId, status, creds (JSON), isActive }
  Memória: Map<sessionId, WASocket>
  Disco: .auth_sessions/{sessionId}/  (creds files)
```

### 10.2 Ciclo de Vida — Telegram

```
           ┌─────────────┐
           │  INACTIVE    │ ← DB default
           └──────┬──────┘
                  │ startSession()
                  ▼
           ┌─────────────┐
           │ CONNECTING   │ ← new TelegramBot()
           └──────┬──────┘
                  │ bot.getMe() sucesso
                  ▼
           ┌─────────────┐     Erro/timeout
           │  CONNECTED   │ ────────────────→ circuit breaker
           └──────┬──────┘                    (max 3 reconexões/5min)
                  │
                  │ stopSession()
                  ▼
           ┌─────────────┐
           │  INACTIVE    │
           └─────────────┘

Armazenamento:
  DB: TelegramSession { sessionId, token, status, isActive }
  Memória: Map<sessionId, TelegramProvider>
  Global: ACTIVE_SESSIONS_GLOBAL Map<sessionId, boolean>
```

### 10.3 Auto-Restore no Boot

```
Application Bootstrap (main.ts)
     │
     ├── WhatsAppSessionManager.onModuleInit()
     │   ├── Busca WhatsAppSession WHERE isActive = true
     │   ├── Para cada: tenta restore com creds do DB ou disco
     │   ├── setTimeout(5000) → forceRestartActiveSessions()
     │   └── ⚠️ Se creds corrompido → sessão fica em ERROR
     │
     └── MultiPlatformSessionService.onModuleInit()
         ├── Busca TelegramSession WHERE isActive = true
         ├── Para cada: new TelegramBot(token, { polling: true })
         └── ⚠️ Se token inválido → loop de reconexão até circuit breaker
```

---

## 11. Schema do Banco de Dados

### 11.1 Diagrama ER

```
┌──────────────────┐     ┌──────────────────┐
│  WhatsAppSession │     │  TelegramSession │
├──────────────────┤     ├──────────────────┤
│ id (UUID, PK)    │     │ id (UUID, PK)    │
│ sessionId (UQ)   │     │ sessionId (UQ)   │
│ phoneNumber      │     │ name             │
│ name             │     │ token            │
│ status (Enum)    │     │ status (Enum)    │
│ creds (JSON)     │     │ isActive         │
│ isActive         │     │ lastSeen         │
│ lastSeen         │     │ createdAt        │
│ lastConnected    │     │ updatedAt        │
│ createdAt        │     └──────────────────┘
│ updatedAt        │
└──────────────────┘

┌──────────────────────┐
│   OnboardingSession  │     (standalone, sem FK para UserCache)
├──────────────────────┤
│ id (UUID, PK)        │
│ platformId (UQ)      │
│ phoneNumber          │
│ currentStep (Enum)   │
│ data (JSON)          │
│ attempts             │
│ expiresAt            │
│ completed            │
└──────────────────────┘

                            1:N                    1:N                     1:N
┌───────────────────┐ ──────────→ ┌──────────────────────────┐     ┌──────────────────┐
│    UserCache      │             │ TransactionConfirmation   │     │  UserSynonym     │
├───────────────────┤             ├──────────────────────────┤     ├──────────────────┤
│ id (UUID, PK)     │             │ id (UUID, PK)            │     │ id (UUID, PK)    │
│ phoneNumber (UQ)  │             │ phoneNumber              │     │ userId (FK→gc_id)│
│ gastoCertoId (UQ) │             │ platform                 │     │ keyword (UQ+user)│
│ whatsappId        │ ←FK─userId  │ userId (FK)              │     │ categoryId       │
│ telegramId        │             │ accountId                │     │ categoryName     │
│ email             │             │ messageId (UQ)           │     │ source (Enum)    │
│ name              │             │ type (Enum)              │     │ usageCount       │
│ hasSub            │             │ amount                   │     │ confidence       │
│ canUseGastoZap    │             │ category/categoryId      │     │ subCategoryId    │
│ activeAccountId   │             │ description              │     │ subCategoryName  │
│ accounts (JSON)   │             │ date                     │     └──────────────────┘
│ categories (JSON) │             │ extractedData (JSON)     │          │
│ preferences (JSON)│             │ status (Enum)            │          │ FK via gastoCertoId
│ defaultCreditCard │             │ confirmedAt              │          │ (não via id!)
│ lastSyncAt        │             │ apiSent/apiSentAt        │          │
│ isBlocked         │             │ apiError/apiRetryCount   │     ┌────┴────────────────┐
│ isActive          │             │ creditCardId             │     │ UnrecognizedMessage │
└───────────────────┘             │ installments / isFixed   │     ├─────────────────────┤
                                  │ invoiceMonth             │     │ id (UUID, PK)       │
                                  │ expiresAt                │     │ userCacheId (FK)    │
                                  │ deletedAt (soft delete)  │     │ phoneNumber         │
                                  └──────────────────────────┘     │ messageText         │
                                                                   │ detectedIntent      │
                                                                   │ confidence          │
┌──────────────────────┐     1:N     ┌──────────────────┐          │ wasProcessed        │
│    RAGSearchLog      │ ──────────→ │   AIUsageLog     │          └─────────────────────┘
├──────────────────────┤             ├──────────────────┤
│ id (UUID, PK)        │             │ id (UUID, PK)    │
│ userId               │             │ userCacheId      │
│ query/queryNormalized│             │ phoneNumber      │
│ matches (JSON)       │             │ provider/model   │
│ bestMatch/bestScore  │             │ operation (Enum) │
│ threshold            │             │ inputType (Enum) │
│ ragMode              │             │ tokens (in/out)  │
│ wasAiFallback        │             │ estimatedCost    │
│ aiProvider/aiModel   │  ←FK─logId  │ responseTime     │
│ finalCategoryId      │             │ ragSearchLogId   │
│ finalCategoryName    │             │ wasRagFallback   │
│ flowStep/totalSteps  │             │ needsSynonymLearn│
└──────────────────────┘             └──────────────────┘

┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   AIProviderConfig   │     │     AISettings       │     │   SecurityLog    │
├──────────────────────┤     ├──────────────────────┤     ├──────────────────┤
│ id (UUID, PK)        │     │ id (UUID, PK)        │     │ id (UUID, PK)    │
│ provider (UQ)        │     │ textProvider         │     │ userId           │
│ displayName          │     │ imageProvider        │     │ eventType        │
│ enabled              │     │ audioProvider        │     │ details          │
│ apiKey (encrypted)   │     │ categoryProvider     │     │ severity (Enum)  │
│ baseUrl              │     │ fallbackChains[]     │     │ createdAt        │
│ models (text/vis/aud)│     │ ragEnabled/threshold │     └──────────────────┘
│ rpmLimit/tpmLimit    │     │ securitySettings     │
│ costs (in/out/cache) │     │ autoRegisterThreshold│
│ supports (vis/aud)   │     │ assistantSettings    │
│ priority/fallback    │     └──────────────────────┘
│ totalRequests/errors │
└──────────────────────┘
```

### 11.2 Observações Importantes do Schema

| Item | Detalhe | Impacto |
|---|---|---|
| **Transações reais NÃO estão no DB local** | Apenas `TransactionConfirmation` (pendentes). Transações confirmadas vivem na GastoCerto API | Se a API cair, não há histórico local |
| **UserSynonym FK usa `gastoCertoId`** | Não usa `id` do UserCache como FK | Inconsistente com o padrão das outras relações |
| **Soft delete em TransactionConfirmation** | `deletedAt` presente mas sem `@@ignore` no Prisma | Queries precisam filtrar `deletedAt IS NULL` manualmente |
| **JSON columns extensivo** | `accounts`, `categories`, `preferences`, `extractedData`, `matches` | Sem validação de schema; difícil de indexar/consultar |
| **Sem índice composto otimizado** | `TransactionConfirmation` não tem índice `(phoneNumber, status, expiresAt)` | A ConfirmationExpirationJob faz scan pesado |
| **OnboardingSession sem FK** | Não referencia UserCache → dados podem ficar órfãos | |

---

## 12. Grafo de Dependências

### 12.1 Dependências entre Módulos

```
                ┌──────────────┐
                │  AppModule   │
                └──────┬───────┘
                       │
    ┌──────────────────┼──────────────────────────────────────┐
    │                  │                                      │
    ▼                  ▼                                      ▼
┌─────────┐    ┌──────────────┐                     ┌───────────────┐
│ Common  │    │   Shared     │                     │Infrastructure │
│ @Global │    │   @Global    │                     │  (NÃO USADO!) │
│         │    │              │                     └───────────────┘
│ Guards  │    │ GastoCertoApi│
│ Crypto  │    │ Cache        │
│ RateLimit│   │ HttpModule   │
│ Redis   │    └──────────────┘
└─────────┘           │
                      │ usado por TODOS
                      ▼
    ┌─────────────────────────────────────────┐
    │         Camada de Features              │
    │                                         │
    │  Transactions ←→ Messages (forwardRef)  │
    │  Onboarding ←→ Messages (forwardRef)    │
    │  WebChat → Transactions + Users         │
    │  Admin → TUDO (monólito)                │
    └─────────────┬───────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────┐
    │      Camada de Infraestrutura           │
    │                                         │
    │  AI Module (providers, cache, limiter)  │
    │  RAG Module (BM25, learning, synonyms)  │
    │  Messaging (handlers, processors, WS)   │
    │  WhatsApp (Baileys, session manager)    │
    │  Telegram (bot API, sessions)           │
    │  Sessions (CRUD, external controller)   │
    └─────────────────────────────────────────┘
```

### 12.2 Dependências Circulares Detectadas

| Ciclo | Gerenciamento |
|---|---|
| `MessagesModule` ↔ `TransactionsModule` | `forwardRef()` em ambos |
| `MessagesModule` ↔ `OnboardingModule` | `forwardRef()` em ambos |
| `TransactionRegistrationService` ↔ `MessageLearningService` | `forwardRef()` + `@Optional()` |

**Risco**: `forwardRef` mascara acoplamento circular. Se algum módulo for extraído para microsserviço, essas dependências terão que ser resolvidas.

---

## 13. Análise de Falhas Estruturais

### 13.1 Falhas CRÍTICAS

#### CRIT-01: ~~AI Providers criam instâncias avulsas de PrismaService~~ ✅ CORRIGIDO

**Localização**: Todos os 4 arquivos em `src/infrastructure/ai/providers/`

**Status**: Corrigido. AI providers agora recebem `PrismaService` via DI do NestJS. `new PrismaService()` eliminado de todos os 4 providers.

---

#### CRIT-02: ~~Arquivos duplicados no codebase~~ ✅ CORRIGIDO

| Arquivo Original | Duplicata | Status |
|---|---|---|
| `messages/services/message-response.service.ts` | `messages/message-response.service.ts` | ✅ Duplicata removida |
| `messages/processors/messages.processor.ts` | `messages/messages.processor.ts` | ✅ Duplicata removida |
| `features/intent/intent-analyzer.service.ts` | `features/assistant/intent/intent-analyzer.service.ts` | ✅ Duplicata removida |
| `AIUsageLoggerService` | `AIUsageTrackerService` | ✅ Merged em `AIUsageLoggerService` |

**Status**: Corrigido. Todos os duplicados eliminados ou consolidados.

---

#### CRIT-03: ~~MessageContextService usa Map in-memory~~ ✅ CORRIGIDO

**Localização**: `src/infrastructure/messaging/messages/message-context.service.ts`

**Status**: Corrigido. MessageContextService agora usa Redis (via `CACHE_MANAGER`) com TTL nativo. Contexto persiste entre restarts e é compartilhado entre instâncias.

---

#### CRIT-04: ~~Salt criptográfico hardcoded~~ ✅ CORRIGIDO

**Localização**: `src/common/services/crypto.service.ts`
```typescript
// ANTES (hardcoded):
this.key = scryptSync(secret, 'gastocerto-salt', 32);

// DEPOIS (configurável via env):
const salt = this.configService.get<string>('ENCRYPTION_SALT', 'gastocerto-salt-default');
this.key = scryptSync(secret, salt, 32);
// + warning log se usar salt padrão
```

**Status**: Corrigido. Salt agora lido de `ENCRYPTION_SALT` env var com fallback seguro e warning em log.

---

### 13.2 Falhas ALTAS

#### HIGH-01: ~~Telegram sem fila de mensagens (Bull Queue)~~ ✅ CORRIGIDO

**Status**: Corrigido. Bull queue `telegram-messages` adicionada com `TelegramMessagesProcessor`. Handler `handleMessage()` agora apenas enfileira; processamento via `processMessage()` no processor com retries automáticos.

---

#### HIGH-02: ~~Telegram sem retry de envio de resposta~~ ✅ CORRIGIDO

**Status**: Corrigido. `TelegramProvider.sendTextMessage()` agora retry em 429, 5xx, ECONNRESET, ECONNREFUSED, ENOTFOUND (respeita Retry-After). `MessageResponseService.sendReply()` faz 1 retry automático após 5s para mensagens críticas (CONFIRMATION_REQUEST, TRANSACTION_RESULT) com guard `isRetry` anti-recursão.

---

#### HIGH-03: ~~AdminController — God Object (3635 linhas)~~ ✅ CORRIGIDO

**Status**: Corrigido. AdminController reduzido de 3.634 → 157 linhas (cache + health). 6 controllers extraídos:

| Controller | Linhas | Endpoints |
|---|---|---|
| `admin-users.controller.ts` | 1031 | 10 (users-cache, block/activate, sync) |
| `admin-ai-config.controller.ts` | 453 | 8 (ai-usage, providers, settings) |
| `admin-rag.controller.ts` | 771 | 7 (search-logs, stats, revalidate) |
| `admin-synonyms.controller.ts` | 878 | 9 (synonyms CRUD, batch, learning) |
| `admin-onboarding.controller.ts` | 196 | 3 (manual-onboarding, sessions) |
| `admin-messages.controller.ts` | 246 | 4 (unrecognized, confirmations) |

---

#### HIGH-04: ~~WebChat emite evento `whatsapp.reply`~~ ✅ CORRIGIDO

**Status**: Corrigido. Novo `PlatformReplyService` centraliza emissão de eventos com guard para WebChat (não emite eventos para HTTP responses). Todos os 5 callers migrados: TransactionsService, TransactionConfirmationService, ConfirmationExpirationJob, MessageValidationService, OnboardingService. Bug corrigido: `reactivateUser()` emitia 'session.reply' em vez de 'whatsapp.reply'.

---

#### HIGH-05: ~~ACTIVE_SESSIONS_GLOBAL duplicado em 2 arquivos~~ ✅ CORRIGIDO

**Status**: Corrigido. Arquivo duplicado `messaging/core/services/multi-platform-session.service.ts` removido. Localização canônica: `sessions/core/multi-platform-session.service.ts`. Module `MultiPlatformSessionModule` é `@Global()`, importado uma vez.

---

#### HIGH-06: ~~PrismaService em `providers[]` de módulos não-globais~~ ✅ CORRIGIDO

**Status**: Corrigido. `PrismaService` removido de `providers[]` de 9+ módulos. Todos confiam no singleton via `@Global PrismaModule`.

---

### 13.3 Falhas MÉDIAS

| ID | Issue | Localização | Impacto |
|---|---|---|---|
| MED-01 | ~~`forceRestartActiveSessions` usa `setTimeout(5000)` hardcoded~~ ✅ Parameterizado via `WHATSAPP_RESTART_DELAY_MS` env var (default 5000ms) | WhatsApp SessionManager | Corrigido |
| MED-02 | ~~`simple-whatsapp-init.ts` usa variáveis globais mutáveis~~ ✅ Encapsulado em `WhatsAppSocketState` class com singleton `whatsAppState` exportável | WhatsApp module | Corrigido |
| MED-03 | ~~IntentAnalyzerService é 100% rule-based com 1027 linhas de keywords~~ ✅ Keywords extraídos para `intent-keywords.ts` (~426 linhas dados). Service reduzido de 1027→707 linhas (-31%), contendo apenas lógica de matching. Preparação estrutural para Phase 3 #20 (DB-driven intents) | Features/intent | Corrigido |
| MED-04 | ~~TransactionsService.processTextMessage() usa if-else sequencial para 20+ intents~~ ✅ Resolvido pelo strategy pattern (#10) — `intentHandlerMap = new Map<string, IntentHandler>()` com 7 handlers | Features/transactions | Corrigido |
| MED-05 | ~~WebChat rate limiting usa `Map` in-memory~~  ✅ Confirmado: WebChat já usa `UserRateLimiterService` (Redis). Telegram double-counting corrigido | Features/webchat | Resolvido |
| MED-06 | ~~OnboardingSession sem FK para UserCache~~ ✅ Adicionado `userCacheId` FK com auto-lookup em `completeOnboarding()` | Schema Prisma | Corrigido |
| MED-07 | ~~`InfrastructureModule` declarado mas não importado pelo `AppModule`~~ ✅ Removido (dead code) | Infrastructure | Corrigido |
| MED-08 | ~~Telegram usa `parse_mode: 'Markdown'` (legacy)~~ ✅ Migrado para MarkdownV2 com `escapeMarkdownV2()` | Telegram provider | Corrigido |
| MED-09 | ~~Falta índice composto `(phoneNumber, status, expiresAt)` em `TransactionConfirmation`~~ ✅ | Schema Prisma | Corrigido — `@@index([phoneNumber, status, expiresAt])` adicionado |
| MED-10 | ~~TransactionConfirmation soft delete sem middleware Prisma~~ ✅ `deletedAt: null` adicionado a 22 queries, 2 hard-delete convertidos a soft-delete | Schema | Corrigido |

### 13.4 Falhas BAIXAS

| ID | Issue |
|---|---|
| LOW-01 | ~~Arquivo `.ts.bak` commitado: `transactions.service.ts.bak`~~ ✅ Removido |
| LOW-02 | ~~`@types/compression` e `@types/node-telegram-bot-api` em `dependencies`~~ ✅ Movidos para `devDependencies` |
| LOW-03 | ~~`@nlpjs/basic` e `@nlpjs/lang-pt` são alpha (`5.0.0-alpha.5`) em produção~~ ⚠️ Risco aceito — único consumer é `IntentMatcherService` (fallback NLP). Sem versão estável disponível. Monitorar releases |
| LOW-04 | ~~`model.nlp` pre-treinado commitado na raiz do repo~~ ✅ Adicionado ao `.gitignore` |
| LOW-05 | ~~Comentários misturados português/inglês sem padrão~~ ⚠️ Diretriz: código novo deve usar português para comentários de domínio, inglês para termos técnicos. Não vale bulk refactor |
| LOW-06 | ~~Emojis excessivos em logs (dificulta análise automatizada)~~ ⚠️ Diretriz: novos logs sem emojis. Existentes mantidos para não causar churn desnecessário |
| LOW-07 | ~~Diretórios vazios: `src/common/filters/`, `src/infrastructure/media/`~~ ✅ Removidos |
| LOW-08 | ~~21 entity files em `src/models/` mantidas manualmente (sem code-gen)~~ ✅ 9 unused removidos (account-invite, activity-log, budget-template, budget, goal, invoice-adjustment, invoice-advance-payment, notifications, seed-log). 12 restantes são usados |
| LOW-09 | ~~Enum `MessageType` duplicado em dois arquivos de interface~~ ✅ Unificado — canônico em `messaging-provider.interface.ts` (9 valores), re-exportado em `message.interface.ts` |
| LOW-10 | ~~Pacotes possivelmente não usados~~ ✅ Removidos: `natural`, `pino`, `pino-pretty`, `uuid`, `@types/uuid`. `@hapi/boom` mantido (usado em WebChat) |

---

## 14. Riscos de Dependências NPM

### 14.1 Risco ALTO

| Pacote | Versão | Risco | Detalhes |
|---|---|---|---|
| `@whiskeysockets/baileys` | `^7.0.0-rc.6` | **ALTO** | Release candidate — API pode mudar. WhatsApp não-oficial → Meta pode bloquear. Sem SLA |
| `@nlpjs/basic` | `5.0.0-alpha.5` | **MÉDIO** | Alpha em produção. Mas largamente substituído pelo IntentAnalyzerService rule-based |
| `@nlpjs/lang-pt` | `5.0.0-alpha.5` | **MÉDIO** | Mesma situação |

### 14.2 Risco MÉDIO

| Pacote | Versão | Risco | Detalhes |
|---|---|---|---|
| `bull` | `^4.16.5` | **MÉDIO** | Estável, mas o mantenedor recomenda migração para **BullMQ** (melhor TypeScript, Redis Streams) |
| `openai` | `^4.73.1` | **BAIXO** | SDK oficial, bem mantido |

### 14.3 Pacotes Removidos na Auditoria (C5)

| Pacote | Motivo da remoção |
|---|---|
| `natural` | RAG usa BM25 customizado; `natural` não era importado |
| `pino` / `pino-pretty` | NestJS usa seu próprio Logger |
| `uuid` | Prisma CUID2 usado para IDs; `uuid` não era importado |
| `@types/uuid` | Removido junto com `uuid` |

> `qrcode-terminal` mantido (usado em dev para WhatsApp QR). `@hapi/boom` mantido (usado em WebChat).

**Recomendação**: Executar `npx depcheck` periodicamente para auditoria automatizada.

---

## 15. Roadmap de Correções Prioritárias

### Fase 1: Estabilização — ✅ COMPLETA

| # | Prioridade | Tarefa | Status |
|---|---|---|---|
| 1 | CRÍTICA | Corrigir AI providers — injetar PrismaService via DI | ✅ CRIT-01 |
| 2 | CRÍTICA | Eliminar arquivos duplicados (message-response, processor, intent-analyzer) | ✅ CRIT-02 |
| 3 | CRÍTICA | Migrar MessageContextService para Redis | ✅ CRIT-03 |
| 4 | ALTA | Adicionar Bull Queue para Telegram | ✅ HIGH-01 (B1) |
| 5 | ALTA | Corrigir WebChat event emission (PlatformReplyService) | ✅ HIGH-04 (A3) |
| 6 | ALTA | Remover PrismaService de `providers[]` de módulos não-globais | ✅ HIGH-06 |
| 7 | MÉDIA | Corrigir salt criptográfico (mover para env var) | ✅ CRIT-04 |
| 8 | MÉDIA | Limpar ACTIVE_SESSIONS_GLOBAL duplicado | ✅ HIGH-05 (C1) |

### Fase 2: Refatoração Estrutural — ✅ COMPLETA

| # | Prioridade | Tarefa | Status |
|---|---|---|---|
| 9 | ALTA | Dividir AdminController em controllers especializados | ✅ HIGH-03 (C3) |
| 10 | ALTA | Refatorar TransactionsService — strategy pattern para intents | ✅ Intent Handlers (7 handlers, Map dispatch) |
| 11 | MÉDIA | Unificar AIUsageLogger + AIUsageTracker em um serviço | ✅ (sessão anterior) |
| 12 | MÉDIA | Adicionar retry + DLQ para Telegram replies | ✅ HIGH-02 (B2) |
| 13 | MÉDIA | Migrar Telegram Markdown → MarkdownV2 | ✅ escapeMarkdownV2 chokepoint |
| 14 | MÉDIA | Adicionar índices compostos otimizados no schema | ✅ MED-09 (C4) |
| 15 | BAIXA | Remover InfrastructureModule ou importar no AppModule | ✅ Removido (dead code) |
| 16 | BAIXA | Audit + remover pacotes não usados | ✅ (C5) |

### Fase 2.5: Extração RAG (D1) — ✅ COMPLETA

| # | Tarefa | Status |
|---|---|---|
| D1a | Extrair TextProcessingService (normalize, tokenize, extractMainTerm) | ✅ 218 linhas |
| D1b | Extrair UserSynonymService (CRUD sinônimos + aprendizado) | ✅ 347 linhas |
| D1c | RAGService reduzido de 1619 → 1205 linhas (-26%) com delegações | ✅ |
| D1d | RAG Module atualizado com novos providers + exports | ✅ |

### Fase 3: Preparação para Escalabilidade (4-8 semanas)

| # | Prioridade | Tarefa | Esforço | Status |
|---|---|---|---|---|
| 17 | ALTA | Arquitetura multi-instância para WhatsApp (sticky sessions ou worker dedicado) | 20h | ⏳ |
| 18 | ALTA | Telegram: webhook mode em vez de polling | 8h | ✅ Dual mode (polling/webhook) via `TELEGRAM_MODE` env var, `TelegramWebhookController`, `processUpdate()` |
| 19 | ALTA | Rate limiting unificado (tudo via Redis, inclusive WebChat) | 4h | ✅ Telegram double-counting corrigido, dead code removido, `KEYS`→`SCAN`, env vars configuráveis |
| 20 | MÉDIA | IntentAnalyzerService → DB-driven ou ML-based | 16h | ⏳ |
| 21 | MÉDIA | Abstração genérica de messaging (eliminar hardcoded event names) | 8h | ✅ `messaging-events.constants.ts` (REPLY_EVENTS, MESSAGE_EVENTS, SESSION_EVENTS, CHAT_EVENTS). Handlers refatorados para `PlatformReplyService`. 0 strings hardcoded em fonte |
| 22 | BAIXA | Code generation para models (OpenAPI → TypeScript) | 8h | ⏳ |

---

## 16. Guia de Expansão

### 16.1 Adicionar Novo Provider de Mensageria (ex: Discord, Instagram)

**Prontidão atual: MODERADA** — Há interface `IMessagingProvider` e enum `MessagingPlatform` (com stub `DISCORD`), mas há pontos hardcoded.

**Passos necessários**:

1. **Criar módulo do provider**:
   ```
   src/infrastructure/discord/
   ├── discord.module.ts
   ├── providers/
   │   └── discord.provider.ts  (implementa IMessagingProvider)
   └── controllers/
       └── discord-sessions.controller.ts
   ```

2. **Criar handler de mensagens**:
   ```
   src/infrastructure/messaging/messages/handlers/
   └── discord-message.handler.ts  (@OnEvent('discord.message'))
   ```

3. **Atualizar PlatformReplyService** (✅ já centralizado — basta adicionar plataforma):
   - `PlatformReplyService.sendReply()` → adicionar normalization para `discord`
   - `MessageResponseService` → adicionar `@OnEvent('discord.reply')` handler

4. **Criar Bull Queue** (se assíncrono): `discord-messages` + Processor (seguir padrão de `telegram-messages.processor.ts`)

5. **Adicionar model no Prisma**: `DiscordSession`

6. **Registrar no AppModule**

**Recomendação para tornar plug-and-play**: Criar uma camada de routing genérica:
```typescript
// Em vez de:
@OnEvent('whatsapp.reply')
@OnEvent('telegram.reply')
// Usar:
@OnEvent('messaging.reply')
// Com routing automático baseado em platform field
```

### 16.2 Adicionar Novo AI Provider

**Prontidão atual: ALTA** — Interface `IAIProvider` bem definida.

**Passos**:
1. Criar `src/infrastructure/ai/providers/novo-provider.ts` implementando `IAIProvider`
2. Registrar no `AIProviderFactory`
3. Adicionar seed no `AIProviderConfig` (DB)
4. Atualizar fallback chains no `AISettings`

**Prerequisito**: Corrigir o anti-pattern de `new PrismaService()` primeiro (CRIT-01).

### 16.3 Escalar Horizontalmente

**Prontidão atual: MODERADA** — Bloqueadores parcialmente resolvidos:

| Componente | Status | Solução |
|---|---|---|
| MessageContextService | ✅ Redis | Migrado — compartilha entre instâncias |
| ACTIVE_SESSIONS_GLOBAL | ✅ Dedup | Canonical em sessions/core/ — falta migrar para Redis |
| WhatsApp Sessions | ❌ File-based auth (`makeWASocket`) | Worker dedicado ou sticky sessions |
| Telegram Polling | ✅ Dual mode (polling/webhook) via `TELEGRAM_MODE` | `TelegramWebhookController` |
| WebChat Rate Limit | ❌ Map in-memory | Migrar para Redis |

### 16.4 Extrair Microsserviços (Futuro)

**Candidatos naturais para extração**:

| Microsserviço | Módulos | Justificativa |
|---|---|---|
| **AI Service** | AiModule + RAGModule | Processo intensivo; escala independente; pode ser serverless |
| **Session Gateway** | WhatsApp + Telegram + Messaging | I/O bound; precisa de sticky sessions; escala por conexão |
| **Transaction Processor** | TransactionsModule + Intent + Features | CPU bound; pode escalar por fila |
| **Admin API** | AdminModule + AdminControllers | Baixo tráfego; isolamento de segurança |

**Dependências circulares que precisam ser resolvidas antes**:
- `MessagesModule ↔ TransactionsModule` → evento assíncrono ou message broker
- `MessagesModule ↔ OnboardingModule` → evento assíncrono

---

## Apêndice A: Checklist de Saúde

```
[CRIT] ✅ AI Providers com new PrismaService() — corrigido via DI
[CRIT] ✅ Arquivos duplicados — removidos/consolidados
[CRIT] ✅ MessageContextService — migrado para Redis
[CRIT] ✅ Salt criptográfico — env var ENCRYPTION_SALT
[HIGH] ✅ Telegram Bull Queue — telegram-messages + processor
[HIGH] ✅ Telegram retry de envio — retry 429/5xx + Retry-After
[HIGH] ✅ AdminController — split 3634→157 (6 controllers)
[HIGH] ✅ WebChat reply — PlatformReplyService unificado
[HIGH] ✅ ACTIVE_SESSIONS_GLOBAL — dedup (sessions/core/)
[HIGH] ✅ PrismaService em providers[] — removido de 9+ módulos
[HIGH] ✅ TransactionsService strategy pattern — 7 IntentHandlers + Map dispatch (1094→851 linhas)
[MED]  ✅ Índices compostos — @@index TransactionConfirmation
[MED]  ✅ Telegram MarkdownV2 — escapeMarkdownV2 no chokepoint TelegramProvider
[MED]  ✅ InfrastructureModule — removido (dead code)
[MED]  ✅ Soft delete — deletedAt: null em 22 queries + 2 hard→soft conversões (6 arquivos)
[MED]  ❌ IntentAnalyzer 100% hardcoded
[LOW]  ✅ Arquivo .ts.bak — já removido anteriormente
[LOW]  ✅ @types movidos para devDependencies
[LOW]  ⚠️ Alpha packages em produção (@nlpjs)
[LOW]  ✅ Pacotes não usados removidos (natural, pino, uuid)
```

---

## Apêndice B: Variáveis de Ambiente Necessárias

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=xxx

# GastoCerto API
GASTO_CERTO_API_URL=https://api.gastocerto.com
SERVICE_AUTH_TOKEN=xxx

# Criptografia
ENCRYPTION_KEY=xxx
ENCRYPTION_SALT=xxx  # ✅ Já implementado — gere com: openssl rand -hex 16

# AI Providers (fallback para DB)
OPENAI_API_KEY=xxx
GOOGLE_GEMINI_API_KEY=xxx
GROQ_API_KEY=xxx
DEEPSEEK_API_KEY=xxx

# WhatsApp
AUTH_SESSIONS_DIR=.auth_sessions

# Telegram (via DB TelegramSession.token)
```

---

*Documento gerado automaticamente via análise estática do código-fonte. Recomenda-se revisão humana dos itens apontados.*

### 15. Correções Adicionais (Session 3 — Quick Wins)

| Item | Descrição | Status |
|---|---|---|
| **SEC-RagAdmin** | `RagAdminController` (6 endpoints em `admin/rag/*`) não tinha `@UseGuards(JwtAuthGuard)` — endpoints desprotegidos | ✅ Corrigido |
| **STRUCT-OrphanDir** | Diretório órfão `src/features/admin-controllers/` com 1 controller sem module próprio | ✅ Removido |
| **DI-DuplicateProviders** | `ServiceAuthService` e `JwtValidationService` registrados em `AdminModule.providers` mas já exportados pelo `@Global() CommonModule` | ✅ Removidos |

### 16. Consolidação RAG Admin (Session 4)

| Item | Descrição | Status |
|---|---|---|
| **STRUCT-RagConsolidation** | `AdminRAGController` (772 linhas, 7 routes) + `RagAdminController` (756 linhas, 6 routes) tinham 3 rotas duplicadas (sinônimos globais, logs de usuário, revalidação). `RAGLearningService` injetado mas nunca usado. | ✅ Consolidado em `AdminRagController` (1062 linhas, 10 routes). Removidos: 3 endpoints duplicados inferiores, 1 dead dependency. Todas rotas mantidas em `/admin/rag/*` |

### 17. Extração do registration.service.ts (Session 5)

| Item | Descrição | Status |
|---|---|---|
| **STRUCT-CategoryResolver** | `resolveCategoryAndSubcategory` (~200 linhas) era privado em `TransactionRegistrationService`, usado em 3 call sites internos. Lógica complexa de resolução de IDs de categoria/subcategoria em 3 camadas (cache RAG → cache local → API). | ✅ Extraído para `CategoryResolverService` em `services/category-resolver.service.ts` (222 linhas). Registrado no `TransactionsModule`. |
| **STRUCT-ProcessTextSplit** | `processTextTransaction` era método monolítico de 535 linhas com 7 fases inline: validação, RAG Phase 1, AI Phase 2, RAG Phase 3, detecção avançada, aprendizado, confirmação. | ✅ Decomposto em 4 sub-métodos privados: `indexCategoriesInRAG()`, `matchWithRAG()`, `extractWithAIAndRevalidate()`, `enrichWithDetectors()`. Método orchestrador reduzido de 535 → 252 linhas (-53%). |

**Resultado líquido Session 5:**
- `registration.service.ts`: 2112 → 1959 linhas (CategoryResolver extraído, sub-métodos na mesma classe)
- Novo arquivo: `services/category-resolver.service.ts` (222 linhas) — reutilizável
- `processTextTransaction`: 535 → 252 linhas (agora legível como pipeline de fases)
- Dependências do constructor: 18 → 19 (+CategoryResolverService, -resolveCategoryAndSubcategory interno)
- Compilação: `tsc --noEmit` — 0 erros

### 18. Domain Split do gasto-certo-api.service.ts + DRY user-cache.service.ts (Session 6)

| Item | Descrição | Status |
|---|---|---|
| **STRUCT-ApiDomainSplit** | `gasto-certo-api.service.ts` era um monolito HTTP de 1565 linhas com 27 métodos cobrindo 4 domínios: User/Auth (9), Account/Category (4), Transactions/Balance (9), Credit Cards (5). Nenhuma separação de responsabilidades. | ✅ Extraído para 3 domain clients + base abstrata + facade. |
| **STRUCT-ApiClientBase** | Infraestrutura compartilhada (handleApiError, getUserFriendlyError, HTTP helpers get/post/patch com HMAC) era duplicada implicitamente em todos os 27 métodos. | ✅ `api-client.base.ts` (171 linhas) — classe abstrata `GastoCertoApiClientBase` com HTTP helpers e error handling centralizado. |
| **STRUCT-UserAccountClient** | Métodos de User, Auth, Account e Category. | ✅ `user-account-api.client.ts` (371 linhas) — `UserAccountApiClient` com 13 métodos. |
| **STRUCT-TransactionClient** | Métodos de Transaction e Balance. | ✅ `transaction-api.client.ts` (341 linhas) — `TransactionApiClient` com 9 métodos. |
| **STRUCT-CreditCardClient** | Métodos de Credit Card e Invoice. | ✅ `credit-card-api.client.ts` (217 linhas) — `CreditCardApiClient` com 5 métodos. |
| **STRUCT-ApiFacade** | `GastoCertoApiService` reescrito como facade — 0 alterações nos 11 injection sites. | ✅ 1565 → 270 linhas (delegação pura). |
| **DI-RedundantProviders** | `GastoCertoApiService` era duplicado em `UsersModule` e `AdminModule` (já @Global via SharedModule). | ✅ Removido de ambos. Domain clients registrados em `SharedModule`. |
| **DRY-SyncAccountsFromApi** | Bloco de ~60 linhas duplicado em `listAccounts` e `getActiveAccount` de `user-cache.service.ts` (fetch API → map → resolve active → Prisma → Redis). | ✅ Extraído para método privado `syncAccountsFromApi()`. `user-cache.service.ts`: 1488 → 1443 linhas (-45, -3%). |

**Resultado líquido Session 6:**
- `gasto-certo-api.service.ts`: 1565 → 270 linhas (-83%, agora facade puro)
- Novos arquivos em `src/shared/api/`: `api-client.base.ts`, `user-account-api.client.ts`, `transaction-api.client.ts`, `credit-card-api.client.ts`, `index.ts`
- `user-cache.service.ts`: 1488 → 1443 linhas (DRY do bloco duplicado de sync)
- Injeção: 11 consumers inalterados (zero breaking changes)
- Compilação: `tsc --noEmit` — 0 erros
