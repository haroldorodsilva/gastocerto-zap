import { Module } from '@nestjs/common';
import { MessagingGateway } from './messaging.gateway';

@Module({
  providers: [MessagingGateway],
  exports: [MessagingGateway],
})
export class GatewayModule {}
