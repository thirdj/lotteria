// api/ai-numbers.js
// Claude API를 사용한 AI 번호 추천

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다' });
  }

  try {
    // 최근 52회 데이터 가져오기
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lotto_draws?select=*&order=round.desc&limit=52`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    const draws = await dbRes.json();

    if (!draws.length) {
      return res.status(404).json({ error: '데이터 없음' });
    }

    // 빈도 분석
    const freq = {};
    for (let i = 1; i <= 45; i++) freq[i] = 0;
    for (const d of draws) {
      [d.num1, d.num2, d.num3, d.num4, d.num5, d.num6].forEach(n => freq[n]++);
    }

    const freqList = Object.entries(freq)
      .map(([n, f]) => `${n}번(${f}회)`)
      .join(', ');

    const latest = draws[0];
    const latestNums = [latest.num1, latest.num2, latest.num3, latest.num4, latest.num5, latest.num6];

    const prompt = `당신은 로또 번호 분석 전문가입니다. 아래 데이터를 분석해서 5세트의 번호를 추천해주세요.

[최근 52회 당첨 번호 빈도]
${freqList}

[최신 당첨 번호 (${latest.round}회, ${latest.draw_date})]
${latestNums.join(', ')} + 보너스 ${latest.bonus}

다음 규칙을 반드시 지켜주세요:
1. 각 세트는 1~45 사이 숫자 6개 (중복 없음)
2. 홀짝 균형, 구간 분산 (1-10, 11-20, 21-30, 31-40, 41-45) 고려
3. 최근 자주 나온 번호와 오래 안 나온 번호를 적절히 혼합
4. 반드시 JSON 형식으로만 응답 (다른 텍스트 없이)

응답 형식:
{"sets":[[1,2,3,4,5,6],[7,8,9,10,11,12],[13,14,15,16,17,18],[19,20,21,22,23,24],[25,26,27,28,29,30]],"reason":"추천 이유 2줄 요약"}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      return res.status(500).json({ error: 'AI 응답 파싱 실패', raw: text });
    }

    // 각 세트 정렬
    parsed.sets = parsed.sets.map(s => [...s].sort((a, b) => a - b));

    return res.status(200).json({
      sets: parsed.sets,
      reason: parsed.reason,
      basedOn: `최근 ${draws.length}회 데이터 분석`,
      latestRound: latest.round,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
