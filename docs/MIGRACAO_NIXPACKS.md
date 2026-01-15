# 🔄 Migração Docker → Nixpacks

Guia rápido de migração do deploy Docker para Nixpacks no Coolify.

---

## ✅ Checklist de Preparação

### 1. Arquivos Criados

- ✅ `nixpacks.toml` - Configuração customizada do Nixpacks
- ✅ `.nvmrc` - Define versão do Node.js (20)
- ✅ `docs/NIXPACKS_DEPLOY.md` - Documentação completa

### 2. Código Ajustado

- ✅ `main.ts` - Listen em `0.0.0.0` para aceitar conexões externas
- ✅ `package.json` - Scripts `build` e `start:prod` corretos
- ✅ Graceful shutdown implementado

### 3. Arquivos Docker (Opcional)

Você pode manter ou remover:
- `Dockerfile` - Não será usado com Nixpacks
- `docker-compose.yml` - Útil para desenvolvimento local
- `.dockerignore` - Não interfere com Nixpacks

**Recomendação**: Mantenha para quem preferir usar Docker.

---

## 🚀 Passos da Migração no Coolify

### 1. Backup Atual

Antes de qualquer mudança:

1. **Exporte variáveis de ambiente** atuais do Coolify
2. **Anote a URL** do banco e Redis
3. **Backup das sessões WhatsApp** (se tiver volume)

### 2. Configurar Nova Aplicação

#### Opção A: Editar Aplicação Existente

1. Vá em **Settings** → **Build**
2. Mude `Build Method` de `Dockerfile` para `Nixpacks`
3. Salve as alterações

#### Opção B: Criar Nova Aplicação (Recomendado para teste)

1. Crie nova aplicação no Coolify
2. Selecione `Nixpacks` como Build Method
3. Configure variáveis de ambiente
4. Teste antes de remover a antiga

### 3. Variáveis de Ambiente

Cole as mesmas variáveis que tinha antes:

```bash
# Database
DATABASE_URL=postgresql://...

# Redis  
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...

# API
GASTO_CERTO_API_URL=...
GASTO_CERTO_API_KEY=...

# JWT
JWT_SECRET=...

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...

# WhatsApp
ENABLE_WHATSAPP=true
WHATSAPP_SESSION_PATH=/app/.sessions

# AI Providers
OPENAI_API_KEY=...
GROQ_API_KEY=...
# etc...
```

### 4. Volumes Persistentes

Configure o mesmo volume para sessões WhatsApp:

```
Source: /data/whatsapp-sessions
Destination: /app/.sessions
```

### 5. Deploy

1. Clique em **Deploy**
2. Monitore os logs do build
3. Aguarde ~2-3 minutos
4. Verifique health check

---

## 🔍 Validação

### 1. Health Check

```bash
curl https://zap.hlg.gastocerto.com.br/admin/health
```

Deve retornar:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-15T...",
  "whatsapp": {
    "total": 1,
    "active": 1,
    "connected": 1
  }
}
```

### 2. Logs da Aplicação

No Coolify, verifique:
```
✅ Application started successfully
✅ Database connected
✅ Redis connected
✅ WhatsApp initialized
```

### 3. Teste de Funcionalidade

1. Envie mensagem no WhatsApp
2. Verifique processamento da transação
3. Consulte endpoint de estatísticas

---

## 📊 Diferenças Esperadas

| Aspecto | Docker | Nixpacks |
|---------|--------|----------|
| **Build Time** | ~5 min | ~2 min |
| **Image Size** | ~500MB | ~200MB |
| **Startup Time** | ~10s | ~5s |
| **Memory Usage** | ~400MB | ~300MB |
| **Cache** | Precisa configurar | Automático |

---

## 🐛 Troubleshooting

### Build Falha

**Erro**: `Cannot find module '@nestjs/...'`

**Solução**:
```bash
# Local
rm -rf node_modules package-lock.json
npm install
npm run build

# Se funcionar local, push e tente novamente
```

### App Não Responde

**Erro**: `Port 3000 is not accessible`

**Solução**: Verifique que `main.ts` tem:
```typescript
await app.listen(port, '0.0.0.0');
```

### Prisma Error

**Erro**: `Cannot find Prisma Client`

**Solução**: `nixpacks.toml` já tem `npx prisma generate`

Se persistir, adicione no `package.json`:
```json
"scripts": {
  "postinstall": "prisma generate"
}
```

### Sessões WhatsApp Perdidas

**Solução**: Certifique-se que o volume está configurado corretamente:
- Source: caminho no host
- Destination: `/app/.sessions`

---

## 🎯 Rollback (Se Necessário)

Se algo der errado:

1. **Com aplicação antiga**: Apenas volte a usar ela
2. **Sem backup**: Crie nova aplicação com `Dockerfile`
3. **Emergency**: Use branch anterior no Git

---

## 💡 Dicas

1. **Primeiro deploy**: Faça em horário de baixo uso
2. **Monitore**: Fique de olho nos logs nas primeiras horas
3. **Teste gradual**: Use feature flags se possível
4. **Backup**: Mantenha backup do DB antes de migrar

---

## 📈 Benefícios Esperados

- ✅ **Build 2x mais rápido**
- ✅ **Container 60% menor**
- ✅ **Menos uso de CPU/memória**
- ✅ **Zero manutenção do Dockerfile**
- ✅ **Cache automático de dependências**
- ✅ **Deploy mais confiável**

---

## 🔗 Recursos

- [Documentação Completa](./NIXPACKS_DEPLOY.md)
- [Nixpacks.com](https://nixpacks.com)
- [Coolify Docs](https://coolify.io/docs)

---

**Pronto para migrar? Siga o checklist acima! 🚀**
