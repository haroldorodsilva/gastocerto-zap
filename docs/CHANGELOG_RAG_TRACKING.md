# 📋 Resumo das Alterações - Rastreamento RAG → IA → RAG

**Data:** 19 de dezembro de 2025  
**Versão:** 1.0

---

## ✅ Alterações Realizadas

### 1. 📁 Organização de Documentações

Todos os arquivos de documentação foram movidos da raiz para `docs/`:

- ✅ `COOLIFY.md` → `docs/COOLIFY.md`
- ✅ `COOLIFY_SETUP.md` → `docs/COOLIFY_SETUP.md`
- ✅ `DEPLOY.md` → `docs/DEPLOY.md`
- ✅ `DEPLOY_READY.md` → `docs/DEPLOY_READY.md`
- ✅ `DIAGRAMAS_FLUXO.md` → `docs/DIAGRAMAS_FLUXO.md`
- ✅ `FLOW_COMPLETE.md` → `docs/FLOW_COMPLETE.md`
- ✅ `PADRONIZACAO_COMPLETA.md` → `docs/PADRONIZACAO_COMPLETA.md`
- ✅ `PLANO_MELHORIAS.md` → `docs/PLANO_MELHORIAS.md`
- ✅ `REDIS_SETUP.md` → `docs/REDIS_SETUP.md`
- ✅ `SOLUCAO_DEFINITIVA.md` → `docs/SOLUCAO_DEFINITIVA.md`
- ✅ `STATUS_MULTICONTAS.md` → `docs/STATUS_MULTICONTAS.md`
- ✅ `TESTES.md` → `docs/TESTES.md`
- ✅ `TESTES_RESUMO.md` → `docs/TESTES_RESUMO.md`
- ✅ `TESTE_MULTICONTAS.md` → `docs/TESTE_MULTICONTAS.md`
- ✅ `TROUBLESHOOTING_COOLIFY.md` → `docs/TROUBLESHOOTING_COOLIFY.md`

**Resultado:** Raiz do projeto mais limpa, mantendo apenas `README.md` principal.

---

### 2. 🗃️ Schema Prisma - Novos Campos

#### 2.1. Modelo `RAGSearchLog`

**Campos adicionados para rastreamento completo:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `flowStep` | Int | 1=RAG inicial, 2=IA fallback, 3=RAG validação |
| `totalSteps` | Int | Total de steps executados (1, 2 ou 3) |
| `aiProvider` | String? | Provider usado (openai, groq, gemini, deepseek) |
| `aiModel` | String? | Modelo usado (gpt-4o, llama-3.3, etc) |
| `aiConfidence` | Decimal? | Confiança da IA (0-1) |
| `aiCategoryId` | String? | ID da categoria que IA retornou |
| `aiCategoryName` | String? | Nome da categoria que IA retornou |
| `finalCategoryId` | String? | ID da categoria final escolhida |
| `finalCategoryName` | String? | Nome da categoria final |
| `ragInitialScore` | Decimal? | Score do RAG no step 1 |
| `ragFinalScore` | Decimal? | Score do RAG no step 3 (validação) |
| `wasAiFallback` | Boolean | true se precisou usar IA |

**Novos índices:**
```prisma
@@index([wasAiFallback])
@@index([flowStep])
@@index([aiProvider])
```

---

#### 2.2. Modelo `AIUsageLog`

**Campos adicionados para contexto RAG:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `ragSearchLogId` | String? | ID do RAGSearchLog relacionado |
| `ragInitialFound` | Boolean? | Se RAG encontrou algo no step 1 |
| `ragInitialScore` | Decimal? | Score do RAG inicial |
| `ragInitialCategory` | String? | Categoria sugerida pelo RAG |
| `aiCategoryId` | String? | ID da categoria que IA retornou |
| `aiCategoryName` | String? | Nome da categoria que IA retornou |
| `aiConfidence` | Decimal? | Confiança da IA (0-1) |
| `finalCategoryId` | String? | ID da categoria final escolhida |
| `finalCategoryName` | String? | Nome da categoria final |
| `wasRagFallback` | Boolean | true se foi fallback de RAG |
| `needsSynonymLearning` | Boolean | true se deve extrair sinônimos |

**Novos índices:**
```prisma
@@index([ragSearchLogId])
@@index([wasRagFallback])
@@index([needsSynonymLearning])
```

