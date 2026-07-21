#!/usr/bin/env node
// 推しカレ 公開Webページ生成（B-1：SEO流入でニッチ推しルームに人を運ぶ）
//
// 図鑑＋カレンダーを「画像なし・テキストと公式リンクだけ」の静的HTMLとして書き出す。
// ＝そのままGoogleにインデックスされる（Wikipedia/Fandom型の集客）。CDN（GitHub Pages）配信で激安。
//
// デザイン方針（2026-07 全面リニューアル）:
// - 明るい暖色（クリーム地）× 各ルームの「推し色」テーマ。アプリと同じ M PLUS Rounded 1c
// - 月間カレンダーグリッド（JS・月送り・今日ハイライト・カテゴリ色）＋SEO用のサーバー描画リスト
// - スクロールリビール（IntersectionObserver）／浮遊ブロブ／ホバーリフト／ライブカウントダウン
// - アニメは transform / opacity のみ（GPU）。prefers-reduced-motion 対応
//
// 使い方: node tools/gen_public_pages.mjs [出力ルート]   (既定: カレントディレクトリ)
// GitHub Actionsから実行し、生成物をリポジトリにコミット→ dreamnoark.com で配信する。

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const SUPABASE_URL = 'https://imcmtdyjbjbxuvecwslf.supabase.co';
// publishableキーは公開前提の匿名キー（RLSで保護）。埋め込んで問題ない。
const SUPABASE_KEY = 'sb_publishable_Ed24fTJ2Jx8nOfYav6crMw_T_bHRitR';
const SITE = 'https://dreamnoark.com';
const BASE = '/oshi-calendar/oshi';
const OUT_ROOT = process.argv[2] || '.';

const CATEGORY = {
  tv: { label: 'TV出演', color: '#2E8BE0', emoji: '📺' },
  live: { label: 'ライブ・イベント', color: '#E8484C', emoji: '🎤' },
  goods: { label: 'グッズ・発売日', color: '#E8890C', emoji: '🎁' },
  streaming: { label: 'ネット配信', color: '#9B51C9', emoji: '📡' },
  other: { label: 'その他', color: '#3BA55D', emoji: '📌' },
};
const cat = (k) => CATEGORY[k] || CATEGORY.other;

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

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]}) ${hh}:${mm}`;
}

// 推し色（DBのhex）。無ければブランドピンク
const roomColor = (r) => {
  const hex = String(r.color || '').replace(/[^0-9a-fA-F]/g, '');
  return hex.length === 6 ? `#${hex}` : '#FF5C9E';
};

// ---------------------------------------------------------------- CSS / JS

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800;900&display=swap" rel="stylesheet">`;

const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💖</text></svg>">`;

