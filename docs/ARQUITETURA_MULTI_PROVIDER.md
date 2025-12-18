# 📋 Arquitetura Multi-Provider & Melhorias de Humanização

## 1. ⚠️ Erro 515 do WhatsApp (Baileys)

### Problema
O erro **515 (stream:error)** é um erro comum no Baileys que ocorre quando:
- WhatsApp detecta comportamento automatizado
- Muitas requisições em curto período
- Sessão é encerrada pelo servidor WhatsApp

### Solução Atual
Já temos logging detalhado do erro 515 em [baileys-whatsapp.provider.ts:74-77](../src/infrastructure/whatsapp/sessions/whatsapp/baileys-whatsapp.provider.ts#L74-L77):

```typescript
if (statusCode === 515 || error.data?.node?.attrs?.code === '515') {
  this.logger.error(
    `Stream error 515 detected: ${JSON.stringify(error.data?.node || error.output)}`,
  );
}
```

### Recomendações para Evitar 515
1. **Rate Limiting Implementado**: Já temos proteção contra spam (10 msg/min, 100/hora, 500/dia)
2. **Adicionar Delays Humanizados**: Ver seção 3 deste documento
3. **Usar WhatsApp Business API**: Migrar para API oficial (ver abaixo)

---

## 2. 🔄 Migração para WhatsApp Business API ou Twilio

### Arquitetura Atual (Pattern Strategy)

Nossa arquitetura já está **preparada para múltiplos providers** através do **Strategy Pattern**:

```
IMessagingProvider (interface genérica)
    ├── TelegramProvider ✅ (implementado)
    ├── BaileysWhatsAppProvider ✅ (implementado - Baileys)
    ├── WhatsAppBusinessProvider ⏳ (não implementado - API oficial)
    └── TwilioProvider ⏳ (não implementado)
```

### Arquivos Relevantes

#### Interfaces Base
- [messaging-provider.interface.ts](../src/common/interfaces/messaging-provider.interface.ts) - Interface genérica para TODOS os providers
- [whatsapp-provider.interface.ts](../src/common/interfaces/whatsapp-provider.interface.ts) - Interface específica WhatsApp (Baileys)

#### Implementações Atuais
- [telegram.provider.ts](../src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts) - Telegram Bot API
- [baileys-whatsapp.provider.ts](../src/infrastructure/whatsapp/sessions/whatsapp/baileys-whatsapp.provider.ts) - WhatsApp via Baileys

#### Orquestração
- [multi-platform-session.service.ts](../src/infrastructure/whatsapp/sessions/multi-platform-session.service.ts) - Gerencia todas as sessões

### ✅ O que NÃO precisa mudar

- ❌ **Handlers de Mensagens**: `whatsapp-message.handler.ts`, `telegram-message.handler.ts`
- ❌ **Processadores de Filas**: `messages.processor.ts`, `transaction-confirmation.processor.ts`
- ❌ **Serviços de Negócio**: `OnboardingService`, `TransactionConfirmationService`, `RAGService`
- ❌ **Sistema de Eventos**: `EventEmitter2` continua igual
- ❌ **Rate Limiting**: Funciona independente do provider
- ❌ **Cache de Usuários**: Não afeta

### ✅ O que PRECISA mudar

#### 1. Criar Novo Provider (WhatsApp Business API)

```typescript
// src/infrastructure/whatsapp/sessions/whatsapp/whatsapp-business.provider.ts

@Injectable()
export class WhatsAppBusinessProvider implements IMessagingProvider {
  public readonly platform = MessagingPlatform.WHATSAPP;

  async initialize(config: MessagingConnectionConfig, callbacks: MessagingCallbacks): Promise<void> {
    // Usar SDK oficial do WhatsApp Business API
    // https://developers.facebook.com/docs/whatsapp/cloud-api
  }

  async sendTextMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<MessageResult> {
    // POST https://graph.facebook.com/v18.0/{phone-number-id}/messages
    const response = await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: chatId,
        type: 'text',
        text: { body: text }
      })
    });

    return { success: true, messageId: response.messages[0].id };
  }

  // ... implementar outros métodos da interface IMessagingProvider
}
```

#### 2. Criar Novo Provider (Twilio)

```typescript
// src/infrastructure/whatsapp/sessions/whatsapp/twilio-whatsapp.provider.ts

@Injectable()
export class TwilioWhatsAppProvider implements IMessagingProvider {
  public readonly platform = MessagingPlatform.WHATSAPP;

  async initialize(config: MessagingConnectionConfig, callbacks: MessagingCallbacks): Promise<void> {
    // Usar Twilio SDK
    this.client = twilio(accountSid, authToken);
  }

  async sendTextMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<MessageResult> {
    const message = await this.client.messages.create({
      body: text,
      from: `whatsapp:${this.twilioNumber}`,
      to: `whatsapp:${chatId}`
    });

    return { success: true, messageId: message.sid };
  }

  // ... implementar outros métodos
}
```

#### 3. Atualizar `MultiPlatformSessionService` (MÍNIMO)

Apenas adicionar lógica para escolher o provider correto:

```typescript
// src/infrastructure/whatsapp/sessions/multi-platform-session.service.ts

async startWhatsAppSession(sessionId: string, providerType: 'baileys' | 'business' | 'twilio'): Promise<void> {
  let provider: IMessagingProvider;

  switch (providerType) {
    case 'baileys':
      provider = new BaileysWhatsAppProvider(this.configService);
      break;
    case 'business':
      provider = new WhatsAppBusinessProvider(this.configService);
      break;
    case 'twilio':
      provider = new TwilioWhatsAppProvider(this.configService);
      break;
  }

  // Resto do código continua IGUAL
  await provider.initialize(config, callbacks);
  this.sessions.set(sessionId, { provider, ... });
}
```

#### 4. Atualizar Schema do Banco (Prisma)

Adicionar campo para escolher o provider:

```prisma
model WhatsAppSession {
  id          String   @id @default(cuid())
  sessionId   String   @unique
  provider    WhatsAppProvider @default(BAILEYS) // 🆕 NOVO CAMPO
  businessApiToken String? // Para WhatsApp Business API
  twilioAccountSid String? // Para Twilio
  twilioAuthToken  String? // Para Twilio
  // ... campos existentes
}

enum WhatsAppProvider {
  BAILEYS
  BUSINESS_API
  TWILIO
}
```

#### 5. Atualizar Controller (MÍNIMO)

```typescript
// src/features/whatsapp/whatsapp-session.controller.ts

@Post(':id/start')
async startSession(
  @Param('id') sessionId: string,
  @Body() body: { provider?: 'baileys' | 'business' | 'twilio' }
) {
  const provider = body.provider || 'baileys';
  await this.sessionService.startWhatsAppSession(sessionId, provider);
}
```

### 📦 Pacotes Necessários

#### WhatsApp Business API
```bash
npm install axios # Já instalado
# Não precisa de SDK, usar direto a API REST
```

#### Twilio
```bash
npm install twilio
npm install @types/twilio --save-dev
```

### ⚡ Resumo da Mudança

| Componente | Alteração Necessária |
|-----------|---------------------|
| **Handlers** | ❌ Nenhuma |
| **Processors** | ❌ Nenhuma |
| **Services de Negócio** | ❌ Nenhuma |
| **Eventos** | ❌ Nenhuma |
| **Rate Limiting** | ❌ Nenhuma |
| **Novos Providers** | ✅ Criar classes novas |
| **MultiPlatformService** | ✅ Adicionar switch case |
| **Prisma Schema** | ✅ Adicionar enum provider |
| **Controller** | ✅ Aceitar parâmetro provider |

**Estimativa**: 80% do código **permanece intacto**, apenas **20% precisa de ajustes**.

---

## 3. 🤖 Melhorias para Humanização das Respostas

### Problemas Atuais (Detectados)

1. **Respostas Instantâneas**: Mensagens são enviadas em milissegundos (0-50ms)
2. **Sem Indicador de Digitação**: Não mostra "digitando..."
3. **Sem Delays Variáveis**: Mensagens longas deveriam demorar mais
4. **Sem Padrões Humanos**: Sempre mesma velocidade, não importa complexidade

### Análise do Fluxo Atual

```
Usuário envia mensagem
    ↓
WhatsAppMessageHandler/TelegramMessageHandler (0ms)
    ↓
Fila Bull (processo assíncrono)
    ↓
MessagesProcessor (processamento IA - 500-2000ms)
    ↓
EventEmitter: whatsapp.reply / telegram.reply
    ↓
MessageResponseService.sendReply() (0ms - INSTANTÂNEO!)
    ↓
MultiPlatformSessionService.sendTextMessage() (0ms)
    ↓
Provider.sendTextMessage() (50-200ms rede)
```

**Problema**: Entre `EventEmitter` e `sendTextMessage()` não há NENHUM delay artificial.

### Proposta de Solução: MessageTimingService

#### 1. Criar Novo Serviço de Timing

```typescript
// src/common/services/message-timing.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TimingConfig {
  enabled: boolean;
  baseDelayMs: number; // Delay base (ex: 1000ms)
  msPerCharacter: number; // Delay por caractere (ex: 50ms)
  randomnessPercent: number; // Variação aleatória (ex: 20%)
  maxDelayMs: number; // Delay máximo (ex: 5000ms)
  minDelayMs: number; // Delay mínimo (ex: 500ms)
  showTypingIndicator: boolean; // Mostrar "digitando..."
}

@Injectable()
export class MessageTimingService {
  private readonly logger = new Logger(MessageTimingService.name);
  private readonly config: TimingConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      enabled: this.configService.get<boolean>('MESSAGE_TIMING_ENABLED', true),
      baseDelayMs: this.configService.get<number>('MESSAGE_TIMING_BASE_DELAY', 1000),
      msPerCharacter: this.configService.get<number>('MESSAGE_TIMING_MS_PER_CHAR', 50),
      randomnessPercent: this.configService.get<number>('MESSAGE_TIMING_RANDOMNESS', 20),
      maxDelayMs: this.configService.get<number>('MESSAGE_TIMING_MAX_DELAY', 5000),
      minDelayMs: this.configService.get<number>('MESSAGE_TIMING_MIN_DELAY', 500),
      showTypingIndicator: this.configService.get<boolean>('MESSAGE_TIMING_SHOW_TYPING', true),
    };
  }

  /**
   * Calcula delay baseado no tamanho da mensagem
   * Fórmula: baseDelay + (caracteres * msPerCharacter) ± randomness
   */
  calculateDelay(messageLength: number): number {
    if (!this.config.enabled) {
      return 0;
    }

    // Delay base + delay por caractere
    let delay = this.config.baseDelayMs + (messageLength * this.config.msPerCharacter);

    // Adicionar randomness (±20% por padrão)
    const randomFactor = 1 + ((Math.random() - 0.5) * 2 * (this.config.randomnessPercent / 100));
    delay = delay * randomFactor;

    // Aplicar limites
    delay = Math.max(this.config.minDelayMs, Math.min(delay, this.config.maxDelayMs));

    return Math.round(delay);
  }

  /**
   * Aguarda o tempo calculado (simula digitação)
   */
  async waitForTyping(messageLength: number): Promise<number> {
    const delayMs = this.calculateDelay(messageLength);

    if (delayMs > 0) {
      this.logger.debug(`⏳ Aguardando ${delayMs}ms antes de enviar mensagem (${messageLength} chars)`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return delayMs;
  }

  /**
   * Retorna configuração atual
   */
  getConfig(): TimingConfig {
    return { ...this.config };
  }
}
```

#### 2. Integrar no MessageResponseService

```typescript
// src/infrastructure/whatsapp/messages/message-response.service.ts

@Injectable()
export class MessageResponseService {
  constructor(
    private readonly contextService: MessageContextService,
    private readonly sessionService: MultiPlatformSessionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly timingService: MessageTimingService, // 🆕 NOVO
  ) {}

  @OnEvent('whatsapp.reply')
  @OnEvent('telegram.reply')
  async sendReply(payload: {
    platformId: string;
    message: string;
    context?: string;
    platform: MessagingPlatform;
  }): Promise<void> {
    try {
      const { platformId, message, platform } = payload;

      // 🆕 AGUARDAR TEMPO DE "DIGITAÇÃO" HUMANIZADO
      const delayMs = await this.timingService.waitForTyping(message.length);

      this.logger.debug(
        `📤 Enviando resposta para ${platformId} após ${delayMs}ms de delay humanizado`
      );

      // Buscar contexto
      const context = this.contextService.getContext(platformId);

      if (!context) {
        this.logger.warn(`⚠️ Contexto não encontrado para ${platformId}`);
        return;
      }

      // Enviar mensagem
      await this.sessionService.sendTextMessage(context.sessionId, platformId, message);

      this.logger.log(`✅ Mensagem enviada para ${platformId} (${platform})`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar resposta:`, error);
    }
  }
}
```

#### 3. Adicionar Indicador de Digitação (WhatsApp)

```typescript
// src/infrastructure/whatsapp/sessions/whatsapp/baileys-whatsapp.provider.ts

