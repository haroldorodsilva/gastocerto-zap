# 🔐 Problema de Autenticação WebChat (Token JWT Inválido)

## 📋 Resumo do Problema

O endpoint `/webchat/message` está retornando **401 Unauthorized** com mensagem:
```json
{"message":"Invalid or expired token","error":"Unauthorized","statusCode":401}
```

## 🔍 Diagnóstico Realizado

### 1. Token JWT Fornecido

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MDJmYTBhZC00OGU1LTQyYWUtYjIxZC0wZDgxZDY3Y2ZmMmUiLCJ1c2VybmFtZSI6ImJ5bWFzY290QGdtYWlsLmNvbSIsImlhdCI6MTczNjc2MDk0OCwiZXhwIjoxNzM2Nzc1Mzg1fQ...
```

**Payload decodificado:**
```json
{
  "sub": "602fa0ad-48e5-42ae-b21d-0d81d67cff2e",
  "username": "bymascot@gmail.com",
  "iat": 1736760948,  // 13/01/2025 09:35:48
  "exp": 1736775385   // 13/01/2025 13:36:25
}
```

**Problema identificado:**
- ❌ **Token EXPIRADO há 357 dias!**
- Token foi emitido em 13/01/2025
- Data atual: 05/01/2026
- Diferença: -30.836.807 segundos (aprox. 357 dias)

### 2. Fluxo de Validação

O endpoint `/webchat/message` está protegido por `JwtAuthGuard` que:

1. Extrai token do header `Authorization: Bearer <token>`
2. Chama `JwtValidationService.validateToken()`
3. Este serviço faz request para **gastocerto-api** via HMAC:
   ```
   POST https://gastocerto-api-hlg.onrender.com/api/external/auth/validate-token
   ```
4. A API valida:
   - ✅ Assinatura HMAC (service-to-service auth)
   - ✅ Timestamp da requisição (< 5 minutos)
   - ❌ **Token JWT (verifica se não expirou e se assinatura RSA é válida)**

### 3. Teste de Validação

Criado script `scripts/test-jwt-validation.ts` que confirmou:

```
✅ API Response:
{
  "valid": false,
  "error": "Invalid signature"
}

⏰ Token Times:
   Is Expired? ❌ YES
   Time until expiry: -30836807 seconds
```

## 🎯 Solução

### Opção 1: Gerar Novo Token (RECOMENDADO)

O usuário precisa **fazer login novamente** no frontend (`gastocerto-admin`) para obter um token válido:

1. Acesse: `https://hlg.gastocerto.com.br/login`
2. Faça login com `bymascot@gmail.com`
3. Abra o DevTools (F12) → Network
4. Procure o request `/api/auth/login` ou similar
5. Copie o novo token JWT do response
6. Use esse token no header `Authorization: Bearer <novo-token>`

### Opção 2: Bypass de Autenticação (DESENVOLVIMENTO APENAS)

Para testes locais sem precisar da API externa, adicione no `.env`:

```bash
DEV_AUTH_BYPASS=true
NODE_ENV=development
```

Isso faz o `JwtValidationService` retornar um usuário mock sem validar com a API.

**⚠️ ATENÇÃO:** Nunca use `DEV_AUTH_BYPASS=true` em produção!

### Opção 3: Verificar SHARED_SECRET

Se a API está retornando "Invalid signature" (não "Token expired"), pode ser que o **SHARED_SECRET** esteja diferente entre os serviços.

Verifique se é igual em:
- `gastocerto-zap/.env`: `SERVICE_SHARED_SECRET`
- `gastocerto-api/.env`: `SERVICE_SHARED_SECRET`

Valor atual no zap:
```
yMIICWgIBAAKBgG2caR2ppAMgTW4XbZLkI4UxUBdkEKLXCrbC8B5ymZ2tCkjQHik27B801gbSDKJNF970f7sqO22UCgawnm/SV02GRJ3hHzXlV1ZQplpD/X363XGMw12qGdfffnII1LE33Oljeo/hGpyn3Ih39K19ZytpvC+HLpUeJvQBrCT0rwktAgMBAAEC
```

