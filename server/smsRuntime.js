import { getPool, isDbConfigured } from './db.js';
import { parseDids, smsError } from './smsPolicy.js';
import { SmsStore } from './smsStore.js';
import { SmsService } from './smsService.js';
import { sendCrazytelSms } from './crazytelSms.js';

// No connection or schema creation at import time. Migration is an operator step.
// Shares the app's one connection pool (server/db.js) — a second pool per
// function doubled the connections each instance could hold open.
export function getSmsRuntime() {
  const dids=parseDids(process.env.CRAZYTEL_SMS_DIDS || '');
  if(!isDbConfigured()) throw smsError(503,'SMS database is not configured');
  return {dids,secret:process.env.CRAZYTEL_SMS_WEBHOOK_SECRET,store:new SmsStore(getPool())};
}
export function getSmsService() {
  const {store,dids}=getSmsRuntime();
  return new SmsService({store,dids,send:sendCrazytelSms});
}
