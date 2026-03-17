import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { TextProcessingService } from './text-processing.service';

/**
 * UserSynonymService
 *
 * Gerencia sinônimos personalizados de usuários (user_synonym table).
 * Extraído do RAGService para isolar a lógica CRUD de sinônimos
 * da lógica de busca BM25.
 *
 * Responsabilidades:
 * - CRUD de sinônimos por usuário (add, list, remove, has)
 * - Busca de sinônimos (user + global) para uma query
 * - Aprendizado por confirmação/rejeição (confirmAndLearn, rejectAndCorrect)
 */
@Injectable()
export class UserSynonymService {
  private readonly logger = new Logger(UserSynonymService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly textProcessing: TextProcessingService,
  ) {}

  /**
   * Busca sinônimos personalizados do usuário + globais
   * Retorna lista de keywords que batem com a query normalizada
   */
  async getUserSynonyms(
    userId: string,
    normalizedQuery: string,
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
      // Se prisma não estiver disponível (ex: testes), retornar array vazio
      if (!this.prisma) {
        return [];
      }

      // Tokenizar query para buscar matches parciais
      const queryTokens = this.textProcessing.tokenize(normalizedQuery);

      // Buscar sinônimos do usuário E globais (match exato por token)
      const synonyms = await this.prisma.userSynonym.findMany({
        where: {
          OR: [
            {
              // Sinônimos do usuário (match exato)
              userId,
              keyword: {
                in: queryTokens,
              },
            },
            {
              // Sinônimos globais (match exato)
              userId: null,
              keyword: {
                in: queryTokens,
              },
            },
          ],
        },
        orderBy: [
          { userId: 'asc' }, // Prioriza usuário sobre GLOBAL
          { confidence: 'desc' }, // Depois por confiança
        ],
      });

      // Atualizar usageCount e lastUsedAt para os sinônimos encontrados
      if (synonyms.length > 0) {
        await this.prisma.userSynonym.updateMany({
          where: {
            id: {
              in: synonyms.map((s) => s.id),
            },
          },
          data: {
            usageCount: {
              increment: 1,
            },
            lastUsedAt: new Date(),
          },
        });

        this.logger.log(
          `📚 Encontrados ${synonyms.length} sinônimos (${synonyms.filter((s) => s.userId === userId).length} do usuário, ${synonyms.filter((s) => s.userId === null).length} globais)`,
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
   * Adiciona novo sinônimo personalizado para o usuário
   */
  async addUserSynonym(params: {
    userId: string;
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

      // Verificar se já existe
      const existing = await this.prisma.userSynonym.findFirst({
        where: {
          userId: params.userId,
          keyword: normalizedKeyword,
        },
      });

      if (existing) {
        // Atualizar existente
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
        // Criar novo
        await this.prisma.userSynonym.create({
          data: {
            userId: params.userId,
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
        `✅ Sinônimo adicionado: "${params.keyword}" → ${params.categoryName}${params.subCategoryName ? ' → ' + params.subCategoryName : ''}`,
      );
    } catch (error) {
      this.logger.error('Erro ao adicionar sinônimo personalizado:', error);
      throw error;
    }
  }

  /**
   * Lista todos sinônimos de um usuário
   */
  async listUserSynonyms(userId: string): Promise<
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
      where: { userId },
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
   * Remove sinônimo personalizado
   */
  async removeUserSynonym(userId: string, keyword: string): Promise<void> {
    const normalizedKeyword = this.textProcessing.normalize(keyword);

    await this.prisma.userSynonym.delete({
      where: {
        userId_keyword: {
          userId,
          keyword: normalizedKeyword,
        },
      },
    });

    this.logger.log(`🗑️ Sinônimo removido: "${keyword}" para usuário ${userId}`);
  }

  /**
   * Confirma sugestão e aprende para o futuro
   *
   * Quando usuário confirma que "marmita" → "Restaurante" está correto:
   * 1. Salva em UserSynonym com alta confiança
   * 2. Próximas vezes, "marmita" já vai direto para "Restaurante"
   */
  async confirmAndLearn(params: {
    userId: string;
    originalTerm: string;
    confirmedCategoryId: string;
    confirmedCategoryName: string;
    confirmedSubcategoryId?: string;
    confirmedSubcategoryName?: string;
    confidence?: number;
  }): Promise<void> {
    await this.addUserSynonym({
      userId: params.userId,
      keyword: params.originalTerm,
      categoryId: params.confirmedCategoryId,
      categoryName: params.confirmedCategoryName,
      subCategoryId: params.confirmedSubcategoryId,
      subCategoryName: params.confirmedSubcategoryName,
      confidence: params.confidence ?? 0.9, // Alta confiança para confirmação manual
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Aprendizado confirmado: "${params.originalTerm}" → ${params.confirmedCategoryName}${params.confirmedSubcategoryName ? ' → ' + params.confirmedSubcategoryName : ''} (confiança: ${params.confidence ?? 0.9})`,
    );
  }

  /**
   * Rejeita sugestão e permite correção
   *
   * Quando usuário rejeita sugestão, pode fornecer a categoria/subcategoria correta.
   * Sistema aprende com a correção.
   */
  async rejectAndCorrect(params: {
    userId: string;
    originalTerm: string;
    rejectedCategoryId?: string;
    rejectedCategoryName?: string;
    correctCategoryId: string;
    correctCategoryName: string;
    correctSubcategoryId?: string;
    correctSubcategoryName?: string;
  }): Promise<void> {
    // ⚠️ NÃO salvar sinônimo se a categoria corrigida for genérica
    const isGenericCategory =
      params.correctCategoryName === 'Outros' || params.correctCategoryName === 'Geral';
    const isGenericSubcategory =
      !params.correctSubcategoryName ||
      params.correctSubcategoryName === 'Outros' ||
      params.correctSubcategoryName === 'Geral';

    if (isGenericCategory || isGenericSubcategory) {
      this.logger.log(
        `⚠️ Correção para categoria genérica - NÃO salvando sinônimo: "${params.originalTerm}" → ${params.correctCategoryName}`,
      );
      return;
    }

    // Salvar correção como sinônimo com alta confiança
    await this.addUserSynonym({
      userId: params.userId,
      keyword: params.originalTerm,
      categoryId: params.correctCategoryId,
      categoryName: params.correctCategoryName,
      subCategoryId: params.correctSubcategoryId,
      subCategoryName: params.correctSubcategoryName,
      confidence: 0.95, // Confiança muito alta para correção manual
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Correção aprendida: "${params.originalTerm}" → ${params.correctCategoryName}${params.correctSubcategoryName ? ' → ' + params.correctSubcategoryName : ''} (rejeitou: ${params.rejectedCategoryName || 'N/A'})`,
    );
  }

  /**
   * Busca sinônimo personalizado para sugestões inteligentes
   *
   * Verifica se usuário já tem sinônimo cadastrado para o termo.
   * Útil para evitar perguntar novamente algo que usuário já confirmou.
   */
  async hasUserSynonym(
    userId: string,
    term: string,
  ): Promise<{
    hasSynonym: boolean;
    categoryId?: string;
    categoryName?: string;
    subCategoryId?: string;
    subCategoryName?: string;
    confidence?: number;
  }> {
    const normalized = this.textProcessing.normalize(term);

    const synonym = await this.prisma.userSynonym.findUnique({
      where: {
        userId_keyword: {
          userId,
          keyword: normalized,
        },
      },
    });

    if (!synonym) {
      return { hasSynonym: false };
    }

    return {
      hasSynonym: true,
      categoryId: synonym.categoryId,
      categoryName: synonym.categoryName,
      subCategoryId: synonym.subCategoryId || undefined,
      subCategoryName: synonym.subCategoryName || undefined,
      confidence: synonym.confidence,
    };
  }
}
