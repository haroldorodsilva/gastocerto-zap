# 👤 Dashboard do Usuário - Endpoint de Resumo

## 📊 Resumo Completo do Usuário

### GET `/admin/users/:userId/summary`

Retorna um dashboard completo com todos os dados e estatísticas do usuário.

**Limite:** 50 registros por tabela (exceto onboarding: 10)

---

## 📥 Request

```http
GET /admin/users/:userId/summary
Authorization: Bearer <JWT_TOKEN>
```

**Path Parameters:**
- `userId` (required): `gastoCertoId` do usuário

---

## 📤 Response

```json
{
  "success": true,
  "user": {
    "id": "uuid-user-cache",
    "gastoCertoId": "user123",
    "phoneNumber": "66996285154",
    "whatsappId": "5566996285154@s.whatsapp.net",
    "telegramId": "707624962",
    "email": "usuario@email.com",
    "name": "João Silva",
    "hasActiveSubscription": true,
    "isBlocked": false,
    "isActive": true,
    "activeAccountId": "account_xyz",
    "accounts": [
      {
        "id": "account_xyz",
        "name": "Conta Principal",
        "type": "checking",
        "isPrimary": true
      }
    ],
    "lastSyncAt": "2025-12-19T10:30:00.000Z",
    "createdAt": "2025-01-15T08:00:00.000Z",
    "updatedAt": "2025-12-19T10:30:00.000Z"
  },
  "stats": {
    "rag": {
      "total": 45,
      "successful": 38,
      "successRate": "84.44%",
      "aiFallbackCount": 7,
      "avgResponseTime": "42ms"
    },
    "ai": {
      "total": 12,
      "successful": 12,
      "totalTokens": 3450,
      "totalCost": "0.000520",
      "needsSynonymLearning": 5,
      "avgResponseTime": "780ms"
    },
    "synonyms": {
      "total": 8,
      "totalUsage": 156,
      "bySource": {
        "ADMIN_APPROVED": 5,
        "USER_CONFIRMED": 2,
        "AI_SUGGESTED": 1
      }
    },
    "transactions": {
      "total": 50,
      "confirmed": 48,
      "pending": 2,
      "totalAmount": "15430.50"
    },
    "unrecognized": {
      "total": 3,
      "needsReview": 1
    },
    "onboarding": {
      "total": 2,
      "completed": 1,
      "inProgress": 1
    }
  },
  "data": {
    "ragLogs": [
      {
        "id": "rag_log_1",
        "query": "gasolina posto shell",
        "queryNormalized": "gasolina posto shell",
        "bestMatch": "Transporte",
        "bestScore": 0.88,
        "success": true,
        "ragMode": "BM25",
        "responseTime": 45,
        "wasAiFallback": false,
        "flowStep": 1,
        "totalSteps": 1,
        "aiProvider": null,
        "aiModel": null,
        "finalCategoryName": "Transporte",
        "createdAt": "2025-12-19T10:30:00.000Z"
      }
      // ... até 49 mais
    ],
    "aiLogs": [
      {
        "id": "ai_log_1",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "operation": "CATEGORY_SUGGESTION",
        "inputType": "TEXT",
        "totalTokens": 85,
        "estimatedCost": 0.000012,
        "responseTime": 750,
        "success": true,
        "aiCategoryName": "Transporte",
        "finalCategoryName": "Transporte",
        "aiConfidence": 0.85,
        "wasRagFallback": false,
        "needsSynonymLearning": false,
        "createdAt": "2025-12-19T10:25:00.000Z"
      }
      // ... até 49 mais
    ],
    "synonyms": [
      {
        "id": "syn_1",
        "keyword": "pro labore",
        "categoryName": "Salário",
        "subCategoryName": "Salário PJ",
        "confidence": 1.0,
        "source": "ADMIN_APPROVED",
        "usageCount": 45,
        "lastUsedAt": "2025-12-19T09:00:00.000Z",
        "createdAt": "2025-12-01T10:00:00.000Z"
      }
      // ... até 49 mais
    ],
    "transactionConfirmations": [
      {
        "id": "trans_1",
        "transactionId": "trans_xyz",
        "description": "Gasolina Posto Shell",
        "amount": 250.00,
        "categoryName": "Transporte",
        "subCategoryName": "Combustível",
        "type": "EXPENSE",
        "date": "2025-12-19T00:00:00.000Z",
        "confirmed": true,
        "confirmationType": "AUTO",
        "createdAt": "2025-12-19T08:30:00.000Z",
        "confirmedAt": "2025-12-19T08:31:00.000Z"
      }
      // ... até 49 mais
    ],
    "unrecognizedMessages": [
      {
        "id": "unrec_1",
        "message": "xyz abc 123",
        "intent": "UNKNOWN",
        "confidence": 0.12,
        "needsReview": true,
        "createdAt": "2025-12-18T15:20:00.000Z"
      }
      // ... até 49 mais
    ],
    "onboardingSessions": [
      {
        "id": "onboard_1",
        "platformId": "+5566996285154",
        "currentStep": "COMPLETED",
        "completed": true,
        "attempts": 1,
        "lastMessageAt": "2025-01-15T08:15:00.000Z",
        "expiresAt": "2025-01-15T08:45:00.000Z",
        "createdAt": "2025-01-15T08:00:00.000Z"
      }
      // ... até 9 mais
    ]
  },
  "timestamp": "2025-12-19T10:45:00.000Z"
}
```

