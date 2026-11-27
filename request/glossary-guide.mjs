import { guides } from './pococha-glossary-guides.mjs?v=concise';
import { $, safeGet } from './common.mjs';

const korean = safeGet('emupi-request-language') === 'ko';
const language = Number(korean);
const back = $('glossary-back');
if (korean) {
  document.documentElement.lang = 'ko';
  back.textContent = '‹ 포코차 용어집';
  $('guide-title').textContent = '포코차 용어집';
  $('guide-source').firstElementChild.textContent = '포코차 공식 도움말';
  $('guide-missing').textContent = '안내를 찾을 수 없어요.';
}

const slug = new URLSearchParams(location.search).get('term');
const guide = Object.hasOwn(guides, slug) ? guides[slug] : null;
if (guide) {
  const title = guide.title[language];
  document.title = `${title} | Emupi`;
  $('guide-title').textContent = title;
  const term = $('guide-term');
  term.textContent = guide.term;
  term.hidden = false;
  const steps = $('guide-steps');
  if (guide.steps.length === 1) {
    const instruction = document.createElement('p');
    instruction.textContent = guide.steps[0][language];
    steps.before(instruction);
  } else {
    for (const step of guide.steps) {
      const item = document.createElement('li');
      item.textContent = step[language];
      steps.append(item);
    }
    steps.hidden = false;
  }
  const source = $('guide-source');
  source.firstElementChild.href = `https://pococha-jp.pococha.com/hc/ja/articles/${guide.source}`;
  source.hidden = false;
} else {
  $('guide-missing').hidden = false;
}

const glossary = new URL(back.href);
const previous = document.referrer && new URL(document.referrer);
if (previous && previous.origin === glossary.origin && previous.pathname === glossary.pathname
    && (previous.searchParams.get('view') ?? previous.searchParams.get('preview')) === 'pococha-glossary') {
  back.href = previous.href;
  back.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.back();
  });
}
