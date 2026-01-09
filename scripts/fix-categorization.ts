import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Corrigindo sinônimos e categorização...\n');

  try {
    // 1. Criar sinônimos globais para comida
    console.log('1️⃣  Criando sinônimos para "comida" e variações...');
    
    const foodSynonyms = [
      'comida',
      'alimento',
      'alimentacao',
      'alimentação',
      'mercado',
      'supermercado',
      'feira',
      'fruta',
      'frutas',
      'verdura',
      'verduras',
      'legume',
      'legumes',
      'carne',
      'carnes',
      'peixe',
      'peixes',
      'pao',
      'pães',
      'padaria',
    ];

    for (const keyword of foodSynonyms) {
      try {
        await prisma.userSynonym.create({
          data: {
            userId: 'GLOBAL', // Sinônimo global
            keyword,
            categoryId: 'ALIMENTACAO_GLOBAL',
            categoryName: 'Alimentação',
            subCategoryId: '',
            subCategoryName: '',
            confidence: 0.95,
            source: 'ADMIN_APPROVED',
            usageCount: 0,
            lastUsedAt: new Date(),
          },
        });
        console.log(`   ✅ Criado: "${keyword}" → Alimentação`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          console.log(`   ⏭️  Já existe: "${keyword}"`);
        } else {
          console.error(`   ❌ Erro ao criar "${keyword}":`, error.message);
        }
      }
    }

    // 2. Verificar se há sinônimos incorretos para "gás"
    console.log('\n2️⃣  Verificando sinônimos de "gás"...');
    
    const gasSynonyms = await prisma.userSynonym.findMany({
      where: {
        OR: [
          { keyword: { contains: 'gas' } },
          { keyword: { contains: 'gás' } },
        ],
      },
    });

    console.log(`   Total encontrado: ${gasSynonyms.length}`);
    gasSynonyms.forEach((syn) => {
      console.log(`   - "${syn.keyword}" → ${syn.categoryName}${syn.subCategoryName ? ` > ${syn.subCategoryName}` : ''} (${syn.source})`);
    });

    // 3. Verificar configuração do RAG
    console.log('\n3️⃣  Verificando configuração do RAG...');
    
    const aiSettings = await prisma.aISettings.findFirst();
    
    if (aiSettings) {
      console.log(`   ragEnabled: ${aiSettings.ragEnabled ? '✅' : '❌'}`);
      console.log(`   ragThreshold: ${aiSettings.ragThreshold}`);
      console.log(`   ragAiEnabled: ${aiSettings.ragAiEnabled ? '✅' : '❌'}`);
      console.log(`   ragAiProvider: ${aiSettings.ragAiProvider || 'N/A'}`);
      
      // Garantir que RAG está habilitado
      if (!aiSettings.ragEnabled) {
        console.log('\n   ⚠️  RAG está desabilitado! Habilitando...');
        await prisma.aISettings.update({
          where: { id: aiSettings.id },
          data: { ragEnabled: true },
        });
        console.log('   ✅ RAG habilitado!');
      }
    } else {
      console.log('   ❌ AISettings não encontrado!');
    }

    console.log('\n✅ Correções aplicadas com sucesso!');
    console.log('\n💡 Próximos passos:');
    console.log('   1. Reinicie o servidor para aplicar as mudanças');
    console.log('   2. Teste novamente no webchat');
    console.log('   3. Verifique os logs com: npm run check-rag-logs');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
