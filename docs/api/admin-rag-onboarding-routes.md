# 📡 Rotas Admin - RAG & Onboarding & Sinônimos & Dashboard Usuário

## 🏥 Health Check do Sistema

### 0. Status do Sistema

```http
GET /admin/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-19T19:07:06.384Z",
  "whatsapp": {
    "total": 1,
    "active": 1,
    "connected": 0
  },
  "telegram": {
    "total": 1,
    "active": 1,
    "connected": 1,
    "disconnected": 0,
    "connecting": 0
  },
  "providers": {
    "active": 4
  },
  "users": {
    "total": 156,
    "active": 152
  },
  "onboarding": {
    "completed": 28,
    "pending": 3
  },
  "service": {
    "uptime": 34.801617125,
    "memory": {
      "rss": 337838080,
      "heapTotal": 256114688,
      "heapUsed": 148672880,
      "external": 4368512,
      "arrayBuffers": 543351
    }
  }
}
```

**Campos:**
- `status`: Estado do serviço (healthy/unhealthy)
- `whatsapp`: Estatísticas de sessões WhatsApp
- `telegram`: Estatísticas de sessões Telegram
- `providers.active`: Quantidade de providers de IA ativos no banco
- `users.total`: Total de usuários no cache do sistema
- `users.active`: Quantidade de usuários ativos no cache Redis
- `onboarding.completed`: Quantidade de sessões de onboarding completas
- `onboarding.pending`: Quantidade de usuários finalizando onboarding (sessões ativas não expiradas)
- `service.uptime`: Tempo de execução do serviço em segundos
- `service.memory`: Uso de memória do processo Node.js

---

## � Usuários Ativos Recentes

### 1. Listar Usuários que Enviaram Mensagens Recentemente

```http
GET /admin/active-users?hours=24&limit=100
```

**Query Parameters:**
- `hours` (optional): Número de horas para considerar "recente" (padrão: 24)
- `limit` (optional): Número máximo de resultados (padrão: 50)

**Descrição:**
Esta rota retorna usuários que enviaram mensagens recentemente através de sessões WhatsApp. Útil para:
- Monitorar engajamento dos usuários
- Identificar usuários ativos no período
- Analisar padrões de uso do sistema
- Gerar relatórios de atividade

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "session_123",
      "phoneNumber": "5511999887766",
      "name": "João Silva",
      "isActive": true,
      "status": "CONNECTED",
      "lastMessageAt": "2025-12-19T18:30:00.000Z",
      "messageCount": 0
    }
  ],
  "total": 1
}
```

**Campos:**
- `id`: ID da sessão WhatsApp
- `phoneNumber`: Número de telefone do usuário
- `name`: Nome do usuário (se disponível)
- `isActive`: Se a sessão está ativa
- `status`: Status da sessão (CONNECTED, DISCONNECTED, etc.)
- `lastMessageAt`: Data/hora da última mensagem enviada
- `messageCount`: Contador de mensagens (atualmente sempre 0)

**Notas:**
- A rota busca na tabela `whatsapp_sessions` com base no campo `lastSeen`
- Diferente de `/admin/health` que conta usuários no Redis, esta rota lista sessões WhatsApp com detalhes
- Útil para identificar usuários específicos e seus padrões de uso

---

## �🔍 RAG Search Logs

### 2. Listar Logs de Busca RAG

```http
GET /admin/rag/search-logs?userId=xxx&failedOnly=true&limit=20&offset=0
```

**Query Parameters:**
- `userId` (optional): Filtrar por usuário específico
- `failedOnly` (optional): `true` para ver apenas falhas
- `limit` (optional): Número de resultados (máx: 100, padrão: 20)
- `offset` (optional): Paginação (padrão: 0)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "log_123",
      "userId": "user_456",
      "query": "gasolina posto shell",
      "queryNormalized": "gasolina posto shell",
      "matches": [...],
      "bestMatch": "Transporte",
      "bestScore": 0.88,
      "threshold": 0.7,
      "success": true,
      "ragMode": "BM25",
      "responseTime": 45,
      "createdAt": "2025-12-19T..."
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true,
    "pages": 8,
    "currentPage": 1
  },
  "stats": {
    "totalRecords": 150,
    "currentPageAttempts": 20,
    "successfulAttempts": 15,
    "failedAttempts": 5,
    "successRate": "75.00%",
    "aiFallbackCount": 8,
    "aiFallbackRate": "40.00%",
    "topFailedQueries": [
      { "query": "widget quantum", "count": 3 },
      { "query": "produto xyz", "count": 2 }
    ],
    "aiProviders": [
      {
        "provider": "openai",
        "count": 5,
        "models": ["gpt-4o-mini", "gpt-4o"]
      }
    ]
  },
  "timestamp": "2025-12-19T..."
}
```