const CSS = `
:root{
  --oshi:#FF5C9E;
  --bg:#FFF7F2;--bg2:#FFEFF4;
  --ink:#33253F;--sub:#7A6B8A;--faint:#A79BB5;
  --card:#FFFFFF;--line:#F0E4EA;
  --pink:#FF5C9E;--purple:#8B5CF6;--gold:#F5A623;
  --shadow:0 2px 4px rgba(80,40,90,.05),0 12px 32px rgba(80,40,90,.09);
  --shadow-lg:0 4px 8px rgba(80,40,90,.06),0 24px 56px rgba(80,40,90,.14);
  --r:22px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  font-family:'M PLUS Rounded 1c',-apple-system,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;
  background:var(--bg);color:var(--ink);line-height:1.85;font-size:15px;
  overflow-x:hidden;-webkit-font-smoothing:antialiased;
}
a{color:var(--purple);text-decoration:none}

/* ---- 背景の浮遊ブロブ（transformのみ＝GPU） ---- */
.blobs{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;
  background:linear-gradient(180deg,var(--bg) 0%,var(--bg2) 60%,var(--bg) 100%)}
/* ブラーは使わずRadialGradientの重なりで軽く表現（フレーム落ち防止） */
.blob{position:absolute;border-radius:50%;opacity:.6;will-change:transform}
.blob.b1{width:52vmax;height:52vmax;top:-22vmax;left:-14vmax;
  background:radial-gradient(circle,color-mix(in srgb,var(--oshi) 26%,white) 0%,transparent 70%);
  animation:drift1 26s ease-in-out infinite alternate}
.blob.b2{width:44vmax;height:44vmax;bottom:-18vmax;right:-12vmax;
  background:radial-gradient(circle,color-mix(in srgb,var(--purple) 22%,white) 0%,transparent 70%);
  animation:drift2 32s ease-in-out infinite alternate}
.blob.b3{width:30vmax;height:30vmax;top:38%;right:-8vmax;
  background:radial-gradient(circle,color-mix(in srgb,var(--gold) 16%,white) 0%,transparent 70%);
  animation:drift3 38s ease-in-out infinite alternate}
@keyframes drift1{to{transform:translate(9vmax,7vmax) scale(1.12)}}
@keyframes drift2{to{transform:translate(-8vmax,-6vmax) scale(1.08)}}
@keyframes drift3{to{transform:translate(-5vmax,8vmax)}}

.wrap{max-width:860px;margin:0 auto;padding:0 20px 90px}

/* ---- ヘッダー（すりガラス・スティッキー） ---- */
.topbar{position:sticky;top:0;z-index:50;
  background:color-mix(in srgb,var(--bg) 72%,transparent);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.topbar-in{max-width:860px;margin:0 auto;padding:13px 20px;display:flex;align-items:center;gap:12px}
.logo{font-weight:900;font-size:17px;letter-spacing:.02em;color:var(--ink)}
.logo b{background:linear-gradient(120deg,var(--pink),var(--purple));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.logo-sub{font-size:10.5px;color:var(--faint);font-weight:700}
.top-cta{margin-left:auto;font-size:12px;font-weight:800;color:#fff;white-space:nowrap;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 45%,var(--purple)));
  padding:8px 16px;border-radius:99px;box-shadow:0 4px 14px color-mix(in srgb,var(--oshi) 40%,transparent);
  transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s}
.top-cta:hover{transform:translateY(-2px) scale(1.04);
  box-shadow:0 8px 22px color-mix(in srgb,var(--oshi) 55%,transparent)}

/* ---- ヒーロー ---- */
.hero{padding:58px 0 26px;text-align:center}
.hero .crumb{font-size:11.5px;color:var(--faint);font-weight:700;margin-bottom:14px}
.hero .crumb a{color:var(--faint)}
.hero h1{font-size:clamp(30px,6.4vw,46px);font-weight:900;line-height:1.3;letter-spacing:.01em;
  background:linear-gradient(120deg,var(--oshi) 10%,color-mix(in srgb,var(--oshi) 40%,var(--purple)) 55%,var(--purple));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  background-size:200% 100%;animation:sheen 7s ease-in-out infinite}
@keyframes sheen{0%,100%{background-position:0% 0}50%{background-position:100% 0}}
.hero .sub{font-size:clamp(15px,2.6vw,18px);font-weight:800;color:var(--ink);margin-top:2px}
.hero .lead{color:var(--sub);font-size:13.5px;max-width:560px;margin:14px auto 0;font-weight:500}
.badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px}
.badge{font-size:11.5px;font-weight:800;padding:7px 14px;border-radius:99px;
  background:#fff;border:1.5px solid var(--line);color:var(--sub);box-shadow:0 2px 8px rgba(80,40,90,.05)}
.badge b{color:var(--oshi)}

/* ---- 次の予定カウントダウン ---- */
.nextup{margin:30px auto 0;max-width:640px;border-radius:26px;padding:2px;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 40%,var(--purple)),var(--oshi));
  background-size:200% 100%;animation:sheen 6s linear infinite;
  box-shadow:0 14px 38px color-mix(in srgb,var(--oshi) 26%,transparent)}
.nextup-in{background:linear-gradient(180deg,#fff, #FFF9F5);border-radius:24px;padding:20px 22px}
.nextup .tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:900;color:#fff;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 45%,var(--purple)));
  padding:4px 12px;border-radius:99px;letter-spacing:.06em;
  text-shadow:0 1px 2px rgba(0,0,0,.18)}
.nextup .dot{width:7px;height:7px;border-radius:50%;background:#fff;animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.25;transform:scale(.7)}}
.nextup h2{font-size:clamp(17px,3.4vw,21px);font-weight:900;margin:10px 0 2px;color:var(--ink);line-height:1.45}
.nextup .when{font-size:12.5px;color:var(--sub);font-weight:700}
.count{display:flex;gap:10px;justify-content:center;margin-top:16px}
.count .cell{min-width:64px;background:var(--ink);color:#fff;border-radius:16px;padding:10px 8px 8px;
  box-shadow:0 6px 18px rgba(51,37,63,.28)}
.count .num{font-size:24px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.1;display:block}
.count .unit{font-size:9.5px;font-weight:700;opacity:.75}
.count.live .cell{background:linear-gradient(135deg,var(--oshi),var(--purple))}
.nextup .join{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;
  padding:12px 16px;border-radius:16px;font-size:12.5px;font-weight:900;color:#fff;line-height:1.6;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 45%,var(--purple)));
  box-shadow:0 6px 18px color-mix(in srgb,var(--oshi) 35%,transparent);
  text-shadow:0 1px 2px rgba(0,0,0,.2);
  transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s}
.nextup .join:hover{transform:translateY(-2px) scale(1.02);
  box-shadow:0 10px 26px color-mix(in srgb,var(--oshi) 50%,transparent)}

/* ---- セクション ---- */
section{margin-top:44px}
.sec-head{display:flex;align-items:baseline;gap:10px;margin-bottom:16px}
.sec-head .em{font-size:20px}
.sec-head h2{font-size:20px;font-weight:900;letter-spacing:.01em}
.sec-head .bar{flex:1;height:2px;border-radius:2px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--oshi) 45%,transparent),transparent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:22px;box-shadow:var(--shadow);
  transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.card.hoverable:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg)}

/* ---- カレンダー ---- */
.cal-card{padding:18px 16px 20px}
.cal-head{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:12px}
.cal-head .ym{font-size:17px;font-weight:900;min-width:130px;text-align:center;font-variant-numeric:tabular-nums}
.cal-nav{width:38px;height:38px;border:none;border-radius:50%;cursor:pointer;font-size:16px;font-weight:900;
  color:var(--oshi);background:color-mix(in srgb,var(--oshi) 10%,white);
  transition:transform .2s cubic-bezier(.34,1.56,.64,1),background .2s}
.cal-nav:hover{transform:scale(1.12);background:color-mix(in srgb,var(--oshi) 18%,white)}
.cal-nav:active{transform:scale(.94)}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.dow{font-size:10.5px;font-weight:900;text-align:center;color:var(--faint);padding:4px 0}
.dow.sun{color:#E8484C}.dow.sat{color:#2E8BE0}
.day{position:relative;min-height:56px;border-radius:14px;padding:5px 4px 3px;text-align:center;
  background:transparent;transition:background .2s,transform .2s;cursor:default}
.day.has{cursor:pointer;background:color-mix(in srgb,var(--oshi) 5%,white)}
.day.has:hover{background:color-mix(in srgb,var(--oshi) 12%,white);transform:translateY(-2px)}
.day .n{font-size:12.5px;font-weight:800;color:var(--ink);width:24px;height:24px;line-height:24px;
  display:inline-block;border-radius:50%;font-variant-numeric:tabular-nums}
.day.out .n{color:#D8CCE0}
.day.today .n{background:linear-gradient(135deg,var(--oshi),var(--purple));color:#fff;
  box-shadow:0 3px 10px color-mix(in srgb,var(--oshi) 45%,transparent)}
.day.sel{outline:2.5px solid var(--oshi);outline-offset:-2.5px;background:color-mix(in srgb,var(--oshi) 10%,white)}
.day .dots{display:flex;gap:3px;justify-content:center;margin-top:3px;flex-wrap:wrap}
.day .dots i{width:6px;height:6px;border-radius:50%;display:block}
.day .more{font-size:8.5px;font-weight:900;color:var(--faint)}
.cal-detail{margin-top:14px;border-top:1.5px dashed var(--line);padding-top:14px;display:none}
.cal-detail.show{display:block;animation:fadeup .35s cubic-bezier(.22,1,.36,1)}
@keyframes fadeup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.cal-detail .d-date{font-size:12.5px;font-weight:900;color:var(--oshi);margin-bottom:8px}
.mini-ev{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:12px;background:var(--bg)}
.mini-ev+.mini-ev{margin-top:6px}
.mini-ev .chip{flex-shrink:0}
.mini-ev .t{font-size:13px;font-weight:800;line-height:1.5}
.mini-ev .tm{font-size:11px;color:var(--sub);font-weight:700}
.cal-legend{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:14px}
.cal-legend span{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;color:var(--sub)}
.cal-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}

/* ---- 予定タイムライン ---- */
.tl{position:relative;padding-left:26px}
.tl::before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:2.5px;border-radius:2px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--oshi) 45%,white),color-mix(in srgb,var(--purple) 35%,white))}
.ev{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;
  padding:15px 18px;margin-bottom:12px;box-shadow:var(--shadow);
  transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}
.ev:hover{transform:translateX(4px);box-shadow:var(--shadow-lg)}
.ev::before{content:'';position:absolute;left:-23.5px;top:22px;width:11px;height:11px;border-radius:50%;
  background:var(--ec,var(--oshi));border:2.5px solid #fff;box-shadow:0 0 0 2px var(--ec,var(--oshi))}
.ev .row1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:900;color:#fff;
  padding:3px 10px;border-radius:99px;background:var(--ec,var(--oshi));
  text-shadow:0 1px 2px rgba(0,0,0,.22);letter-spacing:.02em}
.ev .until{margin-left:auto;font-size:11px;font-weight:900;color:var(--oshi);
  background:color-mix(in srgb,var(--oshi) 9%,white);padding:3px 10px;border-radius:99px;white-space:nowrap}
.ev .t{font-size:15.5px;font-weight:900;margin-top:7px;line-height:1.55}
.ev .d{font-size:12.5px;color:var(--sub);font-weight:700;margin-top:1px}
.ev .memo{font-size:12.5px;color:var(--sub);margin-top:5px}
.ev .off{display:inline-flex;align-items:center;gap:5px;margin-top:9px;font-size:12px;font-weight:800;
  color:var(--purple);background:color-mix(in srgb,var(--purple) 8%,white);
  border:1.5px solid color-mix(in srgb,var(--purple) 25%,white);
  padding:6px 14px;border-radius:99px;transition:transform .2s,background .2s}
.ev .off:hover{transform:translateY(-2px);background:color-mix(in srgb,var(--purple) 14%,white)}

/* ---- プロフィール ---- */
.prof{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.prof .item{background:var(--bg);border-radius:16px;padding:12px 16px}
.prof .k{font-size:10.5px;font-weight:900;color:var(--faint);letter-spacing:.08em}
.prof .v{font-size:14px;font-weight:800;margin-top:1px}
.bio{font-size:13.5px;color:var(--sub);font-weight:500;line-height:2;margin-bottom:14px}

/* ---- 公式リンク ---- */
.links{display:flex;flex-wrap:wrap;gap:10px}
.lk{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:800;color:var(--ink);
  background:#fff;border:1.5px solid var(--line);padding:10px 18px;border-radius:99px;
  box-shadow:0 2px 8px rgba(80,40,90,.06);
  transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s,border-color .25s}
.lk:hover{transform:translateY(-3px) scale(1.03);border-color:color-mix(in srgb,var(--oshi) 45%,white);
  box-shadow:0 8px 20px color-mix(in srgb,var(--oshi) 22%,transparent)}
.lk .arw{color:var(--oshi);font-weight:900}

/* ---- 年表・リスト ---- */
ul.hist{list-style:none}
ul.hist li{display:flex;gap:14px;padding:9px 0;border-bottom:1.5px dashed var(--line);font-size:13.5px}
ul.hist li:last-child{border-bottom:none}
ul.hist .y{flex-shrink:0;font-weight:900;color:var(--oshi);font-variant-numeric:tabular-nums;min-width:92px}
ul.hist .tt{font-weight:700}
ul.works{list-style:none}
ul.works li{display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1.5px dashed var(--line);font-size:13.5px}
ul.works li:last-child{border-bottom:none}
ul.works .tt{font-weight:800}
ul.works .rd{margin-left:auto;font-size:11.5px;color:var(--faint);font-weight:700;white-space:nowrap}

/* ---- アコーディオン（用語集・FAQ） ---- */
details{border:1.5px solid var(--line);border-radius:16px;background:#fff;margin-bottom:10px;
  box-shadow:0 2px 8px rgba(80,40,90,.04);overflow:hidden}
details summary{cursor:pointer;list-style:none;padding:14px 18px;font-size:13.5px;font-weight:900;
  display:flex;align-items:center;gap:10px;transition:background .2s}
details summary::-webkit-details-marker{display:none}
details summary::before{content:'＋';color:var(--oshi);font-weight:900;font-size:15px;
  transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
details[open] summary::before{transform:rotate(45deg)}
details summary:hover{background:color-mix(in srgb,var(--oshi) 5%,white)}
details .body{padding:0 18px 15px 43px;font-size:13px;color:var(--sub);line-height:1.9}

/* ---- CTA ---- */
.cta{position:relative;display:block;text-align:center;margin:52px 0 8px;padding:24px 20px;
  border-radius:26px;color:#fff;overflow:hidden;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 40%,var(--purple)));
  box-shadow:0 16px 42px color-mix(in srgb,var(--oshi) 38%,transparent);
  transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}
.cta:hover{transform:translateY(-4px);box-shadow:0 24px 56px color-mix(in srgb,var(--oshi) 50%,transparent)}
.cta::after{content:'';position:absolute;top:0;left:-80%;width:55%;height:100%;
  background:linear-gradient(105deg,transparent,rgba(255,255,255,.45),transparent);
  transform:skewX(-20deg);animation:shine 4.2s ease-in-out infinite}
@keyframes shine{0%,60%{left:-80%}100%{left:140%}}
.cta .big{font-size:clamp(16px,3.4vw,20px);font-weight:900;letter-spacing:.02em;
  text-shadow:0 1px 3px rgba(0,0,0,.22)}
.cta small{display:block;font-size:12px;font-weight:700;opacity:.95;margin-top:3px;
  text-shadow:0 1px 2px rgba(0,0,0,.2)}
.cta .feat{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:14px 0 4px;position:relative;z-index:1}
.cta .feat span{font-size:11.5px;font-weight:800;background:rgba(255,255,255,.18);
  border:1px solid rgba(255,255,255,.35);padding:7px 13px;border-radius:99px;
  text-shadow:0 1px 2px rgba(0,0,0,.22)}
.cta .btn{display:inline-block;margin-top:14px;background:#fff;color:var(--oshi);
  font-size:14px;font-weight:900;padding:12px 30px;border-radius:99px;position:relative;z-index:1;
  box-shadow:0 6px 18px rgba(0,0,0,.18)}
.cta.sm{margin:26px 0 0;padding:18px 20px}
.cta.sm::after{display:none}
.cta.sm .big{font-size:clamp(14px,2.8vw,16.5px)}

/* ---- 追従アプリ誘導バー（スクロールで登場） ---- */
.float-cta{position:fixed;left:50%;bottom:14px;z-index:70;width:min(560px,calc(100% - 24px));
  transform:translate(-50%,140%);transition:transform .5s cubic-bezier(.22,1,.36,1);
  display:flex;align-items:center;gap:12px;padding:11px 12px 11px 18px;border-radius:99px;
  background:linear-gradient(120deg,var(--oshi),color-mix(in srgb,var(--oshi) 40%,var(--purple)));
  box-shadow:0 12px 34px color-mix(in srgb,var(--oshi) 45%,transparent)}
.float-cta.show{transform:translate(-50%,0)}
.float-cta .txt{flex:1;min-width:0;color:#fff;font-size:12px;font-weight:900;line-height:1.45;
  text-shadow:0 1px 2px rgba(0,0,0,.22);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.float-cta .txt small{display:block;font-size:9.5px;font-weight:700;opacity:.9}
.float-cta .go{flex-shrink:0;background:#fff;color:var(--oshi);font-size:12px;font-weight:900;
  padding:9px 18px;border-radius:99px;box-shadow:0 3px 10px rgba(0,0,0,.15)}
.float-cta .x{flex-shrink:0;width:26px;height:26px;border:none;border-radius:50%;cursor:pointer;
  color:#fff;background:rgba(255,255,255,.22);font-size:13px;font-weight:900;line-height:1}

/* ---- フッター ---- */
footer{margin-top:56px;padding-top:22px;border-top:1.5px solid var(--line);
  color:var(--faint);font-size:11.5px;line-height:2;text-align:center}
footer a{color:var(--sub);font-weight:700}

/* ---- ハブ（推し一覧） ---- */
.roomgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.roomcard{position:relative;display:block;background:#fff;border:1px solid var(--line);
  border-radius:20px;padding:20px 20px 18px;overflow:hidden;color:var(--ink);
  box-shadow:var(--shadow);transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.roomcard:hover{transform:translateY(-5px);box-shadow:var(--shadow-lg)}
.roomcard::before{content:'';position:absolute;top:0;left:0;right:0;height:5px;
  background:linear-gradient(90deg,var(--rc),color-mix(in srgb,var(--rc) 40%,var(--purple)))}
.roomcard .nm{font-size:17px;font-weight:900;margin-top:2px}
.roomcard .ag{font-size:11px;color:var(--faint);font-weight:700;min-height:1.4em}
.roomcard .stats{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.roomcard .st{font-size:10.5px;font-weight:900;padding:4px 10px;border-radius:99px;
  background:color-mix(in srgb,var(--rc) 9%,white);color:color-mix(in srgb,var(--rc) 75%,black)}
.roomcard .go{position:absolute;right:16px;bottom:14px;font-weight:900;color:var(--rc);
  transition:transform .25s}
.roomcard:hover .go{transform:translateX(4px)}

/* ---- スクロールリビール（JS有効時のみ隠す＝no-JSでも全文表示） ---- */
html.js .rv{opacity:0;transform:translateY(18px);transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1)}
html.js .rv.in{opacity:1;transform:none}

@media (max-width:560px){
  .wrap{padding:0 14px 70px}
  .count .cell{min-width:56px}
  .day{min-height:48px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  .rv{opacity:1;transform:none}
}
`;

