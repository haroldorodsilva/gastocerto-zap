# 🔧 Como Resolver Migração Falhada no Deploy

## ❌ Problema

O deploy está falhandocom o erro:

```
Error: P3009
migrate found failed migrations in the target database
The `20260114120000_make_user_synonym_userid_nullable` migration started at 2026-02-10 17:39:46.056388 UTC failed
```

## 🔍 Causa

Uma migração Prisma falhou anteriormente no banco de produção e está bloqueando novas migrações. Isso acontece quando:
- A migração foi interrompida no meio da execução
- Houve um erro de sintaxe SQL
- O banco estava em um estado inconsistente

## ✅ Solução 1: Script Automático (Recomendado)

Execute o script que corrige automaticamente a migração:

```bash
# Use a DATABASE_URL de PRODUÇÃO
DATABASE_URL="postgresql://neondb_owner:npg_AbFrp5DNSyJ1@ep-polished-mud-acka0cf2-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require" \
npx ts-node scripts/fix-failed-migration.ts
```

O script irá:
1. Verificar o status da migração falhada
2. Aplicar manualmente as alterações do SQL
3. Marcar a migração como aplicada com sucesso

Depois, faça o deploy novamente.

## ✅ Solução 2: Comando Prisma (Manual)

Se preferir resolver manualmente:

### Opção A: Marcar como Resolvida (se as alterações já foram aplicadas)

```bash
# Use a DATABASE_URL de PRODUÇÃO
DATABASE_URL="postgresql://..." \
npx prisma migrate resolve --applied 20260114120000_make_user_synonym_userid_nullable
```

### Opção B: Marcar como Revertida (se precisa reaplicar)

```bash
# Use a DATABASE_URL de PRODUÇÃO
DATABASE_URL="postgresql://..." \
npx prisma migrate resolve --rolled-back 20260114120000_make_user_synonym_userid_nullable
```

Depois execute:

```bash
DATABASE_URL="postgresql://..." \
npx prisma migrate deploy
```

## ✅ Solução 3: Acesso Direto ao Banco (SQL)

Se tiver acesso ao banco de produção via psql ou interface web:

### Para marcar como aplicada:

```sql
UPDATE "_prisma_migrations" 
SET 
  finished_at = NOW(), 
  success = true,
  rolled_back_at = NULL,
  logs = 'Resolvido manualmente'
WHERE migration_name = '20260114120000_make_user_synonym_userid_nullable';
```

### Para deletar e reaplicar:

```sql
DELETE FROM "_prisma_migrations" 
WHERE migration_name = '20260114120000_make_user_synonym_userid_nullable';
```

Depois faça o deploy novamente.

## 🚨 Importante

- **Sempre use a DATABASE_URL de PRODUÇÃO** ao executar estes comandos
- **Faça backup** antes de executar comandos SQL diretos
- A migração `20260114120000_make_user_synonym_userid_nullable` torna `userId` nullable na tabela `user_synonyms`
- Se a branch `dev` está funcionando, provavelmente a migração já foi aplicada lá corretamente

## 🔄 Prevenção Futura

Para evitar esse problema:

1. **Teste migrações em staging** antes de produção
2. **Use transações** em migrações complexas quando possível
3. **Monitore os logs** durante migrações em produção
4. **Tenha um plano de rollback** para cada migração

## 📚 Referências

- [Prisma: Resolve Migration Issues](https://pris.ly/d/migrate-resolve)
- [Prisma Error P3009](https://www.prisma.io/docs/reference/api-reference/error-reference#p3009)
