import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule - Módulo global que fornece uma única instância do PrismaService
 * para toda a aplicação, evitando múltiplas conexões ao banco de dados.
 *
 * @Global decorator garante que o PrismaService seja singleton em toda a app
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
