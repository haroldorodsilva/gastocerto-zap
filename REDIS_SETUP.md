# 🔴 Redis Setup para Produção

## Problema

A aplicação requer Redis para:
- ✅ Cache de respostas de IA
- ✅ Rate limiting
- ✅ Filas de processamento (Bull)

Erro no deploy:
```
Redis Connection Error: ECONNREFUSED 127.0.0.1:6379
```

---

## ✅ Solução 1: Upstash Redis (RECOMENDADO - Grátis)

### Passo 1: Criar conta no Upstash

1. Acesse: https://upstash.com/
2. Crie conta gratuita (10,000 comandos/dia grátis)
3. Clique em **Create Database**
4. Configure:
   - **Name**: `gastocerto-zap-redis`
   - **Type**: Regional
   - **Region**: `sa-east-1` (São Paulo) - mais próximo do Neon
   - **TLS**: Enabled

### Passo 2: Copiar credenciais

Na página do database, copie a **Connection String**:
```
redis://default:SENHA_AQUI@us1-brave-example-12345.upstash.io:6379
```

### Passo 3: Adicionar no Coolify

1. Vá em **Environment Variables**
2. Adicione:
```bash
REDIS_URL=redis://default:SENHA@us1-brave-example-12345.upstash.io:6379
```

### Passo 4: Redeploy

Clique em **Redeploy** no Coolify.

---

## ✅ Solução 2: Redis no Coolify

### Passo 1: Criar Redis Resource

1. No Coolify, vá em **Resources** → **+ New**
2. Selecione **Redis**
3. Configure:
   - **Name**: `gastocerto-zap-redis`
   - **Version**: `7-alpine`
   - **Password**: Gere uma senha forte

### Passo 2: Conectar ao Redis

O Coolify vai criar uma network interna. Use o nome do serviço:

```bash
REDIS_URL=redis://:SENHA@gastocerto-zap-redis:6379
```

**⚠️ Importante**: O Redis precisa estar na mesma **Network** que a aplicação.

### Passo 3: Configurar Network

1. Vá em **Application** → **gastocerto-zap** → **Network**
2. Adicione o Redis na mesma network
3. Anote o nome interno do Redis (ex: `gastocerto-zap-redis`)

### Passo 4: Atualizar variável

```bash
REDIS_URL=redis://:SUA_SENHA@gastocerto-zap-redis:6379
```

---

## ✅ Solução 3: Redis.io Cloud (Grátis até 30MB)

### Passo 1: Criar conta

1. Acesse: https://redis.io/try-free/
2. Crie conta gratuita
3. Crie um novo database:
   - **Cloud**: AWS
   - **Region**: `sa-east-1` (São Paulo)
   - **Plan**: Free (30MB)

### Passo 2: Configurar

Copie as credenciais fornecidas:

```bash
REDIS_URL=redis://default:SENHA@redis-12345.c1.us-east-1-2.ec2.redns.redis-cloud.com:12345
```

---

## 🧪 Testar Conexão

Após configurar, teste a conexão:

### Localmente:
```bash
# Instalar redis-cli
brew install redis  # macOS
apt install redis-tools  # Linux

# Testar
redis-cli -u "redis://default:SENHA@host:port" ping
# Deve retornar: PONG
```

### No container:
```bash
# Ver logs do container
docker logs <container-id>

# Deve mostrar:
# ✅ Redis conectado com sucesso
```

---

## 📊 Comparação de Opções

| Opção | Custo | Latência | Complexidade | Recomendação |
|-------|-------|----------|--------------|--------------|
| **Upstash** | Grátis (10k/dia) | Baixa (AWS SA-EAST-1) | Muito fácil | ⭐⭐⭐⭐⭐ |
| **Coolify Redis** | Grátis (seu servidor) | Muito baixa (local) | Média | ⭐⭐⭐⭐ |
| **Redis.io Cloud** | Grátis (30MB) | Média | Fácil | ⭐⭐⭐ |

---

## ⚙️ Variáveis de Ambiente Completas

Depois de configurar o Redis, suas variáveis devem estar assim:

```bash
# Database (Neon)
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require"

# Redis (Upstash ou outro)
REDIS_URL="redis://default:SENHA@host:6379"

# API
GASTO_CERTO_API_URL="https://gastocerto-api-hlg.onrender.com/api"
SERVICE_SHARED_SECRET="seu-secret"

# Node
NODE_ENV="production"
PORT="3000"
```

---

## 🐛 Troubleshooting

### Erro: ECONNREFUSED

**Causa**: Redis não acessível

**Solução**:
1. Verifique se a `REDIS_URL` está correta
2. Teste conexão com `redis-cli`
3. Verifique firewall/security groups

### Erro: WRONGPASS

**Causa**: Senha incorreta

**Solução**:
1. Verifique a senha na `REDIS_URL`
2. Formato: `redis://:SENHA@host:port` (note o `:` antes da senha)
3. Ou: `redis://default:SENHA@host:port`

### Erro: Connection timeout

**Causa**: Redis não responde

**Solução**:
1. Verifique se o Redis está rodando
2. Teste ping: `redis-cli -u URL ping`
3. Verifique se a porta está aberta

---

## 📚 Referências

- **Upstash**: https://upstash.com/docs/redis
- **Redis Cloud**: https://redis.io/docs/getting-started/
- **Coolify Redis**: https://coolify.io/docs/resources/redis
- **Bull (Filas)**: https://github.com/OptimalBits/bull

---

## ✅ Checklist

Antes de fazer deploy:

- [ ] Redis criado (Upstash/Coolify/Redis.io)
- [ ] `REDIS_URL` configurada no Coolify
- [ ] Conexão testada com `redis-cli ping`
- [ ] Logs da aplicação mostram: "✅ Redis conectado"
- [ ] Health check passa (aplicação inicia corretamente)

**Pronto! Redis configurado! 🚀**
