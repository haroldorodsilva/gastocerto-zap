# RAG Admin Endpoints

Documentação completa dos endpoints administrativos do sistema RAG (Retrieval-Augmented Generation) para análise, testes e gerenciamento de sinônimos.

## 📋 Índice

- [POST /admin/rag/test-match](#post-adminragtest-match)
- [POST /admin/rag/analyze](#post-adminraganalyze)
- [POST /admin/rag/synonym/global](#post-adminragsynonymglobal)
- [POST /admin/rag/synonym/user](#post-adminragsynonymuser)
- [GET /admin/rag/synonyms/:userId](#get-adminragsynonymsuserid)
- [GET /admin/rag/logs/:userId](#get-adminraglogsuserid)
- [GET /admin/rag/stats](#get-adminragstats)

---

## POST /admin/rag/test-match

### Descrição
Testa o matching RAG para um usuário específico **SEM criar logs**. Útil para simular processamento e analisar resultados antes de aplicar em produção.

### Para que serve
- Validar se uma query encontraria a categoria correta
- Testar configuração de sinônimos antes de salvar
- Debugar problemas de matching
- Analisar scores e sugestões do sistema

### Input

**Endpoint:** `POST /admin/rag/test-match`

**Headers:**
```
Content-Type: application/json
x-admin-key: <ADMIN_API_KEY>
```

**Body:**
```json
{
  "userId": "550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61",
  "query": "almoço no restaurante"
}
```

**Parâmetros:**
- `userId` (string, obrigatório): ID do usuário no cache (userCache.id)
- `query` (string, obrigatório): Texto para testar o matching

### Output

**Status:** `200 OK`

```json
{
  "matches": [
    {
      "categoryId": "cat-123",
      "categoryName": "Alimentação",
      "subCategoryId": "sub-456",
      "subCategoryName": "Restaurante",
      "score": 0.85,
      "matchType": "exact"
    }
  ],
  "suggestions": [
    {
      "type": "improve_match",
      "keyword": "almoço no restaurante",
      "categoryName": "Alimentação",
      "subCategoryName": "Restaurante",
      "reason": "Match médio - criar sinônimo pode melhorar",
      "confidence": 0.8
    }
  ],
  "userSynonyms": [
    {
      "keyword": "ifood",
      "categoryId": "cat-123",
      "subCategoryId": "sub-456",
      "confidence": 0.9,
      "usageCount": 15,
      "createdAt": "2026-01-10T12:00:00Z"
    }
  ],
  "debug": {
    "processingTimeMs": 45
  }
}
```

**Campos de resposta:**
- `matches`: Lista de categorias encontradas ordenadas por score
  - `score`: 0-1 (0.7+ = match forte, 0.3-0.7 = match médio, <0.3 = match fraco)
- `suggestions`: Recomendações do sistema (criar sinônimo, melhorar matching, etc)
- `userSynonyms`: Sinônimos personalizados do usuário
- `debug.processingTimeMs`: Tempo de processamento em milissegundos

---

## POST /admin/rag/analyze

### Descrição
Retorna análise detalhada de como o RAG chegou ao resultado. Mostra scores de **TODAS** as categorias avaliadas, não apenas os matches.

### Para que serve
- Entender por que uma categoria específica teve score baixo
- Visualizar todas as categorias disponíveis para o usuário
- Analisar tokens que deram match
- Debugar problemas complexos de matching

### Input

**Endpoint:** `POST /admin/rag/analyze`

**Headers:**
```
Content-Type: application/json
x-admin-key: <ADMIN_API_KEY>
```

**Body:**
```json
{
  "userId": "550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61",
  "query": "uber"
}
```

**Parâmetros:**
- `userId` (string, obrigatório): ID do usuário no cache
- `query` (string, obrigatório): Texto para analisar

### Output

**Status:** `200 OK`

```json
{
  "query": "uber",
  "queryNormalized": "uber",
  "queryTokens": ["uber"],
  "categories": [
    {
      "categoryId": "cat-789",
      "categoryName": "Transporte",
      "subCategoryId": "sub-321",
      "subCategoryName": "App de Transporte",
      "score": 0.92,
      "matchedTokens": ["uber"],
      "reason": "Match forte"
    },
    {
      "categoryId": "cat-123",
      "categoryName": "Alimentação",
      "subCategoryId": "sub-456",
      "subCategoryName": "Restaurante",
      "score": 0.15,
      "matchedTokens": [],
      "reason": "Match fraco"
    },
    {
      "categoryId": "cat-999",
      "categoryName": "Moradia",
      "subCategoryId": "sub-111",
      "subCategoryName": "Aluguel",
      "score": 0.02,
      "matchedTokens": [],
      "reason": "Sem match"
    }
  ]
}
```

**Campos de resposta:**
- `query`: Query original
- `queryNormalized`: Query após normalização (lowercase, remoção acentos, etc)
- `queryTokens`: Tokens extraídos da query
- `categories`: **TODAS** categorias do usuário ordenadas por score (maior → menor)
  - `matchedTokens`: Tokens da query que apareceram na categoria
  - `reason`: Classificação do match (forte, médio, fraco, sem match)

---

## POST /admin/rag/synonym/global

### Descrição
Cria sinônimo global aplicado a **todos os usuários** do sistema.

### Para que serve
- Adicionar sinônimos comuns (ex: "ifood" → Alimentação/Delivery)
- Corrigir problemas de matching que afetam muitos usuários
- Padronizar interpretação de marcas e termos conhecidos

### Input

**Endpoint:** `POST /admin/rag/synonym/global`

**Headers:**
```
Content-Type: application/json
x-admin-key: <ADMIN_API_KEY>
```

**Body:**
```json
{
  "keyword": "ifood",
  "categoryId": "cat-123",
  "subCategoryId": "sub-456"
}
```

**Parâmetros:**
- `keyword` (string, obrigatório): Palavra-chave ou termo do sinônimo
- `categoryId` (string, obrigatório): ID da categoria associada
- `subCategoryId` (string, opcional): ID da subcategoria associada

### Output

**Status:** `201 Created`

```json
{
  "message": "Sinônimo global criado com sucesso",
  "synonym": {
    "id": "syn-global-123",
    "userId": "GLOBAL",
    "keyword": "ifood",
    "categoryId": "cat-123",
    "categoryName": "Alimentação",
    "subCategoryId": "sub-456",
    "subCategoryName": "Delivery",
    "confidence": 1.0,
    "source": "ADMIN_APPROVED",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Campos de resposta:**
- `synonym.userId`: Sempre "GLOBAL" para sinônimos globais
- `synonym.confidence`: Sempre 1.0 para sinônimos aprovados por admin
- `synonym.source`: "ADMIN_APPROVED" indica criação manual

**Efeito colateral:**
- Cache RAG é limpo automaticamente para forçar reindexação

---

## POST /admin/rag/synonym/user

### Descrição
Cria sinônimo personalizado para um usuário específico.

### Para que serve
- Resolver problemas de matching para usuário individual
- Criar sinônimos personalizados baseados no uso do usuário
- Testar sinônimos antes de aplicar globalmente

### Input

**Endpoint:** `POST /admin/rag/synonym/user`

**Headers:**
```
Content-Type: application/json
x-admin-key: <ADMIN_API_KEY>
```

**Body:**
```json
{
  "userId": "550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61",
  "keyword": "padaria do zé",
  "categoryId": "cat-123",
  "subCategoryId": "sub-789"
}
```

**Parâmetros:**
- `userId` (string, obrigatório): ID do usuário no cache
- `keyword` (string, obrigatório): Palavra-chave ou termo do sinônimo
- `categoryId` (string, obrigatório): ID da categoria associada
- `subCategoryId` (string, opcional): ID da subcategoria associada

### Output

**Status:** `201 Created`

```json
{
  "message": "Sinônimo criado com sucesso para o usuário",
  "synonym": {
    "id": "syn-user-456",
    "userId": "gasto-certo-id-789",
    "keyword": "padaria do zé",
    "categoryId": "cat-123",
    "categoryName": "Alimentação",
    "subCategoryId": "sub-789",
    "subCategoryName": "Padaria",
    "confidence": 0.9,
    "source": "ADMIN_APPROVED",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Campos de resposta:**
- `synonym.userId`: gastoCertoId do usuário
- `synonym.confidence`: 0.9 para sinônimos de usuário (ligeiramente menor que global)
- `synonym.source`: "ADMIN_APPROVED"

---

## GET /admin/rag/synonyms/:userId

### Descrição
Lista todos os sinônimos de um usuário específico.

### Para que serve
- Visualizar sinônimos personalizados do usuário
- Auditar sinônimos criados automaticamente pelo sistema
- Validar configuração de sinônimos antes de testes

### Input

**Endpoint:** `GET /admin/rag/synonyms/:userId`

**Headers:**
```
x-admin-key: <ADMIN_API_KEY>
```

**Parâmetros URL:**
- `userId` (string, obrigatório): ID do usuário no cache

**Exemplo:**
```
GET /admin/rag/synonyms/550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61
```

### Output

**Status:** `200 OK`

```json
[
  {
    "id": "syn-123",
    "userId": "gasto-certo-id-789",
    "keyword": "ifood",
    "categoryId": "cat-123",
    "categoryName": "Alimentação",
    "subCategoryId": "sub-456",
    "subCategoryName": "Delivery",
    "confidence": 0.95,
    "usageCount": 25,
    "source": "LEARNING",
    "createdAt": "2026-01-10T12:00:00Z",
    "updatedAt": "2026-01-13T10:00:00Z"
  },
  {
    "id": "syn-456",
    "userId": "gasto-certo-id-789",
    "keyword": "uber",
    "categoryId": "cat-789",
    "categoryName": "Transporte",
    "subCategoryId": "sub-321",
    "subCategoryName": "App de Transporte",
    "confidence": 0.9,
    "usageCount": 18,
    "source": "ADMIN_APPROVED",
    "createdAt": "2026-01-12T08:00:00Z",
    "updatedAt": "2026-01-12T08:00:00Z"
  }
]
```

**Campos de resposta:**
- Array ordenado por `confidence` (maior → menor)
- `source`: Origem do sinônimo
  - `LEARNING`: Criado automaticamente pelo sistema
  - `ADMIN_APPROVED`: Criado manualmente por admin
  - `USER_CONFIRMED`: Confirmado pelo usuário
- `usageCount`: Quantas vezes o sinônimo foi usado

---

## GET /admin/rag/logs/:userId

### Descrição
Busca logs de tentativas RAG de um usuário. Útil para ver queries que não deram match.

### Para que serve
- Identificar padrões de falha no matching
- Descobrir termos que precisam de sinônimos
- Analisar comportamento de busca do usuário
- Gerar estatísticas de acurácia do RAG

### Input

**Endpoint:** `GET /admin/rag/logs/:userId`

**Headers:**
```
x-admin-key: <ADMIN_API_KEY>
```

**Parâmetros URL:**
- `userId` (string, obrigatório): ID do usuário no cache

**Query Parameters:**
- `failedOnly` (boolean, opcional): Se "true", retorna apenas logs de falha
- `limit` (number, opcional): Número máximo de resultados (padrão: 50)

**Exemplos:**
```
GET /admin/rag/logs/550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61
GET /admin/rag/logs/550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61?failedOnly=true
GET /admin/rag/logs/550a1c96-7e4e-4bb5-b2d2-7ef10f49cb61?failedOnly=true&limit=100
```

### Output

**Status:** `200 OK`

```json
[
  {
    "id": "log-123",
    "userId": "gasto-certo-id-789",
    "query": "compra no mercado",
    "normalizedQuery": "compra mercado",
    "success": true,
    "matchCount": 1,
    "bestScore": 0.87,
    "categoryId": "cat-456",
    "categoryName": "Alimentação",
    "subCategoryId": "sub-789",
    "subCategoryName": "Supermercado",
    "processingTimeMs": 32,
    "createdAt": "2026-01-13T11:30:00Z"
  },
  {
    "id": "log-456",
    "userId": "gasto-certo-id-789",
    "query": "padaria do zé",
    "normalizedQuery": "padaria ze",
    "success": false,
    "matchCount": 0,
    "bestScore": 0.12,
    "categoryId": null,
    "categoryName": null,
    "subCategoryId": null,
    "subCategoryName": null,
    "processingTimeMs": 28,
    "createdAt": "2026-01-13T10:15:00Z"
  }
]
```

**Campos de resposta:**
- Array ordenado por `createdAt` (mais recente → mais antigo)
- `success`: true se encontrou match com score ≥ threshold
- `matchCount`: Número de categorias que deram match
- `bestScore`: Maior score obtido (0-1)
- Campos `category*`: null quando `success = false`

---

## GET /admin/rag/stats

### Descrição
Retorna estatísticas gerais do sistema RAG para análise de performance e qualidade.

### Para que serve
- Monitorar taxa de sucesso do RAG
- Identificar necessidade de novos sinônimos
- Analisar tempo de resposta
- Ver distribuição de uso por usuário
- Acompanhar evolução ao longo do tempo

### Input

**Endpoint:** `GET /admin/rag/stats`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**
- `days` (number, opcional): Número de dias para análise (padrão: 7)

**Exemplos:**
```
GET /admin/rag/stats
GET /admin/rag/stats?days=7
GET /admin/rag/stats?days=30
```

### Output

**Status:** `200 OK`

```json
{
  "success": true,
  "period": {
    "days": 7,
    "from": "2026-01-06T10:00:00Z",
    "to": "2026-01-13T10:00:00Z"
  },
  "stats": {
    "totalSearches": 1523,
    "successfulSearches": 1289,
    "successRate": "84.63%",
    "aiFallbackSearches": 234,
    "aiFallbackRate": "15.37%",
    "avgRagScore": "0.7234",
    "avgResponseTime": "45ms",
    "needsSynonymLearning": 178,
    "topUsers": [
      {
        "userId": "user-123",
        "searches": 234
      },
      {
        "userId": "user-456",
        "searches": 189
      }
    ],
    "flowStepDistribution": [
      {
        "step": "1/2",
        "count": 856
      },
      {
        "step": "2/2",
        "count": 667
      }
    ]
  },
  "timestamp": "2026-01-13T10:00:00Z"
}
```

**Campos de resposta:**
- `period`: Período analisado
- `stats.totalSearches`: Total de buscas RAG realizadas
- `stats.successfulSearches`: Buscas que encontraram categoria
- `stats.successRate`: % de sucesso (quanto maior, melhor)
- `stats.aiFallbackSearches`: Buscas que precisaram de AI como fallback
- `stats.aiFallbackRate`: % de uso de AI fallback (quanto menor, melhor o RAG)
- `stats.avgRagScore`: Score médio do RAG (0-1, ideal > 0.7)
- `stats.avgResponseTime`: Tempo médio de resposta
- `stats.needsSynonymLearning`: Queries que precisam de sinônimos
- `stats.topUsers`: Usuários que mais usam o RAG
- `stats.flowStepDistribution`: Distribuição por etapa do fluxo

**Interpretação:**
- **Success Rate > 80%**: RAG está funcionando bem
- **AI Fallback Rate < 20%**: RAG está cobrindo maioria dos casos
- **Avg RAG Score > 0.7**: Confiança alta nos matches
- **Avg Response Time < 100ms**: Performance adequada

---

## 🔐 Autenticação

Todos os endpoints requerem autenticação JWT via header:
```
Authorization: Bearer <JWT_TOKEN>
```

**Como obter o token:**
1. Fazer login no GastoCerto Admin
2. Copiar o token JWT da sessão
3. Usar nos requests

**Exemplo com curl:**
```bash
curl -X GET "http://localhost:4444/admin/rag/stats?days=7" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Exemplo com Postman:**
1. Aba "Authorization"
2. Type: "Bearer Token"
3. Token: `<seu-jwt-token>`

**⚠️ Importante:** 
- O token JWT é obtido através do login no GastoCerto Admin API
- Não confundir com `x-admin-key` (usado em outros endpoints)
- Token expira após determinado período (configurável)

---

## 📊 Fluxo de Trabalho Recomendado

### 1. Analisar problemas de matching
```bash
# 1. Ver logs de falhas do usuário
GET /admin/rag/logs/{userId}?failedOnly=true

# 2. Analisar query específica que falhou
POST /admin/rag/analyze
{
  "userId": "...",
  "query": "termo que falhou"
}

# 3. Testar com sinônimo antes de criar
POST /admin/rag/test-match
{
  "userId": "...",
  "query": "termo que falhou"
}
```

### 2. Criar sinônimos
```bash
# Sinônimo específico do usuário (teste)
POST /admin/rag/synonym/user
{
  "userId": "...",
  "keyword": "termo",
  "categoryId": "...",
  "subCategoryId": "..."
}

# Se funcionar bem, aplicar globalmente
POST /admin/rag/synonym/global
{
  "keyword": "termo",
  "categoryId": "...",
  "subCategoryId": "..."
}
```

### 3. Validar resultado
```bash
# Testar matching com novo sinônimo
POST /admin/rag/test-match
{
  "userId": "...",
  "query": "termo"
}

# Verificar sinônimos do usuário
GET /admin/rag/synonyms/{userId}
```

---

## 🎯 Casos de Uso

### Caso 1: Marca não reconhecida
**Problema:** "ifood" não associa com Alimentação/Delivery

**Solução:**
```bash
POST /admin/rag/synonym/global
{
  "keyword": "ifood",
  "categoryId": "alimentacao-id",
  "subCategoryId": "delivery-id"
}
```

### Caso 2: Termo regional
**Problema:** Usuário usa "piá" (filho em paranaense) mas sistema não reconhece

**Solução:**
```bash
POST /admin/rag/synonym/user
{
  "userId": "usuario-id",
  "keyword": "piá",
  "categoryId": "educacao-id",
  "subCategoryId": "escola-id"
}
```

### Caso 3: Score baixo sem motivo aparente
**Problema:** Query deveria dar match mas o score é baixo

**Solução:**
```bash
# 1. Analisar em detalhes
POST /admin/rag/analyze
{
  "userId": "...",
  "query": "query problemática"
}

# 2. Ver tokens e categorias avaliadas
# 3. Criar sinônimo se necessário
```

---

## 📈 Métricas de Qualidade

### Scores de Match
- **0.7 - 1.0**: Match forte (confiança alta)
- **0.3 - 0.7**: Match médio (revisar)
- **0.0 - 0.3**: Match fraco (criar sinônimo)

### Confidence de Sinônimos
- **1.0**: Sinônimo global aprovado por admin
- **0.9**: Sinônimo de usuário aprovado por admin
- **0.8 - 0.9**: Sinônimo aprendido automaticamente (alta confiança)
- **0.5 - 0.8**: Sinônimo aprendido automaticamente (confiança média)
- **< 0.5**: Sinônimo provisório (validar antes de usar)

---

## 🛠️ Troubleshooting

### Sinônimo não está funcionando
1. Verificar se cache foi limpo: sinônimos globais limpam automaticamente
2. Verificar se keyword está normalizada (lowercase, sem acentos)
3. Testar com `/test-match` para validar

### Score inesperado
1. Usar `/analyze` para ver todos os scores
2. Verificar `matchedTokens` para entender o matching
3. Comparar query normalizada com categoria normalizada

### Logs não aparecem
1. Verificar se userId está correto (é o ID do cache, não gastoCertoId)
2. Verificar se o usuário já fez buscas RAG
3. Tentar sem filtro `failedOnly` primeiro

---

## 📚 Referências

- [RAG_COMO_FUNCIONA.md](RAG_COMO_FUNCIONA.md) - Explicação do sistema RAG
- [RAG_OPTIMIZATION_GUIDE.md](RAG_OPTIMIZATION_GUIDE.md) - Guia de otimização
- [SINONIMOS_IMPLEMENTACAO_COMPLETA.md](SINONIMOS_IMPLEMENTACAO_COMPLETA.md) - Sistema de sinônimos
