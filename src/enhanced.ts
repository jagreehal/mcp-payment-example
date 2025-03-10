import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createDbLogger,
  createServerLogger,
  createToolsLogger,
} from './logger.js';

const serverLogger = createServerLogger();
const dbLogger = createDbLogger();
const toolsLogger = createToolsLogger();

// Initialise MCP server with enhanced metadata and explicit capabilities
const server = new McpServer(
  {
    name: 'EnhancedPaymentSystem',
    version: '2.0.0',
    description:
      'Advanced payment processing with currency conversion and fraud detection',
    vendor: 'Reehal Time Payments Inc.',
    homepage: 'https://reehal-time-payments.com',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

type Payment = {
  id: string;
  amount: number;
  status: string;
  payee: string;
  currency: string;
  timestamp?: string;
  description?: string;
  createdFrom?: string;
};

class PaymentDatabase {
  private payments = new Map<string, Payment[]>();

  constructor() {
    this.payments.set('U123', [
      {
        id: 'P001',
        amount: 100,
        status: 'completed',
        payee: 'Alice',
        currency: 'GBP',
        timestamp: new Date(
          Date.now() - 15 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: 'P002',
        amount: 200,
        status: 'pending',
        payee: 'Bob',
        currency: 'EUR',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'P003',
        amount: 50,
        status: 'failed',
        payee: 'Carol',
        currency: 'GBP',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    dbLogger.info('Database initialised with seed data');
  }

  async getPayments(userId: string) {
    dbLogger.debug({ userId }, 'Getting payments');
    const payments = this.payments.get(userId) || [];
    dbLogger.debug({ userId, count: payments.length }, 'Retrieved payments');
    return payments;
  }

  async addPayment(userId: string, payment: Payment) {
    dbLogger.debug({ userId, paymentId: payment.id }, 'Adding payment');
    const userPayments = this.payments.get(userId) || [];
    userPayments.push(payment);
    this.payments.set(userId, userPayments);
    dbLogger.info({ userId, paymentId: payment.id }, 'Payment added');
    return payment;
  }
}

const db = new PaymentDatabase();

function filterPaymentsByTimeframe(
  payments: Payment[],
  timeframe: string,
): Payment[] {
  if (timeframe === 'all') return payments;

  const now = new Date();
  let cutoff: Date;

  if (timeframe === 'month') {
    cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  } else if (timeframe === 'week') {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    return payments;
  }

  return payments.filter((p) => new Date(p.timestamp || Date.now()) >= cutoff);
}

// CONCEPT: RESOURCES
// Dynamic resource with templating for currency rates
server.resource(
  'currencyRates',
  new ResourceTemplate('currency://rates/{format}', {
    list: async () => {
      return {
        resources: [
          {
            uri: 'currency://rates/json',
            name: 'Currency Rates (JSON)',
            mimeType: 'application/json',
          },
          {
            uri: 'currency://rates/text',
            name: 'Currency Rates (Text)',
            mimeType: 'text/plain',
          },
        ],
      };
    },
  }),
  async (uri, { format }) => {
    // Validate format parameter
    if (format !== 'json' && format !== 'text') {
      throw new Error('Invalid format requested');
    }

    // In a real implementation, fetch from external API
    const rates = {
      GBP: 1,
      EUR: 1.15,
      USD: 1.27,
      JPY: 190.5,
      updatedAt: new Date().toISOString(),
    };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: format === 'json' ? 'application/json' : 'text/plain',
          text:
            format === 'json'
              ? JSON.stringify(rates, null, 2)
              : Object.entries(rates)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join('\n'),
        },
      ],
    };
  },
);

// CONCEPT: TOOLS with context awareness
// Enhanced Payment Summary with better error handling and validation
server.tool(
  'paymentSummary',
  {
    userId: z.string().min(3).describe('User identifier'),
    currency: z
      .string()
      .length(3)
      .default('GBP')
      .describe('Currency code (ISO 4217)'),
    timeframe: z
      .enum(['all', 'month', 'week'])
      .default('all')
      .describe('Time period for summary'),
  },
  async ({ userId, currency, timeframe }) => {
    toolsLogger.debug(
      { userId, currency, timeframe },
      'Payment summary requested',
    );

    try {
      // Check if user exists
      const payments = await db.getPayments(userId);
      if (payments.length === 0) {
        toolsLogger.warn({ userId }, 'No payment data found');
        return {
          content: [
            { type: 'text', text: `No payment data found for user ${userId}.` },
          ],
        };
      }

      // Filter by timeframe if needed
      const filteredPayments = filterPaymentsByTimeframe(payments, timeframe);

      // Access rates (hardcoded since getResource is not directly available)
      const rates: Record<string, number> = {
        GBP: 1,
        EUR: 1.15,
        USD: 1.27,
        JPY: 190.5,
      };

      let total = 0;
      for (const p of filteredPayments) {
        if (!rates[p.currency]) {
          toolsLogger.warn({ currency: p.currency }, 'Unsupported currency');
          return {
            content: [
              { type: 'text', text: `Unsupported currency: ${p.currency}` },
            ],
            isError: true,
          };
        }
        const rate = rates[p.currency];
        total += p.amount * rate;
      }

      // Convert to requested currency
      if (!rates[currency]) {
        toolsLogger.warn({ currency }, 'Unsupported target currency');
        return {
          content: [
            { type: 'text', text: `Unsupported target currency: ${currency}` },
          ],
          isError: true,
        };
      }

      const convertedTotal = (total / rates[currency]).toFixed(2);

      toolsLogger.info(
        {
          userId,
          currency,
          timeframe,
          paymentCount: filteredPayments.length,
        },
        'Payment summary generated',
      );

      return {
        content: [
          {
            type: 'text',
            text: `User ${userId} has ${filteredPayments.length} payments within the ${timeframe} timeframe, totalling ${currency} ${convertedTotal}.`,
          },
        ],
        metadata: {
          currency,
          timeframe,
          rawTotal: total,
          paymentCount: filteredPayments.length,
          conversionRates: rates,
        },
      };
    } catch (error) {
      toolsLogger.error(
        { err: error, userId, currency, timeframe },
        'Error generating payment summary',
      );
      return {
        content: [
          {
            type: 'text',
            text: `Error generating payment summary: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// CONCEPT: TOOLS with validation
// Fraud Detection Tool with configurable threshold
server.tool(
  'fraudCheck',
  {
    userId: z.string().min(3).describe('User identifier'),
    threshold: z
      .number()
      .positive()
      .default(100)
      .describe('Amount threshold for suspicious transactions'),
    detailLevel: z
      .enum(['basic', 'detailed'])
      .default('basic')
      .describe('Level of detail in the report'),
  },
  async ({ userId, threshold, detailLevel }) => {
    toolsLogger.debug(
      {
        userId,
        threshold,
        detailLevel,
      },
      'Fraud check requested',
    );

    try {
      const payments = await db.getPayments(userId);

      if (payments.length === 0) {
        toolsLogger.warn({ userId }, 'No payment data found');
        return {
          content: [
            { type: 'text', text: `No payment data found for user ${userId}.` },
          ],
        };
      }

      const suspicious = payments.filter(
        (p) => p.amount > threshold || p.status === 'failed',
      );

      if (suspicious.length === 0) {
        toolsLogger.info(
          {
            userId,
            threshold,
          },
          'No suspicious transactions detected',
        );
        return {
          content: [
            { type: 'text', text: 'No suspicious transactions detected.' },
          ],
        };
      }

      // Format the response based on detail level
      if (detailLevel === 'detailed') {
        const detailedReport = suspicious
          .map(
            (t) =>
              `- Transaction ${t.id} to ${t.payee} for ${t.currency} ${t.amount}\n  Risk factors: ${t.status === 'failed' ? 'Failed status, ' : ''}${t.amount > threshold ? 'High amount' : ''}`,
          )
          .join('\n');

        toolsLogger.info(
          {
            userId,
            suspiciousCount: suspicious.length,
          },
          'Detailed fraud report generated',
        );

        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Found ${suspicious.length} suspicious transactions that require review:\n\n${detailedReport}`,
            },
          ],
          metadata: {
            suspiciousCount: suspicious.length,
            riskFactors: {
              highAmount: suspicious.filter((t) => t.amount > threshold).length,
              failedStatus: suspicious.filter((t) => t.status === 'failed')
                .length,
            },
          },
        };
      } else {
        // Basic response
        toolsLogger.info(
          {
            userId,
            suspiciousCount: suspicious.length,
          },
          'Basic fraud report generated',
        );

        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Found ${suspicious.length} suspicious transactions that require review.`,
            },
          ],
          metadata: {
            suspiciousCount: suspicious.length,
          },
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toolsLogger.error(
        { err: error, userId, threshold },
        'Error performing fraud check',
      );
      return {
        content: [
          {
            type: 'text',
            text: `Error performing fraud check: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// CONCEPT: TOOLS with state modification
// Add Payment Tool with enhanced security and validation
server.tool(
  'addPayment',
  {
    userId: z.string().min(3).max(50).describe('User identifier'),
    amount: z
      .number()
      .positive()
      .max(10_000)
      .describe('Payment amount (max £10,000)'),
    payee: z.string().min(1).max(100).describe('Payment recipient'),
    currency: z
      .string()
      .length(3)
      .default('GBP')
      .describe('Currency code (ISO 4217)'),
    description: z.string().max(500).optional().describe('Payment description'),
  },
  async ({ userId, amount, payee, currency, description }) => {
    toolsLogger.debug(
      { userId, amount, currency, payee },
      'Payment addition requested',
    );

    try {
      // Security: Validate currency is supported
      const supportedCurrencies = ['GBP', 'EUR', 'USD', 'JPY'];
      if (!supportedCurrencies.includes(currency)) {
        toolsLogger.warn({ currency }, 'Unsupported currency');
        return {
          content: [
            {
              type: 'text',
              text: `Unsupported currency: ${currency}. Supported currencies: ${supportedCurrencies.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      // Security: Sanitize inputs to prevent injection attacks
      const sanitizedPayee = payee.replaceAll(/[<>]/g, '');
      const sanitizedDescription = description
        ? description.replaceAll(/[<>]/g, '')
        : undefined;

      // Create payment with security best practices
      const payment: Payment = {
        id: `P${Date.now()}${Math.floor(Math.random() * 1000)}`, // More unique ID
        amount,
        payee: sanitizedPayee,
        currency,
        status: 'pending',
        description: sanitizedDescription,
        timestamp: new Date().toISOString(),
        createdFrom: 'api', // Audit trail
      };

      await db.addPayment(userId, payment);

      // Log the operation for audit purposes
      toolsLogger.info(
        {
          userId,
          paymentId: payment.id,
          amount,
          currency,
        },
        'Payment added',
      );

      // Log payment update (instead of using server.emit which is not available)
      console.log(`Payment update for user ${userId}`);

      return {
        content: [
          {
            type: 'text',
            text: `Payment of ${currency} ${amount.toFixed(2)} to ${sanitizedPayee} has been added successfully. Payment ID: ${payment.id}`,
          },
        ],
        metadata: {
          paymentId: payment.id,
          status: payment.status,
          timestamp: payment.timestamp,
        },
      };
    } catch (error) {
      // Log errors but don't expose internal details to clients
      toolsLogger.error({ err: error, userId }, 'Payment addition failed');

      return {
        content: [
          {
            type: 'text',
            text: `Payment creation failed. Please try again later.`,
          },
        ],
        isError: true,
      };
    }
  },
);

// CONCEPT: PROMPTS - Predefined prompt templates with enhanced validation
server.prompt(
  'generateReport',
  'Generate a payment report in various formats',
  async () => {
    try {
      // Default values for the report
      const format = 'markdown';
      const timeframe = 'monthly';
      const includeDetails = false;

      // Fetch data that the report will be based on
      const payments = await db.getPayments('U123');

      // Use hardcoded rates since getResource is not directly available
      const rates = {
        GBP: 1,
        EUR: 1.15,
        USD: 1.27,
        JPY: 190.5,
      };

      const now = new Date();
      const periodStart = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        now.getDate(),
      );

      const periodPayments = payments.filter(
        (p) => new Date(p.timestamp || Date.now()) >= periodStart,
      );

      const totalsByStatus: Record<string, number> = {};
      for (const p of periodPayments) {
        totalsByStatus[p.status] = (totalsByStatus[p.status] || 0) + p.amount;
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a ${timeframe} payment report in ${format} format${includeDetails ? ' with full transaction details' : ''}.`,
            },
          },
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: `I'll create a detailed ${timeframe} payment report in ${format} format for you${includeDetails ? ' with full transaction details' : ''}.`,
            },
          },
        ],
        description: `${timeframe} payment report in ${format} format`,
        _meta: {
          reportType: timeframe,
          format,
          periodStart: periodStart.toISOString(),
          periodEnd: now.toISOString(),
          paymentCount: periodPayments.length,
          totalsByStatus,
          rates,
        },
      };
    } catch (error) {
      console.error(`[ERROR] Report generation failed:`, error);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a payment report.`,
            },
          },
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: `I apologize, but I'm unable to generate the requested report at this time due to a system error. Please try again later or contact support if the issue persists.`,
            },
          },
        ],
        description: `Error generating payment report`,
      };
    }
  },
);

