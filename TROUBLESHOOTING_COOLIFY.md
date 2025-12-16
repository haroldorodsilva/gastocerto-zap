# 🔧 Solução: Erro "Dockerfile not found" no Coolify

## ❌ Erro:
```
ERROR: failed to build: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

## ✅ Solução:

### Passo 1: Verificar configurações no Coolify

1. Vá em **Applications** → **gastocerto-zap** → **General**
2. Verifique as seguintes configurações:

#### Build Settings:
- **Build Pack**: `dockerfile` (ou "Dockerfile")
- **Dockerfile Location**: `./Dockerfile` ou apenas `/Dockerfile`
- **Docker Compose File Location**: *(deixar vazio)*
- **Base Directory**: `.` (ponto, indica raiz do projeto)

#### Source:
- **Branch**: `main` (ou o nome da sua branch principal)
- **Git Commit SHA**: (deixar vazio para usar o último commit)

### Passo 2: Configurar Build no Coolify

Se a opção "Build Pack" não estiver disponível, configure manualmente:

1. Vá em **Build**
2. Em **Buildpacks**, selecione: `Dockerfile`
3. Em **Dockerfile Path**, coloque: `Dockerfile` (sem barra no início)

### Passo 3: Verificar arquivos no repositório

Execute localmente para confirmar que está tudo commitado:

```bash
# Verificar se Dockerfile está no último commit
git ls-files | grep Dockerfile

# Verificar último commit
git log -1 --name-only

# Fazer push se necessário
git push origin main
```

### Passo 4: Forçar rebuild no Coolify

1. No Coolify, vá em **Deployments**
2. Clique em **Redeploy** (ou Deploy novamente)
3. Marque a opção **Force Rebuild** se disponível

---

## 📋 Checklist de configuração:

- [ ] Dockerfile existe na raiz do projeto ✅
- [ ] Dockerfile está commitado no Git ✅
- [ ] Push foi feito para o branch correto ✅
- [ ] Coolify está apontando para o branch correto (main)
- [ ] Build Pack = "dockerfile" no Coolify
- [ ] Dockerfile Location = "./Dockerfile" ou "Dockerfile"
- [ ] Base Directory = "."

---

## 🐛 Se ainda não funcionar:

### Opção 1: Verificar configuração do Git no Coolify

1. Vá em **Source** (ou Git)
2. Confirme que está usando o repositório correto
3. Clique em **Refresh** ou **Sync** para atualizar

### Opção 2: Verificar logs detalhados

1. No erro de deployment, clique em **Show Debug Logs**
2. Procure por:
   - `Cloning repository...`
   - `Checking out branch main...`
   - `Looking for Dockerfile at...`

### Opção 3: Testar build localmente

```bash
# Testar se o Dockerfile funciona
docker build -t gastocerto-zap-test .

# Se funcionar, o problema é na configuração do Coolify
```

---

## 📝 Configuração correta final:

```yaml
# No Coolify UI:
Source:
  Repository: haroldorodsilva/gastocerto-zap
  Branch: main
  
Build:
  Type: Dockerfile
  Dockerfile: Dockerfile
  Context: .
  
General:
  Port: 3000
  Health Check Path: /health
```

---

## ✅ Depois que funcionar:

O Coolify vai:
1. ✅ Clonar o repositório
2. ✅ Encontrar o Dockerfile na raiz
3. ✅ Executar o multi-stage build
4. ✅ Rodar `prisma migrate deploy` no startup
5. ✅ Iniciar a aplicação na porta 3000

**Pronto! Deploy funcionando! 🎉**
