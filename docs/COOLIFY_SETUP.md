# 🚀 Guia de Deploy no Coolify - GastoCerto-ZAP

## 📋 Pré-requisitos

1. **Conta no Coolify** com acesso ao servidor
2. **Banco PostgreSQL** (criar resource no Coolify)
3. **Redis** (criar resource no Coolify)
4. **API Keys dos Providers de IA** (configurar no banco de dados)

---

## 🗄️ Passo 1: Criar Resources no Coolify

### PostgreSQL
1. No Coolify, vá em **Resources** → **+ New Resource**
2. Selecione **PostgreSQL 16**
3. Configure:
   - **Name**: `gastocerto-zap-postgres`
   - **Database Name**: `gastocerto_zap`
   - **Username**: `gastocerto`
   - **Password**: (gerar senha forte)
4. Anote a **Connection String** gerada

### Redis
1. No Coolify, vá em **Resources** → **+ New Resource**
2. Selecione **Redis 7**
3. Configure:
   - **Name**: `gastocerto-zap-redis`
4. Anote a **Connection String** gerada

---

## 🔧 Passo 2: Configurar Variáveis de Ambiente

No Coolify, vá em **Applications** → **gastocerto-zap** → **Environment Variables**

### ✅ Variáveis OBRIGATÓRIAS

```bash
# Database (use a connection string do resource criado)
DATABASE_URL="postgresql://user:password@host:5432/gastocerto_zap?schema=public"

# Redis (use a connection string do resource criado)
REDIS_URL="redis://host:6379"

# Server
NODE_ENV="production"
PORT=3000

# Gasto Certo API
GASTO_CERTO_API_URL="https://sua-api.gastocerto.com.br/api"
SERVICE_SHARED_SECRET="seu-secret-super-forte-aqui"
GASTOCERTO_CERTO_API_SERVICE_ID="gastocerto-api"
GASTOCERTO_ZAP_SERVICE_ID="gastocerto-zap"

# Security
TEST_PHONE_NUMBER="5511999999999"  # Telefone de teste para bypass
```

### ⚙️ Variáveis OPCIONAIS (com valores padrão)

```bash
# WhatsApp Baileys
QR_TIMEOUT_MS=120000
MAX_RECONNECT_ATTEMPTS=5
RECONNECT_INTERVAL_MS=10000

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000

# Timeouts
CONFIRMATION_TIMEOUT_SECONDS=300000
ONBOARDING_TIMEOUT_MS=1800000
SERVICE_REQUEST_TIMEOUT_MS=300000

# Transaction Settings
REQUIRE_CONFIRMATION=true

# Bull Queues Concurrency
QUEUE_MESSAGES_CONCURRENCY=20
QUEUE_AI_CONCURRENCY=10
QUEUE_CONFIRMATION_CONCURRENCY=15
QUEUE_ONBOARDING_CONCURRENCY=5
QUEUE_MEDIA_CONCURRENCY=5

# Development (NUNCA use em produção!)
DEV_AUTH_BYPASS=false
```

### ❌ Variáveis que NÃO são mais necessárias

Estas configurações agora estão no **banco de dados**:

```bash
# ❌ NÃO configure estas no Coolify:
# OPENAI_API_KEY          → Configure no banco (tabela ai_provider_configs)
# GOOGLE_AI_API_KEY       → Configure no banco (tabela ai_provider_configs)
# GROQ_API_KEY           → Configure no banco (tabela ai_provider_configs)
# DEEPSEEK_API_KEY       → Configure no banco (tabela ai_provider_configs)

# ❌ Configurações de AI também estão no banco:
# - textProvider, imageProvider, audioProvider
# - cacheEnabled, cacheTTL
# - ragEnabled, ragThreshold
# - autoRegisterThreshold, minConfidenceThreshold
```

---

## 🎯 Passo 3: Configurar AI Providers no Banco

Após o primeiro deploy, você precisa configurar as API keys no banco de dados.

### Opção 1: Via Prisma Studio (Recomendado)

```bash
# No terminal do Coolify ou localmente:
npx prisma studio
```

1. Abra a tabela `AIProviderConfig`
2. Para cada provider que você quer usar:
   - Insira a `apiKey`
   - Marque `enabled = true`
   - Configure `priority` (menor = maior prioridade)

### Opção 2: Via SQL

Conecte no PostgreSQL e execute:

```sql
-- Configurar OpenAI
UPDATE ai_provider_configs 
SET api_key = 'sk-proj-...', enabled = true 
WHERE provider = 'openai';

-- Configurar Google Gemini
UPDATE ai_provider_configs 
SET api_key = 'AIza...', enabled = true 
WHERE provider = 'google_gemini';

-- Configurar Groq (GRÁTIS)
UPDATE ai_provider_configs 
SET api_key = 'gsk_...', enabled = true 
WHERE provider = 'groq';

-- Configurar DeepSeek
UPDATE ai_provider_configs 
SET api_key = 'sk-...', enabled = true 
WHERE provider = 'deepseek';

-- Verificar configuração
SELECT provider, display_name, enabled, 
       CASE WHEN api_key IS NOT NULL THEN '***' ELSE 'NOT SET' END as key_status,
       rpm_limit, tpm_limit, priority
FROM ai_provider_configs 
ORDER BY priority;
```

---

## 📊 Passo 4: Configurar AI Settings

As configurações gerais de IA também estão no banco:

```sql
-- Ver configuração atual
SELECT * FROM ai_settings;

-- Atualizar providers preferenciais
UPDATE ai_settings SET
  text_provider = 'groq',              -- Para mensagens de texto
  image_provider = 'google_gemini',    -- Para análise de imagens
  audio_provider = 'groq',             -- Para transcrição de áudio
  category_provider = 'groq';          -- Para sugestão de categorias

-- Configurar cache
UPDATE ai_settings SET
  cache_enabled = true,
  cache_ttl = 3600;  -- 1 hora

-- Configurar RAG (busca semântica)
UPDATE ai_settings SET
  rag_enabled = true,
  rag_threshold = 0.6;

-- Configurar thresholds de transações
UPDATE ai_settings SET
  auto_register_threshold = 0.90,   -- Auto-registra se confiança >= 90%
  min_confidence_threshold = 0.50;  -- Rejeita se confiança < 50%
```

---

## 🚀 Passo 5: Deploy

1. No Coolify, conecte seu repositório Git
2. Configure:
   - **Build Pack**: Dockerfile
   - **Dockerfile Path**: `./Dockerfile`
   - **Port**: `3000`
3. Clique em **Deploy**

O Dockerfile já está configurado para:
- ✅ Executar `prisma migrate deploy` automaticamente
- ✅ Gerar Prisma Client
- ✅ Rodar com usuário não-root (segurança)
- ✅ Health check configurado
- ✅ Multi-stage build otimizado

---

## 🔍 Passo 6: Verificar Deploy

### Health Check

```bash
curl https://seu-dominio.com.br/health
```

Deve retornar:
```json
{
  "status": "ok",
  "timestamp": "2025-12-16T...",
  "uptime": 123.45
}
```

### Verificar Logs

No Coolify, vá em **Logs** e procure por:

```
✅ Database connected successfully
✅ AICacheService configurado via BANCO
📊 Rate limits carregados do BANCO
🚀 GastoCerto-ZAP running on port 3000
```

### Verificar Configurações

```bash
# Conectar no terminal do container
curl http://localhost:3000/admin/ai-providers

# Ou via SQL no Coolify
# Conecte no resource PostgreSQL e execute:
SELECT provider, enabled, 
       CASE WHEN api_key IS NOT NULL THEN 'CONFIGURED' ELSE 'MISSING' END 
FROM ai_provider_configs;
```

---

## 📱 Passo 7: Conectar WhatsApp

1. Crie uma sessão via API:
```bash
POST https://seu-dominio.com.br/whatsapp
{
  "sessionId": "session-1",
  "name": "Bot GastoCerto"
}
```

2. Obtenha o QR Code:
```bash
GET https://seu-dominio.com.br/whatsapp/session-1/qr
```

3. Escaneie o QR Code com WhatsApp

---

## ⚠️ Troubleshooting

### Erro: "API Key não configurada"

Configure as API keys no banco conforme Passo 3.

### Erro: "Could not connect to database"

Verifique a `DATABASE_URL` e se o resource PostgreSQL está rodando.

### Erro: "Could not connect to Redis"

Verifique a `REDIS_URL` e se o resource Redis está rodando.

### WhatsApp desconecta com erro 515

- **Causa**: Ban temporário do WhatsApp (2-24 horas)
- **Solução Automática**: O sistema agora reconecta automaticamente com backoff exponencial (5min, 10min, 15min...) até 10 tentativas. As credenciais são preservadas automaticamente.
- **Comportamento**: A sessão permanece em memória e tenta reconectar periodicamente sem precisar escanear o QR code novamente.
- **Prevenção**: Evite múltiplas conexões simultâneas do mesmo número.

### Migrations não aplicadas

Execute manualmente:
```bash
# No terminal do container Coolify
npx prisma migrate deploy
```

---

## 📈 Monitoramento

### Endpoints úteis:

- **Health**: `GET /health`
- **AI Providers**: `GET /admin/ai-providers`
- **AI Settings**: `GET /admin/ai-settings`
- **Sessões ativas**: `GET /whatsapp/active/list`
- **Estatísticas**: `GET /whatsapp/stats/summary`

---

## 🔐 Segurança

### Checklist de Segurança:

- ✅ `DEV_AUTH_BYPASS=false` em produção
- ✅ `SERVICE_SHARED_SECRET` é forte e único
- ✅ Conexões com SSL (`postgresql://...?sslmode=require`)
- ✅ API keys no banco, não em variáveis de ambiente
- ✅ Rate limiting configurado
- ✅ Dockerfile roda com usuário não-root
- ✅ Health check configurado para auto-restart

---

## 📚 Recursos Adicionais

- **Documentação Completa**: Ver `README.md`
- **Onboarding**: Ver `docs/ONBOARDING.md`
- **AI Config**: Ver `docs/AI_CONFIG_GUIDE.md`
- **RAG System**: Ver `docs/RAG_IMPLEMENTATION.md`

---

## ✅ Checklist de Deploy

- [ ] PostgreSQL resource criado
- [ ] Redis resource criado
- [ ] Variáveis de ambiente configuradas
- [ ] Primeiro deploy realizado
- [ ] Migrations aplicadas automaticamente
- [ ] AI Providers configurados no banco
- [ ] AI Settings ajustados
- [ ] Health check respondendo
- [ ] Logs sem erros
- [ ] WhatsApp conectado e testado

🎉 **Pronto! Seu bot está no ar!**
