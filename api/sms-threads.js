import { requireAuth } from '../server/auth.js';
import { getSmsService } from '../server/smsRuntime.js';
import { smsError } from '../server/smsPolicy.js';

export function createSmsThreadsHandler({authenticate=requireAuth,getService=getSmsService}={}) {
  return async function smsThreads(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return res.status(405).json({error:'Method not allowed'}); }
    try {
      const user=await authenticate(req,res);
      if(!user) return;
      const service=getService();
      if(req.method==='GET') return res.status(200).json(await service.list(user));
      let body=req.body;
      if(typeof body==='string') { try { body=JSON.parse(body); } catch { throw smsError(400,'Invalid JSON'); } }
      if(!body || typeof body!=='object' || Array.isArray(body)) throw smsError(400,'Invalid SMS action');
      let result;
      if(body.action==='start') result=await service.start(user,{leadId:body.leadId,fromNumber:body.fromNumber});
      else if(body.action==='reply') result=await service.reply(user,{threadId:body.threadId,text:body.text,clientRequestId:body.clientRequestId});
      else if(body.action==='read') result=await service.read(user,body.threadId);
      else throw smsError(400,'Invalid SMS action');
      return res.status(200).json(result);
    } catch(error) {
      const status=Number.isInteger(error.status) ? error.status : 503;
      return res.status(status).json({error:status<500 ? error.message : 'SMS service unavailable'});
    }
  };
}
export default createSmsThreadsHandler();
