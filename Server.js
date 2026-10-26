'use strict';
const express=require('express'),path=require('path'),fs=require('fs');
const app=express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||'';
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'';
const DB_PATH='/tmp/db.json';

const SEED=[
 {id:'p1',name:'شال نخی تابستانی',category:'شال و روسری',price:320000,stock:25,active:true,tags:['شال','نخی','تابستانی','روسری'],description:'شال نخی سبک با طرح مینیمال.'},
 {id:'p2',name:'مانتو کتان جلو باز',category:'مانتو',price:890000,stock:12,active:true,tags:['مانتو','کتان','جلو باز'],description:'مانتو کتان درجه یک.'},
 {id:'p3',name:'کیف چرم دست دوز',category:'کیف',price:1250000,stock:6,active:true,tags:['کیف','چرم','دست دوز'],description:'چرم طبیعی گاوی.'},
 {id:'p4',name:'کرم آبرسان ویتامین C',category:'مراقبت پوست',price:480000,stock:40,active:true,tags:['کرم','آبرسان','ویتامین'],description:'آبرسان ۵۰ میلی‌لیتر.'},
 {id:'p5',name:'ست گوشواره نقره',category:'زیورآلات',price:650000,stock:9,active:true,tags:['گوشواره','نقره','ست'],description:'نقره ۹۲۵ ضد حساسیت.'}
];
function defaults(){return{products:JSON.parse(JSON.stringify(SEED)),conversations:[],messages:[],orders:[],settings:{botName:'گالری نمونه',shippingCost:45000,freeShippingFrom:1000000,adminChatId:'',workingHours:'۹ تا ۲۱ (جمعه تعطیل)',dailySummaryHour:21,paymentInfo:'کارت به کارت پس از تایید سفارش.',autoFollowUpHours:24,abandonedCartMinutes:30},counters:{conv:0,msg:0,order:1000,product:0}};}
let db=defaults();
try{if(fs.existsSync(DB_PATH)){db=JSON.parse(fs.readFileSync(DB_PATH,'utf8'));const d=defaults();for(const k of Object.keys(d))if(db[k]===undefined)db[k]=d[k];for(const k of Object.keys(d.settings))if(db.settings[k]===undefined)db.settings[k]=d.settings[k];if(!db.counters)db.counters=d.counters;}}catch(e){}
function save(){try{fs.writeFileSync(DB_PATH,JSON.stringify(db));}catch(e){}}
function nextId(p,k){db.counters[k]=(db.counters[k]||0)+1;return p+db.counters[k];}

function getOrCreate(channel,ext,profile){ext=String(ext);let c=db.conversations.find(x=>x.channel===channel&&x.externalId===ext);if(c)return c;c={id:nextId('c','conv'),channel,externalId:ext,name:(profile&&profile.name)||'',username:(profile&&profile.username)||'',state:{step:'idle',cart:[],data:{},lastProductId:null},handoff:false,createdAt:Date.now(),lastAt:Date.now(),unread:0};db.conversations.push(c);save();return c;}
function pushMsg(conv,role,text){db.messages.push({id:nextId('m','msg'),convId:conv.id,role,text,at:Date.now()});conv.lastAt=Date.now();if(role==='user')conv.unread=(conv.unread||0)+1;}

