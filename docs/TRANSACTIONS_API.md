# 📋 Transactions API Documentation

API para gerenciamento e consulta de transações do GastoCerto ZAP.

## Base URL

```
http://localhost:4444
```

---

## 📊 Endpoints

### 1. Listar Todas as Transações

Lista todas as transações com filtros opcionais.

**Endpoint:** `GET /admin/transactions`

**Query Parameters:**

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `userId` | string | Não | ID do usuário no GastoCerto |
| `accountId` | string | Não | ID da conta |
| `phoneNumber` | string | Não | Número de telefone do usuário |
| `dateFrom` | date | Não | Data inicial (ISO 8601: `2026-01-01`) |
| `dateTo` | date | Não | Data final (ISO 8601: `2026-01-31`) |
| `status` | enum | Não | Status: `PENDING`, `CONFIRMED`, `EXPIRED`, `REJECTED` |
| `type` | enum | Não | Tipo: `EXPENSES` (despesas), `INCOME` (receitas) |
| `apiSent` | boolean | Não | Se foi enviado para API: `true`, `false` |
| `limit` | number | Não | Registros por página (padrão: 50) |
| `page` | number | Não | Número da página (padrão: 1) |

**Exemplo:**

```bash
curl -X GET "http://localhost:4444/admin/transactions?userId=3b120ec5-3ca1-4b72-95ed-f80af6632db2&status=CONFIRMED&type=EXPENSES&limit=20&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "cm5abc123",
      "phoneNumber": "5566996285154",
      "type": "EXPENSES",
      "amount": 150.50,
      "category": "Alimentação",
      "categoryId": "cat_123",
      "subCategoryId": "subcat_456",
      "description": "Almoço no restaurante",
      "date": "2026-01-13T12:00:00.000Z",
      "status": "CONFIRMED",
      "apiSent": true,
      "apiSentAt": "2026-01-13T12:01:00.000Z",
      "createdAt": "2026-01-13T11:45:00.000Z",
      "confirmedAt": "2026-01-13T11:50:00.000Z",
      "user": {
        "id": "usr_789",
        "name": "João Silva",
        "gastoCertoId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
        "phoneNumber": "5566996285154",
        "activeAccountId": "acc_001"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  },
  "filters": {
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
    "status": "CONFIRMED",
    "type": "EXPENSES",
    "accountId": null,
    "phoneNumber": null,
    "dateFrom": null,
    "dateTo": null,
    "apiSent": null
  },
  "timestamp": "2026-01-13T15:30:00.000Z"
}
```

---

### 2. Listar Transações Pendentes

Atalho para listar apenas transações pendentes (backward compatibility).

**Endpoint:** `GET /admin/transactions/pending`

**Query Parameters:**

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `userId` | string | Não | ID do usuário no GastoCerto |
| `accountId` | string | Não | ID da conta |
| `dateFrom` | date | Não | Data inicial |
| `dateTo` | date | Não | Data final |
| `limit` | number | Não | Registros por página (padrão: 50) |
| `page` | number | Não | Número da página (padrão: 1) |

**Exemplo:**

```bash
curl -X GET "http://localhost:4444/admin/transactions/pending?userId=3b120ec5-3ca1-4b72-95ed-f80af6632db2&limit=50&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response:** Mesmo formato do endpoint principal, mas apenas com `status=PENDING`.

---

### 3. Reenviar Transações para API

Reenvia transações confirmadas mas não enviadas para a API GastoCerto.

**Endpoint:** `POST /admin/transactions/resend`

**Body (Opção 1 - IDs Específicos):**

```json
{
  "transactionIds": ["cm5abc123", "cm5def456"]
}
```

**Body (Opção 2 - Filtros):**

```json
{
  "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
  "accountId": "acc_001",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31"
}
```

**Exemplo:**

```bash
curl -X POST "http://localhost:4444/admin/transactions/resend" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
    "dateFrom": "2026-01-01"
  }'
