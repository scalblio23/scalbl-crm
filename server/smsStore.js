import { randomUUID } from 'node:crypto';
import { normalizeNumber, smsError } from './smsPolicy.js';

export function messageView(row) {
  return {id:row.id,text:row.text,outgoing:row.outgoing,status:row.status,createdAt:row.created_at};
}
export function threadView(row) {
  return {id:row.id,leadId:row.lead_id,name:row.name,localNumber:row.local_number,remoteNumber:row.remote_number,preview:row.preview,unread:row.unread,updatedAt:row.updated_at};
}

export class SmsStore {
  constructor(pool) { this.pool=pool; }
  async transaction(fn) {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result=await fn(db);
      await db.query('COMMIT');
      return result;
    } catch(error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally { db.release(); }
  }
  async lock(db,did,remote) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([did.scopeKey,did.number,remote])]);
  }
  async candidates(db,did) {
    // Global contact matching is permitted ONLY by an explicitly named admin scope.
    return (await db.query('SELECT id,name,phone,tag FROM contacts WHERE ($1::boolean OR tag=ANY($2::text[]))',[Boolean(did.adminScope),did.allowedTags])).rows;
  }
  async match(db,did,remote) {
    const matches=(await this.candidates(db,did)).filter(c=>{
      try { return normalizeNumber(c.phone)===remote; } catch { return false; }
    });
    return matches.length===1 ? matches[0] : null;
  }
  async upsertThread(db,did,remote,contact) {
    return (await db.query(`INSERT INTO sms_threads(id,scope_key,local_number,remote_number,lead_id,name)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(scope_key,local_number,remote_number) DO UPDATE SET lead_id=EXCLUDED.lead_id,name=EXCLUDED.name RETURNING *`,
      [randomUUID(),did.scopeKey,did.number,remote,contact?.id||null,contact?.name||remote])).rows[0];
  }
  async start(did,leadId) {
    return this.transaction(async db=>{
      const contact=(await this.candidates(db,did)).find(c=>String(c.id)===String(leadId));
      if(!contact) throw smsError(404,'SMS contact not found');
      const remote=normalizeNumber(contact.phone);
      await this.lock(db,did,remote);
      // Even explicit starts do not incorrectly attach a shared phone to one contact.
      const unique=await this.match(db,did,remote);
      return this.upsertThread(db,did,remote,unique);
    });
  }
  async authorizedThread(db,id,dids) {
    if(typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id)) throw smsError(404,'SMS thread not found');
    const thread=(await db.query('SELECT * FROM sms_threads WHERE id=$1',[id])).rows[0];
    const did=thread && dids.find(d=>d.number===thread.local_number && d.scopeKey===thread.scope_key);
    if(!did) throw smsError(404,'SMS thread not found');
    if(thread.lead_id && !(await this.candidates(db,did)).some(c=>c.id===thread.lead_id)) throw smsError(404,'SMS thread not found');
    return {thread,did};
  }
  async list(dids) {
    if(!dids.length) return [];
    const threads=(await this.pool.query(`SELECT * FROM sms_threads WHERE (scope_key,local_number) IN
      (SELECT * FROM unnest($1::text[],$2::text[])) ORDER BY updated_at DESC,id`,[dids.map(d=>d.scopeKey),dids.map(d=>d.number)])).rows;
    const output=[];
    for(const row of threads) {
      try { await this.authorizedThread(this.pool,row.id,dids); } catch(e) { if(e.status===404) continue; throw e; }
      const messages=(await this.pool.query('SELECT * FROM sms_messages WHERE thread_id=$1 ORDER BY created_at,id',[row.id])).rows;
      output.push({...threadView(row),messages:messages.map(messageView)});
    }
    return output;
  }
  async read(id,dids) {
    return this.transaction(async db=>{
      await this.authorizedThread(db,id,dids);
      await db.query('UPDATE sms_threads SET unread=false WHERE id=$1',[id]);
      return {ok:true};
    });
  }
  async reserveReply(dids,{threadId,text,clientRequestId}) {
    return this.transaction(async db=>{
      const {thread,did}=await this.authorizedThread(db,threadId,dids);
      await this.lock(db,did,thread.remote_number);
      const old=(await db.query('SELECT * FROM sms_messages WHERE thread_id=$1 AND client_request_id=$2',[threadId,clientRequestId])).rows[0];
      if(old) {
        if(old.text!==text) throw smsError(409,'SMS request ID reused with different text');
        return {message:old,thread,fresh:false};
      }
      const suppressed=(await db.query('SELECT 1 FROM sms_suppressions WHERE scope_key=$1 AND local_number=$2 AND remote_number=$3',[did.scopeKey,did.number,thread.remote_number])).rowCount;
      if(suppressed) throw smsError(409,'SMS recipient has opted out');
      const message=(await db.query(`INSERT INTO sms_messages(id,thread_id,text,outgoing,status,client_request_id)
        VALUES($1,$2,$3,true,'sending',$4) RETURNING *`,[randomUUID(),threadId,text,clientRequestId])).rows[0];
      await db.query('UPDATE sms_threads SET preview=$2,updated_at=now() WHERE id=$1',[threadId,text]);
      return {message,thread,fresh:true};
    });
  }
  async finishReply(id,{status,providerId,error}) {
    return (await this.pool.query(`UPDATE sms_messages SET status=$2,provider_id=$3,error_code=$4,updated_at=now()
      WHERE id=$1 AND status='sending' RETURNING *`,[id,status,providerId,error])).rows[0];
  }
  // Maintenance/operator-only methods; deliberately not exposed on the client API.
  // Never send or retry from reconciliation. Verify provider records out of band.
  async markStaleSendsUnknown() {
    return (await this.pool.query(`UPDATE sms_messages SET status='unknown',error_code='process_interrupted',updated_at=now()
      WHERE status='sending' AND updated_at < now()-interval '5 minutes' RETURNING id`)).rows;
  }
  async reconcileUnknown({id,status,providerId=null,actor,evidence}) {
    if(!['queued','delivered','failed'].includes(status) || typeof actor!=='string' || !actor.trim() ||
        typeof evidence!=='string' || evidence.trim().length<10 ||
        (status!=='failed' && (typeof providerId!=='string' || !providerId.trim()))) throw smsError(400,'Verified reconciliation evidence is required');
    return this.transaction(async db=>{
      const row=(await db.query("SELECT * FROM sms_messages WHERE id=$1 AND status='unknown' FOR UPDATE",[id])).rows[0];
      if(!row) throw smsError(409,'Only unknown SMS outcomes can be reconciled');
      await db.query('INSERT INTO sms_reconciliations(id,message_id,previous_status,resolved_status,provider_id,actor,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,row.status,status,providerId,actor,evidence]);
      return (await db.query('UPDATE sms_messages SET status=$2,provider_id=$3,error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *',[id,status,providerId])).rows[0];
    });
  }
  async receive(event) {
    return this.transaction(async db=>{
      const receipt=(await db.query('INSERT INTO sms_receipts(event_id,payload_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',[event.eventId,event.receiptHash])).rows[0];
      if(!receipt) {
        const old=(await db.query('SELECT payload_hash,message_id FROM sms_receipts WHERE event_id=$1',[event.eventId])).rows[0];
        if(old.payload_hash!==event.receiptHash) throw smsError(409,'SMS receipt ID reused with different content');
        return {id:old.message_id,duplicate:true};
      }
      const {did,from:remote}=event;
      await this.lock(db,did,remote);
      if(/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(event.text.trim())) {
        await db.query('INSERT INTO sms_suppressions(scope_key,local_number,remote_number) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[did.scopeKey,did.number,remote]);
      }
      const contact=await this.match(db,did,remote);
      const thread=await this.upsertThread(db,did,remote,contact);
      const id=randomUUID();
      await db.query("INSERT INTO sms_messages(id,thread_id,text,outgoing,status,created_at) VALUES($1,$2,$3,false,'received',$4)",[id,thread.id,event.text,event.receivedAt]);
      await db.query('UPDATE sms_threads SET preview=$2,unread=true,updated_at=now() WHERE id=$1',[thread.id,event.text]);
      await db.query('UPDATE sms_receipts SET message_id=$2 WHERE event_id=$1',[event.eventId,id]);
      return {id,threadId:thread.id,duplicate:false};
    });
  }
}
