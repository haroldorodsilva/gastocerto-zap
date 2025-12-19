# 🚀 Deploy no Coolify - GastoCerto Zap

Guia completo para deploy da aplicação **GastoCerto-Zap** no Coolify usando Dockerfile com banco de dados PostgreSQL e Redis externos.

---

## 📋 Pré-requisitos

1. **Coolify instalado** e configurado
2. **Banco de dados PostgreSQL externo** (pode ser outro container no Coolify ou serviço externo)
3. **Redis externo** (pode ser outro container no Coolify ou serviço externo)
4. **Repositório Git** com o código

---

## 🏗️ Arquitetura do Deploy

```
┌─────────────────────────────────────────────┐
│            Coolify Platform                  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │   GastoCerto-Zap (Docker)            │  │
│  │   - NestJS App                       │  │
│  │   - Port: 3000                       │  │
│  └──────────────┬───────────────────────┘  │
│                 │                            │
│                 ├───────────────────┐        │
│                 ↓                   ↓        │
│  ┌──────────────────────┐  ┌──────────────┐│
│  │  PostgreSQL          │  │  Redis       ││
│  │  (External)          │  │  (External)  ││
│  │  Port: 5432          │  │  Port: 6379  ││
│  └──────────────────────┘  └──────────────┘│
└─────────────────────────────────────────────┘
```

---

## 🔧 Passo 1: Criar Recursos Externos

### 1.1 PostgreSQL

No Coolify, crie um novo recurso PostgreSQL:

```
Nome: gastocerto-zap-db
Database: gastocerto_zap
User: gastocerto
Password: [gerar senha forte]
Port: 5432 (interno)
```

**Connection String gerada:**
```
postgresql://gastocerto:PASSWORD@gastocerto-zap-db:5432/gastocerto_zap
```

### 1.2 Redis

No Coolify, crie um novo recurso Redis:

```
Nome: gastocerto-zap-redis
Port: 6379 (interno)
Password: [gerar senha forte - opcional]
```

**Connection String gerada:**
```
redis://:PASSWORD@gastocerto-zap-redis:6379
```

---

## 🚢 Passo 2: Criar Aplicação no Coolify

### 2.1 Novo Recurso

1. No Coolify, clique em **"New Resource"**
2. Selecione **"Application"**
3. Escolha o tipo: **"Public Repository"** ou **"Private Repository"**
4. Cole a URL do repositório Git

### 2.2 Configurações de Build

```yaml
Build Type: Dockerfile
Dockerfile Location: ./Dockerfile
Build Command: (deixe vazio - Dockerfile cuida do build)
Start Command: (deixe vazio - Dockerfile define o CMD)
Port: 3000
```

### 2.3 Variáveis de Ambiente

Adicione as seguintes variáveis no Coolify:

#### **Essenciais**

```bash
# Database (⚠️ Use o hostname interno do Coolify)
DATABASE_URL=postgresql://gastocerto:PASSWORD@gastocerto-zap-db:5432/gastocerto_zap

# Redis (⚠️ Use o hostname interno do Coolify)
REDIS_URL=redis://:PASSWORD@gastocerto-zap-redis:6379

# Server
NODE_ENV=production
PORT=3000

# Gasto Certo API
GASTO_CERTO_API_URL=https://api.gastocerto.com.br/api
SERVICE_SHARED_SECRET=seu-secret-aqui
GASTOCERTO_CERTO_API_SERVICE_ID=gastocerto-api
GASTOCERTO_ZAP_SERVICE_ID=gastocerto-zap
SERVICE_REQUEST_TIMEOUT_MS=300000

# Security
TEST_PHONE_NUMBER=seu-telefone-de-teste
```

#### **WhatsApp/Baileys**

```bash
QR_TIMEOUT_MS=120000
MAX_RECONNECT_ATTEMPTS=5
RECONNECT_INTERVAL_MS=10000
```

#### **Confirmações & Onboarding**

```bash
CONFIRMATION_TIMEOUT_SECONDS=300000
ONBOARDING_TIMEOUT_MS=1800000
REQUIRE_CONFIRMATION=true
AUTO_REGISTER_THRESHOLD=0.80
MIN_CONFIDENCE_THRESHOLD=0.50
```

#### **Rate Limiting**

