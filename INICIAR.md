# 🚀 GUIA DE INICIALIZAÇÃO - GASTOCERTO ZAP

**Status:** ✅ 100% PRONTO PARA USAR  
**Data:** 14 de dezembro de 2025  
**Arquitetura:** Event-Driven Genérico (WhatsApp + Telegram)

---

## ✅ O QUE ESTÁ PRONTO

### 1. **Estrutura Completa** ✅
- ✅ Core (database, config, utils)
- ✅ Features (onboarding, transactions, users, assistant, security)
- ✅ Infrastructure (WhatsApp, Telegram, AI, Storage)
- ✅ Shared (Redis global, GastoCertoAPI)

### 2. **Banco de Dados** ✅
- ✅ Prisma configurado
- ✅ Migrations aplicadas
- ✅ Redis global (cache compartilhado)

### 3. **Fluxo de Mensagens** ✅
- ✅ **Arquitetura Event-Driven Genérica**
- ✅ WhatsAppMessageHandler (100% event-driven)
- ✅ TelegramMessageHandler (100% event-driven)
- ✅ MessageFilterService (filtra mensagens)
- ✅ MessageContextService (registra plataforma)
- ✅ MessageResponseService (responde automaticamente)
- ✅ MessagesProcessor (processa filas)

### 4. **Onboarding** ✅
- ✅ Máquina de estados (8 steps)
- ✅ Validadores (email, nome, telefone)
- ✅ Integração com API GastoCerto
- ✅ **Detecção automática de plataforma** (WhatsApp/Telegram)
- ✅ **Respostas via eventos** (genérico para ambas plataformas)

### 5. **Transações** ✅
- ✅ Detecção de confirmações pendentes
- ✅ Roteamento automático (nova transação vs confirmação)
- ✅ Processadores (confirmation, registration)
- ✅ Integração com AI para extração de dados
- ✅ **Event-driven genérico** (funciona em ambas plataformas)

### 6. **IA** ✅
- ✅ 4 Providers (OpenAI, Groq, Gemini, DeepSeek)
- ✅ RAG implementado (BM25 + embeddings)
- ✅ AIUsageTracker (tracking de custos)
- ✅ Fallback chain (economia de custos)

### 7. **Segurança** ✅
- ✅ HMAC authentication (ServiceAuthService)
- ✅ Rate limiting
- ✅ Validação de mensagens
- ✅ Blacklist/Whitelist

### 8. **✨ Multi-Plataforma Genérico** ✅
- ✅ **Mesmo código** para WhatsApp e Telegram
- ✅ **Detecção automática** via MessageContextService
- ✅ **Eventos genéricos** ('whatsapp.reply' | 'telegram.reply')
- ✅ **Zero duplicação** de lógica de negócio

---

## 🔧 PASSO 1: CONFIGURAR VARIÁVEIS DE AMBIENTE

### Copiar e configurar `.env`:

```bash
cp .env.example .env
```

### Editar `.env` com suas credenciais:

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/gastocerto_zap"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TTL=3600

# API GastoCerto
GASTO_CERTO_API_URL=https://api.gastocerto.com
GASTO_CERTO_SERVICE_ID=gastocerto-zap
GASTO_CERTO_SECRET_KEY=your-secret-key-here

# WhatsApp (Baileys)
WHATSAPP_MULTI_DEVICE=true
WHATSAPP_SESSION_PATH=./sessions

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# OpenAI
OPENAI_API_KEY=sk-...

# Groq
GROQ_API_KEY=gsk_...

# Google Gemini
GOOGLE_GEMINI_API_KEY=...

# DeepSeek
DEEPSEEK_API_KEY=...

# Servidor
PORT=3000
NODE_ENV=development
```

---

## 🐳 PASSO 2: INICIAR CONTAINERS (PostgreSQL + Redis)

```bash
# Subir containers
docker-compose up -d

# Verificar se estão rodando
docker-compose ps

# Ver logs (opcional)
docker-compose logs -f
```

**Esperado:**
```
✅ gastocerto-zap-postgres-1  running  0.0.0.0:5432->5432/tcp
✅ gastocerto-zap-redis-1     running  0.0.0.0:6379->6379/tcp
```

---

## 📦 PASSO 3: INSTALAR DEPENDÊNCIAS

```bash
# Instalar pacotes
npm install

