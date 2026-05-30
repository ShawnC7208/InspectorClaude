import { dashboardCss } from "./dashboardHtml.js";

export type PreviewState = {
  model: unknown;
  reportMd: string;
};

const VIEW_LABELS: Array<[string, string]> = [
  ["overview", "Overview"],
  ["activity", "Activity"],
  ["patterns", "Anti-Patterns"],
  ["context", "Context Health"],
  ["harness", "AI Harness"],
  ["skills", "Skills"],
  ["privacy", "Privacy"],
  ["reports", "Reports"]
];

/**
 * Safely embed arbitrary data as JSON inside a <script type="application/json"> tag.
 * Browsers do not execute these blocks; they are read as plain text.
 * We still escape </script> to prevent accidental tag injection.
 */
function safeJsonEmbed(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script>/gi, "<\\/script>");
}

export function renderMcpAppHtml(preview?: PreviewState): string {
  const navButtons = VIEW_LABELS.map(
    ([id, label]) => `<button class="nav-tab" data-view-target="${id}" type="button">${label}</button>`
  ).join("");

  // When preview state is available, inject it so the client JS can skip the
  // MCP handshake and render immediately in a plain browser tab.
  const initialDataTag = preview
    ? `\n  <script id="lens-initial-data" type="application/json">${safeJsonEmbed({ model: preview.model, reportMd: preview.reportMd })}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>InspectorClaude</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${dashboardCss()}</style>
  <style>
    .connecting-state{display:grid;place-items:center;min-height:60vh;color:var(--muted);font-size:15px;}
    .score-focus{display:grid;gap:6px;padding:14px;}
    .preview-banner{background:var(--accent,#6b6af0);color:#fff;font-size:12px;padding:6px 16px;text-align:center;letter-spacing:.02em;}
  </style>${initialDataTag}
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar" aria-label="Dashboard views">
      <div class="brand">
        <div class="brand-wordmark" aria-hidden="true">
          <span class="brand-mark">🔍</span><span class="brand-inspector">Inspector</span><span class="brand-claude">Claude</span>
        </div>
        <div class="brand-subtitle">Local chat analysis dashboard</div>
      </div>
      <nav class="nav-tabs">${navButtons}</nav>
      <div class="privacy-pill" id="privacy-pill">Local only — Metadata only</div>
    </aside>
    <section class="workspace" id="workspace">
      <div class="connecting-state" id="connect-msg">Connecting to InspectorClaude…</div>
    </section>
  </main>
  <script>${mcpAppClientJs()}</script>
</body>
</html>`;
}

