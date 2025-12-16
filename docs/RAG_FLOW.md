# 🧠 Fluxo do RAG (Retrieval-Augmented Generation)

## ✅ Status Atual: BM25 + AI Embeddings (IMPLEMENTADO!)

### Configurações no AISettings

```prisma
ragEnabled      Boolean @default(false) // ✅ Controla se RAG está ATIVO
ragAiEnabled    Boolean @default(false) // ✅ IMPLEMENTADO - Usar embeddings de IA
ragAiProvider   String  @default("groq") // ✅ IMPLEMENTADO - "openai", "groq", "google_gemini"
ragProvider     String  @default("bm25") // ✅ "bm25" ou "ai" (detectado automaticamente)
ragThreshold    Float   @default(0.6)    // ✅ Threshold mínimo para match (60%)
ragCacheEnabled Boolean @default(true)   // ✅ Cache Redis das categorias
```

### Fluxo Atual (BM25 + AI Embeddings)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Usuário envia mensagem: "ontem gastei no restaurante 85"     │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. registration.service.ts                                       │
│    - Busca AISettings do banco                                   │
│    - Verifica: aiSettings.ragEnabled === true?                   │
└────────────────────┬─────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │ ragEnabled = false      │ ragEnabled = true
        ▼                         ▼
┌───────────────────┐   ┌─────────────────────────────────┐
│ Pula RAG          │   │ 3. FASE 1: RAG Direto (BM25)    │
│ Vai direto pra IA │   │    - Tokeniza query             │
│                   │   │    - Busca categorias do cache  │
│                   │   │    - Calcula BM25 score         │
│                   │   │    - Verifica sinônimos (peso:  │
│                   │   │      categoria 0.5x, sub 2.0x)  │
└───────────────────┘   └────────────┬────────────────────┘
                                     │
                        ┌────────────┴────────────┐
                        │ Score >= threshold?      │
                        │ (default: 60%)           │
                        └────────────┬─────────────┘
                                     │
            ┌────────────────────────┴────────────────────────┐
            │ SIM (score ≥ 60%)              NÃO (score < 60%) │
            ▼                                ▼