---

## 📊 Estrutura das Estatísticas

### RAG Stats
```json
{
  "total": 45,              // Total de buscas RAG
  "successful": 38,         // Buscas com sucesso
  "successRate": "84.44%",  // Taxa de sucesso
  "aiFallbackCount": 7,     // Vezes que precisou de AI
  "avgResponseTime": "42ms" // Tempo médio de resposta
}
```

### AI Stats
```json
{
  "total": 12,                  // Total de chamadas AI
  "successful": 12,             // Chamadas com sucesso
  "totalTokens": 3450,          // Total de tokens usados
  "totalCost": "0.000520",      // Custo total em USD
  "needsSynonymLearning": 5,    // Queries que precisam virar sinônimos
  "avgResponseTime": "780ms"    // Tempo médio de resposta
}
```

### Synonyms Stats
```json
{
  "total": 8,           // Total de sinônimos do usuário
  "totalUsage": 156,    // Vezes que sinônimos foram usados
  "bySource": {         // Distribuição por origem
    "ADMIN_APPROVED": 5,
    "USER_CONFIRMED": 2,
    "AI_SUGGESTED": 1
  }
}
```

### Transactions Stats
```json
{
  "total": 50,              // Total de confirmações
  "confirmed": 48,          // Confirmadas
  "pending": 2,             // Pendentes
  "totalAmount": "15430.50" // Valor total
}
```

### Unrecognized Stats
```json
{
  "total": 3,          // Total de mensagens não reconhecidas
  "needsReview": 1     // Que precisam de revisão
}
```

### Onboarding Stats
```json
{
  "total": 2,        // Total de sessões
  "completed": 1,    // Sessões completas
  "inProgress": 1    // Sessões em progresso
}
```

---

## 🎯 Casos de Uso

### Dashboard Admin

```bash
# Buscar resumo completo do usuário
curl -X GET http://localhost:3000/admin/users/user123/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Ver apenas as estatísticas
curl -X GET http://localhost:3000/admin/users/user123/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.stats'

# Ver apenas logs RAG
curl -X GET http://localhost:3000/admin/users/user123/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.ragLogs'

# Ver apenas sinônimos
curl -X GET http://localhost:3000/admin/users/user123/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.synonyms'
```

---

### Análise de Performance

```bash
# Ver usuário com melhor taxa de sucesso RAG
# (fazer requisição para vários usuários e comparar stats.rag.successRate)

# Ver usuário que mais usa AI
# (comparar stats.ai.totalCost)

# Ver usuário com mais sinônimos
# (comparar stats.synonyms.total)
```

---

### Identificar Problemas

**Usuário com baixa taxa de sucesso RAG:**
```json
{
  "stats": {
    "rag": {
      "successRate": "45.00%",  // ⚠️ Muito baixo!
      "aiFallbackCount": 22      // ⚠️ Muito fallback
    }
  }
}
```
→ **Ação:** Ver `data.aiLogs` com `needsSynonymLearning=true` e criar sinônimos

**Usuário com muitas mensagens não reconhecidas:**
```json
{
  "stats": {
    "unrecognized": {
      "total": 15,         // ⚠️ Muitas mensagens não reconhecidas
      "needsReview": 10    // ⚠️ Precisam de revisão
    }
  }
}
```
→ **Ação:** Revisar `data.unrecognizedMessages` e melhorar NLP

