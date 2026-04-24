// scripts/fetch-lotto-playwright.mjs
// Playwright headless Chrome으로 동행복권 크롤링
// 실제 브라우저처럼 동작 → IP 차단 우회

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수가 필요합니다');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 날짜 계산으로 예상 최신 회차
function estimateLatestRound() {
  const base = new Date('2002-12-07').getTime();
  const now = Date.now();
  return Math.floor((now - base) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// DB 최신 저장 회차
async function getLatestStoredRound() {
  const { data } = await supabase
    .from('lotto_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1);
  return data?.[0]?.round ?? 0;
}

// Playwright로 단일 회차 크롤링
async function fetchRoundWithBrowser(page, round) {
  try {
    await page.goto(
      `https://www.dhlottery.co.kr/lt645/result?drwNo=${round}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );

    // 페이지에서 당첨번호 추출 시도 (여러 패턴)
    const result = await page.evaluate((round) => {
      // 방법 1: JavaScript 변수에서 추출
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '');
      for (const script of scripts) {
        // tm1WnNo, tm2WnNo ... 패턴
        const m = script.match(/tm1WnNo['":\s]+(\d+).*?tm2WnNo['":\s]+(\d+).*?tm3WnNo['":\s]+(\d+).*?tm4WnNo['":\s]+(\d+).*?tm5WnNo['":\s]+(\d+).*?tm6WnNo['":\s]+(\d+).*?bnsWnNo['":\s]+(\d+)/s);
        if (m) {
          return {
            nums: [1,2,3,4,5,6].map(i => parseInt(m[i])).sort((a,b)=>a-b),
            bonus: parseInt(m[7]),
            source: 'js-var'
          };
        }
        // drwtNo 패턴
        const m2 = script.match(/drwtNo1['":\s]+(\d+).*?drwtNo2['":\s]+(\d+).*?drwtNo3['":\s]+(\d+).*?drwtNo4['":\s]+(\d+).*?drwtNo5['":\s]+(\d+).*?drwtNo6['":\s]+(\d+).*?bnusNo['":\s]+(\d+)/s);
        if (m2) {
          return {
            nums: [1,2,3,4,5,6].map(i => parseInt(m2[i])).sort((a,b)=>a-b),
            bonus: parseInt(m2[7]),
            source: 'drwtNo'
          };
        }
      }

      // 방법 2: DOM에서 result-ball 클래스 추출
      const balls = document.querySelectorAll('.result-ball, .ball, [class*="ball"]');
      if (balls.length >= 7) {
        const nums = Array.from(balls).map(b => parseInt(b.textContent?.trim() || '0')).filter(n => n > 0 && n <= 45);
        if (nums.length >= 7) {
          return {
            nums: nums.slice(0, 6).sort((a,b) => a-b),
            bonus: nums[6],
            source: 'dom-ball'
          };
        }
      }

      // 방법 3: 텍스트에서 패턴 추출
      const bodyText = document.body.innerText;
      const dateMatch = bodyText.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);

      return {
        error: '번호 추출 실패',
        url: window.location.href,
        title: document.title,
        dateMatch: dateMatch ? dateMatch[0] : null,
        bodyPreview: bodyText.slice(0, 200),
      };
    }, round);

    if (result.error) {
      return { error: result.error, round, debug: result };
    }

    // 날짜 계산
    const base = new Date('2002-12-07');
    const d = new Date(base.getTime() + (round - 1) * 7 * 24 * 60 * 60 * 1000);
    const drawDate = d.toISOString().slice(0, 10);

    return {
      ok: true,
      round,
      draw_date: drawDate,
      num1: result.nums[0], num2: result.nums[1], num3: result.nums[2],
      num4: result.nums[3], num5: result.nums[4], num6: result.nums[5],
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=ko-KR',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });

  const page = await context.newPage();

  // 먼저 메인 페이지 방문 (쿠키/세션 설정)
  console.log('🏠 메인 페이지 방문 중...');
  try {
    await page.goto('https://www.dhlottery.co.kr/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log('  메인 페이지 방문 실패 (계속 진행):', e.message);
  }

  let saved = 0, failed = 0;

  for (let round = fromRound; round <= toRound; round++) {
    process.stdout.write(`  fetch: ${round}회...`);

    const result = await fetchRoundWithBrowser(page, round);

    if (!result.ok) {
      console.log(` ❌ ${result.error}`);
      if (result.debug) console.log('    debug:', JSON.stringify(result.debug).slice(0, 200));
      failed++;

      // 3번 연속 실패하면 브라우저 재시작
      if (failed % 3 === 0) {
        console.log('  🔄 브라우저 재시작...');
        await page.goto('https://www.dhlottery.co.kr/', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      continue;
    }

    const { ok, ...data } = result;
    const { error: dbError } = await supabase
      .from('lotto_draws')
      .upsert(data, { onConflict: 'round' });

    if (dbError) {
      console.log(` ❌ DB 오류: ${dbError.message}`);
      failed++;
    } else {
      console.log(` ✅ ${data.num1},${data.num2},${data.num3},${data.num4},${data.num5},${data.num6} +${data.bonus}`);
      saved++;
    }

    // 요청 간격 (너무 빠르면 차단될 수 있음)
    await page.waitForTimeout(1500);
  }

  await browser.close();

  console.log(`\n🎉 완료! 저장: ${saved}개 / 실패: ${failed}개`);

  const { data: latest } = await supabase
    .from('lotto_draws')
    .select('round, draw_date')
    .order('round', { ascending: false })
    .limit(3);

  if (latest?.length) {
    console.log('\n📊 DB 최신 3개:');
    latest.forEach(d => console.log(`  ${d.round}회 - ${d.draw_date}`));
  }
}

main().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