---

### 3. Detalhes de um Log RAG Específico

```http
GET /admin/rag/search-logs/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "log_123",
    "userId": "user_456",
    "query": "gasolina",
    "success": true,
    "bestMatch": "Transporte",
    "bestScore": 0.88,
    // 🆕 Campos de tracking
    "flowStep": 1,
    "totalSteps": 1,
    "wasAiFallback": false,
    "aiProvider": null,
    "aiModel": null,
    "aiConfidence": null,
    "aiCategoryId": null,
    "aiCategoryName": null,
    "finalCategoryId": "cat_transporte",
    "finalCategoryName": "Transporte",
    "ragInitialScore": 0.88,
    "ragFinalScore": 0.88,
    // Logs de AI relacionados
    "aiUsageLogs": [
      {
        "id": "ai_log_789",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "operation": "CATEGORY_SUGGESTION",
        "totalTokens": 70,
        "estimatedCost": "0.000010",
        "aiCategoryName": "Transporte",
        "aiConfidence": 0.85,
        "needsSynonymLearning": false,
        "createdAt": "2025-12-19T..."
      }
    ],
    "_count": {
      "aiUsageLogs": 1
    }
  },
  "timestamp": "2025-12-19T..."
}
```

---

### 4. Estatísticas Gerais do RAG

```http
GET /admin/rag/stats?days=7
```

**Query Parameters:**
- `days` (optional): Período em dias (padrão: 7)

**Response:**
```json
{
  "success": true,
  "period": {
    "days": 7,
    "from": "2025-12-12T...",
    "to": "2025-12-19T..."
  },
  "stats": {
    "totalSearches": 250,
    "successfulSearches": 180,
    "successRate": "72.00%",
    "aiFallbackSearches": 70,
    "aiFallbackRate": "28.00%",
    "avgRagScore": "0.7234",
    "avgResponseTime": "45ms",
    "needsSynonymLearning": 35,
    "topUsers": [
      { "userId": "user_123", "searches": 45 },
      { "userId": "user_456", "searches": 32 }
    ],
    "flowStepDistribution": [
      { "step": "1/1", "count": 180 },
      { "step": "1/2", "count": 70 }
    ]
  },
  "timestamp": "2025-12-19T..."
}
```

---

### 4. Deletar Logs RAG

```http
DELETE /admin/rag/search-logs
Content-Type: application/json

{
  "ids": ["log_123", "log_456", "log_789"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "3 logs deletados com sucesso",
  "deletedCount": 3,
  "timestamp": "2025-12-19T..."
}
```

---

## 👤 Onboarding Sessions

### 5. Listar Sessões de Onboarding

```http
GET /admin/onboarding/sessions?status=active&limit=50&platform=whatsapp
```

