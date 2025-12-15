import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AssistantService } from './assistant.service';

/**
 * Controller para gestão do assistente via gastocerto-admin
 */
@Controller('api/assistant')
export class AssistantController {
  constructor(private assistantService: AssistantService) {}

  /**
   * GET /api/assistant/stats
   * Estatísticas gerais do assistente
   */
  @Get('stats')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const stats = await this.assistantService.getStats(start, end);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /api/assistant/intents
   * Intenções mais detectadas
   */
  @Get('intents')
  async getIntents(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit = 20,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const intents = await this.assistantService.getTopIntents(
      start,
      end,
      Number(limit),
    );

    return {
      success: true,
      data: intents,
    };
  }

  /**
   * GET /api/assistant/cache-hit-rate
   * Taxa de cache hit (performance)
   */
  @Get('cache-hit-rate')
  async getCacheHitRate(@Query('days') days = 7) {
    const rate = await this.assistantService.getCacheHitRate(Number(days));

    return {
      success: true,
      data: rate,
    };
  }

  /**
   * GET /api/assistant/settings/:userId
   * Configurações do assistente
   */
  @Get('settings/:userId')
  async getSettings(@Param('userId') userId: string) {
    const settings = await this.assistantService.getAssistantSettings(userId);

    return {
      success: true,
      data: settings,
    };
  }

  /**
   * PATCH /api/assistant/settings/:userId
   * Atualiza configurações do assistente
   */
  @Patch('settings/:userId')
  async updateSettings(
    @Param('userId') userId: string,
    @Body()
    body: {
      assistantEnabled?: boolean;
      assistantPersonality?: 'friendly' | 'professional' | 'casual';
      assistantMaxHistoryMsgs?: number;
    },
  ) {
    const settings = await this.assistantService.updateAssistantSettings(
      userId,
      body,
    );

    return {
      success: true,
      data: settings,
      message: 'Assistant settings updated successfully',
    };
  }

  /**
   * POST /api/assistant/test
   * Testa detecção de intenção (debug)
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testIntent(
    @Body() body: { message: string; userId: string },
  ) {
    const result = await this.assistantService.detectIntent(
      body.userId,
      body.message,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * GET /api/assistant/quick-responses
   * Lista quick responses configuradas
   */
  @Get('quick-responses')
  async getQuickResponses() {
    const responses = this.assistantService.getQuickResponsePatterns();

    return {
      success: true,
      data: responses,
    };
  }

  /**
   * GET /api/assistant/performance
   * Métricas de performance
   */
  @Get('performance')
  async getPerformance(@Query('days') days = 7) {
    const performance = await this.assistantService.getPerformanceMetrics(
      Number(days),
    );

    return {
      success: true,
      data: performance,
    };
  }

  /**
   * GET /api/assistant/conversations/:userId
   * Histórico de conversas
   */
  @Get('conversations/:userId')
  async getConversations(
    @Param('userId') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [conversations, total] = await Promise.all([
      this.assistantService.getUserConversations(userId, skip, take),
      this.assistantService.getUserConversationsCount(userId),
    ]);

    return {
      success: true,
      data: conversations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  /**
   * GET /api/assistant/not-understood
   * Mensagens não compreendidas (para treinar)
   */
  @Get('not-understood')
  async getNotUnderstood(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit = 50,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const messages = await this.assistantService.getNotUnderstoodMessages(
      start,
      end,
      Number(limit),
    );

    return {
      success: true,
      data: messages,
    };
  }

  /**
   * POST /api/assistant/train
   * Adiciona exemplo de treinamento
   */
  @Post('train')
  @HttpCode(HttpStatus.CREATED)
  async train(
    @Body()
    body: {
      message: string;
      intent: string;
      entities?: Record<string, any>;
    },
  ) {
    await this.assistantService.addTrainingExample(
      body.message,
      body.intent,
      body.entities,
    );

    return {
      success: true,
      message: 'Training example added successfully',
    };
  }
}
