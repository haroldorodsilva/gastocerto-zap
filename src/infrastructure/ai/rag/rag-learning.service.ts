import { Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { RAGService } from './rag.service';
import { FILTER_WORDS_FOR_TERM_DETECTION } from '@common/constants/nlp-keywords.constants';

/**
 * RAGLearningService
 *
 * Gerencia o fluxo de aprendizado inteligente do RAG:
 * 1. Detecta termos desconhecidos
 * 2. Mantém contexto de confirmação pendente
 * 3. Processa resposta do usuário (confirma/rejeita)
 * 4. Integra com RAGService para salvar sinônimos
 *
 * USO:
 * - No fluxo de registro de transação
 * - Quando IA extrai categoria/subcategoria
 * - Antes de criar confirmação
 */
@Injectable()
export class RAGLearningService {
  private readonly logger = new Logger(RAGLearningService.name);
  private readonly contextTTL = 300; // 5 minutos

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly ragService: RAGService,
  ) {}

  /**
   * Detecta se mensagem contém termo desconhecido e precisa confirmação
   *
   * @returns null se termo é conhecido, ou objeto com sugestão se desconhecido
   */
  async detectAndPrepareConfirmation(
    text: string,
    userId: string,
    phoneNumber: string,
    extractedData?: any,
  ): Promise<{
    needsConfirmation: boolean;
    message?: string;
    context?: any;
  }> {
    try {
      this.logger.debug(
        `🎓 [RAGLearningService] Iniciando detecção para userId=${userId}, text="${text}"`,
      );

      // 1. Detectar termo desconhecido
      const detection = await this.ragService.detectUnknownTerm(text, userId);

      this.logger.debug(
        `🎓 [RAGLearningService] detectUnknownTerm retornou: ${detection ? JSON.stringify(detection) : 'null'}`,
      );

      // 2. Se RAG não detectou, verificar se AI retornou categoria genérica
      if (!detection && extractedData) {
        const category = extractedData.category || '';
        const subCategory = extractedData.subCategory || '';
        const isGenericCategory = category === 'Outros' || category === 'Geral';
        const isGenericSubcategory =
          !subCategory || subCategory === 'Outros' || subCategory === 'Geral';

        this.logger.debug(
          `🎓 [RAGLearningService] Verificando AI: category="${category}", subCategory="${subCategory}" | ` +
            `isGeneric: ${isGenericCategory || isGenericSubcategory}`,
        );

        if (isGenericCategory || isGenericSubcategory) {
          this.logger.log(
            `🎓 [RAGLearningService] AI retornou categoria genérica → trigger learning flow`,
          );

          // Criar detecção artificial para categoria genérica
          const detectedTerm = this.extractMainTerm(text);
          if (detectedTerm) {
            return this.prepareGenericCategoryLearning(
              detectedTerm,
              text,
              phoneNumber,
              extractedData,
            );
          }
        }
      }

      if (!detection) {
        this.logger.debug(
          `🎓 [RAGLearningService] Nenhum termo desconhecido detectado (detection=null)`,
        );
        return { needsConfirmation: false };
      }

      // Se é subcategoria conhecida, não precisa confirmação
      if (detection.isKnownSubcategory) {
        this.logger.debug(
          `✅ Subcategoria conhecida: "${detection.detectedTerm}" → ` +
            `${detection.suggestedCategory} > ${detection.suggestedSubcategory}`,
        );
        return { needsConfirmation: false };
      }

      this.logger.log(
        `🎓 [RAGLearningService] Termo desconhecido detectado: "${detection.detectedTerm}" | ` +
          `Razão: ${detection.reason} | Confiança: ${(detection.confidence * 100).toFixed(1)}%`,
      );

      // 2. Verificar se já tem sinônimo aprendido
      const existingSynonym = await this.ragService.hasUserSynonym(userId, detection.detectedTerm);

      if (existingSynonym.hasSynonym) {
        this.logger.log(
          `✅ Sinônimo já conhecido: "${detection.detectedTerm}" → ` +
            `${existingSynonym.categoryName} > ${existingSynonym.subCategoryName}`,
        );
        return { needsConfirmation: false };
      }

      // 3. Termo desconhecido - preparar confirmação
      this.logger.log(
        `🎓 [RAGLearningService] Preparando confirmação de aprendizado para termo "${detection.detectedTerm}"`,
      );

      const context = {
        detectedTerm: detection.detectedTerm,
        suggestedCategoryId: detection.suggestedCategoryId,
        suggestedCategory: detection.suggestedCategory,
        suggestedSubcategoryId: detection.suggestedSubcategoryId,
        suggestedSubcategory: detection.suggestedSubcategory,
        originalText: text,
        confidence: detection.confidence,
        timestamp: Date.now(),
      };

      // Salvar contexto
      await this.saveContext(phoneNumber, context);

      const message = this.buildConfirmationMessage(detection);

      this.logger.log(`🎓 [RAGLearningService] Confirmação preparada com sucesso!`);

      return {
        needsConfirmation: true,
        message,
        context,
      };
    } catch (error) {
      this.logger.error('Erro ao detectar termo desconhecido:', error);
      return { needsConfirmation: false };
    }
  }

  /**
   * Constrói mensagem de confirmação amigável
   */
  private buildConfirmationMessage(detection: any): string {
    return (
      `🤔 Detectei o termo *"${detection.detectedTerm}"*\n\n` +
      `Sugiro categorizar como:\n` +
      `📂 *${detection.suggestedCategory}* > *${detection.suggestedSubcategory}*\n\n` +
      `Isso está correto?\n\n` +
      `1️⃣ Sim, confirmar\n` +
      `2️⃣ Não, escolher outra categoria\n` +
      `3️⃣ Cancelar`
    );
  }

  /**
   * Processa resposta do usuário à confirmação
   *
   * @returns true se processou, false se não há contexto pendente
   */
  async processResponse(
    phoneNumber: string,
    response: string,
    userId: string,
  ): Promise<{
    processed: boolean;
    action?: 'confirmed' | 'rejected' | 'cancelled';
    message?: string;
    shouldContinue?: boolean; // Se deve continuar com registro original
    originalText?: string; // Texto original para processar transação
  }> {
    const context = await this.getContext(phoneNumber);

    if (!context) {
      return { processed: false };
    }

    // Normalizar resposta
    const normalizedResponse = response.toLowerCase().trim();

    // Verificar se usuário tem categoria "Outros" disponível
    const hasOthersCategory = context.hasOutrosCategory !== false;

    // OPÇÃO 1: CONFIRMAR (apenas se hasOthersCategory = true)
    // Aceita: 1, sim, confirmar, continuar, ok
    if (
      hasOthersCategory &&
      (normalizedResponse === '1' ||
        normalizedResponse.includes('sim') ||
        normalizedResponse.includes('confirma') ||
        normalizedResponse.includes('continu') ||
        normalizedResponse.includes('ok'))
    ) {
      // ⚠️ NÃO salvar sinônimo se for categoria genérica (Outros/Geral)
      const isGenericCategory =
        context.suggestedCategory === 'Outros' || context.suggestedCategory === 'Geral';
      const isGenericSubcategory =
        !context.suggestedSubcategory ||
        context.suggestedSubcategory === 'Outros' ||
        context.suggestedSubcategory === 'Geral';

      let message: string;

      if (isGenericCategory || isGenericSubcategory) {
        // Categoria genérica - não aprender
        this.logger.log(
          `🎓 [RAGLearningService] Confirmação de categoria genérica - NÃO salvando sinônimo`,
        );
        message =
          `✅ *Ok!*\n\n` +
          `Vou usar a categoria "${context.suggestedCategory}" para esta transação.\n\n` +
          `💡 *Dica:* Se quiser que eu aprenda uma categoria específica para "${context.detectedTerm}", ` +
          `escolha a opção "Corrigir" na próxima vez.\n\n` +
          `Agora vou registrar sua transação... ⏳`;
      } else {
        // Categoria específica - aprender
        await this.ragService.confirmAndLearn({
          userId,
          originalTerm: context.detectedTerm,
          confirmedCategoryId: context.suggestedCategoryId,
          confirmedCategoryName: context.suggestedCategory,
          confirmedSubcategoryId: context.suggestedSubcategoryId,
          confirmedSubcategoryName: context.suggestedSubcategory,
        });

        this.logger.log(
          `🎓 [RAGLearningService] Sinônimo salvo: "${context.detectedTerm}" → ${context.suggestedCategory} > ${context.suggestedSubcategory}`,
        );

        message =
          `✅ *Aprendido!*\n\n` +
          `Da próxima vez que você mencionar *"${context.detectedTerm}"*, ` +
          `vou categorizar automaticamente como:\n` +
          `📂 ${context.suggestedCategory} > ${context.suggestedSubcategory}\n\n` +
          `Agora vou registrar sua transação... ⏳`;
      }

      // ⚠️ Salvar originalText ANTES de limpar contexto
      const originalText = context.originalText;

      await this.clearContext(phoneNumber);

      return {
        processed: true,
        action: 'confirmed',
        message,
        shouldContinue: true, // Processar transação original
        originalText, // Retornar para processamento
      };
    }

    // OPÇÃO 2 ou 1: REJEITAR/CORRIGIR
    // Se tem "Outros": opção 2 = Corrigir
    // Se NÃO tem "Outros": opção 1 = Corrigir
    // Aceita: 2/1, corrigir, alterar, ajustar, mudar
    // ⚠️ REMOVIDO "não/nao" pois é ambíguo - usuário pode querer cancelar
    const isRejectOption = hasOthersCategory
      ? normalizedResponse === '2'
      : normalizedResponse === '1';

    if (
      isRejectOption ||
      normalizedResponse.includes('corrig') ||
      normalizedResponse.includes('alterar') ||
      normalizedResponse.includes('ajustar') ||
      normalizedResponse.includes('mudar')
    ) {
      return {
        processed: true,
        action: 'rejected',
        message:
          `🔄 *Vamos corrigir!*\n\n` +
          `Por favor, me diga qual é a categoria correta.\n\n` +
          `Exemplos:\n` +
          `• "Alimentação > Delivery"\n` +
          `• "Alimentação > Marmita" (se existir)\n` +
          `• "Restaurante"\n\n` +
          `Ou digite *"cancelar"* para desistir.`,
        shouldContinue: false, // Aguardar correção
      };
    }

    // OPÇÃO 3 ou 2: CANCELAR
    // Se tem "Outros": opção 3 = Cancelar
    // Se NÃO tem "Outros": opção 2 = Cancelar
    // Aceita: 3/2, não, nao, cancelar, desistir, não quero
    const isCancelOption = hasOthersCategory
      ? normalizedResponse === '3'
      : normalizedResponse === '2';

    if (
      isCancelOption ||
      normalizedResponse === 'não' ||
      normalizedResponse === 'nao' ||
      normalizedResponse.includes('cancel') ||
      normalizedResponse.includes('desist') ||
      (normalizedResponse.includes('não') && normalizedResponse.includes('quer')) ||
      (normalizedResponse.includes('nao') && normalizedResponse.includes('quer'))
    ) {
      await this.clearContext(phoneNumber);

      return {
        processed: true,
        action: 'cancelled',
        message: `❌ Operação cancelada. Pode enviar uma nova transação quando quiser!`,
        shouldContinue: false,
      };
    }

    // Resposta não reconhecida
    return {
      processed: false,
    };
  }

  /**
   * Processa correção manual do usuário
   * Exemplo: "Alimentação > Delivery" ou "eletronicos" (busca fuzzy)
   */
  async processCorrection(
    phoneNumber: string,
    correctionText: string,
    userId: string,
    userCategories: any[], // Lista de categorias disponíveis
  ): Promise<{
    success: boolean;
    message?: string;
    shouldContinue?: boolean;
    needsSelection?: boolean; // Se true, aguarda seleção numérica do usuário
    matches?: Array<{ category: any; subcategory?: any }>; // Opções encontradas
    originalText?: string; // Texto original da transação para reprocessar
  }> {
    const context = await this.getContext(phoneNumber);

    if (!context) {
      return {
        success: false,
        message: '⚠️ Contexto de correção expirou. Por favor, envie a transação novamente.',
      };
    }

    try {
      // Verifica se é uma seleção numérica de opções anteriores
      if (context.pendingMatches && /^\d+$/.test(correctionText.trim())) {
        const selection = parseInt(correctionText.trim()) - 1;
        const matches = context.pendingMatches;

        if (selection >= 0 && selection < matches.length) {
          const selected = matches[selection];
          const originalText = context.originalText; // Salvar antes de limpar

          // Salvar correção
          await this.ragService.rejectAndCorrect({
            userId,
            originalTerm: context.detectedTerm,
            rejectedCategoryId: context.suggestedCategoryId,
            rejectedCategoryName: context.suggestedCategory,
            correctCategoryId: selected.category.id,
            correctCategoryName: selected.category.name,
            correctSubcategoryId: selected.subcategory?.id,
            correctSubcategoryName: selected.subcategory?.name,
          });

          await this.clearContext(phoneNumber);

          return {
            success: true,
            message:
              `✅ *Correção aprendida!*\n\n` +
              `"${context.detectedTerm}" agora será categorizado como:\n` +
              `📂 ${selected.category.name}${selected.subcategory ? ' > ' + selected.subcategory.name : ''}\n\n` +
              `Agora vou registrar sua transação... ⏳`,
            shouldContinue: true,
            originalText, // Retornar texto original
          };
        } else {
          return {
            success: false,
            message: `⚠️ Opção inválida. Digite um número entre 1 e ${matches.length}.`,
          };
        }
      }

      // Parsear correção (ex: "Alimentação > Delivery" ou só "eletronicos")
      const parts = correctionText.split('>').map((p) => p.trim());
      const searchTerm = parts.length === 2 ? parts : [correctionText.trim()];
      const normalizedSearch = searchTerm[0]
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      // Buscar em categorias e subcategorias
      const matches: Array<{ category: any; subcategory?: any; score: number }> = [];

      for (const category of userCategories) {
        const normalizedCatName = category.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        // Match na categoria
        if (
          normalizedCatName.includes(normalizedSearch) ||
          normalizedSearch.includes(normalizedCatName)
        ) {
          matches.push({
            category,
            score: this.calculateSimilarity(normalizedSearch, normalizedCatName),
          });
        }

        // Match nas subcategorias
        if (category.subCategories) {
          for (const subcategory of category.subCategories) {
            const normalizedSubName = subcategory.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');

            if (
              normalizedSubName.includes(normalizedSearch) ||
              normalizedSearch.includes(normalizedSubName)
            ) {
              matches.push({
                category,
                subcategory,
                score: this.calculateSimilarity(normalizedSearch, normalizedSubName),
              });
            }
          }
        }
      }

      // Ordenar por score (melhor match primeiro)
      matches.sort((a, b) => b.score - a.score);

      if (matches.length === 0) {
        return {
          success: false,
          message:
            `❌ Nenhuma categoria ou subcategoria encontrada para "${correctionText}".\n\n` +
            `Categorias disponíveis:\n` +
            userCategories.map((c) => `• ${c.name}`).join('\n') +
            `\n\nOu digite *"cancelar"* para desistir.`,
        };
      }

      // Se encontrou apenas 1 match, usar diretamente
      if (matches.length === 1) {
        const match = matches[0];
        const originalText = context.originalText; // Salvar antes de limpar
        
        await this.ragService.rejectAndCorrect({
          userId,
          originalTerm: context.detectedTerm,
          rejectedCategoryId: context.suggestedCategoryId,
          rejectedCategoryName: context.suggestedCategory,
          correctCategoryId: match.category.id,
          correctCategoryName: match.category.name,
          correctSubcategoryId: match.subcategory?.id,
          correctSubcategoryName: match.subcategory?.name,
        });

        await this.clearContext(phoneNumber);

        return {
          success: true,
          message:
            `✅ *Correção aprendida!*\n\n` +
            `"${context.detectedTerm}" agora será categorizado como:\n` +
            `📂 ${match.category.name}${match.subcategory ? ' > ' + match.subcategory.name : ''}\n\n` +
            `Agora vou registrar sua transação... ⏳`,
          shouldContinue: true,
          originalText, // Retornar texto original
        };
      }

      // Se encontrou múltiplos matches, mostrar opções
      const limitedMatches = matches.slice(0, 5); // Limitar a 5 opções

      // Salvar matches no contexto para próxima mensagem
      await this.saveContext(phoneNumber, {
        ...context,
        pendingMatches: limitedMatches,
      });

      const optionsText = limitedMatches
        .map((match, index) => {
          const label = match.subcategory
            ? `${match.category.name} > ${match.subcategory.name}`
            : match.category.name;
          return `${index + 1}️⃣ ${label}`;
        })
        .join('\n');

      return {
        success: false,
        needsSelection: true,
        matches: limitedMatches,
        message:
          `🔍 Encontrei ${limitedMatches.length} opções para "${correctionText}":\n\n` +
          `${optionsText}\n\n` +
          `Digite o número da opção correta (1-${limitedMatches.length})\n` +
          `Ou digite *"cancelar"* para desistir.`,
      };
    } catch (error) {
      this.logger.error('Erro ao processar correção:', error);
      return {
        success: false,
        message: '❌ Erro ao processar correção. Tente novamente.',
      };
    }
  }

  /**
   * Calcula similaridade entre duas strings (0 a 1)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    // Se uma string contém a outra completamente, score alto
    if (str1.includes(str2) || str2.includes(str1)) {
      return 0.9;
    }

    // Levenshtein distance simplificado
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calcula distância de Levenshtein
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Verifica se há contexto pendente de aprendizado
   */
  async hasPendingContext(phoneNumber: string): Promise<boolean> {
    const context = await this.getContext(phoneNumber);
    return context !== null;
  }

  /**
   * Extrai o termo principal de uma frase (substantivo principal)
   */
  private extractMainTerm(text: string): string | null {
    this.logger.debug(`🔍 [extractMainTerm] Input text: "${text}"`);

    // Tokenizar texto
    const allTokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 0);

    this.logger.debug(`🔍 [extractMainTerm] All tokens: [${allTokens.join(', ')}]`);

    // Filtrar usando constante centralizada (remove temporais + verbos + números)
    const filteredTokens = allTokens.filter(
      (t) =>
        t.length > 2 &&
        !FILTER_WORDS_FOR_TERM_DETECTION.includes(t) &&
        isNaN(Number(t)) &&
        // Stopwords adicionais
        !['um', 'uma', 'por', 'de', 'da', 'do', 'na', 'no', 'em'].includes(t),
    );

    this.logger.debug(
      `🔍 [extractMainTerm] Filtered tokens: [${filteredTokens.join(', ')}] ` +
        `(removed: ${allTokens.filter((t) => !filteredTokens.includes(t)).join(', ')})`,
    );

    const result = filteredTokens[0] || null;
    this.logger.debug(`🔍 [extractMainTerm] Result: "${result}"`);

    return result;
  }

  /**
   * Prepara contexto de aprendizado para categoria genérica (AI retornou "Outros")
   */
  private async prepareGenericCategoryLearning(
    detectedTerm: string,
    text: string,
    phoneNumber: string,
    extractedData: any,
  ): Promise<{
    needsConfirmation: boolean;
    message?: string;
    context?: any;
  }> {
    this.logger.log(
      `🎓 [RAGLearningService] Preparando aprendizado para termo "${detectedTerm}" (categoria genérica da AI)`,
    );

    // Verificar se usuário tem categoria "Outros" disponível
    const hasOutrosCategory =
      extractedData.categoryId !== null && extractedData.categoryId !== undefined;

    const context = {
      detectedTerm,
      suggestedCategory: extractedData.category || 'Outros',
      suggestedCategoryId: extractedData.categoryId || null,
      suggestedSubcategory: extractedData.subCategory || null,
      suggestedSubcategoryId: extractedData.subCategoryId || null,
      originalText: text,
      confidence: extractedData.confidence || 0.5,
      timestamp: Date.now(),
      hasOutrosCategory, // Indica se "Outros" está disponível
    };

    await this.saveContext(phoneNumber, context);

    let message: string;

    if (hasOutrosCategory) {
      // Usuário TEM "Outros" - mostrar 3 opções
      message =
        `🤔 *Termo Desconhecido Detectado*\n\n` +
        `Identifiquei "${detectedTerm}" mas não tenho certeza da categoria.\n\n` +
        `*O que você quer fazer?*\n\n` +
        `1️⃣ *Continuar* - Usar categoria sugerida (${context.suggestedCategory})\n` +
        `2️⃣ *Corrigir* - Escolher outra categoria\n` +
        `3️⃣ *Cancelar* - Não registrar\n\n` +
        `Digite o número da opção (1, 2 ou 3)`;
    } else {
      // Usuário NÃO TEM "Outros" - mostrar apenas 2 opções
      this.logger.warn(
        `⚠️ [RAGLearningService] Usuário não tem categoria "Outros" - oferecendo apenas Corrigir/Cancelar`,
      );
      message =
        `🤔 *Termo Desconhecido Detectado*\n\n` +
        `Identifiquei "${detectedTerm}" mas não tenho certeza da categoria.\n` +
        `Como você não tem a categoria "Outros" disponível, preciso que escolha uma categoria específica.\n\n` +
        `*O que você quer fazer?*\n\n` +
        `1️⃣ *Corrigir* - Escolher a categoria correta\n` +
        `2️⃣ *Cancelar* - Não registrar esta transação\n\n` +
        `Digite o número da opção (1 ou 2)`;
    }

    return {
      needsConfirmation: true,
      message,
      context,
    };
  }

  /**
   * Salva contexto de aprendizado no cache
   */
  private async saveContext(phoneNumber: string, context: any): Promise<void> {
    const key = `rag:learning:${phoneNumber}`;
    await this.cacheManager.set(key, JSON.stringify(context), this.contextTTL * 1000);
    this.logger.debug(`💾 Contexto salvo para ${phoneNumber}`);
  }

  /**
   * Busca contexto de aprendizado do cache
   */
  async getContext(phoneNumber: string): Promise<any | null> {
    const key = `rag:learning:${phoneNumber}`;
    const cached = await this.cacheManager.get<string>(key);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  /**
   * Limpa contexto de aprendizado
   */
  async clearContext(phoneNumber: string): Promise<void> {
    const key = `rag:learning:${phoneNumber}`;
    await this.cacheManager.del(key);
    this.logger.debug(`🗑️ Contexto limpo para ${phoneNumber}`);
  }
}