**Query Parameters:**
- `status` (optional): `active`, `expired`, `completed`
- `limit` (optional): Número de resultados (máx: 200, padrão: 50)
- `platform` (optional): `whatsapp`, `telegram`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "session_123",
      "platformId": "+5511999999999",
      "phoneNumber": "+5511999999999",
      "currentStep": "COLLECT_EMAIL",
      "attempts": 2,
      "data": {
        "name": "João Silva",
        "email": "joao@example.com",
        "tempPhoneVerification": null
      },
      "lastMessageAt": "2025-12-19T10:30:00.000Z",
      "expiresAt": "2025-12-19T11:00:00.000Z",
      "isExpired": false,
      "completed": false,
      "minutesSinceLastMessage": 15,
      "createdAt": "2025-12-19T10:00:00.000Z",
      "updatedAt": "2025-12-19T10:30:00.000Z"
    }
  ],
  "stats": {
    "totalActive": 12,
    "totalExpired": 5,
    "totalCompleted": 134,
    "totalAll": 151,
    "stepDistribution": [
      { "step": "COLLECT_NAME", "count": 3 },
      { "step": "COLLECT_EMAIL", "count": 5 },
      { "step": "REQUEST_PHONE", "count": 2 },
      { "step": "CHOOSE_ACCOUNT", "count": 2 }
    ]
  },
  "timestamp": "2025-12-19T..."
}
```

**Campos importantes:**
- `lastMessageAt`: Última mensagem do usuário
- `updatedAt`: Última atualização da sessão (pode ser resposta do bot)
- `minutesSinceLastMessage`: Tempo desde a última interação
- `isExpired`: Se a sessão expirou (30 minutos de inatividade)
- `currentStep`: Step atual do onboarding

---

### 6. Detalhes de uma Sessão Específica

```http
GET /admin/onboarding/sessions/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session_123",
    "platformId": "+5511999999999",
    "phoneNumber": "+5511999999999",
    "currentStep": "COLLECT_EMAIL",
    "data": {
      "name": "João Silva",
      "email": null,
      "tempPhoneVerification": null
    },
    "attempts": 2,
    "lastMessageAt": "2025-12-19T10:30:00.000Z",
    "expiresAt": "2025-12-19T11:00:00.000Z",
    "isExpired": false,
    "completed": false,
    "minutesSinceLastMessage": 15,
    "createdAt": "2025-12-19T10:00:00.000Z",
    "updatedAt": "2025-12-19T10:30:00.000Z"
  },
  "timestamp": "2025-12-19T..."
}
```

**Campo `data` (JSON):**
Contém os dados coletados durante o onboarding:
- `name`: Nome do usuário
- `email`: Email do usuário
- `tempPhoneVerification`: Dados temporários de verificação
- Outros dados específicos do step

---

## 🎯 Sinônimos - Gerenciamento

### 7. Ver Sugestões de Aprendizado

```http
GET /admin/synonyms/learning-suggestions?limit=50&minOccurrences=3&minAiConfidence=0.7
```

**Query Parameters:**
- `limit` (optional): Número de sugestões (padrão: 50)
- `minOccurrences` (optional): Mínimo de ocorrências (padrão: 3)
- `minAiConfidence` (optional): Confiança mínima da AI (padrão: 0.7)
Workflow de Aprendizado de Sinônimos

```bash
# 1. Ver o que precisa aprender (ordenado por ocorrências)
GET /admin/synonyms/learning-suggestions?minOccurrences=5

# 2. Analisar sugestões
# - keyword: "pro labore"
# - 45 ocorrências
# - 3 usuários diferentes
# - AI sugere: "Salário" (confidence: 0.88)

# 3. Decidir: criar individual ou global?

# Individual (apenas para usuário específico):
POST /admin/synonyms
{
  "userId": "user123",
  "keyword": "pro labore",
  "categoryId": "cat_salario",
  "categoryName": "Salário"
}

# Global (termo técnico comum para todos):
POST /admin/synonyms/global
{
  "keyword": "das",
  "categoryId": "cat_impostos",
  "categoryName": "Impostos e Taxas"
}

