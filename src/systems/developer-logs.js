const fs = require('node:fs/promises');
const path = require('node:path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');
const { ContainerBuilder, FileBuilder, TextDisplayBuilder } = require('@discordjs/builders');

const DEFAULT_DEVELOPER_ID = '805501165981794305';
const OUT_LOG = '/root/.pm2/logs/bot4-out-4.log';
const ERROR_LOG = '/root/.pm2/logs/bot4-error-4.log';
const LIVE_REFRESH_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const WEB_DIR = '/root/bots/bot6/httpdocs/bot-logs';
const WEB_KEY_FILE = path.join(__dirname, '..', 'data', 'developer-log-key');
const WEB_BASE_URL = 'https://api.prestonhq.com/bot-logs';
const livePanels = new Map();
let cachedWebKey = null;

function developerIds() {
  return new Set(String(process.env.DEVELOPER_USER_IDS || DEFAULT_DEVELOPER_ID).split(',').map((id) => id.trim()).filter((id) => /^\d{17,20}$/.test(id)));
}
function isDeveloper(userId) { return developerIds().has(String(userId)); }
function redact(value) {
  return String(value || '')
    .replace(/([A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Za-z_]*\s*[:=]\s*)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,})/g, '[REDACTED_DISCORD_TOKEN]')
    .replace(/(Authorization:\s*(?:Bearer|Bot)\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(sftp:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');
}
async function tail(file, lineCount) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    return redact(lineCount === Infinity ? raw : lines.slice(-lineCount).join('\n'));
  } catch (error) { return `Unable to read ${file}: ${error.message}`; }
}
function attachment(content, name) {
  let buffer = Buffer.from(content || 'No log entries.\n', 'utf8');
  if (buffer.length > MAX_ATTACHMENT_BYTES) buffer = buffer.subarray(buffer.length - MAX_ATTACHMENT_BYTES);
  return new AttachmentBuilder(buffer, { name });
}
function preview(content, count) {
  const entries = String(content || '').split(/\r?\n/).filter(Boolean).slice(-count);
  if (!entries.length) return 'No entries right now.';
  return entries.map((line) => line.length > 260 ? `${line.slice(0, 257)}...` : line).join('\n');
}
function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
async function webKey() {
  if (cachedWebKey) return cachedWebKey;
  cachedWebKey = (await fs.readFile(WEB_KEY_FILE, 'utf8')).trim();
  return cachedWebKey;
}
function parseEntries(content, kind) {
  return String(content || '').split(/\r?\n/).filter(Boolean).slice(-500).reverse().map((raw, index) => {
    const jsonStart = raw.indexOf('{'); let parsed = null;
    if (jsonStart >= 0) { try { parsed = JSON.parse(raw.slice(jsonStart)); } catch {} }
    return { id: `${kind}-${index}`, kind, level: String(parsed?.level || (kind === 'error' ? 'error' : 'console')).toLowerCase(), title: parsed?.event || parsed?.message || (kind === 'error' ? 'Error entry' : 'Console entry'), time: parsed?.timestamp || raw.match(/^\S+/)?.[0] || '', detail: parsed ? JSON.stringify(parsed, null, 2) : raw };
  });
}
function logCards(entries) {
  return entries.map((e) => `<article class="log ${html(e.kind)} ${html(e.level)}" data-kind="${html(e.kind)}" data-level="${html(e.level)}" data-search="${html((e.title+' '+e.detail).toLowerCase())}"><button class="log-head"><span class="chev">⌄</span><span class="badge">${html(e.level)}</span><strong>${html(e.title)}</strong><time>${html(e.time)}</time><span class="copy" title="Copy">⧉</span></button><pre>${html(e.detail)}</pre></article>`).join('');
}
async function publishWebViewer(consoleLog, errorLog) {
  const key = await webKey(); const updated = new Date();
  const consoles = parseEntries(consoleLog, 'console'); const errors = parseEntries(errorLog, 'error');
  const entries = [...errors, ...consoles].sort((a,b)=>String(b.time).localeCompare(String(a.time)));
  const warnings = entries.filter(e=>['warn','warning'].includes(e.level)).length;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ECRP Developer Logs</title><style>
:root{color-scheme:dark;--bg:#090b12;--panel:#10131c;--card:#121621;--line:#272d3e;--text:#f3f5fb;--muted:#929aaf;--blue:#6670ff;--red:#f05256;--amber:#f0b232;--green:#2bc56f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#252b47 0,#111525 35%,var(--bg) 72%);color:var(--text);font:14px Inter,system-ui,sans-serif}.wrap{width:min(1280px,calc(100% - 28px));margin:30px auto 80px}.hero{padding:27px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(135deg,#131722fa,#0c0f18fa);box-shadow:0 22px 65px #0008}.eyebrow{color:#a8afff;font-weight:900;text-transform:uppercase;letter-spacing:.14em;font-size:11px}h1{margin:8px 0 5px;font-size:31px}.sub{color:var(--muted)}.health{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}.stat{padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:#171b28}.stat span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;font-weight:900;letter-spacing:.08em}.stat strong{display:block;margin-top:5px;font-size:18px}.online{color:var(--green)}.toolbar{position:sticky;top:10px;z-index:20;margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:14px;background:#0e111bdd;backdrop-filter:blur(14px);box-shadow:0 12px 35px #0005}.row{display:flex;gap:9px;flex-wrap:wrap}.row+.row{margin-top:9px}.toolbar input{flex:1;min-width:240px;background:#151925;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:11px 13px;outline:none}.toolbar input:focus{border-color:var(--blue);box-shadow:0 0 0 3px #6670ff22}button,.btn{background:#171b27;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:10px 13px;font-weight:750;cursor:pointer;text-decoration:none}.filter.active{background:var(--blue);border-color:var(--blue)}.danger{margin-left:auto;background:#35191f;border-color:#652831;color:#ffb5b7}.danger:hover{background:#ed4245;border-color:#ed4245;color:white}.utility.active{color:#111;background:var(--amber);border-color:var(--amber)}.status{display:flex;justify-content:space-between;margin:14px 3px;color:var(--muted);font-size:12px}.log{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:12px;margin:9px 0;overflow:hidden;transition:.15s}.log:hover{border-color:#3a435b;transform:translateY(-1px)}.log.error{border-left-color:var(--red)}.log.warn,.log.warning{border-left-color:var(--amber)}.log-head{display:grid;width:100%;grid-template-columns:auto auto 1fr auto auto;gap:10px;align-items:center;padding:12px 14px;border:0;border-radius:0;text-align:left;background:transparent}.chev{color:var(--muted);transition:.15s}.collapsed .chev{transform:rotate(-90deg)}.badge{font-size:10px;text-transform:uppercase;font-weight:900;padding:4px 7px;border-radius:5px;background:#272d40;color:#c5cbe0}.error .badge{background:#421f27;color:#ffadb0}.warn .badge,.warning .badge{background:#44361b;color:#ffd981}.log strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.log time{color:var(--muted);font-size:12px}.copy{color:var(--muted);font-size:16px}.log pre{margin:0;padding:14px 16px;border-top:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;color:#cbd1df;font:12px/1.6 ui-monospace,Consolas,monospace;max-height:330px;overflow:auto;background:#0d1018}.collapsed pre{display:none}.compact .log{margin:4px 0}.compact .log-head{padding:8px 11px}.compact .log pre{padding:9px 12px;max-height:180px}.empty{display:none;padding:55px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}.empty.show{display:block}.hidden{display:none}.toast{position:fixed;right:20px;bottom:20px;padding:11px 14px;border-radius:9px;background:#202638;border:1px solid #343c54;opacity:0;transform:translateY(8px);transition:.2s}.toast.show{opacity:1;transform:none}@media(max-width:760px){.health{grid-template-columns:repeat(2,1fr)}.log-head{grid-template-columns:auto auto 1fr auto}.copy{display:none}.log time{grid-column:3/-1}.wrap{width:calc(100% - 18px);margin-top:14px}h1{font-size:25px}}
</style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">Developer Operations Center</div><h1>🧰 ECRP Bot Logs</h1><div class="sub">Live diagnostics, structured events, and runtime errors for ECRP Assistant.</div><div class="health"><div class="stat"><span>Status</span><strong class="online">● Online</strong></div><div class="stat"><span>Total entries</span><strong>${entries.length}</strong></div><div class="stat"><span>Errors / warnings</span><strong>${errors.length} / ${warnings}</strong></div><div class="stat"><span>Last generated</span><strong style="font-size:13px">${html(updated.toLocaleString('en-US',{timeZone:'America/New_York'}))} ET</strong></div></div></section><section class="toolbar"><div class="row"><input id="search" placeholder="Search events, IDs, stack traces…"><button class="filter active" data-filter="all">All ${entries.length}</button><button class="filter" data-filter="console">Console ${consoles.length}</button><button class="filter" data-filter="error">Errors ${errors.length}</button><button class="filter" data-filter="warn">Warnings ${warnings}</button></div><div class="row"><button id="pause" class="utility">⏸ Pause refresh</button><button id="compact" class="utility">▦ Compact</button><button id="collapse">Collapse all</button><button id="refresh">↻ Refresh now</button><button id="clear" class="danger">🗑 Clear logs</button><a class="btn" href="${key}-console.txt" download>↓ Console TXT</a><a class="btn" href="${key}-errors.txt" download>↓ Errors TXT</a></div></section><div class="status"><span id="results">Showing ${entries.length} entries</span><span id="countdown">Connecting to live stream…</span></div><section id="logs">${logCards(entries)}</section><div id="empty" class="empty"><strong>No matching log entries</strong><br>Try another search or filter.</div></main><div id="toast" class="toast">Copied</div><script>
let filter='all',paused=false,seconds=30;const q=document.querySelector('#search'),logs=document.querySelector('#logs'),empty=document.querySelector('#empty'),results=document.querySelector('#results'),countdown=document.querySelector('#countdown'),toast=document.querySelector('#toast');function notify(t){toast.textContent=t;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1300)}function apply(){const term=q.value.trim().toLowerCase();let n=0;document.querySelectorAll('.log').forEach(x=>{const lv=x.dataset.level,m=filter==='all'||x.dataset.kind===filter||(filter==='warn'&&(lv==='warn'||lv==='warning')),show=m&&x.dataset.search.includes(term);x.classList.toggle('hidden',!show);if(show)n++});results.textContent='Showing '+n+' of ${entries.length} entries';empty.classList.toggle('show',n===0)}q.oninput=apply;document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));apply()});document.querySelectorAll('.log-head').forEach(h=>h.onclick=e=>{const card=h.closest('.log');if(e.target.classList.contains('copy')){e.stopPropagation();navigator.clipboard.writeText(card.querySelector('pre').textContent).then(()=>notify('Entry copied'));return}card.classList.toggle('collapsed')});document.querySelector('#pause').onclick=e=>{paused=!paused;e.currentTarget.classList.toggle('active',paused);e.currentTarget.textContent=paused?'▶ Resume refresh':'⏸ Pause refresh';countdown.textContent=paused?'Live updates paused':'● Live — instant updates'};document.querySelector('#compact').onclick=e=>{logs.classList.toggle('compact');e.currentTarget.classList.toggle('active')};document.querySelector('#collapse').onclick=e=>{const close=[...document.querySelectorAll('.log')].some(x=>!x.classList.contains('collapsed'));document.querySelectorAll('.log').forEach(x=>x.classList.toggle('collapsed',close));e.currentTarget.textContent=close?'Expand all':'Collapse all'};document.querySelector('#refresh').onclick=()=>location.reload();const stream=new EventSource('/api/bot-logs/${key}/stream');stream.addEventListener('connected',()=>{countdown.textContent='● Live — instant updates';countdown.style.color='var(--green)'});stream.addEventListener('log',()=>{if(!paused)location.reload()});stream.onerror=()=>{countdown.textContent=paused?'Auto-refresh paused':'Live reconnecting…';countdown.style.color='var(--amber)'};document.querySelector('#clear').onclick=async e=>{if(!confirm('Clear all active ECRP console and error logs? Archived backups will remain.'))return;const b=e.currentTarget,old=b.textContent;b.disabled=true;b.textContent='Clearing…';try{const r=await fetch('/api/bot-logs/${key}/clear',{method:'POST',headers:{'Content-Type':'application/json'}});if(!r.ok)throw new Error('Clear failed');document.querySelectorAll('.log').forEach(x=>x.remove());apply();notify('Active logs cleared');b.textContent='✓ Logs cleared';setTimeout(()=>location.reload(),500)}catch(err){notify('Could not clear logs');b.textContent=old;b.disabled=false}};setInterval(()=>{if(paused)return;if(--seconds<=0)location.reload()},1000);apply();
</script></body></html>`;
  await fs.mkdir(WEB_DIR,{recursive:true});
  await Promise.all([fs.writeFile(path.join(WEB_DIR,`${key}.html`),page,'utf8'),fs.writeFile(path.join(WEB_DIR,`${key}-console.txt`),consoleLog||'No console entries.\n','utf8'),fs.writeFile(path.join(WEB_DIR,`${key}-errors.txt`),errorLog||'No error entries.\n','utf8')]);
  return `${WEB_BASE_URL}/${key}.html`;
}
async function refreshWebViewer() {
  const [consoleLog, errorLog] = await Promise.all([tail(OUT_LOG, Infinity), tail(ERROR_LOG, Infinity)]);
  return publishWebViewer(consoleLog, errorLog);
}
async function logPayload(requestedAll, lines) {
  const [consoleLog, errorLog] = await Promise.all([tail(OUT_LOG, lines), tail(ERROR_LOG, lines)]);
  const viewerUrl = await publishWebViewer(consoleLog, errorLog);
  const scope = requestedAll ? 'All available lines' : `Latest ${lines} lines`;
  const refreshed = Math.floor(Date.now() / 1000);
  const container = new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(
    new TextDisplayBuilder().setContent(['# 🧰 ECRP Developer Logs',`**Scope:** ${scope}`,`**Uptime:** ${Math.floor(process.uptime()/60)}m  •  **Memory:** ${Math.round(process.memoryUsage().rss/1024/1024)} MB`,requestedAll?`**Live:** Every 30 seconds  •  **Updated:** <t:${refreshed}:R>`:`**Generated:** <t:${refreshed}:R>`,`### 🌐 [Open Live Log Viewer](${viewerUrl})`].join('\n')),
    new TextDisplayBuilder().setContent(`### 🖥️ Latest Console Activity\n\`\`\`text\n${preview(consoleLog,4)}\n\`\`\``),
    new TextDisplayBuilder().setContent(`### 🚨 Latest Errors\n\`\`\`text\n${preview(errorLog,2)}\n\`\`\``),
    new TextDisplayBuilder().setContent('### 📁 Full Log Files\nDownload either file below. Sensitive values are automatically redacted.')
  ).addFileComponents(new FileBuilder().setURL('attachment://ecrp-console.log.txt').setSpoiler(true),new FileBuilder().setURL('attachment://ecrp-errors.log.txt').setSpoiler(true));
  return {components:[container],files:[attachment(consoleLog,'ecrp-console.log.txt'),attachment(errorLog,'ecrp-errors.log.txt')],attachments:[],flags:MessageFlags.IsComponentsV2};
}
function startLivePanel(sentMessage,key,lines){const previous=livePanels.get(key);if(previous)clearInterval(previous);const timer=setInterval(async()=>{try{await sentMessage.edit(await logPayload(true,lines));}catch(error){clearInterval(timer);livePanels.delete(key);console.error('[botlogs] Live panel stopped:',error.message);}},LIVE_REFRESH_MS);timer.unref();livePanels.set(key,timer);}
async function send(message,argument){if(!isDeveloper(message.author.id)){await message.reply('This command is developer-only.');return;}const requestedAll=String(argument||'').trim().toLowerCase()==='all';const parsed=Number.parseInt(argument||'250',10);const lines=requestedAll?Infinity:Math.min(2000,Math.max(25,Number.isInteger(parsed)?parsed:250));const sent=await message.channel.send(await logPayload(requestedAll,lines));if(requestedAll)startLivePanel(sent,`${message.guildId}:${message.channelId}:${message.author.id}`,lines);await message.delete().catch(()=>null);}
module.exports={isDeveloper,send,refreshWebViewer};