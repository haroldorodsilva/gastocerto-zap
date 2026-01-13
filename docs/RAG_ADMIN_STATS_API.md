# 📊 API de Estatísticas RAG - Documentação Completa

## Endpoint: GET `/admin/rag/stats`

Retorna estatísticas completas do sistema RAG com suporte a filtros por período.

---

## 🎯 Métodos de Filtragem

### 1. Por Ano Completo
```bash
GET /admin/rag/stats?year=2026
```
Retorna estatísticas de **01/01/2026 até 31/12/2026**

### 2. Por Mês Específico
```bash
GET /admin/rag/stats?year=2026&month=1
```
Retorna estatísticas de **janeiro de 2026**
- `month`: 1 (janeiro) até 12 (dezembro)

### 3. Por Últimos N Dias (padrão)
```bash
GET /admin/rag/stats?days=30
```
Retorna estatísticas dos **últimos 30 dias**
- Padrão: `days=7` (última semana)

---

## 📋 Resposta Completa

```json
{
  "success": true,
  "period": {
    "label": "01/2026",
    "from": "2026-01-01T00:00:00.000Z",
    "to": "2026-01-31T23:59:59.999Z"
  },
  "summary": {
    "totalSearches": 1250,
    "successfulSearches": 1100,
    "failedSearches": 150,
    "successRate": "88.00%",
    "aiFallbackSearches": 120,
    "aiFallbackRate": "9.60%",
    "avgRagScore": "0.8234",
    "avgResponseTimeMs": 45,
    "needsSynonymLearning": 35
  },
  "topUsers": [
    {
      "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
      "userName": "João Silva",
      "searches": 245
    },
    {
      "userId": "7f8a9b3c-2d1e-4a5b-9c8d-1e2f3a4b5c6d",
      "userName": "Maria Santos",
      "searches": 189
    }
  ],
  "topQueries": [
    {
      "query": "gastei no mercado",
      "count": 87
    },
    {
      "query": "paguei a conta de luz",
      "count": 65
    },
    {
      "query": "uber",
      "count": 54
    }
  ],
  "topFailedQueries": [
    {
      "query": "pro labore",
      "count": 23
    },
    {
      "query": "rotativo do cartão",
      "count": 18
    },
    {
      "query": "reembolso das",
      "count": 12
    }
  ],
  "topCategories": [
    {
      "category": "Alimentação",
      "count": 342
    },
    {
      "category": "Transporte",
      "count": 198
    },
    {
      "category": "Moradia",
      "count": 156
    },
    {
      "category": "Saúde",
      "count": 124
    }
  ],
  "flowStepDistribution": [
    {
      "step": 1,
      "totalSteps": 1,
      "label": "Step 1/1",
      "count": 1100
    },
    {
      "step": 1,
      "totalSteps": 2,
      "label": "Step 1/2",
      "count": 120
    },
    {
      "step": 2,
      "totalSteps": 2,
      "label": "Step 2/2",
      "count": 30
    }
  ],
  "ragModeDistribution": [
    {
      "mode": "BM25",
      "count": 1130
    },
    {
      "mode": "AI",
      "count": 120
    }
  ],
  "aiUsage": {
    "totalLogs": 155,
    "totalTokens": 45230,
    "totalCost": 0.1256
  },
  "timestamp": "2026-01-13T15:30:00.000Z"
}
```

---

## 📊 Campos Detalhados

### **period**
- `label`: Descrição do período filtrado ("01/2026", "2026", "Últimos 7 dias")
- `from`: Data inicial (ISO 8601)
- `to`: Data final (ISO 8601)

### **summary**
- `totalSearches`: Total de buscas RAG realizadas
- `successfulSearches`: Buscas que encontraram categoria com score >= threshold
- `failedSearches`: Buscas que falharam (score < threshold)
- `successRate`: Taxa de sucesso em %
- `aiFallbackSearches`: Buscas que precisaram de AI fallback (RAG falhou)
- `aiFallbackRate`: Taxa de uso de AI fallback em %
- `avgRagScore`: Score médio do RAG (0.0000 a 1.0000)
- `avgResponseTimeMs`: Tempo médio de resposta em milissegundos
- `needsSynonymLearning`: Queries que precisam de aprendizado de sinônimos

### **topUsers**
Top 10 usuários que mais usaram o RAG
- `userId`: gastoCertoId do usuário
- `userName`: Nome do usuário (busca no cache)
- `searches`: Número de buscas realizadas

### **topQueries**
Top 20 queries mais frequentes
- `query`: Texto da query
- `count`: Número de vezes que foi buscada

### **topFailedQueries**
Top 20 queries que mais falharam
- `query`: Texto da query que falhou
- `count`: Número de falhas

**💡 Use para:** Identificar termos que precisam de sinônimos

### **topCategories**
Top 20 categorias mais encontradas
- `category`: Nome da categoria
- `count`: Número de matches

**💡 Use para:** Entender padrões de uso

