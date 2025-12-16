# 🚀 Guia de Deploy - GastoCerto ZAP

## 📋 Pré-requisitos

### 1. Servidor
- **OS**: Ubuntu 20.04+ ou similar
- **RAM**: Mínimo 2GB (recomendado 4GB)
- **CPU**: 2 cores
- **Storage**: 20GB

### 2. Software Necessário
```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (gerenciador de processos)
sudo npm install -g pm2

# PostgreSQL 14+
sudo apt-get install -y postgresql postgresql-contrib

# Redis
sudo apt-get install -y redis-server
```

### 3. Variáveis de Ambiente Obrigatórias
Copie `.env.example` para `.env` e preencha:

```bash
# Essenciais
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
OPENAI_API_KEY="sk-proj-..."
GOOGLE_AI_API_KEY="AIza..."
GROQ_API_KEY="gsk_..."
GASTO_CERTO_API_URL="https://api.gastocerto.com.br/api"
SERVICE_SHARED_SECRET="sua-chave-secreta-aqui"
```

## 🔧 Setup Inicial

### 1. Clonar Repositório
```bash
git clone https://github.com/seu-usuario/gastocerto-zap.git
cd gastocerto-zap
```

### 2. Configurar Ambiente
```bash
# Copiar .env
cp .env.example .env
nano .env  # Editar com suas credenciais

# Instalar dependências
npm ci

# Executar migrações
npx prisma migrate deploy
npx prisma generate
```

### 3. Build
```bash
npm run build
```

### 4. Testar Localmente
```bash
npm run start:prod
```

## 🚀 Deploy com PM2

### Primeira Vez
```bash
# Tornar script executável
chmod +x deploy.sh

# Executar deploy
./deploy.sh

# Configurar PM2 para iniciar no boot
pm2 startup
# Copie e execute o comando que aparece
pm2 save
```

### Deploys Subsequentes
```bash
./deploy.sh
```

## 📊 Monitoramento

### Ver Logs em Tempo Real
```bash
pm2 logs gastocerto-zap
```

### Monitoramento Interativo
```bash
pm2 monit
```

### Status do Serviço
```bash
pm2 status
```

### Informações Detalhadas
```bash
pm2 show gastocerto-zap
```

## 🔄 Operações Comuns

### Reiniciar Serviço
```bash
pm2 restart gastocerto-zap
```

### Reload sem Downtime
```bash
pm2 reload gastocerto-zap
```

### Parar Serviço
```bash
pm2 stop gastocerto-zap
```

### Remover do PM2
```bash
pm2 delete gastocerto-zap
```

## 🗄️ Backup do Banco

### Backup Manual
```bash
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql
```

### Backup Automático (Cron)
```bash
# Adicionar ao crontab
crontab -e

# Backup diário às 2h da manhã
0 2 * * * pg_dump "postgresql://..." > /backups/gastocerto_$(date +\%Y\%m\%d).sql
```

### Restaurar Backup
```bash
psql "$DATABASE_URL" < backup_20251216.sql
```

## 🔐 Segurança

### 1. Firewall
```bash
# Permitir apenas portas necessárias
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. SSL/TLS (Nginx Reverse Proxy)
```nginx
server {
    listen 443 ssl http2;
    server_name zap.gastocerto.com.br;

    ssl_certificate /etc/letsencrypt/live/zap.gastocerto.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zap.gastocerto.com.br/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Variáveis Sensíveis
- ✅ **NUNCA** commitar `.env` no Git
- ✅ Usar secrets do GitHub Actions para CI/CD
- ✅ Rotacionar API keys periodicamente

## 📈 Performance

### Redis Cache
```bash
# Verificar status do Redis
redis-cli ping

# Limpar cache (se necessário)
redis-cli FLUSHALL
```

### PostgreSQL Tuning
```bash
# Editar postgresql.conf
sudo nano /etc/postgresql/14/main/postgresql.conf

# Aumentar conexões
max_connections = 100

# Aumentar shared buffers
shared_buffers = 256MB

# Reiniciar PostgreSQL
sudo systemctl restart postgresql
```

## 🐛 Troubleshooting

### Serviço não inicia
```bash
# Ver erro específico
pm2 logs gastocerto-zap --err --lines 50

# Verificar permissões
ls -la logs/
chmod 755 logs/

# Verificar se porta está livre
lsof -i :3000
```

### WhatsApp desconectando
```bash
# Deletar sessão antiga
rm -rf .wwebjs_auth

# Reiniciar serviço
pm2 restart gastocerto-zap

# Verificar QR Code nos logs
pm2 logs gastocerto-zap | grep QR
```

### Banco de dados lento
```bash
# Ver queries lentas
psql "$DATABASE_URL" -c "
  SELECT query, mean_exec_time 
  FROM pg_stat_statements 
  ORDER BY mean_exec_time DESC 
  LIMIT 10;
"

# Reindexar
npm run prisma:studio
```

## 📝 Logs

Logs são salvos em:
- `logs/out.log` - Logs normais
- `logs/error.log` - Erros

### Rotação de Logs
```bash
# Instalar logrotate
sudo apt-get install logrotate

# Configurar rotação
sudo nano /etc/logrotate.d/gastocerto-zap
```

Conteúdo:
```
/var/www/gastocerto-zap/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    notifempty
    create 0640 deploy deploy
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

## 🔄 CI/CD (GitHub Actions)

Criar `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /var/www/gastocerto-zap
            ./deploy.sh
```

## 📞 Suporte

Em caso de problemas:
1. Verificar logs: `pm2 logs gastocerto-zap`
2. Ver documentação: `docs/`
3. Contatar time de desenvolvimento

---

**Última atualização**: 16/12/2025