const STOP=new Set(['از','به','با','را','که','این','آن','برای','می','یک','و','در','است','هست','چند','قیمت','سلام','لطفا','دارید','دارین','شما','من','هم','تا','بر','کرد','کن','شده','شد','های','ها','یه','چیه','چیست','باید','الان']);
const fa=s=>String(s).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);
const money=n=>fa(Number(n||0).toLocaleString('en-US'))+' تومان';
function norm(t){return String(t||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\u200c/g,' ').toLowerCase().replace(/[.,!?؟،:;"'()\[\]{}«»_/\\@#$%^&*+=~`|]/g,' ').replace(/-/g,' ').replace(/\s+/g,' ').trim();}
function tokens(q){return norm(q).split(' ').filter(w=>w.length>1&&!STOP.has(w));}
function searchProducts(q){const toks=tokens(q);if(!toks.length)return[];const out=[];for(const p of db.products){if(!p.active)continue;const hay=norm([p.name,p.category,(p.tags||[]).join(' '),p.description].join(' '));const nameN=norm(p.name);let s=0;for(const w of toks){if(hay.includes(w))s+=2;if(nameN.includes(w))s+=3;}if(s>0)out.push({p,s});}return out.sort((a,b)=>b.s-a.s).map(x=>x.p);}
function cartTotal(st){return st.cart.reduce((s,it)=>{const p=db.products.find(x=>x.id===it.productId);return s+(p?p.price*it.qty:0);},0);}
function addToCart(st,pid,qty){const it=st.cart.find(x=>x.productId===pid);if(it)it.qty+=qty;else st.cart.push({productId:pid,qty});}
function cartText(st){return st.cart.map(it=>{const p=db.products.find(x=>x.id===it.productId);return p?`• ${p.name} × ${fa(it.qty)} = ${money(p.price*it.qty)}`:null;}).filter(Boolean).join('\n');}
function shippingFor(total){const S=db.settings;return total>=S.freeShippingFrom?0:S.shippingCost;}
function createOrder(conv,st){const id='ORD-'+(db.counters.order=(db.counters.order||1000)+1);const items=st.cart.map(it=>{const p=db.products.find(x=>x.id===it.productId);return p?{productId:p.id,name:p.name,price:p.price,qty:it.qty}:null;}).filter(Boolean);const total=items.reduce((s,i)=>s+i.price*i.qty,0);const shipping=shippingFor(total);const o={id,convId:conv.id,customer:{name:st.data.name||conv.name||'',phone:st.data.phone||'',address:st.data.address||''},items,total,shipping,payable:total+shipping,status:'new',createdAt:Date.now(),followedUp:false};db.orders.push(o);for(const it of items){const p=db.products.find(x=>x.id===it.productId);if(p)p.stock=Math.max(0,p.stock-it.qty);}return o;}

function handle(conv,rawText){
 const text=String(rawText||'').slice(0,1000).trim();const t=norm(text);
 if(!conv.state||typeof conv.state!=='object')conv.state={step:'idle',cart:[],data:{},lastProductId:null};
 const st=conv.state;if(!Array.isArray(st.cart))st.cart=[];if(!st.data||typeof st.data!=='object')st.data={};if(typeof st.step!=='string')st.step='idle';
 const S=db.settings;
 if(!t)return['پیامت خالی بود 🙂'];
 if(/(پشتیبان|اپراتور|انسان|آدم واقعی|شکایت|مرجوع)/.test(t)){conv.handoff=true;return['درخواستت ثبت شد 🙋\nهمکار ما به‌زودی جوابت را می‌دهد.'];}
 if(st.step==='await_name'){if(text.length<2)return['نام و نام خانوادگی‌ات را کامل بنویس.'];st.data.name=text;st.step='await_phone';return[`ممنون ${text} 🌹\nشماره موبایلت را بنویس (مثل 09121234567).`];}
 if(st.step==='await_phone'){const d=t.replace(/\D/g,'');if(!/^0?9\d{9}$/.test(d))return['شماره معتبر نیست. به شکل 09121234567 بنویس.'];st.data.phone=d.startsWith('0')?d:'0'+d;st.step='await_address';return['ثبت شد ✅\nآدرس کامل پستی را بنویس.'];}
 if(st.step==='await_address'){if(text.length<10)return['آدرس کوتاه است. کامل بنویس.'];st.data.address=text;st.step='await_confirm';const total=cartTotal(st);const ship=shippingFor(total);return['📋 پیش‌فاکتور:\n\n'+cartText(st)+`\n\nجمع: ${money(total)}\nارسال: ${ship===0?'رایگان 🎉':money(ship)}\nقابل پرداخت: ${money(total+ship)}`+`\n\n👤 ${st.data.name}\n📞 ${st.data.phone}\n📍 ${st.data.address}\n\nتایید؟ (بله / نه)`];}
 if(st.step==='await_confirm'){
  if(/(بله|اره|آره|تایید|تأیید|اوکی|ok|yes|درسته|قبوله)/.test(t)){const o=createOrder(conv,st);st.cart=[];st.step='idle';st.data={};st.lastProductId=null;return[`✅ سفارش ${o.id} ثبت شد!\nمبلغ: ${money(o.payable)}\n\n${S.paymentInfo}`];}
  if(/(نه|لغو|انصراف|کنسل)/.test(t)){st.step='idle';st.data={};return['سفارش ثبت نشد. سبد محفوظ است 🛒'];}
  return['«بله» یا «نه» بنویس.'];
 }
 if(/(سبد|چی دارم)/.test(t)&&!/(حذف|پاک|بردار|خالی)/.test(t)){if(!st.cart.length)return['سبد خالیه 🛒'];return[`🛒 سبد:\n${cartText(st)}\n\nجمع: ${money(cartTotal(st))}\nبرای ثبت بنویس «ثبت سفارش».`];}
 if(/(حذف|پاک کن|بردار|خالی کن)/.test(t)){if(!st.cart.length)return['سبد خالیه.'];const f=searchProducts(t);if(f.length){st.cart=st.cart.filter(x=>x.productId!==f[0].id);return[`«${f[0].name}» حذف شد.`];}st.cart=[];return['سبد خالی شد.'];}
 if(/(ثبت سفارش|تکمیل خرید|نهایی|سفارش بدم|خرید کن|میخوام بخرم)/.test(t)){if(!st.cart.length)return['سبدت خالیه 🛒'];st.step='await_name';return['چند سوال کوتاه.\n1️⃣ نام و نام خانوادگی؟'];}
 if(/(پیگیری|کجاست|وضعیت سفارش|رسید)/.test(t)){const mine=db.orders.filter(o=>o.convId===conv.id).sort((a,b)=>b.createdAt-a.createdAt);if(!mine.length)return['سفارشی پیدا نکردم.'];const o=mine[0];const lb={new:'در حال بررسی',confirmed:'تایید شده',sent:'ارسال شده',delivered:'تحویل شده',canceled:'لغو شده'};return[`📦 سفارش ${o.id}\nوضعیت: ${lb[o.status]||o.status}\nمبلغ: ${money(o.payable)}`];}
 if(/(هزینه ارسال|کرایه|پست|ارسال چقدر)/.test(t))return[`هزینه ارسال ${money(S.shippingCost)} است، بالای ${money(S.freeShippingFrom)} رایگان 🚚`];
 if(/(پرداخت|کارت|درگاه|قسطی)/.test(t))return[`💳 ${S.paymentInfo}`];
 if(/(ساعت کاری|چند تا چند|باز هستید|تعطیل)/.test(t))return[`⏰ ${S.workingHours}`];
 if(/(محصولات|لیست|چی دارید|منو|کاتالوگ)/.test(t)){const byCat={};for(const p of db.products){if(p.active)byCat[p.category]=(byCat[p.category]||0)+1;}const cats=Object.entries(byCat).map(([c,n])=>`• ${c} (${fa(n)} کالا)`).join('\n');return[`دسته‌ها:\n\n${cats}\n\nاسم محصول را بنویس.`];}
 if(st.lastProductId){
  if(/^(نه|خیر|نمیخوام|لازم ندارم)/.test(t)){st.lastProductId=null;return['باشه 👍'];}
  if(/^(بله|اره|آره|اوکی|ok|yes|همین|اضافه|بخر|میخوام|بشه)/.test(t)){const p=db.products.find(x=>x.id===st.lastProductId);if(p){const qm=t.match(/(\d+)/);const qty=qm?Math.max(1,Math.min(50,parseInt(qm[1],10))):1;addToCart(st,p.id,qty);st.lastProductId=null;return[`✅ «${p.name}» × ${fa(qty)} اضافه شد.\nجمع: ${money(cartTotal(st))}\nبرای ثبت بنویس «ثبت سفارش».`];}}
 }
 const found=searchProducts(t);
 if(found.length){const top=found.slice(0,3);st.lastProductId=top[0].id;if(top.length===1){const p=top[0];return[`${p.name}\n${p.description||''}\n💰 ${money(p.price)}\n${p.stock>0?'✅ موجود':'❌ ناموجود'}\n\nاضافه کنم به سبد؟ (بله / نه)`];}return['این‌ها را پیدا کردم:\n\n'+top.map((p,i)=>`${fa(i+1)}. ${p.name} — ${money(p.price)}`).join('\n')+'\n\nاسم دقیق‌تر بنویس.'];}
 if(/^(سلام|درود|hi|hello|وقت بخیر|صبح بخیر)/.test(t))return[`سلام 🌹 به ${S.botName} خوش آمدی.\nمی‌تونم قیمت بدم و سفارشت را ثبت کنم.\nدنبال چی هستی؟`];
 return['متوجه نشدم 🤔 بنویس:\n• اسم محصول (مثل «شال نخی»)\n• «محصولات»\n• «ثبت سفارش»\n• «پشتیبان»'];
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tgSend(chatId,text){if(!TOKEN)return;try{await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:String(text).slice(0,4000),disable_web_page_preview:true})});}catch(e){console.error('tg err:',e.message);}}
async function tgLoop(){let offset=0;while(true){try{const r=await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=30&offset=${offset}`);const j=await r.json();if(!j.ok){await sleep(3000);continue;}for(const u of j.result||[]){offset=u.update_id+1;const m=u.message||u.edited_message;if(!m||!m.text)continue;const f=m.from||{};const name=[f.first_name,f.last_name].filter(Boolean).join(' ');const conv=getOrCreate('telegram',String(m.chat.id),{name,username:f.username||''});pushMsg(conv,'user',m.text);if(conv.handoff){save();continue;}const replies=handle(conv,m.text);for(const rep of replies){pushMsg(conv,'agent',rep);await tgSend(m.chat.id,rep);}save();}}catch(e){console.error('poll err:',e.message);await sleep(3000);}}}

function auth(req,res,next){if(!ADMIN_TOKEN)return next();const g=req.headers['x-admin-token']||req.query.token;if(g===ADMIN_TOKEN)return next();return res.status(401).json({error:'unauthorized'});}

app.get('/api/stats',auth,(req,res)=>{const tk=new Date().toDateString();const to=db.orders.filter(o=>new Date(o.createdAt).toDateString()===tk);const tc=db.conversations.filter(c=>new Date(c.createdAt).toDateString()===tk);const rev=db.orders.filter(o=>o.status!=='canceled').reduce((s,o)=>s+(o.payable||0),0);res.json({totalOrders:db.orders.length,todayOrders:to.length,todayRevenue:to.reduce((s,o)=>s+(o.payable||0),0),totalRevenue:rev,conversations:db.conversations.length,todayConversations:tc.length,needsHuman:db.conversations.filter(c=>c.handoff).length,products:db.products.length,telegramActive:Boolean(TOKEN)});});
app.get('/api/conversations',auth,(req,res)=>{res.json([...db.conversations].sort((a,b)=>(b.lastAt||0)-(a.lastAt||0)).map(c=>({id:c.id,channel:c.channel,name:c.name||c.username||c.externalId,externalId:c.externalId,lastAt:c.lastAt,unread:c.unread||0,handoff:Boolean(c.handoff),hasCart:Boolean(c.state&&c.state.cart&&c.state.cart.length),step:(c.state&&c.state.step)||'idle'})));});
app.get('/api/conversations/:id',auth,(req,res)=>{const c=db.conversations.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'not found'});c.unread=0;save();const ms=db.messages.filter(m=>m.convId===c.id).sort((a,b)=>a.at-b.at);const os=db.orders.filter(o=>o.convId===c.id);res.json({conversation:{id:c.id,channel:c.channel,name:c.name,username:c.username,externalId:c.externalId,handoff:Boolean(c.handoff),state:c.state},messages:ms,orders:os});});
app.post('/api/conversations/:id/reply',auth,async(req,res)=>{const c=db.conversations.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'not found'});const text=String((req.body&&req.body.text)||'').trim();if(!text)return res.status(400).json({error:'empty'});pushMsg(c,'agent',text);if(c.channel==='telegram')await tgSend(c.externalId,text);save();res.json({ok:true});});
app.post('/api/conversations/:id/handoff',auth,(req,res)=>{const c=db.conversations.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'not found'});c.handoff=Boolean(req.body&&req.body.handoff);save();res.json({ok:true,handoff:c.handoff});});
app.post('/api/simulate',auth,(req,res)=>{const b=req.body||{};const text=String(b.text||'').trim();if(!text)return res.status(400).json({error:'empty'});let c;if(b.conversationId)c=db.conversations.find(x=>x.id===b.conversationId);if(!c)c=getOrCreate('web','sim-'+Date.now(),{name:b.name||'مشتری آزمایشی'});pushMsg(c,'user',text);let replies=[];if(!c.handoff){replies=handle(c,text);for(const r of replies)pushMsg(c,'agent',r);}save();res.json({conversationId:c.id,replies,handoff:Boolean(c.handoff)});});
app.get('/api/products',auth,(req,res)=>res.json(db.products));
app.post('/api/products',auth,(req,res)=>{const b=req.body||{};if(!b.name||!b.price)return res.status(400).json({error:'name and price required'});const p={id:nextId('p','product'),name:String(b.name),category:String(b.category||'عمومی'),price:Number(b.price)||0,stock:Number(b.stock)||0,active:b.active!==false,tags:Array.isArray(b.tags)?b.tags.map(String):String(b.tags||'').split(',').map(s=>s.trim()).filter(Boolean),description:String(b.description||'')};db.products.push(p);save();res.json(p);});
app.put('/api/products/:id',auth,(req,res)=>{const p=db.products.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'not found'});const b=req.body||{};if(b.name!==undefined)p.name=String(b.name);if(b.category!==undefined)p.category=String(b.category);if(b.price!==undefined)p.price=Number(b.price)||0;if(b.stock!==undefined)p.stock=Number(b.stock)||0;if(b.active!==undefined)p.active=Boolean(b.active);if(b.description!==undefined)p.description=String(b.description);if(b.tags!==undefined)p.tags=Array.isArray(b.tags)?b.tags.map(String):String(b.tags).split(',').map(s=>s.trim()).filter(Boolean);save();res.json(p);});
app.delete('/api/products/:id',auth,(req,res)=>{const i=db.products.findIndex(x=>x.id===req.params.id);if(i===-1)return res.status(404).json({error:'not found'});db.products.splice(i,1);save();res.json({ok:true});});
app.get('/api/orders',auth,(req,res)=>res.json([...db.orders].sort((a,b)=>b.createdAt-a.createdAt)));
app.patch('/api/orders/:id',auth,(req,res)=>{const o=db.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:'not found'});const s=req.body&&req.body.status;if(s&&!['new','confirmed','sent','delivered','canceled'].includes(s))return res.status(400).json({error:'invalid'});if(s)o.status=s;save();res.json(o);});
app.get('/api/settings',auth,(req,res)=>res.json(db.settings));
app.put('/api/settings',auth,(req,res)=>{const b=req.body||{};const S=db.settings;for(const k of ['shippingCost','freeShippingFrom','dailySummaryHour','autoFollowUpHours','abandonedCartMinutes'])if(b[k]!==undefined)S[k]=Number(b[k])||0;for(const k of ['botName','adminChatId','workingHours','paymentInfo'])if(b[k]!==undefined)S[k]=String(b[k]);save();res.json(S);});

setInterval(async()=>{
 const now=Date.now();const S=db.settings;let dirty=false;
 for(const c of db.conversations){const st=c.state||{};if(!c.flags)c.flags={};const hasCart=Array.isArray(st.cart)&&st.cart.length>0;if(!hasCart)c.flags.abandonedSent=false;else if(st.step==='idle'&&!c.flags.abandonedSent){if(now-(c.lastAt||0)>(S.abandonedCartMinutes||30)*60000){c.flags.abandonedSent=true;dirty=true;const m='یادت نره 🛒 سبد خریدت منتظرته. برای ثبت بنویس «ثبت سفارش».';pushMsg(c,'agent',m);if(c.channel==='telegram')await tgSend(c.externalId,m);}}}
 for(const o of db.orders){if(o.followedUp)continue;if(now-o.createdAt>(S.autoFollowUpHours||24)*3600000){o.followedUp=true;dirty=true;const c=db.conversations.find(x=>x.id===o.convId);if(c){const m=`سلام ${o.customer.name||''} 🌹\nسفارش ${o.id} را پیگیری کردیم. راضی هستی؟`;pushMsg(c,'agent',m);if(c.channel==='telegram')await tgSend(c.externalId,m);}}}
 if(dirty)save();
},60000);

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{console.log('Server on port '+PORT);if(TOKEN){console.log('Telegram polling started.');tgLoop();}else{console.log('No TELEGRAM_BOT_TOKEN — bot disabled.');}});