@Injectable()
export class BaileysWhatsAppProvider implements IWhatsAppProvider {

  /**
   * 🆕 Envia estado de "digitando..."
   */
  async sendTypingIndicator(jid: string, isTyping: boolean = true): Promise<void> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      await this.socket.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
    } catch (error) {
      this.logger.error(`Failed to send typing indicator: ${error.message}`);
    }
  }

  /**
   * 🔧 MODIFICAR sendTextMessage para incluir typing indicator
   */
  async sendTextMessage(
    jid: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      // 🆕 Mostrar "digitando..." antes de enviar
      await this.sendTypingIndicator(jid, true);

      // Aguardar um pouco (será controlado pelo MessageTimingService)
      // O delay já foi feito no MessageResponseService

      const message: any = { text };

      if (options?.quotedMessageId) {
        message.quoted = { key: { id: options.quotedMessageId } };
      }

      if (options?.mentions) {
        message.mentions = options.mentions;
      }

      const result = await this.socket.sendMessage(jid, message);

      // 🆕 Parar "digitando..." após enviar
      await this.sendTypingIndicator(jid, false);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send text message: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
```

#### 4. Adicionar Indicador de Digitação (Telegram)

```typescript
// src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts

@Injectable()
export class TelegramProvider implements IMessagingProvider {

  /**
   * 🆕 Envia ação de "digitando..."
   */
  async sendTypingAction(chatId: string): Promise<void> {
    try {
      if (!this.bot) {
        throw new Error('Bot not initialized');
      }

      // Telegram mostra "digitando" por 5 segundos ou até mensagem ser enviada
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      this.logger.error(`Failed to send typing action: ${error.message}`);
    }
  }

  /**
   * 🔧 MODIFICAR sendTextMessage para incluir typing action
   */
  async sendTextMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.bot) {
          throw new Error('Bot not initialized');
        }

        // 🆕 Mostrar "digitando..." antes de enviar
        await this.sendTypingAction(chatId);

        this.logger.debug(
          `📤 Tentativa ${attempt}/${maxRetries} - Enviando mensagem para ${chatId}`,
        );

        const result = await this.bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: !options?.linkPreview,
          reply_to_message_id: options?.quotedMessageId
            ? parseInt(options.quotedMessageId)
            : undefined,
        });

        this.logger.log(`✅ Mensagem enviada com sucesso para ${chatId} (tentativa ${attempt})`);

        return {
          success: true,
          messageId: result.message_id.toString(),
        };
      } catch (error: any) {
        // ... resto do código de retry
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
    };
  }
}
```

#### 5. Adicionar Variáveis de Ambiente

```bash
# .env

