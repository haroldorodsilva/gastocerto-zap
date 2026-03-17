import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsAppSessionManager } from '@infrastructure/whatsapp/providers/baileys/whatsapp-session-manager.service';
import { MultiPlatformSessionService } from '@infrastructure/sessions/core/multi-platform-session.service';
import { ConfigService } from '@nestjs/config';

/**
 * Métricas de saúde de uma sessão individual
 */
export interface SessionHealthInfo {
  sessionId: string;
  platform: 'whatsapp' | 'telegram';
  connected: boolean;
  /** Tempo em minutos desde última atividade conhecida */
  idleMinutes?: number;
}

/**
 * Snapshot completo de saúde do sistema
 */
export interface HealthSnapshot {
  timestamp: Date;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    heapUsagePercent: number;
  };
  sessions: {
    whatsapp: { active: number; connected: number };
    telegram: { active: number; connected: number };
    total: number;
  };
  uptime: number; // segundos
  warnings: string[];
}

/**
 * SessionHealthMonitorService
 *
 * Monitora uso de memória e saúde das sessões
 * WhatsApp (Baileys) e Telegram a cada 5 minutos.
 *
 * - Emite warnings em log quando memória ultrapassa thresholds
 * - Detecta sessões stale (sem conexão real)
 * - Fornece snapshot para admin endpoints
 */
@Injectable()
export class SessionHealthMonitorService {
  private readonly logger = new Logger(SessionHealthMonitorService.name);

  /** MB — alerta amarelo */
  private readonly MEMORY_WARN_MB: number;
  /** MB — alerta vermelho + ação de cleanup */
  private readonly MEMORY_CRITICAL_MB: number;
  /** Minutos sem atividade para considerar stale */
  private readonly STALE_THRESHOLD_MIN: number;

  /** Último snapshot para consulta síncrona */
  private lastSnapshot: HealthSnapshot | null = null;

  constructor(
    private readonly whatsAppSessionManager: WhatsAppSessionManager,
    private readonly multiPlatformSession: MultiPlatformSessionService,
    private readonly configService: ConfigService,
  ) {
    this.MEMORY_WARN_MB = Number(this.configService.get('MEMORY_WARN_MB', '512'));
    this.MEMORY_CRITICAL_MB = Number(this.configService.get('MEMORY_CRITICAL_MB', '768'));
    this.STALE_THRESHOLD_MIN = Number(this.configService.get('SESSION_STALE_MINUTES', '30'));
  }

  // ─── Periodic Check ────────────────────────────────────────

  /**
   * Executa a cada 5 minutos — coleta métricas, loga warnings,
   * age em caso de memória crítica.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performHealthCheck(): Promise<void> {
    try {
      const snapshot = await this.collectSnapshot();
      this.lastSnapshot = snapshot;

      // Log resumido
      this.logger.log(
        `📊 Health | Mem ${snapshot.memory.heapUsedMB}/${snapshot.memory.heapTotalMB} MB ` +
          `(${snapshot.memory.heapUsagePercent.toFixed(1)}%) | RSS ${snapshot.memory.rssMB} MB | ` +
          `Sessions: WA ${snapshot.sessions.whatsapp.connected}/${snapshot.sessions.whatsapp.active} ` +
          `TG ${snapshot.sessions.telegram.connected}/${snapshot.sessions.telegram.active}`,
      );

      // Warnings
      for (const w of snapshot.warnings) {
        this.logger.warn(`⚠️  ${w}`);
      }

      // Ação crítica: forçar GC se disponível
      if (snapshot.memory.rssMB >= this.MEMORY_CRITICAL_MB) {
        this.logger.error(
          `🚨 CRITICAL MEMORY: RSS ${snapshot.memory.rssMB} MB >= ${this.MEMORY_CRITICAL_MB} MB`,
        );

        // Tentar garbage collection se exposto via --expose-gc
        if (global.gc) {
          this.logger.warn('🗑️  Forçando garbage collection...');
          global.gc();
        }
      }
    } catch (error) {
      this.logger.error('Erro no health check', error);
    }
  }

  // ─── Snapshot público ──────────────────────────────────────

  /**
   * Retorna último snapshot (ou coleta um novo se nunca executou)
   */
  async getHealthSnapshot(): Promise<HealthSnapshot> {
    if (!this.lastSnapshot) {
      this.lastSnapshot = await this.collectSnapshot();
    }
    return this.lastSnapshot;
  }

  /**
   * Retorna último snapshot síncrono (pode ser null se nunca coletou)
   */
  getLastSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot;
  }

  // ─── Coleta interna ────────────────────────────────────────

  private async collectSnapshot(): Promise<HealthSnapshot> {
    const mem = process.memoryUsage();
    const warnings: string[] = [];

    // Métricas de memória
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const externalMB = Math.round(mem.external / 1024 / 1024);
    const heapUsagePercent = (mem.heapUsed / mem.heapTotal) * 100;

    if (rssMB >= this.MEMORY_CRITICAL_MB) {
      warnings.push(`CRITICAL: RSS memory ${rssMB} MB exceeds ${this.MEMORY_CRITICAL_MB} MB`);
    } else if (rssMB >= this.MEMORY_WARN_MB) {
      warnings.push(`WARNING: RSS memory ${rssMB} MB exceeds ${this.MEMORY_WARN_MB} MB`);
    }

    if (heapUsagePercent > 90) {
      warnings.push(`Heap usage at ${heapUsagePercent.toFixed(1)}% — possible memory leak`);
    }

    // Sessões WhatsApp
    const waActiveIds = this.whatsAppSessionManager.getActiveSessionIds();
    let waConnected = 0;
    for (const sid of waActiveIds) {
      if (this.whatsAppSessionManager.isSessionConnected(sid)) {
        waConnected++;
      } else {
        warnings.push(`WhatsApp session ${sid} is active but not connected`);
      }
    }

    // Sessões Telegram (via MultiPlatformSessionService)
    const tgSessions = this.multiPlatformSession.getActiveSessions();
    let tgActive = 0;
    let tgConnected = 0;
    for (const s of tgSessions) {
      // PlatformSession é interface interna — acessamos campos diretamente
      const session = s as any;
      if (session.platform === 'telegram') {
        tgActive++;
        if (session.isConnected) {
          tgConnected++;
        } else {
          warnings.push(`Telegram session ${session.sessionId} is active but not connected`);
        }
      }
    }

    return {
      timestamp: new Date(),
      memory: {
        heapUsedMB,
        heapTotalMB,
        rssMB,
        externalMB,
        heapUsagePercent,
      },
      sessions: {
        whatsapp: { active: waActiveIds.length, connected: waConnected },
        telegram: { active: tgActive, connected: tgConnected },
        total: waActiveIds.length + tgActive,
      },
      uptime: process.uptime(),
      warnings,
    };
  }
}
