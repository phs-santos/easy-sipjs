export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

export class Logger {
    private prefix: string;
    private level: LogLevel;

    constructor(prefix = "SIP", level: LogLevel = "info") {
        this.prefix = prefix;
        this.level = level;
    }

    private shouldLog(targetLevel: LogLevel): boolean {
        const order: LogLevel[] = ["debug", "info", "warn", "error", "none"];
        return (
            order.indexOf(targetLevel) >= order.indexOf(this.level) &&
            this.level !== "none"
        );
    }

    debug(...args: any[]) {
        if (this.shouldLog("debug")) {
            console.debug(`[${this.prefix}] [DEBUG]`, ...args);
        }
    }

    info(...args: any[]) {
        if (this.shouldLog("info")) {
            console.info(`[${this.prefix}] [INFO]`, ...args);
        }
    }

    warn(...args: any[]) {
        if (this.shouldLog("warn")) {
            console.warn(`[${this.prefix}] [WARN]`, ...args);
        }
    }

    error(...args: any[]) {
        if (this.shouldLog("error")) {
            console.error(`[${this.prefix}] [ERROR]`, ...args);
        }
    }

    setLevel(level: LogLevel) {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }
}

/** Instância global padrão da lib */
export const logger = new Logger("SIP", "info");