# ========================================
# HUMANIZAÇÃO DE RESPOSTAS
# ========================================

# Ativar delays humanizados
MESSAGE_TIMING_ENABLED=true

# Delay base em milissegundos (sempre aplicado)
MESSAGE_TIMING_BASE_DELAY=1000

# Delay adicional por caractere (50ms = 1000ms para 20 chars)
MESSAGE_TIMING_MS_PER_CHAR=50

# Variação aleatória em % (20 = ±20% de randomness)
MESSAGE_TIMING_RANDOMNESS=20

# Delay máximo (não ultrapassar 5 segundos)
MESSAGE_TIMING_MAX_DELAY=5000

# Delay mínimo (sempre aguardar pelo menos 500ms)
MESSAGE_TIMING_MIN_DELAY=500

# Mostrar indicador "digitando..." (WhatsApp e Telegram)
MESSAGE_TIMING_SHOW_TYPING=true
```

#### 6. Atualizar CommonModule

```typescript
// src/common/common.module.ts

@Global()
@Module({
  providers: [
    ServiceAuthService,
    JwtValidationService,
    UserRateLimiterService,
    RedisService,
    MessageTimingService, // 🆕 NOVO
    // ... guards
  ],
  exports: [
    ServiceAuthService,
    JwtValidationService,
    UserRateLimiterService,
    RedisService,
    MessageTimingService, // 🆕 NOVO
    // ... guards
  ],
})
export class CommonModule {}
```

### 📊 Exemplos de Timing

| Mensagem | Caracteres | Delay Calculado | Variação (±20%) | Delay Final |
|----------|-----------|----------------|-----------------|-------------|
| "Ok!" | 3 | 1000 + (3×50) = 1150ms | 920-1380ms | ~1150ms |
| "Seu saldo atual é R$ 1.234,56" | 32 | 1000 + (32×50) = 2600ms | 2080-3120ms | ~2600ms |
| Mensagem de onboarding completa | 450 | 1000 + (450×50) = 23500ms | LIMITADO | **5000ms** (max) |
| "✅" | 1 | 1000 + (1×50) = 1050ms | 840-1260ms | ~1000ms (min 500ms) |

### ✨ Benefícios

1. **Mais Natural**: Usuários não percebem que é bot imediatamente
2. **Menos Suspeito**: WhatsApp não detecta comportamento automatizado
3. **Reduz Erro 515**: Delays naturais evitam rate limit do WhatsApp
4. **Configurável**: Pode desativar para testes (`MESSAGE_TIMING_ENABLED=false`)
5. **Adaptativo**: Mensagens longas demoram mais, curtas demoram menos
6. **Indicadores Visuais**: "digitando..." melhora UX

### 🎯 Outras Melhorias de Humanização

#### 1. Variação nas Respostas Padrão

```typescript
// src/features/intent/intent-analyzer.service.ts

