import { Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { RAGService } from './rag.service';

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
    if (
      hasOthersCategory &&
      (normalizedResponse === '1' ||
        normalizedResponse.includes('sim') ||
        normalizedResponse.includes('confirma'))
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

      await this.clearContext(phoneNumber);

      return {
        processed: true,
        action: 'confirmed',
        message,
        shouldContinue: true, // Processar transação original
      };
    }

    // OPÇÃO 2 ou 1: REJEITAR/CORRIGIR
    // Se tem "Outros": opção 2 = Corrigir
    // Se NÃO tem "Outros": opção 1 = Corrigir
    const isRejectOption = hasOthersCategory
      ? normalizedResponse === '2'
      : normalizedResponse === '1';

    if (
      isRejectOption ||
      normalizedResponse.includes('não') ||
      normalizedResponse.includes('nao') ||
      normalizedResponse.includes('corrig')
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
    const isCancelOption = hasOthersCategory
      ? normalizedResponse === '3'
      : normalizedResponse === '2';

    if (isCancelOption || normalizedResponse.includes('cancel')) {
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
   * Exemplo: "Alimentação > Delivery"
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
  }> {
    const context = await this.getContext(phoneNumber);

    if (!context) {
      return {
        success: false,
        message: '⚠️ Contexto de correção expirou. Por favor, envie a transação novamente.',
      };
    }

    try {
      // Parsear correção (ex: "Alimentação > Delivery" ou só "Delivery")
      const parts = correctionText.split('>').map((p) => p.trim());

      let categoryName: string;
      let subcategoryName: string | undefined;

      if (parts.length === 2) {
        categoryName = parts[0];
        subcategoryName = parts[1];
      } else if (parts.length === 1) {
        // Só subcategoria - usar categoria da sugestão original
        categoryName = context.suggestedCategory;
        subcategoryName = parts[0];
      } else {
        return {
          success: false,
          message:
            `⚠️ Formato inválido.\n\n` +
            `Use: "Categoria > Subcategoria"\n` +
            `Ou só: "Subcategoria"`,
        };
      }

      // Buscar categoria/subcategoria nas disponíveis do usuário
      const category = userCategories.find(
        (cat) => cat.name.toLowerCase() === categoryName.toLowerCase(),
      );

      if (!category) {
        return {
          success: false,
          message:
            `❌ Categoria "${categoryName}" não encontrada.\n\n` +
            `Categorias disponíveis:\n` +
            userCategories.map((c) => `• ${c.name}`).join('\n'),
        };
      }

      const subcategory = category.subCategories?.find(
        (sub) => sub.name.toLowerCase() === subcategoryName.toLowerCase(),
      );

      if (subcategoryName && !subcategory) {
        const availableSubs = category.subCategories?.map((s) => s.name).join(', ') || 'nenhuma';
        return {
          success: false,
          message:
            `❌ Subcategoria "${subcategoryName}" não encontrada em "${categoryName}".\n\n` +
            `Subcategorias disponíveis: ${availableSubs}`,
        };
      }

      // Salvar correção com alta confiança
      await this.ragService.rejectAndCorrect({
        userId,
        originalTerm: context.detectedTerm,
        rejectedCategoryId: context.suggestedCategoryId,
        rejectedCategoryName: context.suggestedCategory,
        correctCategoryId: category.id,
        correctCategoryName: category.name,
        correctSubcategoryId: subcategory?.id,
        correctSubcategoryName: subcategory?.name,
      });

      await this.clearContext(phoneNumber);

      return {
        success: true,
        message:
          `✅ *Correção aprendida!*\n\n` +
          `"${context.detectedTerm}" agora será categorizado como:\n` +
          `📂 ${category.name}${subcategory ? ' > ' + subcategory.name : ''}\n\n` +
          `Agora vou registrar sua transação... ⏳`,
        shouldContinue: true, // Processar transação original
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
    // Remove palavras comuns e números
    const stopWords = [
      'comprei',
      'paguei',
      'gastei',
      'recebi',
      'ganhei',
      'um',
      'uma',
      'por',
      'de',
      'da',
      'do',
      'na',
      'no',
      'em',
    ];
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopWords.includes(t) && isNaN(Number(t)));

    return tokens[0] || null;
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
