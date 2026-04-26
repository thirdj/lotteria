// scripts/fetch-lotto-playwright.mjs
// 1순위: 동행복권 Playwright 크롤링
// 2순위: 네이버 검색 API 파싱 (fallback)

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수가 필요합니다');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function estimateLatestRound() {
  const base = new Date('2002-12-07').getTime();
  return Math.floor((Date.now() - base) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

async function getLatestStoredRound() {
  const { data } = await supabase
    .from('lotto_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1);
  return data?.[0]?.round ?? 0;
}

// 동행복권 Playwright 크롤링
async function fetchFromDhlottery(page, round) {
  try {
    await page.goto(
      `https://www.dhlottery.co.kr/lt645/result?drwNo=${round}`,
      { waitUntil: 'networkidle', timeout: 20000 }
    );

    await page.waitForSelector('.result-ballBox', { timeout: 8000 });

    const result = await page.evaluate(() => {
      const ballBox = document.querySelector('.result-ballBox');
      if (!ballBox) return { error: '.result-ballBox 없음' };

      const children = Array.from(ballBox.children);
      const figureIdx = children.findIndex(el => el.tagName === 'FIGURE');
      if (figureIdx === -1) return { error: 'figure 없음' };

      const nums = children
        .slice(0, figureIdx)
        .filter(el => el.classList.contains('result-ball'))
        .map(b => parseInt(b.textContent?.trim() || '0'))
        .filter(n => n >= 1 && n <= 45);

      const bonus = children
        .slice(figureIdx + 1)
        .filter(el => el.classList.contains('result-ball'))
        .map(b => parseInt(b.textContent?.trim() || '0'))
        .find(n => n >= 1 && n <= 45);

      // 날짜
      const bodyText = document.body.innerText;
      const dateMatch = bodyText.match(/(\d{4})[.\-년\s]*(\d{1,2})[.\-월\s]*(\d{1,2})/);

      return { nums, bonus, dateMatch: dateMatch ? [dateMatch[1], dateMatch[2], dateMatch[3]] : null };
    });

    if (result.error || result.nums?.length !== 6 || !result.bonus) return null;

    const sorted = [...result.nums].sort((a, b) => a - b);
    let drawDate;
    if (result.dateMatch) {
      const [y, m, d] = result.dateMatch;
      drawDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    } else {
      const base = new Date('2002-12-07');
      drawDate = new Date(base.getTime() + (round-1)*7*24*60*60*1000).toISOString().slice(0,10);
    }

    return { round, draw_date: drawDate, num1: sorted[0], num2: sorted[1], num3: sorted[2], num4: sorted[3], num5: sorted[4], num6: sorted[5], bonus: result.bonus, prize1: null, winners1: null };
  } catch { return null; }
}

// 네이버 검색 API fallback — JSON 구조화된 데이터 파싱
async function fetchFromNaver(round) {
  try {
    const query = encodeURIComponent(`로또 ${round}회 당첨번호`);
    const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.naver.com',
      },
    });

    const html = await res.text();

    // 네이버 로또 결과 블록에서 번호 추출
    // 패턴: 6개 번호가 연속으로 나오는 구조
    // <span ...>2</span> ... <span ...>22</span> ...
    
    // JSON-LD 또는 구조화 데이터에서 추출 시도
    const jsonLdMatch = html.match(/"lotteryNumber[^"]*"[^}]+}/g);
    
    // 네이버 로또 전용 파싱: 번호들이 특정 클래스/패턴으로 묶여있음
    // "제 N회" 패턴 찾기
    const roundMatch = html.match(new RegExp(`제\\s*${round}\\s*회`));
    if (!roundMatch) return null;

    // 해당 위치 근처에서 번호 6개 + 보너스 추출
    const roundIdx = html.indexOf(roundMatch[0]);
    const searchArea = html.slice(roundIdx, roundIdx + 3000);

    // 날짜 추출
    const dateMatch = searchArea.match(/(\d{4})[.\-년\s]+(\d{1,2})[.\-월\s]+(\d{1,2})/);

    // 번호 추출: 1~45 사이 숫자들
    const numPattern = /(?:^|[^0-9])([1-9]|[1-3][0-9]|4[0-5])(?:[^0-9]|$)/g;
    const allNums = [];
    let match;
    const cleanArea = searchArea.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    
    // 숫자 시퀀스 찾기 - 6개의 연속된 1-45 사이 숫자
    const numSeq = cleanArea.match(/\b([1-9]|[1-3][0-9]|4[0-5])\b/g);
    if (!numSeq) return null;

    const candidates = numSeq.map(n => parseInt(n)).filter(n => n >= 1 && n <= 45);
    
    // 연속된 6개 유니크 번호 찾기
    for (let i = 0; i < candidates.length - 6; i++) {
      const window = candidates.slice(i, i + 7);
      const unique = [...new Set(window)];
      if (unique.length === 7 && unique.every(n => n >= 1 && n <= 45)) {
        const sorted = unique.slice(0, 6).sort((a, b) => a - b);
        const bonus = unique[6];

        let drawDate;
        if (dateMatch) {
          const [, y, m, d] = dateMatch;
          drawDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        } else {
          const base = new Date('2002-12-07');
          drawDate = new Date(base.getTime() + (round-1)*7*24*60*60*1000).toISOString().slice(0,10);
        }

        return { round, draw_date: drawDate, num1: sorted[0], num2: sorted[1], num3: sorted[2], num4: sorted[3], num5: sorted[4], num6: sorted[5], bonus, prize1: null, winners1: null };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

// 네이버 OpenAPI 방식 (더 정확)
async function fetchFromNaverAPI(round) {
  try {
    const query = encodeURIComponent(`로또 ${round}회 당첨번호`);
    const res = await fetch(`https://s.search.naver.com/p/direct/lotto?query=${query}&round=${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.naver.com',
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim().startsWith('{')) return null;
    const data = JSON.parse(text);

    // 네이버 로또 API 응답 파싱
    const nums = [data.num1, data.num2, data.num3, data.num4, data.num5, data.num6].map(Number).filter(n => n >= 1 && n <= 45);
    const bonus = Number(data.bonus || data.bnusNo);

    if (nums.length !== 6 || !bonus) return null;

    const sorted = nums.sort((a, b) => a - b);
    const base = new Date('2002-12-07');
    const drawDate = data.date || new Date(base.getTime() + (round-1)*7*24*60*60*1000).toISOString().slice(0,10);

    return { round, draw_date: drawDate, num1: sorted[0], num2: sorted[1], num3: sorted[2], num4: sorted[3], num5: sorted[4], num6: sorted[5], bonus, prize1: null, winners1: null };
  } catch { return null; }
}

async function fetchRound(page, round) {
  // 1순위: 동행복권 직접 크롤링
  const direct = await fetchFromDhlottery(page, round);
  if (direct) return { ...direct, source: 'dhlottery' };

  // 2순위: 네이버 API
  const naverApi = await fetchFromNaverAPI(round);
  if (naverApi) return { ...naverApi, source: 'naver-api' };

  // 3순위: 네이버 검색 HTML 파싱
  await new Promise(r => setTimeout(r, 500));
  const naver = await fetchFromNaver(round);
  if (naver) return { ...naver, source: 'naver-html' };

  return null;
}

async function main() {
  const fromEnv = process.env.FROM_ROUND;
  const toEnv = process.env.TO_ROUND;

  let fromRound, toRound;

  if (fromEnv && toEnv && fromEnv !== '' && toEnv !== '') {
    fromRound = parseInt(fromEnv);
    toRound = parseInt(toEnv);
    console.log(`📋 수동 범위: ${fromRound}회 ~ ${toRound}회`);
  } else {
    const latestStored = await getLatestStoredRound();
    const estimated = estimateLatestRound();
    fromRound = latestStored + 1;
    toRound = estimated + 1;
    console.log(`📋 자동 범위: ${fromRound}회 ~ ${toRound}회 (DB 최신: ${latestStored}회)`);
  }

  if (fromRound > toRound) {
    console.log('✅ 이미 최신 데이터가 저장되어 있습니다.');
    return;
  }

  console.log('\n🌐 Playwright 브라우저 시작...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  });

  const page = await context.newPage();

  // 메인 페이지 먼저 방문
  try {
    await page.goto('https://www.dhlottery.co.kr/lt645/result', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    console.log('🏠 동행복권 메인 방문 완료');
  } catch (e) {
    console.log('  메인 방문 실패 (네이버 fallback 사용):', e.message);
  }

  let saved = 0, failed = 0;

  for (let round = fromRound; round <= toRound; round++) {
    process.stdout.write(`  fetch: ${round}회...`);

    const result = await fetchRound(page, round);

    if (!result) {
      console.log(` ❌ 모든 소스 실패`);
      failed++;
      continue;
    }

    const { source, ...data } = result;
    const { error: dbError } = await supabase
      .from('lotto_draws')
      .upsert(data, { onConflict: 'round' });

    if (dbError) {
      console.log(` ❌ DB: ${dbError.message}`);
      failed++;
    } else {
      console.log(` ✅ [${source}] ${data.num1},${data.num2},${data.num3},${data.num4},${data.num5},${data.num6} +${data.bonus}`);
      saved++;
    }

    await page.waitForTimeout(1000);
  }

  await browser.close();

  console.log(`\n🎉 완료! 저장: ${saved}개 / 실패: ${failed}개`);

  const { data: latest } = await supabase
    .from('lotto_draws')
    .select('round, draw_date, num1, num2, num3, num4, num5, num6, bonus')
    .order('round', { ascending: false })
    .limit(3);

  if (latest?.length) {
    console.log('\n📊 DB 최신 3개:');
    latest.forEach(d => console.log(`  ${d.round}회 (${d.draw_date}): ${d.num1},${d.num2},${d.num3},${d.num4},${d.num5},${d.num6} +${d.bonus}`));
  }
}

main().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
