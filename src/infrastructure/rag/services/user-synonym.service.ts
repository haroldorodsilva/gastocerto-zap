import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { TextProcessingService } from './text-processing.service';

/**
 * UserSynonymService
 *
 * Gerencia sinônimos personalizados por CONTA (n:m).
 * Um sinônimo aprendido na conta A não contamina a conta B.
 *
 * Sinônimos GLOBAIS (userId=null, accountId=null) são compartilhados entre
 * todas as contas e servem como base de conhecimento geral.
 *
 * Responsabilidades:
 * - CRUD de sinônimos (add, list, remove, has)
 * - Busca de sinônimos (conta-específicos + globais)
 * - Aprendizado por confirmação/rejeição
 */
@Injectable()
export class UserSynonymService {
  private readonly logger = new Logger(UserSynonymService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly textProcessing: TextProcessingService,
  ) {}

  /**
   * Busca sinônimos da conta + globais para uma query normalizada.
   * @param accountId - Quando fornecido, inclui sinônimos específicos da conta.
   */
  async getUserSynonyms(
    userId: string,
    normalizedQuery: string,
    accountId?: string | null,
  ): Promise<
    Array<{
      keyword: string;
      categoryId: string;
      categoryName: string;
      subCategoryId?: string;
      subCategoryName?: string;
      confidence: number;
      isGlobal?: boolean;
    }>
  > {
    try {
      if (!this.prisma) return [];

      const queryTokens = this.textProcessing.tokenize(normalizedQuery);

      // Sinônimos da conta (se accountId fornecido) + globais (userId null, accountId null)
      const synonyms = await this.prisma.userSynonym.findMany({
        where: {
          OR: [
            // Sinônimos da conta específica
            ...(accountId
              ? [
                  {
                    userId,
                    accountId,
                    keyword: { in: queryTokens },
                  },
                ]
              : [
                  // Fallback legado: sinônimos do usuário sem accountId
                  {
                    userId,
                    accountId: null,
                    keyword: { in: queryTokens },
                  },
                ]),
            // Sinônimos globais (base de conhecimento compartilhada)
            {
              userId: null,
              accountId: null,
              keyword: { in: queryTokens },
            },
          ],
        },
        orderBy: [
          { userId: 'asc' }, // Conta > Global
          { confidence: 'desc' },
        ],
      });

      if (synonyms.length > 0) {
        await this.prisma.userSynonym.updateMany({
          where: { id: { in: synonyms.map((s) => s.id) } },
          data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
        });

        const contaSynonyms = synonyms.filter((s) => s.userId === userId).length;
        const globalSynonyms = synonyms.filter((s) => s.userId === null).length;
        this.logger.log(
          `📚 ${synonyms.length} sinônimos | ${contaSynonyms} da conta | ${globalSynonyms} globais`,
        );
      }

      return synonyms.map((s) => ({
        keyword: s.keyword,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        subCategoryId: s.subCategoryId || undefined,
        subCategoryName: s.subCategoryName || undefined,
        confidence: s.confidence,
        isGlobal: s.userId === null,
      }));
    } catch (error) {
      this.logger.error('Erro ao buscar sinônimos personalizados:', error);
      return [];
    }
  }

  /**
   * Adiciona ou atualiza sinônimo para a conta.
   * @param accountId - Conta onde o sinônimo é válido.
   */
  async addUserSynonym(params: {
    userId: string;
    accountId?: string | null;
    keyword: string;
    categoryId: string;
    categoryName: string;
    subCategoryId?: string;
    subCategoryName?: string;
    confidence?: number;
    source?: 'USER_CONFIRMED' | 'AI_SUGGESTED' | 'AUTO_LEARNED' | 'IMPORTED' | 'ADMIN_APPROVED';
  }): Promise<void> {
    try {
      const normalizedKeyword = this.textProcessing.normalize(params.keyword);

      const existing = await this.prisma.userSynonym.findFirst({
        where: {
          userId: params.userId,
          accountId: params.accountId ?? null,
          keyword: normalizedKeyword,
        },
      });

      if (existing) {
        await this.prisma.userSynonym.update({
          where: { id: existing.id },
          data: {
            categoryId: params.categoryId,
            categoryName: params.categoryName,
            subCategoryId: params.subCategoryId,
            subCategoryName: params.subCategoryName,
            confidence: params.confidence ?? 1.0,
            source: params.source ?? 'USER_CONFIRMED',
            updatedAt: new Date(),
          },
        });
      } else {
        await this.prisma.userSynonym.create({
          data: {
            userId: params.userId,
            accountId: params.accountId ?? null,
            keyword: normalizedKeyword,
            categoryId: params.categoryId,
            categoryName: params.categoryName,
            subCategoryId: params.subCategoryId,
            subCategoryName: params.subCategoryName,
            confidence: params.confidence ?? 1.0,
            source: params.source ?? 'USER_CONFIRMED',
          },
        });
      }

      this.logger.log(
        `✅ Sinônimo: "${params.keyword}" → ${params.categoryName}${params.subCategoryName ? ' > ' + params.subCategoryName : ''} | accountId=${params.accountId}`,
      );
    } catch (error) {
      this.logger.error('Erro ao adicionar sinônimo:', error);
      throw error;
    }
  }

