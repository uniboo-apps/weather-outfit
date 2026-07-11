"use strict";

// ===== 状態 =====
const OFFSETS = [-3, 0, 3];   // 許可する体質補正値（寒がり / 標準 / 暑がり）
// 服装提案を出す時間帯。昼(index=MAIN_SLOT_INDEX)をメイン提案の基準にする。
const TIME_SLOTS = [
  {label:"朝", hours:[6,7,8,9]},
  {label:"昼", hours:[12,13,14]},
  {label:"夜", hours:[18,19,20,21]}
];
const MAIN_SLOT_INDEX = 1;    // メイン提案の基準スロット（昼）
const CITY_RESULT_COUNT = 5;  // 都市検索で取得する候補数（曖昧地名の取り違え対策）
let bodyOffset = 0;           // 体質補正(℃)
let lastData = null;          // 直近の取得データ（体質切替時に再描画）
let reqSeq = 0;               // 取得世代トークン（連打・レース対策：最新の取得だけ描画）
let cityResults = [];         // 直近の都市検索候補（候補ボタンのクリックで参照）

// HTML エスケープ。innerHTML へ差し込む文字列は必ずこれを通す（将来 API 由来の値を足しても XSS にしない）。
function esc(s){
  return String(s).replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]
  ));
}

// ===== 服装ロジック（体感温度 + 体質補正で判定）=====
// adj = 体感温度 + bodyOffset。寒がりは offset を引く=より寒く感じる前提で暖かめ提案。
function outfit(apparent){
  const t = apparent + bodyOffset;
  if (t < 5)  return {emoji:"🧥🧣", wear:"厚手コート＋防寒小物", short:"厚手コート", level:"凍える寒さ", detail:"ダウン・マフラー・手袋まで。しっかり防寒を。"};
  if (t < 12) return {emoji:"🧥",   wear:"冬コート",            short:"冬コート",   level:"寒い",       detail:"コートやダウンが必要。中はニットで。"};
  if (t < 16) return {emoji:"🧥👕", wear:"ジャケット",          short:"ジャケット", level:"肌寒い",     detail:"ジャケットや厚手の長袖が安心。"};
  if (t < 20) return {emoji:"👕🧥", wear:"長袖＋薄い羽織り",    short:"長袖＋羽織り",level:"少しひんやり",detail:"長袖シャツに、カーディガンなど薄手の羽織りを。"};
  if (t < 24) return {emoji:"👕",   wear:"長袖シャツ1枚",       short:"長袖1枚",    level:"ちょうどいい",detail:"長袖シャツ1枚で快適。羽織りは不要。"};
  if (t < 28) return {emoji:"👕☀️", wear:"半袖シャツ",          short:"半袖",       level:"あたたかい", detail:"半袖でOK。冷房対策に薄手の羽織りがあると安心。"};
  return            {emoji:"🥵🥤", wear:"半袖＋暑さ対策",      short:"半袖+対策",  level:"真夏の暑さ", detail:"通気性のいい半袖で。帽子・水分補給など熱中症対策を。"};
}

// ===== 取得 =====
// skipGeo=true のとき逆ジオコーディングをしない（都市検索は地名が既に確定しているため）。
async function loadByCoords(lat, lon, skipGeo){
  const seq = ++reqSeq;
  setStatus("天気を取得中…");
  if(!skipGeo) reverseGeocode(lat, lon, seq);
  const url = "https://api.open-meteo.com/v1/forecast"
    + "?latitude="+lat+"&longitude="+lon
    + "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,uv_index"
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max"
    + "&timezone=auto&forecast_days=2";
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data = await r.json();
    if(seq !== reqSeq) return;   // 後から始まった取得が既にあるなら破棄
    lastData = data;
    saveCache(data, document.getElementById("place").textContent);
    render();
    hideStatus();
  }catch(e){
    if(seq !== reqSeq) return;
    if(!renderCachedFallback()){
      setStatus("天気の取得に失敗しました（"+e.message+"）。時間をおいて再試行してください。", true);
    }
  }
}

async function reverseGeocode(lat, lon, seq){
  const fallback = "緯度"+lat.toFixed(2)+" / 経度"+lon.toFixed(2);
  try{
    const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude="+lat+"&longitude="+lon+"&localityLanguage=ja");
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    if(seq !== reqSeq) return;   // 別の取得が進行中なら地名を上書きしない
    const name = [j.principalSubdivision, j.city || j.locality].filter(Boolean).join(" ");
    const place = name || fallback;
    document.getElementById("place").textContent = place;
    updateCachePlace(place);     // 天気が先にキャッシュ保存されていても地名を確定値へ差し替え
  }catch(_){
    if(seq !== reqSeq) return;
    document.getElementById("place").textContent = fallback;
    updateCachePlace(fallback);
  }
}

