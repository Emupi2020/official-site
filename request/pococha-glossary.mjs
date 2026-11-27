import { normalize } from './common.mjs';

const groups = [
  {
    heading: ['配信でよく聞く言葉', '방송에서 자주 쓰는 말'],
    terms: [
      ['枠', 'わく 配信枠 방송 방송방', 'ライバーが配信している場所のこと。', '라이버가 방송하는 방을 뜻해요.', ['えむぴーの枠に遊びに行く', '에무피 방송에 놀러 가요']],
      ['初見', 'しょけん 처음 첫 방문', 'その配信に初めて来た人のこと。', '그 방송에 처음 온 사람을 뜻해요.', ['初見です！', '처음 왔어요!']],
      ['コアおめ', 'こあふぁん おめでとう 코어 팬 축하', 'コアファンになった人や、コアファンの段階が上がった人を祝う言葉。', '코어 팬이 됐거나 코어 팬 등급이 오른 사람에게 축하할 때 쓰는 말이에요.'],
      ['エルおめ', 'えーる えーるおめ おめでとう 응원 축하', 'エールの段階が上がった人を祝う言葉。', '에루(응원 지표) 단계가 오른 사람에게 축하할 때 쓰는 말이에요.'],
      ['レベおめ', 'れべる おめでとう 레벨 레벨업 축하', 'ポコチャでレベルが上がった人を祝う言葉。', '포코차에서 레벨이 오른 사람에게 축하할 때 쓰는 말이에요.'],
    ],
  },
  {
    heading: ['応援にまつわる言葉', '응원에 관한 말'],
    terms: [
      ['コイン', 'こいん 코인', '配信でアイテムを使うときに消費する、ポコチャ内の通貨。', '방송에서 아이템을 쓸 때 사용하는 포코차의 재화예요.'],
      ['アイテム', 'あいてむ ギフト 아이템 선물', 'コインを使って配信中のライバーに送れる応援。送ると配信画面に演出が出ます。', '코인을 사용해 방송 중인 라이버에게 보낼 수 있어요. 보내면 방송 화면에 효과가 나타나요.'],
      ['エール', 'えーる 에루 에일 응원', '視聴時間・視聴日数・コメント・アイテムなどで貯まる、リスナーからの応援の指標。', '시청 시간, 시청 일수, 댓글, 아이템 등으로 쌓이는 리스너의 응원 지표예요.'],
      ['コアファン', 'こあふぁん 코어 팬 코어팬', 'その月に、あるライバーへのエールが1K（1,000エール）以上になったリスナー。', '한 달 동안 특정 라이버에게 1K(1,000에루) 이상 응원을 쌓은 리스너를 뜻해요.'],
    ],
  },
  {
    heading: ['配信の仕組み', '방송 시스템'],
    terms: [
      ['ランク', 'らんく 応援ランク 랭크 등급', 'ライバーの応援ランクのこと。ランクメーターの結果などに応じて上下します。', '라이버의 응원 등급이에요. 랭크 미터 결과 등에 따라 오르거나 내려가요.'],
      ['メーター', 'めーたー ランクメーター 미터 랭크미터', '同じランク帯のライバーの応援ポイントをもとに、締め時間までの順位やボーダーを示すもの。', '같은 랭크 구간의 라이버가 받은 응원 포인트를 바탕으로 순위와 마감 기준선을 보여 줘요.'],
      ['締め時間', 'しめじかん 締め 마감 마감 시간', 'その日のランクメーターの結果が確定する時間。', '그날의 랭크 미터 결과가 확정되는 시간이에요.'],
      ['プラマイ', 'ぷらまい プラマイゼロ ±0 ぷらまいぜろ 플러스 마이너스 제로', 'その日のランクメーターの結果が±0（プラスマイナスゼロ）だったこと。', '그날의 랭크 미터 결과가 ±0(플러스 마이너스 제로)이었다는 뜻이에요.'],
    ],
  },
];

export function setupPocochaGlossary(panel, korean) {
  if (!panel) return;
  const form = panel.querySelector('form');
  const input = form.querySelector('input');
  const clear = form.querySelector('button');
  const results = panel.querySelector('#pococha-glossary-terms');
  const empty = panel.querySelector('#pococha-glossary-empty');
  const language = Number(korean);

  const sections = groups.map(({ heading, terms }) => {
    const section = document.createElement('section');
    section.className = 'glossary-group';
    const title = document.createElement('h2');
    title.textContent = heading[language];
    const list = document.createElement('dl');
    const entries = terms.map(([name, aliases, ja, ko, example]) => {
      const row = document.createElement('div');
      row.className = 'glossary-term';
      const term = document.createElement('dt');
      term.lang = 'ja';
      term.textContent = name;
      const definition = document.createElement('dd');
      definition.textContent = korean ? ko : ja;
      row.append(term, definition);
      if (example) {
        const caption = document.createElement('dd');
        caption.className = 'glossary-example';
        caption.textContent = korean ? `예 “${example[1]}”` : `例「${example[0]}」`;
        row.append(caption);
      }
      list.append(row);
      return { row, searchable: normalize(`${name} ${aliases}`) };
    });
    section.append(title, list);
    results.append(section);
    return { section, entries };
  });

  function filter() {
    const query = normalize(input.value);
    clear.hidden = !input.value;
    for (const { section, entries } of sections) {
      for (const { row, searchable } of entries) row.hidden = !searchable.includes(query);
      section.hidden = entries.every(({ row }) => row.hidden);
    }
    empty.hidden = sections.some(({ section }) => !section.hidden);
  }

  input.addEventListener('input', filter);
  form.addEventListener('submit', event => {
    event.preventDefault();
    input.blur();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    filter();
    input.focus();
  });
}