**Usuário com alto custo de AI:**
```json
{
  "stats": {
    "ai": {
      "totalCost": "0.015000",  // ⚠️ R$ 0,075 (considerando 5x markup)
      "totalTokens": 85000       // ⚠️ Muitos tokens
    }
  }
}
```
→ **Ação:** Criar mais sinônimos para reduzir chamadas AI

---

## 🎨 Componentes de UI Sugeridos

### 1. Cards de Overview
```typescript
// RAG Performance Card
<Card>
  <h3>RAG Performance</h3>
  <Progress value={stats.rag.successRate} />
  <p>{stats.rag.successful} / {stats.rag.total} queries</p>
  <p>Avg: {stats.rag.avgResponseTime}</p>
</Card>

// AI Usage Card
<Card>
  <h3>AI Usage</h3>
  <p>Total Cost: ${stats.ai.totalCost}</p>
  <p>Tokens: {stats.ai.totalTokens.toLocaleString()}</p>
  <p>Avg: {stats.ai.avgResponseTime}</p>
</Card>

// Synonyms Card
<Card>
  <h3>Synonyms</h3>
  <p>{stats.synonyms.total} created</p>
  <p>{stats.synonyms.totalUsage} times used</p>
  <PieChart data={stats.synonyms.bySource} />
</Card>
```

### 2. Tabelas de Dados
```typescript
// RAG Logs Table
<Table>
  <thead>
    <tr>
      <th>Query</th>
      <th>Match</th>
      <th>Score</th>
      <th>Success</th>
      <th>Time</th>
      <th>Date</th>
    </tr>
  </thead>
  <tbody>
    {data.ragLogs.map(log => (
      <tr>
        <td>{log.query}</td>
        <td>{log.bestMatch}</td>
        <td>{(log.bestScore * 100).toFixed(0)}%</td>
        <td>{log.success ? '✅' : '❌'}</td>
        <td>{log.responseTime}ms</td>
        <td>{formatDate(log.createdAt)}</td>
      </tr>
    ))}
  </tbody>
</Table>
```

### 3. Gráficos
```typescript
// RAG Success Rate Over Time
<LineChart
  data={data.ragLogs}
  x="createdAt"
  y="success"
  title="RAG Success Rate Trend"
/>

// AI Cost Over Time
<AreaChart
  data={data.aiLogs}
  x="createdAt"
  y="estimatedCost"
  title="AI Cost Trend"
/>

// Top Synonyms Usage
<BarChart
  data={data.synonyms}
  x="keyword"
  y="usageCount"
  title="Most Used Synonyms"
/>
```

---

## 🔄 Fluxo de Uso Típico

### 1. Admin acessa dashboard
```
GET /admin/users/user123/summary
→ Vê overview completo
```

### 2. Identifica problema
```
stats.rag.successRate = "60%" (baixo)
stats.ai.needsSynonymLearning = 15
```

### 3. Analisa detalhes
```
data.aiLogs com needsSynonymLearning=true
→ "pro labore" aparece 8x
→ "inss autonomo" aparece 5x
```

### 4. Toma ação
```
POST /admin/synonyms/batch
{
  "synonyms": [
    { "keyword": "pro labore", ... },
    { "keyword": "inss autonomo", ... }
  ]
}
```

### 5. Monitora melhoria
```
GET /admin/users/user123/summary (depois de 1 semana)
→ stats.rag.successRate = "85%" ✅
→ stats.ai.totalCost reduzido em 40% ✅
```

---

## 📈 KPIs para Monitorar

### Performance
- `successRate > 80%` = Bom
- `avgResponseTime < 100ms` = Bom
- `aiFallbackCount / total < 20%` = Bom

### Custo
- `totalCost < $0.01/dia` = Bom (por usuário)
- `needsSynonymLearning < 5` = Bem treinado

### Engajamento
- `transactions.confirmed > 90%` = Alta confiança
- `unrecognized.needsReview < 5` = NLP bom

---

## 🎉 Conclusão

Endpoint completo para criar **dashboard administrativo** com visão 360° do usuário!

**O que você consegue:**
- ✅ Ver todos os dados do usuário em uma chamada
- ✅ Estatísticas calculadas automaticamente
- ✅ Últimos 50 registros de cada tabela
- ✅ Identificar problemas rapidamente
- ✅ Tomar decisões baseadas em dados

**Próximo passo:**
Criar interface visual com gráficos e cards para visualizar esses dados!
