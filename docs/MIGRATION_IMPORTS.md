# 🔄 Guia de Migração de Imports

## Estrutura Antiga → Nova

```
src/
├── common/
│   ├── prisma.service.ts          → core/database/prisma.service.ts
│   ├── security/                  → features/security/
│   └── utils/                     → core/utils/
│
├── config/                        → core/config/
│
├── modules/
│   ├── ai/                        → infrastructure/ai/
│   ├── media/                     → infrastructure/media/
│   ├── messages/                  → infrastructure/whatsapp/messages/
│   ├── sessions/                  → infrastructure/whatsapp/sessions/
│   ├── assistant/                 → features/assistant/
│   ├── onboarding/                → features/onboarding/
│   ├── transactions/              → features/transactions/
│   ├── users/                     → features/users/
│   └── subscriptions/             → features/subscriptions/
```

---

## Find & Replace Global

Execute estes comandos para atualizar todos os imports de uma vez:

```bash
cd /Users/haroldorodsilva/projets/gastocerto/zap/gastocerto-zap/src

# 1. Atualizar imports do PrismaService
find . -type f -name "*.ts" -exec sed -i '' \
  "s|@common/prisma.service|@core/database/prisma.service|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./common/prisma.service'|'./core/database/prisma.service'|g" {} \;

# 2. Atualizar imports de config
find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./config/|'./core/config/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|@config/|@core/config/|g" {} \;

# 3. Atualizar imports de utils
find . -type f -name "*.ts" -exec sed -i '' \
  "s|@common/utils|@core/utils|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'../common/utils|'../core/utils|g" {} \;

# 4. Atualizar imports de módulos
find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/sessions/|'./infrastructure/whatsapp/sessions/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/messages/|'./infrastructure/whatsapp/messages/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/ai/|'./infrastructure/ai/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/media/|'./infrastructure/media/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/onboarding/|'./features/onboarding/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/transactions/|'./features/transactions/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/users/|'./features/users/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'./modules/subscriptions/|'./features/subscriptions/|g" {} \;

# 5. Atualizar imports relativos (dentro dos módulos)
find . -type f -name "*.ts" -exec sed -i '' \
  "s|'../modules/users/|'../users/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'../modules/transactions/|'../transactions/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'../modules/onboarding/|'../onboarding/|g" {} \;

find . -type f -name "*.ts" -exec sed -i '' \
  "s|'../modules/ai/|'../../infrastructure/ai/|g" {} \;
```

---

## Configurar Path Aliases (tsconfig.json)

Adicione estes aliases para facilitar imports:

```json
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["src/core/*"],
      "@features/*": ["src/features/*"],
      "@infrastructure/*": ["src/infrastructure/*"],
      "@common/*": ["src/common/*"]
    }
  }
}
```

---

## Manual Updates Necessários

### app.module.ts

```typescript
// ANTES
import { PrismaService } from './common/prisma.service';
import { databaseConfig } from './config/database.config';
import { SessionsModule } from './modules/sessions/sessions.module';
import { MessagesModule } from './modules/messages/messages.module';
import { AiModule } from './modules/ai/ai.module';
import { UsersModule } from './modules/users/users.module';

// DEPOIS
import { PrismaService } from './core/database/prisma.service';
import { databaseConfig } from './core/config/database.config';
import { EventsModule } from './core/events/events.module';
import { SecurityModule } from './features/security/security.module';
import { AssistantModule } from './features/assistant/assistant.module';
import { SessionsModule } from './infrastructure/whatsapp/sessions/sessions.module';
import { MessagesModule } from './infrastructure/whatsapp/messages/messages.module';
import { AiModule } from './infrastructure/ai/ai.module';
import { UsersModule } from './features/users/users.module';
import { OnboardingModule } from './features/onboarding/onboarding.module';
import { TransactionsModule } from './features/transactions/transactions.module';
```

---

## Validação

Após executar os comandos, verifique:

```bash
# 1. Verificar se ainda existem imports antigos
grep -r "@common/prisma.service" src/
grep -r "'./modules/" src/
grep -r "'./config/" src/

# 2. Compilar
npm run build

# 3. Verificar erros de importação
npm run lint
```

---

## Rollback (se necessário)

```bash
# Reverter todas mudanças
git checkout src/

# Ou commit parcial
git add -p
```

---

## Checklist

- [ ] Executar find & replace commands
- [ ] Atualizar app.module.ts manualmente
- [ ] Configurar path aliases no tsconfig.json
- [ ] Compilar e verificar erros
- [ ] Testar imports com `npm run lint`
- [ ] Commit changes: `git commit -m "refactor: reorganize module structure"`

---

**Tempo estimado**: 10 minutos  
**Arquivos afetados**: ~50 arquivos  
**Risco**: Baixo (pode reverter com git)