# 4. Verificar estatísticas
GET /admin/synonyms/stats

# 5. Monitorar uso ao longo do tempo
GET /admin/synonyms/user/user123?sortBy=usageCount
```

---

### Importar Sinônimos de CSV

```bash
# 1. Preparar CSV com colunas:
# userId,keyword,categoryId,categoryName,subCategoryName

# 2. Converter para JSON e enviar batch
POST /admin/synonyms/batch
{
  "synonyms": [
    { "userId": "user1", "keyword": "pro labore", ... },
    { "userId": "user2", "keyword": "inss", ... },
    ...
  ]
}

# 3. Verificar resultado
# - created: quantidade criada
# - failed: quantidade que falhou
# - errors: detalhes dos erros
```

---

### Manutenção Regular

```bash
# Ver sinônimos não usados (últimos 90 dias)
GET /admin/synonyms/user/:userId?sortBy=lastUsedAt

# Deletar sinônimos obsoletos
DELETE /admin/synonyms/:id

# Ver quais categorias tem mais sinônimos
GET /admin/synonyms/stats
# → Analisar topCategories
```

---

## 📊 Casos de Uso (Continuação)

### 
**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "keyword": "pro labore",
      "userCount": 3,
      "totalOccurrences": 45,
      "suggestedCategoryId": "cat_salario",
      "suggestedCategoryName": "Salário",
      "suggestedSubCategoryName": "Salário PJ",
      "avgAiConfidence": 0.88,
      "lastUsedAt": "2025-12-19T10:30:00.000Z",
      "exampleQueries": [
        "paguei o pro labore",
        "recebi pro labore dezembro",
        "pro labore atrasado"
      ]
    },
    {
      "keyword": "inss autonomo",
      "userCount": 8,
      "totalOccurrences": 120,
      "suggestedCategoryName": "Impostos e Taxas",
      "suggestedSubCategoryName": "INSS",
      "avgAiConfidence": 0.91,
      "exampleQueries": ["paguei inss autonomo", "guia inss"]
    }
  ],
  "total": 23,
  "filters": {
    "minOccurrences": 3,
    "minAiConfidence": 0.7,
    "limit": 50
  },
  "timestamp": "2025-12-19T..."
}
```

**Como funciona:**
- Analisa logs de AI onde `needsSynonymLearning = true`
- Agrupa por keyword normalizada
- **Extrai subcategoria do metadata dos logs** 🆕
- Mostra quantos usuários usaram o termo
- Sugere categoria E subcategoria baseada no que AI decidiu
- Ordena por total de ocorrências

**Exemplo com subcategoria:**
```json
{
  "keyword": "pro labore",
  "suggestedCategoryName": "Salário",
  "suggestedSubCategoryName": "Salário PJ",  // 🆕 Agora inclui subcategoria!
  "avgAiConfidence": 0.88
}
```

---

### 8. Criar Sinônimo Individual

```http
POST /admin/synonyms
Content-Type: application/json

{
  "userId": "user123",
  "keyword": "pro labore",
  "categoryId": "cat_salario",
  "categoryName": "Salário",
  "subCategoryId": "sub_salario_pj",
  "subCategoryName": "Salário PJ",
  "confidence": 1.0,
  "source": "ADMIN_APPROVED"
}
```

**Body Parameters:**
- `userId` (required): ID do usuário
- `keyword` (required): Palavra-chave a ser mapeada
- `categoryId` (required): ID da categoria
- `categoryName` (required): Nome da categoria
- `subCategoryId` (optional): ID da subcategoria
- `subCategoryName` (optional): Nome da subcategoria
- `confidence` (optional): Confiança 0-1 (padrão: 1.0)
- `source` (optional): Origem (padrão: ADMIN_APPROVED)

