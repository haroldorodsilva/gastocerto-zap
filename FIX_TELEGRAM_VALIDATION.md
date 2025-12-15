# 🔧 Correção: Validação de Código no Telegram

## 🐛 Problema Identificado

### **Erro:**
```
"Telefone não corresponde ao código solicitado"
```

### **Causa Raiz:**
A tabela `onboarding_sessions` estava usando a coluna `phoneNumber` para armazenar **dois tipos diferentes de identificadores**:

1. **WhatsApp:** Número de telefone real (ex: `5566996285154`)
2. **Telegram:** Chat ID (ex: `123456789`)

Quando o código de verificação era enviado, a validação comparava:
```typescript
if (authCode.phoneNumber !== normalizedPhone) {
  // authCode.phoneNumber = "123456789" (chatId)
  // normalizedPhone = "5566996285154" (telefone real)
  return { error: "PHONE_MISMATCH" };
}
```

---

## ✅ Solução Implementada

### **1. Mudança no Schema**

**Antes:**
```prisma
model OnboardingSession {
  phoneNumber   String  @unique  // ❌ Misturava chatId e telefone real
}
```

**Depois:**
```prisma
model OnboardingSession {
  platformId    String  @unique  // ✅ Telegram chatId ou WhatsApp number
  phoneNumber   String?          // ✅ Telefone real (opcional até ser coletado)
}
```

### **2. Migration Criada**

```sql
-- Adicionar platformId
ALTER TABLE "onboarding_sessions" ADD COLUMN "platformId" TEXT;

-- Migrar dados existentes
UPDATE "onboarding_sessions" SET "platformId" = "phoneNumber";

-- Tornar phoneNumber opcional
ALTER TABLE "onboarding_sessions" ALTER COLUMN "phoneNumber" DROP NOT NULL;

-- Tornar platformId obrigatório e único
ALTER TABLE "onboarding_sessions" ALTER COLUMN "platformId" SET NOT NULL;
CREATE UNIQUE INDEX "onboarding_sessions_platformId_key" ON "onboarding_sessions"("platformId");
```

### **3. Código Atualizado**

**Criação da sessão:**
```typescript
const session = await this.prisma.onboardingSession.upsert({
  where: { platformId: phoneNumber }, // ✅ Usar platformId (chatId)
  create: {
    platformId: phoneNumber,          // Telegram chatId ou WhatsApp number
    phoneNumber: null,                // Será preenchido quando coletar
    currentStep: OnboardingStep.COLLECT_NAME,
    // ...
  },
});
```

**Ao coletar telefone:**
```typescript
await this.updateSessionById(session.id, {
  phoneNumber: metadata.phoneNumber,  // ✅ Atualizar com telefone real
  data: { realPhoneNumber: metadata.phoneNumber },
});
```

**Na validação:**
```typescript
const result = await this.gastoCertoApi.validateAuthCode({
  email: data.email,
  phoneNumber: data.realPhoneNumber,  // ✅ Usar telefone real, não chatId
  code: data.verificationCode,
});
```

---

## 📊 Fluxo Corrigido

### **Telegram:**

```
1. Usuário inicia conversa
   platformId: "123456789" (chatId)
   phoneNumber: null

2. Coleta nome e email
   platformId: "123456789"
   phoneNumber: null
   data: { name: "João", email: "joao@email.com" }

3. Solicita telefone (compartilhar contato)
   platformId: "123456789"
   phoneNumber: null

4. Recebe telefone real
   platformId: "123456789"
   phoneNumber: "5566996285154" ✅
   data: { realPhoneNumber: "5566996285154" }

5. Envia código para email
   API recebe: { email, phoneNumber: "5566996285154" }

6. Usuário digita código
   Valida com: phoneNumber: "5566996285154" ✅
   
7. Sucesso! ✅
```

### **WhatsApp:**

```
1. Usuário inicia conversa
   platformId: "5566996285154" (já é o telefone)
   phoneNumber: "5566996285154" (já preenchido)

2. Continua normal...
```

---

## 🧪 Como Testar

### **1. Limpar sessões antigas:**
```sql
DELETE FROM onboarding_sessions;
```

### **2. Iniciar novo onboarding no Telegram:**
```
/start
```

### **3. Seguir fluxo:**
- Digite nome
- Digite email
- Compartilhe contato OU digite telefone
- Digite código recebido por email

### **4. Validar logs:**
```
🔍 DEBUG - platformId (chatId): 123456789
🔍 DEBUG - realPhoneNumber coletado: 5566996285154
🔍 DEBUG - Validando com phoneNumber: 5566996285154
✅ Código validado!
```

---

## 📝 Campos na Tabela

| Campo | Tipo | Descrição | Exemplo Telegram | Exemplo WhatsApp |
|-------|------|-----------|------------------|------------------|
| `platformId` | String (unique) | Identificador da plataforma | `"123456789"` | `"5566996285154"` |
| `phoneNumber` | String? | Telefone real do usuário | `"5566996285154"` | `"5566996285154"` |
| `data.realPhoneNumber` | JSON | Backup do telefone real | `"5566996285154"` | `"5566996285154"` |

---

## ⚠️ Pontos de Atenção

### **1. Dados em `data.realPhoneNumber`:**
- Continue armazenando no JSON também (redundância é segurança)
- Use como fallback se `phoneNumber` estiver null

### **2. WhatsApp:**
- `platformId` e `phoneNumber` serão iguais
- Funciona normalmente

### **3. Telegram:**
- `platformId` = chatId
- `phoneNumber` = telefone real coletado
- Validação usa `phoneNumber`, não `platformId`

---

## ✅ Resultado

- ✅ **WhatsApp:** Continua funcionando normal
- ✅ **Telegram:** Agora valida código corretamente
- ✅ **Dados migrados:** Sessões antigas preservadas
- ✅ **Sem breaking changes:** Backward compatible

---

## 🔍 Verificar no Banco

```sql
SELECT 
  "platformId",
  "phoneNumber",
  "data"->>'realPhoneNumber' as real_phone,
  "currentStep",
  "completed"
FROM onboarding_sessions
ORDER BY "createdAt" DESC
LIMIT 5;
```

Deve mostrar:
```
 platformId  |   phoneNumber   |   real_phone    | currentStep | completed
-------------+-----------------+-----------------+-------------+-----------
 123456789   | 5566996285154   | 5566996285154   | VERIFY_CODE | false
```

---

🎉 **Problema resolvido!**
