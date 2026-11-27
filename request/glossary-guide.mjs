import { guides } from './pococha-glossary-guides.mjs?v=glossary-kirakome-icon';
import { $ } from './common.mjs';

function appendCopyExamples(panel, examples, korean) {
  const heading = document.createElement('h2');
  heading.textContent = korean ? '키라코메 예시' : 'キラコメの例';
  const list = document.createElement('ul');
  list.className = 'glossary-copy-examples';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const copyLabel = korean ? '복사' : 'コピー';
  for (const example of examples) {
    const row = document.createElement('li');
    const sample = document.createElement('span');
    sample.textContent = example;
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    button.setAttribute('aria-label', `${example} ${copyLabel}`);
    button.addEventListener('click', async () => {
      status.textContent = '';
      try {
        await navigator.clipboard.writeText(example);
        status.textContent = korean ? '복사했어요.' : 'コピーしました。';
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(sample);
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = korean ? '선택한 문구를 길게 눌러 복사해 주세요.' : '選択した文を長押ししてコピーしてください。';
      }
    });
    row.append(sample, button);
    list.append(row);
  }
  panel.append(heading, list, status);
}

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
      for (const [index, step] of guide.steps.entries()) {
        const item = document.createElement('li');
        item.append(step[language]);
        if (index === 0 && guide.stepImages && guide.image) item.append($('guide-figure'));
        const stepImage = guide.stepImages?.[index + 1];
        if (stepImage) {
          const figure = document.createElement('figure');
          figure.hidden = true;
          const image = document.createElement('img');
          image.alt = stepImage[language + 1];
          image.addEventListener('load', () => { figure.hidden = false; }, { once: true });
          image.src = stepImage[0];
          figure.append(image);
          if (stepImage[3]) {
            const caption = document.createElement('figcaption');
            const credit = document.createElement('a');
            credit.href = officialHelp + stepImage[3];
            credit.target = '_blank';
            credit.rel = 'noopener';
            credit.textContent = korean ? '이미지 출처: 포코차 공식 도움말' : '画像出典：ポコチャ公式ヘルプ';
            caption.append(image.alt, ' ', credit);
            figure.append(caption);
          }
          item.append(figure);
        }
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
      credit.href = guide.imageSourceUrl ?? officialHelp + (guide.imageSource ?? guide.source);
      credit.hidden = Boolean(guide.ownImage);
      if (korean) credit.textContent = '이미지 출처: 포코차 공식 도움말';
      image.alt = guide.image[language + 1];
      figure.querySelector('figcaption span').textContent = image.alt;
      image.addEventListener('load', () => {
        figure.hidden = false;
        source.hidden = !guide.ownImage;
      }, { once: true });
      image.src = guide.image[0];
    }
    if (guide.copyExamples) appendCopyExamples(panel, guide.copyExamples, korean);
  } else {
    $('guide-missing').hidden = false;
  }
  panel.hidden = false;
}