// リビール＋カウントダウン＋「あと◯日」ハイドレーションの共通JS
const COMMON_JS = `
(function(){
  // スクロールリビール（IntersectionObserver・transform/opacityのみ）
  // 画面に入る160px手前で発火＝速いスクロールでも空白を見せない
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}});
  },{threshold:0,rootMargin:'0px 0px 160px 0px'});
  document.querySelectorAll('.rv').forEach(function(el,i){
    el.style.transitionDelay=Math.min(i%4*45,135)+'ms';io.observe(el);
  });

  // 「あと◯日」チップ（毎日再生成に頼らずクライアントで常に正確に）
  document.querySelectorAll('[data-until]').forEach(function(el){
    var t=new Date(el.getAttribute('data-until')).getTime();if(isNaN(t))return;
    var diff=t-Date.now();
    if(diff<-2*3600*1000){el.textContent='終了';el.style.opacity=.5;return}
    if(diff<=0){el.textContent='開催中！';return}
    var d=Math.floor(diff/86400000),h=Math.floor(diff/3600000)%24,m=Math.floor(diff/60000)%60;
    el.textContent=d>0?'あと'+d+'日':(h>0?'あと'+h+'時間':'あと'+m+'分');
  });

  // 追従アプリ誘導バー：少しスクロールしたら登場（✕でそのセッションは出さない）
  var fc=document.getElementById('float-cta');
  if(fc&&!sessionStorage.getItem('fcta-off')){
    var shown=false;
    addEventListener('scroll',function(){
      var on=scrollY>420;
      if(on!==shown){shown=on;fc.classList.toggle('show',on)}
    },{passive:true});
    var fx=fc.querySelector('.x');
    if(fx)fx.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();
      fc.classList.remove('show');sessionStorage.setItem('fcta-off','1')});
  }

  // 次の予定ライブカウントダウン
  var cd=document.getElementById('countdown');
  if(cd){
    var target=new Date(cd.getAttribute('data-date')).getTime();
    var cells={d:cd.querySelector('[data-u=d]'),h:cd.querySelector('[data-u=h]'),m:cd.querySelector('[data-u=m]'),s:cd.querySelector('[data-u=s]')};
    function tick(){
      var diff=target-Date.now();
      if(diff<=0){cd.classList.add('live');
        ['d','h','m','s'].forEach(function(k){if(cells[k])cells[k].textContent='0'});
        var tag=document.getElementById('nextup-tag');if(tag)tag.innerHTML='<span class="dot"></span>いま開催中！';
        return}
      if(cells.d)cells.d.textContent=Math.floor(diff/86400000);
      if(cells.h)cells.h.textContent=String(Math.floor(diff/3600000)%24).padStart(2,'0');
      if(cells.m)cells.m.textContent=String(Math.floor(diff/60000)%60).padStart(2,'0');
      if(cells.s)cells.s.textContent=String(Math.floor(diff/1000)%60).padStart(2,'0');
      setTimeout(tick,1000);
    }
    tick();
  }
})();
`;

