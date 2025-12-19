#!/usr/bin/env ts-node
/**
 * 📊 Script de Análise RAG - Identificar Oportunidades de Melhoria
 * 
 * Este script analisa os logs de RAG e IA para identificar:
 * 1. Keywords que precisam de sinônimos
 * 2. Taxa de fallback por usuário
 * 3. Categorias problemáticas
 * 4. Performance ao longo do tempo
 * 
 * Uso:
 * npx ts-node scripts/analyze-rag-logs.ts [--days=30] [--json]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AnalysisConfig {
  days: number;
  jsonOutput: boolean;
}

// ============================================================================
// ANÁLISE 1: Keywords que precisam de sinônimos
// ============================================================================
async function findMissingSynonyms(days: number) {
  console.log(`\n🔍 Buscando keywords que precisam de sinônimos (últimos ${days} dias)...\n`);

  const results = await prisma.$queryRaw<any[]>`
    SELECT 
      ai.inputText as query,
      ROUND(AVG(ai.ragInitialScore)::numeric, 4) as avg_rag_score,
      ai.aiCategoryName as ai_category,
      ROUND(AVG(ai.aiConfidence)::numeric, 4) as avg_ai_confidence,
      COUNT(*) as occurrences
    FROM ai_usage_logs ai
    WHERE 
      ai.wasRagFallback = true
      AND ai.success = true
      AND ai.needsSynonymLearning = true
      AND ai.createdAt >= NOW() - INTERVAL '${days} days'
    GROUP BY ai.inputText, ai.aiCategoryName
    HAVING COUNT(*) >= 2
    ORDER BY occurrences DESC, avg_ai_confidence DESC
    LIMIT 20
  `;

  if (results.length === 0) {
    console.log('✅ Nenhum keyword problemático encontrado! RAG está funcionando bem.\n');
    return [];
  }

  console.log('📋 Top keywords que precisam de sinônimos:\n');
  console.log('─'.repeat(100));
  console.log('Query'.padEnd(25), 'RAG Score', 'IA Categoria'.padEnd(30), 'IA Conf', 'Ocorrências');
  console.log('─'.repeat(100));

  results.forEach((r) => {
    console.log(
      r.query.padEnd(25),
      String(r.avg_rag_score || 0).padEnd(9),
      (r.ai_category || 'N/A').padEnd(30),
      String(r.avg_ai_confidence || 0).padEnd(7),
      r.occurrences
    );
  });

  console.log('─'.repeat(100));
  console.log(`\n💡 ${results.length} keywords encontrados. Considere adicionar sinônimos para eles.\n`);

  return results;
}

// ============================================================================
// ANÁLISE 2: Taxa de fallback por usuário
// ============================================================================
async function getFallbackRateByUser(days: number) {
  console.log(`\n📊 Analisando taxa de fallback por usuário (últimos ${days} dias)...\n`);

  const results = await prisma.$queryRaw<any[]>`
    SELECT 
      uc.name as user_name,
      uc.phoneNumber as phone,
      COUNT(*) as total_queries,
      SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END) as fallbacks,
      ROUND(
        (SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
        2
      ) as fallback_rate
    FROM ai_usage_logs ai
    JOIN user_cache uc ON uc.gastoCertoId = ai.userCacheId
    WHERE 
      ai.operation = 'CATEGORY_SUGGESTION'
      AND ai.createdAt >= NOW() - INTERVAL '${days} days'
    GROUP BY uc.name, uc.phoneNumber
    HAVING COUNT(*) >= 5
    ORDER BY fallback_rate DESC
    LIMIT 10
  `;

  if (results.length === 0) {
    console.log('✅ Nenhum dado de fallback encontrado.\n');
    return [];
  }

  console.log('📋 Top usuários com maior taxa de fallback:\n');
  console.log('─'.repeat(90));
  console.log('Usuário'.padEnd(25), 'Total', 'Fallbacks', 'Taxa %');
  console.log('─'.repeat(90));

  results.forEach((r) => {
    const rate = parseFloat(r.fallback_rate || 0);
    const emoji = rate > 50 ? '🔴' : rate > 30 ? '🟡' : '🟢';
    console.log(
      `${emoji} ${r.user_name}`.padEnd(25),
      String(r.total_queries).padEnd(5),
      String(r.fallbacks).padEnd(10),
      `${rate}%`
    );
  });

  console.log('─'.repeat(90));
  console.log('\n💡 Usuários com >30% de fallback precisam de sinônimos personalizados.\n');

  return results;
}

// ============================================================================
// ANÁLISE 3: Categorias problemáticas
// ============================================================================
async function getProblematicCategories(days: number) {
  console.log(`\n📂 Identificando categorias problemáticas (últimos ${days} dias)...\n`);

  const results = await prisma.$queryRaw<any[]>`
    SELECT 
      ai.aiCategoryName as category,
      COUNT(*) as occurrences,
      ROUND(AVG(ai.ragInitialScore)::numeric, 4) as avg_rag_score,
      ROUND(AVG(ai.aiConfidence)::numeric, 4) as avg_ai_confidence
    FROM ai_usage_logs ai
    WHERE 
      ai.wasRagFallback = true
      AND ai.success = true
      AND ai.ragInitialScore < 0.60
      AND ai.createdAt >= NOW() - INTERVAL '${days} days'
    GROUP BY ai.aiCategoryName
    HAVING COUNT(*) >= 3
    ORDER BY occurrences DESC
    LIMIT 15
  `;

  if (results.length === 0) {
    console.log('✅ Nenhuma categoria problemática encontrada!\n');
    return [];
  }

  console.log('📋 Categorias que mais precisam de sinônimos:\n');
  console.log('─'.repeat(80));
  console.log('Categoria'.padEnd(40), 'Ocorr.', 'RAG Score', 'IA Conf');
  console.log('─'.repeat(80));

  results.forEach((r) => {
    console.log(
      (r.category || 'N/A').padEnd(40),
      String(r.occurrences).padEnd(7),
      String(r.avg_rag_score || 0).padEnd(10),
      String(r.avg_ai_confidence || 0)
    );
  });

  console.log('─'.repeat(80));
  console.log(`\n💡 ${results.length} categorias precisam de mais sinônimos.\n`);

  return results;
}

// ============================================================================
// ANÁLISE 4: Performance ao longo do tempo
// ============================================================================
async function getRAGPerformance(days: number) {
  console.log(`\n📈 Performance do RAG ao longo do tempo (últimos ${days} dias)...\n`);

  const results = await prisma.$queryRaw<any[]>`
    SELECT 
      DATE_TRUNC('week', rag.createdAt) as week,
      COUNT(*) as total_searches,
      SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN rag.wasAiFallback = true THEN 1 ELSE 0 END) as fallbacks,
      ROUND(
        (SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
        2
      ) as success_rate
    FROM rag_search_logs rag
    WHERE 
      rag.flowStep = 1
      AND rag.createdAt >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE_TRUNC('week', rag.createdAt)
    ORDER BY week DESC
    LIMIT 12
  `;

  if (results.length === 0) {
    console.log('✅ Nenhum dado de performance encontrado.\n');
    return [];
  }

  console.log('📋 Taxa de sucesso do RAG por semana:\n');
  console.log('─'.repeat(70));
  console.log('Semana'.padEnd(20), 'Buscas', 'Sucessos', 'Taxa %');
  console.log('─'.repeat(70));

  results.forEach((r) => {
    const date = new Date(r.week);
    const dateStr = date.toLocaleDateString('pt-BR');
    const rate = parseFloat(r.success_rate || 0);
    const emoji = rate >= 80 ? '🟢' : rate >= 60 ? '🟡' : '🔴';

    console.log(
      dateStr.padEnd(20),
      String(r.total_searches).padEnd(7),
      String(r.successes).padEnd(9),
      `${emoji} ${rate}%`
    );
  });

  console.log('─'.repeat(70));

  // Calcular tendência
  if (results.length >= 2) {
    const newest = parseFloat(results[0].success_rate || 0);
    const oldest = parseFloat(results[results.length - 1].success_rate || 0);
    const trend = newest - oldest;
    const trendEmoji = trend > 5 ? '📈' : trend < -5 ? '📉' : '➡️';

    console.log(`\n${trendEmoji} Tendência: ${trend > 0 ? '+' : ''}${trend.toFixed(2)}% (comparando primeira e última semana)`);
  }

  console.log('');

  return results;
}

// ============================================================================
// ANÁLISE 5: Custo de fallback
// ============================================================================
async function getFallbackCost(days: number) {
  console.log(`\n💰 Custo de fallback para IA (últimos ${days} dias)...\n`);

  const results = await prisma.$queryRaw<any[]>`
    SELECT 
      ai.provider,
      COUNT(*) as fallbacks,
      ROUND(SUM(ai.estimatedCost)::numeric, 6) as total_cost_usd,
      ROUND(AVG(ai.estimatedCost)::numeric, 6) as avg_cost_usd
    FROM ai_usage_logs ai
    WHERE 
      ai.wasRagFallback = true
      AND ai.operation = 'CATEGORY_SUGGESTION'
      AND ai.createdAt >= NOW() - INTERVAL '${days} days'
    GROUP BY ai.provider
    ORDER BY total_cost_usd DESC
  `;

  if (results.length === 0) {
    console.log('✅ Nenhum custo de fallback registrado.\n');
    return [];
  }

  console.log('📋 Custo por provider:\n');
  console.log('─'.repeat(70));
  console.log('Provider'.padEnd(20), 'Fallbacks', 'Custo Total', 'Custo Médio');
  console.log('─'.repeat(70));

  let totalCost = 0;
  results.forEach((r) => {
    const cost = parseFloat(r.total_cost_usd || 0);
    totalCost += cost;
    console.log(
      r.provider.padEnd(20),
      String(r.fallbacks).padEnd(10),
      `$${cost.toFixed(6)}`.padEnd(12),
      `$${parseFloat(r.avg_cost_usd || 0).toFixed(6)}`
    );
  });

  console.log('─'.repeat(70));
  console.log(`\nCusto total de fallback: $${totalCost.toFixed(6)} USD`);
  console.log(`Projeção mensal (30 dias): $${((totalCost / days) * 30).toFixed(2)} USD\n`);

  return results;
}

// ============================================================================
// ANÁLISE 6: Estatísticas gerais
// ============================================================================
async function getGeneralStats(days: number) {
  console.log(`\n📊 Estatísticas Gerais (últimos ${days} dias)...\n`);

  const stats = await prisma.$queryRaw<any[]>`
    SELECT 
      COUNT(DISTINCT rag.userId) as unique_users,
      COUNT(*) as total_searches,
      SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END) as rag_successes,
      SUM(CASE WHEN rag.wasAiFallback = true THEN 1 ELSE 0 END) as ai_fallbacks,
      ROUND(
        (SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
        2
      ) as success_rate,
      ROUND(
        (SUM(CASE WHEN rag.wasAiFallback = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
        2
      ) as fallback_rate
    FROM rag_search_logs rag
    WHERE 
      rag.flowStep = 1
      AND rag.createdAt >= NOW() - INTERVAL '${days} days'
  `;

  if (stats.length === 0 || !stats[0]) {
    console.log('❌ Nenhum dado encontrado.\n');
    return null;
  }

  const s = stats[0];
  const successRate = parseFloat(s.success_rate || 0);
  const fallbackRate = parseFloat(s.fallback_rate || 0);

  console.log('┌─────────────────────────────────────────────┐');
  console.log('│            RESUMO EXECUTIVO                 │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│ Usuários únicos:      ${String(s.unique_users || 0).padStart(20)} │`);
  console.log(`│ Total de buscas:      ${String(s.total_searches || 0).padStart(20)} │`);
  console.log(`│ Sucessos RAG:         ${String(s.rag_successes || 0).padStart(20)} │`);
  console.log(`│ Fallbacks IA:         ${String(s.ai_fallbacks || 0).padStart(20)} │`);
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│ Taxa de sucesso:      ${String(successRate + '%').padStart(20)} │`);
  console.log(`│ Taxa de fallback:     ${String(fallbackRate + '%').padStart(20)} │`);
  console.log('└─────────────────────────────────────────────┘\n');

  // Avaliação
  if (successRate >= 80) {
    console.log('✅ RAG está com excelente performance (≥80%)');
  } else if (successRate >= 60) {
    console.log('⚠️ RAG precisa de melhorias (60-80%)');
  } else {
    console.log('🔴 RAG precisa de atenção urgente (<60%)');
  }

  if (fallbackRate <= 20) {
    console.log('✅ Taxa de fallback está saudável (≤20%)\n');
  } else if (fallbackRate <= 40) {
    console.log('⚠️ Taxa de fallback elevada (20-40%). Adicione mais sinônimos.\n');
  } else {
    console.log('🔴 Taxa de fallback crítica (>40%). AÇÃO URGENTE: adicionar sinônimos!\n');
  }

  return s;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const config: AnalysisConfig = {
    days: 30,
    jsonOutput: false,
  };

  // Parse arguments
  args.forEach((arg) => {
    if (arg.startsWith('--days=')) {
      config.days = parseInt(arg.split('=')[1]);
    }
    if (arg === '--json') {
      config.jsonOutput = true;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('📊 ANÁLISE DE LOGS RAG - Sistema Gasto Certo');
  console.log('='.repeat(80));

  const results: any = {
    config,
    timestamp: new Date().toISOString(),
  };

  try {
    // Executar todas as análises
    results.generalStats = await getGeneralStats(config.days);
    results.missingKeywords = await findMissingSynonyms(config.days);
    results.userFallbackRate = await getFallbackRateByUser(config.days);
    results.problematicCategories = await getProblematicCategories(config.days);
    results.performance = await getRAGPerformance(config.days);
    results.cost = await getFallbackCost(config.days);

    // Output JSON se solicitado
    if (config.jsonOutput) {
      console.log('\n' + '='.repeat(80));
      console.log('JSON OUTPUT:');
      console.log('='.repeat(80));
      console.log(JSON.stringify(results, null, 2));
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Análise concluída!');
    console.log('='.repeat(80));
    console.log('\n💡 Próximos passos:');
    console.log('   1. Revisar keywords que precisam de sinônimos');
    console.log('   2. Adicionar sinônimos em user_synonyms');
    console.log('   3. Monitorar melhoria da taxa de sucesso');
    console.log('   4. Repetir análise semanalmente\n');

  } catch (error) {
    console.error('❌ Erro durante análise:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

export { main };
