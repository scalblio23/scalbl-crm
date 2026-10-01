import pg from 'pg';
import { parseDids, smsError } from './smsPolicy.js';
import { SmsStore } from './smsStore.js';
import { SmsService } from './smsService.js';
import { sendCrazytelSms } from './crazytelSms.js';

let pool;
// No connection or schema creation at import time. Migration is an operator step.
export function getSmsRuntime() {
  const dids=parseDids(process.env.CRAZYTEL_SMS_DIDS || '');
  if(!pool) {
    const connectionString=process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
    if(!connectionString) throw smsError(503,'SMS database is not configured');
    pool=new pg.Pool({connectionString,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:8000});
  }
  return {dids,secret:process.env.CRAZYTEL_SMS_WEBHOOK_SECRET,store:new SmsStore(pool)};
}
export function getSmsService() {
  const {store,dids}=getSmsRuntime();
  return new SmsService({store,dids,send:sendCrazytelSms});
}