// カレンダーグリッドを組み立てるJS（EVENTSはページに埋め込み）
const CAL_JS = `
(function(){
  var root=document.getElementById('cal');if(!root)return;
  var EVENTS=JSON.parse(document.getElementById('cal-data').textContent);
  var CAT=JSON.parse(document.getElementById('cal-cat').textContent);
  var byDay={};
  EVENTS.forEach(function(e){var d=new Date(e.d);
    var k=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    (byDay[k]=byDay[k]||[]).push(e)});
  var today=new Date();
  var first=EVENTS.length?new Date(EVENTS[0].d):today;
  // 今日以降の最初の予定がある月を初期表示（なければ今月）
  var up=EVENTS.filter(function(e){return new Date(e.d)>=new Date(today.getFullYear(),today.getMonth(),today.getDate())});
  var cur=up.length?new Date(up[0].d):(EVENTS.length?first:today);
  var y=cur.getFullYear(),mo=cur.getMonth(),sel=null;
  var grid=document.getElementById('cal-grid'),ym=document.getElementById('cal-ym'),
      detail=document.getElementById('cal-detail');
  function key(dt){return dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate()}
  function render(){
    ym.textContent=y+'年'+(mo+1)+'月';
    var dows=['日','月','火','水','木','金','土'];
    var html=dows.map(function(w,i){
      return '<div class="dow'+(i===0?' sun':i===6?' sat':'')+'">'+w+'</div>'}).join('');
    var f=new Date(y,mo,1),start=new Date(f);start.setDate(1-f.getDay());
    for(var i=0;i<42;i++){
      var dt=new Date(start);dt.setDate(start.getDate()+i);
      var k=key(dt),evs=byDay[k]||[],out=dt.getMonth()!==mo;
      var isToday=key(dt)===key(today);
      var cls='day'+(out?' out':'')+(evs.length?' has':'')+(isToday?' today':'')+(sel===k?' sel':'');
      var dots='';
      if(evs.length){
        dots='<div class="dots">'+evs.slice(0,3).map(function(e){
          return '<i style="background:'+(CAT[e.c]||CAT.other)+'"></i>'}).join('')+
          (evs.length>3?'<span class="more">+'+(evs.length-3)+'</span>':'')+'</div>';
      }
      html+='<div class="'+cls+'" data-k="'+k+'"><span class="n">'+dt.getDate()+'</span>'+dots+'</div>';
    }
    grid.innerHTML=html;
    grid.querySelectorAll('.day.has').forEach(function(el){
      el.addEventListener('click',function(){sel=el.getAttribute('data-k');render();showDetail()});
    });
  }
  function showDetail(){
    var evs=byDay[sel]||[];
    if(!evs.length){detail.classList.remove('show');return}
    var p=sel.split('-');
    var dt=new Date(+p[0],+p[1]-1,+p[2]);
    var dows=['日','月','火','水','木','金','土'];
    detail.innerHTML='<div class="d-date">'+(dt.getMonth()+1)+'月'+dt.getDate()+'日('+dows[dt.getDay()]+')の予定</div>'+
      evs.map(function(e){var d=new Date(e.d);
        var tm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
        return '<div class="mini-ev"><span class="chip" style="--ec:'+(CAT[e.c]||CAT.other)+';background:'+(CAT[e.c]||CAT.other)+'">'+e.cl+'</span>'+
          '<div><div class="t">'+e.t+'</div><div class="tm">'+tm+'〜</div></div></div>'}).join('');
    detail.classList.add('show');
  }
  document.getElementById('cal-prev').addEventListener('click',function(){mo--;if(mo<0){mo=11;y--}sel=null;detail.classList.remove('show');render()});
  document.getElementById('cal-next').addEventListener('click',function(){mo++;if(mo>11){mo=0;y++}sel=null;detail.classList.remove('show');render()});
  render();
  // 初期選択：表示月内の直近予定日
  var inMonth=up.filter(function(e){var d=new Date(e.d);return d.getFullYear()===y&&d.getMonth()===mo});
  if(inMonth.length){sel=key(new Date(inMonth[0].d));render();showDetail()}
})();
`;

