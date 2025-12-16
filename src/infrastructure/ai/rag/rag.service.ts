import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '@core/database/prisma.service';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';

/**
 * RAGService - Retrieval-Augmented Generation
 *
 * Implementação BM25 para matching semântico de categorias SEM embeddings vetoriais.
 *
 * FEATURES:
 * - Tokenização e normalização de texto (lowercase, remove acentos)
 * - Matching fuzzy com sinônimos
 * - Scoring BM25: term frequency (TF) + inverse document frequency (IDF)
 * - Cache de categorias por usuário (Redis ou Map)
 * - Sem dependências externas (OpenAI, pgvector, etc)
 * - ✨ Log de tentativas no banco para analytics
 *
 * CACHE:
 * - Se RAG_CACHE_REDIS=true (default): usa Redis (persistente, compartilhado)
 * - Se RAG_CACHE_REDIS=false: usa Map (em memória, não persistente)
 *
 * EXEMPLOS:
 * - "rotativo" → "Cartão Rotativo" (score: 0.95)
 * - "almoço" → "Alimentação > Restaurantes" (score: 0.75)
 * - "gasolina" → "Transporte > Combustível" (score: 0.88)
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);
  private readonly useRedisCache: boolean;
  private readonly cacheTTL: number = 86400; // 24 horas

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.useRedisCache = this.configService.get<boolean>('RAG_CACHE_REDIS', true);
    this.logger.log(
      `🧠 RAGService inicializado | Cache: ${this.useRedisCache ? 'Redis (✅ Persistente)' : 'Map (⚠️ Temporário)'}`,
    );
  }

  // Cache de categorias por usuário (Map como fallback)
  // Chave: userId (gastoCertoId do UserCache)
  private readonly categoryCache = new Map<string, UserCategory[]>();

  // Dicionário de sinônimos para melhorar matching
  // Expandido baseado em categorias reais do sistema
  private readonly synonyms = new Map<string, string[]>([
    // Cartão e Finanças
    ['cartao', ['credito', 'debito', 'fatura', 'anuidade', 'parcelamento']],
    ['credito', ['cartao', 'debito', 'fatura']],
    ['debito', ['cartao', 'credito', 'fatura']],
    ['fatura', ['cartao', 'credito', 'debito', 'pagamento']],
    ['anuidade', ['cartao', 'credito', 'debito']],
    ['rotativo', ['cartao', 'credito', 'fatura']],
    ['emprestimo', ['credito', 'financiamento', 'divida']],
    ['financiamento', ['emprestimo', 'credito', 'divida']],
    ['divida', ['emprestimo', 'financiamento', 'credito']],

    // Alimentação
    ['almoco', ['almoço', 'comida', 'restaurante', 'refeicao', 'alimento']],
    ['jantar', ['janta', 'comida', 'restaurante', 'refeicao']],
    ['supermercado', ['mercado', 'compras', 'alimentacao', 'feira', 'hortifruti']],
    ['mercado', ['supermercado', 'compras', 'alimentacao', 'feira']],
    [
      'feira',
      ['supermercado', 'mercado', 'compras', 'alimentacao', 'hortifruti', 'verduras', 'frutas'],
    ],
    ['hortifruti', ['feira', 'frutas', 'verduras', 'legumes', 'fruta', 'verdura']],
    ['frutas', ['hortifruti', 'feira', 'fruta', 'banana', 'melancia', 'maca']],
    ['fruta', ['hortifruti', 'feira', 'frutas', 'banana', 'melancia', 'maca']],
    ['melancia', ['hortifruti', 'frutas', 'fruta', 'feira']],
    ['verduras', ['hortifruti', 'feira', 'verdura', 'legumes', 'salada']],
    ['verdura', ['hortifruti', 'feira', 'verduras', 'legumes', 'salada']],
    ['padaria', ['pao', 'pães', 'cafe', 'lanche']],
    ['pao', ['pães', 'padaria', 'paes']],
    ['restaurante', ['comida', 'refeicao', 'almoco', 'jantar', 'bar', 'restaurantes']],
    ['restaurantes', ['comida', 'refeicao', 'almoco', 'jantar', 'bar', 'restaurante']],
    ['lanche', ['lanches', 'salgado', 'coxinha', 'pastel']],
    ['marmita', ['marmitex', 'quentinha', 'comida']],
    ['ifood', ['delivery', 'entrega', 'comida', 'pedido', 'rappi']],
    ['delivery', ['entrega', 'pedido', 'ifood', 'rappi']],

    // Transporte
    ['gasolina', ['combustivel', 'posto', 'abastecimento', 'gas', 'alcool']],
    ['combustivel', ['gasolina', 'posto', 'abastecimento', 'gas', 'alcool', 'diesel']],
    ['posto', ['combustivel', 'gasolina', 'abastecimento']],
    ['abasteci', ['combustivel', 'gasolina', 'posto', 'abastecimento', 'abastecer']],
    ['abastecer', ['combustivel', 'gasolina', 'posto', 'abastecimento', 'abasteci']],
    ['uber', ['taxi', 'transporte', '99', 'corrida', 'app', 'mobilidade']],
    ['taxi', ['uber', '99', 'transporte', 'corrida']],
    ['corrida', ['uber', 'taxi', '99', 'transporte']],
    ['onibus', ['ônibus', 'transporte', 'passagem', 'coletivo']],
    ['pedagio', ['pedágio', 'estrada', 'rodovia']],
    ['estacionamento', ['parking', 'vaga', 'zona azul']],
    ['lavagem', ['lava-jato', 'lavar carro', 'lavacao']],

    // Saúde
    ['farmacia', ['remedio', 'medicamento', 'drogaria', 'saude', 'medicação']],
    ['remedio', ['medicamento', 'farmacia', 'drogaria', 'saude']],
    ['medicamento', ['remedio', 'farmacia', 'drogaria', 'saude']],
    ['medico', ['médico', 'consulta', 'doutor', 'saude']],
    ['consulta', ['medico', 'doutor', 'clinica', 'saude']],
    ['dentista', ['odontologia', 'dente', 'clinica']],
    ['exame', ['exames', 'laboratorio', 'clinica', 'saude']],
    ['fisioterapia', ['fisio', 'terapia', 'reabilitacao']],

    // Casa
    ['aluguel', ['moradia', 'casa', 'apartamento', 'imovel', 'locacao']],
    ['agua', ['conta', 'saneamento', 'abastecimento', 'copasa', 'sabesp']],
    ['luz', ['energia', 'eletricidade', 'conta', 'cemig']],
    ['gas', ['gás', 'botijao', 'botijão', 'cozinha']],
    ['internet', ['wifi', 'banda larga', 'provedor', 'net', 'vivo']],
    ['condominio', ['condomínio', 'taxa', 'sindico']],
    ['mobilia', ['móveis', 'movel', 'estante', 'sofa']],
    ['eletrodomestico', ['eletrodomésticos', 'geladeira', 'fogao', 'microondas']],

    // Serviços
    ['netflix', ['streaming', 'assinatura', 'filme', 'serie', 'prime']],
    ['spotify', ['musica', 'streaming', 'assinatura']],
    ['academia', ['gym', 'ginastica', 'treino', 'musculacao', 'fitness']],
    ['celular', ['telefone', 'recarga', 'conta', 'tim', 'claro', 'vivo']],

    // Educação
    ['escola', ['educacao', 'ensino', 'colegio', 'aula']],
    ['curso', ['cursos', 'educacao', 'aula', 'treinamento']],
    ['livro', ['livros', 'leitura', 'literatura', 'apostila']],
    ['material', ['material escolar', 'caderno', 'caneta', 'lapis']],

    // Lazer
    ['cinema', ['filme', 'sessao', 'ingresso', 'entertainment']],
    ['filme', ['cinema', 'sessao', 'netflix']],
    ['ontem', ['dia', 'anterior', 'passado']],
    ['anteontem', ['dia', 'anterior', 'passado', 'ontem']],
    ['semana', ['passada', 'anterior', 'ultima']],
    ['jogo', ['jogos', 'game', 'videogame', 'playstation', 'xbox']],

    // Receitas/Income
    ['salario', ['salário', 'vencimento', 'pagamento', 'recebi', 'recebimento']],
    ['salário', ['salario', 'vencimento', 'pagamento', 'recebi']],
    ['recebimentos', ['recebi', 'recebimento', 'entrada', 'receita', 'income']],
    ['recebi', ['recebimento', 'recebimentos', 'entrada', 'salario', 'salário']],
    ['recebimento', ['recebi', 'recebimentos', 'entrada', 'receita']],
    ['aluguel', ['aluguel recebido', 'locacao', 'locação', 'renda']],
    ['reembolso', ['devolucao', 'devolução', 'estorno', 'reembolso recebido']],
    ['freelance', ['freela', 'extra', 'bico', 'trabalho extra', 'servico']],
    ['brinquedo', ['brinquedos', 'crianca', 'criancas', 'toy']],
    ['parque', ['diversao', 'passeio', 'lazer']],
    ['festa', ['festas', 'aniversario', 'comemoracao', 'celebracao']],

    // Vestuário
    ['roupa', ['roupas', 'vestuario', 'vestuário', 'blusa', 'calca']],
    ['calcado', ['calçado', 'calcados', 'sapato', 'tenis', 'sandalia', 'calcados']],
    ['calçado', ['calcado', 'calcados', 'sapato', 'tenis', 'sandalia', 'calcados']],
    ['calcados', ['calçados', 'calcado', 'sapato', 'tenis', 'sandalia', 'sapatos']],
    ['calçados', ['calcados', 'calcado', 'sapato', 'tenis', 'sandalia', 'sapatos']],
    ['sapato', ['calcado', 'calcados', 'tenis', 'sandalia']],
    ['sapatos', ['calcado', 'calcados', 'tenis', 'sandalia', 'sapato']],
    ['tenis', ['tênis', 'calcado', 'sapato', 'nike', 'adidas']],

    // Pessoal
    ['cabelo', ['cabeleireiro', 'salao', 'salão', 'corte', 'barba']],
    ['manicure', ['unha', 'manicure', 'pedicure', 'esmalte']],
    ['presente', ['presentes', 'gift', 'mimo', 'lembranca', 'ganhei', 'ganho']],
    ['presentes', ['presente', 'gift', 'mimo', 'lembranca', 'ganhei', 'ganho']],
    ['ganhei', ['presente', 'presentes', 'recebi', 'gift', 'pai', 'mae', 'amigo']],
    ['ganho', ['presente', 'presentes', 'recebi', 'gift', 'ganhei']],
    ['pai', ['presente', 'ganhei', 'recebi', 'familia', 'parente']],
    ['mae', ['mãe', 'presente', 'ganhei', 'recebi', 'familia', 'parente']],

    // Delivery e Apps
    ['ifood', ['delivery', 'entrega', 'comida', 'pedido', 'rappi']],
    ['rappi', ['delivery', 'entrega', 'comida', 'pedido', 'ifood']],
    ['delivery', ['entrega', 'ifood', 'rappi', 'pedido']],

    // INCOMES
    ['salario', ['salário', 'remuneração', 'pagamento', 'provento']],
    ['receber', ['entrada', 'deposito', 'recebimento', 'credito', 'caiu']],
    ['freela', ['freelance', 'servico', 'bico', 'trabalho extra', 'extra']],
    ['freelance', ['freela', 'servico', 'bico', 'trabalho extra', 'extra']],
    ['vale', ['beneficio', 'vr', 'vt', 'vale-alimentacao', 'vale-refeicao', 'benefícios']],
    ['alimentacao', ['vale-alimentacao', 'vale-refeicao', 'vr']], // Quando tem "alimentacao", buscar vale
    ['vale-alimentacao', ['vale', 'alimentacao', 'vr', 'beneficio', 'benefícios']],
    ['vale-refeicao', ['vale', 'refeicao', 'vr', 'beneficio', 'benefícios']],
    ['beneficio', ['vale', 'vr', 'vt', 'benefícios', 'beneficios']],
    ['benefícios', ['vale', 'vr', 'vt', 'beneficio', 'beneficios']],
    ['beneficios', ['vale', 'vr', 'vt', 'beneficio', 'benefícios']],
    ['receita', ['entrada', 'deposito', 'recebimento', 'credito']],
    ['recebimento', ['entrada', 'deposito', 'receita', 'credito']],
    ['devolvido', ['reembolso', 'estornado', 'retorno']],
    ['reembolso', ['devolvido', 'estornado', 'retorno']],
    ['servico', ['freelance', 'bico', 'trabalho avulso']],
  ]);

  private readonly defaultConfig: RAGConfig = {
    minScore: 0.25, // Reduzido de 0.6 para permitir matches parciais válidos (ex: "restaurante" em frases longas)
    maxResults: 3,
    boostExactMatch: 2.0,
    boostStartsWith: 1.5,
  };

  /**
   * Indexa categorias do usuário no cache (Redis ou Map)
   */
  async indexUserCategories(userId: string, categories: UserCategory[]): Promise<void> {
    this.logger.log(`📚 Indexando ${categories.length} categorias para usuário ${userId}`);

    if (this.useRedisCache) {
      // Salvar no Redis com TTL de 24h
      const cacheKey = `rag:categories:${userId}`;
      await this.cacheManager.set(cacheKey, JSON.stringify(categories), this.cacheTTL * 1000);
      this.logger.debug(`✅ Categorias salvas no Redis: ${cacheKey}`);
    } else {
      // Fallback: Map em memória
      this.categoryCache.set(userId, categories);
      this.logger.debug(`⚠️ Categorias salvas no Map (temporário)`);
    }
  }

  /**
   * Busca categorias similares usando BM25
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> = {},
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    // Buscar categorias do cache (Redis ou Map)
    let categories: UserCategory[] = [];

    if (this.useRedisCache) {
      const cacheKey = `rag:categories:${userId}`;
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        categories = JSON.parse(cached);
        this.logger.debug(`✅ Categorias carregadas do Redis: ${categories.length} itens`);
      }
    } else {
      categories = this.categoryCache.get(userId) || [];
      this.logger.debug(`⚠️ Categorias carregadas do Map: ${categories.length} itens`);
    }

    if (categories.length === 0) {
      this.logger.warn(`⚠️ Nenhuma categoria indexada para usuário ${userId}`);
      return [];
    }

    // Normalizar texto de busca
    const normalizedQuery = this.normalize(text);
    const queryTokens = this.tokenize(normalizedQuery);

    this.logger.debug(`🔍 Buscando por: "${text}" → tokens: [${queryTokens.join(', ')}]`);

    // Calcular score para cada categoria
    const matches: CategoryMatch[] = [];

    for (const category of categories) {
      // Incluir nome da categoria e subcategoria no texto de busca
      const categoryText = `${category.name} ${category.subCategory?.name || ''}`;
      const normalizedCategory = this.normalize(categoryText);
      const categoryTokens = this.tokenize(normalizedCategory);

      // DEBUG: Log tokenização
      if (category.subCategory?.name) {
        this.logger.debug(
          `🔤 Tokenização "${category.name}" + "${category.subCategory.name}" → ` +
            `normalized: "${normalizedCategory}" → tokens: [${categoryTokens.join(', ')}]`,
        );
      }

      // Também tokenizar subcategoria separadamente para melhor matching
      const subCategoryTokens = category.subCategory?.name
        ? this.tokenize(this.normalize(category.subCategory.name))
        : [];

      // Calcular similaridade BM25
      let score = this.calculateBM25Score(queryTokens, categoryTokens);

      // Aplicar boosts
      if (normalizedQuery === normalizedCategory) {
        score *= finalConfig.boostExactMatch;
        this.logger.debug(
          `✅ Match exato: "${category.name}" (boost ${finalConfig.boostExactMatch}x)`,
        );
      } else if (normalizedCategory.startsWith(normalizedQuery)) {
        score *= finalConfig.boostStartsWith;
        this.logger.debug(
          `✅ Começa com: "${category.name}" (boost ${finalConfig.boostStartsWith}x)`,
        );
      }

      // Verificar sinônimos com categoria
      const synonymScore = this.checkSynonyms(queryTokens, categoryTokens);

      // DEBUG: Log score inicial (depois de calcular synonymScore)
      if (score > 0 || synonymScore > 0) {
        this.logger.debug(
          `📊 Score BM25 para "${category.name}": ${score.toFixed(3)} | ` +
            `Sinônimos: ${synonymScore.toFixed(3)} | ` +
            `Tokens query: [${queryTokens.join(', ')}] | ` +
            `Tokens doc: [${categoryTokens.join(', ')}]`,
        );
      }

      if (synonymScore > 0) {
        score += synonymScore * 0.5; // Sinônimos valem 50%
        this.logger.debug(
          `🔄 Sinônimos encontrados na categoria: +${(synonymScore * 0.5).toFixed(2)}`,
        );
      }

      // Verificar sinônimos com subcategoria (se existir)
      if (subCategoryTokens.length > 0) {
        const subCategorySynonymScore = this.checkSynonyms(queryTokens, subCategoryTokens);
        if (subCategorySynonymScore > 0) {
          score += subCategorySynonymScore * 2.0; // Subcategoria vale MUITO mais (200%) para priorizar
          this.logger.debug(
            `🔄 Sinônimos encontrados na subcategoria "${category.subCategory?.name}": +${(subCategorySynonymScore * 2.0).toFixed(2)}`,
          );
        }
      }

      // NÃO normalizar mais - score pode ser > 1 para priorizar melhor match

      if (score >= finalConfig.minScore) {
        matches.push({
          categoryId: category.id,
          categoryName: category.name,
          subCategoryId: category.subCategory?.id,
          subCategoryName: category.subCategory?.name,
          score,
          matchedTerms: this.findMatchedTerms(queryTokens, categoryTokens),
        });
      }
    }

    // Ordenar por score (maior primeiro)
    matches.sort((a, b) => b.score - a.score);

    // Limitar resultados
    const results = matches.slice(0, finalConfig.maxResults);
    const responseTime = Date.now() - startTime;

    this.logger.log(
      `✅ Encontradas ${results.length} categorias similares:` +
        results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
    );

    // Registrar tentativa para analytics (banco de dados)
    const success = results.length > 0 && results[0].score >= finalConfig.minScore;
    await this.recordSearchAttempt(
      userId,
      text,
      results,
      success,
      finalConfig.minScore,
      'BM25', // Por enquanto sempre BM25, depois terá AI
      responseTime,
    );

    return results;
  }

  /**
   * Busca categorias similares usando embeddings de IA (busca vetorial)
   * Usa similaridade de cosseno entre embeddings
   */
  async findSimilarCategoriesWithEmbeddings(
    text: string,
    userId: string,
    aiProvider: any, // IAIProvider com método generateEmbedding
    config: Partial<RAGConfig> = {},
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    try {
      // Buscar categorias do cache
      let categories: UserCategory[] = [];

      if (this.useRedisCache) {
        const cacheKey = `rag:categories:${userId}`;
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) {
          categories = JSON.parse(cached);
        }
      } else {
        categories = this.categoryCache.get(userId) || [];
      }

      if (categories.length === 0) {
        this.logger.warn(`⚠️ Nenhuma categoria indexada para usuário ${userId}`);
        return [];
      }

      // Gerar embedding da query
      this.logger.debug(`🔍 [AI] Gerando embedding para: "${text}"`);
      const queryEmbedding = await aiProvider.generateEmbedding(text);

      // Calcular similaridade com cada categoria
      const matches: CategoryMatch[] = [];

      for (const category of categories) {
        if (!category.embedding) {
          this.logger.debug(
            `⚠️ Categoria "${category.name}" sem embedding - pulando busca vetorial`,
          );
          continue;
        }

        // Similaridade de cosseno
        const score = this.cosineSimilarity(queryEmbedding, category.embedding);

        if (score >= finalConfig.minScore) {
          matches.push({
            categoryId: category.id,
            categoryName: category.name,
            subCategoryId: category.subCategory?.id,
            subCategoryName: category.subCategory?.name,
            score,
            matchedTerms: ['[embedding match]'], // Não há termos específicos em busca vetorial
          });
        }
      }

      // Ordenar por score
      matches.sort((a, b) => b.score - a.score);
      const results = matches.slice(0, finalConfig.maxResults);
      const responseTime = Date.now() - startTime;

      this.logger.log(
        `✅ [AI] Encontradas ${results.length} categorias similares em ${responseTime}ms:` +
          results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
      );

      // Registrar tentativa no banco
      const success = results.length > 0 && results[0].score >= finalConfig.minScore;
      await this.recordSearchAttempt(
        userId,
        text,
        results,
        success,
        finalConfig.minScore,
        'AI', // Modo AI (embeddings)
        responseTime,
      );

      return results;
    } catch (error) {
      this.logger.error('Erro na busca vetorial com IA:', error);
      // Fallback para BM25
      this.logger.warn('⚠️ Fallback para BM25...');
      return this.findSimilarCategories(text, userId, config);
    }
  }

  /**
   * Calcula similaridade de cosseno entre dois vetores
   * Retorna valor entre 0 e 1 (1 = idênticos)
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(
        `Vetores com dimensões diferentes: ${vecA.length} vs ${vecB.length}`,
      );
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Limpa cache de categorias (útil para testes)
   */
  async clearCache(userId?: string): Promise<void> {
    if (this.useRedisCache) {
      if (userId) {
        const cacheKey = `rag:categories:${userId}`;
        await this.cacheManager.del(cacheKey);
        this.logger.debug(`🗑️ Cache Redis limpo para usuário ${userId}`);
      } else {
        // Limpar todos os caches RAG (buscar todas as chaves rag:*)
        this.logger.warn(
          `⚠️ Não há forma genérica de limpar todos caches Redis. Use admin endpoint.`,
        );
      }
    } else {
      if (userId) {
        this.categoryCache.delete(userId);
        this.logger.debug(`🗑️ Cache Map limpo para usuário ${userId}`);
      } else {
        this.categoryCache.clear();
        this.logger.debug(`🗑️ Todo cache Map limpo`);
      }
    }
  }

  /**
   * Registra tentativa de busca para analytics
   */
  private async recordSearchAttempt(
    userId: string,
    query: string,
    matches: CategoryMatch[],
    success: boolean,
    threshold: number,
    ragMode: string,
    responseTime: number,
  ): Promise<void> {
    try {
      // Salvar no banco de dados
      await this.prisma.rAGSearchLog.create({
        data: {
          userId,
          query,
          queryNormalized: this.normalize(query),
          matches: matches as any,
          bestMatch: matches.length > 0 ? matches[0].categoryName : null,
          bestScore: matches.length > 0 ? matches[0].score : null,
          threshold,
          success,
          ragMode,
          responseTime,
        },
      });

      this.logger.debug(`📊 RAG log salvo: userId=${userId}, query="${query}", success=${success}`);
    } catch (error) {
      // Não lançar erro - logging não deve quebrar fluxo
      this.logger.warn(`Erro ao salvar log RAG:`, error);
    }
  }

  /**
   * Retorna tentativas de busca para analytics
   * Útil para identificar queries que não deram match
   */
  async getSearchAttempts(
    userId?: string,
    failedOnly: boolean = false,
  ): Promise<
    Array<{
      id: string;
      userId: string;
      query: string;
      bestMatch: string | null;
      bestScore: number | null;
      success: boolean;
      createdAt: Date;
    }>
  > {
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (failedOnly) {
      where.success = false;
    }

    const logs = await this.prisma.rAGSearchLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100, // Últimas 100 tentativas
      select: {
        id: true,
        userId: true,
        query: true,
        bestMatch: true,
        bestScore: true,
        success: true,
        createdAt: true,
      },
    });

    return logs.map((log) => ({
      ...log,
      bestScore: log.bestScore ? Number(log.bestScore) : null,
    }));
  }

  /**
   * Normaliza texto: lowercase, remove acentos, trim
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ') // Remove pontuação
      .trim();
  }

  /**
   * Tokeniza texto em palavras
   */
  private tokenize(text: string): string[] {
    return text.split(/\s+/).filter((token) => token.length > 2); // Ignora tokens muito curtos
  }

  /**
   * Calcula score BM25 simplificado
   *
   * BM25 = Σ(IDF * TF * boost)
   * - TF (Term Frequency): quantas vezes o termo aparece
   * - IDF (Inverse Document Frequency): raridade do termo
   * - boost: relevância baseada em posição/contexto
   *
   * MODIFICAÇÃO: Não divide por queryTokens.length para não penalizar frases longas
   * Score final varia de 0 a número de matches
   */
  private calculateBM25Score(queryTokens: string[], docTokens: string[]): number {
    let score = 0;
    const docLength = docTokens.length;
    const avgDocLength = 3; // Média de tokens em categorias (estimativa)
    const k1 = 1.2; // Parâmetro BM25
    const b = 0.75; // Parâmetro BM25

    for (const queryToken of queryTokens) {
      // Term Frequency (TF)
      const tf = docTokens.filter((t) => t === queryToken).length;

      if (tf > 0) {
        // IDF simplificado (assumindo corpus pequeno)
        const idf = 1.0;

        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

        score += idf * (numerator / denominator);
      }
    }

    // NÃO dividir por queryTokens.length - permite frases longas terem score decente
    return score;
  }

  /**
   * Verifica se há sinônimos entre query e documento
   * Retorna número de matches de sinônimos (não normalizado)
   */
  private checkSynonyms(queryTokens: string[], docTokens: string[]): number {
    let synonymMatches = 0;

    for (const queryToken of queryTokens) {
      const synonyms = this.synonyms.get(queryToken) || [];

      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          synonymMatches++;
        }

        // Verificar sinônimos reversos (docToken → queryToken)
        const reverseSynonyms = this.synonyms.get(docToken) || [];
        if (reverseSynonyms.includes(queryToken)) {
          synonymMatches++;
        }
      }
    }

    // NÃO dividir por queryTokens.length - permite frases longas terem score decente
    return synonymMatches;
  }

  /**
   * Encontra termos que deram match
   */
  private findMatchedTerms(queryTokens: string[], docTokens: string[]): string[] {
    const matched: string[] = [];

    for (const queryToken of queryTokens) {
      if (docTokens.includes(queryToken)) {
        matched.push(queryToken);
      }

      // Verificar sinônimos
      const synonyms = this.synonyms.get(queryToken) || [];
      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          matched.push(`${queryToken}→${docToken}`);
        }
      }
    }

    return matched;
  }
}
