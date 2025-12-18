# 📊 Documentação das Rotas RAG Search Logs

## Descrição
Endpoints para consultar e gerenciar logs de busca RAG (Retrieval-Augmented Generation) salvos no banco de dados para analytics e monitoramento.

---

# 📋 GET /admin/rag/search-logs

## Descrição
Consulta logs de busca RAG salvos no banco de dados.

## URL
```
GET /admin/rag/search-logs
```

## Parâmetros de Query (Inputs)

| Parâmetro | Tipo | Obrigatório | Descrição | Valor Padrão |
|-----------|------|-------------|-----------|---------------|
| `userId` | `string` | ❌ Opcional | Filtrar logs por ID específico do usuário | `null` (todos os usuários) |
| `failedOnly` | `boolean` | ❌ Opcional | Mostrar apenas tentativas que falharam (`true`) ou todas (`false`) | `false` (todas) |
| `limit` | `number` | ❌ Opcional | Número máximo de registros por página (máx: 100) | `20` |
| `offset` | `number` | ❌ Opcional | Número de registros para pular (paginação) | `0` |

## Exemplos de Uso

```bash
# Primeiros 20 logs mais recentes (padrão)
GET /admin/rag/search-logs

# Próxima página (21-40)
GET /admin/rag/search-logs?limit=20&offset=20

# Primeiros 50 logs
GET /admin/rag/search-logs?limit=50

# Apenas logs de falha
GET /admin/rag/search-logs?failedOnly=true

# Logs de um usuário específico
GET /admin/rag/search-logs?userId=123e4567-e89b-12d3-a456-426614174000

# Logs de falha de um usuário com paginação
GET /admin/rag/search-logs?userId=123e4567-e89b-12d3-a456-426614174000&failedOnly=true&limit=20&offset=20
```