function mcpAppClientJs(): string {
  return `
(function(){
// ===== postMessage bridge =====
var _id=1,_pending={};
window.addEventListener('message',function(event){
  var msg=event.data;
  if(!msg||typeof msg!=='object'||msg.jsonrpc!=='2.0')return;
  if(msg.id!=null&&_pending[msg.id]){
    var cb=_pending[msg.id];delete _pending[msg.id];
    if(msg.error)cb.reject(msg.error);else cb.resolve(msg.result);
    return;
  }
  if(msg.method==='ui/toolResult'&&msg.params&&msg.params.result)handleToolResult(msg.params.result);
});
function send(msg){if(window.parent&&window.parent!==window)window.parent.postMessage(msg,'*');}
function callTool(name,args){
  return new Promise(function(resolve,reject){
    var id=_id++;_pending[id]={resolve:resolve,reject:reject};
    send({jsonrpc:'2.0',id:id,method:'tools/call',params:{name:name,arguments:args||{}}});
  });
}
// ===== MCP App UI handshake (no-op in preview mode; required when hosted in Claude) =====
(function(){
  var id=_id++;
  _pending[id]={
    resolve:function(){send({jsonrpc:'2.0',method:'ui/initialized'});},
    reject:function(){}
  };
  send({jsonrpc:'2.0',id:id,method:'ui/initialize',params:{protocolVersion:'2026-01-26',name:'InspectorClaude Dashboard',version:'0.1.0'}});
})();

// ===== Preview mode: render from server-injected initial data =====
var _previewMode=false;
(function(){
  var el=document.getElementById('lens-initial-data');
  if(!el)return;
  try{
    var data=JSON.parse(el.textContent||el.innerHTML);
    if(!data||!data.model)return;
    _previewMode=true;
    var ws=document.getElementById('workspace');
    if(ws){
      var banner='<div class="preview-banner">Preview mode — showing last analyzed data · Run show_dashboard in Claude to refresh</div>';
      ws.insertAdjacentHTML('afterbegin',banner);
    }
    // Skip MCP handshake and render immediately
    setTimeout(function(){render(data.model,data.reportMd||'');},0);
  }catch(e){/* fall through to MCP handshake */}
})();

// ===== State =====
var _currentView='overview',_model=null,_reportMd='';

// ===== Helpers =====
function esc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fd(v){
  if(!v)return'date unavailable';
  var d=new Date(v);if(isNaN(d.getTime()))return v;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function dur(s,e){
  if(!s||!e)return unavail('not available from this source');
  var st=new Date(s).getTime(),en=new Date(e).getTime();
  if(isNaN(st)||isNaN(en)||en<st)return unavail('not available from this source');
  var min=Math.round((en-st)/60000);
  if(min<1)return'<1 min';if(min<60)return min+' min';
  var h=Math.floor(min/60),r=min%60;return r?h+'h '+r+'m':h+'h';
}
function unavail(reason){return'<span class="unavailable">Unavailable: '+esc(reason)+'</span>';}
function empty(msg){return'<div class="empty-state">'+esc(msg)+'</div>';}
function metricList(items){
  return'<dl class="metric-list">'+items.map(function(it){
    return'<div><dt>'+esc(it[0])+'</dt><dd>'+it[1]+'</dd></div>';
  }).join('')+'</dl>';
}
var SCORE_ORDER=['prompt_clarity','context_health','workflow_structure','ai_harness','efficiency','privacy','session_hygiene'];
var CAT_LABELS={prompt_clarity:'Prompt clarity',context_health:'Context health',workflow_structure:'Workflow structure',ai_harness:'AI harness',efficiency:'Efficiency',privacy:'Privacy',session_hygiene:'Session hygiene'};
var SRC_LABELS={code:'Claude Code',chat:'Claude Chat',cowork:'Claude Cowork'};
var CAP_LABELS={claude_code_log:'Local JSONL session logs',claude_ai_export:'claude.ai data export',current_chat_input:'Current chat input',manual_import:'Manual import',checkpoint:'Checkpoint',task_summary:'Task summary',artifact_summary:'Artifact summary',report_import:'Report import'};
function capMode(m){return CAP_LABELS[m]||m.replace(/_/g,' ');}
function evidMode(model){return model.privacy.evidenceMode==='redacted_excerpts'?'Redacted excerpts':'Metadata only';}

// ===== Components =====
function scoreCards(scores){
  return SCORE_ORDER.map(function(id){
    var s=scores.find(function(x){return x.id===id;});if(!s)return'';
    var ring=s.status==='unavailable'?0:s.value,display=s.status==='unavailable'?'N/A':s.value;
    return'<article class="score-card '+s.status+'">'
      +'<div class="score-ring" style="--score:'+ring+'"><span>'+display+'</span></div>'
      +'<div><h3>'+esc(s.label)+'</h3><p>'+esc(s.explanation)+'</p></div>'
      +'</article>';
  }).join('');
}
var SEV_RANK={high:4,medium:3,low:2,info:1};
function severityRank(s){return SEV_RANK[s]||0;}
function groupFindingsByRule(findings){
  var groups={},order=[];
  findings.forEach(function(f){
    var key=f.ruleId||f.title;
    if(!groups[key]){groups[key]=[];order.push(key);}
    groups[key].push(f);
  });
  return order.map(function(k){return{key:k,items:groups[k]};});
}
function headSeverity(items){
  var best='info';
  items.forEach(function(f){if(severityRank(f.severity)>severityRank(best))best=f.severity;});
  return best;
}
function rankGroups(groups){
  return groups.slice().sort(function(a,b){
    var ds=severityRank(headSeverity(b.items))-severityRank(headSeverity(a.items));
    if(ds!==0)return ds;
    var maxA=Math.max.apply(null,a.items.map(function(f){return f.confidence;}));
    var maxB=Math.max.apply(null,b.items.map(function(f){return f.confidence;}));
    if(maxB!==maxA)return maxB-maxA;
    return b.items.length-a.items.length;
  });
}
function rankItems(items){
  return items.slice().sort(function(a,b){
    return severityRank(b.severity)-severityRank(a.severity)||(b.confidence-a.confidence);
  });
}
function findingGroupCard(group){
  var items=rankItems(group.items);
  var head=items[0];
  var seen={},sessions=0;
  group.items.forEach(function(f){(f.interactionIds||[]).forEach(function(id){if(!seen[id]){seen[id]=1;sessions++;}});});
  var maxConfidence=Math.max.apply(null,group.items.map(function(f){return f.confidence;}));
  var topSeverity=headSeverity(group.items);
  var sessionBadge=sessions>1?'<span class="session-count">'+sessions+' sessions</span>':'';
  var evidenceList=[];
  items.forEach(function(f){(f.evidence||[]).forEach(function(e){evidenceList.push(e);});});
  var ev='';
  if(evidenceList.length){
    var summary=sessions>1?'Evidence from '+sessions+' sessions':'Evidence';
    ev='<div class="evidence-section"><div class="evidence-header">'+esc(summary)+'</div><div class="evidence-list">'
      +evidenceList.map(function(e){
        return'<details class="evidence-detail"><summary>'+esc(e.label)+'</summary>'
          +(e.excerpt
            ?'<blockquote class="evidence-excerpt-block">'+esc(e.excerpt)+'</blockquote>'
            :'<p class="no-excerpt-hint">Prompt text not loaded. <button class="link-btn" data-load-excerpts type="button">Load prompt excerpts</button></p>')
          +'</details>';
      }).join('')+'</div></div>';
  }
  return'<article class="finding-card" data-source="'+esc(head.source)+'" data-severity="'+esc(topSeverity)+'">'
    +'<div class="finding-topline"><span class="severity '+esc(topSeverity)+'">'+esc(topSeverity)+'</span>'
    +sessionBadge
    +'<span>'+Math.round(maxConfidence*100)+'% confidence</span></div>'
    +'<h3>'+esc(head.title)+'</h3><p>'+esc(head.explanation)+'</p>'
    +'<div class="next-action">'+esc(head.recommendation)+'</div>'+ev+'</article>';
}
function renderFindings(findings){
  return rankGroups(groupFindingsByRule(findings)).map(findingGroupCard).join('');
}
function actionRow(rec){
  return'<article class="action-row">'
    +'<strong>'+esc(rec.title)+'</strong>'
    +'<p>'+esc(rec.nextAction)+'</p>'
    +'<span>'+esc(rec.impact)+' impact — '+esc(rec.effort)+' effort</span>'
    +'</article>';
}
function sourceRow(src){
  var status=src.enabled?'Analyzed':'Unavailable';
  var modes=src.captureModes.length?src.captureModes.map(capMode).join(', '):'No supported data found';
  var lims=src.limitations.length?'<ul>'+src.limitations.map(function(l){return'<li>'+esc(l)+'</li>';}).join('')+'</ul>':'';
  return'<article class="source-row '+(src.enabled?'enabled':'disabled')+'">'
    +'<div><strong>'+esc(SRC_LABELS[src.source]||src.source)+'</strong><span>'+esc(modes)+'</span></div>'
    +'<span>'+esc(status)+'</span>'+lims+'</article>';
}
function activityBars(model){
  var sessions=model.activity.sessions.slice(-12);
  if(!sessions.length)return empty('No activity to chart yet.');
  var maxEv=Math.max.apply(null,sessions.map(function(s){return s.eventCount;}).concat([1]));
  return'<div class="sparkline" aria-label="Recent activity chart">'+sessions.map(function(s){
    var h=Math.max(12,Math.round((s.eventCount/maxEv)*72));
    return'<span title="'+esc(s.title||s.interactionId)+'" style="height:'+h+'px"></span>';
  }).join('')+'</div>';
}
function fmtTok(v){if(v>=1000000)return(v/1000000).toFixed(1)+'M';if(v>=1000)return Math.round(v/1000)+'k';return''+v;}
function sessTokens(s){
  if(s.totalTokens==null||s.tokenSource==='none')return unavail('not available from this source');
  var f=fmtTok(s.totalTokens);
  return s.tokenSource==='estimated'?'~'+f+' <span class="metric-note">est.</span>':f;
}
function sessCache(s){
  if(s.tokenSource!=='exact'||s.cacheHitRatio==null)return unavail('Claude Code only');
  return Math.round(s.cacheHitRatio*100)+'%';
}
function sessionFindingItem(f,interactionId){
  var evidence=(f.evidence||[]).filter(function(e){return e.interactionId===interactionId;});
  var evBlock='';
  if(evidence.length){
    evBlock='<div class="evidence-list">'+evidence.map(function(e){
      return'<details class="evidence-detail"><summary>'+esc(e.label)+'</summary>'
        +(e.excerpt
          ?'<blockquote class="evidence-excerpt-block">'+esc(e.excerpt)+'</blockquote>'
          :'<p class="no-excerpt-hint">Prompt text not loaded. <button class="link-btn" data-load-excerpts type="button">Load prompt excerpts</button></p>')
        +'</details>';
    }).join('')+'</div>';
  }
  return'<div class="session-finding" data-severity="'+esc(f.severity)+'">'
    +'<div class="finding-topline"><span class="severity '+esc(f.severity)+'">'+esc(f.severity)+'</span>'
    +'<span>'+esc(CAT_LABELS[f.category]||f.category)+'</span>'
    +'<span>'+Math.round(f.confidence*100)+'% confidence</span></div>'
    +'<h4>'+esc(f.title)+'</h4><p>'+esc(f.explanation)+'</p>'
    +'<div class="next-action">'+esc(f.recommendation)+'</div>'+evBlock+'</div>';
}
function sessionRow(s,findings){
  findings=findings||[];
  var flag=s.highUsage?' <span class="flag-badge" title="Unusually high token usage vs. your other sessions">high usage</span>':'';
  var header='<div><span class="source-badge">'+esc(s.source)+'</span>'
    +'<strong>'+esc(s.title||s.interactionId)+'</strong>'+flag
    +'<p>'+fd(s.startedAt)+(s.endedAt?' to '+fd(s.endedAt):'')+' </p></div>'
    +'<dl><dt>Events</dt><dd>'+s.eventCount+'</dd>'
    +'<dt>Findings</dt><dd>'+s.findingCount+'</dd>'
    +'<dt>Tokens</dt><dd>'+sessTokens(s)+'</dd>'
    +'<dt>Cache hit</dt><dd>'+sessCache(s)+'</dd>'
    +'<dt>Duration</dt><dd>'+dur(s.startedAt,s.endedAt)+'</dd></dl>';
  if(!findings.length){
    return'<article class="session-row" data-session-source="'+esc(s.source)+'">'+header+'</article>';
  }
  var items=rankItems(findings).map(function(f){return sessionFindingItem(f,s.interactionId);}).join('');
  return'<details class="session-row session-row--expandable" data-session-source="'+esc(s.source)+'">'
    +'<summary class="session-summary">'+header+'</summary>'
    +'<div class="session-findings"><div class="session-findings-head">Findings in this session</div>'+items+'</div>'
    +'</details>';
}
function harnessInventory(model){
  var h=model.harness;
  function pl(c,t){if(c===0)return'None detected';if(c===t)return'Detected in all '+t;return'Detected in '+c+' of '+t;}
  if(!h||h.scannedProjectCount===0){
    return metricList([
      ['Project roots',unavail('not available from analyzed inputs')],
      ['CLAUDE.md',unavail('project root scan unavailable')],
      ['Claude settings',unavail('project root scan unavailable')],
      ['Skills',model.skillOpportunities.length?model.skillOpportunities.length+' opportunity found':'No opportunity yet'],
      ['Hooks',unavail('project root scan unavailable')],
      ['Agents',unavail('project root scan unavailable')],
      ['MCP config',unavail('project root scan unavailable')]
    ]);
  }
  return metricList([
    ['Project roots scanned',h.scannedProjectCount+' of '+Math.max(h.projectCount,h.scannedProjectCount)],
    ['CLAUDE.md',pl(h.claudeMdProjects,h.scannedProjectCount)],
    ['Claude settings',pl(h.settingsProjects,h.scannedProjectCount)],
    ['Skills',model.skillOpportunities.length?model.skillOpportunities.length+' opportunity found':'No opportunity yet'],
    ['Hooks',pl(h.hookProjects,h.scannedProjectCount)],
    ['Agents',pl(h.agentProjects,h.scannedProjectCount)],
    ['MCP config',pl(h.mcpConfigProjects,h.scannedProjectCount)]
  ]);
}
function countFindings(model,catContains,titleContains){
  var n=model.findings.filter(function(f){
    return f.category.indexOf(catContains)>=0&&(f.title+' '+f.explanation).toLowerCase().indexOf(titleContains)>=0;
  }).length;
  return n?String(n):'None detected';
}
function groupByCategory(findings){
  var g={};
  findings.forEach(function(f){if(!g[f.category])g[f.category]=[];g[f.category].push(f);});
  return Object.entries(g);
}
function scoreFocus(score){
  if(!score)return empty('Score unavailable.');
  var display=score.status==='unavailable'?'N/A':score.value;
  return'<div class="large-score">'+display+'</div><h3>'+esc(score.label)+'</h3><p>'+esc(score.explanation)+'</p>';
}

// ===== Views =====
function buildOverview(model){
  var topGroups=rankGroups(groupFindingsByRule(model.findings)).slice(0,3);
  var recs=model.recommendations.slice(0,3);
  var srcCount=model.sources.filter(function(s){return s.enabled;}).length;
  return'<section class="view" data-view="overview">'
    +'<div class="section-head"><h2>Overview</h2><p>Practice quality, source coverage, and next improvements.</p></div>'
    +'<div class="score-grid">'+scoreCards(model.scores)+'</div>'
    +'<div class="two-column">'
    +'<section class="panel"><div class="panel-head"><h3>Top Findings</h3><span>'+(topGroups.length||'None')+'</span></div>'
    +(topGroups.length?topGroups.map(findingGroupCard).join(''):empty('No major coaching findings in this model.'))+'</section>'
    +'<section class="panel"><div class="panel-head"><h3>Recommended Actions</h3><span>'+(recs.length||'None')+'</span></div>'
    +(recs.length?recs.map(actionRow).join(''):empty('No recommendations yet. Add more explicit Claude activity to get coaching.'))+'</section>'
    +'</div>'
    +'<div class="two-column">'
    +'<section class="panel"><div class="panel-head"><h3>Source Coverage</h3><span>'+srcCount+' of 3</span></div>'
    +model.sources.map(sourceRow).join('')+'</section>'
    +'<section class="panel"><div class="panel-head"><h3>Recent Activity</h3><span>'+model.activity.sessions.length+' sessions</span></div>'
    +activityBars(model)+'</section>'
    +'</div></section>';
}
function groupFindingsByInteraction(findings){
  var map={};
  (findings||[]).forEach(function(f){
    (f.interactionIds||[]).forEach(function(id){(map[id]=map[id]||[]).push(f);});
  });
  return map;
}
function activityImportHelp(){
  return'<details class="help-panel">'
    +'<summary><span class="help-icon" aria-hidden="true">＋</span>How to add Claude Chat &amp; Cowork sessions</summary>'
    +'<div class="help-body">'
    +'<p>Chat and Cowork activity is never read automatically. Add it yourself, then click <strong>Analyze All</strong> to re-scan.</p>'
    +'<h4>Option 1 — claude.ai data export (recommended)</h4>'
    +'<ol>'
    +'<li>In Claude, open <strong>Settings → Privacy → Export data</strong> and request your export. Anthropic emails you a download link (it can take a little while to arrive).</li>'
    +'<li>Download it and leave it in your <strong>Downloads</strong> folder. InspectorClaude auto-detects an exported folder named like <code>data-…-batch-1</code>, or a zip named like <code>claude-export-….zip</code>.</li>'
    +'<li>Click <strong>Analyze All</strong>.</li>'
    +'</ol>'
    +'<h4>Option 2 — drop in transcripts or summaries manually</h4>'
    +'<ul>'
    +'<li>Save Chat transcripts or summaries (<code>.md</code>, <code>.txt</code>, or <code>.json</code>) into <code>~/.inspectorclaude/imports/chat/</code></li>'
    +'<li>Save Cowork checkpoints, transcripts, or summaries into <code>~/.inspectorclaude/imports/cowork/</code></li>'
    +'<li>Click <strong>Analyze All</strong>.</li>'
    +'</ul>'
    +'<p class="help-note">Everything stays on your machine — InspectorClaude reads only the export and import folders above, never hidden Claude app databases.</p>'
    +'</div></details>';
}
function buildActivity(model){
  var total=model.activity.sessions.length;
  var counts={code:0,chat:0,cowork:0};
  model.activity.sessions.forEach(function(s){if(counts[s.source]!==undefined)counts[s.source]++;});
  var filterBtns=['all','chat','cowork','code'].map(function(src){
    var count=src==='all'?total:counts[src];
    var label=src==='all'?'All':src.charAt(0).toUpperCase()+src.slice(1);
    return'<button class="filter-button" data-source-filter="'+src+'" type="button">'+label+' <span>'+count+'</span></button>';
  }).join('');
  var byInteraction=groupFindingsByInteraction(model.findings);
  return'<section class="view" data-view="activity">'
    +'<div class="section-head"><h2>Activity</h2><p>Analyzed sessions by surface. Duration and model cost stay unavailable when the source cannot support them.</p></div>'
    +'<div class="filter-row" aria-label="Activity filters">'+filterBtns+'</div>'
    +activityImportHelp()
    +'<section class="panel timeline-panel">'
    +(total?model.activity.sessions.map(function(s){return sessionRow(s,byInteraction[s.interactionId]||[]);}).join(''):empty('No sessions available. Analyze Code logs or import Chat/Cowork summaries.'))
    +'<div class="empty-state filter-empty" data-filter-empty hidden>No sessions match this source filter.</div>'
    +'</section></section>';
}
function buildPatterns(model){
  var groups=groupByCategory(model.findings);
  return'<section class="view" data-view="patterns">'
    +'<div class="section-head"><h2>Anti-Patterns</h2><p>Constructive patterns to improve, grouped by coaching area.</p></div>'
    +(groups.length?groups.map(function(e){
      var catGroups=rankGroups(groupFindingsByRule(e[1]));
      return'<section class="panel">'
        +'<div class="panel-head"><h3>'+esc(CAT_LABELS[e[0]]||e[0])+'</h3><span>'+catGroups.length+'</span></div>'
        +catGroups.map(findingGroupCard).join('')+'</section>';
    }).join(''):empty('No anti-patterns detected yet.'))
    +'</section>';
}
function buildContext(model){
  var ctx=model.findings.filter(function(f){return f.category==='context_health';});
  var score=model.scores.find(function(s){return s.id==='context_health';});
  return'<section class="view" data-view="context">'
    +'<div class="section-head"><h2>Context Health</h2><p>Signals about overloaded sessions, restarts, summaries, compactions, and topic drift.</p></div>'
    +'<div class="two-column">'
    +'<section class="panel score-focus">'+scoreFocus(score)+'</section>'
    +'<section class="panel">'+metricList([
      ['Long sessions',countFindings(model,'context','long')],
      ['Compactions',countFindings(model,'context','compaction')],
      ['Topic drift',countFindings(model,'context','topic')],
      ['Summary opportunities',countFindings(model,'context','summary')]
    ])+'</section>'
    +'</div>'
    +'<section class="panel"><div class="panel-head"><h3>Context Findings</h3><span>'+(ctx.length||'None')+'</span></div>'
    +(ctx.length?renderFindings(ctx):empty('No context-health findings yet.'))
    +'</section></section>';
}
function buildHarness(model){
  var hf=model.findings.filter(function(f){return f.category==='ai_harness';});
  var score=model.scores.find(function(s){return s.id==='ai_harness';});
  return'<section class="view" data-view="harness">'
    +'<div class="section-head"><h2>AI Harness</h2><p>Reusable ways to make Claude better at repeated work.</p></div>'
    +'<div class="two-column">'
    +'<section class="panel score-focus">'+scoreFocus(score)+'</section>'
    +'<section class="panel">'+harnessInventory(model)+'</section>'
    +'</div>'
    +'<section class="panel"><div class="panel-head"><h3>Harness Suggestions</h3><span>'+(hf.length||'None')+'</span></div>'
    +(hf.length?renderFindings(hf):empty('No AI harness findings yet.'))
    +'</section></section>';
}
function buildSkills(model){
  return'<section class="view" data-view="skills">'
    +'<div class="section-head"><h2>Skills</h2><p>Repeated workflows that could become reusable Claude skills or instructions.</p></div>'
    +'<section class="panel">'
    +(model.skillOpportunities.length?model.skillOpportunities.map(function(sk){
      var badges=(sk.surfaces&&sk.surfaces.length?sk.surfaces:[sk.surface]).map(function(s){return'<span class="source-badge">'+esc(s)+'</span>';}).join(' ');
      var occ=sk.occurrenceCount+' '+(sk.occurrenceCount===1?'occurrence':'occurrences');
      var keywords=(sk.keywords&&sk.keywords.length)?'<div class="keyword-row">'+sk.keywords.map(function(k){return'<span class="keyword-tag">'+esc(k)+'</span>';}).join('')+'</div>':'';
      var examples=(sk.examples&&sk.examples.length)?'<dt>Repeated work</dt><dd><ul class="skill-examples">'+sk.examples.map(function(e){return'<li>'+esc(e)+'</li>';}).join('')+'</ul></dd>':'';
      var actions='';
      if(sk.scaffold)actions+='<button class="secondary-button" type="button" data-copy-text="'+esc(sk.scaffold)+'" data-copy-label="Copy starter">Copy starter</button>';
      if(sk.draftPrompt)actions+='<button class="secondary-button" type="button" data-copy-text="'+esc(sk.draftPrompt)+'" data-copy-label="Copy drafting prompt">Copy drafting prompt</button>';
      if(actions)actions='<div class="skill-actions">'+actions+'</div>';
      return'<article class="skill-card">'
        +'<div>'+badges
        +'<h3>'+esc(sk.suggestedName)+'</h3>'+keywords+'<p>'+esc(sk.problem)+'</p>'+actions+'</div>'
        +'<dl><dt>Occurrences</dt><dd>'+occ+'</dd>'
        +examples
        +'<dt>Draft behavior</dt><dd>'+esc(sk.draftBehavior)+'</dd>'
        +'<dt>Impact</dt><dd>'+esc(sk.impact)+'</dd></dl>'
        +'</article>';
    }).join(''):empty('No skill opportunities yet. Lens waits for repeated patterns before suggesting reusable assets.'))
    +'</section></section>';
}
function buildPrivacy(model){
  var p=model.privacy;
  return'<section class="view" data-view="privacy">'
    +'<div class="section-head"><h2>Privacy</h2><p>What InspectorClaude analyzed, what it stored, and what evidence mode is active.</p></div>'
    +'<div class="two-column">'
    +'<section class="panel">'+metricList([
      ['Storage',p.cacheEnabled?'Cache enabled':'No cache enabled'],
      ['Evidence',evidMode(model)],
      ['Redaction',p.redactionApplied?'Applied before display/export':'Not applied'],
      ['Exports this session',p.exportedThisSession?'Yes':'No'],
      ['Outbound AI',p.localOnly?'None — local analysis only':'Review optional outbound settings']
    ])+'</section>'
    +'<section class="panel"><div class="panel-head"><h3>Capability Notes</h3><span>'+model.capabilityNotes.length+'</span></div>'
    +model.capabilityNotes.map(function(n){
      return'<p class="note-line"><strong>'+esc(n.source)+'</strong> '+esc(n.message)+'</p>';
    }).join('')+'</section>'
    +'</div>'
    +'<section class="panel"><div class="panel-head"><h3>Privacy Notes</h3><span>'+p.findingCount+' findings</span></div>'
    +p.notes.map(function(note){return'<p class="note-line">'+esc(note)+'</p>';}).join('')
    +'</section></section>';
}
function buildReports(reportMd){
  return'<section class="view" data-view="reports">'
    +'<div class="section-head"><h2>Reports</h2><p>Portable coaching summaries for pasting into Claude Chat, Cowork, or another review process.</p></div>'
    +'<div class="report-actions">'
    +'<button class="primary-button" id="copy-md-btn" type="button">Copy Markdown</button>'
    +'<button class="secondary-button" id="copy-json-btn" type="button">Copy JSON</button>'
    +'<span class="copy-status" id="copy-status" aria-live="polite"></span>'
    +'</div>'
    +'<section class="panel report-preview"><pre id="report-preview">'+esc(reportMd)+'</pre></section>'
    +'</section>';
}

function buildWorkspace(model,reportMd){
  var os=model.summary&&model.summary.overallScore;
  var display=os&&os.status!=='unavailable'?os.value:'N/A';
  var status=os&&os.status!=='unavailable'?os.status.replace(/_/g,' '):'unavailable';
  var headline=model.summary?model.summary.headline:'InspectorClaude is ready for local analysis';
  return'<header class="topbar">'
    +'<div><p class="eyebrow">Generated '+fd(model.generatedAt)+'</p><h1>'+esc(headline)+'</h1></div>'
    +'<div class="overall-score" aria-label="Overall practice score">'
    +'<span>'+display+'</span><small>'+esc(status)+'</small></div>'
    +'<div class="topbar-actions">'
    +'<button class="primary-button" id="analyze-all-btn" type="button">Analyze All</button>'
    +'<span class="analyze-status" id="analyze-status" aria-live="polite"></span>'
    +'</div></header>'
    +buildOverview(model)
    +buildActivity(model)
    +buildPatterns(model)
    +buildContext(model)
    +buildHarness(model)
    +buildSkills(model)
    +buildPrivacy(model)
    +buildReports(reportMd);
}

// ===== Main render =====
function render(model,reportMd){
  _model=model;_reportMd=reportMd||'';
  var ws=document.getElementById('workspace');
  if(!ws)return;
  ws.innerHTML=buildWorkspace(model,_reportMd);
  // Update privacy pill
  var pill=document.getElementById('privacy-pill');
  if(pill&&model.privacy)pill.textContent=(model.privacy.localOnly?'Local only':'Review storage')+' — '+evidMode(model);
  // Show the current or first view
  showView(_currentView);
  setupNavigation();setupActivityFilters();setupCopyButtons();setupAnalyzeAll();setupLoadExcerpts();
}

function setupLoadExcerpts(){
  var ws=document.getElementById('workspace');
  if(!ws||ws.dataset.excerptsWired)return;
  ws.dataset.excerptsWired='1';
  ws.addEventListener('click',function(e){
    var btn=e.target&&e.target.closest('[data-load-excerpts]');
    if(!btn)return;
    var status=document.getElementById('analyze-status');
    var detail=e.target&&e.target.closest('details');
    if(_previewMode){
      if(status)status.textContent='Loading prompt excerpts…';
      fetch('/preview/data?includeEvidence=1').then(function(r){
        if(!r.ok)throw new Error('HTTP '+r.status);
        return r.json();
      }).then(function(data){
        if(!data||!data.model)throw new Error('No data returned');
        render(data.model,data.reportMd||'');
        if(status)status.textContent='';
      }).catch(function(err){
        if(status)status.textContent='Could not load excerpts: '+String(err&&(err.message||err));
        if(detail)detail.open=false;
      });
      return;
    }
    if(status)status.textContent='Loading prompt excerpts…';
    callTool('show_dashboard',{source:'all',includeEvidence:true}).then(function(result){
      var text=result&&result.content&&result.content[0]&&result.content[0].text;
      if(!text)throw new Error('Empty result');
      var newModel=JSON.parse(text);
      callTool('get_coaching_report',{format:'markdown'}).then(function(rpt){
        render(newModel,rpt&&rpt.content&&rpt.content[0]&&rpt.content[0].text||'');
        if(status)status.textContent='';
      }).catch(function(){render(newModel,'');if(status)status.textContent='';});
    }).catch(function(err){
      if(status)status.textContent='Failed: '+String(err&&(err.message||err));
      if(detail)detail.open=false;
    });
  });
}

function showView(id){
  _currentView=id;
  document.querySelectorAll('[data-view-target]').forEach(function(tab){
    tab.classList.toggle('active',tab.dataset.viewTarget===id);
  });
  document.querySelectorAll('[data-view]').forEach(function(view){
    view.classList.toggle('active',view.dataset.view===id);
  });
}
function setupNavigation(){
  document.querySelectorAll('[data-view-target]').forEach(function(tab){
    tab.addEventListener('click',function(){showView(tab.dataset.viewTarget);});
  });
}
function setupActivityFilters(){
  var filters=Array.from(document.querySelectorAll('[data-source-filter]'));
  if(!filters.length)return;
  filters[0].classList.add('active');
  filters.forEach(function(btn){
    btn.addEventListener('click',function(){
      var source=btn.dataset.sourceFilter;
      filters.forEach(function(f){f.classList.toggle('active',f===btn);});
      var visible=0;
      document.querySelectorAll('[data-session-source]').forEach(function(row){
        var show=source==='all'||row.dataset.sessionSource===source;
        row.hidden=!show;if(show)visible++;
      });
      var fe=document.querySelector('[data-filter-empty]');
      if(fe){
        fe.hidden=visible>0;
        fe.textContent=source==='all'?'No sessions available.':'No '+source+' sessions are present in this dashboard.';
      }
    });
  });
}
function setupCopyButtons(){
  var cs=document.getElementById('copy-status');
  function copyText(text){
    navigator.clipboard.writeText(text).then(function(){if(cs)cs.textContent='Copied';})
      .catch(function(){if(cs)cs.textContent='Copy unavailable';});
  }
  // Per-card copy buttons (skill scaffolds and drafting prompts) carry their
  // payload in data-copy-text. Delegated so it survives re-render.
  document.addEventListener('click',function(ev){
    var btn=ev.target&&ev.target.closest?ev.target.closest('[data-copy-text]'):null;
    if(!btn)return;
    var text=btn.getAttribute('data-copy-text');
    if(text==null)return;
    var label=btn.getAttribute('data-copy-label')||btn.textContent;
    copyText(text);
    btn.textContent='Copied';
    setTimeout(function(){btn.textContent=label;},1200);
  });
  var mdBtn=document.getElementById('copy-md-btn');
  if(mdBtn)mdBtn.addEventListener('click',function(){copyText(_reportMd);});
  var jsonBtn=document.getElementById('copy-json-btn');
  if(jsonBtn)jsonBtn.addEventListener('click',function(){
    if(_previewMode){
      // No MCP host available — serialize the in-memory model directly.
      try{copyText(JSON.stringify(_model,null,2));}
      catch(e){if(cs)cs.textContent='Serialization failed';}
      return;
    }
    callTool('get_coaching_report',{format:'json'}).then(function(result){
      var text=result&&result.content&&result.content[0]&&result.content[0].text;
      if(text)copyText(text);
    }).catch(function(){if(cs)cs.textContent='Failed to load JSON';});
  });
}
function setupAnalyzeAll(){
  var btn=document.getElementById('analyze-all-btn');
  var status=document.getElementById('analyze-status');
  if(!btn)return;
  if(_previewMode){
    // No MCP host in preview mode, so Analyze All can't run — hide it rather
    // than show a static hint. The preview banner already explains refresh.
    btn.hidden=true;
    return;
  }
  btn.addEventListener('click',function(){
    btn.disabled=true;
    if(status)status.textContent='Analyzing local sources…';
    callTool('show_dashboard',{source:'all'}).then(function(result){
      var text=result&&result.content&&result.content[0]&&result.content[0].text;
      if(!text)throw new Error('Empty result');
      if(status)status.textContent='Refreshing…';
      var newModel=JSON.parse(text);
      callTool('get_coaching_report',{format:'markdown'}).then(function(rpt){
        render(newModel,rpt&&rpt.content&&rpt.content[0]&&rpt.content[0].text||'');
      }).catch(function(){render(newModel,'');});
    }).catch(function(err){
      if(status)status.textContent='Analysis failed: '+String(err&&(err.message||err));
      btn.disabled=false;
    });
  });
}

// ===== Tool result from host =====
function handleToolResult(result){
  if(!result||!result.content||!result.content.length)return;
  var text=result.content.find(function(c){return c.type==='text';});
  if(!text||!text.text)return;
  try{
    var model=JSON.parse(text.text);
    callTool('get_coaching_report',{format:'markdown'}).then(function(rpt){
      render(model,rpt&&rpt.content&&rpt.content[0]&&rpt.content[0].text||'');
    }).catch(function(){render(model,'');});
  }catch(e){
    var ws=document.getElementById('workspace');
    if(ws)ws.innerHTML='<div class="connecting-state" style="color:var(--danger)">Failed to parse dashboard data: '+esc(String(e))+'</div>';
  }
}
})();
`;
}