# ou
yarn install
```

---

## 🗄️ PASSO 4: RODAR MIGRATIONS

```bash
# Aplicar migrations (já devem estar aplicadas)
npx prisma migrate dev

# Gerar Prisma Client
npx prisma generate

# Ver banco de dados (opcional)
npx prisma studio
```

---

## ▶️ PASSO 5: INICIAR SERVIDOR

```bash
# Modo desenvolvimento (com hot reload)
npm run start:dev

# ou
yarn dev
```

**Esperado no console:**
```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG [InstanceLoader] AppModule dependencies initialized
[Nest] LOG [InstanceLoader] SharedModule dependencies initialized
[Nest] LOG [InstanceLoader] OnboardingModule dependencies initialized
[Nest] LOG [RouterExplorer] Mapped {/api/sessions/whatsapp/qr, GET}
🚀 Server running on: http://localhost:3000
```

---

## 📱 PASSO 6: CONECTAR WHATSAPP

### 6.1. Gerar QR Code:

```bash
# Abrir no navegador:
http://localhost:3000/api/sessions/whatsapp/qr

# Ou via curl:
curl http://localhost:3000/api/sessions/whatsapp/qr
```

### 6.2. Escanear QR Code:

1. Abrir WhatsApp no celular
2. Ir em **Configurações > Dispositivos Conectados**
3. Tocar em **Conectar Dispositivo**
4. Escanear o QR Code da tela

### 6.3. Verificar conexão:

**Esperado no console:**
```
[WhatsApp] ✅ Session connected: whatsapp-5566996285154
[WhatsApp] 📱 Device: Chrome (Desktop)
[SessionManager] Session whatsapp-5566996285154 registered
```

---

## 🧪 PASSO 7: TESTAR ONBOARDING

### Enviar mensagem no WhatsApp:

```
Você: Olá
Bot: 👋 Olá! Seja bem-vindo ao GastoCerto!

Para começar, preciso de algumas informações:

📝 **Qual é o seu nome completo?**
```

### Completar cadastro:

```
Você: João Silva
Bot: Ótimo, João! Agora preciso do seu e-mail.

📧 **Qual é o seu e-mail?**

Você: joao@email.com
Bot: Perfeito! Agora preciso do seu telefone.

📱 **Compartilhe seu contato** usando o botão abaixo.

[Compartilhar contato do WhatsApp]

Bot: Vou verificar se você já tem cadastro...

[Se novo usuário:]
Bot: ✅ Confirme seus dados:

👤 Nome: João Silva
📧 Email: joao@email.com
📱 Telefone: (66) 99628-5154

Está tudo correto?
✅ Digite SIM para confirmar
❌ Digite NÃO para corrigir

Você: sim
Bot: 🎉 Cadastro concluído com sucesso!

Agora você pode:
💰 Registrar despesas e receitas
📊 Ver resumos financeiros
📈 Acompanhar seus gastos

Digite "ajuda" para ver os comandos disponíveis.
```

---

## 💰 PASSO 8: TESTAR REGISTRO DE TRANSAÇÃO

### Enviar transação:

```
Você: Gastei R$ 50 no almoço
Bot: 💰 **Confirmar Transação**

📝 Descrição: almoço
💵 Valor: R$ 50,00
📂 Categoria: Alimentação
📅 Data: 14/12/2025
🏷️  Tipo: 🔴 Despesa

Está correto?
✅ Digite *SIM* para confirmar
❌ Digite *NÃO* para cancelar
```

### Confirmar:

```
Você: sim
Bot: ✅ Transação registrada com sucesso!

💵 almoço
💰 R$ 50,00

Seu saldo foi atualizado! 📊
```

---

## 📊 PASSO 9: MONITORAR LOGS

### Ver logs em tempo real:

```bash
# Logs do servidor
npm run start:dev

# Logs do banco (opcional)
docker-compose logs -f postgres

# Logs do Redis (opcional)
docker-compose logs -f redis
```

### Logs importantes:

```
# ✅ Mensagem recebida
[WhatsApp] Received message from session xyz
[Telegram] Received message from session abc

