# ✅ Checklist de Deploy - GastoCerto-ZAP

## 📦 O que está pronto:

### ✅ Dockerfile Otimizado
- Multi-stage build (dependencies → builder → production)
- Prisma generate automático
- Migrations automáticas no startup
- Usuário não-root (segurança)
- Health check configurado
- Tini como init system
- Tamanho da imagem otimizado

### ✅ Configurações no Banco de Dados
- API Keys dos providers IA no banco ✅
- AI Settings (cache, RAG, thresholds) no banco ✅
- Rate limits por provider no banco ✅
- Migrations aplicadas e testadas ✅

### ✅ Testes e Build
- 91 testes passando ✅
- 5 testes skipped (marcados para reescrita futura)
- Build TypeScript sem erros ✅
- Prisma Client gerado corretamente ✅

### ✅ Documentação
- `COOLIFY_SETUP.md` - Guia completo de deploy
- `.dockerignore` - Otimização de build
- Variáveis de ambiente documentadas

---

## 🚀 Para fazer deploy no Coolify:

### 1. No Coolify, crie os resources:
```
PostgreSQL 16  → gastocerto-zap-postgres
Redis 7        → gastocerto-zap-redis
```

### 2. Configure APENAS estas variáveis de ambiente:

**OBRIGATÓRIAS:**
```bash
DATABASE_URL="postgresql://user:pass@host:5432/gastocerto_zap?schema=public"
REDIS_URL="redis://host:6379"
GASTO_CERTO_API_URL="https://api.gastocerto.com.br/api"
SERVICE_SHARED_SECRET="seu-secret-forte"
TEST_PHONE_NUMBER="5511999999999"
NODE_ENV="production"
PORT=3000
```

**❌ NÃO configure estas (estão no banco):**
- OPENAI_API_KEY
- GOOGLE_AI_API_KEY  
- GROQ_API_KEY
- DEEPSEEK_API_KEY
- AI Settings (cache, RAG, thresholds, etc)

### 3. Deploy
- O Coolify vai usar o Dockerfile automaticamente
- Migrations rodam no startup: `prisma migrate deploy`
- Container inicia em ~30 segundos

### 4. Após o deploy, configure API keys no banco:

**Via SQL no Coolify (PostgreSQL resource):**
```sql
-- Configurar API Keys
UPDATE ai_provider_configs SET api_key = 'sk-proj-...', enabled = true WHERE provider = 'openai';
UPDATE ai_provider_configs SET api_key = 'AIza...', enabled = true WHERE provider = 'google_gemini';
UPDATE ai_provider_configs SET api_key = 'gsk_...', enabled = true WHERE provider = 'groq';

-- Verificar
SELECT provider, enabled, 
       CASE WHEN api_key IS NOT NULL THEN 'SET' ELSE 'MISSING' END as key_status
FROM ai_provider_configs;
```

### 5. Testar

```bash
# Health check
curl https://seu-dominio.com/health

# Criar sessão WhatsApp
POST https://seu-dominio.com/whatsapp
{
  "sessionId": "session-1",
  "name": "Bot Produção"
}

# Obter QR Code
GET https://seu-dominio.com/whatsapp/session-1/qr
```

---

## 🎯 O que mudou (importantes):

1. **API Keys no banco** - Não mais em variáveis de ambiente
2. **AI Settings no banco** - Cache, RAG, thresholds configuráveis em runtime
3. **Rate Limits no banco** - Por provider, atualizável sem restart
4. **Migration automática** - `prisma migrate deploy` no startup
5. **Dockerfile produção** - Multi-stage, otimizado, seguro

---

## 📊 Logs esperados no Coolify:

```
✅ Database connected successfully
✅ AICacheService configurado via BANCO
📊 Rate limits carregados do BANCO
🎯 [Registration] Configuração via BANCO: autoRegisterThreshold=0.9
🚀 GastoCerto-ZAP running on port 3000
```

---

## 🔧 Container PostgreSQL local

Seu banco está em: **Container `pg-container`**
- Host: localhost:5432
- Database: zap
- User: postgres

Para aplicar migrations localmente:
```bash
docker exec -i pg-container psql -U postgres -d zap -f migration.sql
```

---

## ✅ Status Atual

- [x] Dockerfile pronto
- [x] Migrations aplicadas
- [x] Testes passando (91/96)
- [x] Build funcionando
- [x] Aplicação rodando localmente
- [x] Documentação completa
- [x] Configurações no banco validadas

**Pronto para deploy! 🎉**

Ver [COOLIFY_SETUP.md](./COOLIFY_SETUP.md) para instruções detalhadas.
