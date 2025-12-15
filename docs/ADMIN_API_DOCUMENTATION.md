# 📚 GastoCerto ZAP - Admin API Documentation

> **Versão:** 1.0.0  
> **Base URL:** `http://localhost:3002` (development) | `https://api.gastocerto.com.br/zap` (production)

## 🔐 Autenticação

Todos os endpoints admin requerem autenticação JWT no header:

```bash
Authorization: Bearer <JWT_TOKEN>
```

**Requisitos:**
- Token JWT válido emitido pelo gastocerto-admin
- Role: `ADMIN` ou `MASTER`
- Token deve conter: `userId`, `email`, `role`

**Como obter o token:**
```bash
# Login no gastocerto-admin
POST https://api.gastocerto.com.br/admin/auth/login
Content-Type: application/json

{
  "email": "admin@gastocerto.com.br",
  "password": "your_password"
}

# Resposta:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": "...", "email": "...", "role": "ADMIN" }
}
```

---

## 📑 Índice

1. [Cache Management](#1-cache-management)
2. [Unrecognized Messages](#2-unrecognized-messages)
3. [Transaction Confirmations](#3-transaction-confirmations)
4. [AI Usage Logs](#4-ai-usage-logs)
5. [Users Cache](#5-users-cache)
6. [AI Providers](#6-ai-providers)
7. [AI Settings](#7-ai-settings)

---

## 1. Cache Management

### 1.1 Clear All Cache

Limpa todo o cache Redis (usuários, mensagens, contextos).

**Endpoint:** `POST /admin/cache/clear`

**Request:**
```bash
curl -X POST http://localhost:3002/admin/cache/clear \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "message": "Cache Redis limpo com sucesso",
  "timestamp": "2024-12-12T19:45:00.000Z"
}
```

**Response 500 (Error):**
```json
{
  "success": false,
  "message": "Erro ao limpar cache",
  "error": "Connection refused",
  "timestamp": "2024-12-12T19:45:00.000Z"
}
```

---

### 1.2 Clear Cache (Alternative)

Método alternativo usando DELETE.

**Endpoint:** `DELETE /admin/cache`

**Request:**
```bash
curl -X DELETE http://localhost:3002/admin/cache \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response:** Igual ao `POST /admin/cache/clear`

---

## 2. Unrecognized Messages

Mensagens que o sistema não conseguiu processar automaticamente.

### 2.1 List Unrecognized Messages

**Endpoint:** `GET /admin/unrecognized-messages`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| wasProcessed | boolean | No | - | Filtrar por processamento (true/false) |
| addedToContext | boolean | No | - | Filtrar por adição ao contexto (true/false) |
| phoneNumber | string | No | - | Filtrar por número de telefone |
| limit | number | No | 50 | Quantidade por página |
| page | number | No | 1 | Número da página |

**Request:**
```bash
curl -X GET "http://localhost:3002/admin/unrecognized-messages?wasProcessed=false&limit=20&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4k9x8y0000008l5h9q3a2b4",
      "phoneNumber": "5566996285154",
      "messageText": "esqueci minha senha",
      "detectedIntent": "UNKNOWN",
      "confidence": 0.15,
      "wasProcessed": false,
      "addedToContext": false,
      "userFeedback": null,
      "createdAt": "2024-12-12T18:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### 2.2 Delete Unrecognized Message

**Endpoint:** `DELETE /admin/unrecognized-messages/:id`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | ID da mensagem não reconhecida |

**Request:**
```bash
curl -X DELETE http://localhost:3002/admin/unrecognized-messages/cm4k9x8y0000008l5h9q3a2b4 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "message": "Mensagem deletada com sucesso"
}
```

**Response 404:**
```json
{
  "statusCode": 404,
  "message": "Mensagem não encontrada",
  "error": "Not Found"
}
```

---

## 3. Transaction Confirmations

Gerenciamento de transações aguardando confirmação do usuário.

### 3.1 List Transaction Confirmations

**Endpoint:** `GET /admin/transaction-confirmations`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| status | enum | No | - | PENDING, CONFIRMED, EXPIRED |
| phoneNumber | string | No | - | Número de telefone do usuário |
| from | date | No | - | Data inicial (ISO 8601) |
| to | date | No | - | Data final (ISO 8601) |
| apiSent | boolean | No | - | Já enviado para API principal (true/false) |
| limit | number | No | 50 | Quantidade por página |
| page | number | No | 1 | Número da página |

**Request:**
```bash
curl -X GET "http://localhost:3002/admin/transaction-confirmations?status=PENDING&phoneNumber=5566996285154&from=2024-01-01&to=2024-12-31&limit=50&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4k9x8y0000108l5h9q3a2b5",
      "phoneNumber": "5566996285154",
      "type": "EXPENSE",
      "amount": 150.50,
      "category": "Alimentação",
      "description": "Almoço no restaurante",
      "date": "2024-12-12T12:00:00.000Z",
      "status": "PENDING",
      "apiSent": false,
      "apiSentAt": null,
      "apiError": null,
      "apiRetryCount": 0,
      "apiTransactionId": null,
      "createdAt": "2024-12-12T18:30:00.000Z",
      "expiresAt": "2024-12-13T18:30:00.000Z",
      "confirmedAt": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 12,
    "totalPages": 1
  }
}
```

---

### 3.2 Delete Transaction Confirmation

**Endpoint:** `DELETE /admin/transaction-confirmations/:id`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | ID da confirmação |

**Request:**
```bash
curl -X DELETE http://localhost:3002/admin/transaction-confirmations/cm4k9x8y0000108l5h9q3a2b5 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "message": "Confirmação deletada com sucesso"
}
```

---

## 4. AI Usage Logs

Logs de uso dos provedores de IA (OpenAI, Groq, Google Gemini, etc).

### 4.1 List AI Usage Logs

**Endpoint:** `GET /admin/ai-usage-logs`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| provider | enum | No | - | openai, groq, google_gemini, deepseek |
| operation | enum | No | - | TRANSACTION_EXTRACTION, IMAGE_ANALYSIS, AUDIO_TRANSCRIPTION, CATEGORY_SUGGESTION |
| phoneNumber | string | No | - | Número de telefone do usuário |
| success | boolean | No | - | Filtrar por sucesso (true/false) |
| from | date | No | - | Data inicial (ISO 8601) |
| to | date | No | - | Data final (ISO 8601) |
| limit | number | No | 100 | Quantidade por página |
| page | number | No | 1 | Número da página |

**Request:**
```bash
curl -X GET "http://localhost:3002/admin/ai-usage-logs?provider=openai&operation=TRANSACTION_EXTRACTION&from=2024-01-01&to=2024-12-31&limit=100&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4k9x8y0000208l5h9q3a2b6",
      "phoneNumber": "5566996285154",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "operation": "TRANSACTION_EXTRACTION",
      "inputType": "TEXT",
      "inputTokens": 450,
      "outputTokens": 120,
      "totalTokens": 570,
      "estimatedCost": 0.00285,
      "responseTime": 1250,
      "success": true,
      "errorMessage": null,
      "createdAt": "2024-12-12T18:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 3450,
    "totalPages": 35
  }
}
```

---

### 4.2 Get AI Usage Statistics

Estatísticas agregadas de uso de IA por provider, operation e model.

**Endpoint:** `GET /admin/ai-usage-logs/stats`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| from | date | No | - | Data inicial (ISO 8601) |
| to | date | No | - | Data final (ISO 8601) |
| operation | enum | No | - | Filtrar por operação específica |

**Request:**
```bash
curl -X GET "http://localhost:3002/admin/ai-usage-logs/stats?from=2024-01-01&to=2024-12-31&operation=TRANSACTION_EXTRACTION" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalRequests": 3450,
      "successRequests": 3398,
      "failureRequests": 52,
      "successRate": 98.49,
      "totalCost": 45.67,
      "avgResponseTime": 1280.5
    },
    "byProvider": [
      {
        "provider": "openai",
        "requests": 2100,
        "totalTokens": 1250000,
        "totalCost": 28.50,
        "avgCost": 0.0136,
        "avgResponseTime": 1150.3
      },
      {
        "provider": "groq",
        "requests": 850,
        "totalTokens": 450000,
        "totalCost": 0.00,
        "avgCost": 0.0000,
        "avgResponseTime": 320.8
      },
      {
        "provider": "google_gemini",
        "requests": 500,
        "totalTokens": 680000,
        "totalCost": 17.17,
        "avgCost": 0.0343,
        "avgResponseTime": 2100.5
      }
    ],
    "byOperation": [
      {
        "operation": "TRANSACTION_EXTRACTION",
        "requests": 2000,
        "totalTokens": 1100000,
        "totalCost": 30.25,
        "avgCost": 0.0151
      },
      {
        "operation": "IMAGE_ANALYSIS",
        "requests": 800,
        "totalTokens": 650000,
        "totalCost": 12.50,
        "avgCost": 0.0156
      },
      {
        "operation": "AUDIO_TRANSCRIPTION",
        "requests": 450,
        "totalTokens": 280000,
        "totalCost": 2.35,
        "avgCost": 0.0052
      },
      {
        "operation": "CATEGORY_SUGGESTION",
        "requests": 200,
        "totalTokens": 50000,
        "totalCost": 0.57,
        "avgCost": 0.0029
      }
    ],
    "byModel": [
      {
        "model": "gpt-4o-mini",
        "provider": "openai",
        "requests": 1800,
        "totalTokens": 1050000,
        "totalCost": 25.20
      },
      {
        "model": "gpt-4o",
        "provider": "openai",
        "requests": 300,
        "totalTokens": 200000,
        "totalCost": 3.30
      },
      {
        "model": "llama-3.3-70b-versatile",
        "provider": "groq",
        "requests": 850,
        "totalTokens": 450000,
        "totalCost": 0.00
      },
      {
        "model": "gemini-1.5-flash",
        "provider": "google_gemini",
        "requests": 500,
        "totalTokens": 680000,
        "totalCost": 17.17
      }
    ]
  }
}
```

---

## 5. Users Cache

Gerenciamento de usuários armazenados em cache (Redis + PostgreSQL).

### 5.1 List Users Cache

**Endpoint:** `GET /admin/users-cache`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | number | No | 50 | Quantidade por página |
| page | number | No | 1 | Número da página |

**Request:**
```bash
curl -X GET "http://localhost:3002/admin/users-cache?limit=50&page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4k9x8y0000308l5h9q3a2b7",
      "phoneNumber": "5566996285154",
      "name": "João Silva",
      "email": "joao@example.com",
      "gastoCertoId": "usr_abc123",
      "hasActiveSubscription": true,
      "lastSyncAt": "2024-12-12T18:30:00.000Z",
      "createdAt": "2024-11-01T10:00:00.000Z",
      "updatedAt": "2024-12-12T18:30:00.000Z",
      "cache": {
        "inRedis": true,
        "ttl": 86400,
        "lastAccess": "2024-12-12T18:30:00.000Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1250,
    "totalPages": 25
  }
}
```

**Cache Fields:**
- `inRedis`: Se o usuário está atualmente no Redis
- `ttl`: Time-to-live em segundos (null se não está no Redis)
- `lastAccess`: Último acesso registrado

---

## 6. AI Providers

Gerenciamento das configurações dos provedores de IA.

### 6.1 List All Providers

**Endpoint:** `GET /admin/ai-providers`

**Request:**
```bash
curl -X GET http://localhost:3002/admin/ai-providers \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4k9x8y0000408l5h9q3a2b8",
      "name": "openai",
      "displayName": "OpenAI",
      "enabled": true,
      "priority": 1,
      "apiKey": "sk-proj-***",
      "baseUrl": "https://api.openai.com/v1",
      "textModel": "gpt-4o-mini",
      "visionModel": "gpt-4o",
      "audioModel": "whisper-1",
      "supportsText": true,
      "supportsVision": true,
      "supportsAudio": true,
      "maxTokens": 16000,
      "temperature": 0.7,
      "costPerMillionInputTokens": 0.15,
      "costPerMillionOutputTokens": 0.60,
      "rateLimit": 500,
      "rateLimitWindow": 60,
      "createdAt": "2024-11-01T10:00:00.000Z",
      "updatedAt": "2024-12-12T15:00:00.000Z"
    },
    {
      "id": "cm4k9x8y0000508l5h9q3a2b9",
      "name": "groq",
      "displayName": "Groq",
      "enabled": true,
      "priority": 2,
      "apiKey": "gsk_***",
      "baseUrl": "https://api.groq.com/openai/v1",
      "textModel": "llama-3.3-70b-versatile",
      "visionModel": null,
      "audioModel": "whisper-large-v3",
      "supportsText": true,
      "supportsVision": false,
      "supportsAudio": true,
      "maxTokens": 8000,
      "temperature": 0.7,
      "costPerMillionInputTokens": 0.00,
      "costPerMillionOutputTokens": 0.00,
      "rateLimit": 30,
      "rateLimitWindow": 60,
      "createdAt": "2024-11-01T10:00:00.000Z",
      "updatedAt": "2024-12-12T15:00:00.000Z"
    }
  ]
}
```

---

### 6.2 Get Specific Provider

**Endpoint:** `GET /admin/ai-providers/:provider`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| provider | string | Yes | Provider name (openai, groq, google_gemini, deepseek) |

**Request:**
```bash
curl -X GET http://localhost:3002/admin/ai-providers/openai \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "cm4k9x8y0000408l5h9q3a2b8",
    "name": "openai",
    "displayName": "OpenAI",
    "enabled": true,
    "priority": 1,
    "apiKey": "sk-proj-***",
    "baseUrl": "https://api.openai.com/v1",
    "textModel": "gpt-4o-mini",
    "visionModel": "gpt-4o",
    "audioModel": "whisper-1",
    "supportsText": true,
    "supportsVision": true,
    "supportsAudio": true,
    "maxTokens": 16000,
    "temperature": 0.7,
    "costPerMillionInputTokens": 0.15,
    "costPerMillionOutputTokens": 0.60,
    "rateLimit": 500,
    "rateLimitWindow": 60,
    "createdAt": "2024-11-01T10:00:00.000Z",
    "updatedAt": "2024-12-12T15:00:00.000Z"
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Provider não encontrado"
}
```

---

### 6.3 Update Provider Configuration

**Endpoint:** `PUT /admin/ai-providers/:provider`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| provider | string | Yes | Provider name (openai, groq, google_gemini, deepseek) |

**Request Body:**

```json
{
  "enabled": true,
  "priority": 1,
  "apiKey": "sk-proj-new-api-key",
  "baseUrl": "https://api.openai.com/v1",
  "textModel": "gpt-4o-mini",
  "visionModel": "gpt-4o",
  "audioModel": "whisper-1",
  "maxTokens": 16000,
  "temperature": 0.7,
  "rateLimit": 500
}
```

**All Fields (Optional):**

| Field | Type | Description |
|-------|------|-------------|
| enabled | boolean | Enable/disable provider |
| priority | number | Priority order (1 = highest) |
| apiKey | string | API key for provider |
| baseUrl | string | Base URL for API |
| textModel | string | Model for text operations |
| visionModel | string | Model for image analysis |
| audioModel | string | Model for audio transcription |
| maxTokens | number | Maximum tokens per request |
| temperature | number | Temperature (0-2) |
| rateLimit | number | Max requests per window |
| rateLimitWindow | number | Window in seconds |
| costPerMillionInputTokens | number | Cost per 1M input tokens |
| costPerMillionOutputTokens | number | Cost per 1M output tokens |

**Request:**
```bash
curl -X PUT http://localhost:3002/admin/ai-providers/openai \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "priority": 1,
    "apiKey": "sk-proj-new-api-key",
    "textModel": "gpt-4o-mini",
    "maxTokens": 16000
  }'
```

**Response 200:**
```json
{
  "success": true,
  "message": "Configuração atualizada com sucesso",
  "data": {
    "id": "cm4k9x8y0000408l5h9q3a2b8",
    "name": "openai",
    "displayName": "OpenAI",
    "enabled": true,
    "priority": 1,
    "apiKey": "sk-proj-***",
    "textModel": "gpt-4o-mini",
    "maxTokens": 16000,
    "updatedAt": "2024-12-12T19:00:00.000Z"
  }
}
```

---

### 6.4 Seed Default Providers

Inicializa todos os providers com configurações padrão. **⚠️ Usar apenas em development ou setup inicial.**

**Endpoint:** `POST /admin/ai-providers/seed`

**Request:**
```bash
curl -X POST http://localhost:3002/admin/ai-providers/seed \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "message": "Providers padrão inicializados com sucesso"
}
```

**⚠️ Warning:** Este endpoint sobrescreve configurações existentes. Use apenas para setup inicial ou reset completo.

---

## 7. AI Settings

Configurações globais de IA (provider primário, fallback, operações por provider).

### 7.1 Get AI Settings

**Endpoint:** `GET /admin/ai-settings`

**Request:**
```bash
curl -X GET http://localhost:3002/admin/ai-settings \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "cm4k9x8y0000608l5h9q3a2c0",
    "textProvider": "openai",
    "imageProvider": "google_gemini",
    "audioProvider": "groq",
    "categoryProvider": "groq",
    "primaryProvider": "openai",
    "fallbackEnabled": true,
    "fallbackTextChain": ["openai", "groq", "deepseek", "google_gemini"],
    "fallbackImageChain": ["google_gemini", "openai"],
    "fallbackAudioChain": ["groq", "openai"],
    "fallbackCategoryChain": ["groq", "openai", "google_gemini"],
    "maxRetries": 3,
    "retryDelayMs": 1000,
    "cacheEnabled": true,
    "cacheTTL": 3600,
    "rateLimitEnabled": true,
    "globalMaxTokens": 16000,
    "globalTemperature": 0.7,
    "createdAt": "2024-11-01T10:00:00.000Z",
    "updatedAt": "2024-12-12T19:00:00.000Z"
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| textProvider | string | Provider for text operations (transaction extraction) |
| imageProvider | string | Provider for image analysis |
| audioProvider | string | Provider for audio transcription |
| categoryProvider | string | Provider for category suggestions |
| primaryProvider | string | **DEPRECATED** - Legacy primary provider |
| fallbackEnabled | boolean | Enable automatic fallback on provider failure |
| fallbackTextChain | string[] | Fallback order for text operations |
| fallbackImageChain | string[] | Fallback order for image operations |
| fallbackAudioChain | string[] | Fallback order for audio operations |
| fallbackCategoryChain | string[] | Fallback order for category suggestions |
| maxRetries | number | Max retry attempts per provider |
| retryDelayMs | number | Delay between retries (ms) |
| cacheEnabled | boolean | Enable AI response caching |
| cacheTTL | number | Cache time-to-live (seconds) |
| rateLimitEnabled | boolean | Enable rate limiting per provider |
| globalMaxTokens | number | Default max tokens (override per provider) |
| globalTemperature | number | Default temperature (override per provider) |

---

### 7.2 Update AI Settings

**Endpoint:** `PUT /admin/ai-settings`

**Request Body:**

```json
{
  "textProvider": "openai",
  "imageProvider": "google_gemini",
  "audioProvider": "groq",
  "categoryProvider": "groq",
  "fallbackEnabled": true,
  "fallbackTextChain": ["openai", "groq", "google_gemini"],
  "fallbackImageChain": ["google_gemini", "openai"],
  "fallbackAudioChain": ["groq", "openai"],
  "fallbackCategoryChain": ["groq", "openai", "google_gemini"],
  "maxRetries": 3,
  "retryDelayMs": 1000,
  "cacheEnabled": true,
  "cacheTTL": 7200,
  "rateLimitEnabled": true,
  "globalMaxTokens": 16000,
  "globalTemperature": 0.7
}
```

**All Fields (Optional):**

| Field | Type | Validation |
|-------|------|------------|
| textProvider | string | openai, groq, google_gemini, deepseek |
| imageProvider | string | openai, google_gemini |
| audioProvider | string | openai, groq |
| categoryProvider | string | openai, groq, google_gemini, deepseek |
| primaryProvider | string | **DEPRECATED** - ignored |
| fallbackEnabled | boolean | true/false |
| fallbackTextChain | string[] | Array of valid provider names |
| fallbackImageChain | string[] | Array of valid provider names |
| fallbackAudioChain | string[] | Array of valid provider names |
| fallbackCategoryChain | string[] | Array of valid provider names |
| maxRetries | number | 0-10 |
| retryDelayMs | number | 0-10000 |
| cacheEnabled | boolean | true/false |
| cacheTTL | number | 60-86400 |
| rateLimitEnabled | boolean | true/false |
| globalMaxTokens | number | 1000-128000 |
| globalTemperature | number | 0-2 |

**Request:**
```bash
curl -X PUT http://localhost:3002/admin/ai-settings \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "textProvider": "openai",
    "imageProvider": "google_gemini",
    "audioProvider": "groq",
    "categoryProvider": "groq",
    "fallbackEnabled": true,
    "fallbackTextChain": ["openai", "groq", "google_gemini"],
    "cacheTTL": 7200
  }'
```

**Response 200:**
```json
{
  "success": true,
  "message": "Configurações de IA atualizadas com sucesso",
  "data": {
    "id": "cm4k9x8y0000608l5h9q3a2c0",
    "textProvider": "openai",
    "imageProvider": "google_gemini",
    "audioProvider": "groq",
    "categoryProvider": "groq",
    "fallbackEnabled": true,
    "fallbackTextChain": ["openai", "groq", "google_gemini"],
    "cacheTTL": 7200,
    "updatedAt": "2024-12-12T19:15:00.000Z"
  }
}
```

---

## 📊 Common Response Patterns

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

### Error Response (4xx)
```json
{
  "statusCode": 400,
  "message": "Invalid request parameters",
  "error": "Bad Request"
}
```

### Authentication Error (401)
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Invalid or missing JWT token"
}
```

### Forbidden Error (403)
```json
{
  "statusCode": 403,
  "message": "Forbidden",
  "error": "Insufficient permissions (requires ADMIN or MASTER role)"
}
```

### Not Found (404)
```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}
```

### Server Error (500)
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Unexpected error occurred"
}
```

---

## 🔄 Provider Configuration Examples

### Example 1: Update OpenAI API Key
```bash
curl -X PUT http://localhost:3002/admin/ai-providers/openai \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "sk-proj-your-new-key-here"
  }'
```

### Example 2: Change Primary Text Provider to Groq
```bash
curl -X PUT http://localhost:3002/admin/ai-settings \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "textProvider": "groq",
    "fallbackTextChain": ["groq", "openai", "google_gemini"]
  }'
```

### Example 3: Disable Provider
```bash
curl -X PUT http://localhost:3002/admin/ai-providers/deepseek \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false
  }'
```

### Example 4: Configure Rate Limit
```bash
curl -X PUT http://localhost:3002/admin/ai-providers/openai \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "rateLimit": 500,
    "rateLimitWindow": 60
  }'
```

---

## 📈 Monitoring & Analytics

### Get Last 7 Days AI Usage
```bash
curl -X GET "http://localhost:3002/admin/ai-usage-logs/stats?from=2024-12-05&to=2024-12-12" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Get Failed Requests for Debugging
```bash
curl -X GET "http://localhost:3002/admin/ai-usage-logs?success=false&limit=100" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Get Pending Confirmations
```bash
curl -X GET "http://localhost:3002/admin/transaction-confirmations?status=PENDING&apiSent=false" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Get Unprocessed Messages
```bash
curl -X GET "http://localhost:3002/admin/unrecognized-messages?wasProcessed=false" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

---

## 🚨 Important Notes

1. **API Keys:** Always use environment variables for API keys. Never hardcode in requests.

2. **Rate Limits:** Each provider has different rate limits. Monitor usage via `/admin/ai-usage-logs/stats`.

3. **Costs:** OpenAI and Google Gemini have costs per token. Groq is currently free. Check `/admin/ai-usage-logs/stats` for cost tracking.

4. **Fallback Chain:** System automatically tries next provider in chain if primary fails. Configure via `/admin/ai-settings`.

5. **Cache:** AI responses are cached for performance. Clear cache via `/admin/cache/clear` if needed.

6. **Pagination:** Default limit is 50-100 items. Use `page` and `limit` query params for large datasets.

7. **Date Filters:** Use ISO 8601 format for dates: `2024-12-12` or `2024-12-12T18:30:00.000Z`

---

## 🔧 Troubleshooting

### Provider Not Responding
1. Check provider status: `GET /admin/ai-providers/:provider`
2. Verify API key is valid
3. Check rate limits: `GET /admin/ai-usage-logs/stats`
4. Review error logs: `GET /admin/ai-usage-logs?success=false&provider=openai`

### High Costs
1. Review usage by provider: `GET /admin/ai-usage-logs/stats`
2. Switch to cheaper providers for non-critical operations
3. Enable caching: `PUT /admin/ai-settings` → `"cacheEnabled": true`
4. Adjust rate limits: `PUT /admin/ai-providers/:provider`

### Unrecognized Messages Accumulating
1. Review messages: `GET /admin/unrecognized-messages`
2. Check AI extraction logs: `GET /admin/ai-usage-logs?operation=TRANSACTION_EXTRACTION&success=false`
3. Improve prompts or adjust AI temperature/maxTokens

---

## 📞 Support

For questions or issues:
- **Technical Support:** dev@gastocerto.com.br
- **Documentation:** https://docs.gastocerto.com.br
- **Status Page:** https://status.gastocerto.com.br

---

**Version:** 1.0.0  
**Last Updated:** December 12, 2024  
**Maintained By:** GastoCerto Development Team
