/**
 * Seed de credenciais padrão para rotação de chaves de IA.
 *
 * USO:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-ai-credentials.ts
 *
 * - Usa upsert por (provider + label), então pode ser reexecutado sem duplicar.
 * - Substitua os valores de apiKey pelos reais antes de executar.
 * - Remova ou comente os providers/chaves que não usar.
 * - `priority`: menor = preferido. Chaves com mesma priority seguem lastUsedAt (menos usada primeiro).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const credentials = [
  // ─── OpenAI ────────────────────────────────────────────────────────────────
  {
    provider: 'openai',
    label: 'openai-key-1',
    apiKey: 'sk-SUBSTITUIR_KEY_1',
    priority: 1,
    isActive: true,
  },
  {
    provider: 'openai',
    label: 'openai-key-2',
    apiKey: 'sk-SUBSTITUIR_KEY_2',
    priority: 2,
    isActive: false, // desabilite enquanto não tiver a chave
  },

  // ─── Google Gemini ─────────────────────────────────────────────────────────
  {
    provider: 'google_gemini',
    label: 'gemini-key-1',
    apiKey: 'AIza-SUBSTITUIR_KEY_1',
    priority: 1,
    isActive: true,
  },
  {
    provider: 'google_gemini',
    label: 'gemini-key-2',
    apiKey: 'AIza-SUBSTITUIR_KEY_2',
    priority: 2,
    isActive: false,
  },

  // ─── Groq ──────────────────────────────────────────────────────────────────
  {
    provider: 'groq',
    label: 'groq-key-1',
    apiKey: 'gsk_SUBSTITUIR_KEY_1',
    priority: 1,
    isActive: true,
  },
  {
    provider: 'groq',
    label: 'groq-key-2',
    apiKey: 'gsk_SUBSTITUIR_KEY_2',
    priority: 2,
    isActive: false,
  },

  // ─── DeepSeek ──────────────────────────────────────────────────────────────
  {
    provider: 'deepseek',
    label: 'deepseek-key-1',
    apiKey: 'sk-SUBSTITUIR_KEY_1',
    priority: 1,
    isActive: true,
  },
];

async function main() {
  console.log('🔑 Seeding ai_provider_credentials...\n');

  for (const cred of credentials) {
    const result = await prisma.aIProviderCredential.upsert({
      where: {
        provider_label: {
          provider: cred.provider,
          label: cred.label,
        },
      },
      create: {
        id: crypto.randomUUID(),
        provider: cred.provider,
        label: cred.label,
        apiKey: cred.apiKey,
        priority: cred.priority,
        isActive: cred.isActive,
        isExhausted: false,
        updatedAt: new Date(),
      },
      update: {
        priority: cred.priority,
        isActive: cred.isActive,
        // Não sobrescreve apiKey em update para não apagar chave real
      },
    });

    const status = cred.isActive ? '✅' : '⏸️ ';
    console.log(`${status}  ${cred.provider.padEnd(15)} | ${cred.label.padEnd(20)} | priority=${cred.priority} | id=${result.id}`);
  }

  console.log('\n✅ Seed concluído.\n');

  // Resumo por provider
  const counts = await prisma.aIProviderCredential.groupBy({
    by: ['provider'],
    _count: { id: true },
    where: { isActive: true },
  });

  console.log('📊 Credenciais ativas por provider:');
  for (const row of counts) {
    console.log(`   ${row.provider.padEnd(15)} → ${row._count.id} chave(s)`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Erro no seed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
