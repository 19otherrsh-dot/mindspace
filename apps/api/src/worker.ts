import cron from 'node-cron';
import { Expo } from 'expo-server-sdk';
import { pool } from './db/pool.ts';

const expo = new Expo();

/**
 * Periodically polls the Expo Push API for receipts of previously sent notifications.
 * Expo holds receipts for a limited time. If a receipt indicates that the device
 * is no longer registered, we mark the push token as inactive to stop sending
 * notifications to it in the future.
 */
export function startPushReceiptWorker() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await processPendingPushReceipts();
    } catch (err) {
      console.error('[worker] Error processing push receipts:', err);
    }
  });
  console.log('[worker] Push receipt worker started (cron: */15 * * * *)');
}

async function processPendingPushReceipts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch up to 1000 pending tickets to process in this batch
    const { rows: pendingTickets } = await client.query<{ id: string; ticket_id: string; push_token: string }>(
      `SELECT id, ticket_id, push_token 
       FROM push_tickets 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT 1000
       FOR UPDATE SKIP LOCKED`
    );

    if (pendingTickets.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const ticketIdToDbId = new Map<string, string>();
    const ticketIdToToken = new Map<string, string>();
    const receiptIds: string[] = [];

    for (const ticket of pendingTickets) {
      ticketIdToDbId.set(ticket.ticket_id, ticket.id);
      ticketIdToToken.set(ticket.ticket_id, ticket.push_token);
      receiptIds.push(ticket.ticket_id);
    }

    // Chunk the receipt IDs as recommended by Expo (max 300 per request)
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    const processedDbIds: string[] = [];
    const invalidTokens: string[] = [];

    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

        // The receipts object is a map of ticket ID to receipt
        for (const [ticketId, receipt] of Object.entries(receipts)) {
          const dbId = ticketIdToDbId.get(ticketId);
          if (dbId) {
            processedDbIds.push(dbId);
          }

          if (receipt.status === 'error') {
            console.error(`[worker] Push delivery error for ticket ${ticketId}: ${receipt.message}`);
            if (receipt.details && receipt.details.error === 'DeviceNotRegistered') {
              // The device token is no longer valid, we should mark it inactive
              const token = ticketIdToToken.get(ticketId);
              if (token) {
                invalidTokens.push(token);
              }
            }
          }
        }
      } catch (error) {
        console.error('[worker] Failed to fetch receipts for chunk:', error);
      }
    }

    // Update tickets as processed
    if (processedDbIds.length > 0) {
      await client.query(
        `UPDATE push_tickets 
         SET status = 'processed', processed_at = now() 
         WHERE id = ANY($1)`,
        [processedDbIds]
      );
    }

    // Mark invalid tokens as inactive
    if (invalidTokens.length > 0) {
      await client.query(
        `UPDATE push_tokens 
         SET is_active = FALSE 
         WHERE token = ANY($1)`,
        [invalidTokens]
      );
      console.log(`[worker] Deactivated ${invalidTokens.length} invalid push tokens.`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
