import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';

interface CreateCredentialDto {
  provider: string;
  label: string;
  apiKey: string;
  priority?: number;
  isActive?: boolean;
}

interface UpdateCredentialDto {
  label?: string;
  apiKey?: string;
  priority?: number;
  isActive?: boolean;
}

@Controller('admin/ai-credentials')
@UseGuards(JwtAuthGuard)
export class AdminAICredentialsController {
  private readonly logger = new Logger(AdminAICredentialsController.name);

  constructor(private readonly prisma: PrismaService) {}

  private maskApiKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.substring(0, 4)}****${key.substring(key.length - 4)}`;
  }

  /**
   * GET /admin/ai-credentials
   * Lista todas as credenciais agrupadas por provider.
   * apiKey é mascarada na resposta.
   */
  @Get()
  async listCredentials() {
    this.logger.log('📋 Admin listando credenciais de IA');
    const credentials = await this.prisma.aIProviderCredential.findMany({
      orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
    });

    return {
      success: true,
      data: credentials.map((c) => ({
        ...c,
        apiKey: this.maskApiKey(c.apiKey),
      })),
    };
  }

  /**
   * GET /admin/ai-credentials/status
   * Resumo por provider: total, ativas, esgotadas.
   * Deve vir ANTES de /:id para não colidir com o param.
   */
  @Get('status')
  async getStatus() {
    this.logger.log('📊 Admin consultando status das credenciais de IA');

    const all = await this.prisma.aIProviderCredential.findMany({
      select: {
        provider: true,
        isActive: true,
        isExhausted: true,
        exhaustedAt: true,
        exhaustedReason: true,
        totalRequests: true,
        totalErrors: true,
        lastUsedAt: true,
        label: true,
        priority: true,
      },
      orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
    });

    const providers = ['openai', 'google_gemini', 'groq', 'deepseek'];
    const summary = providers.map((provider) => {
      const creds = all.filter((c) => c.provider === provider);
      return {
        provider,
        total: creds.length,
        active: creds.filter((c) => c.isActive && !c.isExhausted).length,
        inactive: creds.filter((c) => !c.isActive).length,
        exhausted: creds.filter((c) => c.isExhausted).length,
        credentials: creds,
      };
    });

    return {
      success: true,
      data: summary,
    };
  }

  /**
   * POST /admin/ai-credentials
   * Cria uma nova credencial para um provider.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCredential(@Body() body: CreateCredentialDto) {
    this.logger.log(`➕ Admin criando credencial para provider: ${body.provider}`);

    const credential = await this.prisma.aIProviderCredential.create({
      data: {
        provider: body.provider,
        label: body.label,
        apiKey: body.apiKey,
        priority: body.priority ?? 100,
        isActive: body.isActive ?? true,
      },
    });

    return {
      success: true,
      message: 'Credencial criada com sucesso',
      data: {
        ...credential,
        apiKey: this.maskApiKey(credential.apiKey),
      },
    };
  }

  /**
   * PUT /admin/ai-credentials/:id
   * Atualiza label, apiKey, priority ou isActive de uma credencial.
   * Se apiKey não for enviada, não sobrescreve a existente.
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateCredential(@Param('id') id: string, @Body() body: UpdateCredentialDto) {
    this.logger.log(`✏️  Admin atualizando credencial ${id}`);

    const existing = await this.prisma.aIProviderCredential.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Credencial não encontrada');

    const updateData: any = {};
    if (body.label !== undefined) updateData.label = body.label;
    if (body.apiKey) updateData.apiKey = body.apiKey; // só sobrescreve se enviado
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
      // Se reativar, limpar flags de esgotamento
      if (body.isActive) {
        updateData.isExhausted = false;
        updateData.exhaustedAt = null;
        updateData.exhaustedReason = null;
      }
    }

    const updated = await this.prisma.aIProviderCredential.update({
      where: { id },
      data: updateData,
    });

    return {
      success: true,
      message: 'Credencial atualizada com sucesso',
      data: {
        ...updated,
        apiKey: this.maskApiKey(updated.apiKey),
      },
    };
  }

  /**
   * DELETE /admin/ai-credentials/:id
   * Remove uma credencial. Não permite remover a última ativa de um provider.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteCredential(@Param('id') id: string) {
    this.logger.log(`🗑️  Admin removendo credencial ${id}`);

    const existing = await this.prisma.aIProviderCredential.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Credencial não encontrada');

    // Verificar se é a última ativa do provider
    const activeCount = await this.prisma.aIProviderCredential.count({
      where: { provider: existing.provider, isActive: true },
    });

    if (activeCount <= 1 && existing.isActive) {
      return {
        success: false,
        message: `Não é possível remover a última credencial ativa do provider ${existing.provider}. Desative-a antes ou adicione outra.`,
      };
    }

    await this.prisma.aIProviderCredential.delete({ where: { id } });

    return {
      success: true,
      message: 'Credencial removida com sucesso',
    };
  }

  /**
   * POST /admin/ai-credentials/reset-exhausted
   * Reseta manualmente todas as flags isExhausted (sem esperar o cron diário).
   */
  @Post('reset-exhausted')
  @HttpCode(HttpStatus.OK)
  async resetExhausted() {
    this.logger.log('🔄 Admin resetando flags de esgotamento manualmente');

    const result = await this.prisma.aIProviderCredential.updateMany({
      where: { isExhausted: true },
      data: {
        isExhausted: false,
        exhaustedAt: null,
        exhaustedReason: null,
      },
    });

    return {
      success: true,
      message: `${result.count} credencial(is) resetada(s) com sucesso`,
      count: result.count,
    };
  }
}
