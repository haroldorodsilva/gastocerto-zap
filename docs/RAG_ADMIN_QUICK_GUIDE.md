# 🎯 RAG Admin API - Guia Rápido

## Endpoints Disponíveis

### 📊 1. Estatísticas Gerais
```bash
GET /admin/rag/stats?year=2026&month=1
GET /admin/rag/stats?days=7
```
**Retorna:** Estatísticas completas incluindo taxa de sucesso, top queries, usuários, categorias, custos AI
**Doc completa:** [RAG_ADMIN_STATS_API.md](./RAG_ADMIN_STATS_API.md)

---

### 📋 2. Lista de Logs (Resumida)
```bash
GET /admin/rag/search-logs?limit=20&offset=0
GET /admin/rag/search-logs?userId=USER_ID&failedOnly=true
```
**Retorna:** Lista resumida com `userName`, query, resultado, score
**Campos:** id, userId, userName, query, bestMatch, bestScore, success, responseTime

---

### 🔍 3. Detalhes Completos de Log
```bash
GET /admin/rag/search-logs/:id/details
```
**Retorna:** TODOS os dados possíveis:
- RAG log completo
- Dados do usuário
- Transações vinculadas
- Logs de IA (tokens, custos)
- Sinônimos relacionados
- Análise RAG

---

### 🔄 4. Testar Match (Debug Completo)
```bash
POST /admin/rag/test-match
Content-Type: application/json

{
  "userId": "26f80295-58b1-4063-b6e6-c688869ff8d0",
  "query": "gastei no mercado 50 reais com coca cola"
}
```
**Retorna:**
- `matches`: Categorias encontradas com scores
- `transactionBody`: Body pronto para criar transação na API
- `debug`: Info de processamento (tokens, categorias indexadas)
- `topNonMatchingCategories`: Top 10 categorias mais próximas

**Uso:** Debug detalhado do matching e obter body pronto para transação

---

### 🔄 5. Revalidar Mensagem (Sem Log)
```bash
POST /admin/rag/revalidate
Content-Type: application/json

{
  "userId": "5511999999999",
  "message": "gastei na farmácia"
}
```
**Uso:** Testar matching sem criar registro RAG

---

### ➕ 6. Adicionar Sinônimo Global
```bash
POST /admin/rag/global-synonyms
Content-Type: application/json

{
  "term": "farmácia",
  "targetCategory": "Saúde",
  "targetSubCategory": "Farmácia"
}
```
**Uso:** Criar sinônimos administrativos (userId='GLOBAL')

---

### 👤 7. Logs de Usuário Específico
```bash
GET /admin/rag/user-logs/:userId?limit=50&onlyFailed=true
```
**Retorna:** Logs RAG filtrados por usuário com paginação

---

### 🔍 8. Buscar Categorias do Usuário
```bash
GET /admin/users/:userId/summary
```
**Retorna:** Dados completos incluindo `categories` e `accounts`
**Uso:** Exibir categorias disponíveis no admin RAG

---

## 🎯 Fluxo de Análise Recomendado

### 1️⃣ Visão Geral (Dashboard)
```bash
# Stats dos últimos 7 dias
curl /admin/rag/stats?days=7
```
**Olhar:** `successRate`, `aiFallbackRate`, `avgResponseTimeMs`

### 2️⃣ Identificar Problemas
```bash
# Queries que mais falham
curl /admin/rag/stats?days=30 | jq '.topFailedQueries'
```
**Ação:** Adicionar sinônimos para queries problemáticas

### 3️⃣ Analisar Caso Específico
```bash
# Buscar logs da query problemática
curl '/admin/rag/search-logs?limit=50' | jq '.data[] | select(.query == "pro labore")'

# Pegar ID do log e ver detalhes completos
curl /admin/rag/search-logs/LOG_ID/details
```

### 4️⃣ Criar Sinônimo
```bash
curl -X POST /admin/rag/global-synonyms \
  -H "Content-Type: application/json" \
  -d '{"term":"pro labore","targetCategory":"Receitas","targetSubCategory":"Salário"}'
```

### 5️⃣ Testar Solução
```bash
curl -X POST /admin/rag/revalidate \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_ID","message":"pro labore"}'
```

### 6️⃣ Validar Melhoria
```bash
# Após 1 semana, verificar se query não aparece mais em topFailedQueries
curl /admin/rag/stats?days=7 | jq '.topFailedQueries'
```

---

## 📈 KPIs Importantes

| Métrica | Meta | Crítico |
|---------|------|---------|
| `successRate` | > 85% | < 70% |
| `aiFallbackRate` | < 15% | > 30% |
| `avgResponseTimeMs` | < 100ms | > 500ms |
| `needsSynonymLearning` | Decrescente | Crescente |

---

## 🔧 Comandos Úteis

