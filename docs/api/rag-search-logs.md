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
| `limit` | `number` | ❌ Opcional | Número máximo de registros retornados | `100` |

## Exemplos de Uso

```bash
# Todos os logs (últimos 100)
GET /admin/rag/search-logs

# Apenas logs de falha
GET /admin/rag/search-logs?failedOnly=true

# Logs de um usuário específico
GET /admin/rag/search-logs?userId=123e4567-e89b-12d3-a456-426614174000

# Logs de falha de um usuário com limite
GET /admin/rag/search-logs?userId=123e4567-e89b-12d3-a456-426614174000&failedOnly=true&limit=50
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
      "bestMatch": "melhor correspondência encontrada ou null",
      "bestScore": 0.85,
      "success": true,
      "createdAt": "2025-12-18T10:30:00.000Z"
    }
  ],
  "stats": {
    "totalAttempts": 150,
    "successfulAttempts": 135,
    "failedAttempts": 15,
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
- **`query`**: `string` - Texto da query de busca
- **`bestMatch`**: `string | null` - Melhor correspondência encontrada (ou `null` se falhou)
- **`bestScore`**: `number | null` - Score de similaridade da melhor correspondência (0-1)
- **`success`**: `boolean` - Se a busca foi bem-sucedida
- **`createdAt`**: `Date` - Timestamp da busca

### Campo `stats` (Estatísticas)
- **`totalAttempts`**: `number` - Total de tentativas
- **`successfulAttempts`**: `number` - Tentativas bem-sucedidas
- **`failedAttempts`**: `number` - Tentativas que falharam
- **`successRate`**: `string` - Taxa de sucesso em porcentagem
- **`topFailedQueries`**: `Array` - Top 10 queries que mais falharam

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

## Notas Técnicas
- Os logs são ordenados por data decrescente (mais recentes primeiro)
- Máximo de 100 registros retornados por padrão no GET (configurado no RAGService)
- Queries vazias ou `null` são tratadas adequadamente
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