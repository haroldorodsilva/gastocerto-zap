# 🎯 Guia Rápido - Sistema de Rastreamento RAG

## ✅ O Que Foi Implementado

### 1. Schema do Banco Atualizado
- ✅ Novos campos em `RAGSearchLog` (12 campos adicionais)
- ✅ Novos campos em `AIUsageLog` (11 campos adicionais)
- ✅ Índices otimizados para queries de análise
- ✅ Migration aplicada via `prisma db push`

### 2. Documentação Completa
- ✅ [RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md) - Guia completo do sistema
- ✅ [MIGRATION_RAG_TRACKING.sql](./MIGRATION_RAG_TRACKING.sql) - Migration SQL manual
- ✅ [CHANGELOG_RAG_TRACKING.md](./CHANGELOG_RAG_TRACKING.md) - Resumo das alterações

### 3. Exemplos de Código
- ✅ [examples/rag-tracking-implementation.example.ts](./examples/rag-tracking-implementation.example.ts)
- ✅ Exemplos de RAGService, AIService e CategoryResolutionService
- ✅ Queries de análise prontas para usar

### 4. Script de Análise
- ✅ [scripts/analyze-rag-logs.ts](../scripts/analyze-rag-logs.ts)
- ✅ 6 análises diferentes (keywords, usuários, categorias, performance, custo, stats)

---

## 🚀 Como Usar

### 1. O Schema Já Está Aplicado

O banco de dados já foi atualizado com `prisma db push`. Não precisa rodar migration novamente.

Para verificar:
```bash
npx prisma db pull
```

---

### 2. Atualizar o Código dos Services

Você precisa atualizar os services para popular os novos campos. Use como base o arquivo:
- `docs/examples/rag-tracking-implementation.example.ts`

**Arquivos a modificar:**
1. `src/infrastructure/ai/services/rag.service.ts`
2. `src/infrastructure/ai/services/ai.service.ts`

**Exemplo de mudança no RAG Service:**

```typescript
// Antes
async searchCategory(query: string, userId: string) {
  const matches = await this.bm25Search(query);
  return { found: matches[0].score >= 0.6, matches };
}

// Depois
async searchCategory(query: string, userId: string) {
  const startTime = Date.now();
  const matches = await this.bm25Search(query);
  const bestScore = matches[0]?.score || 0;
  const success = bestScore >= this.threshold;

  // 🆕 Criar log
  const logId = await this.prisma.rAGSearchLog.create({
    data: {
      userId,
      query,
      queryNormalized: this.normalize(query),
      matches,
      bestMatch: matches[0]?.name,
      bestScore,
      threshold: this.threshold,
      success,
      flowStep: 1,
      totalSteps: success ? 1 : 2,
      ragInitialScore: bestScore,
      wasAiFallback: !success,
      responseTime: Date.now() - startTime,
      ragMode: 'BM25',
    },
  });

  return { 
    found: success, 
    matches, 
    logId // 🆕 Retornar ID do log para vincular com IA
  };
}
```

**Exemplo de mudança no AI Service:**

```typescript
// Antes
async suggestCategory(query: string, userId: string) {
  const response = await this.callAI(query);
  await this.logAIUsage({ ... });
  return response;
}

// Depois
async suggestCategory(query: string, userId: string, ragResult?) {
  const response = await this.callAI(query);
  
  // 🆕 Log com contexto RAG
  await this.prisma.aIUsageLog.create({
    data: {
      // ... campos existentes ...
      
      // 🆕 Novos campos
      ragSearchLogId: ragResult?.logId,
      ragInitialFound: ragResult?.matches?.length > 0,
      ragInitialScore: ragResult?.bestScore,
      ragInitialCategory: ragResult?.matches[0]?.name,
      aiCategoryId: response.categoryId,
      aiCategoryName: response.categoryName,
      aiConfidence: response.confidence,
      finalCategoryId: response.categoryId,
      finalCategoryName: response.categoryName,
      wasRagFallback: true,
      needsSynonymLearning: response.confidence >= 0.8,
    },
  });
  
  return response;
}
```

---

### 3. Executar Análise dos Logs

Após alguns dias de uso com o novo tracking, execute:

```bash
# Análise completa (últimos 30 dias)
npx ts-node scripts/analyze-rag-logs.ts

# Análise dos últimos 7 dias
npx ts-node scripts/analyze-rag-logs.ts --days=7

# Output em JSON
npx ts-node scripts/analyze-rag-logs.ts --days=30 --json > analysis.json
```