private getRandomGreeting(): string {
  const greetings = [
    'Olá! Como posso ajudar?',
    'Oi! Em que posso te ajudar hoje?',
    'Hey! Me diz o que você precisa.',
    'Fala! Tô aqui pra te ajudar.',
    'E aí! Bora controlar seus gastos?',
  ];

  return greetings[Math.floor(Math.random() * greetings.length)];
}
```

#### 2. Mensagens de Confirmação Variadas

```typescript
// src/features/transactions/transaction-confirmation.service.ts

private getConfirmationMessages() {
  return {
    success: [
      '✅ Pronto! Transação salva.',
      '✅ Feito! Já anotei isso pra você.',
      '✅ Beleza! Já tá guardado.',
      '✅ Ok! Transação registrada.',
    ],
    error: [
      '❌ Ops! Algo deu errado. Tenta de novo?',
      '❌ Eita! Não consegui salvar. Tenta novamente?',
      '❌ Hmm, falhou. Pode tentar de novo?',
    ]
  };
}
```

#### 3. Respostas Contextuais ao Horário

```typescript
// Já implementado em intent-analyzer.service.ts (linhas 445-501)
// ✅ Detecta "bom dia", "boa tarde", "boa noite" baseado na hora
```

#### 4. Emojis Contextuais (Já Implementados)

- ✅ Usamos emojis em todas as respostas
- 💸 Para gastos
- 💰 Para receitas
- 📊 Para consultas
- ❌ Para erros
- ✅ Para confirmações

#### 5. Erros Amigáveis

```typescript
// Evitar mensagens técnicas, usar linguagem natural:

