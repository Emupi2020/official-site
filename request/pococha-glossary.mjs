import { normalize } from './common.mjs';
import { guides } from './pococha-glossary-guides.mjs?v=glossary-meter-yell';

// List each term's reading first in its search aliases for dictionary order.
const groups = [
  {
    terms: [
      ['枠', 'わく 配信枠 방송 방송방', '配信している部屋のこと。「えむぴーの枠」は、えむぴーの配信を指します。', '방송이 열리는 방을 뜻해요. ‘えむぴーの枠’는 えむぴー의 방송을 말해요.', ['えむぴーの枠に遊びに行く', '에무피 방송에 놀러 가요']],
      ['初見', 'しょけん 처음 첫 방문', 'えむぴーの配信に初めて来た人のこと。「初見です！」は、初めて来たときのあいさつです。', 'えむぴー 방송에 처음 온 사람을 뜻해요. ‘初見です！’는 처음 왔을 때 쓰는 인사예요.'],
      ['キラコメ', 'きらこめ キラキラコメント 반짝이 댓글 이모지', '絵文字や記号で飾ったコメント。えむぴーが歌っているときの応援にも使えます。', '이모지나 기호로 꾸민 댓글이에요. えむぴー가 노래할 때 응원하는 데도 쓸 수 있어요.'],
      ['定期', 'ていき 定期文 定期コメント 정기 안내 공지', '配信中にコメント欄でときどき流れるお知らせ。歌まねリクエストの案内などを見かけたら「定期」です。', '방송 중 댓글창에 중간중간 올라오는 공지예요. 모창곡 신청 안내 같은 글이 여기에 해당해요.'],
      ['ボッコメ', 'ぼっこめ BOXコメント ボックスコメント 박스 댓글', '配信画面のぽこボックスのタイマーが止まったとき、また進めるために送るコメント。', '방송 화면의 포코 박스 타이머가 멈췄을 때 다시 움직이게 하려고 남기는 댓글이에요.'],
      ['ナイフォ', 'ないふぉ ナイスフォロー 팔로우', '「ナイスフォロー」の略。えむぴーをフォローした人にかける言葉。', '‘나이스 팔로우’의 줄임말로, えむぴー를 팔로우한 사람에게 하는 말이에요.'],
      ['プチおめ', 'ぷちおめ プチファン 쁘띠 팬 축하', 'プチファンになった人をお祝いする言葉。', '쁘띠 팬이 된 사람에게 축하할 때 쓰는 말이에요.'],
      ['拍手回収', 'はくしゅかいしゅう パチパチ 박수 박수 보내기', 'アイテムが使われたときなどに出る👏ボタンを押して、同じ配信を見ている人に拍手を送ること。', '아이템을 썼을 때 등에 나타나는 👏 버튼을 눌러 같은 방송을 보는 사람에게 박수를 보내는 거예요.'],
      ['ファンマ', 'ふぁんま ファンマーク 팬마크 팬 이모지', '「ファンマーク」の略。応援している人を表す絵文字などを、目印として名前に付けることがあります。', '‘팬 마크’의 줄임말이에요. 응원하는 사람을 상징하는 이모지 등을 닉네임에 붙이기도 해요.'],
      ['潜り', 'もぐり 潜る ながら見 채팅 없이 시청 잠수', '配信を開いたまま、コメントせずに聞いたり、別の作業をしたりすること。', '방송을 켜 둔 채 채팅 없이 듣거나 다른 일을 하는 걸 뜻해요.'],
      ['コアおめ', 'こあふぁん おめでとう 코어 팬 축하', 'コアファンになった人や、コアファンの段階が上がった人を祝う言葉。', '코어 팬이 됐거나 코어 팬 등급이 오른 사람에게 축하할 때 쓰는 말이에요.'],
      ['エルおめ', 'えるおめ えーる えーるおめ おめでとう 응원 축하', 'エールの段階が上がった人を祝う言葉。', '에루(응원 지표) 단계가 오른 사람에게 축하할 때 쓰는 말이에요.'],
      ['レベおめ', 'れべる おめでとう 레벨 레벨업 축하', 'ポコチャでレベルが上がった人を祝う言葉。', '포코차에서 레벨이 오른 사람에게 축하할 때 쓰는 말이에요.'],
    ],
  },
  {
    terms: [
      ['コイン', 'こいん 코인', '配信でアイテムを使うときに消費する、ポコチャ内の通貨。', '방송에서 아이템을 쓸 때 사용하는 포코차의 재화예요.'],
      ['アイテム', 'あいてむ ギフト 아이템 선물', 'コインを使って配信中のえむぴーに送れる応援。送ると画面に演出が出ます。', '코인을 써서 방송 중인 えむぴー에게 보낼 수 있어요. 보내면 화면에 효과가 나타나요.'],
      ['エール', 'えーる 에루 에일 응원', '視聴時間・視聴日数・コメント・アイテムなどで貯まる、リスナーからの応援の指標。', '시청 시간, 시청 일수, 댓글, 아이템 등으로 쌓이는 리스너의 응원 지표예요.'],
      ['コアファン', 'こあふぁん 코어 팬 코어팬', 'その月に、えむぴーへのエールが1K（1,000エール）以上になったリスナー。', '그달에 えむぴー에게 1K(1,000에루) 이상을 쌓은 리스너를 뜻해요.'],
      ['パチパチ', 'ぱちぱち 拍手回収 박수', '同じ配信を見ているリスナー同士で拍手を送り合える機能。アイテムが使われたときなどにボタンが出ます。', '같은 방송을 보는 리스너끼리 박수를 보낼 수 있는 기능이에요. 아이템을 썼을 때 등에 버튼이 나타나요.'],
      ['追いハート', 'おいはーと 追加ハート 하트 추가', 'アイテムが送られたタイミングに合わせて、ハートのアイテムを送って一緒に盛り上げること。', '아이템이 올라온 타이밍에 맞춰 하트 아이템을 보내며 함께 분위기를 띄우는 거예요.'],
      ['追いコメ', 'おいこめ 追いコメント おいこめんと 댓글 추가', 'アイテムが送られたタイミングに合わせて、コメントで一緒に盛り上げること。', '아이템이 올라온 타이밍에 맞춰 댓글로 함께 분위기를 띄우는 거예요.'],
      ['プチファン', 'ぷちふぁん プチ 쁘띠 팬', 'コアファンの手前にあるエールの段階。', '코어 팬이 되기 전의 에루 단계예요.'],
      ['1K', 'いちけー 千 1000 천 1케이', '1,000を表す略記。「1Kエール」は1,000エール、「1Kコイン」は1,000コインのことです。', '1,000을 뜻하는 줄임 표기예요. ‘1K 에루’는 1,000에루, ‘1K 코인’은 1,000코인이에요.'],
      ['キリコア', 'きりこあ キリ番コア きりばんこあ 코어 팬 인원', 'その月の10人目・20人目など、きりのいい人数に当たるコアファン。', '그달의 10번째나 20번째처럼 인원수가 딱 떨어지는 순서에 해당하는 코어 팬이에요.'],
      ['ナイト', 'ないと ぽこナイト ポコナイト 포코 나이트 기사', '対象イベントの応援で就任できる「ぽこナイト」のこと。イベント応援用のアイテムがもらえます。', '해당 이벤트를 응원할 때 맡을 수 있는 ‘포코 나이트’를 뜻해요. 이벤트 응원용 아이템을 받을 수 있어요.'],
      ['ロイチャ', 'ろいちゃ ロイヤルチャージ ろいやるちゃーじ WEB課金 로열 차지 웹 결제 코인 구매', '「ロイヤルチャージ」の略。Web版Pocochaでコインを購入する方法。', '‘로열 차지’의 줄임말이에요. 웹 버전 Pococha에서 코인을 구매하는 방법이에요.'],
    ],
  },
  {
    terms: [
      ['ランク', 'らんく 応援ランク 랭크 등급', 'えむぴーのプロフィールに表示される応援ランク。メーターの結果に応じてたまるランクポイントで上下します。', 'えむぴー 프로필에 표시되는 응원 등급이에요. 미터 결과에 따라 쌓이는 랭크 포인트로 오르거나 내려가요.'],
      ['メーター', 'めーたー ランクメーター 미터 랭크미터', '同じ締め時間・同じランク帯の配信者と比べた、えむぴーの応援ポイントの位置を示すもの。', '마감 시간과 랭크 구간이 같은 방송 진행자들과 비교해 えむぴー의 응원 포인트가 어느 위치인지 보여 줘요.'],
      ['締め時間', 'しめじかん 締め 마감 마감 시간', 'その日のランクメーターの結果が確定する時間。', '그날의 랭크 미터 결과가 확정되는 시간이에요.'],
      ['プラマイ', 'ぷらまい プラマイゼロ ±0 ぷらまいぜろ 플러스 마이너스 제로', 'その日のランクメーターの結果が±0（プラスマイナスゼロ）だったこと。', '그날의 랭크 미터 결과가 ±0(플러스 마이너스 제로)이었다는 뜻이에요.'],
      ['ボーダー', 'ぼーだー 境界線 컷 기준선', 'メーターで「0」「+1」「+2」に届くのに必要な応援ポイント。その日の状況で動きます。', '미터에서 ‘0’, ‘+1’, ‘+2’에 도달하는 데 필요한 응원 포인트예요. 그날 상황에 따라 달라져요.'],
      ['おやチケ', 'おやちけ おやすみチケット おやすみちけっと 휴식 티켓', '「おやすみチケット」の略。締め時間から次の締め時間まで、ランクメーターの変動を止めるチケット。', '‘휴식 티켓’의 줄임말이에요. 마감 시간부터 다음 마감 시간까지 랭크 미터 변동을 멈춰 주는 티켓이에요.'],
      ['応援ポイント', 'おうえんぽいんと 応援pt 응원 포인트', 'アイテムやコメントなど、リスナーの応援をもとに集計されるポイント。ランクメーターにも使われます。', '아이템, 댓글 등 리스너의 응원 활동을 바탕으로 집계하는 점수예요. 랭크 미터에도 쓰여요.'],
    ],
  },
  {
    terms: [
      ['BOX（ぽこボックス）', 'ぼっくす ぽこぼっくす 포코 박스 상자', '配信を見ながら条件を満たすと開けられる、コイン入りの箱。', '방송을 보면서 조건을 충족하면 열 수 있는 코인 상자예요.'],
      ['ファミリー', 'ふぁみりー 패밀리 팬 그룹', 'えむぴーのファミリーは「P’s」。メンバー同士でメッセージをやり取りしたり、配信にタグを付けたりできます。', 'えむぴー의 패밀리는 ‘P’s’예요. 멤버끼리 메시지를 주고받거나 방송에 태그를 달 수 있어요.'],
      ['タグ', 'たぐ タグ付け たぐづけ 태그', 'ファミリーメンバーが配信中に付けられる短い紹介文。配信の内容や雰囲気を外の人にも伝えられます。', '패밀리 멤버가 방송 중에 붙일 수 있는 짧은 소개글이에요. 방송 내용이나 분위기를 다른 사람에게도 알릴 수 있어요.'],
      ['アシスタント', 'あしすたんと アシ 어시스턴트 운영자', 'えむぴーが選んだ、配信や「P’s」の運営を手伝うメンバー。', 'えむぴー가 지정한 멤버로, 방송이나 ‘P’s’ 운영을 도와요.'],
      ['マイイベ', 'まいいべ マイイベント 自主企画 자체 이벤트', 'えむぴーが自分で企画するイベント。参加したいときは、その企画の案内を確認してください。', 'えむぴー가 직접 기획하는 이벤트예요. 참여하고 싶다면 해당 이벤트 안내를 확인해 주세요.'],
      ['おしのび配信', 'おしのびはいしん お忍び配信 お忍び 오시노비 방송', 'えむぴーの配信を見始めたばかりの人と交流しやすくする配信モード。', 'えむぴー의 방송을 보기 시작한 지 얼마 안 된 사람과 소통하기 위한 방송 모드예요.'],
      ['ご新規配信', 'ごしんきはいしん ご新規さん歓迎配信 ご新規 신규 환영 방송', 'ポコチャを始めたばかりのリスナーを歓迎する配信モード。', '포코차를 시작한 지 얼마 안 된 리스너를 환영하는 방송 모드예요.'],
      ['コメ禁', 'こめきん コメント禁止 댓글 금지 채팅 제한', '「コメント禁止」の略。えむぴーやアシスタントが、特定の人のコメントを一時的に制限できる機能。', '‘댓글 금지’의 줄임말이에요. えむぴー나 어시스턴트가 특정 사용자의 채팅을 일시적으로 제한할 수 있는 기능이에요.'],
    ],
  },
];

