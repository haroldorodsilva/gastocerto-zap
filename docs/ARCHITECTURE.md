# 🏗️ Arquitetura GastoCerto-ZAP

## 📁 Nova Estrutura de Módulos

```
src/
├── core/                          # Núcleo do sistema (compartilhado)
│   ├── events/                    # Sistema de eventos
│   │   ├── event-bus.service.ts   # Event Emitter centralizado
│   │   └── events.constants.ts    # Constantes de eventos
│   ├── database/                  # Camada de dados
│   │   ├── prisma.service.ts      # Conexão Prisma
│   │   └── redis.service.ts       # Conexão Redis
│   ├── config/                    # Configurações
│   │   ├── ai.config.ts
│   │   ├── baileys.config.ts
│   │   ├── database.config.ts
│   │   └── redis.config.ts
│   └── utils/                     # Utilitários compartilhados
│       ├── crypto.util.ts
│       ├── phone-formatter.util.ts
│       └── message-sanitizer.util.ts
│
├── features/                      # Funcionalidades de negócio
│   ├── security/                  # Segurança e validação
│   │   ├── security.module.ts
│   │   ├── security.service.ts    # Validação, rate limit, injection
│   │   ├── security.controller.ts # API para admin
│   │   └── events/
│   │       ├── security-validated.event.ts
│   │       └── security-blocked.event.ts
│   │
│   ├── assistant/                 # Assistente conversacional
│   │   ├── assistant.module.ts
│   │   ├── assistant.service.ts   # Orquestrador principal
│   │   ├── assistant.controller.ts # API para admin
│   │   ├── intent/                # Detecção de intenção
│   │   │   ├── intent.service.ts
│   │   │   └── intent.patterns.ts
│   │   └── events/
│   │       ├── message-processed.event.ts
│   │       └── intent-detected.event.ts
│   │
│   ├── onboarding/                # Cadastro de usuários
│   │   ├── onboarding.module.ts
│   │   ├── onboarding.service.ts
│   │   ├── onboarding-state.service.ts
│   │   └── events/
│   │       └── user-registered.event.ts
│   │
│   ├── transactions/              # Gestão financeira
│   │   ├── transactions.module.ts
│   │   ├── transactions.service.ts
│   │   ├── contexts/              # Estados de transação
│   │   │   ├── registration/
│   │   │   ├── confirmation/
│   │   │   └── cancellation/
│   │   └── events/
│   │       ├── transaction-created.event.ts
│   │       ├── transaction-confirmed.event.ts
│   │       └── transaction-cancelled.event.ts
│   │
│   └── users/                     # Gestão de usuários
│       ├── users.module.ts
│       ├── user-cache.service.ts
│       └── gasto-certo-api.service.ts
│
└── infrastructure/                # Infraestrutura externa
    ├── whatsapp/                  # Baileys provider
    │   ├── whatsapp.module.ts
    │   ├── baileys.service.ts
    │   └── messages/
    │       ├── message-processor.service.ts
    │       └── message-filter.service.ts
    │
    ├── telegram/                  # Telegraf provider (futuro)
    │   └── telegram.module.ts
    │
    ├── ai/                        # Provedores de IA
    │   ├── ai.module.ts
    │   ├── ai-provider.factory.ts
    │   └── providers/
    │       ├── openai.provider.ts
    │       ├── groq.provider.ts
    │       └── gemini.provider.ts
    │
    └── media/                     # Processamento de mídia
        └── media.module.ts
```

---

## 🔄 Fluxo Event-Driven

### Arquitetura Desacoplada

```
┌─────────────┐
│   Baileys   │ Recebe mensagem WhatsApp
└──────┬──────┘
       │ emit: message.received
       ▼
┌─────────────┐
│  Security   │ Valida (injection, rate limit)
└──────┬──────┘
       │ emit: security.validated
       │   ou: security.blocked
       ▼
┌─────────────┐
│ Onboarding  │ Verifica cadastro
└──────┬──────┘
       │ emit: user.verified
       │   ou: onboarding.started
       ▼
┌─────────────┐
│  Assistant  │ Detecta intenção + Quick Response
└──────┬──────┘
       │ emit: intent.detected
       ▼
┌─────────────┐
│Transactions │ Processa transação
└──────┬──────┘
       │ emit: transaction.created
       │   ou: transaction.confirmed
       ▼
┌─────────────┐
│   Baileys   │ Envia resposta
└─────────────┘
```