# ✅ Contexto registrado (detecta plataforma)
📝 Contexto registrado: WhatsApp [5566996285154@s.whatsapp.net] → xyz
📝 Contexto registrado: Telegram [707624962] → abc

# ✅ Roteamento
🔄 [WhatsApp] Processing queued message from 5566996285154
🔄 [Telegram] Processing message from 707624962

# ✅ Onboarding
📝 [WhatsApp] Processing onboarding message
📝 [Telegram] Processing onboarding message

# ✅ Detecção de plataforma e emissão de evento
📤 Detectada plataforma WHATSAPP para 5566996285154
📤 Detectada plataforma TELEGRAM para 707624962
📤 Onboarding reply emitted [WHATSAPP] for 5566996285154
📤 Onboarding reply emitted [TELEGRAM] for 707624962

# ✅ Resposta enviada
📤 Enviando evento whatsapp.reply para 5566996285154
📤 Enviando evento telegram.reply para 707624962
✅ Mensagem enviada com sucesso! Para: 5566996285154
✅ Mensagem enviada com sucesso! Para: 707624962
```

**Observação:** O fluxo é **idêntico** para ambas plataformas. O código detecta automaticamente via `MessageContextService` e emite o evento correto.
✅ [WhatsApp] Received message from session whatsapp-xxx
📝 Contexto registrado: WhatsApp [5566996285154] → whatsapp-xxx
🔄 [WhatsApp] Processing queued message
📝 [WhatsApp] Processing onboarding message
✅ Onboarding iniciado: 5566996285154
📤 Onboarding reply emitted for 5566996285154
📤 Sent message to 5566996285154 via WHATSAPP
```

---

## 🔍 PASSO 10: VERIFICAR BANCO DE DADOS

### Abrir Prisma Studio:

```bash
npx prisma studio
```

### Verificar dados:

1. **OnboardingSession** - Sessões de cadastro
2. **UserCache** - Usuários cadastrados
3. **TransactionConfirmation** - Confirmações pendentes
4. **AIUsageLog** - Custos de IA
5. **MessageContext** - Contextos de roteamento

---

## 🐛 TROUBLESHOOTING

### Problema: QR Code não aparece

**Solução:**
```bash
# 1. Parar servidor
Ctrl+C

# 2. Limpar sessões antigas
rm -rf sessions/*

# 3. Reiniciar
npm run start:dev

# 4. Gerar novo QR
curl http://localhost:3000/api/sessions/whatsapp/qr
```

### Problema: Bot não responde

**Verificar:**
```bash
# 1. Ver logs do servidor (buscar erros)
npm run start:dev

# 2. Verificar Redis
docker-compose ps redis

# 3. Verificar banco
docker-compose ps postgres

# 4. Ver mensagens na fila
# Acessar: http://localhost:3000/admin/queues
```

### Problema: Erro de autenticação na API

**Verificar `.env`:**
```env
GASTO_CERTO_SERVICE_ID=gastocerto-zap
GASTO_CERTO_SECRET_KEY=xxx  # Deve ser o mesmo da API
```

