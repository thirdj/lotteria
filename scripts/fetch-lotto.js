// scripts/fetch-lotto.js
// GitHub Actions에서 실행되는 데이터 수집 스크립트
// 동행복권 API → Supabase DB 저장

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LOTTO_API = 'https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 환경변수 SUPABASE_URL, SUPABASE_SERVICE_KEY 가 필요합니다');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 단일 회차 데이터 fetch
async function fetchRound(round) {
  try {
    const res = await fetch(`${LOTTO_API}${round}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*',
        'Referer': 'https://www.dhlottery.co.kr/',
      },
    });
    const text = await res.text();
    if (!text.trim().startsWith('{')) return null; // HTML이면 스킵
    const d = JSON.parse(text);
    if (d.returnValue !== 'success') return null;
    return {
      round: d.drwNo,
      draw_date: d.drwNoDate,
      num1: d.drwtNo1,
      num2: d.drwtNo2,
      num3: d.drwtNo3,
      num4: d.drwtNo4,
      num5: d.drwtNo5,
      num6: d.drwtNo6,
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      winners1: d.firstPrzwnerCo,
    };
  } catch (e) {
    console.error(`  회차 ${round} fetch 실패:`, e.message);
    return null;
  }
}

// 최신 회차 번호 계산 (날짜 기반)
function estimateLatestRound() {
  const startDate = new Date('2002-12-07');
  const now = new Date();
  const weeksDiff = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
  return weeksDiff + 1;
}

// DB에서 가장 최근에 저장된 회차 조회
async function getLatestStoredRound() {
  const { data, error } = await supabase
    .from('lotto_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1);

  if (error || !data.length) return 0;
  return data[0].round;
}

// 메인 실행
async function main() {
  console.log('🎰 로또 데이터 수집 시작...\n');

  const fromEnv = process.env.FROM_ROUND;
  const toEnv = process.env.TO_ROUND;

  let fromRound, toRound;

  if (fromEnv && toEnv) {
    // 수동 지정 범위
    fromRound = parseInt(fromEnv);
    toRound = parseInt(toEnv);
    console.log(`📋 수동 범위: ${fromRound}회 ~ ${toRound}회`);
  } else {
    // 자동: DB 마지막 회차 이후부터 최신까지
    const latestStored = await getLatestStoredRound();
    const estimated = estimateLatestRound();
    fromRound = latestStored + 1;
    toRound = estimated + 2; // 여유분 포함
    console.log(`📋 자동 범위: ${fromRound}회 ~ ${toRound}회 (DB 최신: ${latestStored}회)`);
  }

  if (fromRound > toRound) {
    console.log('✅ 이미 최신 데이터가 저장되어 있습니다.');
    return;
  }

  // 배치로 fetch (10개씩 병렬)
  const BATCH = 10;
  let saved = 0;
  let failed = 0;

  for (let r = fromRound; r <= toRound; r += BATCH) {
    const batch = [];
    for (let i = r; i < r + BATCH && i <= toRound; i++) batch.push(i);

    console.log(`  fetch: ${batch[0]}~${batch[batch.length - 1]}회...`);
    const results = await Promise.all(batch.map(fetchRound));
    const valid = results.filter(Boolean);

    if (!valid.length) {
      failed += batch.length;
      continue;
    }

    // Supabase upsert (중복이면 업데이트)
    const { error } = await supabase
      .from('lotto_draws')
      .upsert(valid, { onConflict: 'round' });

    if (error) {
      console.error('  ❌ DB 저장 실패:', error.message);
      failed += valid.length;
    } else {
      saved += valid.length;
      console.log(`  ✅ ${valid.length}개 저장 완료`);
    }

    // API 부하 방지
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n🎉 완료! 저장: ${saved}개, 실패: ${failed}개`);

  // 최종 DB 상태 출력
  const { data: stats } = await supabase
    .from('lotto_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1);

  if (stats?.length) {
    console.log(`📊 DB 최신 회차: ${stats[0].round}회`);
  }
}

main().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
