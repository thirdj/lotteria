// scripts/fetch-lotto-playwright.mjs
// Playwright headless Chrome으로 동행복권 크롤링
// .result-ballBox 안에서 figure 기준으로 당첨번호/보너스 분리

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

async function fetchRoundWithBrowser(page, round) {
  try {
    await page.goto(
      `https://www.dhlottery.co.kr/lt645/result?drwNo=${round}`,
      { waitUntil: 'networkidle', timeout: 20000 }
    );

    // .result-ballBox 렌더링 대기
    await page.waitForSelector('.result-ballBox', { timeout: 10000 }).catch(() => {});

    const result = await page.evaluate(() => {
      // 첫 번째 .result-ballBox (최신 회차 당첨번호)
      const ballBox = document.querySelector('.result-ballBox');
      if (!ballBox) return { error: '.result-ballBox 없음' };

      // figure 기준으로 앞=당첨번호, 뒤=보너스
      const children = Array.from(ballBox.children);
      const figureIdx = children.findIndex(el => el.tagName === 'FIGURE');

      if (figureIdx === -1) return { error: 'figure 태그 없음' };

      // figure 앞의 .result-ball들 = 당첨번호
      const numBalls = children
        .slice(0, figureIdx)
        .filter(el => el.classList.contains('result-ball'));

      // figure 뒤의 .result-ball = 보너스
      const bonusBalls = children
        .slice(figureIdx + 1)
        .filter(el => el.classList.contains('result-ball'));

      const nums = numBalls.map(b => parseInt(b.textContent?.trim() || '0')).filter(n => n >= 1 && n <= 45);
      const bonus = bonusBalls.length > 0 ? parseInt(bonusBalls[bonusBalls.length - 1].textContent?.trim() || '0') : 0;

      // 날짜 추출
      const dateEl = document.querySelector('.result-date, .drwDate, [class*="result-txt"] [class*="date"]');
      const bodyText = document.body.innerText;
      const dateMatch = bodyText.match(/(\d{4})[.\-년\s]*(\d{1,2})[.\-월\s]*(\d{1,2})/);

      return {
        nums,
        bonus,
        dateMatch: dateMatch ? [dateMatch[1], dateMatch[2], dateMatch[3]] : null,
        figureIdx,
        numCount: nums.length,
      };
    });

    if (result.error) return { error: result.error, round };

    if (result.nums.length !== 6 || !result.bonus) {
      return {
        error: `번호 개수 오류 (nums: ${JSON.stringify(result.nums)}, bonus: ${result.bonus})`,
        round,
      };
    }

    const sorted = [...result.nums].sort((a, b) => a - b);

    // 날짜 계산
    let drawDate;
    if (result.dateMatch) {
      const [y, m, d] = result.dateMatch;
      drawDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    } else {
      const base = new Date('2002-12-07');
      const d = new Date(base.getTime() + (round - 1) * 7 * 24 * 60 * 60 * 1000);
      drawDate = d.toISOString().slice(0, 10);
    }

    return {
      ok: true,
      round,
      draw_date: drawDate,
      num1: sorted[0], num2: sorted[1], num3: sorted[2],
      num4: sorted[3], num5: sorted[4], num6: sorted[5],
      bonus: result.bonus,
      prize1: null,
      winners1: null,
    };
  } catch (e) {
    return { error: e.message, round };
  }
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

  // 메인 페이지 먼저 방문 (쿠키/세션)
  console.log('🏠 메인 페이지 방문...');
  try {
    await page.goto('https://www.dhlottery.co.kr/lt645/result', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log('  메인 방문 실패 (계속):', e.message);
  }

  let saved = 0, failed = 0;

  for (let round = fromRound; round <= toRound; round++) {
    process.stdout.write(`  fetch: ${round}회...`);

    const result = await fetchRoundWithBrowser(page, round);

    if (!result.ok) {
      console.log(` ❌ ${result.error}`);
      failed++;
      if (failed % 3 === 0) {
        await page.goto('https://www.dhlottery.co.kr/lt645/result', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      continue;
    }

    const { ok, ...data } = result;
    const { error: dbError } = await supabase
      .from('lotto_draws')
      .upsert(data, { onConflict: 'round' });

    if (dbError) {
      console.log(` ❌ DB: ${dbError.message}`);
      failed++;
    } else {
      console.log(` ✅ ${data.num1},${data.num2},${data.num3},${data.num4},${data.num5},${data.num6} +${data.bonus}`);
      saved++;
    }

    await page.waitForTimeout(1500);
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