**Valores de `source`:**
- `USER_CONFIRMED` - Usuário confirmou no chat
- `AI_SUGGESTED` - AI sugeriu e foi aprovado
- `AUTO_LEARNED` - Sistema aprendeu automaticamente
- `IMPORTED` - Importado de CSV/planilha
- `ADMIN_APPROVED` - Admin criou manualmente

**Response:**
```json
{
  "success": true,
  "message": "Sinônimo criado com sucesso",
  "data": {
    "keyword": "pro labore",
    "categoryName": "Salário",
    "subCategoryName": "Salário PJ"
  },
  "timestamp": "2025-12-19T..."
}
```

---

### 9. Criar Sinônimos em Batch

```http
POST /admin/synonyms/batch
Content-Type: application/json

{
  "synonyms": [
    {
      "userId": "user123",
      "keyword": "pro labore",
      "categoryId": "cat_salario",
      "categoryName": "Salário",
      "confidence": 1.0
    },
    {
      "userId": "user456",
      "keyword": "inss autonomo",
      "categoryId": "cat_impostos",
      "categoryName": "Impostos e Taxas",
      "subCategoryName": "INSS"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "2 sinônimos criados, 0 falharam",
  "created": 2,
  "failed": 0,
  "errors": [],
  "timestamp": "2025-12-19T..."
}
```

**Uso típico:**
- Importar sinônimos de CSV
- Aplicar múltiplas sugestões de uma vez
- Migração de dados

---

### 10. Criar Sinônimo Global (Todos Usuários)

```http
POST /admin/synonyms/global
Content-Type: application/json

{
  "keyword": "das",
  "categoryId": "cat_impostos",
  "categoryName": "Impostos e Taxas",
  "subCategoryName": "DAS",
  "confidence": 1.0
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sinônimo global criado para 342 usuários",
  "created": 342,
  "failed": 0,
  "totalUsers": 342,
  "timestamp": "2025-12-19T..."
}
```

**Quando usar:**
- Termos técnicos comuns: "DAS", "INSS", "IPVA"
- Siglas regionais: "IPTU", "SABESP", "CEMIG"
- Correção de termo muito comum

⚠️ **Cuidado:** Cria sinônimo para TODOS usuários ativos. Use com moderação!

---

### 11. Listar Sinônimos de um Usuário

```http
GET /admin/synonyms/user/:userId?limit=50&sortBy=usageCount
```

**Query Parameters:**
- `limit` (optional): Número de resultados (padrão: 50)
- `sortBy` (optional): `usageCount`, `createdAt`, `confidence`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "syn_123",
      "userId": "user123",
      "keyword": "pro labore",
      "categoryId": "cat_salario",
      "categoryName": "Salário",
      "subCategoryId": "sub_salario_pj",
      "subCategoryName": "Salário PJ",
      "confidence": 1.0,
      "source": "ADMIN_APPROVED",
      "usageCount": 45,
      "lastUsedAt": "2025-12-19T10:30:00.000Z",
      "createdAt": "2025-12-01T10:00:00.000Z",
      "updatedAt": "2025-12-19T10:30:00.000Z"
    }
  ],
  "total": 12,
  "timestamp": "2025-12-19T..."
}
```

---

### 12. Deletar Sinônimo

```http
DELETE /admin/synonyms/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Sinônimo deletado com sucesso",
  "timestamp": "2025-12-19T..."
}
```

---

### 13. Estatísticas de Sinônimos

```http
GET /admin/synonyms/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalSynonyms": 342,
    "bySource": {
      "USER_CONFIRMED": 120,
      "ADMIN_APPROVED": 180,
      "AI_SUGGESTED": 30,
      "AUTO_LEARNED": 12
    },
    "topKeywords": [
      {
        "keyword": "pro labore",
        "totalUsage": 450,
        "categoryName": "Salário"
      },
      {
        "keyword": "inss",
        "totalUsage": 380,
        "categoryName": "Impostos e Taxas"
      }
    ],
    "topCategories": [
      {
        "categoryName": "Salário",
        "synonymCount": 45
      },
      {
        "categoryName": "Impostos e Taxas",
        "synonymCount": 38
      }
    ],
