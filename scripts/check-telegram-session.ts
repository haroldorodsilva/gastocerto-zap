import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTelegramSessions() {
  try {
    console.log('🔍 Checking Telegram sessions...\n');

    const sessions = await prisma.telegramSession.findMany({
      select: {
        id: true,
        sessionId: true,
        name: true,
        token: true,
        status: true,
        isActive: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (sessions.length === 0) {
      console.log('❌ No Telegram sessions found in database!');
      console.log('\n💡 Create a session first:');
      console.log('   POST /telegram');
      console.log('   Body: { "name": "My Bot", "token": "YOUR_BOT_TOKEN" }');
      return;
    }

    console.log(`📊 Found ${sessions.length} session(s):\n`);

    sessions.forEach((session, index) => {
      console.log(`${index + 1}. Session: ${session.name}`);
      console.log(`   ID: ${session.id}`);
      console.log(`   SessionId: ${session.sessionId}`);
      console.log(`   Token: ${session.token ? '***' + session.token.slice(-10) : 'NOT SET'}`);
      console.log(`   Status: ${session.status}`);
      console.log(`   Is Active: ${session.isActive ? '✅ YES' : '❌ NO'}`);
      console.log(`   Last Seen: ${session.lastSeen || 'Never'}`);
      console.log(`   Created: ${session.createdAt}`);
      console.log(`   Updated: ${session.updatedAt}`);
      console.log('');

      if (!session.isActive) {
        console.log(`   ⚠️  This session is INACTIVE. Activate it with:`);
        console.log(`   POST /telegram/${session.id}/activate\n`);
      }

      if (session.status === 'DISCONNECTED') {
        console.log(`   ⚠️  This session is DISCONNECTED. Status will update when activated.\n`);
      }
    });

    const activeSessions = sessions.filter((s) => s.isActive);
    const connectedSessions = sessions.filter((s) => s.status === 'CONNECTED');

    console.log('📈 Summary:');
    console.log(`   Total sessions: ${sessions.length}`);
    console.log(`   Active (isActive=true): ${activeSessions.length}`);
    console.log(`   Connected (status=CONNECTED): ${connectedSessions.length}`);
    console.log('');

    if (activeSessions.length === 0) {
      console.log('⚠️  WARNING: No active sessions! Bot will not receive messages.');
      console.log('   Activate at least one session to start receiving messages.');
    } else if (connectedSessions.length === 0) {
      console.log('⚠️  WARNING: No connected sessions! Bot may not be polling.');
      console.log('   Check server logs for connection errors.');
    } else {
      console.log('✅ You have active and connected sessions!');
      console.log('   Send a message to your bot to test.');
    }
  } catch (error) {
    console.error('❌ Error checking sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTelegramSessions();
