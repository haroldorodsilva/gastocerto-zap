# 📊 Rastreamento e Análise do Fluxo RAG → IA → RAG

## 🎯 Objetivo

Este documento explica como funciona o rastreamento completo do fluxo de categorização, desde a busca RAG inicial até o fallback para IA e validação final. O objetivo é ter visibilidade total dos resultados de cada step para identificar oportunidades de melhoria e extração de sinônimos.

---

## 🔄 Fluxo Completo de Categorização

```
┌─────────────────────────────────────────────────────────────┐
│                    STEP 1: RAG INICIAL                       │
│  Busca por similaridade (BM25 ou Embeddings)                │
│  Threshold: 0.60 (60%)                                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ├─── Score >= 0.60? ──────┐
                          │                          │
                         NÃO                        SIM
                          │                          │
                          ▼                          ▼
┌─────────────────────────────────────────┐   ┌──────────────┐
│         STEP 2: IA FALLBACK              │   │   SUCESSO    │
│  IA analisa e sugere categoria           │   │  Categoria   │
│  Provider: openai/groq/gemini/deepseek   │   │  encontrada  │
└─────────────────────────────────────────┘   └──────────────┘
                          │
                          ▼
┌─────────────────────────────────────────┐
│      STEP 3: RAG VALIDAÇÃO FINAL        │
│  Valida resultado da IA no RAG          │
│  (opcional - se implementado)           │
└─────────────────────────────────────────┘
```

---

## 📝 Modelos de Log Atualizados

### 1. RAGSearchLog

Registra **CADA TENTATIVA** de busca RAG (step 1 e step 3).

#### Campos Principais:
- `query`: Texto original da busca (ex: "rotativo", "gasolina", "pro labore")
- `queryNormalized`: Query normalizada (lowercase, sem acentos)
- `matches`: Array JSON com todos os matches e scores
- `bestMatch` / `bestScore`: Melhor resultado encontrado
- `threshold`: Threshold usado (ex: 0.60)
- `success`: `true` se `bestScore >= threshold`
- `ragMode`: `"BM25"` ou `"AI"` (se usou embeddings)

#### 🆕 Campos de Rastreamento do Fluxo:
- `flowStep`: `1` (RAG inicial) ou `3` (RAG validação final)
- `totalSteps`: Total de steps executados no fluxo completo (1, 2 ou 3)
- `aiProvider`: Provider usado se `ragMode="AI"` ou se foi step 2 (ex: "openai", "groq")
- `aiModel`: Modelo usado (ex: "text-embedding-ada-002", "gpt-4o")
- `aiConfidence`: Confiança da IA (se usou IA no step 2)
- `aiCategoryId` / `aiCategoryName`: Categoria que a IA retornou (step 2)
- `finalCategoryId` / `finalCategoryName`: Categoria final escolhida
- `ragInitialScore`: Score do RAG no step 1 (mesmo que não passou threshold)
- `ragFinalScore`: Score do RAG no step 3 (se houver validação)
- `wasAiFallback`: `true` se precisou usar IA porque RAG falhou

#### Exemplos de Uso:

**Cenário 1: RAG acertou de primeira (1 step)**
```json
{
  "query": "gasolina",
  "bestScore": 0.85,
  "success": true,
  "flowStep": 1,
  "totalSteps": 1,
  "ragMode": "BM25",
  "wasAiFallback": false
}
```

**Cenário 2: RAG falhou → IA acertou (2 steps)**
```json
// Log 1 - RAG inicial (step 1)
{
  "query": "pro labore",
  "bestScore": 0.45,
  "success": false,
  "flowStep": 1,
  "totalSteps": 2,
  "ragMode": "BM25",
  "ragInitialScore": 0.45,
  "wasAiFallback": true
}

// Log 2 - IA fallback (step 2) - vai para AIUsageLog
// Ver seção AIUsageLog abaixo

// Log 3 - RAG validação (step 3) - OPCIONAL
{
  "query": "pro labore",
  "bestScore": 0.50,
  "success": false,
  "flowStep": 3,
  "totalSteps": 2,
  "ragMode": "BM25",
  "ragFinalScore": 0.50,
  "aiCategoryName": "Receitas → Salário",
  "finalCategoryName": "Receitas → Salário",
  "wasAiFallback": true
}
```

---

### 2. AIUsageLog

Registra **TODA CHAMADA DE IA**, incluindo contexto do RAG.