---

### 3. 📚 Documentações Criadas

#### 3.1. `docs/RAG_TRACKING_ANALYSIS.md`

Documentação completa sobre:
- ✅ Fluxo detalhado RAG → IA → RAG (diagrama)
- ✅ Descrição de todos os campos dos logs
- ✅ Exemplos de uso por cenário
- ✅ 5+ queries SQL de análise prontas para usar
- ✅ Estratégias de melhoria (extração automática de sinônimos)
- ✅ Dashboard de monitoramento (specs)
- ✅ Feedback loop com usuário
- ✅ Threshold adaptativo
- ✅ KPIs e métricas de sucesso
- ✅ Roadmap de implementação

#### 3.2. `docs/MIGRATION_RAG_TRACKING.sql`

Migration SQL completa com:
- ✅ ALTER TABLE para `rag_search_logs`
- ✅ ALTER TABLE para `ai_usage_logs`
- ✅ Criação de índices otimizados
- ✅ Comentários de documentação
- ✅ Queries de verificação
- ✅ Query de teste para análise
- ✅ Notas importantes sobre aplicação

---

## 🎯 Objetivo Alcançado

### Problema Original
> "Hoje se o RAG inicial não acha e a IA acha não sei onde olho para ver os matching da IA para melhorar os contextos do RAG"

### Solução Implementada

**Agora você pode:**

1. **Ver exatamente o que aconteceu em cada step:**
   ```sql
   -- Exemplo: Query "pro labore"
   -- Step 1 (RAG): Score 0.45 → Falhou
   -- Step 2 (IA): Groq → "Receitas → Salário" (95% confiança) → Sucesso
   -- Step 3 (RAG validação): Score 0.50 → Ainda não passou, mas IA acertou
   ```

2. **Identificar keywords que precisam de sinônimos:**
   ```sql
   SELECT inputText, COUNT(*) 
   FROM ai_usage_logs 
   WHERE wasRagFallback = true 
     AND needsSynonymLearning = true
   GROUP BY inputText
   ORDER BY COUNT(*) DESC;
   ```

3. **Medir custo de fallback:**
   ```sql
   SELECT SUM(estimatedCost) as custo_total
   FROM ai_usage_logs 
   WHERE wasRagFallback = true;
   ```

4. **Automatizar aprendizado:**
   - Job que extrai sinônimos automaticamente dos logs
   - Adiciona em `user_synonyms` para RAG melhorar
   - Ciclo de melhoria contínua

---

## 📊 Cenários de Uso

### Cenário 1: RAG Acertou (1 step)
```
Usuário: "gasolina"
→ Step 1 (RAG): Score 0.85 → ✅ "Despesas → Combustível"
```

**Logs gerados:**
- 1x `RAGSearchLog` com `flowStep=1`, `success=true`, `totalSteps=1`

---

### Cenário 2: RAG Falhou → IA Acertou (2 steps)
```
Usuário: "pro labore"
→ Step 1 (RAG): Score 0.45 → ❌ Abaixo threshold
→ Step 2 (IA): Groq → ✅ "Receitas → Salário" (95%)
```

**Logs gerados:**
- 1x `RAGSearchLog` com `flowStep=1`, `success=false`, `wasAiFallback=true`, `ragInitialScore=0.45`
- 1x `AIUsageLog` com `wasRagFallback=true`, `ragInitialScore=0.45`, `aiCategoryName="Receitas → Salário"`, `needsSynonymLearning=true`

**Ação sugerida:**
- Criar sinônimo: `"pro labore"` → `"Receitas → Salário"` em `user_synonyms`
- Próxima vez, RAG vai acertar direto!

---

### Cenário 3: RAG → IA → RAG Validação (3 steps) - OPCIONAL
```
Usuário: "das simples"
→ Step 1 (RAG): Score 0.38 → ❌
→ Step 2 (IA): Groq → "Impostos → DAS" (92%)
→ Step 3 (RAG validação): Score 0.50 → ❌ Mas IA já resolveu
```

**Logs gerados:**
- 1x `RAGSearchLog` (step 1)
- 1x `AIUsageLog` (step 2)
- 1x `RAGSearchLog` (step 3) com `ragFinalScore=0.50`, `finalCategoryName="Impostos → DAS"`

---

## 🚀 Próximos Passos

