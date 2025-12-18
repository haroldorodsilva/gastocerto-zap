-- ================================================
-- Script para Habilitar RAG
-- ================================================
-- Data: 18/12/2025
-- Descrição: Habilita o sistema RAG para preencher
--            a tabela rAGSearchLog com analytics
-- ================================================

-- 1. VERIFICAR CONFIGURAÇÃO ATUAL
SELECT 
  "ragEnabled" as "RAG_Habilitado",
  "ragAiEnabled" as "RAG_usa_IA",
  "ragAiProvider" as "Provider_IA",
  "ragThreshold" as "Threshold_Minimo",
  "ragCacheEnabled" as "Cache_Habilitado"
FROM "AISettings";

-- 2. OPÇÃO A: HABILITAR RAG COM BM25 (SEM IA - GRATUITO, RÁPIDO)
-- Recomendado para começar
UPDATE "AISettings" 
SET 
  "ragEnabled" = true,
  "ragAiEnabled" = false,  -- BM25 puro, sem custo de API
  "ragThreshold" = 0.6;    -- 60% de confiança mínima

-- 3. OPÇÃO B: HABILITAR RAG COM IA (EMBEDDINGS VETORIAIS - MAIS PRECISO, MAS PAGO)
-- Usar apenas se precisar máxima precisão
UPDATE "AISettings" 
SET 
  "ragEnabled" = true,
  "ragAiEnabled" = true,       -- Usa embeddings de IA
  "ragAiProvider" = 'openai',  -- ou 'google_gemini', 'groq'
  "ragThreshold" = 0.5;        -- 50% para busca vetorial

-- 4. VERIFICAR SE FUNCIONOU
SELECT 
  "ragEnabled" as "RAG_Habilitado",
  "ragAiEnabled" as "RAG_usa_IA",
  "ragAiProvider" as "Provider_IA",
  "ragThreshold" as "Threshold_Minimo"
FROM "AISettings";

-- 5. VERIFICAR LOGS (APÓS ENVIAR MENSAGEM DE TESTE)
-- Envie: "gastei 33,33 no supermercado"
-- Aguarde 5 segundos
-- Execute:
SELECT 
  "id",
  "query" as "Busca",
  "bestMatch" as "Melhor_Match",
  "bestScore" as "Score",
  "success" as "Sucesso",
  "ragMode" as "Modo",
  "responseTime" as "Tempo_ms",
  "createdAt" as "Data"
FROM "rAGSearchLog" 
ORDER BY "createdAt" DESC 
LIMIT 10;

-- ================================================
-- DICAS
-- ================================================
-- 
-- BM25 (ragAiEnabled=false):
-- ✅ Gratuito
-- ✅ Rápido (<50ms)
-- ✅ Bom para keywords e sinônimos
-- ❌ Não entende contexto semântico profundo
--
-- AI Embeddings (ragAiEnabled=true):
-- ✅ Busca semântica avançada
-- ✅ Entende contexto e intenção
-- ❌ Custo de API (OpenAI, Gemini)
-- ❌ Mais lento (200-500ms)
--
-- Recomendação: Começar com BM25 e habilitar IA
--               apenas se precisar mais precisão
-- ================================================
