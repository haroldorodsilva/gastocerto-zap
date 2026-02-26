/**
 * Script para resolver migração falhada no banco de produção
 * 
 * Uso:
 * 1. Execute com DATABASE_URL de produção:
 *    DATABASE_URL="postgresql://..." npx ts-node scripts/fix-failed-migration.ts
 * 
 * O script irá:
 * - Verificar o status da migração falhada
 * - Tentar aplicar manualmente as alterações que falharam
 * - Marcar a migração como aplicada com sucesso
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FAILED_MIGRATION = '20260114120000_make_user_synonym_userid_nullable';

async function main() {
  console.log('🔍 Verificando status da migração falhada...\n');

  try {
    // Verificar status da migração
    const migration = await prisma.$queryRaw<any[]>`
      SELECT * FROM "_prisma_migrations" 
      WHERE migration_name = ${FAILED_MIGRATION}
    `;

    if (migration.length === 0) {
      console.log('✅ Migração não encontrada na tabela. Tudo certo!');
      return;
    }

    console.log('📊 Status atual da migração:');
    console.log(migration[0]);
    console.log('');

    if (migration[0].finished_at && !migration[0].rolled_back_at) {
      console.log('✅ Migração já foi aplicada com sucesso!');
      return;
    }

    console.log('🔧 Tentando aplicar as alterações manualmente...\n');

    // Verificar se a coluna userId já é nullable
    const columnInfo = await prisma.$queryRaw<any[]>`
      SELECT column_name, is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_synonyms' 
      AND column_name IN ('userId', 'categoryId')
    `;

    console.log('📋 Estado atual das colunas:');
    console.log(columnInfo);
    console.log('');

    const userIdColumn = columnInfo.find(c => c.column_name === 'userId');
    const categoryIdColumn = columnInfo.find(c => c.column_name === 'categoryId');

    // Aplicar as alterações necessárias
    if (userIdColumn && userIdColumn.is_nullable === 'NO') {
      console.log('🔨 Tornando userId nullable...');
      
      // NOVO: Preencher registros com userId NULL com valor temporário
      console.log('  - Preenchendo valores NULL com temporário...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "userId" = 'TEMP_GLOBAL_' || id::text 
        WHERE "userId" IS NULL
      `;
      
      // Limpar valores 'GLOBAL'
      console.log('  - Limpando valores GLOBAL...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "userId" = 'TEMP_GLOBAL_' || id::text 
        WHERE "userId" = 'GLOBAL'
      `;
      
      // Tornar nullable
      console.log('  - Alterando coluna para nullable...');
      await prisma.$executeRaw`
        ALTER TABLE "user_synonyms" ALTER COLUMN "userId" DROP NOT NULL
      `;
      
      // Restaurar valores NULL
      console.log('  - Restaurando valores NULL...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "userId" = NULL 
        WHERE "userId" LIKE 'TEMP_GLOBAL_%'
      `;
      
      console.log('✅ userId agora é nullable');
    } else {
      console.log('✅ userId já é nullable');
    }

    if (categoryIdColumn && categoryIdColumn.is_nullable === 'NO') {
      console.log('🔨 Tornando categoryId nullable...');
      
      // NOVO: Preencher registros com categoryId NULL com valor temporário
      console.log('  - Preenchendo valores NULL com temporário...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "categoryId" = 'TEMP_GLOBAL_' || id::text 
        WHERE "categoryId" IS NULL
      `;
      
      // Limpar valores 'GLOBAL'
      console.log('  - Limpando valores GLOBAL...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "categoryId" = 'TEMP_GLOBAL_' || id::text 
        WHERE "categoryId" = 'GLOBAL' OR "userId" IS NULL
      `;
      
      // Tornar nullable
      console.log('  - Alterando coluna para nullable...');
      await prisma.$executeRaw`
        ALTER TABLE "user_synonyms" ALTER COLUMN "categoryId" DROP NOT NULL
      `;
      
      // Restaurar valores NULL
      console.log('  - Restaurando valores NULL...');
      await prisma.$executeRaw`
        UPDATE "user_synonyms" 
        SET "categoryId" = NULL 
        WHERE "categoryId" LIKE 'TEMP_GLOBAL_%'
      `;
      
      console.log('✅ categoryId agora é nullable');
    } else {
      console.log('✅ categoryId já é nullable');
    }

    // Remover constraint antigo se existir
    console.log('🔨 Ajustando constraints e índices...');
    
    await prisma.$executeRaw`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_synonyms_userId_keyword_key') THEN
          ALTER TABLE "user_synonyms" DROP CONSTRAINT "user_synonyms_userId_keyword_key";
        END IF;
      END $$;
    `;

    // Criar novo índice único
    await prisma.$executeRaw`
      DROP INDEX IF EXISTS "user_synonyms_userId_keyword_key"
    `;

    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_synonyms_userId_keyword_key" 
      ON "user_synonyms" ("userId", "keyword") 
      WHERE "userId" IS NOT NULL
    `;

    // Criar índice para sinônimos globais
    await prisma.$executeRaw`
      DROP INDEX IF EXISTS "user_synonyms_global_keyword_idx"
    `;

    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "user_synonyms_global_keyword_idx" 
      ON "user_synonyms" ("keyword") 
      WHERE "userId" IS NULL
    `;

    console.log('✅ Constraints e índices atualizados');
    console.log('');

    // Marcar a migração como aplicada com sucesso
    console.log('🔨 Marcando migração como aplicada com sucesso...');
    
    // Primeiro verificar quais colunas existem
    const columns = await prisma.$queryRaw<any[]>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '_prisma_migrations'
    `;
    
    const hasSuccessColumn = columns.some(c => c.column_name === 'success');
    
    if (hasSuccessColumn) {
      await prisma.$executeRaw`
        UPDATE "_prisma_migrations" 
        SET finished_at = NOW(), 
            success = true, 
            rolled_back_at = NULL,
            logs = 'Aplicada manualmente via script fix-failed-migration.ts'
        WHERE migration_name = ${FAILED_MIGRATION}
      `;
    } else {
      // Versão do Prisma sem coluna success
      await prisma.$executeRaw`
        UPDATE "_prisma_migrations" 
        SET finished_at = NOW(), 
            rolled_back_at = NULL,
            logs = 'Aplicada manualmente via script fix-failed-migration.ts'
        WHERE migration_name = ${FAILED_MIGRATION}
      `;
    }

    console.log('✅ Migração marcada como aplicada!');
    console.log('');
    console.log('🎉 Problema resolvido! Você pode fazer o deploy novamente.');

  } catch (error) {
    console.error('❌ Erro ao resolver migração:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