**Output esperado:**

```
📊 ANÁLISE DE LOGS RAG - Sistema Gasto Certo
===============================================================================

📊 Estatísticas Gerais (últimos 30 dias)...

┌─────────────────────────────────────────────┐
│            RESUMO EXECUTIVO                 │
├─────────────────────────────────────────────┤
│ Usuários únicos:                       42   │
│ Total de buscas:                      523   │
│ Sucessos RAG:                         378   │
│ Fallbacks IA:                         145   │
├─────────────────────────────────────────────┤
│ Taxa de sucesso:                    72.27%  │
│ Taxa de fallback:                   27.73%  │
└─────────────────────────────────────────────┘

🔍 Buscando keywords que precisam de sinônimos...

📋 Top keywords que precisam de sinônimos:
────────────────────────────────────────────────────────────────────────────
Query                     RAG Score  IA Categoria                    IA Conf  Ocorrências
────────────────────────────────────────────────────────────────────────────
pro labore                0.4500     Receitas → Salário              0.9500   15
das simples               0.3800     Impostos → DAS                  0.9200   8
inss                      0.4000     Impostos → INSS                 0.9000   6
...
```

---

### 4. Criar Sinônimos Baseado na Análise

Após identificar keywords problemáticos, você tem **3 estratégias** de gerenciamento:

#### 🤖 **Estratégia 1: Automático** (Recomendado para escala)
Job automático extrai sinônimos dos logs diariamente (ver seção 5 abaixo).

#### 👤 **Estratégia 2: Feedback do Usuário** (Melhor qualidade)
Bot pergunta ao usuário se quer "lembrar" da categoria para próximas vezes.

#### 👨‍💼 **Estratégia 3: Admin Manual** (Controle total)
Admin cria sinônimos globais baseado em análise dos logs.

#### 🎯 **Estratégia 4: Híbrido** (Recomendação final)
Combina as 3: Admin cria base inicial → Usuário valida onboarding → Automático para resto.

**📚 Leia mais:** [SYNONYM_MANAGEMENT_STRATEGIES.md](./SYNONYM_MANAGEMENT_STRATEGIES.md) - Guia completo com comparações, exemplos de código e recomendações por cenário.

**Exemplo rápido (manual):**

```typescript
// Adicionar sinônimo via código
await prisma.userSynonym.create({
  data: {
    userId: 'user-gastocerto-id',
    keyword: 'pro labore',
    categoryId: 'categoria-id-da-api',
    categoryName: 'Receitas → Salário',
    confidence: 0.8,
    source: 'AUTO_LEARNED', // ou USER_CONFIRMED, ADMIN_CREATED
    usageCount: 0,
  },
});
```

---

### 5. Criar Job Automático de Extração (Opcional)

Crie um job que roda diariamente para extrair sinônimos automaticamente:

```bash
# Criar arquivo
touch scripts/extract-synonyms-job.ts
```

