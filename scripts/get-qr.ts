import { PrismaClient } from '@prisma/client';
import * as qrcode from 'qrcode-terminal';

const prisma = new PrismaClient();

async function getQRCode() {
  try {
    // Buscar a sessão mais recente
    const session = await prisma.whatsAppSession.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      console.log('❌ Nenhuma sessão encontrada');
      return;
    }

    console.log(`\n📱 Sessão: ${session.name}`);
    console.log(`🆔 ID: ${session.sessionId}`);
    console.log(`📊 Status: ${session.status}\n`);

    // O QR code fica armazenado em memória na aplicação
    // Vamos buscar via API local
    const sessionId = session.id;
    
    console.log(`\n📋 Para ver o QR Code, abra em outro terminal:\n`);
    console.log(`   curl http://localhost:4444/whatsapp/${sessionId}/qr | jq -r '.qrCode'\n`);
    console.log(`Ou acesse no navegador:`);
    console.log(`   http://localhost:4444/whatsapp/${sessionId}/qr\n`);
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

getQRCode();