```bash
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
```

#### **Queues Concurrency**

```bash
QUEUE_MESSAGES_CONCURRENCY=20
QUEUE_AI_CONCURRENCY=10
QUEUE_CONFIRMATION_CONCURRENCY=15
QUEUE_ONBOARDING_CONCURRENCY=5
QUEUE_MEDIA_CONCURRENCY=5
```

#### **AI Provider Keys (OPCIONAL - Configure no banco)**

⚠️ **Recomendado:** Configure as API keys diretamente no banco de dados (ver seção abaixo).

Se quiser usar como fallback para desenvolvimento:

```bash
OPENAI_API_KEY=sk-proj-...
GOOGLE_AI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
```

---

## 🗄️ Passo 3: Configurar Banco de Dados

### 3.1 Rodar Migrations

Após o primeiro deploy, execute as migrations:

**Opção 1: Via Build Command no Coolify**

Configure o **Build Command** no Coolify:
```bash
npm run build && npx prisma migrate deploy
```

**Opção 2: Via Terminal do Container**

No Coolify, abra o terminal do container e execute:
```bash
npx prisma migrate deploy
```

### 3.2 Seed Configurações de AI (AIProviderConfig)

Execute no banco de dados ou via Prisma Studio:

```sql
-- OpenAI
INSERT INTO ai_provider_configs (
  id, provider, display_name, enabled, api_key, 
  text_model, vision_model, audio_model,
  supports_vision, supports_audio, 
  priority, input_cost_per1_m, output_cost_per1_m
) VALUES (
  gen_random_uuid(), 
  'openai', 
  'OpenAI GPT', 
  true, 
  'sk-proj-SUA-KEY-AQUI',
  'gpt-4o-mini', 
  'gpt-4o', 
  'whisper-1',
  true, 
  true,
  2, 
  0.150, 
  0.600
);

-- Google Gemini (RECOMENDADO para imagens - 80% mais barato)
INSERT INTO ai_provider_configs (
  id, provider, display_name, enabled, api_key,
  text_model, vision_model,
  supports_vision, supports_audio,
  priority, input_cost_per1_m, output_cost_per1_m
) VALUES (
  gen_random_uuid(),
  'google_gemini',
  'Google Gemini',
  true,
  'AIzaSUA-KEY-AQUI',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  true,
  false,
  1,
  0.075,
  0.300
);

-- Groq (GRÁTIS para áudio)
INSERT INTO ai_provider_configs (
  id, provider, display_name, enabled, api_key,
  text_model, audio_model,
  supports_vision, supports_audio,
  priority, input_cost_per1_m, output_cost_per1_m
) VALUES (
  gen_random_uuid(),
  'groq',
  'Groq',
  true,
  'gsk_SUA-KEY-AQUI',
  'llama-3.1-70b-versatile',
  'whisper-large-v3',
  false,
  true,
  1,
  0.000,
  0.000
);

-- DeepSeek (Mais barato para texto)
INSERT INTO ai_provider_configs (
  id, provider, display_name, enabled, api_key,
  text_model, base_url,
  supports_vision, supports_audio,
  priority, input_cost_per1_m, output_cost_per1_m
) VALUES (
  gen_random_uuid(),
  'deepseek',
  'DeepSeek',
  true,
  'sk-SUA-KEY-AQUI',
  'deepseek-chat',
  'https://api.deepseek.com',
  false,
  false,
  3,
  0.280,
  0.420
);
```

### 3.3 Configurar AISettings

```sql
INSERT INTO ai_settings (
  id,
  text_provider,
  image_provider,
  audio_provider,
  category_provider,
  fallback_enabled,
  cache_enabled,
  cache_ttl,
  rag_enabled,
  rag_ai_enabled,
  rag_ai_provider,
  rag_threshold
) VALUES (
  gen_random_uuid(),
  'groq',           -- Texto: Groq (grátis)
  'google_gemini',  -- Imagem: Gemini (80% mais barato)
  'groq',           -- Áudio: Groq (grátis)
  'groq',           -- Categoria: Groq (grátis)
  true,             -- Fallback ativado
  true,             -- Cache ativado
  86400,            -- 24 horas
  true,             -- RAG ativado
  false,            -- RAG usa BM25 (sem IA)
  'groq',           -- Se ativar RAG com IA
  0.6               -- Threshold 60%
);
```

