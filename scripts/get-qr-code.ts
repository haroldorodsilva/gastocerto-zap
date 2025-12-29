import { PrismaClient } from '@prisma/client';
import qrcode from 'qrcode-terminal';

const prisma = new PrismaClient();

async function getQRCode() {
  try {
    // Buscar a sessão mais recente
    const session = await prisma.whatsAppSession.findFirst({
      where: {
        sessionId: 'whatsapp-1766750804123'
      }
    });

    if (!session) {
      console.log('❌ Sessão não encontrada');
      return;
    }

    console.log('📋 Sessão encontrada:');
    console.log('   - Nome:', session.name);
    console.log('   - Status:', session.status);
    console.log('   - ID:', session.id);
    console.log('');

    // Tentar pegar QR via API
    const fetch = (await import('node-fetch')).default;
    
    try {
      const response = await fetch(`http://localhost:4444/whatsapp/${session.id}/qr`);
      const data = await response.json();
      
      if (data.qrCode) {
        console.log('📱 QR CODE ENCONTRADO! Escaneie com seu WhatsApp:');
        console.log('');
        qrcode.generate(data.qrCode, { small: true });
        console.log('');
        console.log('✅ Após escanear, aguarde a conexão...');
      } else {
        console.log('⚠️ QR Code ainda não disponível');
        console.log('💡 Aguarde alguns segundos e tente novamente');
      }
    } catch (error: any) {
      console.log('⚠️ Erro ao buscar QR via API:', error.message);
      console.log('💡 A sessão pode ainda estar inicializando. Aguarde e tente novamente.');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getQRCode();