```

**Response 200:**

```json
{
  "success": true,
  "message": "Processadas 10 transações",
  "processed": 10,
  "succeeded": 8,
  "failed": 2,
  "errors": [
    {
      "transactionId": "cm5abc123",
      "error": "Categoria inválida"
    },
    {
      "transactionId": "cm5def456",
      "error": "Conta não encontrada"
    }
  ]
}
```

---

### 4. Estatísticas de Transações

Retorna estatísticas agregadas de todas as transações.

**Endpoint:** `GET /admin/transactions/stats`

**Query Parameters:**

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `userId` | string | Não | Filtrar por usuário específico |

**Exemplo:**

```bash
curl -X GET "http://localhost:4444/admin/transactions/stats?userId=3b120ec5-3ca1-4b72-95ed-f80af6632db2" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**

```json
{
  "success": true,
  "stats": {
    "total": 500,
    "byStatus": {
      "pending": 15,
      "confirmed": 450,
      "expired": 20,
      "rejected": 15
    },
    "api": {
      "sent": 430,
      "failed": 20,
      "successRate": "86.00%"
    },
    "categories": {
      "withCategoryId": 485,
      "withSubCategoryId": 420,
      "categoryResolutionRate": "97.00%",
      "subCategoryResolutionRate": "84.00%"
    }
  },
  "filters": {
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2"
  }
}
```

---

### 5. Resumo do Usuário

Retorna dados completos do usuário incluindo últimas 10 transações.

**Endpoint:** `GET /admin/users/:userId/summary`

**Path Parameters:**

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `userId` | string | Sim | ID do usuário no GastoCerto |

**Exemplo:**

```bash
curl -X GET "http://localhost:4444/admin/users/3b120ec5-3ca1-4b72-95ed-f80af6632db2/summary" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**

```json
{
  "success": true,
  "user": {
    "id": "usr_789",
    "gastoCertoId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2",
    "phoneNumber": "5566996285154",
    "name": "João Silva",
    "email": "joao@example.com",
    "hasActiveSubscription": true,
    "isBlocked": false,
    "isActive": true,
    "activeAccountId": "acc_001",
    "accounts": [...],
    "lastSyncAt": "2026-01-13T15:00:00.000Z",
    "createdAt": "2025-12-01T10:00:00.000Z",
    "updatedAt": "2026-01-13T15:00:00.000Z"
  },
  "stats": {
    "rag": { ... },
    "ai": { ... },
    "synonyms": { ... },
    "transactions": {
      "total": 10,
      "confirmed": 8,
      "pending": 2,
      "sent": 7,
      "totalAmount": "1250.00"
    },
    "unrecognized": { ... },
    "onboarding": { ... }
  },
  "data": {
    "ragLogs": [...],
    "aiLogs": [...],
    "synonyms": [...],
    "transactions": [
      {
        "id": "cm5abc123",
        "description": "Almoço",
        "amount": 50.00,
        "category": "Alimentação",
        "categoryId": "cat_123",
        "subCategoryId": "subcat_456",
        "subCategoryName": "Restaurante",
        "type": "EXPENSES",
        "date": "2026-01-13T00:00:00.000Z",
        "status": "CONFIRMED",
        "apiSent": true,
        "apiSentAt": "2026-01-13T12:01:00.000Z",
        "createdAt": "2026-01-13T11:45:00.000Z",
        "confirmedAt": "2026-01-13T11:50:00.000Z"
      }
    ],
    "unrecognizedMessages": [...],
    "onboardingSessions": [...],
    "categories": [...],
    "accounts": [...]
  },
  "timestamp": "2026-01-13T15:30:00.000Z"
}
```

**Observações importantes:**
- As transações são ordenadas por **data da transação** (campo `date`), não por `createdAt`
- Mostra apenas as **10 transações mais recentes**
- Inclui estatística de transações enviadas (`sent`)

---

## 🔍 Casos de Uso

### 1. Buscar todas as despesas confirmadas de um usuário em janeiro/2026

```bash
curl -X GET "http://localhost:4444/admin/transactions?\
userId=3b120ec5-3ca1-4b72-95ed-f80af6632db2&\
type=EXPENSES&\
status=CONFIRMED&\
dateFrom=2026-01-01&\
dateTo=2026-01-31&\
limit=100" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### 2. Buscar transações que falharam ao enviar para API