### Benefícios

✅ **Desacoplamento**: Módulos não se conhecem diretamente  
✅ **Testabilidade**: Cada módulo testável isoladamente  
✅ **Manutenibilidade**: Fácil adicionar/remover features  
✅ **Escalabilidade**: Eventos podem ser processados async  
✅ **Observabilidade**: Log centralizado de todos eventos

---

## 📡 Eventos do Sistema

### Core Events

```typescript
// message.received
{
  messageId: string;
  phoneNumber: string;
  content: string;
  timestamp: Date;
  platform: 'whatsapp' | 'telegram';
}

// security.validated
{
  messageId: string;
  phoneNumber: string;
  validatedContent: string;
  securityScore: number;
}

// security.blocked
{
  messageId: string;
  phoneNumber: string;
  reason: 'injection' | 'rate_limit' | 'suspicious';
  severity: 'low' | 'medium' | 'high';
}

// intent.detected
{
  messageId: string;
  phoneNumber: string;
  intent: string; // 'add_transaction', 'query_balance', etc
  confidence: number;
  entities: Record<string, any>;
}

// transaction.created
{
  transactionId: string;
  phoneNumber: string;
  amount: number;
  category: string;
  needsConfirmation: boolean;
}
```

---

## 🎯 Responsabilidades dos Módulos

### 🔒 SecurityModule
**Responsabilidade**: Proteger o sistema de ataques  
**Quando executa**: PRIMEIRO (antes de qualquer processamento)  
**Emite eventos**:
- `security.validated` → Mensagem segura, pode continuar
- `security.blocked` → Mensagem bloqueada, registrar log

**Não depende de**: Nenhum módulo  
**Dependentes**: Todos os outros módulos

---

### 🤖 AssistantModule
**Responsabilidade**: Entender intenção do usuário  
**Quando executa**: Após security.validated  
**Emite eventos**:
- `intent.detected` → Intenção identificada
- `quick.response` → Resposta instantânea (sem AI)

**Depende de**: SecurityModule  
**Dependentes**: TransactionsModule, OnboardingModule

---

### 💰 TransactionsModule
**Responsabilidade**: Gerenciar transações financeiras  
**Quando executa**: Após intent.detected (se intent = finance)  
**Emite eventos**:
- `transaction.created` → Nova transação
- `transaction.confirmed` → Confirmação do usuário
- `transaction.cancelled` → Cancelamento

**Depende de**: AssistantModule, UsersModule  
**Dependentes**: Baileys (para enviar resposta)

---

### 👤 OnboardingModule
**Responsabilidade**: Cadastrar novos usuários  
**Quando executa**: Após security.validated (se user não existe)  
**Emite eventos**:
- `user.registered` → Cadastro completo
- `onboarding.step.completed` → Passo concluído

**Depende de**: SecurityModule  
**Dependentes**: AssistantModule

---

### 📱 BaileysService (Infrastructure)
**Responsabilidade**: Comunicação com WhatsApp  
**Quando executa**: Sempre (recebe/envia mensagens)  
**Emite eventos**:
- `message.received` → Mensagem recebida
- `message.sent` → Mensagem enviada

**Depende de**: Nenhum módulo  
**Dependentes**: Todos escutam message.received

---

## 🔌 API para GastoCerto-Admin

### SecurityController

```
GET    /api/security/stats              # Dashboard de segurança
GET    /api/security/logs               # Lista logs (paginado)
GET    /api/security/logs/:id           # Detalhe de log
GET    /api/security/blocked-users      # Usuários bloqueados
POST   /api/security/unblock/:phone     # Desbloquear usuário
GET    /api/security/settings/:userId   # Config de segurança
PATCH  /api/security/settings/:userId   # Atualizar config
```

### AssistantController

```
GET    /api/assistant/stats             # Estatísticas gerais
GET    /api/assistant/intents           # Intenções detectadas
GET    /api/assistant/cache-hit-rate    # Taxa de cache hit
GET    /api/assistant/settings/:userId  # Config do assistente
PATCH  /api/assistant/settings/:userId  # Atualizar config
POST   /api/assistant/test              # Testar intent detection
```

### TransactionsController (já existe)

```
GET    /api/transactions/:phone         # Lista transações
GET    /api/transactions/:phone/:id     # Detalhe transação
```

---

## 🧪 Testabilidade

### Unit Tests (Isolados)