async function loadByCity(q){
  const seq = ++reqSeq;
  setStatus("「"+q+"」を検索中…");
  clearCandidates();
  try{
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(q)+"&count="+CITY_RESULT_COUNT+"&language=ja");
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    if(seq !== reqSeq) return;
    if(!j.results || !j.results.length){ setStatus("「"+q+"」が見つかりませんでした。", true); return; }
    if(j.results.length === 1){ selectCity(j.results[0]); return; }
    // 候補が複数（例: 「府中」＝東京/広島）ならユーザーに選ばせる
    renderCandidates(j.results);
    setStatus("候補が複数あります。地域を選んでください。");
  }catch(e){
    if(seq !== reqSeq) return;
    setStatus("検索に失敗しました（"+e.message+"）", true);
  }
}

// 候補地を1つ確定して天気を取得（地名は確定済みなので逆ジオ不要）。
function selectCity(g){
  clearCandidates();
  document.getElementById("place").textContent = [g.admin1, g.name].filter(Boolean).join(" ");
  loadByCoords(g.latitude, g.longitude, true);
}

// 都市検索候補をボタンとして描画。地域・国名を併記して取り違えを防ぐ。
function renderCandidates(results){
  cityResults = results;
  const box = document.getElementById("candidates");
  box.innerHTML = results.map((g,i)=>
    '<button class="candidate" data-idx="'+i+'">'
    + esc([g.name, g.admin1, g.country].filter(Boolean).join(" / "))
    + '</button>'
  ).join("");
  box.style.display = "flex";
}

function clearCandidates(){
  const box = document.getElementById("candidates");
  if(!box) return;
  box.innerHTML = "";
  box.style.display = "none";
  cityResults = [];
}

// ===== オフライン用キャッシュ =====
function saveCache(data, place){
  try{
    localStorage.setItem("lastForecast", JSON.stringify({data:data, place:place, ts:Date.now()}));
  }catch(_){/* 容量超過等は無視 */}
}
// 逆ジオが後から確定したとき、直近キャッシュの地名だけ差し替える（取得時刻・データは保持）。
function updateCachePlace(place){
  try{
    const raw = localStorage.getItem("lastForecast");
    if(!raw) return;
    const c = JSON.parse(raw);
    if(!c) return;
    c.place = place;
    localStorage.setItem("lastForecast", JSON.stringify(c));
  }catch(_){}
}
// 取得に失敗したとき、前回データがあれば「◯時点の情報」として表示。表示できたら true。
const CACHE_MAX_AGE_MS = 24*60*60*1000;   // 24時間より古いキャッシュは「今日/明日」がずれるので使わない
function renderCachedFallback(){
  try{
    const raw = localStorage.getItem("lastForecast");
    if(!raw) return false;
    const c = JSON.parse(raw);
    if(!c || !c.data) return false;
    if(!c.ts || (Date.now() - c.ts) > CACHE_MAX_AGE_MS) return false;  // 鮮度切れは破棄（古い予報を「今日」と誤表示しない）
    lastData = c.data;
    if(c.place) document.getElementById("place").textContent = c.place;
    render();
    const dt = new Date(c.ts);
    const hm = dt.getHours()+":"+String(dt.getMinutes()).padStart(2,"0");
    setStatus("⚠ 最新の取得に失敗。"+(dt.toLocaleDateString("ja-JP"))+" "+hm+" 時点の情報を表示中です。", true);
    return true;
  }catch(_){ return false; }
}

// ===== 描画 =====
function dayName(offset){ return offset===0 ? "今日" : "明日"; }

// 予報地点のタイムゾーンでの現在時刻（端末時刻ではなく API の utc_offset_seconds 基準）。
// getUTCHours() で読むと予報地点の「時」が得られる。
function localNow(){
  const off = (lastData && lastData.utc_offset_seconds!=null)
    ? lastData.utc_offset_seconds
    : (-new Date().getTimezoneOffset()*60);
  return new Date(Date.now() + off*1000);
}

