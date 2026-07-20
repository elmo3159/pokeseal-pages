#!/usr/bin/env node
// 推しカレ 公開Webページ生成（B-1：SEO流入でニッチ推しルームに人を運ぶ）
//
// 図鑑＋カレンダーを「画像なし・テキストと公式リンクだけ」の静的HTMLとして書き出す。
// ＝そのままGoogleにインデックスされる（Wikipedia/Fandom型の集客）。CDN（GitHub Pages）配信で激安。
//
// 使い方: node tools/gen_public_pages.mjs [出力ルート]   (既定: カレントディレクトリ)
// GitHub Actionsから実行し、生成物をリポジトリにコミット→ dreamnoark.com で配信する。

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const SUPABASE_URL = 'https://imcmtdyjbjbxuvecwslf.supabase.co';
// publishableキーは公開前提の匿名キー（RLSで保護）。埋め込んで問題ない。
const SUPABASE_KEY = 'sb_publishable_Ed24fTJ2Jx8nOfYav6crMw_T_bHRitR';
const SITE = 'https://dreamnoark.com';
const BASE = '/oshi-calendar/oshi'; // 公開ルームページの基点
const OUT_ROOT = process.argv[2] || '.';

const CATEGORY = {
  tv: 'TV出演',
  live: 'ライブ・イベント',
  goods: 'グッズ・発売日',
  streaming: 'ネット配信',
  other: 'その他',
};

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// URLとして安全なスラッグ（日本語はそのまま・パス危険文字だけ除去）
function slugify(name, used) {
  let s = String(name).trim().replace(/[\s/\\?#%&]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = 'room';
  let base = s;
  let i = 2;
  while (used.has(s)) s = `${base}-${i++}`;
  used.add(s);
  return s;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${w}) ${hh}:${mm}`;
}

function pageShell({ title, description, canonical, body, jsonld }) {
  const ld = jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="推しカレ">
<meta name="twitter:card" content="summary">
<meta name="robots" content="index,follow">
${ld}
<style>
:root{--bg:#0e0b1a;--card:#1a1530;--line:#2c2547;--pink:#ff6fa5;--txt:#f2eefc;--sub:#b8b0d0;--accent:#9c7bff}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;background:var(--bg);color:var(--txt);line-height:1.7}
a{color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:20px 18px 80px}
header.site{display:flex;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid var(--line);margin-bottom:22px}
header.site .logo{font-weight:900;font-size:15px}
header.site .logo span{color:var(--pink)}
h1{font-size:24px;font-weight:900;margin:6px 0 4px}
.lead{color:var(--sub);font-size:14px;margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:14px 0}
.card h2{font-size:16px;font-weight:800;margin:0 0 12px;display:flex;align-items:center;gap:8px}
.ev{padding:12px 0;border-bottom:1px solid var(--line)}
.ev:last-child{border-bottom:0}
.ev .cat{display:inline-block;font-size:11px;font-weight:800;color:var(--pink);background:rgba(255,111,165,.13);border:1px solid rgba(255,111,165,.35);border-radius:8px;padding:2px 8px;margin-bottom:6px}
.ev .t{font-weight:800;font-size:15px}
.ev .d{color:var(--sub);font-size:13px}
.ev .memo{color:var(--sub);font-size:13px;margin-top:2px}
.links a{display:inline-block;margin:4px 8px 4px 0;background:rgba(156,123,255,.14);border:1px solid rgba(156,123,255,.4);border-radius:20px;padding:6px 12px;font-size:13px;font-weight:700;text-decoration:none}
.meta{color:var(--sub);font-size:13px;margin:2px 0}
ul.plain{margin:6px 0;padding-left:18px}
ul.plain li{margin:4px 0}
.cta{display:block;text-align:center;background:linear-gradient(135deg,var(--pink),var(--accent));color:#fff;font-weight:900;text-decoration:none;padding:15px;border-radius:16px;margin:22px 0 8px}
.cta small{display:block;font-weight:600;opacity:.9;font-size:12px;margin-top:2px}
footer{color:var(--sub);font-size:12px;border-top:1px solid var(--line);margin-top:28px;padding-top:16px}
footer a{color:var(--sub)}
.roomlist a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0;text-decoration:none;color:var(--txt);font-weight:800}
.roomlist a .sub{display:block;color:var(--sub);font-size:12px;font-weight:500;margin-top:2px}
</style>
</head>
<body>
<div class="wrap">
<header class="site"><div class="logo">推し<span>カレ</span></div><div style="color:var(--sub);font-size:12px">スケジュール共有で繋がる推し活アプリ</div></header>
${body}
<footer>
このページはファンが共同で編集する「推しカレ」の公開データです。写真・画像は一切扱いません（テキストと公式リンクのみ）。<br>
<a href="${SITE}/oshi-calendar/terms.html">利用規約</a> ・ <a href="${SITE}/oshi-calendar/privacy.html">プライバシー</a> ・ <a href="${BASE}/">推し一覧</a>
</footer>
</div>
</body>
</html>`;
}

function roomPage(room, data) {
  const { events, links, works, history, terms, faq } = data;
  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.date).getTime() > now - 3 * 3600 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const canonical = `${SITE}${BASE}/${encodeURIComponent(room.slug)}/`;
  const title = `${room.name}の予定・スケジュールまとめ｜推しカレ`;
  const descBits = [
    `${room.name}のライブ・配信・イベント・グッズ発売日をファンが共同でまとめたスケジュール。`,
    room.agency ? `所属：${room.agency}。` : '',
    room.profile_bio ? room.profile_bio.slice(0, 70) : '',
  ].join('');
  const description = descBits.slice(0, 118);

  // Google Event リッチリザルト用の構造化データ（直近の予定）
  const jsonld = upcoming.slice(0, 12).map((e) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${room.name}｜${e.title}`,
    startDate: new Date(e.date).toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'VirtualLocation', url: e.official_url || canonical },
    description: e.memo || `${room.name}の${CATEGORY[e.category] || '予定'}`,
    performer: { '@type': 'PerformingGroup', name: room.name },
    organizer: { '@type': 'Organization', name: '推しカレ', url: SITE },
  }));

  let body = `<h1>${esc(room.name)}の予定・スケジュール</h1>`;
  body += `<p class="lead">${esc(room.name)}のライブ・配信・イベント・グッズ発売日を、ファンみんなで共同編集しているカレンダーです。画像は扱わず、テキストと公式リンクだけ。</p>`;

  // プロフィール
  if (room.profile_bio || room.agency || room.birthday || room.debut_date || room.official_tag) {
    body += `<div class="card"><h2>🌟 プロフィール</h2>`;
    if (room.profile_bio) body += `<p class="meta">${esc(room.profile_bio)}</p>`;
    if (room.agency) body += `<p class="meta">所属：${esc(room.agency)}</p>`;
    if (room.birthday) body += `<p class="meta">誕生日：${esc(room.birthday)}</p>`;
    if (room.debut_date) body += `<p class="meta">デビュー：${esc(room.debut_date)}</p>`;
    if (room.official_tag) body += `<p class="meta">公式タグ：${esc(room.official_tag)}</p>`;
    body += `</div>`;
  }

  // 予定
  body += `<div class="card"><h2>📅 これからの予定（${upcoming.length}件）</h2>`;
  if (upcoming.length === 0) {
    body += `<p class="meta">まだ予定が登録されていません。アプリで最初の情報提供者になろう！</p>`;
  } else {
    for (const e of upcoming.slice(0, 40)) {
      body += `<div class="ev"><span class="cat">${esc(CATEGORY[e.category] || 'その他')}</span>`;
      body += `<div class="t">${esc(e.title)}</div>`;
      body += `<div class="d">${fmtDate(e.date)}</div>`;
      if (e.memo) body += `<div class="memo">${esc(e.memo)}</div>`;
      if (e.official_url) body += `<div class="links"><a href="${esc(e.official_url)}" rel="nofollow noopener" target="_blank">公式ページ ▸</a></div>`;
      body += `</div>`;
    }
  }
  body += `</div>`;

  // 公式リンク
  if (links.length) {
    body += `<div class="card"><h2>🔗 公式リンク</h2><div class="links">`;
    for (const l of links) body += `<a href="${esc(l.url)}" rel="nofollow noopener" target="_blank">${esc(l.label)} ▸</a>`;
    body += `</div></div>`;
  }
  // 作品・ディスコグラフィ
  if (works.length) {
    body += `<div class="card"><h2>🎵 作品・ディスコグラフィ</h2><ul class="plain">`;
    for (const w of works) body += `<li>${esc(w.title)}${w.release_date ? `（${esc(w.release_date)}）` : ''}</li>`;
    body += `</ul></div>`;
  }
  // 年表
  if (history.length) {
    body += `<div class="card"><h2>📖 推しの年表</h2><ul class="plain">`;
    for (const h of history.sort((a, b) => (a.event_date > b.event_date ? 1 : -1)))
      body += `<li>${esc(h.event_date || '')}　${esc(h.title)}</li>`;
    body += `</ul></div>`;
  }
  // 用語集
  if (terms.length) {
    body += `<div class="card"><h2>📚 用語集</h2><ul class="plain">`;
    for (const t of terms) body += `<li><b>${esc(t.term)}</b>：${esc(t.description)}</li>`;
    body += `</ul></div>`;
  }
  // FAQ
  if (faq.length) {
    body += `<div class="card"><h2>❓ よくある情報</h2>`;
    for (const f of faq.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      body += `<p class="meta"><b>Q. ${esc(f.question)}</b><br>A. ${esc(f.answer)}</p>`;
    body += `</div>`;
  }

  body += `<a class="cta" href="${SITE}/oshi-calendar/">推しカレアプリでリマインドを受け取る<small>予定の直前に通知が届く／みんなで実況しながら応援</small></a>`;

  return pageShell({ title, description, canonical, body, jsonld });
}

function hubPage(rooms) {
  const canonical = `${SITE}${BASE}/`;
  let body = `<h1>推し一覧・スケジュールまとめ</h1>`;
  body += `<p class="lead">ファンが共同編集する、推しのライブ・配信・イベント予定まとめ。あなたの推しを探そう。</p><div class="roomlist">`;
  for (const r of rooms) {
    body += `<a href="${BASE}/${encodeURIComponent(r.slug)}/">${esc(r.name)}<span class="sub">${r.agency ? esc(r.agency) + '・' : ''}予定 ${r.eventCount}件</span></a>`;
  }
  body += `</div>`;
  body += `<a class="cta" href="${SITE}/oshi-calendar/">推しカレアプリをはじめる<small>推しの予定を絶対に逃さない・みんなで実況</small></a>`;
  return pageShell({
    title: '推し一覧・ライブ配信スケジュールまとめ｜推しカレ',
    description: 'アイドル・VTuber・声優・アニメの推しのライブ・配信・イベント予定を、ファンが共同でまとめています。あなたの推しを探そう。',
    canonical,
    body,
  });
}

async function main() {
  const rooms = await sb('rooms?select=*&order=member_count.desc');
  const events = await sb('events?select=*');
  const links = await sb('oshi_links?select=*');
  const works = await sb('oshi_works?select=*');
  const history = await sb('oshi_history?select=*');
  const terms = await sb('oshi_terms?select=*');
  const faq = await sb('oshi_faq?select=*');

  const by = (arr, id) => arr.filter((x) => x.room_id === id);
  const used = new Set();
  for (const r of rooms) r.slug = slugify(r.name, used);

  const outFiles = [];
  for (const r of rooms) {
    const rEvents = by(events, r.id);
    r.eventCount = rEvents.length;
    const html = roomPage(r, {
      events: rEvents,
      links: by(links, r.id),
      works: by(works, r.id),
      history: by(history, r.id),
      terms: by(terms, r.id),
      faq: by(faq, r.id),
    });
    outFiles.push([`oshi-calendar/oshi/${r.slug}/index.html`, html]);
  }
  outFiles.push(['oshi-calendar/oshi/index.html', hubPage(rooms)]);

  // sitemap
  const urls = [`${SITE}${BASE}/`, ...rooms.map((r) => `${SITE}${BASE}/${encodeURIComponent(r.slug)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc><changefreq>daily</changefreq></url>`).join('\n')}
</urlset>`;
  outFiles.push(['oshi-calendar/oshi/sitemap.xml', sitemap]);
  outFiles.push([
    'robots.txt',
    `User-agent: *\nAllow: /\nSitemap: ${SITE}${BASE}/sitemap.xml\n`,
  ]);

  for (const [rel, content] of outFiles) {
    const full = join(OUT_ROOT, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
    console.log('wrote', rel, `(${content.length}b)`);
  }
  console.log(`\nDone. ${rooms.length} rooms, ${outFiles.length} files.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