### Fase 1: Implementação Admin (Atual) ✅
- ✅ Rotas de sinônimos criadas
- ✅ Sugestões de aprendizado
- ✅ CRUD completo
- ✅ Criação em batch e global
- ✅ Estatísticas

### Fase 2: Interface Admin (Próximo)
1. **Dashboard de Sinônimos**: Visualizar estatísticas
2. **Lista de Sugestões**: Ver e aprovar/rejeitar
3. **Gerenciador de Sinônimos**: Editar/deletar
4. **Importador CSV**: Upload em massa

### Fase 3: Aprendizado Semi-Automático
1. **Bot pergunta ao usuário**: "Vi que você sempre classifica 'pro labore' como Salário. Confirma?"
2. **Usuário responde**: Sim → cria com `source: USER_CONFIRMED`
3. **Feedback loop**: Sistema aprende com confirmações

### Fase 4: Aprendizado Automático
1. **Threshold automático**: Se termo aparece 20x e AI sempre sugere mesma categoria (>90%)
2. **Auto-criar sinônimo**: `source: AUTO_LEARNED`, `confidence: 0.5`
3. **Review periódico**: Admin valida sinônimos auto-aprendidos
```

**Métricas importantes:**
- `totalSynonyms`: Total no sistema
- `bySource`: Distribuição por origem
- `topKeywords`: Sinônimos mais usados (ROI alto)
- `topCategories`: Categorias com mais sinônimos
- `recentlyCreated`: Criados nos últimos 7 dias
- `learningOpportunities`: Queries aguardando aprendizado

---

## 🔑 Autenticação

Todas as rotas requerem JWT token:

```http
Authorization: Bearer <JWT_TOKEN>
```

---

## 📊 Casos de Uso

### Monitorar Onboarding Ativo

```bash
# Ver quem está fazendo onboarding agora
GET /admin/onboarding/sessions?status=active

# Ver apenas WhatsApp
GET /admin/onboarding/sessions?status=active&platform=whatsapp

# Ver apenas Telegram
GET /admin/onboarding/sessions?status=active&platform=telegram
```

### Analisar Performance do RAG

```bash
# Estatísticas dos últimos 7 dias
GET /admin/rag/stats?days=7

# Últimos 30 dias
GET /admin/rag/stats?days=30

# Ver apenas falhas para criar sinônimos
GET /admin/rag/search-logs?failedOnly=true&limit=50
```

### Identificar Queries Problemáticas

```bash
# 1. Ver logs que falharam
GET /admin/rag/search-logs?failedOnly=true

# 2. Ver detalhes de um log específico
GET /admin/rag/search-logs/{id}

# 3. Ver se AI teve que fazer fallback
# (verificar campo wasAiFallback=true nos logs)
```

### Monitorar Necessidade de Sinônimos

```bash
# Ver estatísticas
GET /admin/rag/stats?days=7

# Campo "needsSynonymLearning" mostra quantas queries
# precisam de sinônimos para melhorar o RAG
```

---

## 🎯 Próximos Passos

1. **Implementar Frontend**: Criar dashboard admin para visualizar essas métricas
2. **Alertas**: Notificar quando taxa de falha RAG > 30%
3. **Auto-aprendizado**: Criar sinônimos automaticamente baseado em padrões
4. **Relatórios**: Exportar dados em CSV/Excel
5. **Gráficos**: Visualizar tendências ao longo do tempo

---

## 💡 Dicas

- Use `failedOnly=true` para identificar queries que precisam de sinônimos
- Campo `minutesSinceLastMessage` ajuda a identificar usuários travados
- `flowStepDistribution` mostra em qual etapa os usuários mais usam AI fallback
- `aiProviders` mostra qual AI está sendo mais usada (custo)