## Resposta de Sucesso (200)

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-do-log",
      "userId": "uuid-do-usuario",
      "query": "texto da busca realizada",
      "queryNormalized": "texto normalizado lowercase sem acentos",
      "matches": [
        {
          "categoryId": "uuid",
          "categoryName": "Alimentação",
          "subCategoryId": "uuid",
          "subCategoryName": "Supermercado",
          "score": 0.95,
          "matchedTerms": ["supermercado"]
        }
      ],
      "bestMatch": "melhor correspondência encontrada ou null",
      "bestScore": 0.85,
      "threshold": 0.6,
      "success": true,
      "ragMode": "BM25",
      "responseTime": 45,
      "createdAt": "2025-12-18T10:30:00.000Z"
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
    "successfulAttempts": 18,
    "failedAttempts": 2,
    "successRate": "90.00%",
    "topFailedQueries": [
      {
        "query": "query que mais falhou",
        "count": 5
      }
    ]
  },
  "timestamp": "2025-12-18T10:30:00.000Z"
}
```

## Estrutura dos Dados

### Campo `data` (Array de logs)
- **`id`**: `string` - ID único do log
- **`userId`**: `string` - ID do usuário que fez a busca
- **`query`**: `string` - Texto da query de busca (original)
- **`queryNormalized`**: `string` - Query normalizada (lowercase, sem acentos)
- **`matches`**: `Array` - Array completo de matches encontrados com scores
  - `categoryId`: ID da categoria
  - `categoryName`: Nome da categoria
  - `subCategoryId`: ID da subcategoria (se houver)
  - `subCategoryName`: Nome da subcategoria (se houver)
  - `score`: Score de similaridade (0-1)
  - `matchedTerms`: Termos que geraram o match
- **`bestMatch`**: `string | null` - Melhor correspondência encontrada (ou `null` se falhou)
- **`bestScore`**: `number | null` - Score de similaridade da melhor correspondência (0-1)
- **`threshold`**: `number` - Threshold mínimo usado na busca (ex: 0.6 = 60%)
- **`success`**: `boolean` - Se a busca foi bem-sucedida (bestScore >= threshold)
- **`ragMode`**: `string` - Modo usado: "BM25" ou "AI"
- **`responseTime`**: `number` - Tempo de resposta em milissegundos
- **`createdAt`**: `Date` - Timestamp da busca

### Campo `pagination` (Informações de paginação)
- **`total`**: `number` - Total de registros no banco
- **`limit`**: `number` - Limite de registros por página
- **`offset`**: `number` - Offset atual (registros pulados)
- **`hasMore`**: `boolean` - Se há mais registros para buscar
- **`pages`**: `number` - Total de páginas disponíveis
- **`currentPage`**: `number` - Página atual (1-indexed)

### Campo `stats` (Estatísticas da página atual)
- **`totalRecords`**: `number` - Total de registros no banco
- **`currentPageAttempts`**: `number` - Tentativas na página atual
- **`successfulAttempts`**: `number` - Tentativas bem-sucedidas na página
- **`failedAttempts`**: `number` - Tentativas que falharam na página
- **`successRate`**: `string` - Taxa de sucesso em porcentagem (página atual)
- **`topFailedQueries`**: `Array` - Top 10 queries que mais falharam (página atual)

## Resposta de Erro (200 com success: false)

```json
{
  "success": false,
  "message": "Erro ao buscar logs RAG",
  "error": "mensagem detalhada do erro",
  "timestamp": "2025-12-18T10:30:00.000Z"
}
```

---

## � Exemplo Detalhado de Resposta

### Exemplo com todos os campos (busca bem-sucedida)
```json
{
  "success": true,
  "data": [
    {
      "id": "abc123-def456-ghi789",
      "userId": "user-uuid-123",
      "query": "supermercado",
      "queryNormalized": "supermercado",
      "matches": [
        {
          "categoryId": "cat-uuid-1",
          "categoryName": "Alimentação",
          "subCategoryId": "sub-uuid-1",
          "subCategoryName": "Supermercado",
          "score": 0.95,
          "matchedTerms": ["supermercado", "mercado"]
        },
        {
          "categoryId": "cat-uuid-2",
          "categoryName": "Alimentação",
          "subCategoryId": "sub-uuid-2",
          "subCategoryName": "Feira",
          "score": 0.72,
          "matchedTerms": ["supermercado"]
        }
      ],
      "bestMatch": "Alimentação > Supermercado",
      "bestScore": 0.95,
      "threshold": 0.6,
      "success": true,
      "ragMode": "BM25",
      "responseTime": 45,
      "createdAt": "2025-12-18T10:30:00.000Z"
    }
  ],
  "pagination": { /* ... */ },
  "stats": { /* ... */ }
}
```

### Exemplo de busca que falhou
```json
{
  "data": [
    {
      "id": "xyz789",
      "userId": "user-uuid-456",
      "query": "xpto123",
      "queryNormalized": "xpto123",
      "matches": [
        {
          "categoryId": "cat-uuid-3",
          "categoryName": "Outros",
          "score": 0.15,
          "matchedTerms": []
        }
      ],
      "bestMatch": null,
      "bestScore": 0.15,
      "threshold": 0.6,
      "success": false,
      "ragMode": "BM25",
      "responseTime": 38,
      "createdAt": "2025-12-18T10:25:00.000Z"
    }
  ]
}
```

---

## �🔄 Exemplos de Paginação

### Exemplo 1: Listar primeiros 20 registros
```bash
GET /admin/rag/search-logs
# ou explicitamente:
GET /admin/rag/search-logs?limit=20&offset=0
```

**Resposta:**
```json
{
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true,
    "pages": 8,
    "currentPage": 1
  }
}
```

### Exemplo 2: Próxima página (21-40)
```bash
GET /admin/rag/search-logs?limit=20&offset=20
```

**Resposta:**
```json
{
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 20,
    "hasMore": true,
    "pages": 8,
    "currentPage": 2
  }
}
```

### Exemplo 3: Aumentar limite para 50
```bash
GET /admin/rag/search-logs?limit=50&offset=0
```

**Resposta:**
```json
{
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true,
    "pages": 3,
    "currentPage": 1
  }
}
```

### Exemplo 4: Última página
```bash
GET /admin/rag/search-logs?limit=20&offset=140
```

**Resposta:**
```json
{
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 140,
    "hasMore": false,
    "pages": 8,
    "currentPage": 8
  }
}
```

---

# 🗑️ DELETE /admin/rag/search-logs

## Descrição
Deleta múltiplos logs de busca RAG por seus IDs.

## URL
```
DELETE /admin/rag/search-logs
```

## Body (Inputs)

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `ids` | `string[]` | ✅ Sim | Array de IDs dos logs a serem deletados |

## Exemplo de Uso

```bash
curl -X DELETE /admin/rag/search-logs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "ids": [
      "uuid-log-1",
      "uuid-log-2",
      "uuid-log-3"
    ]
  }'
```

## Resposta de Sucesso (200)

```json
{
  "success": true,
  "message": "3 logs deletados com sucesso",
  "deletedCount": 3,
  "timestamp": "2025-12-18T10:30:00.000Z"
}
```

## Resposta de Erro (400 - Bad Request)

```json
{
  "success": false,
  "message": "IDs são obrigatórios e devem ser um array não vazio",
  "timestamp": "2025-12-18T10:30:00.000Z"
}
```

## Resposta de Erro (200 com success: false)

```json
{
  "success": false,
  "message": "Erro ao deletar logs RAG",
  "error": "mensagem detalhada do erro",
  "timestamp": "2025-12-18T10:30:00.000Z"
}
```

---

## 📝 Notas Técnicas
- Os logs são ordenados por data decrescente (mais recentes primeiro)
- **Limite padrão:** 20 registros por página
- **Limite máximo:** 100 registros por página
- Campo `hasMore` indica se há mais páginas disponíveis
- Campo `currentPage` é 1-indexed (primeira página = 1)
- Queries vazias ou `null` são tratadas adequadamente
- Use `offset = currentPage * limit` para calcular próxima página
- Scores são convertidos para `number` para garantir compatibilidade JSON
- As rotas requerem autenticação de admin
- O DELETE permite deletar múltiplos logs em uma única requisição
- IDs inexistentes são ignorados (não causam erro)

## Uso Recomendado
- **Monitoramento**: Acompanhar taxa de sucesso das buscas RAG
- **Debug**: Identificar queries que frequentemente falham
- **Analytics**: Analisar padrões de busca dos usuários
- **Otimização**: Melhorar o sistema RAG baseado nos dados de falha
- **Limpeza**: Remover logs antigos ou irrelevantes para manter o banco limpo