function pageShell({ title, description, canonical, body, jsonld, oshi, extraJs = '' }) {
  const ld = jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replaceAll('</', '<\\/')}</script>` : '';
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
<meta name="theme-color" content="#FFF7F2">
<script>document.documentElement.classList.add('js')</script>
${FAVICON}
${FONT_LINKS}
${ld}
<style>${CSS}</style>
</head>
<body style="--oshi:${oshi || '#FF5C9E'}">
<div class="blobs"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>
<header class="topbar"><div class="topbar-in">
  <a class="logo" href="${BASE}/">推し<b>カレ</b></a>
  <span class="logo-sub">推し活スケジュール共有</span>
  <a class="top-cta" href="${SITE}/oshi-calendar/">📲 アプリで参加する</a>
</div></header>
<div class="wrap">
${body}
<footer>
このページはファンが共同で編集する「推しカレ」の公開データです。<br>写真・画像は一切扱いません（テキストと公式リンクのみ）。<br>
<a href="${SITE}/oshi-calendar/terms.html">利用規約</a> ・ <a href="${SITE}/oshi-calendar/privacy.html">プライバシー</a> ・ <a href="${BASE}/">推し一覧</a>
</footer>
</div>
<script>${COMMON_JS}${extraJs}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- ルームページ

function roomPage(room, data) {
  const { events, links, works, history, terms, faq } = data;
  const oshi = roomColor(room);
  const now = Date.now();
  const upcoming = events
    .filter((e) => new Date(e.date).getTime() > now - 3 * 3600 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0];
  const canonical = `${SITE}${BASE}/${encodeURIComponent(room.slug)}/`;
  const title = `${room.name}の予定・スケジュールまとめ｜推しカレ`;
  const description = [
    `${room.name}のライブ・配信・イベント・グッズ発売日をファンが共同でまとめたスケジュール。`,
    room.agency ? `所属：${room.agency}。` : '',
    room.profile_bio ? room.profile_bio.slice(0, 60) : '',
  ].join('').slice(0, 118);

  const jsonld = upcoming.slice(0, 12).map((e) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${room.name}｜${e.title}`,
    startDate: new Date(e.date).toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'VirtualLocation', url: e.official_url || canonical },
    description: e.memo || `${room.name}の${cat(e.category).label}`,
    performer: { '@type': 'PerformingGroup', name: room.name },
    organizer: { '@type': 'Organization', name: '推しカレ', url: SITE },
  }));

  // カレンダー用データ（全予定・過去も月送りで見られる）
  const calData = events
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e) => ({ d: new Date(e.date).toISOString(), t: e.title, c: e.category, cl: cat(e.category).label }));
  const calCat = Object.fromEntries(Object.entries(CATEGORY).map(([k, v]) => [k, v.color]));

  let body = '';

  // ヒーロー
  body += `<div class="hero">
    <div class="crumb rv"><a href="${BASE}/">推し一覧</a> › ${esc(room.name)}</div>
    <h1 class="rv">${esc(room.name)}</h1>
    <div class="sub rv">予定・スケジュールまとめ</div>
    <p class="lead rv">ライブ・配信・イベント・グッズ発売日を、ファンみんなで共同編集しているカレンダーです。画像は扱わず、テキストと公式リンクだけ。</p>
    <div class="badges rv">
      <span class="badge">📅 これからの予定 <b>${upcoming.length}件</b></span>
      ${room.agency ? `<span class="badge">🏢 ${esc(room.agency)}</span>` : ''}
      ${room.official_tag ? `<span class="badge">🏷️ ${esc(room.official_tag)}</span>` : ''}
    </div>
  </div>`;

  // 次の予定カウントダウン
  if (next) {
    const c = cat(next.category);
    body += `<div class="nextup rv"><div class="nextup-in">
      <span class="tag" id="nextup-tag"><span class="dot"></span>NEXT ${esc(c.emoji)} ${esc(c.label)}</span>
      <h2>${esc(next.title)}</h2>
      <div class="when">${fmtDate(next.date)}</div>
      <div class="count" id="countdown" data-date="${new Date(next.date).toISOString()}">
        <div class="cell"><span class="num" data-u="d">-</span><span class="unit">DAYS</span></div>
        <div class="cell"><span class="num" data-u="h">-</span><span class="unit">HOURS</span></div>
        <div class="cell"><span class="num" data-u="m">-</span><span class="unit">MIN</span></div>
        <div class="cell"><span class="num" data-u="s">-</span><span class="unit">SEC</span></div>
      </div>
      <a class="join" href="${SITE}/oshi-calendar/">🎤 出演中は、アプリのみんなとリアルタイム実況！${esc(room.name)}に愛を叫ぼう ▸</a>
    </div></div>`;
  }

  // カレンダー
  if (events.length) {
    body += `<section>
      <div class="sec-head rv"><span class="em">🗓️</span><h2>カレンダー</h2><span class="bar"></span></div>
      <div class="card cal-card rv">
        <div class="cal-head">
          <button class="cal-nav" id="cal-prev" aria-label="前の月">‹</button>
          <span class="ym" id="cal-ym"></span>
          <button class="cal-nav" id="cal-next" aria-label="次の月">›</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
        <div class="cal-detail" id="cal-detail"></div>
        <div class="cal-legend">${Object.values(CATEGORY).map((v) => `<span><i style="background:${v.color}"></i>${v.label}</span>`).join('')}</div>
      </div>
      <div id="cal" hidden></div>
      <script type="application/json" id="cal-data">${JSON.stringify(calData).replaceAll('</', '<\\/')}</script>
      <script type="application/json" id="cal-cat">${JSON.stringify(calCat)}</script>
    </section>`;
  }

  // 予定タイムライン（サーバー描画＝SEOの本体）
  body += `<section>
    <div class="sec-head rv"><span class="em">✨</span><h2>これからの予定</h2><span class="bar"></span></div>`;
  if (upcoming.length === 0) {
    body += `<div class="card rv" style="text-align:center;color:var(--sub);font-weight:700">まだ予定が登録されていません。<br>アプリで最初の情報提供者になろう！</div>`;
  } else {
    body += `<div class="tl">`;
    for (const e of upcoming.slice(0, 40)) {
      const c = cat(e.category);
      body += `<article class="ev rv" style="--ec:${c.color}">
        <div class="row1">
          <span class="chip">${c.emoji} ${esc(c.label)}</span>
          <span class="until" data-until="${new Date(e.date).toISOString()}"></span>
        </div>
        <h3 class="t">${esc(e.title)}</h3>
        <div class="d">${fmtDate(e.date)}</div>
        ${e.memo ? `<p class="memo">${esc(e.memo)}</p>` : ''}
        ${e.official_url ? `<a class="off" href="${esc(e.official_url)}" rel="nofollow noopener" target="_blank">🔗 公式ページを見る</a>` : ''}
      </article>`;
    }
    body += `</div>
    <a class="cta sm rv" href="${SITE}/oshi-calendar/">
      <span class="big">🔔 ${esc(room.name)}の予定、ぜんぶリマインド</span>
      <small>直前に通知が届くから、もう見逃さない。アプリで「行く・見る」を押すだけ</small>
    </a>`;
  }
  body += `</section>`;

  // プロフィール
  if (room.profile_bio || room.agency || room.birthday || room.debut_date || room.official_tag) {
    body += `<section>
      <div class="sec-head rv"><span class="em">🌟</span><h2>プロフィール</h2><span class="bar"></span></div>
      <div class="card hoverable rv">
        ${room.profile_bio ? `<p class="bio">${esc(room.profile_bio)}</p>` : ''}
        <div class="prof">
          ${room.agency ? `<div class="item"><div class="k">所属</div><div class="v">${esc(room.agency)}</div></div>` : ''}
          ${room.birthday ? `<div class="item"><div class="k">誕生日</div><div class="v">${esc(room.birthday)}</div></div>` : ''}
          ${room.debut_date ? `<div class="item"><div class="k">デビュー</div><div class="v">${esc(room.debut_date)}</div></div>` : ''}
          ${room.official_tag ? `<div class="item"><div class="k">公式タグ</div><div class="v">${esc(room.official_tag)}</div></div>` : ''}
        </div>
      </div>
    </section>`;
  }

  // 公式リンク
  if (links.length) {
    body += `<section>
      <div class="sec-head rv"><span class="em">🔗</span><h2>公式リンク</h2><span class="bar"></span></div>
      <div class="links rv">
        ${links.map((l) => `<a class="lk" href="${esc(l.url)}" rel="nofollow noopener" target="_blank">${esc(l.label)} <span class="arw">▸</span></a>`).join('')}
      </div>
    </section>`;
  }

  // 作品
  if (works.length) {
    body += `<section>
      <div class="sec-head rv"><span class="em">🎵</span><h2>作品・ディスコグラフィ</h2><span class="bar"></span></div>
      <div class="card hoverable rv"><ul class="works">
        ${works.map((w) => `<li><span class="tt">${esc(w.title)}</span>${w.release_date ? `<span class="rd">${esc(w.release_date)}</span>` : ''}</li>`).join('')}
      </ul></div>
    </section>`;
  }

  // 年表
  if (history.length) {
    const hist = [...history].sort((a, b) => ((a.event_date || '') > (b.event_date || '') ? 1 : -1));
    body += `<section>
      <div class="sec-head rv"><span class="em">📖</span><h2>推しの年表</h2><span class="bar"></span></div>
      <div class="card hoverable rv"><ul class="hist">
        ${hist.map((h) => `<li><span class="y">${esc(h.event_date || '')}</span><span class="tt">${esc(h.title)}</span></li>`).join('')}
      </ul></div>
    </section>`;
  }

  // 用語集
  if (terms.length) {
    body += `<section>
      <div class="sec-head rv"><span class="em">📚</span><h2>用語集</h2><span class="bar"></span></div>
      ${terms.map((t) => `<details class="rv"><summary>${esc(t.term)}${t.reading ? `<span style="font-size:10.5px;color:var(--faint)">（${esc(t.reading)}）</span>` : ''}</summary><div class="body">${esc(t.description)}</div></details>`).join('')}
    </section>`;
  }

  // FAQ
  if (faq.length) {
    const fs = [...faq].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    body += `<section>
      <div class="sec-head rv"><span class="em">❓</span><h2>よくある情報</h2><span class="bar"></span></div>
      ${fs.map((f) => `<details class="rv"><summary>${esc(f.question)}</summary><div class="body">${esc(f.answer)}</div></details>`).join('')}
    </section>`;
  }

  body += `<a class="cta rv" href="${SITE}/oshi-calendar/">
    <span class="big">💖 ${esc(room.name)}のファンが集うアプリ、できました</span>
    <small>このページはみんなの入り口。本編は、アプリの中に。</small>
    <span class="feat">
      <span>🔔 予定の直前にリマインド</span>
      <span>🎤 出演中はみんなで実況</span>
      <span>✍️ 情報をみんなで持ち寄る</span>
    </span>
    <span class="btn">無料でアプリをはじめる ▸</span>
  </a>
  <a class="float-cta" id="float-cta" href="${SITE}/oshi-calendar/">
    <span class="txt">${esc(room.name)}のファンが集うアプリ<small>リマインド通知＆みんなで実況。無料</small></span>
    <span class="go">はじめる</span>
    <button class="x" aria-label="閉じる">✕</button>
  </a>`;

  return pageShell({
    title, description, canonical, body, jsonld, oshi,
    extraJs: events.length ? CAL_JS : '',
  });
}

