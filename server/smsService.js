import { permittedDids, normalizeNumber, smsError } from './smsPolicy.js';
import { threadView, messageView } from './smsStore.js';
export class SmsService {
  constructor({store,dids,send}) { this.store=store; this.dids=dids; this.send=send; }
  async list(user) {
    const dids=permittedDids(user,this.dids);
    return {threads:await this.store.list(dids),fromNumbers:dids.map(d=>d.number)};
  }
  async start(user,{leadId,fromNumber}) {
    const dids=permittedDids(user,this.dids);
    const did=dids.find(d=>d.number===normalizeNumber(fromNumber));
    if(!did) throw smsError(403,'SMS sender not permitted');
    if(!/^\d+$/.test(String(leadId))) throw smsError(400,'Invalid contact');
    const row=await this.store.start(did,leadId);
    const thread=(await this.store.list(dids)).find(t=>t.id===row.id);
    return {thread:thread||{...threadView(row),messages:[]}};
  }
  async reply(user,input) {
    const {text,clientRequestId}=input;
    if(typeof text!=='string' || !text.trim() || text.length>1600 || typeof clientRequestId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(clientRequestId)) throw smsError(400,'Invalid SMS text or request ID');
    const intent=await this.store.reserveReply(permittedDids(user,this.dids),input);
    let message=intent.message;
    if(intent.fresh) {
      // reserveReply committed first. A crashed/uncertain send is NEVER retried by this endpoint.
      let result;
      try {
        result=await this.send({from:intent.thread.local_number,to:intent.thread.remote_number,text:message.text,idempotencyKey:message.id});
      } catch {
        result={status:'unknown',providerId:null,error:'send_outcome_uncertain'};
      }
      message=await this.store.finishReply(message.id,result);
    }
    return {threadId:intent.thread.id,message:messageView(message)};
  }
  async read(user,threadId) { return this.store.read(threadId,permittedDids(user,this.dids)); }
}