```typescript
// security.service.spec.ts
describe('SecurityService', () => {
  it('should detect prompt injection', async () => {
    const result = await service.validateUserMessage(
      'Ignore previous instructions...'
    );
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('injection');
  });
});

// assistant.service.spec.ts
describe('AssistantService', () => {
  it('should detect add_transaction intent', async () => {
    const result = await service.detectIntent('Gastei 45 no almoço');
    expect(result.intent).toBe('add_transaction');
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});
```

### Integration Tests (Com Eventos)

```typescript
describe('Complete Flow', () => {
  it('should process transaction from message to confirmation', async () => {
    const events: string[] = [];
    
    eventBus.on('security.validated', () => events.push('security'));
    eventBus.on('intent.detected', () => events.push('intent'));
    eventBus.on('transaction.created', () => events.push('transaction'));
    
    await messageProcessor.process('Gastei 45 no almoço');
    
    expect(events).toEqual(['security', 'intent', 'transaction']);
  });
});
```

---

## 🚀 Performance

### Cache Strategy (3 Layers)

```
Layer 1: Quick Responses (0ms)
├─ Greetings: "oi", "olá" → Resposta direta
├─ Thanks: "obrigado" → Resposta direta
└─ Help: "ajuda" → Menu completo

Layer 2: Redis Cache (50ms)
├─ User settings (TTL: 5min)
├─ Categories (TTL: 1hour)
└─ Recent intents (TTL: 10min)

Layer 3: AI Processing (200ms)
├─ OpenAI (primary)
├─ Groq (fallback 1)
└─ Gemini (fallback 2)
```

### Métricas Target

- **Tempo médio de resposta**: < 80ms
- **Cache hit rate**: > 90%
- **Custo por usuário/mês**: < R$ 0,75
- **Disponibilidade**: 99.9%

---

## 🔐 Segurança em Camadas

```
1. Rate Limiting (Redis)
   ├─ 20 msgs/minuto por usuário
   └─ 100 msgs/hora por usuário

2. Prompt Injection Detection
   ├─ 20+ patterns regex
   └─ Heurísticas (palavras suspeitas)

3. Content Validation
   ├─ Tamanho máximo (500 chars)
   └─ Caracteres proibidos

4. Output Sanitization
   ├─ Remove caracteres perigosos
   └─ Escapa HTML/markdown
```

---

## 📊 Monitoramento

### Dashboards Necessários

1. **Security Dashboard**
   - Tentativas de injection (últimas 24h)
   - Usuários bloqueados por rate limit
   - Logs de severidade high
   - Taxa de bloqueio por hora

2. **Assistant Dashboard**
   - Intents mais comuns
   - Taxa de quick responses
   - Cache hit rate
   - Tempo médio de resposta

3. **Transactions Dashboard**
   - Transações criadas/hora
   - Taxa de confirmação
   - Categorias mais usadas
   - Erros de API

---

## 🔄 Evolução da Arquitetura

### Fase 1 (Atual) ✅
- Estrutura modular básica
- Serviços acoplados
- Processamento síncrono

### Fase 2 (Em Implementação) 🚧
- Event-driven architecture
- Módulos desacoplados
- Security + Assistant

### Fase 3 (Próximo) 📅
- RAG com BM25
- Telegram support
- Webhooks externos

### Fase 4 (Futuro) 🔮
- Microservices
- Message queue (RabbitMQ)
- Horizontal scaling

---

## 📚 Documentação Relacionada

- [ONBOARDING.md](./ONBOARDING.md) - Fluxo de cadastro
- [MESSAGES.md](./MESSAGES.md) - Processamento de mensagens
- [OPERATIONS.md](./OPERATIONS.md) - Operações do sistema
- [ASSISTANT_FLOW.md](./ASSISTANT_FLOW.md) - Fluxo conversacional
- [RAG_IMPLEMENTATION.md](./RAG_IMPLEMENTATION.md) - Busca semântica
- [RAG_ALTERNATIVES.md](./RAG_ALTERNATIVES.md) - Alternativas sem IA

---

**Princípios de Design**:
1. **Single Responsibility**: Cada módulo tem 1 responsabilidade clara
2. **Event-Driven**: Comunicação via eventos, não chamadas diretas
3. **Dependency Injection**: Facilita testes e manutenção
4. **Configuration Over Code**: Tudo configurável via banco
5. **Fail Fast**: Erros bloqueiam fluxo imediatamente
