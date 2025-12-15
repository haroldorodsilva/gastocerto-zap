# 🔐 SEGURANÇA - AUTENTICAÇÃO ENTRE SERVIÇOS (HMAC)

## ✅ Implementado: ServiceAuthGuard

O sistema **JÁ POSSUI** camada de segurança HMAC (Hash-based Message Authentication Code) para autenticação entre serviços.

### 📍 Localização

- **Guard**: `src/common/guards/service-auth.guard.ts`
- **Service**: `src/common/services/service-auth.service.ts`
- **Uso**: `src/infrastructure/whatsapp/sessions/external.controller.ts`

### 🔒 Como Funciona

#### 1. **Headers Obrigatórios**

O gastocerto-api deve enviar estes headers em TODAS as requisições para `/external/*`:

```typescript
headers: {
  'X-Service-Id': 'gastocerto-api',          // Identificador do serviço
  'X-Timestamp': '1734268800000',            // Unix timestamp (ms)
  'X-Signature': '9a8f7e6d5c4b3a2f1e0d...'   // HMAC-SHA256 do body
}
```

#### 2. **Geração da Assinatura HMAC**

**No gastocerto-api** (Node.js/TypeScript):

```typescript
import crypto from 'crypto';

function generateHMAC(body: object, serviceId: string, timestamp: string): string {
  const secret = process.env.SERVICE_SECRET; // Mesma SECRET dos 2 lados
  
  // Criar payload: serviceId + timestamp + body JSON
  const payload = `${serviceId}:${timestamp}:${JSON.stringify(body)}`;
  
  // Gerar HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  
  return hmac.digest('hex');
}

// Exemplo de uso
const body = { phoneNumber: '66996285154', userId: '123' };
const serviceId = 'gastocerto-api';
const timestamp = Date.now().toString();

const signature = generateHMAC(body, serviceId, timestamp);

await axios.post(`${ZAP_API_URL}/external/sync-categories`, body, {
  headers: {
    'X-Service-Id': serviceId,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  },
});
```

#### 3. **Validação no gastocerto-zap**

O `ServiceAuthGuard` valida automaticamente:

1. ✅ **Headers presentes**: `X-Service-Id`, `X-Timestamp`, `X-Signature`
2. ✅ **Timestamp válido**: Máximo 5 minutos de diferença (previne replay attacks)
3. ✅ **Assinatura válida**: Recalcula HMAC e compara com a recebida
4. ✅ **Service-Id válido**: Verifica se está na whitelist

```typescript
@UseGuards(ServiceAuthGuard)
@Post('sync-categories')
async syncCategories(@Body() dto: SyncCategoriesDto) {
  // Se chegou aqui, passou pela autenticação HMAC ✅
  await this.userCacheService.syncUserCategoriesToRAG(dto.phoneNumber);
  return { success: true };
}
```

### 🔐 Configuração da SECRET

**Ambiente: gastocerto-zap** (`.env`)

```bash
# Secret compartilhada entre serviços (NUNCA commitar no Git!)
SERVICE_SECRET=sua_chave_secreta_super_segura_256_bits
```

**Ambiente: gastocerto-api** (`.env`)

```bash
# MESMA secret do gastocerto-zap
SERVICE_SECRET=sua_chave_secreta_super_segura_256_bits

# URL do gastocerto-zap
ZAP_API_URL=http://localhost:3000
```

### 🛡️ Proteção Contra Ataques

| Ataque | Proteção |
|--------|----------|
| **Replay Attack** | Timestamp com janela de 5 minutos |
| **Man-in-the-Middle** | HMAC garante integridade dos dados |
| **Força Bruta** | Secret de 256 bits + HMAC-SHA256 |
| **Request Forgery** | Apenas service-id autorizados |

### 📋 Checklist de Integração (gastocerto-api)

#### ✅ Implementar Geração de HMAC

```typescript
// src/services/zap-api.service.ts
import crypto from 'crypto';
import axios from 'axios';

export class ZapApiService {
  private readonly zapApiUrl = process.env.ZAP_API_URL;
  private readonly serviceId = 'gastocerto-api';
  private readonly serviceSecret = process.env.SERVICE_SECRET;

  private generateSignature(body: object, timestamp: string): string {
    const payload = `${this.serviceId}:${timestamp}:${JSON.stringify(body)}`;
    return crypto
      .createHmac('sha256', this.serviceSecret)
      .update(payload)
      .digest('hex');
  }

  async syncUserCategories(phoneNumber: string, userId: string): Promise<void> {
    const timestamp = Date.now().toString();
    const body = { phoneNumber, userId };
    const signature = this.generateSignature(body, timestamp);

    await axios.post(`${this.zapApiUrl}/external/sync-categories`, body, {
      headers: {
        'X-Service-Id': this.serviceId,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
    });
  }
}
```

#### ✅ Chamar Endpoint Após Mudanças

```typescript
// Após criar/editar/deletar categoria
await zapApiService.syncUserCategories(user.phoneNumber, user.id);

// Após mudar conta padrão
await zapApiService.syncUserCategories(user.phoneNumber, user.id);
```

### 🧪 Teste Manual

```bash
# 1. Gerar timestamp
TIMESTAMP=$(date +%s)000

# 2. Gerar assinatura (Node.js)
node -e "
const crypto = require('crypto');
const secret = 'sua_chave_secreta';
const serviceId = 'gastocerto-api';
const timestamp = '${TIMESTAMP}';
const body = JSON.stringify({ phoneNumber: '66996285154', userId: '123' });
const payload = serviceId + ':' + timestamp + ':' + body;
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log(signature);
"

# 3. Fazer request
curl -X POST http://localhost:3000/external/sync-categories \
  -H "Content-Type: application/json" \
  -H "X-Service-Id: gastocerto-api" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Signature: <assinatura_gerada>" \
  -d '{"phoneNumber":"66996285154","userId":"123"}'
```

### ✅ Status da Implementação

- ✅ **ServiceAuthGuard** implementado
- ✅ **ServiceAuthService** com validação HMAC-SHA256
- ✅ **Proteção contra replay attacks** (timestamp)
- ✅ **Endpoint /external/sync-categories** protegido
- ✅ **Whitelist de service-ids**
- ⏳ **Integração no gastocerto-api** (pendente)

### 🔗 Endpoints Protegidos

Todos os endpoints em `/external/*` são protegidos por HMAC:

- `POST /external/sync-categories` - Sincroniza categorias do usuário no RAG

**Novos endpoints external devem usar `@UseGuards(ServiceAuthGuard)`**
