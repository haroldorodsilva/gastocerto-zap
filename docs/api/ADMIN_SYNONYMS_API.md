# Admin API - Sinônimos e Sincronização

Documentação completa dos endpoints de administração para integração com gastocerto-api.

## 🔐 Autenticação

Todos os endpoints requerem autenticação via JWT:

```http
Authorization: Bearer <JWT_TOKEN>
```

**Importante**: O usuário deve ter permissão de admin no sistema.

---

## 📋 Índice

1. [Sincronização de Categorias](#1-sincronização-de-categorias)
2. [Estatísticas de Sinônimos](#2-estatísticas-de-sinônimos)
3. [Sugestões de Aprendizado](#3-sugestões-de-aprendizado)
4. [Criar Sinônimo](#4-criar-sinônimo)
5. [Criar Sinônimos em Batch](#5-criar-sinônimos-em-batch)
6. [Criar Sinônimo Global](#6-criar-sinônimo-global)
7. [Listar Sinônimos do Usuário](#7-listar-sinônimos-do-usuário)
8. [Editar Sinônimo](#8-editar-sinônimo)
9. [Deletar Sinônimo](#9-deletar-sinônimo)

---

## 1. Sincronização de Categorias

### `POST /external/sync-categories`

**Descrição**: Sincroniza categorias e accounts do usuário quando há mudanças na gastocerto-api.

**Quando chamar**:
- Usuário cria/edita/remove categoria
- Usuário muda conta padrão
- Usuário cria/edita/remove account (perfil)

**Request**:
```json
POST http://localhost:4444/external/sync-categories
Content-Type: application/json

{
  "phoneNumber": "5511999999999",
  "userId": "d6cb1abb-9b6e-49ce-bfa6-b65aa607fd67"
}
```

**Response Success**:
```json
{
  "success": true,
  "message": "Categorias sincronizadas com sucesso"
}
```

**Response Error**:
```json
{
  "success": false,
  "message": "Erro ao sincronizar categorias",
  "error": "Mensagem de erro detalhada"
}
```

**Exemplo em Node.js**:
```javascript
const syncCategories = async (userId, phoneNumber) => {
  const response = await axios.post(`${ZAP_API_URL}/external/sync-categories`, {
    userId,
    phoneNumber
  }, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  return response.data;
};

// Chamar quando usuário editar categoria
await syncCategories('uuid-do-usuario', '5511999999999');
```

---

## 2. Estatísticas de Sinônimos

### `GET /admin/synonyms/stats`

**Descrição**: Retorna estatísticas gerais sobre sinônimos no sistema.

**Request**:
```http
GET http://localhost:4444/admin/synonyms/stats
Authorization: Bearer <JWT_TOKEN>
```

**Response**:
```json
{
  "success": true,
  "stats": {
    "totalSynonyms": 1247,
    "bySource": {
      "USER_CONFIRMED": 856,
      "AI_SUGGESTED": 234,
      "AUTO_LEARNED": 89,
      "ADMIN_APPROVED": 68
    },
    "topKeywords": [
      {
        "id": "uuid-synonym-1",
        "keyword": "pro labore",
        "usageCount": 145,
        "categoryName": "Receitas",
        "subCategoryName": "Salário",
        "confidence": 1.0,
        "source": "USER_CONFIRMED",
        "createdAt": "2025-12-20T10:30:00Z",
        "lastUsedAt": "2025-12-23T08:15:00Z",
        "user": {
          "gastoCertoId": "uuid-user-1",
          "name": "João Silva",
          "phoneNumber": "5511999999999"
        }
      }
    ],
    "topCategories": [
      {
        "categoryName": "Alimentação",
        "synonymCount": 342
      }
    ],
    "recentSynonyms": [
      {
        "id": "uuid-synonym-2",
        "keyword": "ifood",
        "categoryName": "Alimentação",
        "subCategoryName": "Delivery",
        "usageCount": 12,
        "source": "USER_CONFIRMED",
        "createdAt": "2025-12-23T09:00:00Z",
        "user": {
          "gastoCertoId": "uuid-user-2",
          "name": "Maria Santos",
          "phoneNumber": "5511988888888"
        }
      }
    ],
    "recentlyCreatedCount": 45,
    "learningOpportunities": 127
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Campos**:
- `totalSynonyms`: Total de sinônimos no sistema
- `bySource`: Distribuição por origem (USER_CONFIRMED, AI_SUGGESTED, etc)
- `topKeywords`: Top 10 keywords mais usadas com dados do usuário
- `topCategories`: Top 10 categorias com mais sinônimos
- `recentSynonyms`: 10 sinônimos criados nos últimos 7 dias
- `recentlyCreatedCount`: Total de sinônimos criados nos últimos 7 dias
- `learningOpportunities`: Quantidade de logs AI com potencial para criar sinônimos

---

## 3. Sugestões de Aprendizado

### `GET /admin/synonyms/learning-suggestions`

**Descrição**: Analisa logs de AI e sugere criação de novos sinônimos baseado em padrões detectados.

**Query Parameters**:
- `limit` (opcional): Número máximo de sugestões. Default: 50
- `minOccurrences` (opcional): Mínimo de ocorrências. Default: 3
- `minAiConfidence` (opcional): Confiança mínima da IA. Default: 0.7

**Request**:
```http
GET http://localhost:4444/admin/synonyms/learning-suggestions?limit=20&minOccurrences=5
Authorization: Bearer <JWT_TOKEN>
```

**Response**:
```json
{
  "success": true,
  "suggestions": [
    {
      "keyword": "uber",
      "userCount": 15,
      "totalOccurrences": 87,
      "suggestedCategoryId": "uuid-category-1",
      "suggestedCategoryName": "Transporte",
      "suggestedSubCategoryName": "Aplicativo",
      "avgAiConfidence": 0.92,
      "lastUsedAt": "2025-12-23T12:00:00Z",
      "exampleQueries": [
        "paguei uber 25 reais",
        "corrida de uber ontem",
        "uber até o aeroporto"
      ],
      "users": [
        {
          "gastoCertoId": "uuid-user-1",
          "name": "João Silva",
          "phoneNumber": "5511999999999"
        },
        {
          "gastoCertoId": "uuid-user-2",
          "name": "Maria Santos",
          "phoneNumber": "5511988888888"
        }
      ]
    }
  ],
  "total": 20,
  "filters": {
    "minOccurrences": 5,
    "minAiConfidence": 0.7,
    "limit": 20
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Campos**:
- `keyword`: Termo detectado
- `userCount`: Quantos usuários diferentes usaram
- `totalOccurrences`: Total de vezes que apareceu
- `suggestedCategoryId/Name`: Categoria sugerida pela IA
- `suggestedSubCategoryName`: Subcategoria sugerida
- `avgAiConfidence`: Confiança média da IA (0-1)
- `exampleQueries`: Exemplos de frases onde apareceu
- `users`: Lista de até 5 usuários que usaram o termo

**Use Case**: Identificar padrões comuns entre usuários para criar sinônimos globais.

---

## 4. Criar Sinônimo

### `POST /admin/synonyms`

**Descrição**: Cria um novo sinônimo para um usuário específico.

**Request**:
```json
POST http://localhost:4444/admin/synonyms
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "userId": "d6cb1abb-9b6e-49ce-bfa6-b65aa607fd67",
  "keyword": "netflix",
  "categoryId": "uuid-category-1",
  "categoryName": "Entretenimento",
  "subCategoryId": "uuid-subcategory-1",
  "subCategoryName": "Streaming",
  "confidence": 1.0,
  "source": "ADMIN_APPROVED"
}
```

**Campos**:
- `userId` (obrigatório): gastoCertoId do usuário
- `keyword` (obrigatório): Termo a ser aprendido (normalizado automaticamente)
- `categoryId` (obrigatório): UUID da categoria na gastocerto-api
- `categoryName` (obrigatório): Nome da categoria
- `subCategoryId` (opcional): UUID da subcategoria
- `subCategoryName` (opcional): Nome da subcategoria
- `confidence` (opcional): Confiança (0-1). Default: 1.0
- `source` (opcional): Origem. Default: "ADMIN_APPROVED"

**Valores de source**:
- `USER_CONFIRMED`: Usuário confirmou explicitamente
- `AI_SUGGESTED`: IA sugeriu e usuário aceitou
- `AUTO_LEARNED`: Sistema aprendeu automaticamente
- `IMPORTED`: Importado de base de conhecimento
- `ADMIN_APPROVED`: Admin criou/aprovou manualmente

**Response Success**:
```json
{
  "success": true,
  "message": "Sinônimo criado com sucesso",
  "data": {
    "keyword": "netflix",
    "categoryName": "Entretenimento",
    "subCategoryName": "Streaming"
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Response Error**:
```json
{
  "success": false,
  "message": "Erro ao criar sinônimo",
  "error": "userId, keyword, categoryId e categoryName são obrigatórios",
  "timestamp": "2025-12-23T14:30:00Z"
}
```

---

## 5. Criar Sinônimos em Batch

### `POST /admin/synonyms/batch`

**Descrição**: Cria múltiplos sinônimos de uma vez.

**Request**:
```json
POST http://localhost:4444/admin/synonyms/batch
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "synonyms": [
    {
      "userId": "uuid-user-1",
      "keyword": "spotify",
      "categoryId": "uuid-category-1",
      "categoryName": "Entretenimento",
      "subCategoryId": "uuid-subcategory-1",
      "subCategoryName": "Streaming",
      "confidence": 1.0,
      "source": "ADMIN_APPROVED"
    },
    {
      "userId": "uuid-user-1",
      "keyword": "apple music",
      "categoryId": "uuid-category-1",
      "categoryName": "Entretenimento",
      "subCategoryId": "uuid-subcategory-1",
      "subCategoryName": "Streaming",
      "confidence": 1.0,
      "source": "ADMIN_APPROVED"
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "message": "2 sinônimos criados com sucesso",
  "results": {
    "created": 2,
    "failed": 0,
    "errors": []
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Response com Erros Parciais**:
```json
{
  "success": true,
  "message": "1 sinônimos criados, 1 falharam",
  "results": {
    "created": 1,
    "failed": 1,
    "errors": [
      {
        "keyword": "termo-duplicado",
        "error": "Unique constraint failed"
      }
    ]
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

---

## 6. Criar Sinônimo Global

### `POST /admin/synonyms/global`

**Descrição**: Cria um sinônimo para TODOS os usuários do sistema.

**⚠️ ATENÇÃO**: Use com cuidado! Isso afeta todos os usuários.

**Request**:
```json
POST http://localhost:4444/admin/synonyms/global
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "keyword": "uber",
  "categoryId": "uuid-category-transport",
  "categoryName": "Transporte",
  "subCategoryId": "uuid-subcategory-app",
  "subCategoryName": "Aplicativo",
  "confidence": 0.9,
  "source": "ADMIN_APPROVED"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Sinônimo global criado para 1247 usuários",
  "results": {
    "totalUsers": 1247,
    "created": 1247,
    "failed": 0,
    "errors": []
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Use Case**: Quando identificar um termo muito comum (ex: "uber", "ifood", "netflix") que deve ser reconhecido por todos.

---

## 7. Listar Sinônimos do Usuário

### `GET /admin/synonyms/user/:userId`

**Descrição**: Lista todos os sinônimos de um usuário específico.

**Request**:
```http
GET http://localhost:4444/admin/synonyms/user/d6cb1abb-9b6e-49ce-bfa6-b65aa607fd67
Authorization: Bearer <JWT_TOKEN>
```

**Response**:
```json
{
  "success": true,
  "userId": "d6cb1abb-9b6e-49ce-bfa6-b65aa607fd67",
  "synonyms": [
    {
      "id": "uuid-synonym-1",
      "keyword": "pro labore",
      "categoryId": "uuid-cat-1",
      "categoryName": "Receitas",
      "subCategoryId": "uuid-subcat-1",
      "subCategoryName": "Salário",
      "confidence": 1.0,
      "source": "USER_CONFIRMED",
      "usageCount": 45,
      "lastUsedAt": "2025-12-23T08:00:00Z",
      "createdAt": "2025-11-15T10:00:00Z",
      "updatedAt": "2025-12-23T08:00:00Z"
    }
  ],
  "total": 12,
  "timestamp": "2025-12-23T14:30:00Z"
}
```

---

## 8. Editar Sinônimo

### `PUT /admin/synonyms/:id`

**Descrição**: Edita um sinônimo existente.

**Request**:
```json
PUT http://localhost:4444/admin/synonyms/uuid-synonym-1
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "keyword": "prolabore",
  "categoryName": "Receitas",
  "subCategoryName": "Salário",
  "confidence": 1.0
}
```

**Campos editáveis**:
- `keyword`: Novo termo
- `categoryId`: Novo ID da categoria
- `categoryName`: Novo nome da categoria
- `subCategoryId`: Novo ID da subcategoria
- `subCategoryName`: Novo nome da subcategoria
- `confidence`: Nova confiança

**Todos os campos são opcionais** - apenas os enviados serão atualizados.

**Response Success**:
```json
{
  "success": true,
  "message": "Sinônimo atualizado com sucesso",
  "data": {
    "id": "uuid-synonym-1",
    "keyword": "prolabore",
    "categoryName": "Receitas",
    "subCategoryName": "Salário",
    "categoryId": "uuid-cat-1",
    "subCategoryId": "uuid-subcat-1",
    "confidence": 1.0,
    "usageCount": 45,
    "source": "USER_CONFIRMED",
    "user": {
      "gastoCertoId": "uuid-user-1",
      "name": "João Silva",
      "phoneNumber": "5511999999999"
    },
    "updatedAt": "2025-12-23T14:30:00Z"
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Response Error**:
```json
{
  "success": false,
  "message": "Sinônimo não encontrado",
  "timestamp": "2025-12-23T14:30:00Z"
}
```

---

## 9. Deletar Sinônimo

### `DELETE /admin/synonyms/:id`

**Descrição**: Remove um sinônimo do sistema.

**Request**:
```http
DELETE http://localhost:4444/admin/synonyms/uuid-synonym-1
Authorization: Bearer <JWT_TOKEN>
```

**Response Success**:
```json
{
  "success": true,
  "message": "Sinônimo deletado com sucesso",
  "data": {
    "keyword": "prolabore",
    "categoryName": "Receitas",
    "user": {
      "gastoCertoId": "uuid-user-1",
      "name": "João Silva",
      "phoneNumber": "5511999999999"
    }
  },
  "timestamp": "2025-12-23T14:30:00Z"
}
```

**Response Error**:
```json
{
  "success": false,
  "message": "Sinônimo não encontrado",
  "timestamp": "2025-12-23T14:30:00Z"
}
```

---

## 🔄 Fluxos de Integração

### Fluxo 1: Sincronizar após mudança de categoria

```javascript
// No gastocerto-api, após usuário criar/editar categoria
async function onCategoryChanged(userId, phoneNumber) {
  try {
    await axios.post(`${ZAP_API_URL}/external/sync-categories`, {
      userId,
      phoneNumber
    });
    
    console.log('✅ Cache do ZAP sincronizado');
  } catch (error) {
    console.error('❌ Erro ao sincronizar:', error);
    // Não bloquear operação principal
  }
}
```

### Fluxo 2: Dashboard de sinônimos

```javascript
// Carregar estatísticas para dashboard
async function loadSynonymsDashboard() {
  const stats = await axios.get(`${ZAP_API_URL}/admin/synonyms/stats`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  return {
    total: stats.data.stats.totalSynonyms,
    topKeywords: stats.data.stats.topKeywords,
    recentSynonyms: stats.data.stats.recentSynonyms,
    learningOpportunities: stats.data.stats.learningOpportunities
  };
}
```

### Fluxo 3: Aprovar sugestões de aprendizado

```javascript
// 1. Buscar sugestões
const suggestions = await axios.get(
  `${ZAP_API_URL}/admin/synonyms/learning-suggestions?minOccurrences=5`,
  { headers: { Authorization: `Bearer ${token}` }}
);

// 2. Admin aprova uma sugestão
const suggestion = suggestions.data.suggestions[0];

// 3. Criar sinônimo global para todos os usuários que usaram
await axios.post(`${ZAP_API_URL}/admin/synonyms/global`, {
  keyword: suggestion.keyword,
  categoryId: suggestion.suggestedCategoryId,
  categoryName: suggestion.suggestedCategoryName,
  subCategoryName: suggestion.suggestedSubCategoryName,
  confidence: 0.9,
  source: 'ADMIN_APPROVED'
}, {
  headers: { Authorization: `Bearer ${token}` }
});
```

### Fluxo 4: Gerenciar sinônimos de um usuário

```javascript
// Listar sinônimos do usuário
const userSynonyms = await axios.get(
  `${ZAP_API_URL}/admin/synonyms/user/${userId}`,
  { headers: { Authorization: `Bearer ${token}` }}
);

// Editar um sinônimo
await axios.put(
  `${ZAP_API_URL}/admin/synonyms/${synonymId}`,
  {
    categoryName: "Nova Categoria",
    confidence: 0.95
  },
  { headers: { Authorization: `Bearer ${token}` }}
);

// Deletar um sinônimo
await axios.delete(
  `${ZAP_API_URL}/admin/synonyms/${synonymId}`,
  { headers: { Authorization: `Bearer ${token}` }}
);
```

---

## 🛠️ Exemplos Completos

### Exemplo: Criar múltiplos sinônimos para um usuário

```javascript
const createUserSynonyms = async (userId, keywords) => {
  const synonyms = keywords.map(k => ({
    userId,
    keyword: k.term,
    categoryId: k.categoryId,
    categoryName: k.categoryName,
    subCategoryId: k.subCategoryId,
    subCategoryName: k.subCategoryName,
    confidence: 1.0,
    source: 'IMPORTED'
  }));

  const response = await axios.post(
    `${ZAP_API_URL}/admin/synonyms/batch`,
    { synonyms },
    { headers: { Authorization: `Bearer ${token}` }}
  );

  return response.data;
};

// Uso
await createUserSynonyms('uuid-user-1', [
  { term: 'ifood', categoryId: 'uuid-1', categoryName: 'Alimentação', subCategoryId: 'uuid-2', subCategoryName: 'Delivery' },
  { term: 'uber eats', categoryId: 'uuid-1', categoryName: 'Alimentação', subCategoryId: 'uuid-2', subCategoryName: 'Delivery' },
  { term: 'rappi', categoryId: 'uuid-1', categoryName: 'Alimentação', subCategoryId: 'uuid-2', subCategoryName: 'Delivery' }
]);
```

### Exemplo: Monitorar oportunidades de aprendizado

```javascript
const checkLearningOpportunities = async () => {
  const suggestions = await axios.get(
    `${ZAP_API_URL}/admin/synonyms/learning-suggestions?minOccurrences=10&limit=5`,
    { headers: { Authorization: `Bearer ${token}` }}
  );

  // Filtrar sugestões com alta confiança e muitos usuários
  const highPriority = suggestions.data.suggestions.filter(s => 
    s.avgAiConfidence > 0.85 && s.userCount >= 10
  );

  if (highPriority.length > 0) {
    console.log(`🎯 ${highPriority.length} sugestões de alta prioridade:`);
    highPriority.forEach(s => {
      console.log(`- "${s.keyword}" → ${s.suggestedCategoryName} (${s.userCount} usuários, ${s.totalOccurrences} vezes)`);
    });
  }

  return highPriority;
};
```

---

## ⚠️ Boas Práticas

### 1. Sincronização de Categorias
- ✅ Chamar sempre que usuário criar/editar/deletar categoria
- ✅ Chamar quando usuário mudar conta padrão
- ✅ Não bloquear operação principal se sincronização falhar
- ✅ Fazer retry em caso de erro (ex: 3 tentativas)

### 2. Gerenciamento de Sinônimos
- ✅ Usar `confidence` apropriada: USER_CONFIRMED=1.0, AI_SUGGESTED=0.7-0.9
- ✅ Revisar sugestões antes de criar sinônimos globais
- ✅ Deletar sinônimos obsoletos ou incorretos
- ✅ Atualizar sinônimos quando categorias mudarem

### 3. Performance
- ✅ Usar `/admin/synonyms/batch` para criar múltiplos sinônimos
- ✅ Limitar queries de sugestões com `limit` e `minOccurrences`
- ✅ Cache stats em memória (revalidar a cada 5 minutos)

### 4. Segurança
- ✅ Sempre validar JWT antes de operações admin
- ✅ Log todas as operações de admin
- ✅ Confirmar com usuário antes de deletar sinônimos globais

---

## 📊 Modelo de Dados

### UserSynonym
```typescript
{
  id: string;              // UUID
  userId: string;          // gastoCertoId do UserCache
  keyword: string;         // Termo normalizado (ex: "pro labore", "uber")
  categoryId: string;      // UUID da categoria na API externa
  categoryName: string;    // Nome da categoria (cache)
  subCategoryId?: string;  // UUID da subcategoria (opcional)
  subCategoryName?: string;// Nome da subcategoria (opcional)
  confidence: number;      // 0.0 a 1.0
  source: SynonymSource;   // USER_CONFIRMED | AI_SUGGESTED | AUTO_LEARNED | IMPORTED | ADMIN_APPROVED
  usageCount: number;      // Contador de uso
  lastUsedAt?: Date;       // Última vez usado
  createdAt: Date;         // Data de criação
  updatedAt: Date;         // Data de atualização
}
```

### SynonymSource (Enum)
- `USER_CONFIRMED`: Usuário confirmou explicitamente
- `AI_SUGGESTED`: IA sugeriu e usuário aceitou
- `AUTO_LEARNED`: Sistema aprendeu automaticamente
- `IMPORTED`: Importado de base de conhecimento
- `ADMIN_APPROVED`: Admin criou/aprovou manualmente

---

## 🐛 Troubleshooting

### Erro: "Sinônimo não encontrado"
- Verificar se ID está correto
- Verificar se sinônimo não foi deletado

### Erro: "Unique constraint failed"
- Usuário já tem sinônimo com mesma keyword
- Deletar existente ou editar ao invés de criar

### Sincronização não funciona
- Verificar se phoneNumber está correto (formato: 5511999999999)
- Verificar se userId existe no sistema
- Ver logs no ZAP para mais detalhes

### Sugestões não aparecem
- Ajustar `minOccurrences` e `minAiConfidence`
- Verificar se há logs AI com `needsSynonymLearning=true`
- Aumentar `limit` para ver mais resultados

---

## 📞 Suporte

Para dúvidas ou problemas:
- Ver logs em: `/admin/health`
- Ver logs AI em: `/admin/ai-usage-logs`
- Ver logs RAG em: `/admin/rag/search-logs`

---

**Última atualização**: 23/12/2025
**Versão da API**: 1.0.0
**Base URL**: `http://localhost:4444` (desenvolvimento) | `https://zap-api.gastocerto.com` (produção)
