export const paletteSignature=p=>JSON.stringify([p.layers,[...p.palette].sort()]);
export const paletteIsConfirmed=p=>p.paletteConfirmation?.signature===paletteSignature(p);

export function createPaletteConfirmation({colors,esc,modal,dialog,close,current,persist,render,onChange}){
  let pending=null;
  function summary(p){return `<div class="concept-palette"><span class="hint">Доступні морилки: ${paletteIsConfirmed(p)?'підтверджено':'потрібно підтвердити'}</span><div class="actions-wrap">${p.palette.map(id=>{const color=colors.find(c=>c.id===id);return color?`<span class="chip"><span class="palette-dot" style="background:${color.hex}"></span>${esc(color.name)}</span>`:'';}).join('')}<button class="btn tiny" data-action="palette-edit">Змінити палітру</button></div></div>`;}
  function ensure(p,{force=false,launch=true}={}){
    if(!force&&paletteIsConfirmed(p))return Promise.resolve(true);
    if(pending)return pending.promise;
    let resolve;const promise=new Promise(done=>resolve=done);pending={promise};
    let draft=[...p.palette],finished=false;
    const original=paletteSignature(p),project=p;
    const finish=value=>{if(finished)return;finished=true;dialog.removeEventListener('close',cancel);dialog.removeEventListener('cancel',cancel);pending=null;resolve(value);};
    const cancel=event=>{if(event.type==='close'&&dialog.open)return;finish(false);};
    dialog.addEventListener('close',cancel);dialog.addEventListener('cancel',cancel);
    modal(`<div class="dialog-head"><h2>Які морилки доступні для цього виробу?</h2><button class="btn" data-action="close">Скасувати</button></div><p>Оберіть кольори, які хочете дозволити для концепцій. Агент може використати лише частину з них для гармонійного поєднання.</p><p class="hint">${p.layers===1?'Для одного шару без інкрустації — одне оздоблення.':'До 3 оздоблень; четвертим може бути лише «Чорна». «Чистий» — фанера без морилки.'}</p><div class="palette-options" id="palette-options"></div><p class="hint" id="palette-message" role="status"></p><div class="dialog-actions"><button class="btn" data-action="close">Повернутися</button><button class="btn primary" id="confirm-concept-palette">${launch?'Підтвердити палітру й створити концепції':'Підтвердити палітру'}</button></div>`);
    const options=document.querySelector('#palette-options'),status=document.querySelector('#palette-message');
    function draw(){
      options.innerHTML=colors.map(color=>`<button class="palette-option ${draft.includes(color.id)?'selected':''}" data-palette-choice="${color.id}" aria-pressed="${draft.includes(color.id)}"><span class="palette-sample" style="background:${color.hex}"></span><span>${esc(color.name)}</span><span aria-hidden="true">${draft.includes(color.id)?'✓':''}</span></button>`).join('');
      for(const button of options.querySelectorAll('[data-palette-choice]'))button.onclick=()=>{
        const id=button.dataset.paletteChoice;status.textContent='';
        if(draft.includes(id)){if(draft.length===1){status.textContent='Потрібно залишити хоча б одне оздоблення.';return;}draft=draft.filter(value=>value!==id);}
        else if(p.layers===1)draft=[id];
        else {const next=[...draft,id];if(next.length>4||(next.length===4&&!next.includes('black'))){status.textContent='До 3 оздоблень; четвертим може бути лише «Чорна».';return;}draft=next;}
        draw();
      };
    }
    draw();
    document.querySelector('#confirm-concept-palette').onclick=async()=>{
      const button=document.querySelector('#confirm-concept-palette');button.disabled=true;
      try{
        if(current()!==project||paletteSignature(p)!==original){status.textContent='Проєкт або палітра змінилися. Закрийте вікно й перевірте вибір знову.';return;}
        if(paletteSignature({...p,palette:draft})!==original){p.palette=[...draft];onChange(p);}
        p.paletteConfirmation={signature:paletteSignature(p),confirmedAt:new Date().toISOString(),actor:'user'};
        await persist();finish(true);close();render();
      }catch{status.textContent='Не вдалося підтвердити палітру. Спробуйте ще раз.';}
      finally{button.disabled=false;}
    };
    return promise;
  }
  return {ensure,summary};
}