---

## 🔒 Passo 4: Configurar Health Check

No Coolify, configure o Health Check:

```yaml
Path: /health
Port: 3000
Interval: 30s
Timeout: 10s
Start Period: 40s
Retries: 3
```

---

## 🌐 Passo 5: Configurar Domínio (Opcional)

1. No Coolify, vá em **Domains**
2. Adicione seu domínio: `zap.gastocerto.com.br`
3. O Coolify vai gerar automaticamente certificado SSL via Let's Encrypt

---

## 📊 Passo 6: Monitoramento

### Logs

No Coolify, acesse a aba **Logs** para ver os logs em tempo real:

```bash
# Logs de sucesso ao iniciar:
✅ OpenAI Provider inicializado via BANCO - Modelo: gpt-4o-mini
✅ Google Gemini Provider inicializado via BANCO - Modelo: gemini-1.5-flash
✅ Groq Provider inicializado via BANCO - Modelo: llama-3.1-70b-versatile
✅ Nest application successfully started
```

### Prisma Studio

Para visualizar/editar dados:

```bash
# No terminal do container:
npx prisma studio --browser none
```

Depois configure port forwarding no Coolify para acessar o Prisma Studio.

---

## 🔄 Passo 7: CI/CD Automático

O Coolify detecta automaticamente pushes no repositório Git.

### Configurar Webhook (Opcional)

1. No Coolify, copie a **Webhook URL**
2. No GitHub/GitLab, adicione webhook:
   - URL: `https://coolify.seu-dominio.com/webhooks/...`
   - Events: `push`, `tag`

### Deploy Automático

```bash
# Push para main = deploy automático
git push origin main

# Tag = deploy de versão
git tag v1.0.0
git push origin v1.0.0
```

---

## 🐛 Troubleshooting

### Container não inicia

```bash
# Ver logs no Coolify
# Verificar se DATABASE_URL e REDIS_URL estão corretos
# Confirmar que migrations rodaram
```

### Erro de conexão com banco

```bash
# Verificar hostname interno do Coolify
# Exemplo: gastocerto-zap-db ao invés de localhost
# Testar conexão:
psql $DATABASE_URL
```

### Providers usando ENV ao invés do banco

```bash
# Logs mostram:
⚠️  OpenAI usando ENV (configure no banco para produção)

# Solução: Inserir API keys no banco (ver Passo 3.2)
```

### Rate Limit / Timeout

```bash
# Ajustar concurrency das queues:
QUEUE_AI_CONCURRENCY=5  # Reduzir se tiver rate limit
```

---

## 🚀 Deploy Completo - Checklist

- [ ] PostgreSQL externo criado
- [ ] Redis externo criado
- [ ] Aplicação criada no Coolify
- [ ] Variáveis de ambiente configuradas
- [ ] Dockerfile detectado corretamente
- [ ] Build concluído com sucesso
- [ ] Migrations executadas (`prisma migrate deploy`)
- [ ] AIProviderConfig populado com API keys
- [ ] AISettings configurado
- [ ] Health check respondendo
- [ ] Logs sem erros
- [ ] Domínio configurado (opcional)
- [ ] Webhook GitHub/GitLab configurado (opcional)

---

## 📞 Suporte

- Logs: Coolify Dashboard → Logs
- Database: Coolify Dashboard → Terminal → `npx prisma studio`
- Restart: Coolify Dashboard → Restart

---

## 🔐 Segurança

### ⚠️ Produção - Checklist Segurança

- [ ] `NODE_ENV=production`
- [ ] `DEV_AUTH_BYPASS=false` (ou remover)
- [ ] API keys no banco de dados, NÃO em ENV
- [ ] Senhas fortes para PostgreSQL e Redis
- [ ] Usar rede privada do Coolify para comunicação interna
- [ ] SSL/TLS habilitado (Let's Encrypt automático)
- [ ] Rate limiting configurado
- [ ] Backups automáticos do banco
- [ ] Monitoramento de logs (alertas de erros)

---

**Deploy finalizado! 🎉**

A aplicação deve estar rodando em:
- Local: `http://localhost:3000`
- Produção: `https://zap.gastocerto.com.br`