// ❌ MAL: "Error: User not found in cache"
// ✅ BOM: "🤔 Hmm, não encontrei seu cadastro. Vamos começar?"

// ❌ MAL: "Transaction validation failed: amount is required"
// ✅ BOM: "⚠️ Opa! Faltou o valor. Quanto foi o gasto?"
```

---

## 4. 📝 Registro de Não Fazer Push Direto para Main

### ⚠️ IMPORTANTE: Workflow de Deploy

```
┌─────────────────────────────────────────────┐
│ 1. Desenvolvimento Local                     │
│    git add .                                 │
│    git commit -m "feat: nova funcionalidade" │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ 2. Push para Branch Staging                  │
│    git push origin staging                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ 3. Deploy Automático em Staging              │
│    - Railway/Render faz deploy automático    │
│    - Ambiente: staging.gastocerto.com        │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ 4. TESTES MANUAIS EM STAGING                 │
│    ⚠️ Haraldo testa tudo manualmente          │
│    - Conectar sessões                        │
│    - Enviar mensagens                        │
│    - Testar onboarding                       │
│    - Verificar transações                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼ (Somente se TUDO OK)
┌─────────────────────────────────────────────┐
│ 5. Merge para Main (PRODUÇÃO)                │
│    git checkout main                         │
│    git merge staging                         │
│    git push origin main                      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ 6. Deploy Automático em Produção             │
│    - Railway/Render faz deploy automático    │
│    - Ambiente: api.gastocerto.com            │
│    - Usuários reais afetados                 │
└─────────────────────────────────────────────┘
```

### 🚫 NUNCA FAZER

```bash
# ❌ NUNCA fazer push direto para main
git push origin main