┌────────────────────────────┐   ┌──────────────────────────────┐
│ ✅ Match direto!           │   │ 4. FASE 2: Chamar IA         │
│ - Retorna categoria + sub  │   │    - Usa AI provider         │
│ - Pula IA (economia!)      │   │    - Extrai dados completos  │
│ - source: "RAG_DIRECT"     │   │                              │
└────────────────────────────┘   └──────────┬───────────────────┘
                                            │
                                            ▼
                              ┌──────────────────────────────────┐
                              │ 5. FASE 3: Validação RAG         │
                              │    - Revalida categoria da IA    │
                              │    - Se RAG score ≥ 60%:         │
                              │      SEMPRE substitui categoria  │
                              │      e subcategoria              │
                              │    - source: "AI_RAG_VALIDATED"  │
                              └──────────┬───────────────────────┘
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────────────┐
│ 6. Salvar transação com categoria correta                         │
│    - categoryName: "Alimentação"                                  │
│    - subCategoryName: "Restaurante"                               │
└───────────────────────────────────────────────────────────────────┘
```

## 🔧 Implementação Atual

### RAGService (`src/infrastructure/ai/rag/rag.service.ts`)

**Método: BM25 (Okapi BM25)**
- **Tokenização**: Normaliza texto (lowercase, remove acentos), split por espaços, ignora tokens < 3 chars
- **Sinônimos**: ~180 mapeamentos manuais (ex: "gasolina" → "combustivel", "rotativo" → "cartao")
- **Scoring**:
  ```typescript
  // BM25 Score = Σ(IDF × TF × boost)
  // Modificação: NÃO divide por queryTokens.length
  // Para permitir frases longas terem score decente
  
  score_final = score_bm25 + (synonyms_categoria × 0.5) + (synonyms_subcategoria × 2.0)
  ```

**Pesos de Sinônimos**:
- Categoria: `0.5x` (50%)
- **Subcategoria: `2.0x` (200%)** ← Prioridade máxima!

**Boosts**:
- Match exato: `2.0x`
- Começa com (startsWith): `1.5x`

### Threshold Ajustado para Frases Longas

**Problema descoberto**:
```
Query: "ontem gastei no restaurante 85 reais" (7 tokens)
Match: "restaurante" (1 token match)
Score antigo: 1/7 = 14.3% (❌ rejeitado com threshold 60%)
Score novo: 1 (não divide) = score absoluto (✅ passa com threshold 25%)
```

**Solução**: `minScore` reduzido de `0.60` → `0.25` (60% → 25%)

## 📊 Testes Cobertos

### Casos Reais do Usuário (test/unit/rag/rag.service.spec.ts)

| # | Query | Categoria Esperada | Subcategoria | Status |
|---|-------|-------------------|--------------|--------|
| 1 | `comprei 50 reais de frutas` | Alimentação | Hortifruti | ✅ |
| 2 | `ontem gastei no restaurante 85 reais` | Alimentação | Restaurante | ✅ |
| 3 | `comprei um calçado por 295` | Vestuário | Calçados | ✅ |
| 4 | `comprei uma melancia ontem por 60 reais` | Alimentação | Hortifruti | ✅ |
| 5 | `ganhei 50 reais do meu pai` | Outras Receitas | Presentes | ✅ |
| 6 | `recebi de freela 5000 reais` | Renda Extra | Freelance | ✅ |
| 7 | `Recebi vale alimentacao de 300 reais` | Benefícios ou Alimentação | Vale Alimentação | ✅ |

**Total: 47 testes passando (100%)**

## � Features Implementadas

## 🚧 Melhorias Futuras

### ragAiEnabled = true (Embeddings com IA)

**✅ IMPLEMENTADO!** Agora você pode:
- Usar embeddings de IA (OpenAI, Google Gemini)
- Busca semântica com similaridade de cosseno
- Indexação automática de categorias com vetores
- Fallback para BM25 em caso de erro

### Armazenamento de Embeddings

**Planejado**:
- Salvar embeddings no banco (pgvector)
- Cache persistente de embeddings
- Atualização incremental (só categorias alteradas)

**Atual**:
- Embeddings armazenados em cache Redis
- Reindexação necessária ao atualizar categorias
  }'

# 2. Desabilitar embeddings (volta para BM25)
curl -X PATCH http://localhost:3000/admin/ai/settings \
  -H "Content-Type: application/json" \
  -d '{"ragAiEnabled": false}'
```

### Via Banco de Dados

```sql
-- Habilitar embeddings com OpenAI
UPDATE ai_settings SET 
  rag_enabled = true,
  rag_ai_enabled = true,
  rag_ai_provider = 'openai',
  rag_threshold = 0.7;

-- Usar Google Gemini (mais barato)
UPDATE ai_settings SET 
  rag_ai_provider = 'google_gemini';

-- Desabilitar embeddings (volta para BM25)
UPDATE ai_settings SET 
  rag_ai_enabled = false;
```

## 💰 Custos por Provider

| Provider | Modelo | Custo por 1M tokens | Dimensões |
|----------|--------|---------------------|-----------|
| OpenAI | text-embedding-3-small | $0.020 | 1536 |
| Google Gemini | text-embedding-004 | $0.00001 | 768 |
| Groq | - | ❌ Não suporta | - |

**Exemplo de custo real**:
```
100 categorias × 10 palavras/categoria = 1000 tokens
1000 tokens / 1M × $0.020 = $0.00002 (OpenAI)
1000 tokens / 1M × $0.00001 = $0.00001 (Gemini)

Custo de indexação uma vez: ~$0.00002
Custo por query (1 embedding): ~$0.00001
```

**Recomendação**: Use **Google Gemini** (50% mais barato que OpenAI)

## �🚧 Features NÃO Implementadas (Futuro)

