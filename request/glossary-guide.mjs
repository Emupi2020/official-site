import { guides } from './pococha-glossary-guides.mjs?v=guide-rules';
import { $ } from './common.mjs';

export function showGlossaryGuide(slug, korean, heading) {
  const panel = $('glossary-guide');
  const language = Number(korean);
  const officialHelp = 'https://pococha-jp.pococha.com/hc/ja/articles/';
  if (korean) {
    $('guide-source').firstElementChild.textContent = '포코차 공식 도움말';
    $('guide-missing').textContent = '안내를 찾을 수 없어요.';
  }
  const guide = Object.hasOwn(guides, slug) ? guides[slug] : null;
  if (guide) {
    const title = guide.title[language];
    document.title = `${title} | Emupi`;
    const term = document.createElement('span');
    term.lang = 'ja';
    term.textContent = guide.term;
    const subtitle = document.createElement('span');
    subtitle.id = 'guide-subtitle';
    subtitle.textContent = title;
    heading.replaceChildren(term, ' ', subtitle);
    if (!panel.hidden) return;
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
    source.firstElementChild.href = officialHelp + guide.source;
    source.hidden = false;
    if (guide.action) {
      const action = $('guide-action');
      action.firstElementChild.href = guide.action[0];
      action.firstElementChild.textContent = guide.action[language + 1];
      action.hidden = false;
    }
    if (guide.image) {
      const figure = $('guide-figure');
      const image = figure.querySelector('img');
      const credit = figure.querySelector('figcaption a');
      credit.href = officialHelp + (guide.imageSource ?? guide.source);
      if (korean) credit.textContent = '이미지 출처: 포코차 공식 도움말';
      image.alt = guide.image[language + 1];
      figure.querySelector('figcaption span').textContent = image.alt;
      image.addEventListener('load', () => {
        figure.hidden = false;
        source.hidden = true;
      }, { once: true });
      image.src = guide.image[0];
    }
  } else {
    $('guide-missing').hidden = false;
  }
  panel.hidden = false;
}