Conteúdo (baseado em `docs/examples/rag-tracking-implementation.example.ts`):

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function extractAndCreateSynonyms() {
  console.log('🔄 Extraindo sinônimos...');

  // Buscar candidatos dos últimos 7 dias
  const candidates = await prisma.aIUsageLog.findMany({
    where: {
      wasRagFallback: true,
      needsSynonymLearning: true,
      success: true,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  // Agrupar por userId + query + categoria
  const grouped = new Map<string, any[]>();
  candidates.forEach((c) => {
    const key = `${c.userCacheId}|${c.inputText}|${c.aiCategoryId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  });

  let created = 0;

  // Criar sinônimos para queries com >= 2 ocorrências
  for (const [key, items] of grouped) {
    if (items.length >= 2) {
      const [userId, query, categoryId] = key.split('|');
      
      await prisma.userSynonym.upsert({
        where: { 
          userId_keyword: { userId, keyword: query.toLowerCase() } 
        },
        create: {
          userId,
          keyword: query.toLowerCase(),
          categoryId,
          categoryName: items[0].aiCategoryName!,
          confidence: 0.5,
          source: 'AUTO_LEARNED',
          usageCount: items.length,
        },
        update: {
          usageCount: { increment: items.length },
        },
      });

      created++;
    }
  }

  // Marcar como processados
  await prisma.aIUsageLog.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { needsSynonymLearning: false },
  });

  console.log(`✅ ${created} sinônimos criados/atualizados!`);
  await prisma.$disconnect();
}

extractAndCreateSynonyms().catch(console.error);
```

Configure cron job (ex: via NestJS Schedule ou crontab):

```typescript
// src/jobs/synonym-extraction.job.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class SynonymExtractionJob {
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async extractSynonyms() {
    // Chamar script acima
  }
}
```

---

### 6. Criar Dashboard Admin (Opcional)

Crie endpoints para visualizar analytics:

```typescript
// src/features/admin/controllers/rag-analytics.controller.ts

@Controller('admin/rag')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RagAnalyticsController {
  constructor(private ragAnalytics: RAGAnalyticsService) {}

  @Get('analytics')
  async getAnalytics(@Query('days') days: number = 30) {
    return {
      generalStats: await this.ragAnalytics.getGeneralStats(days),
      missingKeywords: await this.ragAnalytics.findMissingSynonyms(days),
      userFallbackRate: await this.ragAnalytics.getFallbackRateByUser(days),
      performance: await this.ragAnalytics.getRAGPerformanceOverTime(),
      cost: await this.ragAnalytics.getFallbackCost(days),
    };
  }

  @Get('missing-synonyms')
  async getMissingSynonyms(@Query('days') days: number = 30) {
    return this.ragAnalytics.findMissingSynonyms(days);
  }
}
```

---

## 📊 Queries Úteis

### Ver fluxo completo de uma query específica:

```sql
-- Ver todos os steps de uma query
SELECT 
  'RAG' as tipo,
  rag.flowStep,
  rag.query,
  rag.bestScore,
  rag.success,
  rag.wasAiFallback,
  rag.createdAt
FROM rag_search_logs rag
WHERE rag.query ILIKE '%pro labore%'
  AND rag.userId = 'user-id-aqui'
ORDER BY rag.createdAt DESC
LIMIT 20;

-- Ver logs de IA relacionados
SELECT 
  ai.inputText as query,
  ai.provider,
  ai.ragInitialScore,
  ai.aiCategoryName,
  ai.aiConfidence,
  ai.wasRagFallback,
  ai.needsSynonymLearning,
  ai.createdAt
FROM ai_usage_logs ai
WHERE ai.inputText ILIKE '%pro labore%'
  AND ai.userCacheId = 'user-id-aqui'
ORDER BY ai.createdAt DESC
LIMIT 20;
```

### Ver sinônimos de um usuário:

```sql
SELECT 
  keyword,
  categoryName,
  subCategoryName,
  confidence,
  source,
  usageCount,
  createdAt
FROM user_synonyms
WHERE userId = 'user-id-aqui'
ORDER BY usageCount DESC;
```

---

## 🎯 KPIs para Monitorar

| Métrica | Goal | Como Medir |
|---------|------|------------|
| **Taxa de Sucesso RAG** | ≥80% | `(sucessos RAG / total buscas) * 100` |
| **Taxa de Fallback** | ≤20% | `(fallbacks IA / total buscas) * 100` |
| **Custo Mensal Fallback** | <$10 | `SUM(estimatedCost WHERE wasRagFallback=true)` |
| **Crescimento Sinônimos** | +20%/mês | `COUNT(user_synonyms)` por mês |
| **Tempo Resposta RAG** | <100ms | `AVG(responseTime) WHERE flowStep=1` |

---

## 📚 Referências

- **Documentação Completa**: [RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md)
- **Exemplos de Código**: [examples/rag-tracking-implementation.example.ts](./examples/rag-tracking-implementation.example.ts)
- **Script de Análise**: [scripts/analyze-rag-logs.ts](../scripts/analyze-rag-logs.ts)
- **Migration SQL**: [MIGRATION_RAG_TRACKING.sql](./MIGRATION_RAG_TRACKING.sql)

---

## ❓ FAQ

**Q: Por que a migration deu erro de drift?**  
A: O banco tinha alterações não registradas. Usei `prisma db push` para sincronizar diretamente.

**Q: Preciso rodar a migration novamente?**  
A: Não. O banco já está atualizado. Use `npx prisma db pull` para verificar.

**Q: Quando vou ver resultados nos logs?**  
A: Após atualizar o código dos services e gerar novo tráfego. Os logs antigos não terão os novos campos.

**Q: Como saber se está funcionando?**  
A: Execute `npx ts-node scripts/analyze-rag-logs.ts`. Se aparecer dados, está funcionando.

**Q: Posso ver um exemplo real?**  
A: Sim, veja `docs/examples/rag-tracking-implementation.example.ts` com código completo.

---

**Última atualização**: 19 de dezembro de 2025  
**Status**: ✅ Schema aplicado | ⏳ Aguardando implementação nos services