### ragAiEnabled = true (Embeddings com IA)

**Quando implementado, permitirá:**
- Usar embeddings de IA (OpenAI, Groq, Gemini) para busca semântica
- Vetores armazenados no banco (pgvector ou cache)
- Score baseado em similaridade de cosseno
- Melhor compreensão de sinônimos complexos

**Fluxo planejado**:
```typescript
if (aiSettings.ragAiEnabled) {
  // Gerar embedding da query
  const queryEmbedding = await aiProvider.generateEmbedding(text);
  
  // Buscar categorias por similaridade vetorial
  const matches = await vectorSearch(queryEmbedding, userCategories);
  
  // Retornar matches com score de cosine similarity
  return matches.filter(m => m.score >= threshold);
} else {
  // Usar BM25 (implementação atual)
  return bm25Search(text, userCategories);
}
```

### ragAiProvider (OpenAI, Groq, Gemini)

**Quando implementado, permitirá:**
- Escolher qual AI usar para embeddings
- Fallback entre providers
- Rate limiting por provider

## 🎯 Como Habilitar/Desabilitar RAG

### Via Admin API

```bash
# Habilitar RAG
curl -X PATCH http://localhost:3000/admin/ai/settings \
  -H "Content-Type: application/json" \
  -d '{"ragEnabled": true}'

# Desabilitar RAG
curl -X PATCH http://localhost:3000/admin/ai/settings \
  -H "Content-Type: application/json" \
  -d '{"ragEnabled": false}'

# Ajustar threshold
curl -X PATCH http://localhost:3000/admin/ai/settings \
  -H "Content-Type: application/json" \
  -d '{"ragThreshold": 0.25}'
```

### Via Banco de Dados

```sql
-- Habilitar RAG
UPDATE ai_settings SET rag_enabled = true;

-- Desabilitar RAG
UPDATE ai_settings SET rag_enabled = false;

-- Ajustar threshold
UPDATE ai_settings SET rag_threshold = 0.25;
```

## 📈 Analytics

### RAGSearchLog (Banco de Dados)

Todas as tentativas de busca são logadas:

```prisma
model RAGSearchLog {
  id              String   @id @default(uuid())
  userId          String   // gastoCertoId
  query           String   // Query original
  queryNormalized String   // Query normalizada
  matches         Json     // Array de matches
  bestMatch       String?  // Nome da melhor categoria
  bestScore       Decimal? // Score do melhor match
  threshold       Decimal  // Threshold usado
  success         Boolean  // true se encontrou >= threshold
  ragMode         String   // "BM25" ou "AI" (futuro)
  responseTime    Int?     // Tempo em ms
  createdAt       DateTime
}
```

### Consultar Falhas

```typescript
// Buscar queries que não deram match
const failedSearches = await ragService.getSearchAttempts(userId, true);

// Ver todas as tentativas
const allSearches = await ragService.getSearchAttempts(userId, false);
```

## 🔍 Debugging

### Logs Úteis

```typescript
// Ativar debug logs
// src/infrastructure/ai/rag/rag.service.ts
this.logger.debug('🔍 Buscando por: "texto" → tokens: [...]');
this.logger.debug('📊 Score BM25 para "categoria": 0.85 | Sinônimos: 0.25');
this.logger.debug('✅ Match exato: "categoria" (boost 2.0x)');
```

### Verificar Categorias Indexadas

```typescript
// No console do app
const categories = await ragService.getUserCategories(userId);
console.log('Categorias indexadas:', categories.length);
```

### Testar Manualmente

```typescript
const matches = await ragService.findSimilarCategories(
  'comprei frutas',
  userId,
  { minScore: 0.25, maxResults: 3 }
);
console.log('Matches:', matches);
```

## 🎓 Referências

- [BM25 - Wikipedia](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Retrieval-Augmented Generation (RAG)](https://arxiv.org/abs/2005.11401)
- [pgvector - PostgreSQL extension for vector similarity search](https://github.com/pgvector/pgvector)