#### Campos Principais:
- `provider`: "openai", "groq", "google_gemini", "deepseek"
- `model`: "gpt-4o", "llama-3.3-70b-versatile", etc
- `operation`: `CATEGORY_SUGGESTION`, `TRANSACTION_EXTRACTION`, etc
- `inputTokens` / `outputTokens` / `totalTokens`
- `estimatedCost`: Custo em USD
- `responseTime`: Tempo de resposta em ms

#### 🆕 Campos de Contexto RAG:
- `ragSearchLogId`: ID do RAGSearchLog relacionado (vincula com step 1)
- `ragInitialFound`: `true` se RAG encontrou algo no step 1 (mesmo abaixo do threshold)
- `ragInitialScore`: Score do RAG inicial (step 1)
- `ragInitialCategory`: Categoria que RAG sugeriu no step 1
- `aiCategoryId` / `aiCategoryName`: Categoria que IA retornou
- `aiConfidence`: Confiança da IA (0-1)
- `finalCategoryId` / `finalCategoryName`: Categoria final escolhida
- `wasRagFallback`: `true` se foi fallback de RAG que falhou
- `needsSynonymLearning`: `true` se deve extrair sinônimos desta interação

#### Exemplo de Uso:

**IA acertou quando RAG falhou:**
```json
{
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "operation": "CATEGORY_SUGGESTION",
  "ragSearchLogId": "uuid-do-rag-log-step-1",
  "ragInitialFound": true,
  "ragInitialScore": 0.45,
  "ragInitialCategory": "Despesas → Diversos",
  "aiCategoryName": "Receitas → Salário",
  "aiConfidence": 0.95,
  "finalCategoryName": "Receitas → Salário",
  "wasRagFallback": true,
  "needsSynonymLearning": true  // 🔥 IMPORTANTE: Marcar para análise
}
```

---

## 🔍 Queries de Análise

### 1. **Casos onde RAG falhou mas IA acertou** (candidatos a sinônimos)

```sql
-- Buscar situações onde RAG não achou nada mas IA resolveu
SELECT 
  ai.inputText as query_original,
  ai.ragInitialScore as rag_score,
  ai.ragInitialCategory as rag_sugestao,
  ai.aiCategoryName as ia_categoria,
  ai.aiConfidence as ia_confianca,
  ai.finalCategoryName as categoria_final,
  COUNT(*) as ocorrencias
FROM ai_usage_logs ai
WHERE 
  ai.wasRagFallback = true
  AND ai.success = true
  AND ai.needsSynonymLearning = true
  AND ai.createdAt >= NOW() - INTERVAL '30 days'
GROUP BY 
  ai.inputText, 
  ai.ragInitialScore, 
  ai.ragInitialCategory,
  ai.aiCategoryName, 
  ai.aiConfidence,
  ai.finalCategoryName
HAVING COUNT(*) >= 2  -- Mínimo 2 ocorrências para considerar padrão
ORDER BY ocorrencias DESC, ai.aiConfidence DESC
LIMIT 50;
```

**Output esperado:**
| query_original | rag_score | rag_sugestao | ia_categoria | ia_confianca | categoria_final | ocorrencias |
|----------------|-----------|--------------|--------------|--------------|-----------------|-------------|
| pro labore     | 0.45      | Diversos     | Receitas → Salário | 0.95 | Receitas → Salário | 15 |
| das simples    | 0.38      | null         | Impostos → DAS | 0.92 | Impostos → DAS | 8 |
| inss           | 0.40      | Saúde        | Impostos → INSS | 0.90 | Impostos → INSS | 6 |

**Ação:** Criar sinônimos para estes termos em `user_synonyms` para que RAG acerte na próxima.

---

### 2. **Taxa de fallback para IA por usuário**

```sql
-- Ver quais usuários mais precisam de fallback (RAG não está bom para eles)
SELECT 
  uc.name as usuario,
  uc.phoneNumber,
  COUNT(*) as total_queries,
  SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END) as fallbacks,
  ROUND(
    (SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
    2
  ) as taxa_fallback_pct
FROM ai_usage_logs ai
JOIN user_cache uc ON uc.gastoCertoId = ai.userCacheId
WHERE 
  ai.operation = 'CATEGORY_SUGGESTION'
  AND ai.createdAt >= NOW() - INTERVAL '30 days'
GROUP BY uc.name, uc.phoneNumber
HAVING COUNT(*) >= 10  -- Mínimo 10 queries
ORDER BY taxa_fallback_pct DESC
LIMIT 20;
```

