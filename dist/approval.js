import { multiPanel, panelsReady, panelSources, panelList } from './panels.js';
import { moveToRoute } from './project-route.js';
export function invalidateApproval(project){project.approved=false;project.approvedAt=null;project.appearanceApproval=null;}
export async function approvalSignature(p,typeRevision){
  const value=JSON.stringify([typeRevision,p.id,p.title,p.type,p.clockMount,p.width,p.height,p.layers,p.frame,p.brief,p.palette,p.reference,p.assets,p.selected,p.concepts,p.notes,p.locks,p.pendingAssetsUpdate,p.reviews,p.aiReport,panelSources(p)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function approvalBlocker(p){
  if(['running','queued'].includes(p.aiJob?.status))return 'Дочекайтеся завершення поточного завдання перед прийняттям виробу.';
  if(multiPanel(p)&&!panelsReady(p))return 'Спочатку отримайте актуальний декор усіх панелей комплекту.';
  if(p.pendingAssetsUpdate?.length)return 'Зображення ще відповідають попередньому завданню. Додайте оновлені вигляд і декор.';
  if(!p.assets?.master||!p.assets?.preview)return 'Спочатку додайте обидва зображення.';
  if(Object.values(p.reviews||{}).includes('fail'))return 'У вашій ручній перевірці є позначка «Потрібна правка». Перегляньте її перед погодженням.';
  return null;
}
export const approvedWithAiRemarks=p=>p.approved&&p.appearanceApproval?.aiRemarksAccepted===true;
export function createApproval({esc,modal,close,toast,persist,snapshot,render,getTypeRevision=()=>undefined}){
  return {async open(p){
    const blocker=approvalBlocker(p);if(blocker){toast(blocker);return;}
    const signature=await approvalSignature(p,getTypeRevision(p));
    const override=p.aiReport?.disposition==='changes_required';
    modal(`<h2>${override?'Погодити вигляд попри зауваження ШІ?':'Погодити зовнішній вигляд?'}</h2>${override?`<p>Ви можете вирішити, що поточний результат достатній. Зауваження ШІ залишаться в проєкті разом із вашим рішенням прийняти їх.</p><div class="approval-findings">${(p.aiReport.findings||[]).map(f=>`<div class="note"><strong>${esc(f.location)}</strong><p>${esc(f.observation)}</p><p>${esc(f.suggested_action)}</p></div>`).join('')||'<p class="hint">ШІ рекомендував правки без окремого переліку зауважень.</p>'}</div><div class="field"><label for="approval-reason">Ваш коментар (необов’язково)</label><textarea id="approval-reason" maxlength="2000" placeholder="Наприклад: виправлю цю деталь під час обведення в SolidWorks."></textarea></div>`:''}<p class="hint">${multiPanel(p)?'Це погодження всіх панелей комплекту й вигляду виробу.':'Це погодження поточних двох зображень.'} Геометрія, ширини 2 мм і кріплення ще потребують перевірки у SolidWorks.</p><p class="hint" id="approval-message" role="status"></p><div class="dialog-actions"><button class="btn" data-action="close">Повернутися</button><button class="btn primary" id="confirm-appearance">${override?'Погодити попри зауваження ШІ':'Погодити вигляд'}</button></div>`);
    const button=document.querySelector('#confirm-appearance');
    button.onclick=async()=>{
      button.disabled=true;
      try{
        const error=approvalBlocker(p);
        if(error||signature!==await approvalSignature(p,getTypeRevision(p))){document.querySelector('#approval-message').textContent=error||'Проєкт або перевірка змінилися. Закрийте вікно та перегляньте поточний результат перед погодженням.';return;}
        const at=new Date().toISOString();
        p.approved=true;p.approvedAt=at;p.updatedAt=at;
        p.appearanceApproval={actor:'user',scope:'appearance',at,revisionSignature:signature,aiRemarksAccepted:override,comment:override?(document.querySelector('#approval-reason')?.value||'').trim().slice(0,2000):'',aiReview:structuredClone(p.aiReport||null)};
        moveToRoute(p,'saved');
        await snapshot(p,false,override?'Погоджено користувачем попри зауваження ШІ':'Погоджено користувачем');
        await persist();close();render();toast(override?'Вигляд погоджено вами попри зауваження ШІ.':'Зовнішній вигляд погоджено вами.');
      }catch{toast('Не вдалося зберегти погодження. Спробуйте ще раз.');}
      finally{button.disabled=false;}
    };
  }};
}
