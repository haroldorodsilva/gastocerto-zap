import axios from 'axios';
import * as crypto from 'crypto';

/**
 * Script para testar validação de JWT token
 * Simula o que JwtValidationService faz
 */

const API_URL = 'https://gastocerto-api-hlg.onrender.com/api';
const SHARED_SECRET = 'yMIICWgIBAAKBgG2caR2ppAMgTW4XbZLkI4UxUBdkEKLXCrbC8B5ymZ2tCkjQHik27B801gbSDKJNF970f7sqO22UCgawnm/SV02GRJ3hHzXlV1ZQplpD/X363XGMw12qGdfffnII1LE33Oljeo/hGpyn3Ih39K19ZytpvC+HLpUeJvQBrCT0rwktAgMBAAEC';
const SERVICE_ID = 'gastocerto-zap';

// Token JWT do teste
const JWT_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MDJmYTBhZC00OGU1LTQyYWUtYjIxZC0wZDgxZDY3Y2ZmMmUiLCJ1c2VybmFtZSI6ImJ5bWFzY290QGdtYWlsLmNvbSIsImlhdCI6MTczNjc2MDk0OCwiZXhwIjoxNzM2Nzc1Mzg1fQ.Ls5knIJY4BBNMMGheGxv-VixLi5LGtcGsTHDdEHoiafhKKLRS5PGBoko4JGaaZbNGY33Flmvt_eaHnEIoamIXw0P8RdFGcaymbTcPtqGCnRSlwMEriRBebTlVGdaSrZR0OXH41yMTPOj8PQfSRvPM3-6Z2DcDvwtQv3cqZpGztiwSTbmKY4PxNHUlePGyHycBP-JdUMisC1Cs4sCBOxFa1PdLWG-gNi5T43IlODIMQv-Q_SfWeyP_ARf3mXoX-YCWkv4IFh3trp9R0WweV_Wskz1FjOa5QBkLFs5w19aYll6Wu8SqwlfwLQyH1UaT74VZWN8i6kGwntM_H_V4AlFWA';

function generateSignature(timestamp: string, body: string): string {
  const payload = `${timestamp}:${body}`;
  return crypto.createHmac('sha256', SHARED_SECRET).update(payload).digest('hex');
}

function generateAuthHeaders(body: any): Record<string, string> {
  const timestamp = Date.now().toString();
  const bodyStr = JSON.stringify(body);
  const signature = generateSignature(timestamp, bodyStr);

  return {
    'x-service-id': SERVICE_ID,
    'x-timestamp': timestamp,
    'x-signature': signature,
  };
}

async function testValidateToken() {
  console.log('🧪 Testing JWT Token Validation\n');
  
  // Decodifica JWT para ver o conteúdo
  const parts = JWT_TOKEN.split('.');
  if (parts.length === 3) {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    console.log('📄 JWT Payload:');
    console.log(JSON.stringify(payload, null, 2));
    
    const now = Math.floor(Date.now() / 1000);
    const iat = payload.iat;
    const exp = payload.exp;
    
    console.log(`\n⏰ Token Times:`);
    console.log(`   Issued At (iat): ${new Date(iat * 1000).toISOString()}`);
    console.log(`   Expires At (exp): ${new Date(exp * 1000).toISOString()}`);
    console.log(`   Current Time: ${new Date(now * 1000).toISOString()}`);
    console.log(`   Is Expired? ${now > exp ? '❌ YES' : '✅ NO'}`);
    console.log(`   Time until expiry: ${exp - now} seconds`);
  }

  console.log('\n🔐 Generating HMAC signature...');
  const body = { token: JWT_TOKEN };
  const headers = generateAuthHeaders(body);
  
  console.log('📤 Request Headers:');
  console.log(JSON.stringify(headers, null, 2));
  
  console.log('\n📡 Calling gastocerto-api...');
  
  try {
    const response = await axios.post(
      `${API_URL}/external/auth/validate-token`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        timeout: 30000,
      }
    );
    
    console.log('\n✅ API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.valid) {
      console.log('\n🎉 Token is VALID!');
      console.log('User:', response.data.payload);
    } else {
      console.log('\n⚠️  Token validation returned false');
    }
    
  } catch (error: any) {
    console.log('\n❌ API Error:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Message:', error.response.data?.message || error.response.statusText);
      console.log('Full response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.code === 'ECONNREFUSED') {
      console.log('❌ Cannot connect to API at', API_URL);
    } else {
      console.log('Error:', error.message);
    }
  }
}

testValidateToken();