**Testar HMAC:**
```bash
curl -X POST http://localhost:3000/api/test-hmac \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

---

## 📱 ENDPOINTS DISPONÍVEIS

### WhatsApp:
```
GET  /api/sessions/whatsapp/qr          - Gerar QR Code
GET  /api/sessions/whatsapp/status      - Ver status da sessão
POST /api/sessions/whatsapp/disconnect  - Desconectar
POST /api/sessions/whatsapp/restart     - Reiniciar sessão
```

### Telegram:
```
POST /api/sessions/telegram/start       - Iniciar bot
GET  /api/sessions/telegram/status      - Ver status
POST /api/sessions/telegram/stop        - Parar bot
```

### Admin:
```
GET  /api/admin/stats                   - Estatísticas gerais
GET  /api/admin/users                   - Lista de usuários
GET  /api/admin/queues                  - Status das filas
GET  /api/admin/ai-usage                - Custos de IA
```

### Security:
```
GET  /api/security/settings             - Configurações de segurança
PATCH /api/security/settings            - Atualizar configurações
```

### Assistant:
```
GET  /api/assistant/stats               - Estatísticas do assistente
GET  /api/assistant/intents             - Intenções detectadas
GET  /api/assistant/cache-stats         - Performance do cache
```

---

## 📚 DOCUMENTAÇÃO ADICIONAL

- `/docs/STATUS_ATUAL.md` - Status geral do projeto
- `/docs/CHECKLIST_FINAL.md` - Checklist de funcionalidades
- `/docs/MIGRATION_IMPORTS.md` - Guia de migração
- `/docs/RAG_IMPLEMENTATION.md` - Implementação do RAG
- `/docs/FASE_*.md` - Fases de desenvolvimento

---

## 🎯 PRÓXIMOS PASSOS (Melhorias Futuras)

### ✅ Implementado (Não é mais necessário):
- ~~Implementar Telegram Handler completo~~ ✅ **JÁ IMPLEMENTADO** (Event-driven genérico)
- ~~Envio automático de respostas~~ ✅ **JÁ IMPLEMENTADO** (MessageResponseService)
- ~~Fluxo multi-plataforma~~ ✅ **JÁ IMPLEMENTADO** (Detecção automática)

### 🔮 Melhorias Futuras (Opcional):
1. **Testes Automatizados**
   - Unit tests (Jest)
   - Integration tests (Supertest)
   - E2E tests para fluxos completos

2. **Webhooks**
   - Notificações para API externa
   - Eventos de transação criada
   - Eventos de usuário cadastrado

3. **Admin Dashboard UI**
   - Interface visual para estatísticas
   - Gerenciamento de usuários
   - Monitoramento de filas

4. **Multi-idioma (i18n)**
   - Suporte para inglês, espanhol
   - Detecção automática de idioma

5. **Novos Providers de IA**
   - Claude (Anthropic)
   - Mistral AI
   - Llama via Ollama (local)

---

## 🏆 ARQUITETURA EVENT-DRIVEN GENÉRICA

### Como Funciona:

```typescript
// 1. Handler recebe mensagem (qualquer plataforma)
@OnEvent('whatsapp.message') // ou 'telegram.message'
async handleMessage(payload) {
  // Registra contexto (plataforma + sessionId)
  this.contextService.registerContext(userId, sessionId, platform);
}

// 2. Service processa (sem saber qual plataforma)
class OnboardingService {
  async handleMessage(message: IFilteredMessage) {
    // Processa mensagem...
    
    // Detecta plataforma dinamicamente
    const context = this.contextService.getContext(userId);
    const eventName = context.platform === 'TELEGRAM' 
      ? 'telegram.reply' 
      : 'whatsapp.reply';
    
    // Emite evento genérico
    this.eventEmitter.emit(eventName, { ... });
  }
}

// 3. MessageResponseService escuta AMBOS eventos
@OnEvent('whatsapp.reply')
@OnEvent('telegram.reply')
async handleReply(event) {
  // Busca contexto
  const context = this.contextService.getContext(event.platformId);
  
  // Envia via plataforma correta
  await this.multiPlatformService.sendMessage(
    context.sessionId,
    event.platformId,
    event.message,
    context.platform
  );
}
```

### Benefícios:

✅ **Código único** para todas plataformas  
✅ **Desacoplamento total** (services não conhecem plataforma)  
✅ **Fácil adicionar novas plataformas** (apenas handlers)  
✅ **Testável** (mocks de eventos)  
✅ **Escalável** (filas Bull para processamento assíncrono)

---
4. **Dashboard web com estatísticas**
5. **Suporte a múltiplas linguagens**
6. **Integração com mais providers de IA**

---

## 📞 SUPORTE

**Issues:** https://github.com/seu-usuario/gastocerto-zap/issues  
**Docs:** https://docs.gastocerto.com

---

## ✅ CHECKLIST DE INICIALIZAÇÃO

- [ ] Configurar `.env`
- [ ] Subir containers (`docker-compose up -d`)
- [ ] Instalar dependências (`npm install`)
- [ ] Rodar migrations (`npx prisma migrate dev`)
- [ ] Iniciar servidor (`npm run start:dev`)
- [ ] Conectar WhatsApp (escanear QR)
- [ ] Testar onboarding (enviar "Olá")
- [ ] Testar transação ("Gastei R$ 50")
- [ ] Verificar logs (sem erros)
- [ ] Abrir Prisma Studio (ver dados)

---

**🎉 PRONTO! Seu bot está funcionando!**