```bash
curl -X GET "http://localhost:4444/admin/transactions?\
status=CONFIRMED&\
apiSent=false&\
limit=50" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### 3. Buscar receitas de um número de telefone específico

```bash
curl -X GET "http://localhost:4444/admin/transactions?\
phoneNumber=5566996285154&\
type=INCOME&\
limit=50" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### 4. Reenviar todas as transações pendentes de envio de um usuário

```bash
curl -X POST "http://localhost:4444/admin/transactions/resend" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "3b120ec5-3ca1-4b72-95ed-f80af6632db2"
  }'
```

---

## ⚠️ Notas Importantes

1. **Autenticação**: Todos os endpoints requerem JWT token válido
2. **Limite de Reenvio**: Máximo de 100 transações por vez no endpoint `/resend`
3. **Ordenação**: Transações são sempre ordenadas por data mais recente primeiro
4. **Paginação**: Padrão é 50 registros por página
5. **Filtros**: Todos os filtros são opcionais e podem ser combinados
6. **Datas**: Formato ISO 8601 (`YYYY-MM-DD`)
7. **Status Disponíveis**: `PENDING`, `CONFIRMED`, `EXPIRED`, `REJECTED`
8. **Tipos Disponíveis**: `EXPENSES` (despesas), `INCOME` (receitas)

---

## 🚀 Exemplos de Integração

### JavaScript/TypeScript (Fetch)

```typescript
const API_BASE = 'http://localhost:4444';
const TOKEN = 'seu_jwt_token_aqui';

// Listar transações
async function listTransactions(filters = {}) {
  const params = new URLSearchParams(filters);
  
  const response = await fetch(`${API_BASE}/admin/transactions?${params}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`
    }
  });
  
  return response.json();
}

// Usar
const result = await listTransactions({
  userId: '3b120ec5-3ca1-4b72-95ed-f80af6632db2',
  status: 'CONFIRMED',
  type: 'EXPENSES',
  limit: 20
});

console.log(result.data); // Array de transações
console.log(result.pagination); // Info de paginação
```

### Python (Requests)

```python
import requests

API_BASE = 'http://localhost:4444'
TOKEN = 'seu_jwt_token_aqui'

headers = {'Authorization': f'Bearer {TOKEN}'}

# Listar transações
response = requests.get(
    f'{API_BASE}/admin/transactions',
    headers=headers,
    params={
        'userId': '3b120ec5-3ca1-4b72-95ed-f80af6632db2',
        'status': 'CONFIRMED',
        'limit': 20
    }
)

data = response.json()
print(f"Total: {data['pagination']['total']}")
print(f"Transações: {len(data['data'])}")
```

---

## 📊 Estrutura de Dados

### TransactionConfirmation

```typescript
interface TransactionConfirmation {
  id: string;
  phoneNumber: string;
  type: 'EXPENSES' | 'INCOME';
  amount: number;
  category: string;
  categoryId: string | null;
  subCategoryId: string | null;
  subCategoryName: string | null;
  description: string | null;
  date: string; // ISO 8601
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'REJECTED';
  apiSent: boolean;
  apiSentAt: string | null; // ISO 8601
  apiError: string | null;
  apiRetryCount: number;
  createdAt: string; // ISO 8601
  confirmedAt: string | null; // ISO 8601
  user: {
    id: string;
    name: string;
    gastoCertoId: string;
    phoneNumber: string;
    activeAccountId: string;
  };
}
```

---

## 🔄 Mudanças Recentes

### v2.0 (13/01/2026)

✅ **Endpoint Principal Atualizado:**
- Rota `/admin/transactions` agora lista **TODAS** as transações (não só pendentes)
- Adicionados novos filtros: `type`, `apiSent`, `phoneNumber`
- Melhor granularidade de controle

✅ **User Summary Melhorado:**
- Campo `transactionConfirmations` renomeado para `transactions`
- Agora traz **últimas 10 transações** ordenadas por data
- Adicionado campo `apiSent` nas transações
- Estatística inclui contagem de `sent`

✅ **Backward Compatibility:**
- Endpoint `/admin/transactions/pending` mantido como atalho
- Comportamento idêntico ao filtro `status=PENDING`

---

**Última atualização:** 13 de janeiro de 2026