// Note: Sampling is not directly supported in the current MCP implementation
serverLogger.info(
  'Sampling parameters would be configured here in a full implementation',
);

// Note: Roots are not directly supported in the current MCP implementation
serverLogger.info(
  'Root contexts would be defined here in a full implementation',
);

// Note: Event handlers are not directly supported in the current MCP implementation
serverLogger.info(
  'Payment update events would be handled here in a full implementation',
);

// Enhanced transport initialization with error handling
async function setupServer() {
  serverLogger.info('Initialising MCP server');

  // Initialize transport with error handling
  let transport;
  try {
    transport = new StdioServerTransport();
    serverLogger.debug('Stdio transport created');
  } catch (error) {
    serverLogger.error({ err: error }, 'Failed to create transport');
    throw new Error('Failed to create transport');
  }

  // Connect with enhanced error handling
  try {
    await server.connect(transport);
    serverLogger.info('Server connected successfully');

    // Setup termination handling
    process.on('SIGINT', async () => {
      serverLogger.info('Received SIGINT, shutting down...');
      await gracefulShutdown();
    });

    process.on('SIGTERM', async () => {
      serverLogger.info('Received SIGTERM, shutting down...');
      await gracefulShutdown();
    });

    serverLogger.info('Enhanced MCP Payment Server running');
    serverLogger.info(
      'Use the MCP Inspector to interact: https://github.com/modelcontextprotocol/inspector',
    );
  } catch (error) {
    serverLogger.error({ err: error }, 'Server connection failed');
    throw new Error('Server connection failed');
  }
}

// Graceful shutdown function
async function gracefulShutdown() {
  serverLogger.info('Beginning graceful shutdown');
  try {
    serverLogger.debug('Closing server...');
    await server.close();
    serverLogger.info('Server shut down successfully');
  } catch (error) {
    serverLogger.error({ err: error }, 'Error during shutdown');
    throw new Error('Error during shutdown');
  }
}

try {
  await setupServer();
} catch (error) {
  serverLogger.error({ err: error }, 'Fatal error during server setup');
  throw error;
}