function avgAt(times, vals, dateStr, hours){
  if(!vals) return null;
  let s=0,n=0;
  for(let i=0;i<times.length;i++){
    if(times[i].slice(0,10)!==dateStr) continue;
    const h = parseInt(times[i].slice(11,13),10);
    if(hours.includes(h) && vals[i]!=null){ s+=vals[i]; n++; }  // null は平均に混ぜない（0扱いで低温誤判定を防ぐ）
  }
  return n? s/n : null;
}

// 天気アイコン（降水確率と気温からざっくり）
function hourEmoji(pp, temp){
  if(pp!=null && pp>=60) return "🌧️";
  if(pp!=null && pp>=30) return "🌦️";
  if(temp!=null && temp>=28) return "☀️";
  return "🌤️";
}

// 指定日の時間別配列（今日は現在時刻以降のみ）
function hourlyFor(d, dateStr, isToday){
  const nowH = localNow().getUTCHours();
  const out = [];
  for(let i=0;i<d.hourly.time.length;i++){
    const t = d.hourly.time[i];
    if(t.slice(0,10)!==dateStr) continue;
    const h = parseInt(t.slice(11,13),10);
    if(isToday && h < nowH) continue;
    out.push({
      h:h,
      temp:d.hourly.temperature_2m[i],
      pp:d.hourly.precipitation_probability ? d.hourly.precipitation_probability[i] : null,
      mm:d.hourly.precipitation ? d.hourly.precipitation[i] : null,
      now: isToday && h===nowH
    });
  }
  return out;
}

function render(){
  if(!lastData || !lastData.daily || !lastData.hourly){ return; }
  try{
    renderInner();
  }catch(e){
    setStatus("表示データの処理に失敗しました（"+e.message+"）。時間をおいて再試行してください。", true);
  }
}

function renderInner(){
  const d = lastData;
  const dates = d.daily.time; // 2日分
  let html = "";
  for(let k=0;k<dates.length && k<2;k++){
    const date = dates[k];
    const max = d.daily.temperature_2m_max[k];
    const min = d.daily.temperature_2m_min[k];
    if(max==null || min==null) continue;   // 稀に null が返る日はスキップ（描画全体を守る）
    const popMax = d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[k] : null;
    const rainSum = d.daily.precipitation_sum ? d.daily.precipitation_sum[k] : null;
    const uvMax = d.daily.uv_index_max ? d.daily.uv_index_max[k] : null;
    const gap = max - min;

    // 各時間帯（TIME_SLOTS: 朝/昼/夜）の体感温度
    const slots = TIME_SLOTS.map(s=>{
      const ap = avgAt(d.hourly.time, d.hourly.apparent_temperature, date, s.hours);
      return {label:s.label, ap:ap, o: ap!=null? outfit(ap) : null};
    });

    // メイン提案 = 日中(昼)基準、無ければ最高気温体感の近似
    const mainAp = slots[MAIN_SLOT_INDEX].ap!=null ? slots[MAIN_SLOT_INDEX].ap : (max+min)/2;
    const main = outfit(mainAp);

    // タグ
    let tags = "";
    const rainMm = (rainSum!=null && rainSum>=0.1) ? ' / '+rainSum.toFixed(1)+'mm' : '';
    if(popMax!=null && popMax>=50) tags += '<span class="tag rain">☔ 傘がいる（降水確率'+Math.round(popMax)+'%'+rainMm+'）</span>';
    else if(popMax!=null && popMax>=30) tags += '<span class="tag rain">🌂 折りたたみ傘が安心（'+Math.round(popMax)+'%'+rainMm+'）</span>';
    else if(rainSum!=null && rainSum>=0.5) tags += '<span class="tag rain">🌂 にわか雨に注意（'+rainSum.toFixed(1)+'mm）</span>';
    else tags += '<span class="tag dry">☀️ 降水なし（最大'+(popMax!=null?Math.round(popMax):0)+'%）傘は不要</span>';
    if(uvMax!=null && uvMax>=6) tags += '<span class="tag uv">🧢 UV強い（指数'+uvMax.toFixed(0)+'）日焼け対策を</span>';
    else if(uvMax!=null && uvMax>=3) tags += '<span class="tag uv">😎 日差しあり（UV'+uvMax.toFixed(0)+'）</span>';
    if(gap>=8) tags += '<span class="tag gap">🌗 昼夜の差'+gap.toFixed(0)+'℃ 羽織り持参を</span>';

    html += '<div class="day">'
      + '<div class="day-head"><span class="day-title">'+esc(dayName(k))+'</span>'
      + '<span class="day-temp">最高<b>'+max.toFixed(0)+'℃</b> / 最低<i>'+min.toFixed(0)+'℃</i></span></div>'
      + '<div class="main-advice"><div class="main-emoji">'+main.emoji+'</div>'
      + '<div class="main-text">'+esc(main.wear)+'<small>'+esc(main.detail)+'</small></div></div>'
      + '<div class="slots">'
      + slots.map(s=> '<div class="slot"><div class="label">'+esc(s.label)+'</div>'
          + '<div class="emoji">'+(s.o?s.o.emoji:'–')+'</div>'
          + '<div class="t">'+(s.ap!=null?s.ap.toFixed(0)+'℃':'–')+'</div>'
          + '<div class="wear">'+(s.o?esc(s.o.short):'')+'</div></div>').join('')
      + '</div>';

    // 時間別の気温（横スクロール）
    const hours = hourlyFor(d, date, k===0);
    if(hours.length){
      html += '<div class="hourly-wrap"><div class="hourly-label">⏱ 時間別の気温・降水</div><div class="hourly">'
        + hours.map(h=> '<div class="hr'+(h.now?' now':'')+'">'
            + '<div class="h">'+(h.now?'今':h.h+'時')+'</div>'
            + '<div class="e">'+hourEmoji(h.pp,h.temp)+'</div>'
            + '<div class="tp">'+(h.temp!=null?h.temp.toFixed(0)+'°':'–')+'</div>'
            + '<div class="pp'+(h.pp!=null&&h.pp>=10?'':' dry')+'">'+(h.pp!=null?(h.pp>=10?'☔':'💧')+Math.round(h.pp)+'%':'')+'</div>'
            + '<div class="mm">'+(h.mm!=null && h.mm>=0.1?h.mm.toFixed(1)+'mm':'')+'</div>'
            + '</div>').join('')
        + '</div></div>';
    }

    if(tags) html += '<div class="tags">'+tags+'</div>';

    html += '</div>';
  }
  document.getElementById("content").innerHTML = html;
}