### **flowStepDistribution**
Distribuição por etapas do fluxo RAG
- `step`: Etapa atual (1, 2 ou 3)
- `totalSteps`: Total de etapas executadas
- `label`: Descrição legível
- `count`: Quantidade

**Interpretação:**
- `Step 1/1`: RAG encontrou direto (ideal)
- `Step 1/2`: RAG falhou, usou AI fallback
- `Step 2/2`: AI retornou categoria
- `Step 1/3`: RAG → AI → RAG validação

### **ragModeDistribution**
Modos de operação do RAG
- `mode`: "BM25" (padrão) ou "AI" (embeddings)
- `count`: Quantidade de usos

### **aiUsage**
Estatísticas de uso de IA
- `totalLogs`: Total de chamadas de IA registradas
- `totalTokens`: Total de tokens consumidos
- `totalCost`: Custo total estimado em USD

---

## 🎯 Exemplos de Uso

### Dashboard Geral (Últimos 7 dias)
```bash
curl "http://localhost:4444/admin/rag/stats"
```

### Relatório Mensal
```bash
curl "http://localhost:4444/admin/rag/stats?year=2026&month=1"
```

### Relatório Anual
```bash
curl "http://localhost:4444/admin/rag/stats?year=2025"
```

### Análise de Tendência (Últimos 30 dias)
```bash
curl "http://localhost:4444/admin/rag/stats?days=30"
```

### Comparar Meses
```bash
# Janeiro
curl "http://localhost:4444/admin/rag/stats?year=2026&month=1" > jan.json

# Fevereiro
curl "http://localhost:4444/admin/rag/stats?year=2026&month=2" > fev.json

# Comparar
diff jan.json fev.json
```

---

## 📈 Casos de Uso

### 1. **Monitoramento de Performance**
```bash
# Ver se RAG está performando bem
curl "http://localhost:4444/admin/rag/stats?days=7" | jq '.summary.successRate'
```

**Meta:** > 85% de taxa de sucesso

### 2. **Identificar Termos Problemáticos**
```bash
# Queries que mais falham
curl "http://localhost:4444/admin/rag/stats?year=2026&month=1" | jq '.topFailedQueries'
```

**Ação:** Criar sinônimos para essas queries

### 3. **Análise de Custos de IA**
```bash
# Custo mensal de IA
curl "http://localhost:4444/admin/rag/stats?year=2026&month=1" | jq '.aiUsage.totalCost'
```

**Meta:** Minimizar uso de AI fallback (otimizar RAG)

### 4. **Usuários Power Users**
```bash
# Top usuários
curl "http://localhost:4444/admin/rag/stats?days=30" | jq '.topUsers'
```

**Uso:** Entender perfil de uso, engagement

### 5. **Padrões de Categorias**
```bash
# Categorias mais usadas
curl "http://localhost:4444/admin/rag/stats?year=2026" | jq '.topCategories'
```

**Uso:** Entender necessidades dos usuários

### 6. **Eficiência do Fluxo**
```bash
# Ver quantas buscas precisam de AI
curl "http://localhost:4444/admin/rag/stats?days=7" | jq '.flowStepDistribution'
```

**Meta:** Maximizar `Step 1/1` (RAG direto)

---

## 🔧 Integração com Dashboards

### Grafana
```sql
-- Prometheus metrics
rag_success_rate{period="7d"}
rag_ai_fallback_rate{period="7d"}
rag_avg_response_time{period="7d"}
```

### Retool / Admin Panel
```javascript
// Buscar stats do último mês
const stats = await fetch('/admin/rag/stats?days=30').then(r => r.json());

// Exibir gráfico de taxa de sucesso
chart.data = {
  labels: ['Sucesso', 'Falha'],
  values: [stats.summary.successfulSearches, stats.summary.failedSearches]
};
```

---

## ⚠️ Considerações de Performance

### Período Grande = Lento
```bash
# ❌ Evitar: ano inteiro em produção com milhões de registros
curl "http://localhost:4444/admin/rag/stats?year=2025"

# ✅ Melhor: usar agregação mensal
for month in {1..12}; do
  curl "http://localhost:4444/admin/rag/stats?year=2025&month=$month"
done
```

### Cache Recomendado
- Stats por mês: Cache de 1 hora
- Stats por dia: Cache de 5 minutos
- Stats em tempo real: Sem cache

---

## 🚀 Próximas Features

- [ ] Filtro por usuário específico
- [ ] Filtro por categoria
- [ ] Comparação entre períodos
- [ ] Export para CSV/Excel
- [ ] Gráficos em SVG/PNG
- [ ] Alerts automáticos (taxa < 80%)
- [ ] Previsão de custos IA

---

## 📞 Suporte

Para dúvidas ou problemas:
- Logs: Buscar por `📊 Admin solicitou estatísticas gerais do RAG`
- Endpoint completo: `/admin/rag/stats?year=YYYY&month=MM`
- Status do endpoint: Verificar se retorna `success: true`