## 🧪 Endpoints de Teste Criados

### 1. Validar Token JWT

```bash
GET http://localhost:4444/auth-test/validate-token?token=<SEU_TOKEN>
```

Retorna:
```json
{
  "success": boolean,
  "decodedPayload": {
    "sub": "...",
    "username": "...",
    "_debug": {
      "isExpired": true/false,
      "timeUntilExpiry": -30836807,
      "issuedAt": "2025-01-13T09:35:48.000Z",
      "expiresAt": "2025-01-13T13:36:25.000Z",
      "currentTime": "2026-01-05T11:23:12.000Z"
    }
  },
  "validatedUser": {...} ou null,
  "message": "..."
}
```

### 2. Health Check

```bash
GET http://localhost:4444/auth-test/health
```

Retorna:
```json
{
  "status": "ok",
  "timestamp": "2026-01-05T11:23:12.000Z",
  "environment": "development",
  "apiUrl": "https://gastocerto-api-hlg.onrender.com/api",
  "devBypass": false
}
```

## 🔧 Melhorias Implementadas

### 1. [jwt-auth.guard.ts](src/common/guards/jwt-auth.guard.ts)

Adicionado logs de debug:
```typescript
this.logger.debug(`[JWT Guard] Authorization header: ${authHeader ? 'Present' : 'Missing'}`);
this.logger.debug(`[JWT Guard] Token extracted, validating with gastocerto-api...`);
this.logger.warn('Invalid or expired token - API validation failed');
```

### 2. [auth-test.controller.ts](src/features/webchat/auth-test.controller.ts)

Novo controller para debug de autenticação (apenas desenvolvimento).

### 3. [test-jwt-validation.ts](scripts/test-jwt-validation.ts)

Script para testar validação de tokens manualmente.

## 📚 Documentação Relacionada

- [JWT Authentication Flow](docs/AUTENTICACAO_API.md)
- [HMAC Service-to-Service Auth](docs/SEGURANCA_HMAC.md)
- [WebChat API](docs/WEBCHAT_API.md)

## ✅ Checklist de Verificação

Antes de testar novamente:

- [ ] Gerar novo token JWT válido no frontend
- [ ] Verificar se token não está expirado
- [ ] Confirmar que SHARED_SECRET é igual em ambos os serviços
- [ ] Testar com endpoint `/auth-test/validate-token` primeiro
- [ ] Verificar logs do servidor para mensagens de erro detalhadas
- [ ] Confirmar que gastocerto-api está rodando (não hibernada no Render)

## 🚀 Como Testar

### 1. Teste Local (sem token válido)

```bash
# Ativar bypass
echo "DEV_AUTH_BYPASS=true" >> .env

# Reiniciar servidor
npm run start:dev

# Testar endpoint
curl -X POST http://localhost:4444/webchat/message \
  -H 'Authorization: Bearer qualquer-coisa' \
  -H 'Content-Type: application/json' \
  -d '{"message":"teste"}'
```

### 2. Teste com Token Válido

```bash
# Obter novo token do frontend
# Depois testar:
curl -X POST http://localhost:4444/auth-test/validate-token?token=<NOVO_TOKEN>

# Se validar, testar webchat:
curl -X POST http://localhost:4444/webchat/message \
  -H 'Authorization: Bearer <NOVO_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'x-account: bf298d28-bd4a-4874-9d98-47ac9a8e556b' \
  -d '{"message":"teste"}'
```

## 🎓 Conclusão

O problema NÃO é com a implementação do WebChat, mas sim com o **token JWT fornecido**:
- Token expirou há 357 dias
- Precisa fazer novo login no frontend para obter token válido
- Para testes de desenvolvimento, pode usar `DEV_AUTH_BYPASS=true`
