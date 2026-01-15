# 🚀 Deploy com Nixpacks no Coolify

Nixpacks é uma alternativa moderna ao Docker que detecta automaticamente seu projeto e cria builds otimizados. É mais leve e não requer Dockerfile.

---

## 📋 O que é Nixpacks?

- **Auto-detecção**: Identifica automaticamente Node.js, NestJS, etc
- **Build otimizado**: Cria containers menores e mais eficientes
- **Sem Dockerfile**: Não precisa manter Dockerfile manualmente
- **Cache inteligente**: Reutiliza dependências entre builds
- **Menor uso de recursos**: Containers mais leves que Docker tradicional

---

## 🔧 Configuração no Coolify

### Passo 1: Criar Aplicação

1. No Coolify, clique em **"New Resource"** → **"Application"**
2. Conecte seu repositório Git
3. Selecione a branch (ex: `main` ou `dev`)

### Passo 2: Configurar Build Method

Na aba **"Build"** ou **"General"**:

```
Build Method: Nixpacks
```

O Coolify automaticamente detectará:
- `package.json` → Node.js
- Versão do Node via `.nvmrc` ou `engines` no package.json
- Scripts de build e start

### Passo 3: Configurar Build Settings

```yaml
Build Directory: ./
Port: 3000 ou 4444
```

**Importante**: Nixpacks usa a porta definida no seu código. Certifique-se que `main.ts` usa a variável `PORT`:

```typescript
const port = process.env.PORT || 3000;
await app.listen(port, '0.0.0.0');
```

### Passo 4: Variáveis de Ambiente

Adicione as mesmas variáveis que usava antes:

#### **Essenciais**

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# API GastoCerto
GASTO_CERTO_API_URL=https://api.gastocerto.com.br
GASTO_CERTO_API_KEY=your-api-key

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

# WhatsApp
ENABLE_WHATSAPP=true
WHATSAPP_SESSION_PATH=/app/.sessions

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
```

#### **Opcionais**

```bash
# Node.js
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo

# Logging
LOG_LEVEL=info

# AI Providers
OPENAI_API_KEY=your-key
GROQ_API_KEY=your-key
GOOGLE_GEMINI_API_KEY=your-key
DEEPSEEK_API_KEY=your-key
```

---

## 📦 Configuração Adicional (Opcional)

### nixpacks.toml

Se precisar customizar o build, crie um arquivo `nixpacks.toml` na raiz do projeto:

```toml
[phases.setup]
nixPkgs = ["nodejs_20", "yarn"]

[phases.install]
cmds = ["yarn install --frozen-lockfile"]

[phases.build]
cmds = ["yarn build"]

[start]
cmd = "node dist/main.js"
```

### package.json Scripts

Certifique-se que seu `package.json` tem os scripts necessários:

```json
{
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:prod": "node dist/main.js"
  }
}
```

---

## 🔄 Persistência de Dados

### Sessões WhatsApp

Para manter as sessões WhatsApp entre deploys, configure um **Volume Persistente**:

No Coolify, aba **"Storages"** ou **"Volumes"**:

```
Source: /data/whatsapp-sessions
Destination: /app/.sessions
```

Isso garante que as sessões não sejam perdidas no redeploy.

### PostgreSQL e Redis

Use serviços gerenciados ou containers separados:

#### Opção 1: Serviços Gerenciados (Recomendado)

```bash
# PostgreSQL
DATABASE_URL=postgres://user:pass@external-db.com:5432/db

# Redis  
REDIS_HOST=external-redis.com
REDIS_PORT=6379
```

#### Opção 2: Containers no Coolify

1. Crie um **PostgreSQL** resource no Coolify
2. Crie um **Redis** resource no Coolify
3. Use os hostnames internos nas variáveis de ambiente

---

## 🚀 Deploy

### Deploy Manual

1. No Coolify, vá em **"Deployments"**
2. Clique em **"Deploy"**
3. Aguarde o build (1-3 minutos)

### Deploy Automático

Configure **Webhook** do Git:

1. No Coolify, copie a **Webhook URL**
2. No GitHub/GitLab:
   - Settings → Webhooks
   - Cole a URL
   - Selecione eventos: `push` na branch principal

Agora cada push dispara deploy automático!

---

## 🔍 Verificar Status

### Logs em Tempo Real

No Coolify, aba **"Logs"**:
- Build logs
- Application logs
- Container status

### Health Check

Configure health check no Coolify:

```
Health Check Path: /health
Health Check Interval: 30s
```

Seu endpoint `/admin/health` deve responder:

```json
{
  "status": "healthy",
  "timestamp": "2026-01-15T...",
  "whatsapp": { ... },
  "telegram": { ... }
}
```

---

## ⚙️ Configurações Avançadas

### Graceful Shutdown

Certifique-se que seu `main.ts` tem:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilita graceful shutdown
  app.enableShutdownHooks();
  
  // Listener para SIGTERM (Coolify usa isso)
  process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, closing application...');
    await app.close();
  });
  
  await app.listen(port, '0.0.0.0');
}
```

### Zero Downtime

No Coolify, configure:

```
Deployment Strategy: Rolling
Health Check Grace Period: 30s
```

---

## 🐛 Troubleshooting

### Build Falha

**Erro**: `Cannot find module`

**Solução**: Verifique `package.json` e rode localmente:
```bash
npm install
npm run build
```

### App Não Inicia

**Erro**: `Port already in use`

**Solução**: Use variável `PORT` do ambiente:
```typescript
const port = process.env.PORT || 3000;
```

### Sessões WhatsApp Perdidas

**Solução**: Configure volume persistente (veja seção Persistência)

### Erro de Conexão DB

**Solução**: Verifique:
1. `DATABASE_URL` está correto
2. PostgreSQL está acessível
3. Firewall permite conexão

---

## 📊 Comparação: Nixpacks vs Docker

| Recurso | Nixpacks | Docker |
|---------|----------|--------|
| **Setup** | Zero config | Precisa Dockerfile |
| **Build Time** | 1-2 min | 3-5 min |
| **Image Size** | ~200MB | ~500MB |
| **Cache** | Automático | Manual |
| **Manutenção** | Baixa | Alta |
| **Flexibilidade** | Média | Alta |

---

## 🎯 Próximos Passos

1. ✅ Push seu código para Git
2. ✅ Configure aplicação no Coolify com Nixpacks
3. ✅ Adicione variáveis de ambiente
4. ✅ Configure volumes para sessões WhatsApp
5. ✅ Faça primeiro deploy
6. ✅ Configure webhook para deploy automático

---

## 📚 Recursos

- [Nixpacks Docs](https://nixpacks.com)
- [Coolify Docs](https://coolify.io/docs)
- [NestJS Production](https://docs.nestjs.com/faq/serverless)

---

## 💡 Dicas

1. **Primeiro deploy**: Sempre teste localmente antes
2. **Logs**: Monitore logs durante primeiro deploy
3. **Health checks**: Implemente endpoints de saúde
4. **Backups**: Configure backup automático do banco
5. **Monitoramento**: Use ferramentas como Sentry/LogRocket

---

## 🔐 Segurança

- ✅ Use variáveis de ambiente para segredos
- ✅ Nunca commite `.env` no Git
- ✅ Rotacione senhas regularmente
- ✅ Configure HTTPS (Coolify faz automaticamente)
- ✅ Use JWT_SECRET forte (min 32 caracteres)

---

**Sucesso! 🎉** Seu app NestJS está rodando no Coolify com Nixpacks!
