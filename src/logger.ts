interface Logger {
  info(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  child(component: { component: string }): Logger;
}

// Simple logger implementation compatible with Bun
const logger: Logger = {
  info: (obj: object | string, msg?: string) => {
    if (typeof obj === 'string') {
      console.error('[INFO]', obj);
    } else {
      console.error('[INFO]', msg || '', obj);
    }
  },
  error: (obj: object | string, msg?: string) => {
    if (typeof obj === 'string') {
      console.error('[ERROR]', obj);
    } else {
      console.error('[ERROR]', msg || '', obj);
    }
  },
  warn: (obj: object | string, msg?: string) => {
    if (typeof obj === 'string') {
      console.error('[WARN]', obj);
    } else {
      console.error('[WARN]', msg || '', obj);
    }
  },
  debug: (obj: object | string, msg?: string) => {
    if (typeof obj === 'string') {
      console.error('[DEBUG]', obj);
    } else {
      console.error('[DEBUG]', msg || '', obj);
    }
  },
  child: (component: { component: string }): Logger => ({
    info: (obj: object | string, msg?: string) => {
      if (typeof obj === 'string') {
        console.error(`[INFO][${component.component}]`, obj);
      } else {
        console.error(`[INFO][${component.component}]`, msg || '', obj);
      }
    },
    error: (obj: object | string, msg?: string) => {
      if (typeof obj === 'string') {
        console.error(`[ERROR][${component.component}]`, obj);
      } else {
        console.error(`[ERROR][${component.component}]`, msg || '', obj);
      }
    },
    warn: (obj: object | string, msg?: string) => {
      if (typeof obj === 'string') {
        console.error(`[WARN][${component.component}]`, obj);
      } else {
        console.error(`[WARN][${component.component}]`, msg || '', obj);
      }
    },
    debug: (obj: object | string, msg?: string) => {
      if (typeof obj === 'string') {
        console.error(`[DEBUG][${component.component}]`, obj);
      } else {
        console.error(`[DEBUG][${component.component}]`, msg || '', obj);
      }
    },
    child: (childComponent: { component: string }): Logger =>
      logger.child({
        component: `${component.component}:${childComponent.component}`,
      }),
  }),
};

export function createServerLogger() {
  return logger.child({ component: 'server' });
}

export function createToolsLogger() {
  return logger.child({ component: 'tools' });
}

export function createDbLogger() {
  return logger.child({ component: 'database' });
}

export default logger;
