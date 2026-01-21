# Admin Sync Cache API

## 📋 Visão Geral

Novas rotas administrativas para gerenciar o cache de usuários e forçar sincronização com a API do Gasto Certo.

## 🚀 Endpoints Implementados

### 1. Sincronizar Cache do Usuário

**POST** `/admin/users/:userId/sync-cache`

Limpa o cache Redis do usuário e busca dados atualizados da API, incluindo status de assinatura, dados pessoais e contas.

#### Parâmetros
- `userId` (path): ID do usuário no Gasto Certo (gastoCertoId)

#### Resposta de Sucesso (200)
```json
{
  "success": true,
  "message": "Cache sincronizado com sucesso",
  "data": {
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "name": "João Silva",
    "email": "joao@example.com",
    "canUseGastoZap": true,
    "hasActiveSubscription": true,
    "isActive": true,
    "isBlocked": false,
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "cacheCleared": {
      "redis": 4,
      "keys": [
        "user:123e4567-e89b-12d3-a456-426614174000",
        "user:+5511999999999",
        "user:whatsapp_id_123",
        "user:telegram_id_456"
      ]
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Resposta de Erro (404)
```json
{
  "success": false,
  "message": "Usuário não encontrado",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Resposta de Erro (500)
```json
{
  "success": false,
  "message": "Erro ao sincronizar cache",
  "error": "Detalhes do erro",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### O que a rota faz:
1. ✅ Busca o usuário no banco local
2. 🗑️ Limpa cache Redis (todas as chaves do usuário)
3. 🌐 Busca dados atualizados da API
4. 🔄 Sincroniza status de assinatura (`canUseGastoZap`, `hasActiveSubscription`)
5. 💾 Atualiza banco PostgreSQL
6. 📊 Retorna dados sincronizados

#### Quando usar:
- ⚠️ Usuário relata que não consegue usar o bot apesar de ter assinatura ativa
- 🔄 Forçar atualização imediata após mudança de plano/assinatura
- 🧪 Testes de integração com API
- 🐛 Debug de problemas de cache


---

### 2. Visualizar Resumo do Usuário (Atualizado)

**GET** `/admin/users/:userId/summary`

Retorna resumo completo do usuário, agora **incluindo informações de assinatura e sincronização**.

#### Parâmetros
- `userId` (path): ID do usuário no Gasto Certo (gastoCertoId)

#### Resposta de Sucesso (200)
```json
{
  "success": true,
  "user": {
    "id": 42,
    "gastoCertoId": "123e4567-e89b-12d3-a456-426614174000",
    "phoneNumber": "+5511999999999",
    "whatsappId": "5511999999999@c.us",
    "telegramId": 987654321,
    "email": "joao@example.com",
    "name": "João Silva",
    "hasActiveSubscription": true,
    "canUseGastoZap": true,
    "isBlocked": false,
    "isActive": true,
    "activeAccountId": "acc_123",
    "accounts": [...],
    "lastSyncAt": "2024-01-15T10:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "subscriptionInfo": {
      "canUseService": true,
      "hasActiveSubscription": true,
      "isBlocked": false,
      "isActive": true,
      "lastSync": "2024-01-15T10:30:00.000Z",
      "needsSync": false
    }
  },
  "stats": { ... },
  "data": { ... },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Novos Campos Adicionados:
- **`canUseGastoZap`**: Indica se usuário pode usar o bot (baseado em plano + assinatura)
- **`subscriptionInfo`**: Objeto com detalhes completos:
  - `canUseService`: Se pode usar o serviço (mesma info que `canUseGastoZap`)
  - `hasActiveSubscription`: Tem assinatura ativa
  - `isBlocked`: Usuário bloqueado
  - `isActive`: Usuário ativo no sistema
  - `lastSync`: Data da última sincronização
  - `needsSync`: Se precisa sincronizar (última sync > 1 hora)

#### Comportamento de Sincronização Automática:
A rota **agora sincroniza automaticamente** antes de retornar os dados se `needsSync === true` (última sincronização > 1 hora).


---

## 🔄 Fluxo de Sincronização

```
┌─────────────────────────────────────────────────────────┐
│  Admin POST /users/:userId/sync-cache                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  1. Busca usuário no PostgreSQL                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  2. Limpa cache Redis                                   │
│     - user:{userId}                                     │
│     - user:{phoneNumber}                                │
│     - user:{whatsappId}                                 │
│     - user:{telegramId}                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  3. Busca dados da API Gasto Certo                      │
│     - getUserById()                                     │
│     - getSubscriptionStatus()                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  4. Atualiza PostgreSQL                                 │
│     - name, email, isActive, isBlocked                  │
│     - hasActiveSubscription                             │
│     - canUseGastoZap ⭐ NOVO                            │
│     - lastSyncAt, updatedAt                             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  5. Retorna dados atualizados                           │
└─────────────────────────────────────────────────────────┘
```


---

## 🧪 Exemplos de Uso

### Exemplo 1: Sincronizar cache após ativação de plano

```bash
curl -X POST \
  https://zap.hlg.gastocerto.com.br/admin/users/123e4567-e89b-12d3-a456-426614174000/sync-cache \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN'
```

### Exemplo 2: Verificar informações de assinatura

```bash
curl -X GET \
  https://zap.hlg.gastocerto.com.br/admin/users/123e4567-e89b-12d3-a456-426614174000/summary \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN'
```

Resposta mostra:
```json
{
  "user": {
    "canUseGastoZap": true,
    "subscriptionInfo": {
      "canUseService": true,
      "needsSync": false,
      "lastSync": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

### Exemplo 3: Debug de problema de acesso

Se usuário relatar "Você não tem acesso ao GastoZap":

1. Verificar summary:
```bash
GET /admin/users/{userId}/summary
```

2. Verificar `subscriptionInfo.canUseService` e `needsSync`

3. Se `needsSync === true` ou `canUseService === false`, forçar sync:
```bash
POST /admin/users/{userId}/sync-cache
```

4. Verificar novamente summary após sync


---

## ⏱️ Sincronização Automática

### Intervalo de Sincronização: **1 hora**

O sistema verifica automaticamente se precisa sincronizar:

```typescript
needsSync(user) {
  const lastSync = user.updatedAt.getTime();
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;
  
  return (now - lastSync) > hourInMs;
}
```

### Onde é verificado:
1. ✅ **WhatsApp Message Handler**: Antes de processar mensagem
2. ✅ **Admin GET /summary**: Antes de retornar dados
3. ✅ **Message Validation**: Durante validação de usuário

### Quando sincroniza automaticamente:
- ⏰ Se última atualização > 1 hora
- 📱 Antes de processar mensagem do usuário
- 👀 Quando admin consulta dados do usuário


---

## 🔐 Validação de Acesso

O campo `canUseGastoZap` é calculado pela API com base em:

```typescript
canUseGastoZap = 
  user.isActive === true &&
  user.hasActiveSubscription === true &&
  user.plan.allowZapAssistant === true &&
  user.isBlocked === false
```

### Regras de Negócio:
- ✅ Usuário deve estar **ativo** (`isActive`)
- ✅ Deve ter **assinatura ativa** (`hasActiveSubscription`)
- ✅ Plano deve **permitir assistente** (`plan.allowZapAssistant`)
- ✅ Não pode estar **bloqueado** (`isBlocked`)


---

## 📊 Monitoramento

### Logs de Sincronização

```
🔄 Admin solicitou sync completo do cache: {userId}
🗑️ Cache Redis limpo: 4 chaves
✅ Cache sincronizado com sucesso: {userId}
```

### Logs de Erro

```
❌ Erro ao sincronizar cache: {error.message}
❌ Usuário não encontrado: {userId}
```


---

## 🎯 Casos de Uso

### Caso 1: Cliente reclama que não consegue usar o bot

**Problema**: "Estou tentando usar o bot mas recebo mensagem de que não tenho acesso"

**Solução**:
1. Consultar `/admin/users/{userId}/summary`
2. Verificar `canUseGastoZap` e `subscriptionInfo`
3. Se `false`, chamar `/admin/users/{userId}/sync-cache`
4. Verificar novamente após sync

### Caso 2: Atualização imediata após ativar plano

**Problema**: Cliente ativou plano mas bot ainda não reconhece

**Solução**:
```bash
POST /admin/users/{userId}/sync-cache
```
Cache limpo + dados atualizados imediatamente

### Caso 3: Debug de cache dessincronizado

**Problema**: Dados no bot diferem da API

**Solução**:
1. Forçar sync: `POST /sync-cache`
2. Verificar timestamps: `lastSync`, `updatedAt`
3. Analisar logs de sincronização


---

## 🔧 Manutenção

### Comandos Úteis

```bash
# Verificar cache Redis
redis-cli KEYS "user:*"

# Ver dados de um usuário
redis-cli GET "user:123e4567-e89b-12d3-a456-426614174000"

# Limpar cache manualmente (emergência)
redis-cli DEL "user:123e4567-e89b-12d3-a456-426614174000"

# Ver última sincronização no PostgreSQL
SELECT gastoCertoId, updatedAt, canUseGastoZap, hasActiveSubscription 
FROM "UserCache" 
WHERE gastoCertoId = '123e4567-e89b-12d3-a456-426614174000';
```


---

## 📝 Notas Importantes

1. ⚠️ **Não abusar da rota de sync**: Ela faz chamadas à API externa
2. 🔄 **Sincronização automática**: Sistema já sincroniza a cada 1 hora
3. 💡 **Use apenas quando necessário**: Debug, problemas urgentes, ou após mudanças críticas
4. 🎯 **Cache multi-camadas**: Redis (1h) → PostgreSQL → API (1h interval)

---

## 🆕 Mudanças em Relação à Versão Anterior

### Antes (24 horas):
- Sincronização a cada 24 horas
- Sem rota de sync manual
- `/summary` não mostrava info de assinatura

### Agora (1 hora):
- ✅ Sincronização a cada **1 hora**
- ✅ Rota `POST /sync-cache` para forçar refresh
- ✅ `/summary` mostra `canUseGastoZap` + `subscriptionInfo`
- ✅ Sync automático em consultas admin
- ✅ Validação mais precisa com campo dedicado

---

## 📚 Documentação Relacionada

- [AI_CONFIG_GUIDE.md](./AI_CONFIG_GUIDE.md) - Configuração de validação
- [ADMIN_API_DOCUMENTATION.md](./ADMIN_API_DOCUMENTATION.md) - Outras rotas admin
- [AUTENTICACAO_API.md](./AUTENTICACAO_API.md) - Autenticação