### Fase 1: Aplicar Migration ✅ PRONTO
```bash
# Quando banco estiver rodando:
npx prisma migrate dev --name add_rag_ai_tracking_fields

# Ou aplicar manualmente:
psql -U postgres -d zap -f docs/MIGRATION_RAG_TRACKING.sql
```

### Fase 2: Atualizar Código (A FAZER)

**Arquivos a modificar:**

1. **RAG Service** (`src/infrastructure/ai/services/rag.service.ts`):
   ```typescript
   async searchCategory(query: string, userId: string) {
     const startTime = Date.now();
     
     // Step 1: Busca RAG
     const ragResult = await this.bm25Search(query);
     
     // Salvar log do step 1
     await this.prisma.rAGSearchLog.create({
       data: {
         userId,
         query,
         queryNormalized: normalize(query),
         matches: ragResult.matches,
         bestScore: ragResult.bestScore,
         success: ragResult.bestScore >= this.threshold,
         flowStep: 1,
         totalSteps: ragResult.bestScore >= this.threshold ? 1 : 2,
         ragInitialScore: ragResult.bestScore,
         wasAiFallback: ragResult.bestScore < this.threshold,
         responseTime: Date.now() - startTime,
       }
     });
     
     // Se falhou, fallback para IA (step 2)
     if (ragResult.bestScore < this.threshold) {
       return this.aiService.suggestCategory(query, userId, ragResult);
     }
     
     return ragResult;
   }
   ```

2. **AI Service** (`src/infrastructure/ai/services/ai.service.ts`):
   ```typescript
   async suggestCategory(query: string, userId: string, ragResult?) {
     const startTime = Date.now();
     
     // Chamar IA
     const aiResult = await this.callAI(query);
     
     // Salvar log com contexto RAG
     await this.prisma.aIUsageLog.create({
       data: {
         userCacheId: userId,
         operation: 'CATEGORY_SUGGESTION',
         provider: this.provider,
         model: this.model,
         inputTokens: aiResult.inputTokens,
         outputTokens: aiResult.outputTokens,
         totalTokens: aiResult.totalTokens,
         
         // Contexto RAG
         ragInitialFound: ragResult?.matches?.length > 0,
         ragInitialScore: ragResult?.bestScore,
         ragInitialCategory: ragResult?.bestMatch,
         aiCategoryName: aiResult.category,
         aiConfidence: aiResult.confidence,
         finalCategoryName: aiResult.category,
         wasRagFallback: true,
         needsSynonymLearning: aiResult.confidence >= 0.80,  // Se IA teve >80% confiança, vale criar sinônimo
         
         responseTime: Date.now() - startTime,
       }
     });
     
     return aiResult;
   }
   ```

### Fase 3: Criar Job de Análise (A FAZER)

Criar `scripts/extract-synonyms-from-ai.ts`:
```typescript
// Job que roda diariamente para extrair sinônimos
// Ver código completo em docs/RAG_TRACKING_ANALYSIS.md
```

### Fase 4: Dashboard Admin (A FAZER)

Criar endpoints:
- `GET /admin/rag-analytics` - Overview geral
- `GET /admin/rag-analytics/missing-keywords` - Keywords sem sinônimos
- `GET /admin/rag-analytics/cost-analysis` - Custo de fallback

---

## 📈 Impacto Esperado

### Antes (Situação Atual)
- ❌ Não sabe quando RAG falha
- ❌ Não sabe o que IA retorna
- ❌ Não tem visibilidade de custo
- ❌ Não aprende automaticamente
- ❌ RAG não melhora com o tempo

### Depois (Com Tracking)
- ✅ Vê exatamente cada step do fluxo
- ✅ Identifica keywords problemáticos
- ✅ Mede custo de fallback
- ✅ Extrai sinônimos automaticamente
- ✅ RAG melhora continuamente
- ✅ Reduz custo de IA em 50%+ (goal)

---

## 📞 Suporte

**Documentação completa:** [docs/RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md)  
**Migration SQL:** [docs/MIGRATION_RAG_TRACKING.sql](./MIGRATION_RAG_TRACKING.sql)  

**Dúvidas?** Consulte os documentos acima ou logs de exemplo no código.

---

**Status:** ✅ Schema e Documentação COMPLETOS  
**Próximo:** Aplicar migration e atualizar código dos services
