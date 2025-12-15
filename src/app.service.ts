import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'GastoCerto-ZAP API is running! 🚀';
  }
}
