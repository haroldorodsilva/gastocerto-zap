import { Injectable, Logger, Optional } from '@nestjs/common';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { UserCacheService } from '../../users/user-cache.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';

/**
 * CategoryResolverService
 *
 * Resolve nomes de categorias e subcategorias para seus IDs reais.
 * Estratégia de busca em 3 camadas:
 *   1. Cache RAG (formato expandido com subcategorias)
 *   2. Cache local do usuário (formato API)
 *   3. API GastoCerto (último recurso)
 *
 * Suporta dois formatos de subcategoria:
 *   a) subCategory: { id, name } — cache expandido do RAG
 *   b) subCategories: [] — formato da API
 */
@Injectable()
export class CategoryResolverService {
  private readonly logger = new Logger(CategoryResolverService.name);

  constructor(
    private readonly userCache: UserCacheService,
    private readonly gastoCertoApi: GastoCertoApiService,
    @Optional() private readonly ragService?: RAGService,
  ) {}

  /**
   * Resolve categoria e subcategoria da conta.
   * Busca primeiro no cache local, depois na API se necessário.
   * Retorna IDs a partir de nomes ou IDs.
   * IMPORTANTE: Filtra categorias pelo tipo da transação (INCOME/EXPENSES).
   */
  async resolve(
    userId: string,
    accountId: string,
    categoryNameOrId: string,
    subcategoryNameOrId?: string,
    transactionType?: 'INCOME' | 'EXPENSES',
  ): Promise<{ categoryId: string | null; subCategoryId: string | null }> {
    this.logger.debug(
      `🔍 [DEBUG] resolve chamado com: category="${categoryNameOrId}", subCategory="${subcategoryNameOrId}", type="${transactionType}"`,
    );

    try {
      // Buscar usuário no cache pelo gastoCertoId (userId é o gastoCertoId)
      const user = await this.userCache.getUserByGastoCertoId(userId);

      let categoriesData: any[] = [];

      // 1. PRIORIDADE: Tentar buscar do cache RAG (formato expandido com subcategorias)
      if (this.ragService) {
        try {
          // Pass accountId for account-scoped cache lookup (n:m fix)
          const ragCategories = await this.ragService.getCachedCategories(userId, accountId);
          if (ragCategories && ragCategories.length > 0) {
            // Filtrar por tipo de transação (accountId já está no cache scope)
            categoriesData = ragCategories.filter((cat: any) => {
              const matchesType = !transactionType || cat.type === transactionType;
              return matchesType;
            });

            if (categoriesData.length > 0) {
              this.logger.log(
                `📦 Usando ${categoriesData.length} categoria(s) do cache RAG (formato expandido, tipo: ${transactionType || 'TODOS'})`,
              );
            }
          }
        } catch (error) {
          this.logger.warn(`⚠️ Erro ao buscar do cache RAG: ${error.message}`);
        }
      }

      // 2. Fallback: Buscar do cache do usuário (formato API não expandido)
      if (
        categoriesData.length === 0 &&
        user &&
        user.categories &&
        Array.isArray(user.categories)
      ) {
        const cachedCategories = user.categories as any[];

        // Filtrar categorias da conta específica E tipo de transação
        categoriesData = cachedCategories.filter((cat: any) => {
          const matchesAccount = cat.accountId === accountId;
          const matchesType = !transactionType || cat.type === transactionType;
          return matchesAccount && matchesType;
        });

        if (categoriesData.length > 0) {
          this.logger.log(
            `📦 Usando ${categoriesData.length} categoria(s) do cache local do usuário (tipo: ${transactionType || 'TODOS'})`,
          );
        } else {
          this.logger.warn(
            `⚠️ Cache tem categorias mas nenhuma da conta ${accountId} e tipo ${transactionType}. Total no cache: ${cachedCategories.length}`,
          );
        }
      }

      // 3. Último recurso: Buscar na API
      if (categoriesData.length === 0) {
        this.logger.log(`🔍 Buscando categorias na API (cache vazio)`);
        categoriesData = await this.gastoCertoApi.getAccountCategories(userId, accountId);

        if (!categoriesData || categoriesData.length === 0) {
          this.logger.warn(`⚠️ Conta ${accountId} não possui categorias`);
          return { categoryId: null, subCategoryId: null };
        }
      }

      // 4. Procurar categoria (case-insensitive + normalizado)
      const normalizedInput = this.normalizeText(categoryNameOrId);
      const matchingCategory = categoriesData.find(
        (cat: any) =>
          this.normalizeText(cat.name) === normalizedInput || cat.id === categoryNameOrId,
      );

      if (!matchingCategory) {
        this.logger.warn(`⚠️ Categoria não encontrada: ${categoryNameOrId}`);

        // DEBUG: Listar categorias disponíveis
        const available = categoriesData
          .map((c: any) => `${c.name} (tipo: ${c.type || 'N/A'})`)
          .join(', ');
        this.logger.warn(`📋 Categorias disponíveis: ${available}`);

        return { categoryId: null, subCategoryId: null };
      }

      const categoryId = matchingCategory.id;
      this.logger.log(`📂 Categoria resolvida: ${categoryNameOrId} → ${categoryId}`);

      // DEBUG: Log completo da estrutura da categoria encontrada
      this.logger.debug(
        `🔍 [DEBUG] Categoria encontrada - Estrutura completa: ${JSON.stringify(matchingCategory, null, 2).substring(0, 500)}`,
      );

      // 5. Se não há subcategoria informada, retornar apenas categoria
      if (!subcategoryNameOrId) {
        return { categoryId, subCategoryId: null };
      }

      // 6. Procurar subcategoria - suportar DOIS formatos:
      //    a) subCategories: [] (formato da API)
      //    b) subCategory: { id, name } (formato do cache expandido do RAG)
      let subCategoryId: string | null = null;

      // Formato do cache expandido (cada entrada tem UMA subcategoria)
      if (matchingCategory.subCategory && typeof matchingCategory.subCategory === 'object') {
        const subCat = matchingCategory.subCategory;
        if (
          this.normalizeText(subCat.name) === this.normalizeText(subcategoryNameOrId) ||
          subCat.id === subcategoryNameOrId
        ) {
          subCategoryId = subCat.id;
          this.logger.log(
            `📂 Subcategoria resolvida (cache): ${subcategoryNameOrId} → ${subCategoryId}`,
          );
          return { categoryId, subCategoryId };
        }
      }

      // Formato da API (categoria tem array de subcategorias)
      if (matchingCategory.subCategories && Array.isArray(matchingCategory.subCategories)) {
        this.logger.debug(
          `📋 Procurando em ${matchingCategory.subCategories.length} subcategorias da API...`,
        );

        const matchingSubCategory = matchingCategory.subCategories.find(
          (subCat: any) =>
            this.normalizeText(subCat.name) === this.normalizeText(subcategoryNameOrId) ||
            subCat.id === subcategoryNameOrId,
        );

        if (matchingSubCategory) {
          subCategoryId = matchingSubCategory.id;
          this.logger.log(
            `📂 Subcategoria resolvida (API): ${subcategoryNameOrId} → ${subCategoryId}`,
          );
          return { categoryId, subCategoryId };
        }
      }

      // Se não encontrou, buscar em TODAS as categorias expandidas do cache
      // (pode haver múltiplas entradas da mesma categoria, cada uma com uma subcategoria diferente)
      const allMatchingCategories = categoriesData.filter(
        (cat: any) =>
          (this.normalizeText(cat.name) === this.normalizeText(categoryNameOrId) ||
            cat.id === categoryNameOrId) &&
          cat.subCategory &&
          (this.normalizeText(cat.subCategory.name) === this.normalizeText(subcategoryNameOrId) ||
            cat.subCategory.id === subcategoryNameOrId),
      );

      if (allMatchingCategories.length > 0) {
        subCategoryId = allMatchingCategories[0].subCategory.id;
        this.logger.log(
          `📂 Subcategoria resolvida (busca expandida): ${subcategoryNameOrId} → ${subCategoryId}`,
        );
        return { categoryId, subCategoryId };
      }

      // Não encontrou a subcategoria
      this.logger.warn(
        `⚠️ Subcategoria "${subcategoryNameOrId}" não encontrada na categoria "${matchingCategory.name}"`,
      );

      // DEBUG: Listar subcategorias disponíveis
      if (matchingCategory.subCategories && Array.isArray(matchingCategory.subCategories)) {
        const subCatNames = matchingCategory.subCategories.map((sc: any) => sc.name).join(', ');
        this.logger.warn(`📋 Subcategorias disponíveis (API): ${subCatNames}`);
      }

      // DEBUG: Verificar todas as entradas da categoria no cache
      const allCategoryEntries = categoriesData.filter(
        (cat: any) =>
          cat.name.toLowerCase() === categoryNameOrId.toLowerCase() || cat.id === categoryNameOrId,
      );
      if (allCategoryEntries.length > 1) {
        const subCatNames = allCategoryEntries
          .filter((e: any) => e.subCategory)
          .map((e: any) => e.subCategory.name)
          .join(', ');
        this.logger.warn(`📋 Subcategorias disponíveis (cache): ${subCatNames}`);
      }

      return { categoryId, subCategoryId: null };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao resolver categoria/subcategoria:`, error);
      return { categoryId: null, subCategoryId: null };
    }
  }

  /**
   * Normaliza texto para comparação: minúsculas + remove acentos
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