  /**
   * Lista sinônimos da conta.
   */
  async listUserSynonyms(
    userId: string,
    accountId?: string | null,
  ): Promise<
    Array<{
      id: string;
      keyword: string;
      categoryName: string;
      subCategoryName?: string;
      confidence: number;
      usageCount: number;
      source: string;
    }>
  > {
    const synonyms = await this.prisma.userSynonym.findMany({
      where: {
        userId,
        ...(accountId !== undefined ? { accountId: accountId ?? null } : {}),
      },
      orderBy: [{ usageCount: 'desc' }, { confidence: 'desc' }],
    });

    return synonyms.map((s) => ({
      id: s.id,
      keyword: s.keyword,
      categoryName: s.categoryName,
      subCategoryName: s.subCategoryName || undefined,
      confidence: s.confidence,
      usageCount: s.usageCount,
      source: s.source,
    }));
  }

  /**
   * Remove sinônimo da conta.
   */
  async removeUserSynonym(
    userId: string,
    keyword: string,
    accountId?: string | null,
  ): Promise<void> {
    const normalizedKeyword = this.textProcessing.normalize(keyword);

    // Buscar por userId + accountId + keyword (unique constraint atualizado)
    const synonym = await this.prisma.userSynonym.findFirst({
      where: {
        userId,
        accountId: accountId ?? null,
        keyword: normalizedKeyword,
      },
    });

    if (synonym) {
      await this.prisma.userSynonym.delete({ where: { id: synonym.id } });
      this.logger.log(`🗑️ Sinônimo removido: "${keyword}" | accountId=${accountId}`);
    }
  }

  /**
   * Verifica se existe sinônimo aprendido para o termo na conta.
   */
  async hasUserSynonym(
    userId: string,
    term: string,
    accountId?: string | null,
  ): Promise<{
    hasSynonym: boolean;
    categoryId?: string;
    categoryName?: string;
    subCategoryId?: string;
    subCategoryName?: string;
    confidence?: number;
  }> {
    const normalized = this.textProcessing.normalize(term);

    // Prioridade: sinônimo da conta específica > sinônimo global (userId=null, accountId=null)
    const synonym = await this.prisma.userSynonym.findFirst({
      where: {
        OR: [
          // Sinônimo da conta específica
          ...(accountId ? [{ userId, accountId, keyword: normalized }] : []),
          // Fallback legado: sinônimo do usuário sem accountId
          { userId, accountId: null, keyword: normalized },
          // Sinônimo global (base de conhecimento compartilhada)
          { userId: null, accountId: null, keyword: normalized },
        ],
      },
      orderBy: [
        { userId: 'asc' }, // conta > global
        { confidence: 'desc' },
      ],
    });

    if (!synonym) return { hasSynonym: false };

    return {
      hasSynonym: true,
      categoryId: synonym.categoryId,
      categoryName: synonym.categoryName,
      subCategoryId: synonym.subCategoryId || undefined,
      subCategoryName: synonym.subCategoryName || undefined,
      confidence: synonym.confidence,
    };
  }

  /**
   * Aprende por confirmação do usuário.
   */
  async confirmAndLearn(params: {
    userId: string;
    accountId?: string | null;
    originalTerm: string;
    confirmedCategoryId: string;
    confirmedCategoryName: string;
    confirmedSubcategoryId?: string;
    confirmedSubcategoryName?: string;
    confidence?: number;
  }): Promise<void> {
    await this.addUserSynonym({
      userId: params.userId,
      accountId: params.accountId,
      keyword: params.originalTerm,
      categoryId: params.confirmedCategoryId,
      categoryName: params.confirmedCategoryName,
      subCategoryId: params.confirmedSubcategoryId,
      subCategoryName: params.confirmedSubcategoryName,
      confidence: params.confidence ?? 0.9,
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Aprendizado confirmado: "${params.originalTerm}" → ${params.confirmedCategoryName}${params.confirmedSubcategoryName ? ' > ' + params.confirmedSubcategoryName : ''} | accountId=${params.accountId}`,
    );
  }

  /**
   * Aprende com a correção do usuário.
   */
  async rejectAndCorrect(params: {
    userId: string;
    accountId?: string | null;
    originalTerm: string;
    rejectedCategoryId?: string;
    rejectedCategoryName?: string;
    correctCategoryId: string;
    correctCategoryName: string;
    correctSubcategoryId?: string;
    correctSubcategoryName?: string;
  }): Promise<void> {
    const isGenericCategory =
      params.correctCategoryName === 'Outros' || params.correctCategoryName === 'Geral';
    const isGenericSubcategory =
      !params.correctSubcategoryName ||
      params.correctSubcategoryName === 'Outros' ||
      params.correctSubcategoryName === 'Geral';

    if (isGenericCategory || isGenericSubcategory) {
      this.logger.log(
        `⚠️ Categoria genérica — NÃO salvando: "${params.originalTerm}" → ${params.correctCategoryName}`,
      );
      return;
    }

    await this.addUserSynonym({
      userId: params.userId,
      accountId: params.accountId,
      keyword: params.originalTerm,
      categoryId: params.correctCategoryId,
      categoryName: params.correctCategoryName,
      subCategoryId: params.correctSubcategoryId,
      subCategoryName: params.correctSubcategoryName,
      confidence: 0.95,
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Correção aprendida: "${params.originalTerm}" → ${params.correctCategoryName}${params.correctSubcategoryName ? ' > ' + params.correctSubcategoryName : ''} (rejeitou: ${params.rejectedCategoryName || 'N/A'})`,
    );
  }
}