// ===== UI制御 =====
function setStatus(msg, isErr){
  const s=document.getElementById("status");
  s.style.display="block"; s.textContent=msg; s.className="status"+(isErr?" err":"");
}
function hideStatus(){ document.getElementById("status").style.display="none"; }

document.getElementById("bodyToggle").addEventListener("click", e=>{
  const b=e.target.closest("button"); if(!b) return;
  [...document.querySelectorAll("#bodyToggle button")].forEach(x=>x.classList.remove("on"));
  b.classList.add("on");
  const off = parseInt(b.dataset.off,10);
  bodyOffset = OFFSETS.includes(off) ? off : 0;
  try{ localStorage.setItem("bodyOffset", bodyOffset); }catch(_){}
  render();
});

document.getElementById("manualBtn").addEventListener("click", ()=>{
  const sb=document.getElementById("searchBox");
  sb.style.display = sb.style.display==="flex" ? "none" : "flex";
});
document.getElementById("cityBtn").addEventListener("click", ()=>{
  const q=document.getElementById("cityInput").value.trim();
  if(q) loadByCity(q);
});
document.getElementById("cityInput").addEventListener("keydown", e=>{
  if(e.key==="Enter"){ const q=e.target.value.trim(); if(q) loadByCity(q); }
});
document.getElementById("candidates").addEventListener("click", e=>{
  const b=e.target.closest("button[data-idx]"); if(!b) return;
  const g=cityResults[parseInt(b.dataset.idx,10)];
  if(g) selectCity(g);
});

// ===== 起動 =====
(function init(){
  const saved = parseInt(localStorage.getItem("bodyOffset"),10);
  if(OFFSETS.includes(saved)){
    bodyOffset = saved;
    [...document.querySelectorAll("#bodyToggle button")].forEach(x=>{
      x.classList.toggle("on", parseInt(x.dataset.off,10)===bodyOffset);
    });
  }
  if(!navigator.geolocation){
    setStatus("この端末は位置情報に未対応です。都市名で検索してください。", true);
    document.getElementById("searchBox").style.display="flex";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=> loadByCoords(pos.coords.latitude, pos.coords.longitude),
    err=>{
      if(!renderCachedFallback()){
        setStatus("位置情報を取得できませんでした（"+err.message+"）。下のボタンから都市名で検索してください。", true);
      }
      document.getElementById("searchBox").style.display="flex";
    },
    {enableHighAccuracy:false, timeout:8000, maximumAge:600000}
  );
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