// ---------------------------------------------------------------- ハブ

function hubPage(rooms) {
  const canonical = `${SITE}${BASE}/`;
  let body = `<div class="hero">
    <h1 class="rv">推しのスケジュール、<br>ぜんぶここに。</h1>
    <p class="lead rv">アイドル・VTuber・声優・アニメ——ファンが共同編集する、推しのライブ・配信・イベント予定まとめ。あなたの推しを探そう。</p>
    <div class="badges rv"><span class="badge">🎤 登録推し <b>${rooms.length}</b></span><span class="badge">🗓️ 毎日自動更新</span><span class="badge">🖼️ 画像なし・テキストのみ</span></div>
  </div>
  <div class="roomgrid">`;
  for (const r of rooms) {
    body += `<a class="roomcard rv" href="${BASE}/${encodeURIComponent(r.slug)}/" style="--rc:${roomColor(r)}">
      <div class="nm">${esc(r.name)}</div>
      <div class="ag">${r.agency ? esc(r.agency) : ''}</div>
      <div class="stats">
        <span class="st">📅 予定 ${r.eventCount}件</span>
        ${r.member_count > 1 ? `<span class="st">🔥 ${Number(r.member_count).toLocaleString()}人</span>` : ''}
      </div>
      <span class="go">▸</span>
    </a>`;
  }
  body += `</div>
  <a class="cta rv" href="${SITE}/oshi-calendar/">
    <span class="big">💖 あなたの推しのファンが集うアプリ、できました</span>
    <small>このページはみんなの入り口。本編は、アプリの中に。</small>
    <span class="feat">
      <span>🔔 予定の直前にリマインド</span>
      <span>🎤 出演中はみんなで実況</span>
      <span>✍️ 情報をみんなで持ち寄る</span>
    </span>
    <span class="btn">無料でアプリをはじめる ▸</span>
  </a>
  <a class="float-cta" id="float-cta" href="${SITE}/oshi-calendar/">
    <span class="txt">推しのファンが集うアプリ・推しカレ<small>リマインド通知＆みんなで実況。無料</small></span>
    <span class="go">はじめる</span>
    <button class="x" aria-label="閉じる">✕</button>
  </a>`;
  return pageShell({
    title: '推し一覧・ライブ配信スケジュールまとめ｜推しカレ',
    description: 'アイドル・VTuber・声優・アニメの推しのライブ・配信・イベント予定を、ファンが共同でまとめています。あなたの推しを探そう。',
    canonical, body, oshi: '#FF5C9E',
  });
}

// ---------------------------------------------------------------- main

async function main() {
  const rooms = await sb('rooms?select=*&order=member_count.desc');
  const events = await sb('events?select=*');
  const links = await sb('oshi_links?select=*&order=sort_order');
  const works = await sb('oshi_works?select=*');
  const history = await sb('oshi_history?select=*');
  const terms = await sb('oshi_terms?select=*');
  const faq = await sb('oshi_faq?select=*');

  const by = (arr, id) => arr.filter((x) => x.room_id === id);
  const used = new Set();
  for (const r of rooms) r.slug = slugify(r.name, used);

  const outFiles = [];
  const now = Date.now();
  for (const r of rooms) {
    const rEvents = by(events, r.id);
    r.eventCount = rEvents.filter((e) => new Date(e.date).getTime() > now - 3 * 3600 * 1000).length;
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

  const urls = [`${SITE}${BASE}/`, ...rooms.map((r) => `${SITE}${BASE}/${encodeURIComponent(r.slug)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc><changefreq>daily</changefreq></url>`).join('\n')}
</urlset>`;
  outFiles.push(['oshi-calendar/oshi/sitemap.xml', sitemap]);
  outFiles.push(['robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}${BASE}/sitemap.xml\n`]);

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
