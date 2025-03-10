import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createServerLogger, createToolsLogger } from './logger.js';

// Create child loggers for different components
const serverLogger = createServerLogger();
const toolsLogger = createToolsLogger();

// Define payment type for better type safety
type Payment = {
  id: string;
  amount: number;
  status: string;
  payee: string;
  timestamp?: string;
};

// Initialise the MCP server with metadata and explicit capabilities
const server = new McpServer(
  {
    name: 'PaymentSystem',
    version: '1.0.0',
    description: 'A payment processing system with MCP integration',
    vendor: 'Payment Tech Inc.',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Mock payment data with timestamps
const paymentData = {
  userId: 'U123',
  payments: [
    {
      id: 'P001',
      amount: 100,
      status: 'completed',
      payee: 'Alice',
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'P002',
      amount: 200,
      status: 'pending',
      payee: 'Bob',
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'P003',
      amount: 50,
      status: 'failed',
      payee: 'Carol',
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ] as Payment[],
};

// Tool 1: Payment Summary - Gets a summary of all payments
server.tool(
  'paymentSummary',
  {
    userId: z.string().min(1).describe('User identifier'),
    includeDetails: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include payment details in response'),
  },
  async ({ userId, includeDetails }) => {
    toolsLogger.debug({ userId, includeDetails }, 'Payment summary requested');

    try {
      if (userId !== paymentData.userId) {
        toolsLogger.warn({ userId }, 'User not found');
        return {
          content: [{ type: 'text', text: 'No data available for this user.' }],
        };
      }

      const totalPayments = paymentData.payments.length;

      // Use a for loop instead of reduce for better readability
      let totalAmount = 0;
      for (const payment of paymentData.payments) {
        totalAmount += payment.amount;
      }

      toolsLogger.info(
        {
          userId,
          totalPayments,
          totalAmount,
        },
        'Payment summary generated',
      );

      return {
        content: [
          {
            type: 'text',
            text: `User ${userId} has ${totalPayments} payments totalling £${totalAmount}.`,
          },
        ],
        metadata: {
          userId,
          totalPayments,
          totalAmount,
          payments: includeDetails ? paymentData.payments : undefined,
        },
      };
    } catch (error) {
      toolsLogger.error(
        { err: error, userId },
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

// Tool 2: Payment Details - Filters payments by status
server.tool(
  'paymentDetails',
  {
    status: z
      .string()
      .min(1)
      .describe(
        'Payment status to filter by (e.g., completed, pending, failed)',
      ),
  },
  async ({ status }) => {
    toolsLogger.debug({ status }, 'Payment details requested');

    try {
      const normalisedStatus = status.toLowerCase();

      const filtered = paymentData.payments.filter(
        (p) => p.status.toLowerCase() === normalisedStatus,
      );

      if (filtered.length === 0) {
        toolsLogger.info({ status }, 'No payments found with specified status');
        return {
          content: [
            {
              type: 'text',
              text: `No payments found with status '${status}'.`,
            },
          ],
        };
      }

      toolsLogger.info(
        {
          status,
          count: filtered.length,
        },
        'Payment details filtered by status',
      );

      return {
        content: [
          {
            type: 'text',
            text: `Payments with status '${status}':\n${JSON.stringify(filtered, null, 2)}`,
          },
        ],
        metadata: {
          status,
          count: filtered.length,
          payments: filtered,
        },
      };
    } catch (error) {
      toolsLogger.error(
        { err: error, status },
        'Error filtering payments by status',
      );
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving payment details: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 3: Fraud Alert - Simple fraud detection
server.tool(
  'fraudAlert',
  {
    userId: z.string().min(1).describe('User identifier'),
    threshold: z
      .number()
      .positive()
      .optional()
      .default(100)
      .describe('Amount threshold for suspicious transactions'),
  },
  async ({ userId, threshold }) => {
    toolsLogger.debug({ userId, threshold }, 'Fraud alert check requested');

    try {
      if (userId !== paymentData.userId) {
        toolsLogger.warn({ userId }, 'User not found');
        return {
          content: [{ type: 'text', text: 'No data available for this user.' }],
        };
      }

      // Check for failed payments or high-value transactions
      const suspiciousPayments = paymentData.payments.filter(
        (p) => p.status.toLowerCase() === 'failed' || p.amount > threshold,
      );

      if (suspiciousPayments.length > 0) {
        toolsLogger.warn(
          {
            userId,
            suspiciousCount: suspiciousPayments.length,
          },
          'Suspicious payments detected',
        );

        return {
          content: [
            {
              type: 'text',
              text: `Alert: Found ${suspiciousPayments.length} suspicious payments. Please review for potential fraud.`,
            },
          ],
          metadata: {
            userId,
            suspiciousCount: suspiciousPayments.length,
            suspiciousPayments,
          },
        };
      }

      toolsLogger.info({ userId }, 'No fraud alerts detected');
      return {
        content: [
          { type: 'text', text: `No fraud alerts for user ${userId}.` },
        ],
        metadata: {
          userId,
          status: 'clear',
        },
      };
    } catch (error) {
      toolsLogger.error(
        { err: error, userId },
        'Error checking for fraud alerts',
      );
      return {
        content: [
          {
            type: 'text',
            text: `Error checking for fraud alerts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Enhanced server initialisation with error handling
async function setupServer() {
  serverLogger.info('Initialising MCP server');

  try {
    // Initialise transport
    const transport = new StdioServerTransport();
    serverLogger.debug('Stdio transport created');

    // Connect to the transport
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

    serverLogger.info('Basic MCP Payment Server running');
    serverLogger.info(
      'Use the MCP Inspector to interact: https://github.com/modelcontextprotocol/inspector',
    );
  } catch (error) {
    serverLogger.error({ err: error }, 'Server initialisation failed');
    throw new Error('Server initialisation failed');
  }
}

// Graceful shutdown function
async function gracefulShutdown() {
  serverLogger.info('Beginning graceful shutdown');
  try {
    // Close any open resources
    serverLogger.debug('Closing server...');
    await server.close();
    serverLogger.info('Server shut down successfully');
    // The process will naturally exit if this is called from a signal handler
  } catch (error) {
    serverLogger.error({ err: error }, 'Error during shutdown');
    throw new Error('Error during shutdown');
  }
}

// Start the server using top-level await
try {
  await setupServer();
} catch (error) {
  serverLogger.error({ err: error }, 'Fatal error during server setup');
  // We'll let the process exit naturally with an error code
  throw error;
}