# ❌ NUNCA fazer merge sem testar em staging
git merge feature-x && git push origin main
```

### ✅ SEMPRE FAZER

```bash
# 1. Commitar mudanças
git add .
git commit -m "feat: implementa funcionalidade X"

# 2. Push para staging
git push origin staging

# 3. Aguardar deploy automático

# 4. Testar manualmente em staging
# - Conectar sessões WhatsApp/Telegram
# - Enviar mensagens de teste
# - Verificar logs
# - Validar fluxos completos

# 5. Somente SE TUDO OK, fazer merge para main
git checkout main
git merge staging
git push origin main
```

### 📋 Checklist de Testes em Staging

Antes de fazer merge para `main`, **SEMPRE** verificar:

- [ ] Sessões WhatsApp conectam sem erro 515
- [ ] Sessões Telegram conectam corretamente
- [ ] Onboarding funciona (WhatsApp e Telegram)
- [ ] Transações são criadas e confirmadas
- [ ] Rate limiting funciona (enviar 11 mensagens seguidas)
- [ ] RAG sugere categorias corretamente
- [ ] Sinônimos personalizados funcionam (se alterados)
- [ ] Indicador de digitação aparece (se implementado)
- [ ] Delays humanizados estão corretos (se implementado)
- [ ] Logs não mostram erros críticos
- [ ] Redis conecta sem problemas
- [ ] Banco de dados está sincronizado (migrations)

### 🔧 Configurar Proteção de Branch (GitHub)

```yaml
# .github/branch-protection.yml

branches:
  main:
    protection:
      required_reviews: 1 # Requer aprovação manual
      require_status_checks: true # CI/CD deve passar
      required_status_checks:
        - "build"
        - "test"
      dismiss_stale_reviews: true
      restrict_pushes: true # Apenas via merge
      allowed_push_users: []

  staging:
    protection:
      required_status_checks: true
      required_status_checks:
        - "build"
        - "test"
```

### 🤖 Configurar GitHub Actions (CI/CD)

```yaml
# .github/workflows/staging.yml

name: Deploy to Staging

on:
  push:
    branches: [staging]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: TypeScript check
        run: npx tsc --noEmit

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Railway (Staging)
        run: |
          # Comando de deploy do Railway/Render
          railway up --service gastocerto-zap-staging
```

```yaml
# .github/workflows/production.yml

name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: TypeScript check
        run: npx tsc --noEmit

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Railway (Production)
        run: |
          railway up --service gastocerto-zap-production
```

---

## 5. 📚 Resumo Executivo

### Erro 515 WhatsApp
- **Causa**: Comportamento automatizado detectado
- **Solução Atual**: Logging detalhado implementado
- **Próximos Passos**: Implementar delays humanizados (ver seção 3)

### Migração para WhatsApp Business API / Twilio
- **Impacto**: ✅ **MÍNIMO** - Arquitetura já preparada
- **Mudanças**: Apenas criar novos providers e atualizar `MultiPlatformSessionService`
- **Não Afeta**: 80% do código (handlers, processors, services)
- **Estimativa**: 1-2 dias de desenvolvimento

### Humanização de Respostas
- **Problema**: Respostas instantâneas (0-50ms)
- **Solução**: `MessageTimingService` com delays calculados
- **Benefícios**: Mais natural, evita erro 515, melhora UX
- **Configurável**: Pode desativar via ENV
- **Implementações**:
  1. Delays baseados no tamanho da mensagem
  2. Indicador "digitando..." (WhatsApp e Telegram)
  3. Variação aleatória (±20%)
  4. Respostas variadas (não repetitivas)

### Workflow de Deploy
- **NUNCA** fazer push direto para `main`
- **SEMPRE** testar em `staging` antes
- Configurar proteção de branch no GitHub
- Usar CI/CD para garantir qualidade

---

**Documentação criada em**: 2025-12-18
**Última atualização**: 2025-12-18
**Autor**: Claude Code Assistant