### Ver taxa de sucesso mensal de 2026
```bash
for month in {1..12}; do
  echo "Mês $month:"
  curl -s "/admin/rag/stats?year=2026&month=$month" | jq -r '.summary.successRate'
done
```

### Exportar top queries problemáticas para CSV
```bash
curl -s '/admin/rag/stats?days=30' | \
  jq -r '.topFailedQueries[] | [.query, .count] | @csv' > failed_queries.csv
```

### Listar todos os logs de falha de um usuário
```bash
curl -s "/admin/rag/user-logs/USER_ID?onlyFailed=true&limit=100" | \
  jq '.data[] | {query, score: .bestScore, time: .createdAt}'
```

### Calcular custo total de IA em 2026
```bash
curl -s '/admin/rag/stats?year=2026' | jq '.aiUsage.totalCost'
```

---

## � Exemplo Completo: Testando e Criando Transação

### Passo 1: Testar o matching
```bash
curl -X POST "http://localhost:4444/admin/rag/test-match" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "26f80295-58b1-4063-b6e6-c688869ff8d0",
    "query": "gastei no mercado 50 reais com coca cola"
  }'
```

### Resposta de exemplo:
```json
{
  "matches": [
    {
      "categoryId": "cat_123",
      "categoryName": "Alimentação",
      "subCategoryId": "subcat_456",
      "subCategoryName": "Supermercado",
      "score": 0.85,
      "accountId": "acc_001"
    }
  ],
  "transactionBody": {
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
    "accountId": "acc_001",
    "type": "EXPENSES",
    "amount": 50.0,
    "categoryId": "cat_123",
    "subCategoryId": "subcat_456",
    "description": "gastei no mercado 50 reais com coca cola",
    "date": "2026-01-13",
    "source": "telegram"
  },
  "debug": {
    "processingTimeMs": 45,
    "queryNormalized": "gastei mercado 50 reais coca cola",
    "queryTokens": ["gastei", "mercado", "50", "reais", "coca", "cola"],
    "totalCategoriesIndexed": 45,
    "threshold": 0.4
  }
}
```

### Passo 2: Usar o body retornado para criar transação
```bash
# Copiar o campo "transactionBody" e usar diretamente
curl -X POST "http://localhost:4444/api/external/transactions" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
    "accountId": "acc_001",
    "type": "EXPENSES",
    "amount": 50.0,
    "categoryId": "cat_123",
    "subCategoryId": "subcat_456",
    "description": "gastei no mercado 50 reais com coca cola",
    "date": "2026-01-13",
    "source": "telegram"
  }'
```

### ⚠️ Troubleshooting

**Problema:** `"Nenhuma categoria indexada para usuário"`

**Solução:**
```bash
# 1. Sincronizar categorias do usuário
curl -X POST "http://localhost:4444/admin/users/3b120ec5-3ca1-4b72-95ed-f80af6632db2/sync-categories"

# 2. Verificar se categorias foram sincronizadas
curl "http://localhost:4444/admin/users/3b120ec5-3ca1-4b72-95ed-f80af6632db2/summary" | jq '.data.categories'

# 3. Testar novamente
curl -X POST "http://localhost:4444/admin/rag/test-match" -d '...'
```

---

## �🚨 Alertas Recomendados

### 1. Taxa de Sucesso Baixa
```bash
successRate=$(curl -s '/admin/rag/stats?days=1' | jq -r '.summary.successRate' | sed 's/%//')
if (( $(echo "$successRate < 80" | bc -l) )); then
  echo "⚠️ ALERTA: Taxa de sucesso em $successRate%"
fi
```

### 2. AI Fallback Alto
```bash
aiFallback=$(curl -s '/admin/rag/stats?days=1' | jq -r '.summary.aiFallbackRate' | sed 's/%//')
if (( $(echo "$aiFallback > 20" | bc -l) )); then
  echo "⚠️ ALERTA: AI Fallback em $aiFallback% - RAG precisa de otimização"
fi
```

### 3. Tempo de Resposta Alto
```bash
avgTime=$(curl -s '/admin/rag/stats?days=1' | jq '.summary.avgResponseTimeMs')
if (( avgTime > 200 )); then
  echo "⚠️ ALERTA: Tempo médio em ${avgTime}ms - Performance degradada"
fi
```

---

## 📚 Documentação Completa

- **Stats API:** [RAG_ADMIN_STATS_API.md](./RAG_ADMIN_STATS_API.md)
- **Debug Learning:** [RAG_LEARNING_DEBUG_GUIDE.md](./RAG_LEARNING_DEBUG_GUIDE.md)
- **RAG Flow:** [RAG_FLOW.md](./RAG_FLOW.md)
- **Smart Learning:** [RAG_SMART_LEARNING_COMPLETE.md](./RAG_SMART_LEARNING_COMPLETE.md)
