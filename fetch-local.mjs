// fetch-local.mjs
// 네이버 검색 API로 회차별 당첨번호 수집 → Supabase 저장
// 실행: SUPABASE_SERVICE_KEY="키" node fetch-local.mjs 1100 1220

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gjxrlnatlhlcfekuojiu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY 환경변수를 설정해주세요');
  console.error('   export SUPABASE_SERVICE_KEY="your-service-role-key"');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 네이버 검색으로 회차 데이터 파싱
async function fetchRoundFromNaver(round) {
  try {
    const query = encodeURIComponent(`로또 ${round}회 당첨번호`);
    const res = await fetch(`https://search.naver.com/search.naver?query=${query}&where=nexearch`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const html = await res.text();

    // 당첨번호 6개 파싱 (다양한 패턴 시도)
    // 패턴 1: "2, 22, 25, 28, 34, 43" 형태
    let numsMatch = html.match(/(\d{1,2})[,·\s]+(\d{1,2})[,·\s]+(\d{1,2})[,·\s]+(\d{1,2})[,·\s]+(\d{1,2})[,·\s]+(\d{1,2})/);
    
    // 날짜 파싱
    let dateMatch = html.match(/20\d{2}[.\-년]\s*\d{1,2}[.\-월]\s*\d{1,2}/);
    
    // 보너스 번호 파싱
    let bonusMatch = html.match(/보너스[^0-9]*(\d{1,2})/);

    if (!numsMatch || !bonusMatch) return null;

    const nums = [
      parseInt(numsMatch[1]), parseInt(numsMatch[2]),
      parseInt(numsMatch[3]), parseInt(numsMatch[4]),
      parseInt(numsMatch[5]), parseInt(numsMatch[6]),
    ].sort((a, b) => a - b);

    const bonus = parseInt(bonusMatch[1]);

    // 유효성 검사
    if (nums.some(n => n < 1 || n > 45)) return null;
    if (bonus < 1 || bonus > 45) return null;
    if (new Set(nums).size !== 6) return null;

    // 날짜 정리
    let drawDate = '2000-01-01';
    if (dateMatch) {
      const raw = dateMatch[0].replace(/[년월]/g, '-').replace(/\s/g, '').replace(/\.$/, '');
      drawDate = raw;
    }

    return {
      round,
      draw_date: drawDate,
      num1: nums[0], num2: nums[1], num3: nums[2],
      num4: nums[3], num5: nums[4], num6: nums[5],
      bonus,
      prize1: null,
      winners1: null,
    };
  } catch(e) {
    return null;
  }
}

// 동행복권 직접 시도 (혹시 되면)
async function fetchRoundDirect(round) {
  try {
    const res = await fetch(
      `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) }
    );
    const text = await res.text();
    if (!text.trim().startsWith('{')) return null;
    const d = JSON.parse(text);
    if (d.returnValue !== 'success') return null;
    return {
      round: d.drwNo,
      draw_date: d.drwNoDate,
      num1: d.drwtNo1, num2: d.drwtNo2, num3: d.drwtNo3,
      num4: d.drwtNo4, num5: d.drwtNo5, num6: d.drwtNo6,
      bonus: d.bnusNo,
      prize1: d.firstWinamnt,
      winners1: d.firstPrzwnerCo,
    };
  } catch { return null; }
}

async function fetchRound(round) {
  // 1. 직접 시도
  const direct = await fetchRoundDirect(round);
  if (direct) return direct;

  // 2. 네이버 검색 fallback
  await new Promise(r => setTimeout(r, 300));
  return fetchRoundFromNaver(round);
}

async function main() {
  const fromRound = parseInt(process.argv[2]) || 1100;
  const toRound   = parseInt(process.argv[3]) || 1220;

  console.log(`🎰 로또 데이터 수집: ${fromRound}회 ~ ${toRound}회\n`);

  let saved = 0, failed = 0;

  // 네이버는 병렬 과부하 방지 위해 3개씩
  const BATCH = 3;

  for (let r = fromRound; r <= toRound; r += BATCH) {
    const batch = [];
    for (let i = r; i < r + BATCH && i <= toRound; i++) batch.push(i);

    process.stdout.write(`  fetch: ${batch[0]}~${batch[batch.length-1]}회...`);

    const results = await Promise.all(batch.map(fetchRound));
    const valid = results.filter(Boolean);

    if (!valid.length) {
      failed += batch.length;
      console.log(` ❌ 0/${batch.length}`);
      continue;
    }

    const { error } = await supabase
      .from('lotto_draws')
      .upsert(valid, { onConflict: 'round' });

    if (error) {
      console.log(` ❌ DB: ${error.message}`);
      failed += valid.length;
    } else {
      saved += valid.length;
      console.log(` ✅ ${valid.length}개`);
    }

    // 네이버 요청 간격
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n🎉 완료! 저장: ${saved}개 / 실패: ${failed}개`);

  const { data } = await supabase
    .from('lotto_draws')
    .select('round, draw_date, num1, num2, num3, num4, num5, num6, bonus')
    .order('round', { ascending: false })
    .limit(3);

  if (data?.length) {
    console.log('\n📊 DB 최신 3개:');
    data.forEach(d => console.log(`  ${d.round}회 (${d.draw_date}): ${d.num1},${d.num2},${d.num3},${d.num4},${d.num5},${d.num6} +${d.bonus}`));
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
