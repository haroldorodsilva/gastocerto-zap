# Guia Completo: RAG e Sinônimos - Debug e Administração

## 📋 Índice
- [Visão Geral](#visão-geral)
- [API Admin para Testes](#api-admin-para-testes)
- [Como Analisar Logs e Criar Sinônimos](#como-analisar-logs-e-criar-sinônimos)
- [Estrutura de Dados](#estrutura-de-dados)
- [Fluxo de Matching](#fluxo-de-matching)
- [Exemplos Práticos](#exemplos-práticos)

## 🎯 Visão Geral

O sistema RAG (Retrieval-Augmented Generation) usa **BM25** para matching semântico de categorias, sem dependências externas como OpenAI ou embeddings vetoriais.

### Conceitos Chave

- **userId**: PK do `UserCache` (formato: `gc-{gastoCertoId}`)
- **gastoCertoId**: ID do usuário na API GastoCerto
- **Sinônimos Globais**: Definidos no código (`rag.service.ts`)
- **Sinônimos Personalizados**: Tabela `UserSynonym` por usuário
- **BM25 Score**: Algoritmo de relevância (0.0 a 1.0+)
- **Threshold**: Mínimo 0.3 para considerar match válido

## 🔧 API Admin para Testes

### Endpoint 1: Testar Match (SEM criar logs)

```http
POST /admin/rag/test-match
Content-Type: application/json

{
  "userId": "gc-123456",
  "query": "Paguei o supermercado"
}
```

**Resposta:**
```json
{
  "matches": [
    {
      "categoryId": "cat-1",
      "categoryName": "Alimentação",
      "subCategoryId": "sub-1",
      "subCategoryName": "Supermercado",
      "score": 0.95,
      "matchedTerms": ["supermercado", "supermercado→alimentacao"]
    }
  ],
  "suggestions": [
    {
      "type": "partial_match",
      "keyword": "mercado",
      "categoryName": "Alimentação",
      "subCategoryName": "Supermercado",
      "reason": "Tokens parcialmente similares",
      "confidence": 0.6
    }
  ],
  "consideredCategories": [
    {
      "categoryId": "cat-1",
      "categoryName": "Alimentação",
      "subCategoryId": "sub-1",
      "subCategoryName": "Supermercado",
      "score": 0.95
    },
    {
      "categoryId": "cat-2",
      "categoryName": "Transporte",
      "subCategoryId": "sub-5",
      "subCategoryName": "Combustível",
      "score": 0.0
    }
  ],
  "userSynonyms": [
    {
      "keyword": "mercado",
      "categoryName": "Alimentação",
      "subCategoryName": "Supermercado",
      "confidence": 0.85,
      "usageCount": 12,
      "createdAt": "2026-01-10T10:00:00Z"
    }
  ],
  "debug": {
    "queryNormalized": "paguei o supermercado",
    "queryTokens": ["paguei", "supermercado"],
    "totalCategoriesEvaluated": 45,
    "matchingThreshold": 0.3,
    "processingTimeMs": 25
  }
}
```

### Endpoint 2: Análise Detalhada (Todas Categorias)

```http
POST /admin/rag/analyze
Content-Type: application/json

{
  "userId": "gc-123456",
  "query": "gasolina"
}
```

**Resposta:**
```json
{
  "query": "gasolina",
  "queryNormalized": "gasolina",
  "queryTokens": ["gasolina"],
  "categories": [
    {
      "categoryId": "cat-2",
      "categoryName": "Transporte",
      "subCategoryId": "sub-5",
      "subCategoryName": "Combustível",
      "score": 0.88,
      "matchedTokens": ["gasolina"],
      "reason": "Match forte"
    },
    {
      "categoryId": "cat-1",
      "categoryName": "Alimentação",
      "subCategoryId": "sub-1",
      "subCategoryName": "Supermercado",
      "score": 0.0,
      "matchedTokens": [],
      "reason": "Sem match"
    }
  ]
}
```

### Endpoint 3: Buscar Logs de Usuário

```http
GET /admin/rag/logs/{userId}?failedOnly=true&limit=20
```

**Resposta:**
```json
[
  {
    "id": "log-1",
    "userId": "123456",
    "query": "paguei uber",
    "queryNormalized": "paguei uber",
    "matches": [],
    "bestMatch": null,
    "bestScore": null,
    "threshold": 0.3,
    "success": false,
    "ragMode": "bm25",
    "responseTime": 15,
    "createdAt": "2026-01-13T10:30:00Z"
  }
]
```

### Endpoint 4: Listar Sinônimos do Usuário

```http
GET /admin/rag/synonyms/{userId}
```

### Endpoint 5: Criar Sinônimo Global

```http
POST /admin/rag/synonym/global
Content-Type: application/json

{
  "keyword": "uber",
  "categoryId": "cat-2",
  "subCategoryId": "sub-10"
}
```

## 📊 Como Analisar Logs e Criar Sinônimos

### Passo 1: Identificar Queries com Falha

```bash
# Buscar logs que falharam
GET /admin/rag/logs/gc-123456?failedOnly=true
```

### Passo 2: Testar a Query

```bash
# Simular o processamento
POST /admin/rag/test-match
{
  "userId": "gc-123456",
  "query": "paguei uber"
}
```

Análise do retorno:
- **matches vazio**: Nenhuma categoria encontrada
- **suggestions**: O sistema sugere categorias similares
- **consideredCategories**: Ver scores de todas categorias

### Passo 3: Analisar Score Detalhado

```bash
# Ver TODAS categorias e seus scores
POST /admin/rag/analyze
{
  "userId": "gc-123456",
  "query": "paguei uber"
}
```

Interpretação:
- **score >= 0.7**: Match forte ✅
- **score 0.3-0.7**: Match médio ⚠️
- **score < 0.3**: Sem match ❌

### Passo 4: Decidir Tipo de Sinônimo

#### Opção A: Sinônimo Global (todos os usuários)

Editar manualmente `src/infrastructure/ai/rag/rag.service.ts`:

```typescript
private readonly synonyms = new Map<string, string[]>([
  // ... outros sinônimos
  ['uber', ['transporte', 'taxi', 'corrida', 'viagem']],
  ['99', ['transporte', 'taxi', 'corrida', 'viagem']],
]);
```

**Quando usar:**
- Palavras comuns (uber, ifood, netflix)
- Marcas conhecidas
- Termos genéricos

#### Opção B: Sinônimo Personalizado (apenas um usuário)

O sistema cria automaticamente via Learning:

```typescript
// Já implementado - acontece automaticamente quando:
// 1. Usuário confirma/corrige uma categoria
// 2. Sistema detecta padrão de uso

// Ou criar manualmente via Prisma:
await prisma.userSynonym.create({
  data: {
    userId: '123456', // gastoCertoId
    keyword: 'mercadinho',
    categoryId: 'cat-1',
    subCategoryId: 'sub-1',
    confidence: 0.8,
  }
});
```

**Quando usar:**
- Termos específicos do usuário
- Apelidos ou abreviações pessoais
- Variações regionais

### Passo 5: Validar Sinônimo

```bash
# Testar novamente após criar sinônimo
POST /admin/rag/test-match
{
  "userId": "gc-123456",
  "query": "paguei uber"
}

# Deve retornar match com score alto
```

## 📐 Estrutura de Dados

### UserCache (Tabela Principal)

```prisma
model UserCache {
  id              String   @id // PK: "gc-{gastoCertoId}"
  gastoCertoId    String   @unique
  phoneNumber     String
  realPhoneNumber String?
  name            String?
  // ...
}
```

### UserSynonym (Sinônimos Personalizados)

```prisma
model UserSynonym {
  id            String   @id @default(uuid())
  userId        String   // gastoCertoId (FK)
  keyword       String   // Palavra-chave (normalizada)
  categoryId    String
  subCategoryId String?
  confidence    Float    @default(0.5)
  usageCount    Int      @default(0)
  lastUsedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  category      Category     @relation(...)
  subCategory   SubCategory? @relation(...)
}
```

### RAGSearchLog (Logs de Busca)

```prisma
model RAGSearchLog {
  id                String   @id @default(uuid())
  userId            String   // gastoCertoId
  query             String
  queryNormalized   String
  matches           Json     // Array de matches
  bestMatch         String?
  bestScore         Float?
  threshold         Float
  success           Boolean
  ragMode           String   // "bm25"
  responseTime      Int      // ms
  createdAt         DateTime @default(now())
  
  // Novos campos de tracking
  flowStep          Int?
  totalSteps        Int?
  aiProvider        String?
  aiModel           String?
  aiConfidence      Float?
  aiCategoryId      String?
  aiCategoryName    String?
  finalCategoryId   String?
  finalCategoryName String?
  ragInitialScore   Float?
  ragFinalScore     Float?
  wasAiFallback     Boolean  @default(false)
}
```

## 💡 Exemplos Práticos

### Exemplo 1: Query sem Match

**Situação:**
```
Query: "paguei netflix"
Resultado: Nenhum match (score < 0.3)
```

**Análise:**
```bash
POST /admin/rag/analyze
{
  "userId": "gc-123456",
  "query": "paguei netflix"
}

# Resposta mostra que nenhuma categoria tem "netflix"
# Score mais alto: "Assinaturas" (0.15 - muito baixo)
```

**Solução:**
Adicionar sinônimo global:

```typescript
// rag.service.ts
['netflix', ['assinatura', 'streaming', 'video', 'entretenimento']],
```

### Exemplo 2: Match Médio

**Situação:**
```
Query: "fui no mercadinho"
Resultado: "Supermercado" (score: 0.45)
```

**Análise:**
- Score 0.45 é médio (0.3-0.7)
- Funciona mas pode melhorar

**Solução:**
Criar sinônimo personalizado:

```typescript
// O sistema aprende automaticamente quando usuário confirma
// Ou criar manualmente:
await ragLearningService.learnFromCorrection(
  '123456',
  'fui no mercadinho',
  'cat-1',
  'sub-1'
);
```

### Exemplo 3: Múltiplas Categorias Possíveis

**Situação:**
```
Query: "água"
Matches:
  1. "Alimentação > Água" (0.75)
  2. "Moradia > Conta de Água" (0.70)
```

**Análise:**
- Dois matches válidos
- Contexto importa

**Solução:**
1. Verificar histórico do usuário
2. Se sempre paga conta, criar sinônimo personalizado: "água" → "Moradia > Conta de Água"
3. Se compra garrafas, criar: "água" → "Alimentação > Água"

### Exemplo 4: Termo Regional

**Situação:**
```
Query: "passei no sacolão"
Resultado: Nenhum match
```

**Análise:**
- "sacolão" não existe nos sinônimos
- É termo regional para feira/hortifruti

**Solução:**
Sinônimo global OU personalizado:

```typescript
// Global (se comum na região):
['sacolao', ['feira', 'hortifruti', 'verduras', 'frutas', 'alimentacao']],

// Personalizado (se só esse usuário usa):
await createUserSynonym({
  userId: '123456',
  keyword: 'sacolao',
  categoryId: 'cat-1',
  subCategoryId: 'sub-hortifruti'
});
```

## 🎓 Dicas de Otimização

### 1. Priorizar Sinônimos Globais

- Mais eficiente
- Beneficia todos os usuários
- Manutenção centralizada

### 2. Monitorar Taxa de Falha

```sql
-- Query SQL para ver taxa de sucesso
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as sucessos,
  ROUND(100.0 * SUM(CASE WHEN success = true THEN 1 ELSE 0 END) / COUNT(*), 2) as taxa_sucesso
FROM "RAGSearchLog"
WHERE "createdAt" >= NOW() - INTERVAL '7 days';
```

Meta: **> 80% de taxa de sucesso**

### 3. Analisar Queries Mais Comuns sem Match

```sql
-- Top 10 queries que falharam
SELECT 
  "queryNormalized",
  COUNT(*) as ocorrencias
FROM "RAGSearchLog"
WHERE success = false
  AND "createdAt" >= NOW() - INTERVAL '7 days'
GROUP BY "queryNormalized"
ORDER BY ocorrencias DESC
LIMIT 10;
```

## 🚨 Troubleshooting

### Problema: Match retorna categoria errada

**Causa:** Sinônimo muito genérico

**Solução:**
```bash
# 1. Ver sinônimos do usuário
GET /admin/rag/synonyms/gc-123456

# 2. Verificar qual sinônimo está causando problema
# 3. Ajustar confidence ou remover
DELETE FROM "UserSynonym" WHERE id = 'syn-xxx';
```

### Problema: Score sempre muito baixo

**Causa:** Threshold muito alto ou categorias mal nomeadas

**Solução:**
```bash
# 1. Analisar detalhadamente
POST /admin/rag/analyze

# 2. Verificar tokens da categoria
# 3. Renomear categoria ou adicionar sinônimos
```

## 📈 Métricas Recomendadas

### Dashboard Sugerido

1. **Taxa de Sucesso Geral**: % de queries com match
2. **Top 10 Categorias**: Mais usadas
3. **Queries sem Match**: Lista para análise
4. **Tempo Médio de Resposta**: Performance
5. **Sinônimos por Usuário**: Distribuição
6. **Confidence Médio**: Qualidade dos matches

---

## 📞 Suporte

Para dúvidas ou melhorias neste guia, consulte:
- Código: `src/infrastructure/ai/rag/`
- Controller Admin: `src/admin/controllers/rag-admin.controller.ts`
- Testes: `test/unit/rag-category-matching.spec.ts`