**Ação:** Usuários com alta taxa de fallback (>30%) precisam de sinônimos personalizados.

---

### 3. **Performance do RAG ao longo do tempo**

```sql
-- Ver se RAG está melhorando (menos fallbacks com o tempo)
SELECT 
  DATE_TRUNC('week', rag.createdAt) as semana,
  COUNT(*) as total_buscas,
  SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END) as sucessos,
  SUM(CASE WHEN rag.wasAiFallback = true THEN 1 ELSE 0 END) as fallbacks,
  ROUND(
    (SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
    2
  ) as taxa_sucesso_pct
FROM rag_search_logs rag
WHERE 
  rag.flowStep = 1  -- Apenas step inicial
  AND rag.createdAt >= NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('week', rag.createdAt)
ORDER BY semana DESC;
```

**Ação:** Taxa de sucesso deveria aumentar com o tempo conforme sinônimos são adicionados.

---

### 4. **Categorias que mais precisam de sinônimos**

```sql
-- Ver quais categorias têm baixo score no RAG mas IA acerta
SELECT 
  ai.aiCategoryName as categoria,
  COUNT(*) as ocorrencias,
  ROUND(AVG(ai.ragInitialScore)::numeric, 4) as avg_rag_score,
  ROUND(AVG(ai.aiConfidence)::numeric, 4) as avg_ia_confidence
FROM ai_usage_logs ai
WHERE 
  ai.wasRagFallback = true
  AND ai.success = true
  AND ai.ragInitialScore < 0.60
  AND ai.createdAt >= NOW() - INTERVAL '30 days'
GROUP BY ai.aiCategoryName
HAVING COUNT(*) >= 3
ORDER BY ocorrencias DESC
LIMIT 20;
```

**Ação:** Adicionar sinônimos para estas categorias prioritariamente.

---

### 5. **Custo total de fallback para IA**

```sql
-- Calcular quanto está custando o fallback para IA
SELECT 
  ai.provider,
  COUNT(*) as fallbacks,
  SUM(ai.estimatedCost) as custo_total_usd,
  ROUND(AVG(ai.estimatedCost)::numeric, 6) as custo_medio_usd
FROM ai_usage_logs ai
WHERE 
  ai.wasRagFallback = true
  AND ai.operation = 'CATEGORY_SUGGESTION'
  AND ai.createdAt >= NOW() - INTERVAL '30 days'
GROUP BY ai.provider
ORDER BY custo_total_usd DESC;
```

**Ação:** Justificar investimento em melhorar RAG para reduzir custos de IA.

---

## 🤖 Estratégias de Melhoria

### 1. **Extração Automática de Sinônimos**

Criar um job que roda periodicamente (ex: diariamente) para:

```typescript
// Pseudo-código
async function extractSynonymsFromAIFallbacks() {
  // 1. Buscar casos onde IA acertou e RAG falhou (últimos 7 dias)
  const candidates = await prisma.aIUsageLog.findMany({
    where: {
      wasRagFallback: true,
      needsSynonymLearning: true,
      success: true,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }
  });

  // 2. Agrupar por query + categoria
  const grouped = groupBy(candidates, (c) => `${c.inputText}|${c.aiCategoryId}`);

  // 3. Criar sinônimos para queries com >= 2 ocorrências
  for (const [key, items] of Object.entries(grouped)) {
    if (items.length >= 2) {
      const [query, categoryId] = key.split('|');
      
      await prisma.userSynonym.upsert({
        where: { 
          userId_keyword: { 
            userId: items[0].userCacheId, 
            keyword: normalize(query) 
          } 
        },
        create: {
          userId: items[0].userCacheId,
          keyword: normalize(query),
          categoryId: categoryId,
          categoryName: items[0].aiCategoryName,
          confidence: 0.5, // AUTO_LEARNED
          source: 'AUTO_LEARNED',
          usageCount: items.length
        },
        update: {
          usageCount: { increment: items.length }
        }
      });
    }
  }

  // 4. Marcar como processados
  await prisma.aIUsageLog.updateMany({
    where: { id: { in: candidates.map(c => c.id) } },
    data: { needsSynonymLearning: false }
  });
}
```

---

### 2. **Dashboard de Monitoramento**

Criar endpoint administrativo para visualizar:

```typescript
// GET /admin/rag-analytics

{
  "overview": {
    "totalSearches": 1500,
    "ragSuccessRate": 0.72,  // 72% de sucesso
    "aiFallbackRate": 0.28,   // 28% precisou de IA
    "averageCostPerFallback": 0.000234,  // USD
    "totalCostLastMonth": 12.45  // USD
  },
  "topMissingKeywords": [
    { "keyword": "pro labore", "occurrences": 15, "avgIaConfidence": 0.95 },
    { "keyword": "das simples", "occurrences": 8, "avgIaConfidence": 0.92 }
  ],
  "categoryPerformance": [
    { 
      "category": "Receitas → Salário", 
      "ragScore": 0.45, 
      "needsSynonyms": true 
    }
  ]
}
```

---

### 3. **Feedback Loop Usuário**

Quando IA sugere categoria, perguntar ao usuário:

```
💡 IA sugeriu: "Receitas → Salário" para "pro labore"
   
   ✅ Está correto?
   ❌ Não, é outra categoria
```

Se usuário confirmar:
- Criar sinônimo com `confidence: 1.0` e `source: USER_CONFIRMED`
- Futuras buscas por "pro labore" vão acertar direto no RAG

---

### 4. **Threshold Adaptativo**

Ajustar threshold do RAG dinamicamente por usuário:

- Usuários novos: threshold **0.70** (mais conservador)
- Usuários com >50 sinônimos: threshold **0.55** (mais agressivo)
- Se taxa de fallback >40%: reduzir threshold temporariamente

---

## 📈 Métricas de Sucesso

### KPIs a monitorar:

1. **Taxa de Sucesso do RAG** (goal: >80%)
   - `(RAG sucessos / Total buscas) * 100`

2. **Taxa de Fallback para IA** (goal: <20%)
   - `(AI fallbacks / Total buscas) * 100`

3. **Custo Mensal de Fallback** (goal: <$10/mês)
   - `SUM(estimatedCost WHERE wasRagFallback=true)`

4. **Crescimento de Sinônimos** (goal: +20%/mês)
   - `COUNT(user_synonyms) por mês`

5. **Satisfação do Usuário** (goal: >90%)
   - `(Confirmações / Total transações) * 100`

---

## 🎯 Roadmap de Implementação

### Fase 1: Coleta de Dados ✅
- [x] Atualizar schema.prisma com novos campos
- [x] Implementar logging completo em RAG service
- [x] Implementar logging completo em AI service

### Fase 2: Análise Manual (Sprint atual)
- [ ] Criar queries SQL de análise
- [ ] Revisar logs dos últimos 30 dias
- [ ] Identificar top 20 keywords problemáticos
- [ ] Criar sinônimos manualmente para teste

### Fase 3: Automação (Próximo sprint)
- [ ] Implementar job de extração automática de sinônimos
- [ ] Criar endpoint de analytics `/admin/rag-analytics`
- [ ] Configurar alertas quando taxa de fallback > 40%

### Fase 4: Otimização (Mês 2)
- [ ] Implementar threshold adaptativo
- [ ] Testar embeddings de IA vs BM25
- [ ] A/B test: RAG melhorado vs IA direta

---

## 📚 Referências

- [RAG Performance Analysis](./RAG_PERFORMANCE_ANALYSIS.md)
- [RAG Como Funciona](./RAG_COMO_FUNCIONA.md)
- [RAG Flow](./RAG_FLOW.md)
- [AI Config Guide](./AI_CONFIG_GUIDE.md)

---

## 🔗 Logs Relacionados

Para consultar os logs:

```sql
-- Ver fluxo completo de uma query específica
SELECT 
  'RAG' as tipo,
  rag.flowStep,
  rag.query,
  rag.bestScore,
  rag.success,
  rag.createdAt
FROM rag_search_logs rag
WHERE rag.query = 'pro labore'
  AND rag.userId = 'user-id-aqui'
ORDER BY rag.createdAt DESC

UNION ALL

SELECT 
  'AI' as tipo,
  2 as flowStep,  -- IA é sempre step 2
  ai.inputText as query,
  ai.aiConfidence as bestScore,
  ai.success,
  ai.createdAt
FROM ai_usage_logs ai
WHERE ai.inputText = 'pro labore'
  AND ai.userCacheId = 'user-id-aqui'
ORDER BY ai.createdAt DESC;
```

---

**Última atualização:** 19 de dezembro de 2025  
**Versão:** 1.0  
**Autor:** Sistema Gasto Certo
