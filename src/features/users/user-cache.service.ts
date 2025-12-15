import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { UserCache } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { RAGService } from '../../infrastructure/ai/rag/rag.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import Redis from 'ioredis';

@Injectable()
export class UserCacheService {
  private readonly logger = new Logger(UserCacheService.name);
  private readonly redis: Redis;
  private readonly CACHE_TTL = 3600; // 1 hora em segundos

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gastoCertoApi: GastoCertoApiService,
    @Optional() private readonly ragService?: RAGService,
    @Optional() private readonly aiConfigService?: AIConfigService,
  ) {
    // Inicializar Redis
    const redisUrl = this.configService.get<string>('redis.url');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      this.redis = new Redis({
        host: this.configService.get<string>('redis.host', 'localhost'),
        port: this.configService.get<number>('redis.port', 6379),
        password: this.configService.get<string>('redis.password'),
        db: this.configService.get<number>('redis.db', 0),
      });
    }

    this.redis.on('connect', () => {
      this.logger.log('✅ Conectado ao Redis');
    });

    this.redis.on('error', (error) => {
      this.logger.error('❌ Erro no Redis', error);
    });
  }

  /**
   * Busca usuário no cache (Redis → Database → API)
   */
  async getUser(phoneNumber: string): Promise<UserCache | null> {
    try {
      // 1. Tentar buscar no Redis
      const cachedUser = await this.getUserFromRedis(phoneNumber);
      if (cachedUser) {
        this.logger.debug(`Cache HIT - Redis: ${phoneNumber}`);
        return cachedUser;
      }

      // 2. Tentar buscar no banco de dados local
      const dbUser = await this.getUserFromDatabase(phoneNumber);
      if (dbUser) {
        this.logger.debug(`Cache HIT - Database: ${phoneNumber}`);
        // Atualizar Redis
        await this.setUserInRedis(phoneNumber, dbUser);
        return dbUser;
      }

      // 3. Buscar na API Gasto Certo
      const apiResponse = await this.gastoCertoApi.getUserByPhone(phoneNumber);
      if (apiResponse.exists && apiResponse.user) {
        this.logger.log(`Cache MISS - Usuário encontrado na API: ${phoneNumber}`);
        // Salvar no banco e Redis
        const newUserCache = await this.createUserCache(apiResponse.user);
        await this.setUserInRedis(phoneNumber, newUserCache);
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
        // Atualizar cache existente
        return await this.prisma.userCache.update({
          where: { gastoCertoId: apiUser.id },
          data: {
            phoneNumber: apiUser.phoneNumber || existing.phoneNumber,
            email: apiUser.email,
            name: apiUser.name,
            hasActiveSubscription: apiUser.hasActiveSubscription ?? false,
            accounts: accounts as any,
            activeAccountId,
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

      // ✅ NOVO: Verificar se usuário já existe
      const existing = await this.prisma.userCache.findUnique({
        where: { phoneNumber: normalizedPhone },
      });

      if (existing) {
        this.logger.warn(
          `⚠️ Usuário já existe com phoneNumber ${normalizedPhone}. Vinculando plataforma...`,
        );

        // Vincular plataforma automaticamente
        const linkResult = await this.linkPlatform(normalizedPhone, platformId, platform);

        if (linkResult.success && linkResult.user) {
          return linkResult.user;
        }

        throw new Error('Usuário já existe mas não foi possível vincular plataforma');
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
   * Busca categorias completas do usuário com accounts
   * Se não houver no cache, busca na API
   */
  async getUserCategories(phoneNumber: string): Promise<{
    categories: any[];
    accounts: any[];
    hasCategories: boolean;
  }> {
    try {
      // 1. Tentar buscar do cache
      const cachedUser = await this.getUser(phoneNumber);

      if (cachedUser && cachedUser.categories && Array.isArray(cachedUser.categories)) {
        const categories = cachedUser.categories as any[];
        if (categories.length > 0) {
          this.logger.log(`📦 Categorias encontradas no cache: ${categories.length} categoria(s)`);
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

      // 3. Extrair todas as categorias de todas as contas
      const allCategories: any[] = [];
      const accounts = categoriesResponse.accounts;

      this.logger.log(`📊 ${accounts.length} conta(s) encontrada(s)`);

      accounts.forEach((account) => {
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

      this.logger.log(
        `✅ Total de ${allCategories.length} categoria(s) extraída(s) de ${accounts.length} conta(s)`,
      );

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
   */
  async invalidateUser(phoneNumber: string): Promise<void> {
    try {
      // Remover do Redis
      await this.redis.del(`user:${phoneNumber}`);

      // Remover do banco (opcional, pode manter histórico)
      // await this.prisma.userCache.delete({ where: { phoneNumber } });

      this.logger.log(`Cache invalidado: ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Erro ao invalidar cache:`, error);
    }
  }

  /**
   * Busca usuário no Redis
   */
  private async getUserFromRedis(phoneNumber: string): Promise<UserCache | null> {
    try {
      const cached = await this.redis.get(`user:${phoneNumber}`);
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
      await this.redis.setex(`user:${phoneNumber}`, this.CACHE_TTL, JSON.stringify(user));
    } catch (error) {
      this.logger.error('Erro ao salvar no Redis:', error);
    }
  }

  /**
   * Busca usuário no banco de dados local por plataforma
   */
  private async getUserFromDatabase(phoneNumber: string): Promise<UserCache | null> {
    try {
      // Tentar buscar por Telegram ID primeiro (usando findFirst pois não é mais unique)
      let user = await this.prisma.userCache.findFirst({
        where: { telegramId: phoneNumber },
      });

      // Se não encontrou, tentar por WhatsApp ID
      if (!user) {
        user = await this.prisma.userCache.findFirst({
          where: { whatsappId: phoneNumber },
        });
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

      // Formatar categorias para o RAG
      const userCategories = categoriesData.categories.map((cat) => ({
        id: cat.id || cat.categoryId,
        name: cat.name || cat.categoryName,
        accountId: cat.accountId,
        subCategory: cat.subCategory
          ? {
              id: cat.subCategory.id || cat.subCategory.subCategoryId,
              name: cat.subCategory.name || cat.subCategory.subCategoryName,
            }
          : undefined,
      }));

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
      if (updated.phoneNumber) await this.redis.del(`user:${updated.phoneNumber}`);
      if (updated.telegramId) await this.redis.del(`user:${updated.telegramId}`);
      if (updated.whatsappId) await this.redis.del(`user:${updated.whatsappId}`);

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

      console.log('###'.repeat(20));
      console.log(JSON.stringify(accounts, null, 2));
      // 🆕 Se não tem contas no cache, buscar na API
      if (accounts.length === 0) {
        this.logger.log(`📥 Nenhuma conta no cache para ${phoneNumber}. Buscando na API...`);

        try {
          // Buscar contas na API
          const apiAccounts = await this.gastoCertoApi.getUserAccounts(user.gastoCertoId);

          if (apiAccounts.length > 0) {
            // Mapear contas da API
            const mappedAccounts = apiAccounts.map((acc) => ({
              id: acc.id,
              name: acc.name,
              type: acc.role || 'PF',
              isPrimary: acc.isPrimary,
            }));

            // Definir conta ativa (priorizar primária)
            const activeAccountId =
              mappedAccounts.find((acc) => acc.isPrimary)?.id || mappedAccounts[0]?.id || null;

            // Atualizar cache no banco
            await this.prisma.userCache.update({
              where: { gastoCertoId: user.gastoCertoId },
              data: {
                accounts: mappedAccounts as any,
                activeAccountId,
                lastSyncAt: new Date(),
              },
            });

            // Invalidar cache Redis
            await this.redis.del(`user:${user.phoneNumber}`);
            if (user.telegramId) await this.redis.del(`user:${user.telegramId}`);
            if (user.whatsappId) await this.redis.del(`user:${user.whatsappId}`);

            this.logger.log(
              `✅ ${apiAccounts.length} conta(s) sincronizada(s) da API | ContaAtiva: ${activeAccountId}`,
            );

            // Atualizar variável local
            accounts = mappedAccounts;
            user.activeAccountId = activeAccountId;
          } else {
            this.logger.warn(`⚠️ API não retornou contas para gastoCertoId: ${user.gastoCertoId}`);
          }
        } catch (syncError) {
          this.logger.error(`❌ Erro ao sincronizar contas da API:`, syncError);
          // Continuar com lista vazia
        }
      }

      const activeAccountId = user.activeAccountId;

      return accounts.map((acc) => ({
        ...acc,
        isActive: acc.id === activeAccountId,
      }));
    } catch (error) {
      this.logger.error(`Erro ao listar contas do usuário ${phoneNumber}:`, error);
      return [];
    }
  }

  /**
   * Obtém a conta ativa do usuário
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

      let accounts = (user.accounts as any[]) || [];

      // 🆕 Se não tem contas no cache, buscar na API
      if (accounts.length === 0) {
        this.logger.log(`📥 Nenhuma conta no cache para ${phoneNumber}. Buscando na API...`);

        try {
          // Buscar contas na API
          const apiAccounts = await this.gastoCertoApi.getUserAccounts(user.gastoCertoId);

          if (apiAccounts.length > 0) {
            // Mapear contas da API
            const mappedAccounts = apiAccounts.map((acc) => ({
              id: acc.id,
              name: acc.name,
              type: acc.role || 'PF',
              isPrimary: acc.isPrimary,
            }));

            // Definir conta ativa (priorizar primária)
            const activeAccountId =
              mappedAccounts.find((acc) => acc.isPrimary)?.id || mappedAccounts[0]?.id || null;

            // Atualizar cache no banco
            await this.prisma.userCache.update({
              where: { gastoCertoId: user.gastoCertoId },
              data: {
                accounts: mappedAccounts as any,
                activeAccountId,
                lastSyncAt: new Date(),
              },
            });

            // Invalidar cache Redis
            await this.redis.del(`user:${user.phoneNumber}`);
            if (user.telegramId) await this.redis.del(`user:${user.telegramId}`);
            if (user.whatsappId) await this.redis.del(`user:${user.whatsappId}`);

            this.logger.log(
              `✅ ${apiAccounts.length} conta(s) sincronizada(s) da API | ContaAtiva: ${activeAccountId}`,
            );

            // Atualizar variáveis locais
            accounts = mappedAccounts;
            user.activeAccountId = activeAccountId;
          } else {
            this.logger.warn(`⚠️ API não retornou contas para gastoCertoId: ${user.gastoCertoId}`);
          }
        } catch (syncError) {
          this.logger.error(`❌ Erro ao sincronizar contas da API:`, syncError);
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
   * Limpa todo o cache Redis
   * Usado pelo admin para forçar atualização
   */
  async clearAllCache(): Promise<void> {
    this.logger.log('🧹 Limpando todo o cache Redis...');

    try {
      await this.redis.flushdb();
      this.logger.log('✅ Cache Redis limpo com sucesso');
    } catch (error) {
      this.logger.error('❌ Erro ao limpar cache Redis:', error);
      throw error;
    }
  }
}