export function setupPocochaGlossary(panel, korean) {
  if (!panel) return;
  const form = panel.querySelector('form');
  const input = form.querySelector('input');
  const clear = form.querySelector('button');
  const categories = panel.querySelector('.glossary-categories');
  const categoryButtons = [...categories.querySelectorAll('button')];
  const results = panel.querySelector('#pococha-glossary-terms');
  const empty = panel.querySelector('#pococha-glossary-empty');
  let selectedCategory = 0;
  let savedPosition = performance.getEntriesByType('navigation')[0]?.type === 'back_forward'
    ? history.state?.glossaryPosition
    : null;
  const guidesByTerm = new Map();
  for (const [slug, { term, relatedTerms = [], title }] of Object.entries(guides)) {
    for (const name of [term, ...relatedTerms]) guidesByTerm.set(name, { slug, title });
  }

  const kanaRows = ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'やゆよ', 'らりるれろ', 'わをん'];
  const collator = new Intl.Collator('ja');
  const entries = groups.flatMap(({ terms }, index) =>
    terms.map(([name, aliases, ja, ko, example]) => {
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
      const guide = guidesByTerm.get(name);
      if (guide) {
        const detail = document.createElement('dd');
        const link = document.createElement('a');
        link.href = `./?view=pococha-glossary&term=${guide.slug}`;
        link.textContent = guide.title[Number(korean)];
        link.addEventListener('click', event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          history.replaceState({
            ...history.state,
            glossaryPosition: { category: selectedCategory, query: input.value, top: window.scrollY },
          }, '');
        });
        detail.append(link);
        row.append(detail);
      }
      const [reading] = aliases.split(' ');
      return { row, reading, category: index + 1, searchable: normalize(`${name} ${aliases}`) };
    })
  ).sort((first, second) => collator.compare(first.reading, second.reading));
  const sections = new Map();
  for (const entry of entries) {
    const initial = entry.reading.normalize('NFD')[0];
    const kanaRow = kanaRows.find(row => row.includes(initial));
    const label = kanaRow?.[0] ?? '他';
    if (!sections.has(label)) {
      const section = document.createElement('section');
      section.className = 'glossary-kana-section';
      const heading = document.createElement('h2');
      heading.className = 'glossary-kana-heading';
      heading.lang = 'ja';
      heading.textContent = label;
      const list = document.createElement('dl');
      section.append(heading, list);
      results.append(section);
      sections.set(label, { section, heading, list, entries: [] });
    }
    const group = sections.get(label);
    group.list.append(entry.row);
    group.entries.push(entry);
  }

  function filter() {
    const query = normalize(input.value);
    clear.hidden = !input.value;
    categories.hidden = Boolean(query);
    for (const { row, category, searchable } of entries) {
      row.hidden = query ? !searchable.includes(query) : selectedCategory !== 0 && selectedCategory !== category;
    }
    for (const { section, heading, entries: groupEntries } of sections.values()) {
      section.hidden = groupEntries.every(({ row }) => row.hidden);
      heading.hidden = Boolean(query);
    }
    empty.hidden = entries.some(({ row }) => !row.hidden);
  }

  function selectCategory(index) {
    categoryButtons[selectedCategory].setAttribute('aria-pressed', 'false');
    selectedCategory = index;
    categoryButtons[index].setAttribute('aria-pressed', 'true');
    filter();
  }

  categoryButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      selectCategory(index);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  });
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

  return () => {
    if (!savedPosition) return;
    const { query, category, top } = savedPosition;
    savedPosition = null;
    input.value = query;
    selectCategory(categoryButtons[category] ? category : 0);
    requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
  };
}
