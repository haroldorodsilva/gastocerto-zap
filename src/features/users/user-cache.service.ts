import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { UserCache } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import { RedisService } from '@common/services/redis.service';

/**
 * Expande categorias com subcategorias para indexação no RAG
 * Cada subcategoria vira uma entrada separada
 */
export function expandCategoriesForRAG(categories: any[]): any[] {
  const userCategories: any[] = [];

  categories.forEach((cat) => {
    const categoryId = cat.id || cat.categoryId;
    const categoryName = cat.name || cat.categoryName;
    const subCategories = cat.subCategories || [];

    if (subCategories.length > 0) {
      // Criar uma entrada para cada subcategoria
      subCategories.forEach((sub: any) => {
        userCategories.push({
          id: categoryId,
          name: categoryName,
          accountId: cat.accountId,
          type: cat.type,
          subCategory: {
            id: sub.id || sub.subCategoryId,
            name: sub.name || sub.subCategoryName,
          },
        });
      });
    } else {
      // Categoria sem subcategoria
      userCategories.push({
        id: categoryId,
        name: categoryName,
        accountId: cat.accountId,
        type: cat.type,
        subCategory: undefined,
      });
    }
  });

  return userCategories;
}

@Injectable()
export class UserCacheService {
  private readonly logger = new Logger(UserCacheService.name);
  private readonly CACHE_TTL = 3600; // 1 hora em segundos

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly redisService: RedisService,
    @Optional() private readonly ragService?: RAGService,
    @Optional() private readonly aiConfigService?: AIConfigService,
  ) {
    this.logger.log('✅ UserCacheService inicializado');
  }

  /**
   * Helper: Retorna a chave universal do cache Redis
   * Cache usa gastoCertoId como chave única, independente da plataforma
   */
  private getCacheKey(gastoCertoId: string): string {
    return `user:${gastoCertoId}`;
  }

  /**
   * Busca usuário por gastoCertoId (chave primária real)
   * Método preferido para uso interno
   */
  async getUserByGastoCertoId(gastoCertoId: string): Promise<UserCache | null> {
    try {
      // 1. Tentar buscar no Redis primeiro
      const cacheKey = this.getCacheKey(gastoCertoId);
      const cachedUser = await this.getUserFromRedisByKey(cacheKey);
      if (cachedUser) {
        this.logger.debug(
          `Cache HIT - Redis (gastoCertoId): ${gastoCertoId} | activeAccountId: ${cachedUser.activeAccountId}`,
        );
        return cachedUser;
      }

      // 2. Buscar no banco de dados
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId },
      });

      if (!user) {
        this.logger.debug(`Usuário não encontrado no banco: ${gastoCertoId}`);
        return null;
      }

      // 3. Atualizar Redis com chave universal (gastoCertoId)
      await this.setUserInRedisByKey(cacheKey, user);

      this.logger.debug(
        `Cache HIT - Database: ${user.gastoCertoId} | activeAccountId: ${user.activeAccountId}`,
      );

      return user;
    } catch (error) {
      this.logger.error(`Erro ao buscar usuário por gastoCertoId ${gastoCertoId}:`, error);
      return null;
    }
  }

  /**
   * Busca usuário WhatsApp por phoneNumber (Database → Redis → API)
   * Ordem alterada: Database primeiro para obter gastoCertoId, depois Redis
   */
  async getUser(phoneNumber: string): Promise<UserCache | null> {
    try {
      this.logger.debug(`🔍 [WhatsApp] Buscando usuário por phoneNumber: ${phoneNumber}`);

      // 1. Buscar no banco de dados primeiro para obter gastoCertoId
      const dbUser = await this.prisma.userCache.findFirst({
        where: { phoneNumber },
      });

      if (dbUser) {
        // 2. Tentar buscar no Redis usando gastoCertoId (chave universal)
        const cacheKey = this.getCacheKey(dbUser.gastoCertoId);
        const cachedUser = await this.getUserFromRedisByKey(cacheKey);

        if (cachedUser) {
          this.logger.debug(
            `✅ Cache HIT - Redis (WhatsApp): ${phoneNumber} | isBlocked: ${cachedUser.isBlocked}, isActive: ${cachedUser.isActive}`,
          );
          return cachedUser;
        }

        // 3. Não está no Redis, usar dados do database e atualizar Redis
        this.logger.debug(
          `✅ Cache HIT - Database (WhatsApp): ${phoneNumber} | isBlocked: ${dbUser.isBlocked}, isActive: ${dbUser.isActive}`,
        );
        await this.setUserInRedisByKey(cacheKey, dbUser);
        return dbUser;
      }

      // 4. Não está no database, buscar na API Gasto Certo
      const apiResponse = await this.gastoCertoApi.getUserByPhone(phoneNumber);
      if (apiResponse.exists && apiResponse.user) {
        this.logger.log(`Cache MISS - Usuário encontrado na API: ${phoneNumber}`);
        // Salvar no banco e Redis
        const newUserCache = await this.createUserCache(apiResponse.user);
        const cacheKey = this.getCacheKey(newUserCache.gastoCertoId);
        await this.setUserInRedisByKey(cacheKey, newUserCache);
        return newUserCache;
      }

      this.logger.debug(`Usuário não encontrado: ${phoneNumber}`);
      return null;
    } catch (error) {
      this.logger.error(`Erro ao buscar usuário ${phoneNumber}:`, error);
      return null;
    }
  }

  /**
   * Busca usuário Telegram por chatId (Database → Redis)
   * Ordem alterada: Database primeiro para obter gastoCertoId, depois Redis
   */
  async getUserByTelegram(chatId: string): Promise<UserCache | null> {
    try {
      this.logger.debug(`🔍 [Telegram] Buscando usuário por chatId: ${chatId}`);

      // 1. Buscar no banco de dados primeiro para obter gastoCertoId
      const dbUser = await this.prisma.userCache.findFirst({
        where: { telegramId: chatId },
      });

      if (dbUser) {
        // 2. Tentar buscar no Redis usando gastoCertoId (chave universal)
        const cacheKey = this.getCacheKey(dbUser.gastoCertoId);
        const cachedUser = await this.getUserFromRedisByKey(cacheKey);

        if (cachedUser) {
          this.logger.debug(
            `✅ Cache HIT - Redis (Telegram): ${chatId} | isBlocked: ${cachedUser.isBlocked}, isActive: ${cachedUser.isActive}`,
          );
          return cachedUser;
        }

        // 3. Não está no Redis, usar dados do database e atualizar Redis
        this.logger.debug(
          `✅ Cache HIT - Database (Telegram): ${chatId} | isBlocked: ${dbUser.isBlocked}, isActive: ${dbUser.isActive}`,
        );
        await this.setUserInRedisByKey(cacheKey, dbUser);
        return dbUser;
      }

      this.logger.debug(`❌ Usuário Telegram não encontrado: ${chatId}`);
      return null;
    } catch (error) {
      this.logger.error(`Erro ao buscar usuário Telegram ${chatId}:`, error);
      return null;
    }
  }

  /**
   * Cria cache de usuário no banco de dados
   */
  async createUserCache(apiUser: UserDto): Promise<UserCache> {
    try {
      // Preparar contas do usuário
      const accounts = (apiUser.accounts || []).map((acc) => ({
        id: acc.id,
        name: acc.name,
        type: acc.role || 'PF', // role = tipo da conta (PERSONAL, BUSINESS, etc)
        isPrimary: acc.isPrimary,
      }));

      // Definir conta ativa (priorizar primária)
      const activeAccountId = accounts.find((acc) => acc.isPrimary)?.id || accounts[0]?.id || null;

      // Verificar se já existe usuário com este gastoCertoId
      const existing = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: apiUser.id },
      });

      if (existing) {
        this.logger.warn(`⚠️ Cache já existe para gastoCertoId ${apiUser.id}. Atualizando...`);

        // Manter conta ativa existente (não sobrescrever escolha do usuário)
        const finalActiveAccountId = existing.activeAccountId || activeAccountId;
        if (existing.activeAccountId) {
          // Verificar se a conta ativa ainda existe nas novas contas
          const stillExists = accounts.some((acc) => acc.id === existing.activeAccountId);
          if (!stillExists) {
            this.logger.warn(
              `⚠️ Conta ativa ${existing.activeAccountId} não existe mais nas contas atualizadas. Redefinindo.`,
            );
          } else {
            this.logger.log(
              `✅ Mantendo conta ativa existente: ${existing.activeAccountId} (banco é fonte da verdade)`,
            );
          }
        }

        // Atualizar cache existente
        return await this.prisma.userCache.update({
          where: { gastoCertoId: apiUser.id },
          data: {
            phoneNumber: apiUser.phoneNumber || existing.phoneNumber,
            email: apiUser.email,
            name: apiUser.name,
            hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
            canUseGastoZap: apiUser.hasActiveSubscription ?? false,
            isBlocked: apiUser.isBlocked ?? existing.isBlocked ?? false,
            isActive: apiUser.isActive ?? existing.isActive ?? true,
            accounts: accounts as any,
            activeAccountId: finalActiveAccountId,
            categories: (apiUser.categories || []) as any,
            preferences: (apiUser.preferences || {}) as any,
            lastSyncAt: new Date(),
          },
        });
      }

      const userCache = await this.prisma.userCache.create({
        data: {
          phoneNumber: apiUser.phoneNumber || '',
          gastoCertoId: apiUser.id,
          email: apiUser.email,
          name: apiUser.name,
          hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
          canUseGastoZap: apiUser.hasActiveSubscription ?? false,
          isBlocked: apiUser.isBlocked ?? false,
          isActive: apiUser.isActive ?? true,
          accounts: accounts as any,
          activeAccountId,
          categories: (apiUser.categories || []) as any,
          preferences: (apiUser.preferences || {}) as any,
          lastSyncAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Cache de usuário criado: ${apiUser.name} | ` +
          `Contas: ${accounts.length} | Ativa: ${activeAccountId || 'N/A'}`,
      );

      // Sincronizar categorias no RAG (assíncrono, não bloqueante)
      this.syncUserCategoriesToRAG(userCache.phoneNumber).catch((err) =>
        this.logger.error('Erro ao sincronizar RAG:', err),
      );

      return userCache;
    } catch (error) {
      // Se ainda assim der erro de duplicação (race condition), tentar buscar
      if (error.code === 'P2002') {
        this.logger.warn(`Race condition detectada, buscando cache existente...`);
        const existing = await this.prisma.userCache.findUnique({
          where: { gastoCertoId: apiUser.id },
        });
        if (existing) return existing;
      }
      this.logger.error(`Erro ao criar cache de usuário:`, error);
      throw error;
    }
  }

  /**
   * Cria cache de usuário com informações de plataforma específicas
   */
  async createUserCacheWithPlatform(
    apiUser: UserDto,
    platform: 'telegram' | 'whatsapp',
    platformId: string,
    realPhoneNumber?: string,
  ): Promise<UserCache> {
    try {
      // Normalizar telefone: remover código do país (55) e deixar só números
      let normalizedPhone = '';

      if (realPhoneNumber) {
        // Usar telefone real fornecido (ex: 66996285154)
        normalizedPhone = this.normalizePhoneNumber(realPhoneNumber);
      } else if (platform === 'whatsapp' && platformId) {
        // Para WhatsApp, extrair do platformId (ex: 5566996285154@s.whatsapp.net)
        normalizedPhone = this.normalizePhoneNumber(platformId);
      }

      // ✅ CRÍTICO: Verificar se usuário já existe por gastoCertoId OU phoneNumber
      const existingByGastoCertoId = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: apiUser.id },
      });

      const existingByPhone = normalizedPhone
        ? await this.prisma.userCache.findUnique({
            where: { phoneNumber: normalizedPhone },
          })
        : null;

      // Se já existe, atualizar ao invés de criar
      if (existingByGastoCertoId || existingByPhone) {
        const existing = existingByGastoCertoId || existingByPhone;
        this.logger.warn(
          `⚠️ Usuário já existe (gastoCertoId: ${existing?.gastoCertoId}, phone: ${existing?.phoneNumber}). Atualizando dados...`,
        );

        // Preparar dados de atualização
        const accounts = (apiUser.accounts || []).map((acc) => ({
          id: acc.id,
          name: acc.name,
          type: acc.role || 'PF',
          isPrimary: acc.isPrimary,
        }));

        const activeAccountId =
          accounts.find((acc) => acc.isPrimary)?.id || accounts[0]?.id || null;

        const updateData: any = {
          phoneNumber: normalizedPhone || existing!.phoneNumber,
          email: apiUser.email,
          name: apiUser.name,
          hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
          isBlocked: apiUser.isBlocked ?? false,
          isActive: apiUser.isActive ?? true,
          accounts: accounts as any,
          activeAccountId,
          categories: (apiUser.categories || []) as any,
          preferences: (apiUser.preferences || {}) as any,
          lastSyncAt: new Date(),
        };

        // Adicionar campo da plataforma se não existir
        if (platform === 'telegram' && !existing!.telegramId) {
          updateData.telegramId = platformId;
        } else if (platform === 'whatsapp' && !existing!.whatsappId) {
          updateData.whatsappId = platformId;
        }

        const userCache = await this.prisma.userCache.update({
          where: { id: existing!.id },
          data: updateData,
        });

        this.logger.log(
          `✅ Cache atualizado - ${platform}: ${apiUser.name} | Phone: ${normalizedPhone} | PlatformId: ${platformId}`,
        );
        return userCache;
      }

      // Preparar contas do usuário
      const accounts = (apiUser.accounts || []).map((acc) => ({
        id: acc.id,
        name: acc.name,
        type: acc.role || 'PF', // role = tipo da conta (PERSONAL, BUSINESS, etc)
        isPrimary: acc.isPrimary,
      }));

      // Definir conta ativa (priorizar primária)
      const activeAccountId = accounts.find((acc) => acc.isPrimary)?.id || accounts[0]?.id || null;

      // Criar novo usuário
      const data: any = {
        phoneNumber: normalizedPhone,
        gastoCertoId: apiUser.id,
        email: apiUser.email,
        name: apiUser.name,
        hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
        isBlocked: apiUser.isBlocked ?? false,
        isActive: apiUser.isActive ?? true,
        accounts: accounts as any,
        activeAccountId,
        categories: (apiUser.categories || []) as any,
        preferences: (apiUser.preferences || {}) as any,
        lastSyncAt: new Date(),
      };

      // Preencher campo específico da plataforma
      if (platform === 'telegram') {
        data.telegramId = platformId; // ID do chat Telegram
      } else if (platform === 'whatsapp') {
        data.whatsappId = platformId; // ID do WhatsApp com @s.whatsapp.net
      }

      const userCache = await this.prisma.userCache.create({ data });

      this.logger.log(
        `✅ Cache criado - ${platform}: ${apiUser.name} | Phone: ${normalizedPhone} | PlatformId: ${platformId} | Contas: ${accounts.length} | ContaAtiva: ${activeAccountId || 'nenhuma'}`,
      );
      return userCache;
    } catch (error) {
      this.logger.error(`Erro ao criar cache de usuário:`, error);
      throw error;
    }
  }

  /**
   * Atualiza cache de usuário por gastoCertoId
   */
  async updateUserCache(gastoCertoId: string, data: Partial<UserCache>): Promise<UserCache> {
    try {
      const updated = await this.prisma.userCache.update({
        where: { gastoCertoId },
        data: {
          ...data,
          lastSyncAt: new Date(),
        },
      });

      // Atualizar Redis (usando telegramId ou whatsappId)
      const cacheKey = updated.telegramId || updated.whatsappId;
      if (cacheKey) {
        await this.setUserInRedis(cacheKey, updated);
      }

      this.logger.log(`✅ Cache de usuário atualizado: ${gastoCertoId}`);
      return updated;
    } catch (error) {
      this.logger.error(`Erro ao atualizar cache de usuário:`, error);
      throw error;
    }
  }

  /**
   * Sincroniza usuário com a API (força atualização)
   */
  async syncUser(phoneNumber: string): Promise<UserCache | null> {
    try {
      this.logger.log(`Sincronizando usuário: ${phoneNumber}`);

      const apiResponse = await this.gastoCertoApi.getUserByPhone(phoneNumber);
      if (!apiResponse.exists || !apiResponse.user) {
        return null;
      }

      const apiUser = apiResponse.user;

      // Verificar se já existe no banco
      const existingCache = await this.getUserFromDatabase(phoneNumber);

      let userCache: UserCache;

      if (existingCache) {
        // Atualizar
        userCache = await this.updateUserCache(phoneNumber, {
          gastoCertoId: apiUser.id,
          email: apiUser.email,
          name: apiUser.name,
          hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
          isBlocked: apiUser.isBlocked ?? false,
          isActive: apiUser.isActive ?? true,
          categories: (apiUser.categories || []) as any,
          preferences: (apiUser.preferences || {}) as any,
        });
      } else {
        // Criar
        userCache = await this.createUserCache(apiUser);
      }

      // Atualizar Redis
      await this.setUserInRedis(phoneNumber, userCache);

      return userCache;
    } catch (error) {
      this.logger.error(`Erro ao sincronizar usuário:`, error);
      throw error;
    }
  }

  /**
   * Atualiza status de assinatura
   */
  async updateSubscriptionStatus(
    phoneNumber: string,
    hasActiveSubscription: boolean,
  ): Promise<void> {
    try {
      await this.updateUserCache(phoneNumber, { hasActiveSubscription });
    } catch (error) {
      this.logger.error(`Erro ao atualizar status de assinatura:`, error);
    }
  }

  /**
   * Verifica se usuário precisa sincronizar (última atualização > 12h)
   * Sincroniza licença, contas e categorias do usuário
   */
  needsSync(user: { updatedAt?: Date | string }): boolean {
    if (!user.updatedAt) {
      return true; // Nunca sincronizou
    }

    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000; // 12 horas em ms
    const updatedAtTime =
      user.updatedAt instanceof Date
        ? user.updatedAt.getTime()
        : new Date(user.updatedAt).getTime();
    return updatedAtTime < twelveHoursAgo;
  }

  /**
   * Sincroniza dados completos do usuário (licença, contas e categorias)
   * Chamado quando needsSync() retorna true (a cada 12h)
   */
  async syncSubscriptionStatus(gastoCertoId: string): Promise<void> {
    try {
      this.logger.log(`⏰ Sincronizando dados do usuário: ${gastoCertoId}`);

      // 1. Buscar status de assinatura na API
      const status = await this.gastoCertoApi.getSubscriptionStatus(gastoCertoId);

      // 2. Buscar contas e categorias atualizadas
      let accounts: any[] | undefined;
      let categories: any[] | undefined;

      try {
        const [apiAccounts, apiCategoriesResponse] = await Promise.all([
          this.gastoCertoApi.getUserAccounts(gastoCertoId),
          this.gastoCertoApi.getUserCategories(gastoCertoId),
        ]);
        accounts = apiAccounts;

        // Extrair categorias de todas as contas retornadas pela API
        if (apiCategoriesResponse?.success && apiCategoriesResponse.accounts) {
          categories = [];
          for (const acc of apiCategoriesResponse.accounts) {
            if (acc.categories) {
              for (const cat of acc.categories) {
                categories.push({ ...cat, accountId: acc.id });
              }
            }
          }
        }
      } catch (syncError) {
        this.logger.warn(
          `⚠️ Erro ao sincronizar contas/categorias (mantendo dados anteriores): ${syncError.message}`,
        );
      }

      // 3. Atualizar cache local (PostgreSQL + Redis) de uma vez
      const updateData: Record<string, any> = {
        hasActiveSubscription: status.isActive,
        canUseGastoZap: status.canUseGastoZap,
        updatedAt: new Date(), // Resetar timer de 12h
      };
      if (accounts !== undefined) updateData.accounts = accounts;
      if (categories !== undefined) updateData.categories = categories;

      await this.updateUserCache(gastoCertoId, updateData);

      this.logger.log(
        `✅ Dados sincronizados: ${gastoCertoId} | ` +
          `canUseGastoZap=${status.canUseGastoZap} | ` +
          `hasActiveSubscription=${status.isActive}` +
          (accounts ? ` | contas=${accounts.length}` : '') +
          (categories ? ` | categorias=${Array.isArray(categories) ? categories.length : 0}` : ''),
      );

      // 4. Atualizar índice RAG se categorias foram sincronizadas
      if (categories && this.ragService) {
        try {
          const user = await this.prisma.userCache.findUnique({ where: { gastoCertoId } });
          if (user) {
            await this.syncUserCategoriesToRAG(user.phoneNumber);
          }
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro ao atualizar índice RAG: ${ragError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao sincronizar dados do usuário: ${error.message}`);
      // Não lançar erro - manter status anterior em caso de falha
    }
  }

  /**
   * Busca categorias completas do usuário com accounts
   * Se não houver no cache, busca na API
   * @param phoneNumber - Telefone do usuário
   * @param accountId - (Opcional) ID da conta para filtrar categorias
   */
  async getUserCategories(
    phoneNumber: string,
    accountId?: string,
  ): Promise<{
    categories: any[];
    accounts: any[];
    hasCategories: boolean;
  }> {
    try {
      // 1. Tentar buscar do cache
      const cachedUser = await this.getUser(phoneNumber);

      if (cachedUser && cachedUser.categories && Array.isArray(cachedUser.categories)) {
        let categories = cachedUser.categories as any[];

        // Filtrar por accountId se fornecido
        if (accountId) {
          categories = categories.filter((cat) => cat.accountId === accountId);
          this.logger.log(
            `📦 Categorias encontradas no cache (conta ${accountId}): ${categories.length} categoria(s)`,
          );
        } else {
          this.logger.log(`📦 Categorias encontradas no cache: ${categories.length} categoria(s)`);
        }

        if (categories.length > 0) {
          return {
            categories,
            accounts: [],
            hasCategories: true,
          };
        }
      }

      // 2. Buscar categorias com accounts na API
      this.logger.log(`🔍 Buscando categorias com accounts na API para ${phoneNumber}`);

      if (!cachedUser || !cachedUser.gastoCertoId) {
        this.logger.warn(`⚠️ Usuário não encontrado no cache: ${phoneNumber}`);
        return {
          categories: [],
          accounts: [],
          hasCategories: false,
        };
      }

      const categoriesResponse = await this.gastoCertoApi.getUserCategories(
        cachedUser.gastoCertoId,
      );

      if (!categoriesResponse.success || !categoriesResponse.accounts) {
        this.logger.warn(`⚠️ Nenhuma categoria retornada pela API`);
        return {
          categories: [],
          accounts: [],
          hasCategories: false,
        };
      }

      // 3. Extrair todas as categorias de todas as contas (ou apenas da conta especificada)
      const allCategories: any[] = [];
      const accounts = categoriesResponse.accounts;

      this.logger.log(`📊 ${accounts.length} conta(s) encontrada(s)`);

      // Filtrar accounts se accountId foi fornecido
      const accountsToProcess = accountId
        ? accounts.filter((acc) => acc.id === accountId)
        : accounts;

      if (accountId && accountsToProcess.length === 0) {
        this.logger.warn(`⚠️ Conta ${accountId} não encontrada nas contas do usuário`);
      }

      accountsToProcess.forEach((account) => {
        this.logger.log(
          `  📁 Conta: ${account.name} (${account.id}) - ${account.categories.length} categoria(s) - isDefault: ${account.isDefault}`,
        );

        account.categories.forEach((category: any) => {
          // Adicionar informação da conta à categoria
          allCategories.push({
            ...category,
            accountId: account.id,
            accountName: account.name,
            isDefaultAccount: account.isDefault,
          });
        });
      });

      const accountInfo = accountId ? ` da conta ${accountId}` : ` de ${accounts.length} conta(s)`;
      this.logger.log(`✅ Total de ${allCategories.length} categoria(s) extraída(s)${accountInfo}`);

      // 4. Atualizar cache com as novas categorias
      if (allCategories.length > 0) {
        await this.updateUserCache(cachedUser.gastoCertoId, {
          categories: allCategories as any,
        });
        this.logger.log(`💾 Cache atualizado com ${allCategories.length} categoria(s)`);
      }

      return {
        categories: allCategories,
        accounts,
        hasCategories: allCategories.length > 0,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar categorias do usuário:`, error);
      return {
        categories: [],
        accounts: [],
        hasCategories: false,
      };
    }
  }

  /**
   * Remove usuário do cache (Redis e Database)
   * Aceita phoneNumber, telegramId ou gastoCertoId
   */
  async invalidateUser(identifier: string): Promise<void> {
    try {
      // Buscar usuário para obter gastoCertoId (chave universal)
      const user = await this.prisma.userCache.findFirst({
        where: {
          OR: [
            { phoneNumber: identifier },
            { telegramId: identifier },
            { gastoCertoId: identifier },
          ],
        },
      });

      if (!user) {
        this.logger.warn(`Usuário não encontrado para invalidação: ${identifier}`);
        return;
      }

      // Remover do Redis usando gastoCertoId (chave universal)
      const cacheKey = this.getCacheKey(user.gastoCertoId);
      await this.redisService.getClient().del(cacheKey);

      this.logger.log(`Cache invalidado: ${identifier} (gastoCertoId: ${user.gastoCertoId})`);
    } catch (error) {
      this.logger.error(`Erro ao invalidar cache:`, error);
    }
  }

  /**
   * Busca usuário no Redis
   */
  private async getUserFromRedis(phoneNumber: string): Promise<UserCache | null> {
    try {
      const cached = await this.redisService.getClient().get(`user:${phoneNumber}`);
      if (!cached) return null;

      return JSON.parse(cached) as UserCache;
    } catch (error) {
      this.logger.error('Erro ao buscar no Redis:', error);
      return null;
    }
  }

  /**
   * Salva usuário no Redis
   */
  private async setUserInRedis(phoneNumber: string, user: UserCache): Promise<void> {
    try {
      await this.redisService
        .getClient()
        .setex(`user:${phoneNumber}`, this.CACHE_TTL, JSON.stringify(user));
    } catch (error) {
      this.logger.error('Erro ao salvar no Redis:', error);
    }
  }

  /**
   * Busca usuário no Redis usando chave customizada
   */
  private async getUserFromRedisByKey(cacheKey: string): Promise<UserCache | null> {
    try {
      const cached = await this.redisService.getClient().get(cacheKey);
      if (!cached) return null;

      return JSON.parse(cached) as UserCache;
    } catch (error) {
      this.logger.error(`Erro ao buscar no Redis (${cacheKey}):`, error);
      return null;
    }
  }

  /**
   * Salva usuário no Redis usando chave customizada
   */
  private async setUserInRedisByKey(cacheKey: string, user: UserCache): Promise<void> {
    try {
      await this.redisService.getClient().setex(cacheKey, this.CACHE_TTL, JSON.stringify(user));
    } catch (error) {
      this.logger.error(`Erro ao salvar no Redis (${cacheKey}):`, error);
    }
  }

  /**
   * Busca usuário no banco de dados local por plataforma
   */
  private async getUserFromDatabase(phoneNumber: string): Promise<UserCache | null> {
    try {
      // Buscar por múltiplos identificadores (phoneNumber, telegramId, whatsappId)
      const user = await this.prisma.userCache.findFirst({
        where: {
          OR: [
            { phoneNumber }, // ✅ Buscar por phoneNumber (prioritário)
            { telegramId: phoneNumber }, // Telegram usa chatId como identificador
            { whatsappId: phoneNumber }, // WhatsApp usa phoneNumber completo
          ],
        },
      });

      if (user) {
        this.logger.debug(
          `✅ User found in database: ${phoneNumber} → gastoCertoId: ${user.gastoCertoId}`,
        );
      }

      return user;
    } catch (error) {
      this.logger.error('Erro ao buscar no banco:', error);
      return null;
    }
  }

  /**
   * Busca usuário por número de telefone normalizado (nova chave única)
   */
  async findByPhoneNumber(phoneNumber: string): Promise<UserCache | null> {
    try {
      // Normalizar número removendo código do país e formatação
      const normalized = this.normalizePhoneNumber(phoneNumber);

      // Buscar por phoneNumber normalizado (chave única)
      const user = await this.prisma.userCache.findUnique({
        where: { phoneNumber: normalized },
      });

      if (user) {
        this.logger.log(`✅ Usuário encontrado: ${user.name} | Phone: ${normalized}`);
      }

      return user;
    } catch (error) {
      this.logger.error(`Erro ao buscar usuário por telefone:`, error);
      return null;
    }
  }

  /**
   * Busca usuário por ID da plataforma específica
   */
  async findByPlatformId(
    platformId: string,
    platform: 'whatsapp' | 'telegram',
  ): Promise<UserCache | null> {
    try {
      const where =
        platform === 'whatsapp' ? { whatsappId: platformId } : { telegramId: platformId };

      const user = await this.prisma.userCache.findFirst({ where });

      if (user) {
        this.logger.debug(`✅ Usuário encontrado por ${platform}Id: ${user.name}`);
      }

      return user;
    } catch (error) {
      this.logger.error(`Erro ao buscar usuário por ${platform}Id:`, error);
      return null;
    }
  }

  /**
   * Vincula uma nova plataforma a um usuário existente
   */
  async linkPlatform(
    phoneNumber: string,
    platformId: string,
    platform: 'whatsapp' | 'telegram',
  ): Promise<{ success: boolean; user?: UserCache; message: string }> {
    try {
      const normalized = this.normalizePhoneNumber(phoneNumber);

      // Buscar usuário por phoneNumber
      const user = await this.prisma.userCache.findUnique({
        where: { phoneNumber: normalized },
      });

      if (!user) {
        return {
          success: false,
          message: 'Usuário não encontrado. Faça o onboarding primeiro.',
        };
      }

      // Verificar se plataforma já está vinculada
      const currentPlatformId = platform === 'whatsapp' ? user.whatsappId : user.telegramId;

      if (currentPlatformId) {
        if (currentPlatformId === platformId) {
          this.logger.log(`✅ ${platform} já vinculado: ${user.name}`);
          return {
            success: true,
            user,
            message: `${platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'} já está vinculado a esta conta.`,
          };
        } else {
          this.logger.error(
            `❌ ${platform} já vinculado a outro ID: current=${currentPlatformId}, new=${platformId}`,
          );
          return {
            success: false,
            message: `${platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'} já está vinculado a outro ID. Entre em contato com o suporte.`,
          };
        }
      }

      // Vincular nova plataforma
      const updateData =
        platform === 'whatsapp' ? { whatsappId: platformId } : { telegramId: platformId };

      const updated = await this.prisma.userCache.update({
        where: { phoneNumber: normalized },
        data: updateData,
      });

      // Atualizar Redis com novo platformId
      await this.setUserInRedis(platformId, updated);

      this.logger.log(
        `✅ Plataforma vinculada: ${platform} → ${user.name} | PlatformId: ${platformId}`,
      );

      return {
        success: true,
        user: updated,
        message: `👋 Olá novamente! Vinculei seu ${platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'} à sua conta existente.\n\nAgora você pode usar tanto Telegram quanto WhatsApp! 🚀`,
      };
    } catch (error) {
      this.logger.error(`Erro ao vincular plataforma:`, error);
      return {
        success: false,
        message: 'Erro ao vincular plataforma. Tente novamente.',
      };
    }
  }

  /**
   * Normaliza número de telefone (remove código do país e formatação)
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    // Remover tudo que não é número
    let normalized = phoneNumber.replace(/\D/g, '');

    // Se for WhatsApp ID (ex: 5566996285154@s.whatsapp.net), extrair apenas números
    if (phoneNumber.includes('@')) {
      normalized = phoneNumber.split('@')[0].replace(/\D/g, '');
    }

    // Remover código do país (55) se presente
    if (normalized.startsWith('55') && normalized.length > 11) {
      normalized = normalized.substring(2);
    }

    return normalized;
  }

  /**
   * Sincroniza categorias do usuário no RAG
   * Chamado após criar/atualizar usuário
   */
  async syncUserCategoriesToRAG(phoneNumber: string): Promise<void> {
    try {
      // Verificar se RAG está habilitado
      if (!this.ragService || !this.aiConfigService) {
        this.logger.debug('RAG não disponível para sincronização');
        return;
      }

      const aiSettings = await this.aiConfigService.getSettings();
      if (!aiSettings.ragEnabled) {
        this.logger.debug('RAG desabilitado nas configurações');
        return;
      }

      // Buscar categorias do usuário
      const categoriesData = await this.getUserCategories(phoneNumber);

      if (!categoriesData.categories || categoriesData.categories.length === 0) {
        this.logger.debug(`Nenhuma categoria para indexar - usuário: ${phoneNumber}`);
        return;
      }

      // Formatar categorias para o RAG (expandir subcategorias)
      const userCategories = expandCategoriesForRAG(categoriesData.categories);

      // Buscar userId (gastoCertoId) do usuário
      const user = await this.findByPhoneNumber(phoneNumber);
      if (!user) {
        this.logger.warn(`Usuário não encontrado para sincronizar RAG: ${phoneNumber}`);
        return;
      }

      // Indexar no RAG usando userId
      await this.ragService.indexUserCategories(user.gastoCertoId, userCategories);

      this.logger.log(
        `✅ Categorias sincronizadas no RAG: ${userCategories.length} categorias | ` +
          `UserId: ${user.gastoCertoId} | Phone: ${phoneNumber} | Modo: ${aiSettings.ragAiEnabled ? 'AI' : 'BM25'}`,
      );
    } catch (error) {
      this.logger.error(`Erro ao sincronizar categorias no RAG para ${phoneNumber}:`, error);
      // Não lançar erro - sincronização do RAG não deve bloquear operações
    }
  }

  /**
   * Sincroniza contas do usuário a partir da API externa.
   * Chamado automaticamente quando o cache local está vazio.
   *
   * Responsabilidades:
   * 1. Buscar contas na API
   * 2. Mapear para formato local
   * 3. Resolver conta ativa (preservar escolha do usuário se ainda existir)
   * 4. Atualizar Prisma + Redis
   *
   * @returns Contas mapeadas e activeAccountId atualizado, ou null se falhou
   */
  private async syncAccountsFromApi(user: UserCache): Promise<{
    accounts: Array<{ id: string; name: string; type: string; isPrimary?: boolean }>;
    activeAccountId: string | null;
  } | null> {
    try {
      const apiAccounts = await this.gastoCertoApi.getUserAccounts(user.gastoCertoId);

      if (apiAccounts.length === 0) {
        this.logger.warn(`⚠️ API não retornou contas para gastoCertoId: ${user.gastoCertoId}`);
        return null;
      }

      // Mapear contas da API
      const mappedAccounts = apiAccounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        type: acc.role || 'PF',
        isPrimary: acc.isPrimary,
      }));

      // Resolver conta ativa (preservar escolha do usuário se possível)
      let activeAccountId = user.activeAccountId;
      if (!activeAccountId) {
        activeAccountId =
          mappedAccounts.find((acc) => acc.isPrimary)?.id || mappedAccounts[0]?.id || null;
        this.logger.log(`🆕 Definindo conta ativa inicial: ${activeAccountId} (não existia antes)`);
      } else {
        const stillExists = mappedAccounts.some((acc) => acc.id === activeAccountId);
        if (!stillExists) {
          this.logger.warn(
            `⚠️ Conta ativa ${activeAccountId} não existe mais. Redefinindo para primária.`,
          );
          activeAccountId =
            mappedAccounts.find((acc) => acc.isPrimary)?.id || mappedAccounts[0]?.id || null;
        } else {
          this.logger.log(
            `✅ Mantendo conta ativa existente: ${activeAccountId} (banco é fonte da verdade)`,
          );
        }
      }

      // Atualizar cache no banco
      const updatedUser = await this.prisma.userCache.update({
        where: { gastoCertoId: user.gastoCertoId },
        data: {
          accounts: mappedAccounts as any,
          activeAccountId,
          lastSyncAt: new Date(),
        },
      });

      // Invalidar cache Redis (todas as chaves de plataforma)
      if (user.phoneNumber) await this.redisService.getClient().del(`user:${user.phoneNumber}`);
      if (user.telegramId) await this.redisService.getClient().del(`user:${user.telegramId}`);
      if (user.whatsappId) await this.redisService.getClient().del(`user:${user.whatsappId}`);

      // Salvar no Redis usando chave universal (gastoCertoId)
      const cacheKey = this.getCacheKey(updatedUser.gastoCertoId);
      await this.setUserInRedisByKey(cacheKey, updatedUser);

      this.logger.log(
        `✅ ${apiAccounts.length} conta(s) sincronizada(s) da API | ContaAtiva: ${activeAccountId}`,
      );

      return { accounts: mappedAccounts, activeAccountId };
    } catch (syncError) {
      this.logger.error(`❌ Erro ao sincronizar contas da API:`, syncError);
      return null;
    }
  }

  /**
   * Atualiza a lista de contas do usuário
   */
  async updateAccounts(
    phoneNumber: string,
    accounts: Array<{ id: string; name: string; type: string; isPrimary?: boolean }>,
  ): Promise<UserCache | null> {
    try {
      const user = await this.findByPhoneNumber(phoneNumber);
      if (!user) {
        this.logger.warn(`Usuário não encontrado para atualizar contas: ${phoneNumber}`);
        return null;
      }

      // Se não tem conta ativa, definir a primeira como ativa
      let activeAccountId = user.activeAccountId;
      if (!activeAccountId && accounts.length > 0) {
        // Priorizar conta primária se existir
        const primaryAccount = accounts.find((acc) => acc.isPrimary);
        activeAccountId = primaryAccount ? primaryAccount.id : accounts[0].id;
      }

      const updated = await this.prisma.userCache.update({
        where: { id: user.id },
        data: {
          accounts: accounts as any,
          activeAccountId,
          lastSyncAt: new Date(),
        },
      });

      // Atualizar Redis
      await this.setUserInRedis(phoneNumber, updated);

      this.logger.log(
        `✅ Contas atualizadas para ${phoneNumber}: ${accounts.length} conta(s), ativa: ${activeAccountId}`,
      );

      return updated;
    } catch (error) {
      this.logger.error(`Erro ao atualizar contas do usuário ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Troca a conta ativa do usuário
   */
  async switchAccount(phoneNumber: string, accountId: string): Promise<UserCache | null> {
    try {
      // Usar getUser() que suporta platformId (Telegram chatId)
      const user = await this.getUser(phoneNumber);
      if (!user) {
        this.logger.warn(`Usuário não encontrado para trocar conta: ${phoneNumber}`);
        return null;
      }

      // Verificar se a conta existe na lista
      const accounts = (user.accounts as any[]) || [];
      const accountExists = accounts.some((acc) => acc.id === accountId);

      if (!accountExists) {
        this.logger.warn(`Conta ${accountId} não encontrada para usuário ${phoneNumber}`);
        return null;
      }

      const updated = await this.prisma.userCache.update({
        where: { id: user.id },
        data: {
          activeAccountId: accountId,
        },
      });

      // Invalidar cache Redis (todos os identificadores)
      if (updated.phoneNumber)
        await this.redisService.getClient().del(`user:${updated.phoneNumber}`);
      if (updated.telegramId) await this.redisService.getClient().del(`user:${updated.telegramId}`);
      if (updated.whatsappId) await this.redisService.getClient().del(`user:${updated.whatsappId}`);

      const account = accounts.find((acc) => acc.id === accountId);
      this.logger.log(
        `✅ Conta trocada para ${phoneNumber}: ${account?.name || accountId} (${account?.type || 'N/A'})`,
      );

      return updated;
    } catch (error) {
      this.logger.error(`Erro ao trocar conta do usuário ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Define o cartão de crédito padrão do usuário
   */
  async setDefaultCreditCard(phoneNumber: string, creditCardId: string): Promise<UserCache | null> {
    try {
      const user = await this.getUser(phoneNumber);
      if (!user) {
        this.logger.warn(`Usuário não encontrado para definir cartão padrão: ${phoneNumber}`);
        return null;
      }

      const updated = await this.prisma.userCache.update({
        where: { id: user.id },
        data: {
          defaultCreditCardId: creditCardId,
        },
      });

      // Invalidar cache Redis (todos os identificadores)
      if (updated.phoneNumber)
        await this.redisService.getClient().del(`user:${updated.phoneNumber}`);
      if (updated.telegramId) await this.redisService.getClient().del(`user:${updated.telegramId}`);
      if (updated.whatsappId) await this.redisService.getClient().del(`user:${updated.whatsappId}`);

      this.logger.log(`✅ Cartão padrão definido para ${phoneNumber}: ${creditCardId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Erro ao definir cartão padrão do usuário ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Lista todas as contas do usuário
   */
  async listAccounts(phoneNumber: string): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      isPrimary?: boolean;
      isActive: boolean;
    }>
  > {
    try {
      // Usar getUser que suporta platformId
      const user = await this.getUser(phoneNumber);
      if (!user) {
        this.logger.warn(`Usuário não encontrado para listar contas: ${phoneNumber}`);
        return [];
      }

      let accounts = (user?.accounts as any[]) || [];

      this.logger.debug(`📋 Contas no cache para ${phoneNumber}: ${accounts.length}`);
      this.logger.debug(JSON.stringify(accounts, null, 2));

      // Se não tem contas no cache, buscar na API
      if (accounts.length === 0) {
        this.logger.log(`📥 Nenhuma conta no cache para ${phoneNumber}. Buscando na API...`);

        const synced = await this.syncAccountsFromApi(user);
        if (synced) {
          accounts = synced.accounts;
          user.activeAccountId = synced.activeAccountId;
        }
      }

      const activeAccountId = user.activeAccountId;

      return accounts.map((acc) => ({
        ...acc,
        type: acc.type || acc.role || 'PF',
        isActive: acc.id === activeAccountId,
      }));
    } catch (error) {
      this.logger.error(`Erro ao listar contas do usu\u00e1rio ${phoneNumber}:`, error);
      return [];
    }
  }

  /**
   * Obt\u00e9m a conta ativa do usu\u00e1rio
   */
  async getActiveAccount(
    phoneNumber: string,
  ): Promise<{ id: string; name: string; type: string; isPrimary?: boolean } | null> {
    try {
      // Usar getUser que suporta platformId
      const user = await this.getUser(phoneNumber);
      if (!user) {
        this.logger.debug(`Usuário não encontrado para obter conta ativa: ${phoneNumber}`);
        return null;
      }

      this.logger.log(
        `🔍 [DEBUG] getActiveAccount - user.activeAccountId: ${user.activeAccountId}`,
      );
      this.logger.log(
        `🔍 [DEBUG] getActiveAccount - user.accounts.length: ${((user.accounts as any[]) || []).length}`,
      );

      let accounts = (user.accounts as any[]) || [];

      // Se não tem contas no cache, buscar na API
      if (accounts.length === 0) {
        this.logger.log(`📥 Nenhuma conta no cache para ${phoneNumber}. Buscando na API...`);

        const synced = await this.syncAccountsFromApi(user);
        if (synced) {
          accounts = synced.accounts;
          user.activeAccountId = synced.activeAccountId;
        } else {
          return null;
        }
      }

      if (!user.activeAccountId) {
        this.logger.debug(`Nenhuma conta ativa para ${phoneNumber}`);
        return null;
      }

      const activeAccount = accounts.find((acc) => acc.id === user.activeAccountId);

      if (!activeAccount) {
        this.logger.warn(
          `Conta ativa ${user.activeAccountId} não encontrada na lista para ${phoneNumber}`,
        );
        return null;
      }

      return activeAccount;
    } catch (error) {
      this.logger.error(`Erro ao obter conta ativa do usuário ${phoneNumber}:`, error);
      return null;
    }
  }

  /**
   * Obtém a conta ativa do usuário usando gastoCertoId diretamente
   * Método preferido para uso interno nos services
   */
  async getActiveAccountByUserId(
    gastoCertoId: string,
  ): Promise<{ id: string; name: string; type: string; isPrimary?: boolean } | null> {
    try {
      const user = await this.getUserByGastoCertoId(gastoCertoId);
      if (!user) {
        this.logger.debug(`Usuário não encontrado: ${gastoCertoId}`);
        return null;
      }

      if (!user.activeAccountId) {
        this.logger.debug(`Nenhuma conta ativa para usuário ${gastoCertoId}`);
        return null;
      }

      const accounts = (user.accounts as any[]) || [];
      const activeAccount = accounts.find((acc) => acc.id === user.activeAccountId);

      if (!activeAccount) {
        this.logger.warn(
          `Conta ativa ${user.activeAccountId} não encontrada para usuário ${gastoCertoId}`,
        );
        return null;
      }

      return activeAccount;
    } catch (error) {
      this.logger.error(`Erro ao obter conta ativa do usuário ${gastoCertoId}:`, error);
      return null;
    }
  }

  /**
   * Limpa todo o cache Redis
   * Usado pelo admin para forçar atualização
   */
  async clearAllCache(): Promise<void> {
    this.logger.log('🧹 Limpando todo o cache Redis...');

    try {
      await this.redisService.getClient().flushdb();
      this.logger.log('✅ Cache Redis limpo com sucesso');
    } catch (error) {
      this.logger.error('❌ Erro ao limpar cache Redis:', error);
      throw error;
    }
  }

  /**
   * 🆕 Conta usuários ativos no cache Redis
   * Usado para estatísticas no health check
   */
  async countActiveUsers(): Promise<number> {
    try {
      const keys = await this.redisService.getClient().keys('user:*');

      // Contar apenas usuários ativos (isActive = true)
      let activeCount = 0;

      for (const key of keys) {
        const cached = await this.redisService.getClient().get(key);
        if (cached) {
          const user = JSON.parse(cached);
          if (user.isActive === true) {
            activeCount++;
          }
        }
      }

      this.logger.debug(`📊 Usuários ativos no cache: ${activeCount} de ${keys.length} total`);
      return activeCount;
    } catch (error) {
      this.logger.error('❌ Erro ao contar usuários ativos:', error);
      return 0;
    }
  }
}
